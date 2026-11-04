// Load: the real plugin with many keys and hundreds of sounds, against a fake Studio and the simulated
// Soundpad. The limits are generous on purpose, so a slow CI machine passes; they catch a regression
// such as a connection per key, a timer left running, or the WASM optimizer coming back.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { SoundpadSimulator, makeSounds } from './support/soundpad-sim.mjs';

const APP = fileURLToPath(new URL('../com.ulanzi.soundpadpro.ulanziPlugin/plugin/app.js', import.meta.url));
const preload = (name) => pathToFileURL(fileURLToPath(new URL(`./support/${name}`, import.meta.url))).href;
const PLUGIN_UUID = 'com.ulanzi.soundpadpro.ulanziPlugin';
const SOUNDS = 800;
const FAVORITES = 24;

let sim;
let server;
let plugin;
let socket;
let images = 0;

const send = (message) => socket.send(JSON.stringify(message));
const metrics = async () => {
  plugin.send('metrics');
  const [reply] = await once(plugin, 'message', { signal: AbortSignal.timeout(5000) });
  return reply;
};
const key = (action, id) => ({ uuid: `${PLUGIN_UUID}.${action}`, key: id, actionid: id });

before(async () => {
  sim = new SoundpadSimulator({
    sounds: makeSounds(SOUNDS),
    categories: Array.from({ length: 16 }, (_, c) => ({ name: `Category ${c}`, sounds: Array.from({ length: 50 }, (_, i) => c * 50 + i + 1) })),
  });
  const path = await sim.listen();
  server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const connected = new Promise((resolve) => {
    server.on('connection', (client) => {
      socket = client;
      client.on('message', (raw) => {
        const message = JSON.parse(raw);
        if (message.cmd === 'state') images += 1;
      });
      resolve();
    });
  });
  plugin = fork(APP, ['127.0.0.1', String(server.address().port), 'en'], {
    execArgv: ['--import', preload('fake-pipe.mjs'), '--import', preload('metrics.mjs')],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: { ...process.env, SOUNDPAD_SIM_PATH: path },
  });
  await connected;
});

after(async () => {
  plugin?.kill();
  for (const client of server?.clients ?? []) client.terminate();
  server?.close();
  await sim?.close();
});

const layout = [
  ...Array.from({ length: FAVORITES }, (_, i) => ({ ...key('sound', `f${i}`), param: {} })),
  { ...key('control', 'stop'), param: { action: 'stop' } },
];

test(`${layout.length} keys and ${SOUNDS} sounds share one connection and one read of the library`, async () => {
  for (const entry of layout) send({ cmd: 'add', ...entry });
  const end = Date.now() + 20_000;
  while (images < layout.length && Date.now() < end) await sleep(20);
  await sleep(1500);
  assert.ok(images >= layout.length, `${images} images for ${layout.length} keys`);
  assert.equal(sim.connections, 1);
  assert.equal(sim.countOf('GetSoundlist'), 1);
});

test('memory stays low once every key is drawn, because the WASM optimizer is off', async () => {
  // Without --liftoff-only this read about 160 MB on Linux; with it, under 90 MB.
  await sleep(3000);
  const { rss } = await metrics();
  assert.ok(rss < 130 * 1024 * 1024, `${(rss / 1048576).toFixed(0)} MB`);
});

test('idle, the plugin uses almost no CPU and asks Soundpad only on schedule', async () => {
  const before = await metrics();
  const requests = sim.log.length;
  await sleep(5000);
  const used = (await metrics()).cpuMs - before.cpuMs;
  assert.ok(used < 250, `${used.toFixed(0)} ms of CPU in 5 idle seconds`);
  // The stop key watches the playback state every 3 s; nothing else runs while idle.
  assert.ok(sim.log.length - requests <= 3, `${sim.log.length - requests} requests in 5 s`);
});

test('when every key leaves, the pipe closes and nothing runs', async () => {
  send({ cmd: 'clear', param: layout.map(({ uuid, key: id, actionid }) => ({ uuid, key: id, actionid })) });
  await sleep(1000);
  assert.equal(sim.connections, 0);
  const requests = sim.log.length;
  const before = await metrics();
  await sleep(3000);
  assert.equal(sim.log.length, requests);
  assert.ok((await metrics()).cpuMs - before.cpuMs < 100);
});
