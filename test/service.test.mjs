// The shared service: one connection, one library, playback that never plays the wrong sound.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { PipeClient } from '../com.ulanzi.soundpadpro.ulanziPlugin/plugin/soundpad/pipe-client.js';
import {
  COUNT_CHECK_MS, IDLE_POLL_MS, PLAYING_POLL_MS, SYNC_DEBOUNCE_MS, SoundpadService,
} from '../com.ulanzi.soundpadpro.ulanziPlugin/plugin/soundpad/service.js';
import { ManualTimers } from './support/manual-timers.mjs';
import { SoundpadSimulator, makeSounds, simPath } from './support/soundpad-sim.mjs';

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

async function setup(simOptions = {}) {
  const sim = new SoundpadSimulator(simOptions);
  const path = await sim.listen();
  const timers = new ManualTimers();
  const logs = [];
  const client = new PipeClient({ path, retryBaseMs: 20, retryMaxMs: 40 });
  const service = new SoundpadService({ client, timers, log: (line) => logs.push(line) });
  cleanups.push(async () => {
    service.dispose();
    await sim.close();
  });
  return { sim, service, timers, logs, client };
}

/** Subscribes like a key would, and waits until the library is in. */
async function connected(service, options = {}) {
  const changes = [];
  const sub = service.subscribe({ onChange: (what) => changes.push(what), ...options });
  for (let i = 0; i < 200 && !(service.state === 'connected' && service.library); i += 1) await sleep(5);
  assert.equal(service.state, 'connected');
  return { sub, changes };
}

const refOf = (sound) => ({ id: sound.id, alt: sound.alt, index: sound.index });

test('nothing connects until a key subscribes, and everything stops when the last one leaves', async () => {
  const { sim, service, timers } = await setup();
  await sleep(30);
  assert.equal(sim.connections, 0);
  assert.equal(service.state, 'disabled');
  const { sub } = await connected(service);
  assert.equal(sim.connections, 1);
  assert.ok(timers.delays.includes(COUNT_CHECK_MS));
  sub.close();
  await sleep(20);
  assert.equal(sim.connections, 0);
  assert.equal(timers.pending.size, 0, 'no timer may outlive its consumers');
  assert.equal(service.state, 'disabled');
  assert.equal(service.library, null);
});

test('the last key leaving in the middle of the handshake leaves no connection open', async () => {
  const { sim, service } = await setup({ delayMs: 15 });
  const sub = service.subscribe({});
  // The sync catches its own failure and the handshake goes on to its next request.
  for (let i = 0; i < 500 && sim.countOf('GetCategories') === 0; i += 1) await sleep(2);
  sub.close();
  await sleep(300);
  assert.equal(sim.connections, 0);
  assert.equal(service.state, 'disabled');
});

test('many keys share one connection and one read of the library', async () => {
  const { sim, service } = await setup({ sounds: makeSounds(300) });
  const subs = Array.from({ length: 24 }, () => service.subscribe({}));
  await connected(service);
  assert.equal(sim.connections, 1);
  assert.equal(sim.countOf('GetSoundlist'), 1);
  assert.equal(sim.countOf('GetCategories'), 1);
  assert.equal(service.library.count, 300);
  for (const sub of subs) sub.close();
});

test('the handshake reads the versions, and diagnostics hold no paths or titles', async () => {
  const { service } = await setup({ trial: true });
  await connected(service);
  const info = service.diagnostics();
  assert.equal(info.rcVersion, '1.1.2');
  assert.equal(info.version, '4.0.35');
  assert.equal(info.trial, true);
  assert.equal(info.sounds, 6);
  assert.doesNotMatch(JSON.stringify(info), /Users|Sound 1|\.mp3/);
});

test('a press plays the saved sound on the chosen outputs', async () => {
  const { sim, service } = await setup();
  await connected(service);
  const sound = service.library.sounds[2];
  const played = await service.playSound(refOf(sound), { output: 'mic' });
  assert.equal(played.result, 'played');
  assert.equal(sim.current, 3);
  assert.deepEqual(sim.lastOutput, { speakers: false, mic: true });
  assert.equal(service.playStatus, 'PLAYING');
  assert.equal(service.nowPlaying.id, sound.id);
  await service.playSound(refOf(sound), { output: 'default' });
  assert.equal(sim.lastOutput, 'default', "Soundpad's own output setting");
  await service.playSound(refOf(sound), { output: 'both' });
  assert.deepEqual(sim.lastOutput, { speakers: true, mic: true });
});

test('after sounds are added in front, a press plays the same sound at its new position', async () => {
  const { sim, service } = await setup();
  await connected(service);
  const saved = refOf(service.library.sounds[1]);
  sim.addSound({ url: 'C:\\new-a.mp3', title: 'New A' }, 0);
  sim.addSound({ url: 'C:\\new-b.mp3', title: 'New B' }, 0);
  const played = await service.playSound(saved);
  assert.equal(played.result, 'played');
  assert.equal(sim.sounds[sim.current - 1].title, 'Sound 2');
  assert.equal(sim.current, 4);
});

test('after a reorder, the one-entry check notices and the right sound plays', async () => {
  const { sim, service } = await setup();
  await connected(service);
  const saved = refOf(service.library.sounds[0]);
  sim.moveSound(1, 6);
  const before = sim.countOf('GetSoundlist');
  const played = await service.playSound(saved);
  assert.equal(played.result, 'played');
  assert.equal(sim.sounds[sim.current - 1].title, 'Sound 1');
  assert.ok(sim.countOf('GetSoundlist') > before + 1, 'read the list again after the mismatch');
});

test('a deleted sound never plays whatever took its position', async () => {
  const { sim, service } = await setup();
  await connected(service);
  const saved = refOf(service.library.sounds[1]);
  sim.removeSound(2);
  const played = await service.playSound(saved);
  assert.equal(played.result, 'missing');
  assert.equal(sim.countOf('DoPlaySound'), 0);
  assert.equal(sim.status, 'STOPPED');
});

test('when Soundpad cannot answer the one-entry check, only a freshly read list is trusted', async () => {
  const { sim, service, logs } = await setup({ rangeSupported: false });
  await connected(service);
  const saved = refOf(service.library.sounds[3]);
  sim.moveSound(4, 1);
  const played = await service.playSound(saved);
  assert.equal(played.result, 'played');
  assert.equal(sim.sounds[sim.current - 1].title, 'Sound 4');
  assert.ok(logs.some((line) => line.includes('one-entry check not available')));
});

test('toggle mode stops the sound when its own key is pressed again', async () => {
  const { sim, service } = await setup();
  await connected(service);
  const ref = refOf(service.library.sounds[0]);
  assert.equal((await service.playSound(ref, { mode: 'toggle' })).result, 'played');
  assert.equal((await service.playSound(ref, { mode: 'toggle' })).result, 'stopped');
  assert.equal(sim.status, 'STOPPED');
  assert.equal(service.nowPlaying, null);
  assert.equal((await service.playSound(ref, { mode: 'toggle' })).result, 'played');
});

test('toggle mode plays again once the sound has ended by itself', async () => {
  const { sim, service } = await setup();
  await connected(service);
  const ref = refOf(service.library.sounds[0]);
  await service.playSound(ref, { mode: 'toggle' });
  sim.status = 'STOPPED';
  assert.equal((await service.playSound(ref, { mode: 'toggle' })).result, 'played');
});

test('restart mode stops what is playing before starting', async () => {
  const { sim, service } = await setup();
  await connected(service);
  await service.playSound(refOf(service.library.sounds[0]));
  const at = sim.log.length;
  await service.playSound(refOf(service.library.sounds[1]), { mode: 'restart' });
  const after = sim.log.slice(at);
  assert.ok(after.indexOf('DoStopSound()') < after.findIndex((line) => line.startsWith('DoPlaySound(')));
});

test('playback status is polled only while something plays, and stops when it ends', async () => {
  const { sim, service, timers } = await setup();
  await connected(service);
  assert.ok(!timers.delays.includes(PLAYING_POLL_MS));
  await service.playSound(refOf(service.library.sounds[0]));
  assert.ok(timers.delays.includes(PLAYING_POLL_MS));
  sim.status = 'STOPPED';
  await timers.fire(PLAYING_POLL_MS);
  assert.equal(service.playStatus, 'STOPPED');
  assert.ok(!timers.delays.includes(PLAYING_POLL_MS), 'polling stops when nothing plays');
});

test('a hidden deck stops polling, and showing it again resumes', async () => {
  const { service, timers } = await setup();
  const { sub } = await connected(service);
  await service.playSound(refOf(service.library.sounds[0]));
  sub.setActive(false);
  assert.equal(timers.pending.size, 0);
  sub.setActive(true);
  assert.ok(timers.delays.includes(PLAYING_POLL_MS));
  assert.ok(timers.delays.includes(COUNT_CHECK_MS));
});

test('a key showing pause or stop polls slowly even when nothing plays', async () => {
  const { service, timers } = await setup();
  await connected(service, { wantsStatus: true });
  assert.ok(timers.delays.includes(IDLE_POLL_MS));
});

test('a sound added in Soundpad is noticed by the count check, and the list is read once', async () => {
  const { sim, service, timers } = await setup();
  const { changes } = await connected(service);
  await timers.fire(COUNT_CHECK_MS);
  assert.ok(!timers.delays.includes(SYNC_DEBOUNCE_MS), 'an unchanged count asks for nothing more');
  sim.addSound({ url: 'C:\\added.mp3', title: 'Added' });
  await timers.fire(COUNT_CHECK_MS);
  await timers.fire(SYNC_DEBOUNCE_MS);
  for (let i = 0; i < 50 && service.library.count !== 7; i += 1) await sleep(5);
  assert.equal(service.library.count, 7);
  assert.ok(changes.includes('library'));
});

test('several requests to sync in a row read the list once', async () => {
  const { sim, service, timers } = await setup();
  await connected(service);
  const before = sim.countOf('GetSoundlist');
  service.requestSync();
  service.requestSync();
  service.requestSync();
  assert.equal(await timers.fire(SYNC_DEBOUNCE_MS), 1);
  await sleep(30);
  assert.equal(sim.countOf('GetSoundlist'), before + 1);
});

test('the manual refresh cannot be hammered', async () => {
  const { sim, service } = await setup();
  await connected(service);
  const before = sim.countOf('GetSoundlist');
  await service.refreshLibrary();
  await service.refreshLibrary();
  await service.refreshLibrary();
  assert.equal(sim.countOf('GetSoundlist'), before + 1);
});

test('an unchanged list does not tell keys to redraw', async () => {
  const { service } = await setup();
  const { changes } = await connected(service);
  changes.length = 0;
  await service.refreshLibrary();
  assert.ok(!changes.includes('library'));
});

test('Soundpad closing marks the keys offline, and it comes back and reads the list again by itself', async () => {
  const { sim, service } = await setup();
  const { changes } = await connected(service);
  const reads = sim.countOf('GetSoundlist');
  await sim.close();
  for (let i = 0; i < 100 && service.state === 'connected'; i += 1) await sleep(5);
  assert.equal(service.state, 'offline');
  assert.ok(changes.includes('connection'));
  assert.ok(service.library, 'the last list stays for the keys to show');
  await sim.listen(sim.path);
  for (let i = 0; i < 200 && service.state !== 'connected'; i += 1) await sleep(10);
  for (let i = 0; i < 100 && sim.countOf('GetSoundlist') === 0; i += 1) await sleep(5);
  assert.equal(service.state, 'connected');
  assert.ok(sim.countOf('GetSoundlist') >= 1, `read ${reads} times before`);
});

test('a press while Soundpad is closed is reported offline, without waiting for the retry', async () => {
  const path = simPath();
  const timers = new ManualTimers();
  const service = new SoundpadService({ client: new PipeClient({ path, retryBaseMs: 10_000 }), timers });
  cleanups.push(() => service.dispose());
  service.subscribe({});
  await sleep(30);
  const start = performance.now();
  assert.equal((await service.playSound({ id: 'a'.repeat(24), alt: '', index: 1 })).result, 'offline');
  assert.ok(performance.now() - start < 1500);
  assert.equal(service.diagnostics().lastError, 'not-running');
  assert.equal((await service.control('stop')).result, 'offline');
});

test('an older Soundpad without categories still works with the whole list', async () => {
  const { sim, service } = await setup({ rcVersion: '1.0.0', categories: [{ name: 'X', sounds: [1] }] });
  await connected(service);
  assert.equal(sim.countOf('GetCategories'), 0);
  assert.equal(service.library.categories.length, 1);
  assert.equal(service.diagnostics().categoriesSupported, false);
  assert.equal((await service.control('random')).result, 'unsupported');
});

test('playback controls send the matching command', async () => {
  const { sim, service } = await setup();
  await connected(service);
  await service.playSound(refOf(service.library.sounds[1]));
  assert.equal((await service.control('pause')).result, 'done');
  assert.equal(sim.status, 'PAUSED');
  assert.equal(service.playStatus, 'PAUSED');
  await service.control('pause');
  assert.equal(sim.status, 'PLAYING');
  await service.control('next');
  assert.equal(sim.current, 3);
  await service.control('previous');
  assert.equal(sim.current, 2);
  await service.control('replay');
  assert.equal(sim.current, 2);
  await service.control('random', { output: 'speakers' });
  assert.deepEqual(sim.lastOutput, { speakers: true, mic: false });
  await service.control('stop');
  assert.equal(sim.status, 'STOPPED');
  assert.equal((await service.control('explode')).result, 'unsupported');
});

test('volume moves in steps within 0 to 100, and mute toggles', async () => {
  const { sim, service } = await setup();
  await connected(service, { wantsVolume: true });
  for (let i = 0; i < 50 && !service.volume; i += 1) await sleep(5);
  assert.deepEqual(service.volume, { volume: 70, muted: false });
  await service.control('volumeUp');
  assert.equal(sim.volume, 80);
  sim.volume = 97;
  await service.control('volumeUp');
  assert.equal(sim.volume, 100);
  sim.volume = 4;
  await service.control('volumeDown');
  assert.equal(sim.volume, 0);
  await service.control('mute');
  assert.equal(sim.muted, true);
  assert.equal(service.volume.muted, true);
});

test('a refused command is reported as a failure with its code', async () => {
  const { sim, service } = await setup();
  await connected(service);
  sim.fault('DoStopSound', 'reject', { code: 500 });
  assert.equal((await service.control('stop')).result, 'failed');
  assert.equal(service.diagnostics().lastError, 'rejected-500');
});

test('dispose closes the pipe and leaves no timer', async () => {
  const { sim, service, timers } = await setup();
  await connected(service, { wantsStatus: true });
  await service.playSound(refOf(service.library.sounds[0]));
  service.dispose();
  await sleep(20);
  assert.equal(sim.connections, 0);
  assert.equal(timers.pending.size, 0);
});
