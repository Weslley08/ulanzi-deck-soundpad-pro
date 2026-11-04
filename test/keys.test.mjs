// What each kind of key shows and does, with the real service and the simulated Soundpad.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { handleInspectorMessage, librarySummary, searchSounds, soundRefFrom } from '../com.ulanzi.soundpadpro.ulanziPlugin/plugin/inspector-api.js';
import { HOLD_DELAY_MS, HOLD_MAX_MS, HOLD_REPEAT_MS, ControlKey } from '../com.ulanzi.soundpadpro.ulanziPlugin/plugin/keys/control-key.js';
import { SoundKey } from '../com.ulanzi.soundpadpro.ulanziPlugin/plugin/keys/sound-key.js';
import { PipeClient } from '../com.ulanzi.soundpadpro.ulanziPlugin/plugin/soundpad/pipe-client.js';
import { SoundpadService } from '../com.ulanzi.soundpadpro.ulanziPlugin/plugin/soundpad/service.js';
import { ManualTimers } from './support/manual-timers.mjs';
import { SoundpadSimulator, makeSounds } from './support/soundpad-sim.mjs';

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

function fakeHost() {
  return {
    icons: [],
    alerts: 0,
    panel: [],
    params: [],
    logs: [],
    setBaseDataIcon(context, data) { this.icons.push(data); },
    showAlert() { this.alerts += 1; },
    sendToPropertyInspector(payload) { this.panel.push(payload); },
    sendParamFromPlugin(settings) { this.params.push(settings); },
    logMessage(message) { this.logs.push(message); },
    t: (key) => `T:${key}`,
  };
}

async function setup(simOptions = {}) {
  const sim = new SoundpadSimulator({ sounds: makeSounds(8), categories: [{ name: 'Memes', sounds: [1, 2, 3] }], ...simOptions });
  const path = await sim.listen();
  const service = new SoundpadService({ client: new PipeClient({ path, retryBaseMs: 20, retryMaxMs: 40 }) });
  const host = fakeHost();
  const views = [];
  const render = async (view) => {
    views.push(view);
    return `data:image/png;base64,${Buffer.from(JSON.stringify(view)).toString('base64')}`;
  };
  const keys = [];
  const make = (Type, settings) => {
    const key = new Type(`ctx${keys.length}`, { host, service, render });
    key.updateSettings(settings);
    keys.push(key);
    return key;
  };
  cleanups.push(async () => {
    for (const key of keys) key.destroy();
    service.dispose();
    await sim.close();
  });
  const ready = async () => {
    for (let i = 0; i < 200 && !service.library; i += 1) await sleep(5);
    await sleep(10);
  };
  return { sim, service, host, views, make, ready };
}

test('a favorite shows a prompt until a sound is chosen, then the sound', async () => {
  const { make, ready, service } = await setup();
  const key = make(SoundKey, {});
  await ready();
  assert.equal(key.buildView().title, 'T:Choose a sound');
  const sound = service.library.sounds[1];
  key.updateSettings({ soundId: sound.id, soundAlt: sound.alt, soundIndex: sound.index, soundTitle: sound.title, icon: 'horn' });
  assert.deepEqual(key.buildView(), { background: 'black', accent: 'white', state: 'ready', symbol: 'horn', title: 'Sound 2', idle: true });
  key.updateSettings({ ...key.settings, label: 'Mine', showTitle: true });
  assert.equal(key.buildView().title, 'Mine');
  key.updateSettings({ ...key.settings, showTitle: false });
  assert.equal(key.buildView().title, '');
});

test('a favorite pressed again while it plays pauses, and resumes on the next press without an alert', async () => {
  const { make, ready, service, host } = await setup();
  make(SoundKey, {});
  await ready();
  const sound = service.library.sounds[0];
  const key = make(SoundKey, { soundId: sound.id, soundAlt: sound.alt, soundIndex: 1 });
  await key.run();
  assert.equal(key.buildView().state, 'playing');
  assert.equal(key.buildView().idle, undefined, 'the corner shows the playing mark instead');
  await key.run();
  assert.equal(key.buildView().state, 'paused');
  await key.run();
  assert.equal(key.buildView().state, 'playing');
  assert.equal(host.alerts, 0);
});

test('a favorite shows how far its sound has played, and nothing for another key', async () => {
  const { make, ready, service, sim } = await setup();
  make(SoundKey, {});
  await ready();
  const sound = service.library.sounds[0];
  const key = make(SoundKey, { soundId: sound.id, soundAlt: sound.alt, soundIndex: 1 });
  const other = make(SoundKey, { soundId: service.library.sounds[1].id, soundIndex: 2 });
  sim.positionMs = 5_000;
  await key.run();
  for (let i = 0; i < 40 && key.buildView().progress == null; i += 1) await sleep(25);
  assert.equal(key.buildView().progress, 25);
  assert.equal(other.buildView().progress, undefined);
  assert.equal(other.buildView().idle, true);
});

test('a favorite turns green while its sound plays, yellow when paused, and is green or yellow whatever else is set', async () => {
  const { make, ready, service } = await setup();
  make(SoundKey, {});
  await ready();
  const sound = service.library.sounds[0];
  const key = make(SoundKey, { soundId: sound.id, soundAlt: sound.alt, soundIndex: 1 });
  const other = make(SoundKey, { soundId: service.library.sounds[1].id, soundIndex: 2 });
  await key.run();
  assert.equal(key.buildView().state, 'playing');
  assert.equal(other.buildView().state, 'ready', 'only the key whose sound plays');
  await service.control('pause');
  assert.equal(key.buildView().state, 'paused');
});

test('a favorite whose sound is gone shows grey with its old name, and alerts on press', async () => {
  const { make, ready, service, sim, host } = await setup();
  make(SoundKey, {});
  await ready();
  const sound = service.library.sounds[3];
  const key = make(SoundKey, { soundId: sound.id, soundIndex: 4, soundTitle: 'Sound 4' });
  sim.removeSound(4);
  await service.refreshLibrary();
  assert.deepEqual([key.buildView().state, key.buildView().title], ['unavailable', 'Sound 4']);
  await key.run();
  assert.equal(host.alerts, 1);
  assert.equal(key.status().sound, 'missing');
});

test('a favorite saves where its sound moved to, so the panel and the hint stay right', async () => {
  const { make, ready, service, sim, host } = await setup();
  make(SoundKey, {});
  await ready();
  const sound = service.library.sounds[2];
  make(SoundKey, { soundId: sound.id, soundIndex: 3, soundTitle: 'Sound 3' });
  sim.addSound({ url: 'C:\\first.mp3', title: 'First' }, 0);
  await service.refreshLibrary();
  assert.equal(host.params.at(-1).soundIndex, 4);
  const count = host.params.length;
  service.requestSync();
  await sleep(300);
  assert.equal(host.params.length, count, 'nothing is saved when nothing moved');
});

test('every key turns red with a message when Soundpad closes', async () => {
  const { make, ready, service, sim, views } = await setup();
  const sound = make(SoundKey, {});
  await ready();
  const ref = service.library.sounds[0];
  sound.updateSettings({ soundId: ref.id, soundIndex: 1, soundTitle: ref.title });
  const control = make(ControlKey, { action: 'stop', showTitle: true });
  await sim.close();
  for (let i = 0; i < 100 && service.state === 'connected'; i += 1) await sleep(5);
  for (const key of [sound, control]) assert.equal(key.buildView().state, 'error', key.constructor.name);
  assert.equal(control.buildView().title, 'T:Soundpad closed');
  assert.ok(views.some((view) => view.state === 'error'));
});

test('holding a volume key moves it by ten at a steady pace, and letting go stops it', async () => {
  const { sim, service, host, ready } = await setup();
  const timers = new ManualTimers();
  const key = new ControlKey('hold', { host, service, render: async () => 'x', timers });
  key.updateSettings({ action: 'volumeUp' });
  cleanups.push(async () => key.destroy());
  await ready();
  for (let i = 0; i < 50 && !service.volume; i += 1) await sleep(5);
  await key.run();
  assert.equal(sim.volume, 71, 'a press is one step');
  key.pressStart();
  assert.deepEqual(timers.delays, [HOLD_DELAY_MS, HOLD_MAX_MS]);
  await timers.fire(HOLD_DELAY_MS);
  assert.equal(sim.volume, 80, 'holding moves to the next ten');
  assert.ok(timers.delays.includes(HOLD_REPEAT_MS));
  await timers.fire(HOLD_REPEAT_MS);
  assert.equal(sim.volume, 90);
  key.pressEnd();
  assert.equal(timers.pending.size, 0, 'releasing leaves nothing running');
  assert.equal(await timers.fire(HOLD_REPEAT_MS), 0);
  assert.equal(sim.volume, 90);
});

test('a hold ends by itself if the release never arrives, and other keys ignore holding', async () => {
  const { service, host, ready } = await setup();
  const timers = new ManualTimers();
  const key = new ControlKey('hold', { host, service, render: async () => 'x', timers });
  cleanups.push(async () => key.destroy());
  key.updateSettings({ action: 'volumeDown' });
  await ready();
  key.pressStart();
  await timers.fire(HOLD_DELAY_MS);
  await timers.fire(HOLD_MAX_MS);
  assert.equal(timers.pending.size, 0);
  key.updateSettings({ action: 'stop' });
  key.pressStart();
  assert.equal(timers.pending.size, 0, 'only volume keys react to holding');
  key.updateSettings({ action: 'volumeUp' });
  key.pressStart();
  key.setActive(false);
  assert.equal(timers.pending.size, 0, 'a hidden key stops holding');
});

test('control keys show the playback state and the volume', async () => {
  const { make, ready, service } = await setup();
  const stop = make(ControlKey, { action: 'stop' });
  const pause = make(ControlKey, { action: 'pause' });
  const volume = make(ControlKey, { action: 'volumeUp' });
  const mute = make(ControlKey, { action: 'mute' });
  await ready();
  for (let i = 0; i < 50 && !service.volume; i += 1) await sleep(5);
  assert.equal(stop.buildView().state, 'disabled');
  assert.equal(volume.buildView().badge, '70%');
  await service.playEntry(service.library.sounds[0]);
  assert.equal(stop.buildView().state, 'playing');
  await pause.run();
  assert.deepEqual([pause.buildView().state, pause.buildView().symbol], ['paused', 'play']);
  await mute.run();
  assert.deepEqual([mute.buildView().symbol, mute.buildView().state], ['mute', 'paused']);
  await volume.run();
  assert.equal(volume.buildView().badge, '71%');
  volume.updateSettings({ action: 'stop' });
  assert.equal(volume.buildView().badge, undefined);
});

test('an unsupported control alerts on press', async () => {
  const { make, ready, host } = await setup({ rcVersion: '1.0.0' });
  const key = make(ControlKey, { action: 'random' });
  await ready();
  await key.run();
  assert.equal(host.alerts, 1);
});

test('an unchanged face is drawn once, and a hidden key draws nothing until shown', async () => {
  const { make, ready, host } = await setup();
  const key = make(ControlKey, { action: 'random' });
  await ready();
  await key.render();
  const sent = host.icons.length;
  await key.render();
  await key.render();
  assert.equal(host.icons.length, sent);
  key.setActive(false);
  key.updateSettings({ action: 'stop' });
  await sleep(20);
  assert.equal(host.icons.length, sent);
  key.setActive(true);
  await sleep(20);
  assert.equal(host.icons.length, sent + 1);
});

test('the panel API searches by words in any order, without accents or case, and caps the results', async () => {
  const sim = new SoundpadSimulator({ sounds: [{ url: 'C:\\a.mp3', title: 'Ação Épica', artist: 'Banda' }, { url: 'C:\\b.mp3', title: 'Outra' }, ...makeSounds(300)] });
  const { Library } = await import('../com.ulanzi.soundpadpro.ulanziPlugin/plugin/soundpad/library.js');
  const { parseXml } = await import('../com.ulanzi.soundpadpro.ulanziPlugin/plugin/soundpad/xml.js');
  const library = Library.fromXml(parseXml(sim.answer('GetSoundlist()')), null);
  assert.deepEqual(searchSounds(library, { q: 'epica acao' }).items.map((item) => item.title), ['Ação Épica']);
  assert.deepEqual(searchSounds(library, { q: 'banda' }).items.map((item) => item.title), ['Ação Épica']);
  const all = searchSounds(library, { q: '' });
  assert.equal(all.total, 302);
  assert.equal(all.items.length, 200);
  assert.equal(searchSounds(library, { q: 'x', category: 'c<script>' }).category, 'all');
  assert.equal(searchSounds(null, {}).ready, false);
  assert.equal(librarySummary(null).ready, false);
  assert.equal(soundRefFrom({ id: 'x'.repeat(24) }), null);
  assert.deepEqual(soundRefFrom({ id: 'a'.repeat(24), index: 'x' }), { id: 'a'.repeat(24), alt: '', index: 0 });
});

test('the panel API answers hello, refresh, reconnect and preview, and ignores the rest', async () => {
  const { make, ready, host, service, sim } = await setup();
  const key = make(SoundKey, {});
  await ready();
  const deps = { service, version: '9.9.9' };
  await handleInspectorMessage(key, { type: 'hello' }, deps);
  assert.deepEqual(host.panel.slice(-3).map((m) => m.type), ['status', 'about', 'library']);
  await handleInspectorMessage(key, { type: 'refresh' }, deps);
  await handleInspectorMessage(key, { type: 'reconnect' }, deps);
  const sound = service.library.sounds[4];
  await handleInspectorMessage(key, { type: 'preview', id: sound.id, alt: sound.alt, index: sound.index }, deps);
  assert.deepEqual(sim.lastOutput, { speakers: true, mic: false }, 'previews never go to the microphone');
  await handleInspectorMessage(key, { type: 'stopPreview' }, deps);
  assert.equal(sim.status, 'STOPPED');
  await handleInspectorMessage(key, { type: 'search', q: 'Sound 5' }, deps);
  assert.equal(host.panel.at(-1).type, 'sounds');
  const count = host.panel.length;
  await handleInspectorMessage(key, { type: 'toString' }, deps);
  await handleInspectorMessage(key, null, deps);
  await handleInspectorMessage(key, { type: 'preview', id: 'bad' }, deps);
  assert.equal(host.panel.length, count);
});
