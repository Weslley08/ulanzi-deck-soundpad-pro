// Settings come from the host and the panel as loose values, and may predate this version.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GlobalStore, SAVE_DELAY_MS } from '../com.ulanzi.soundpadpro.ulanziPlugin/plugin/global-store.js';
import {
  flag, groupId, normalizeControlSettings, normalizeGlobalSettings, normalizeGroupOptions, normalizeNavSettings, normalizeNavState,
  normalizeSlotSettings, normalizeSoundSettings, soundRef,
} from '../com.ulanzi.soundpadpro.ulanziPlugin/plugin/settings.js';
import { ManualTimers } from './support/manual-timers.mjs';

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

test('a navigator key keeps to its group, its position within limits', () => {
  assert.deepEqual(normalizeSlotSettings({ group: ' Memes 2 ', position: '40' }), { group: 'Memes 2', position: 1, background: 'black', showTitle: true });
  assert.equal(normalizeSlotSettings({ position: 32 }).position, 32);
  assert.equal(groupId('<script>'), 'A');
  assert.equal(groupId(''), 'A');
  assert.equal(normalizeNavSettings({ function: 'rm -rf' }).function, 'nextPage');
  assert.equal(normalizeControlSettings({ action: 'record' }).action, 'stop');
  assert.equal(normalizeControlSettings({ output: 'default' }).output, 'both', 'random has no "as in Soundpad" choice');
});

test('group options and saved places are checked', () => {
  assert.deepEqual(normalizeGroupOptions({ positions: '99', startPage: 0, startCategory: 'evil', persist: 'off' }), {
    positions: 0, startCategory: '', startPage: 1, persist: false, output: 'both', mode: 'pause',
  });
  assert.deepEqual(normalizeNavState({ mode: 'sounds', category: '' }), { mode: 'categories', category: '', page: 0 });
  assert.deepEqual(normalizeNavState({ mode: 'sounds', category: 'all', page: 3 }), { mode: 'sounds', category: 'all', page: 3 });
});

test('global settings keep only well-formed groups, a limited number of them', () => {
  const raw = { groups: { A: { positions: 4 }, 'bad id!': {}, B: 'nope' }, nav: { A: { mode: 'sounds', category: 'all' } }, apiKey: 'x', __proto__: { polluted: true } };
  const clean = normalizeGlobalSettings(raw);
  assert.deepEqual(Object.keys(clean.groups), ['A']);
  assert.equal(clean.apiKey, undefined);
  assert.equal({}.polluted, undefined);
  const many = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`G${i}`, {}]));
  assert.equal(Object.keys(normalizeGlobalSettings({ groups: many }).groups).length, 32);
  assert.deepEqual(normalizeGlobalSettings(null), { groups: {}, nav: {} });
});

test('the store writes nothing before Studio has answered, so it never replaces saved settings with defaults', () => {
  const timers = new ManualTimers();
  const writes = [];
  const store = new GlobalStore({ write: (data, context) => writes.push([data, context]), context: () => 'ctx', onChange: () => {}, timers });
  store.saveNavState('A', { mode: 'sounds', category: 'all', page: 0 });
  store.flush();
  assert.equal(writes.length, 0);
  store.load({ groups: { A: { positions: 3 } } });
  store.saveNavState('A', { mode: 'sounds', category: 'all', page: 1 });
  assert.deepEqual(timers.delays, [SAVE_DELAY_MS]);
  store.saveNavState('A', { mode: 'sounds', category: 'all', page: 2 });
  assert.equal(timers.pending.size, 1, 'many page turns, one write');
  timers.fire(SAVE_DELAY_MS);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][1], 'ctx');
  assert.equal(writes[0][0].nav.A.page, 2);
  assert.equal(writes[0][0].groups.A.positions, 3, 'what was saved before is kept');
});

test('the store skips writes that change nothing, and gives up waiting for Studio', () => {
  const timers = new ManualTimers();
  const writes = [];
  const changes = [];
  const store = new GlobalStore({ write: (data) => writes.push(data), context: () => null, onChange: (data) => changes.push(data), timers });
  store.giveUp();
  assert.equal(store.known, true);
  assert.equal(changes.length, 1);
  store.setGroupOptions('A', { positions: 2 });
  store.setGroupOptions('A', { positions: 2 });
  assert.equal(changes.length, 2);
  store.saveNavState('B', null);
  timers.fire(0);
  assert.equal(writes.length, 0, 'no key on the deck, no context to write with');
  store.load({ groups: { A: { positions: 2 } } });
  store.dispose();
  assert.equal(timers.pending.size, 0);
});
