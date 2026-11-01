// Commands are built from a closed table, and answers are read strictly.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COMMANDS, SoundpadError, buildCommand, cleanAnswer, compareVersions, parseAnswer, statusCode, supports,
} from '../com.ulanzi.soundpad.ulanziPlugin/plugin/soundpad/protocol.js';
import { XmlError, decodeEntities, isCompleteDocument, parseXml } from '../com.ulanzi.soundpad.ulanziPlugin/plugin/soundpad/xml.js';

test('commands are written the way the reference client writes them', () => {
  assert.equal(buildCommand('DoPlaySound', 5), 'DoPlaySound(5)');
  assert.equal(buildCommand('DoPlaySoundOn', 5, true, false), 'DoPlaySound(5, true, false)');
  assert.equal(buildCommand('GetSoundlistRange', 3, 3), 'GetSoundlist(3, 3)');
  assert.equal(buildCommand('GetCategories', true, false), 'GetCategories(true, false)');
  assert.equal(buildCommand('DoStopSound'), 'DoStopSound()');
  assert.equal(buildCommand('SetVolume', 0), 'SetVolume(0)');
  assert.equal(buildCommand('DoPlayRandomSound', false, true), 'DoPlayRandomSound(false, true)');
});

test('nothing outside the table and its argument types can become a command', () => {
  const bad = [
    ['DoAddSound', 'C:\\evil.exe'],
    ['DoPlaySound', '1); DoRemoveSelectedEntries(true'],
    ['DoPlaySound', 0],
    ['DoPlaySound', -1],
    ['DoPlaySound', 1.5],
    ['DoPlaySound', Number.NaN],
    ['DoPlaySound', 2_000_000],
    ['DoPlaySoundOn', 1, 'true', false],
    ['SetVolume', 101],
    ['SetVolume', -1],
    ['DoStopSound', 1],
    ['toString'],
    ['__proto__'],
    ['constructor'],
  ];
  for (const [name, ...args] of bad) {
    assert.throws(() => buildCommand(name, ...args), TypeError, `${String(name)} ${args.join(',')}`);
  }
});

test('no command can remove, add or overwrite anything in Soundpad', () => {
  for (const name of Object.keys(COMMANDS)) {
    assert.doesNotMatch(name, /Remove|Add|Save|Undo|Redo|Record|Search|Select|Scroll/, name);
  }
});

test('status codes are read, and only R-200 is success', () => {
  assert.equal(parseAnswer('ok', 'R-200'), true);
  assert.equal(statusCode('R-404'), 404);
  assert.equal(statusCode('PLAYING'), null);
  for (const answer of ['R-404', 'R-500', 'R-400 bad request']) {
    assert.throws(() => parseAnswer('ok', answer), (error) => error instanceof SoundpadError && error.kind === 'rejected');
  }
  assert.throws(() => parseAnswer('ok', ''), (error) => error.kind === 'unexpected');
  assert.throws(() => parseAnswer('ok', 'yes'), (error) => error.kind === 'unexpected');
  assert.equal(parseAnswer('ok', 'R-200\0\0'), true);
});

test('numbers, flags and play states are read strictly', () => {
  assert.equal(parseAnswer('number', '1200'), 1200);
  assert.equal(parseAnswer('number', '-1'), -1);
  assert.throws(() => parseAnswer('number', '12abc'));
  assert.throws(() => parseAnswer('number', 'R-404'), (error) => error.kind === 'rejected' && error.code === 404);
  assert.equal(parseAnswer('flag', '1'), true);
  assert.equal(parseAnswer('flag', '0'), false);
  assert.equal(parseAnswer('flag', 'true'), true);
  assert.throws(() => parseAnswer('flag', '2'));
  for (const status of ['STOPPED', 'PLAYING', 'PAUSED', 'SEEKING']) assert.equal(parseAnswer('status', status), status);
  assert.equal(parseAnswer('status', 'playing'), 'PLAYING');
  assert.throws(() => parseAnswer('status', 'EXPLODING'));
  assert.equal(parseAnswer('text', '1.1.2'), '1.1.2');
  assert.throws(() => parseAnswer('text', 'x'.repeat(300)));
  assert.throws(() => parseAnswer('text', 'a\u0001b'));
});

test('trailing NUL bytes and spaces are removed from answers', () => {
  assert.equal(cleanAnswer('R-200\0\0\0'), 'R-200');
  assert.equal(cleanAnswer('  1.1.2 \n'), '1.1.2');
  assert.equal(cleanAnswer(undefined), '');
});

test('versions compare by number, not by text', () => {
  assert.ok(compareVersions('1.1.10', '1.1.2') > 0);
  assert.ok(compareVersions('1.0', '1.0.0') === 0);
  assert.ok(compareVersions('1.0.9', '1.1.0') < 0);
  assert.ok(supports('1.1.2', 'DoPlayRandomSound'));
  assert.ok(!supports('1.1.0', 'DoPlayRandomSound'));
  assert.ok(!supports('1.0.0', 'GetCategories'));
  assert.ok(supports(null, 'GetCategories'), 'an unknown version is tried, and Soundpad answers R-404 if it lacks it');
  assert.ok(!supports('9.9.9', 'NoSuchCommand'));
});

test('the XML reader keeps attributes, nesting and entities', () => {
  const root = parseXml('<?xml version="1.0" encoding="UTF-8"?>\n<Categories><Category index="1" name="Memes &amp; fun"><Sound index="3" title="It&apos;s &#233;pic &#x1F50A;"/></Category><!-- note --><Category index="2" name=\'Single\'/></Categories>');
  assert.equal(root.name, 'Categories');
  assert.equal(root.children.length, 2);
  assert.equal(root.children[0].attrs.name, 'Memes & fun');
  assert.equal(root.children[0].children[0].attrs.title, "It's épic 🔊");
  assert.equal(root.children[1].attrs.name, 'Single');
});

test('the XML reader refuses what Soundpad never sends', () => {
  for (const bad of [
    '<a><b></a>',
    '<a>',
    '<a/><b/>',
    '<!DOCTYPE x [<!ENTITY e "boom">]><a/>',
    '<a x=1/>',
    'no tags',
    '<a><!-- open</a>',
    `${'<a>'.repeat(40)}${'</a>'.repeat(40)}`,
  ]) {
    assert.throws(() => parseXml(bad), XmlError, bad.slice(0, 40));
  }
  assert.throws(() => parseXml(null), XmlError);
});

test('entities that would break a string are dropped', () => {
  assert.equal(decodeEntities('a&#0;b&#xD800;c&#1114112;d'), 'abcd');
  assert.equal(decodeEntities('&unknown; &lt;'), '&unknown; <');
});

test('a streamed answer is complete only once its root closes', () => {
  assert.ok(isCompleteDocument('<Soundlist/>'));
  assert.ok(isCompleteDocument('<?xml version="1.0"?>\n<Soundlist />'));
  assert.ok(isCompleteDocument('<Soundlist><Sound index="1"/></Soundlist>\n'));
  assert.ok(!isCompleteDocument('<Soundlist><Sound index="1"/>'));
  assert.ok(!isCompleteDocument('<Soundlist><Sound index="1"/></Sound'));
  assert.ok(!isCompleteDocument('R-200'));
});

test('a broken XML answer is reported as unexpected', () => {
  assert.throws(() => parseAnswer('xml', '<Soundlist><Sound'), (error) => error.kind === 'unexpected');
  assert.throws(() => parseAnswer('xml', 'R-404'), (error) => error.kind === 'rejected');
});
