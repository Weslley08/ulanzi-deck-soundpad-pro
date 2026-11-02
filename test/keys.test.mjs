// What each kind of key shows and does, with the real service and the simulated Soundpad.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { handleInspectorMessage, librarySummary, searchSounds, soundRefFrom } from '../com.ulanzi.soundpadpro.ulanziPlugin/plugin/inspector-api.js';
import { ControlKey } from '../com.ulanzi.soundpadpro.ulanziPlugin/plugin/keys/control-key.js';
import { NavKey } from '../com.ulanzi.soundpadpro.ulanziPlugin/plugin/keys/nav-key.js';
import { SlotKey } from '../com.ulanzi.soundpadpro.ulanziPlugin/plugin/keys/slot-key.js';
import { SoundKey } from '../com.ulanzi.soundpadpro.ulanziPlugin/plugin/keys/sound-key.js';
import { NavigationRegistry } from '../com.ulanzi.soundpadpro.ulanziPlugin/plugin/navigation.js';
import { PipeClient } from '../com.ulanzi.soundpadpro.ulanziPlugin/plugin/soundpad/pipe-client.js';
import { SoundpadService } from '../com.ulanzi.soundpadpro.ulanziPlugin/plugin/soundpad/service.js';
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
  let registry;
  const service = new SoundpadService({ client: new PipeClient({ path, retryBaseMs: 20, retryMaxMs: 40 }), beforeNotify: (what) => what === 'library' && registry?.libraryChanged() });
  registry = new NavigationRegistry({ library: () => service.library, onChange: () => {}, saveState: () => {} });
  const host = fakeHost();
  const views = [];
  const render = async (view) => {
    views.push(view);
    return `data:image/png;base64,${Buffer.from(JSON.stringify(view)).toString('base64')}`;
  };
  const keys = [];
  const make = (Type, settings) => {
    const key = new Type(`ctx${keys.length}`, { host, service, registry, render });
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
  return { sim, service, host, views, make, ready, registry };
}

test('a favorite shows a prompt until a sound is chosen, then the sound', async () => {
  const { make, ready, service } = await setup();
  const key = make(SoundKey, {});
  await ready();
  assert.equal(key.buildView().title, 'T:Choose a sound');
  const sound = service.library.sounds[1];
  key.updateSettings({ soundId: sound.id, soundAlt: sound.alt, soundIndex: sound.index, soundTitle: sound.title, icon: 'horn' });
  assert.deepEqual(key.buildView(), { background: 'black', accent: 'white', state: 'ready', symbol: 'horn', title: 'Sound 2' });
  key.updateSettings({ ...key.settings, label: 'Mine', showTitle: true });
  assert.equal(key.buildView().title, 'Mine');
  key.updateSettings({ ...key.settings, showTitle: false });
  assert.equal(key.buildView().title, '');
});

test('a favorite turns green while its sound plays, yellow when paused, and stays white without feedback', async () => {
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
  key.updateSettings({ ...key.settings, feedback: false });
  assert.equal(key.buildView().state, 'ready');
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
  const slot = make(SlotKey, { group: 'A', position: 1 });
  const nav = make(NavKey, { group: 'A', function: 'refresh' });
  await sim.close();
  for (let i = 0; i < 100 && service.state === 'connected'; i += 1) await sleep(5);
  for (const key of [sound, control, slot, nav]) assert.equal(key.buildView().state, 'error', key.constructor.name);
  assert.equal(control.buildView().title, 'T:Soundpad closed');
  assert.ok(views.some((view) => view.state === 'error'));
});

test('a navigator position opens a category and then plays its sounds', async () => {
  const { make, ready, sim } = await setup();
  const slot1 = make(SlotKey, { group: 'A', position: 1 });
  const slot2 = make(SlotKey, { group: 'A', position: 2 });
  await ready();
  assert.equal(slot1.buildView().title, 'T:All sounds');
  assert.equal(slot2.buildView().title, 'Memes');
  assert.equal(slot2.buildView().badge, '3');
  await slot2.run();
  assert.equal(slot1.buildView().title, 'Sound 1');
  await slot1.run();
  assert.equal(sim.current, 1);
  assert.equal(slot1.buildView().state, 'playing');
  slot1.updateSettings({ ...slot1.settings, group: 'B' });
  assert.equal(slot1.buildView().title, 'T:All sounds', 'a key moved to another group follows that group');
});

test('navigation buttons look disabled when they cannot move, and show where they lead', async () => {
  const { make, ready } = await setup();
  make(SlotKey, { group: 'A', position: 1 });
  const next = make(NavKey, { group: 'A', function: 'nextPage' });
  const back = make(NavKey, { group: 'A', function: 'back' });
  const category = make(NavKey, { group: 'A', function: 'nextCategory' });
  await ready();
  assert.equal(back.buildView().state, 'disabled');
  assert.equal(next.buildView().badge, '1/2');
  assert.equal(category.buildView().title, 'T:All sounds');
  await category.run();
  assert.equal(back.buildView().state, 'ready');
  assert.equal(category.buildView().title, 'Memes');
  assert.equal(next.buildView().badge, '1/8');
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
  assert.equal(volume.buildView().badge, '80%');
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
  const deps = { service, store: { setGroupOptions: () => {} }, version: '9.9.9' };
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
