// Settings come from the host and the panel as loose values, and may predate this version.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  flag, normalizeControlSettings, normalizeSoundSettings, soundRef,
} from '../com.ulanzi.soundpadpro.ulanziPlugin/plugin/settings.js';

const ID = 'a'.repeat(24);

test('an empty or broken favorite falls back to safe defaults', () => {
  assert.deepEqual(normalizeSoundSettings({}), {
    soundId: '', soundAlt: '', soundIndex: 0, soundTitle: '', label: '', icon: 'play', accent: 'white',
    output: 'both', mode: 'pause', background: 'black', showTitle: true,
  });
  const bad = normalizeSoundSettings({ soundId: '../x', soundAlt: 'zz', soundIndex: 'drop table', output: 'everywhere', mode: 'loop', icon: '<svg>', background: 'white', label: 'x'.repeat(200) });
  assert.equal(bad.soundId, '');
  assert.equal(bad.output, 'both');
  assert.equal(bad.mode, 'pause');
  assert.equal(bad.icon, 'play');
  assert.equal(bad.background, 'black');
  assert.equal(bad.label.length, 40);
  assert.equal(soundRef(bad), null);
});

test('a saved sound keeps its ids, a position only as a hint, and its title', () => {
  const settings = normalizeSoundSettings({ soundId: ID, soundAlt: 'b'.repeat(24), soundIndex: '7', soundTitle: ' Horn\n' });
  assert.deepEqual(soundRef(settings), { id: ID, alt: 'b'.repeat(24), index: 7 });
  assert.equal(settings.soundTitle, 'Horn');
  assert.equal(normalizeSoundSettings({ soundIndex: 7 }).soundIndex, 0, 'a position alone is never a sound');
});

test('checkboxes are read whatever shape they arrive in', () => {
  for (const value of [true, 'true', 'on', '1']) assert.equal(flag(value, false), true);
  for (const value of [false, 'false', 'off', '0']) assert.equal(flag(value, true), false);
  assert.equal(flag(undefined, true), true, 'a missing checkbox keeps its default');
});

test('control keys keep to their lists', () => {
  assert.equal(normalizeControlSettings({ action: 'record' }).action, 'stop');
  assert.equal(normalizeControlSettings({ output: 'default' }).output, 'both', 'random has no "as in Soundpad" choice');
});
