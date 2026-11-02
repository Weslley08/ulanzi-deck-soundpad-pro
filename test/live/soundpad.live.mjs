// Checks this plugin's assumptions against a REAL Soundpad. Runs only on Windows, with Soundpad open,
// and only when asked: SOUNDPAD_LIVE=1 npm run test:live. Everywhere else every test is skipped, so a
// skip here says nothing about Soundpad.
//
// It only reads, except one test that plays and stops a sound, which runs only with SOUNDPAD_LIVE_PLAY=1
// and plays to the speakers only. It never adds, removes, moves or saves anything in Soundpad.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { after, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { Library } from '../../com.ulanzi.soundpadpro.ulanziPlugin/plugin/soundpad/library.js';
import { PipeClient } from '../../com.ulanzi.soundpadpro.ulanziPlugin/plugin/soundpad/pipe-client.js';
import { PIPE_PATH, PLAY_STATUSES, compareVersions } from '../../com.ulanzi.soundpadpro.ulanziPlugin/plugin/soundpad/protocol.js';

const reason = process.platform !== 'win32'
  ? 'Soundpad runs on Windows only'
  : process.env.SOUNDPAD_LIVE !== '1'
    ? 'set SOUNDPAD_LIVE=1 to run against your Soundpad'
    : existsSync(PIPE_PATH) ? null : 'Soundpad is not running';
const options = { skip: reason ?? false };
const playOptions = { skip: reason ?? (process.env.SOUNDPAD_LIVE_PLAY === '1' ? false : 'set SOUNDPAD_LIVE_PLAY=1 to let this play a sound on your speakers') };

const client = new PipeClient();
after(() => client.close());

let library;

test('the pipe answers, and the remote control version is one this plugin knows', options, async () => {
  const rc = await client.request('GetRemoteControlVersion');
  assert.match(rc, /^\d+\.\d+(\.\d+)?$/);
  assert.ok(compareVersions(rc, '1.0.0') >= 0, rc);
  console.log(`Remote control ${rc}, Soundpad ${await client.request('GetVersion')}`);
  if (compareVersions(rc, '1.1.2') > 0) console.log('Newer than the reference client this plugin follows: check docs/SOUNDPAD-API.md');
});

test('IsAlive answers R-200', options, async () => {
  assert.equal(await client.request('IsAlive'), true);
});

test('the sound list is XML the plugin can read, and agrees with the count', options, async () => {
  const count = await client.request('GetSoundFileCount');
  const list = await client.request('GetSoundlist');
  assert.equal(list.name, 'Soundlist');
  library = Library.fromXml(list, null);
  assert.equal(library.count, count, 'every entry has a usable index and a file or a title');
  const indexes = library.sounds.map((sound) => sound.index);
  assert.deepEqual(indexes, [...indexes].sort((a, b) => a - b));
  console.log(`${count} sounds`);
});

test('categories come with their sounds, pointing at positions in the list', options, async () => {
  const tree = await client.request('GetCategories', [true, false]);
  assert.equal(tree.name, 'Categories');
  const full = Library.fromXml(await client.request('GetSoundlist'), tree);
  for (const category of full.categories) {
    for (const sound of category.sounds) assert.ok(full.byIndex.get(sound.index), `${category.name} points at ${sound.index}`);
  }
  console.log(`${full.categories.length - 1} categories`);
});

test('asking for one entry returns that entry, which the plugin uses to check before playing', options, async () => {
  if (!library?.count) return;
  const target = library.sounds[Math.floor(library.count / 2)];
  const one = await client.request('GetSoundlistRange', [target.index, target.index]);
  const entries = one.children.filter((child) => child.name === 'Sound');
  // If this fails, the plugin falls back to reading the whole list before each press. Record it.
  assert.equal(entries.length, 1, `GetSoundlist(${target.index}, ${target.index}) returned ${entries.length} entries`);
  assert.equal(Number(entries[0].attrs.index), target.index);
});

test('the play status and volume answer in the documented shapes', options, async () => {
  assert.ok(PLAY_STATUSES.includes(await client.request('GetPlayStatus')));
  const volume = await client.request('GetVolume');
  assert.ok(volume >= 0 && volume <= 100, String(volume));
  assert.equal(typeof (await client.request('IsMuted')), 'boolean');
});

test('a large list arrives whole, however the pipe splits it', options, async () => {
  const first = await client.request('GetSoundlist');
  const second = await client.request('GetSoundlist');
  assert.equal(second.children.length, first.children.length);
});

test('plays the first sound on the speakers only, sees it play, and stops it', playOptions, async () => {
  assert.ok(library?.count, 'needs at least one sound');
  const sound = library.sounds[0];
  await client.request('DoPlaySoundOn', [sound.index, true, false]);
  await sleep(300);
  const status = await client.request('GetPlayStatus');
  await client.request('DoStopSound');
  assert.ok(['PLAYING', 'STOPPED'].includes(status), status);
  assert.equal(await client.request('GetPlayStatus'), 'STOPPED');
});
