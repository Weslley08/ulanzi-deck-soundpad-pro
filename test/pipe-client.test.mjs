// The shared connection, against the simulated Soundpad over a real pipe or socket.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { PipeClient, connectFailureReason } from '../com.ulanzi.soundpad.ulanziPlugin/plugin/soundpad/pipe-client.js';
import { SoundpadError } from '../com.ulanzi.soundpad.ulanziPlugin/plugin/soundpad/protocol.js';
import { SoundpadSimulator, makeSounds, simPath } from './support/soundpad-sim.mjs';

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

async function setup(options = {}, clientOptions = {}) {
  const sim = new SoundpadSimulator(options);
  const path = await sim.listen();
  const client = new PipeClient({ path, retryBaseMs: 20, retryMaxMs: 80, ...clientOptions });
  cleanups.push(async () => {
    client.setWanted(false);
    client.close();
    await sim.close();
  });
  return { sim, client, path };
}

const isKind = (kind) => (error) => error instanceof SoundpadError && error.kind === kind;

test('connects, sends a command and reads its answer', async () => {
  const { sim, client } = await setup();
  assert.equal(await client.request('GetRemoteControlVersion'), '1.1.2');
  assert.equal(await client.request('GetSoundFileCount'), 6);
  assert.equal(client.state, 'open');
  assert.deepEqual(sim.log, ['GetRemoteControlVersion()', 'GetSoundFileCount()']);
});

test('one connection carries every request, one at a time and in order', async () => {
  const { sim, client } = await setup({ delayMs: 5 });
  const answers = await Promise.all([
    client.request('GetSoundFileCount'),
    client.request('GetPlayStatus'),
    client.request('GetVolume'),
    client.request('IsMuted'),
  ]);
  assert.deepEqual(answers, [6, 'STOPPED', 70, false]);
  assert.equal(sim.connections, 1);
  assert.deepEqual(sim.log, ['GetSoundFileCount()', 'GetPlayStatus()', 'GetVolume()', 'IsMuted()']);
});

test('a press jumps ahead of a slow list download', async () => {
  const { sim, client } = await setup();
  await client.request('IsAlive');
  sim.fault('GetSoundlist', 'delay', { ms: 120 });
  const list = client.request('GetSoundlist');
  const count = client.request('GetSoundFileCount');
  const press = client.request('DoPlaySoundOn', [2, true, true], { urgent: true });
  await Promise.all([list, count, press]);
  assert.deepEqual(sim.log.slice(1), ['GetSoundlist()', 'DoPlaySound(2, true, true)', 'GetSoundFileCount()']);
});

test('a large answer delivered in pieces is read whole, including split characters', async () => {
  const sounds = makeSounds(1500).map((sound, i) => ({ ...sound, title: `Som número ${i + 1} 🔊 ação` }));
  const { client } = await setup({ sounds, chunkSize: 4093 });
  const list = await client.request('GetSoundlist');
  assert.equal(list.children.length, 1500);
  assert.equal(list.children[1499].attrs.title, 'Som número 1500 🔊 ação');
});

test('NUL padding after an answer is ignored', async () => {
  const { client } = await setup({ nulTerminate: true });
  assert.equal(await client.request('DoStopSound'), true);
  assert.equal((await client.request('GetSoundlist')).children.length, 6);
});

test('a missing answer times out, and the connection is replaced so a late answer cannot be misread', async () => {
  const { sim, client } = await setup();
  await client.request('IsAlive');
  sim.fault('GetPlayStatus', 'silence');
  await assert.rejects(client.request('GetPlayStatus', [], { timeoutMs: 80 }), isKind('timeout'));
  assert.equal(client.state, 'closed');
  assert.equal(await client.request('GetSoundFileCount'), 6);
  assert.equal(client.state, 'open');
});

test('requests queued behind a timeout fail instead of reading the wrong answer', async () => {
  const { sim, client } = await setup();
  await client.request('IsAlive');
  sim.fault('GetVolume', 'silence');
  const stuck = client.request('GetVolume', [], { timeoutMs: 60 });
  const behind = client.request('GetSoundFileCount');
  await assert.rejects(stuck, isKind('timeout'));
  await assert.rejects(behind, isKind('closed'));
});

test('garbage is reported as unexpected without breaking the next request', async () => {
  const { sim, client } = await setup();
  sim.fault('GetPlayStatus', 'garbage');
  await assert.rejects(client.request('GetPlayStatus'), isKind('unexpected'));
  assert.equal(await client.request('GetPlayStatus'), 'STOPPED');
});

test('an error code is a rejection with its code', async () => {
  const { sim, client } = await setup();
  sim.fault('DoPlaySound', 'reject', { code: 404 });
  await assert.rejects(client.request('DoPlaySound', [1]), (error) => error.kind === 'rejected' && error.code === 404);
});

test('Soundpad closing mid-request fails that request, and the next one reconnects', async () => {
  const { sim, client } = await setup();
  sim.fault('GetSoundlist', 'close');
  await assert.rejects(client.request('GetSoundlist'), isKind('closed'));
  assert.equal(await client.request('GetSoundFileCount'), 6);
});

test('an answer nobody asked for drops the connection, since the conversation is out of step', async () => {
  const { sim, client } = await setup();
  await client.request('IsAlive');
  const closed = new Promise((resolve) => client.once('close', resolve));
  sim.sendRaw('R-200');
  assert.equal(await closed, 'unexpected');
  assert.equal(client.state, 'closed');
  assert.equal(await client.request('IsAlive'), true);
});

test('Soundpad not running is reported as offline, with a reason the panel can show', async () => {
  const client = new PipeClient({ path: simPath(), retryBaseMs: 20 });
  cleanups.push(() => client.close());
  await assert.rejects(client.request('IsAlive'), isKind('offline'));
  assert.equal(client.state, 'closed');
  assert.equal(client.lastFailure, 'not-running');
  assert.equal(connectFailureReason({ code: 'EBUSY' }), 'pipe-busy');
  assert.equal(connectFailureReason({ code: 'EACCES' }), 'denied');
  assert.equal(connectFailureReason({ code: 'ETIMEDOUT' }), 'timeout');
  assert.equal(connectFailureReason({ code: 'EWHATEVER' }), 'other');
});

test('while wanted, it keeps retrying with a growing wait up to a cap, and connects once Soundpad starts', async () => {
  const path = simPath();
  const client = new PipeClient({ path, retryBaseMs: 20, retryMaxMs: 60 });
  const waits = [];
  client.on('retry', ({ waitMs }) => waits.push(waitMs));
  const opened = new Promise((resolve) => client.once('open', resolve));
  client.setWanted(true);
  await sleep(250);
  assert.ok(waits.length >= 3, `${waits.length} retries`);
  assert.deepEqual(waits.slice(0, 3), [20, 40, 60]);
  assert.ok(waits.every((wait) => wait <= 60));
  const sim = new SoundpadSimulator();
  await sim.listen(path);
  cleanups.push(async () => {
    client.setWanted(false);
    await sim.close();
  });
  await opened;
  assert.equal(client.attempts, 0);
});

test('when nothing wants it, the connection closes and no retry stays scheduled', async () => {
  const { sim, client } = await setup();
  client.setWanted(true);
  await new Promise((resolve) => client.once('open', resolve));
  assert.equal(sim.connections, 1);
  client.setWanted(false);
  await sleep(30);
  assert.equal(client.state, 'closed');
  assert.equal(client.retryScheduled, false);
  assert.equal(sim.connections, 0);
});

test('a dropped connection is reopened at once while wanted', async () => {
  const { sim, client } = await setup();
  client.setWanted(true);
  await new Promise((resolve) => client.once('open', resolve));
  const reopened = new Promise((resolve) => client.once('open', resolve));
  sim.dropClients();
  await reopened;
  assert.equal(await client.request('IsAlive'), true);
});

test('closing while still connecting leaves nothing open', async () => {
  const { sim, client } = await setup();
  const opening = client.open();
  client.close();
  await assert.rejects(opening, isKind('stopped'));
  await sleep(30);
  assert.equal(sim.connections, 0);
  assert.equal(client.state, 'closed');
});

test('the queue has a limit', async () => {
  const { sim, client } = await setup();
  await client.request('IsAlive');
  sim.fault('GetVolume', 'delay', { ms: 100 });
  const many = Array.from({ length: 70 }, () => client.request('GetVolume').catch((error) => error));
  const results = await Promise.all(many);
  assert.ok(results.some((result) => result instanceof SoundpadError && result.kind === 'busy'));
});

test('a bad command never reaches the pipe', async () => {
  const { sim, client } = await setup();
  await assert.rejects(client.request('DoPlaySound', ['1); evil(']), TypeError);
  assert.deepEqual(sim.log, []);
});
