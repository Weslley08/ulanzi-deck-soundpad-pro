// Measures what the plugin costs the user's machine. Run before each release and put the numbers
// in the release notes: node scripts/measure.mjs [keys] [sounds] [idleSeconds]
// It runs against a fake host and a SIMULATED Soundpad, so it measures the plugin and not Ulanzi Studio
// or Soundpad. The pipe here is a Unix socket on Linux and macOS, and a named pipe only on Windows.
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { pluginDir, root } from './lib/project.mjs';

const KEYS = Number(process.argv[2] ?? 13);
const SOUNDS = Number(process.argv[3] ?? 500);
const IDLE_SECONDS = Number(process.argv[4] ?? 60);
const PLAYING_SECONDS = Math.min(IDLE_SECONDS, 20);
const manifest = JSON.parse(readFileSync(join(pluginDir, 'manifest.json'), 'utf8'));
const preload = (file) => pathToFileURL(join(root, 'test', 'support', file)).href;
const { SoundpadSimulator, makeSounds } = await import(preload('soundpad-sim.mjs'));
const { fileId, metaId } = await import(pathToFileURL(join(pluginDir, 'plugin', 'soundpad', 'identity.js')).href);

const CATEGORIES = 20;
const sim = new SoundpadSimulator({
  sounds: makeSounds(SOUNDS),
  categories: Array.from({ length: CATEGORIES }, (_, c) => ({
    name: `Category ${c + 1}`,
    sounds: Array.from({ length: Math.ceil(SOUNDS / CATEGORIES) }, (_, i) => c * Math.ceil(SOUNDS / CATEGORIES) + i + 1).filter((p) => p <= SOUNDS),
  })),
});
const simPath = await sim.listen();

const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
await once(server, 'listening');

let socket;
let images = 0;
let bytes = 0;
let connected;
const ready = new Promise((resolve) => { connected = resolve; });
server.on('connection', (client) => {
  socket = client;
  client.on('message', (raw) => {
    const message = JSON.parse(raw);
    const data = message.cmd === 'state' ? message.param?.statelist?.[0]?.data : null;
    if (data) {
      images += 1;
      bytes += data.length;
    }
  });
  connected();
});

const send = (message) => socket.send(JSON.stringify(message));
const MB = (value) => `${(value / 1024 / 1024).toFixed(1)} MB`;
const uuid = (name) => `${manifest.UUID}.${name}`;

const plugin = fork(join(pluginDir, 'plugin', 'app.js'), ['127.0.0.1', String(server.address().port), 'en'], {
  execArgv: ['--import', preload('fake-pipe.mjs'), '--import', preload('metrics.mjs')],
  stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  env: { ...process.env, SOUNDPAD_SIM_PATH: simPath },
});
const metrics = async () => {
  plugin.send('metrics');
  const [reply] = await once(plugin, 'message');
  return reply;
};

/** Waits until at least `count` images arrived and no more are coming. */
async function settled(count, ms = 30_000) {
  const end = performance.now() + ms;
  let seen = images;
  let lastChange = performance.now();
  while (images < count || performance.now() - lastChange < 500) {
    if (performance.now() > end) throw new Error(`only ${images} of ${count} images arrived`);
    if (images !== seen) {
      seen = images;
      lastChange = performance.now();
    }
    await sleep(5);
  }
  return lastChange;
}

await ready;
await sleep(300);
const atStart = await metrics();

// A D200-like layout: favorites, each fixed on a sound as the panel saves it, and controls.
const favorite = (i) => {
  const sound = sim.sounds[i];
  return { soundId: fileId(sound.url), soundAlt: metaId(sound), soundIndex: i + 1, soundTitle: sound.title };
};
const layout = [
  ...Array.from({ length: Math.max(1, KEYS - 2) }, (_, i) => ({ action: 'sound', param: favorite(i), key: `f${i}` })),
  { action: 'control', param: { action: 'stop' }, key: 'c1' },
  { action: 'control', param: { action: 'volumeUp' }, key: 'c2' },
].slice(0, Math.max(KEYS, 5));
const keyOf = ({ action, key }) => ({ uuid: uuid(action), key, actionid: key });

const startedAt = performance.now();
for (const entry of layout) send({ cmd: 'add', ...keyOf(entry), param: entry.param });
const firstPaint = (await settled(layout.length)) - startedAt;
await sleep(500);
const afterRender = await metrics();
const imageSize = bytes / images;
const commandsAtRender = sim.log.length;

await sleep(IDLE_SECONDS * 1000);
const afterIdle = await metrics();
const commandsWhileIdle = sim.log.length - commandsAtRender;

const favorites = layout.filter((entry) => entry.action === 'sound').length;
// Presses that play: each one checks the sound is still where it was before playing it.
const presses = 30;
const beforePresses = await metrics();
const pressStart = performance.now();
for (let i = 0; i < presses; i += 1) {
  send({ cmd: 'run', ...keyOf(layout.find((entry) => entry.key === `f${i % favorites}`)) });
  await sleep(50);
}
const pressSpan = performance.now() - pressStart;
await settled(0);
const afterPresses = await metrics();

// While something plays, the state is polled so the keys can turn green, yellow and back.
sim.playMs = 0;
sim.status = 'PLAYING';
await sleep(1000);
const playingStart = await metrics();
const commandsAtPlaying = sim.log.length;
await sleep(PLAYING_SECONDS * 1000);
const playingEnd = await metrics();
const pollsPerSecond = (sim.log.length - commandsAtPlaying) / PLAYING_SECONDS;
sim.status = 'STOPPED';

// Clearing every key must close the pipe and stop every timer.
send({ cmd: 'clear', param: layout.map(keyOf) });
await sleep(1500);
const connectionsAfterClear = sim.connections;
const afterClear = await metrics();
const commandsAfterClear = sim.log.length;
await sleep(3000);
const commandsWhileEmpty = sim.log.length - commandsAfterClear;

plugin.kill();
for (const client of server.clients) client.terminate();
server.close();
await sim.close();

const cpuPercent = (from, to, ms) => (((to.cpuMs - from.cpuMs) / ms) * 100).toFixed(2);

console.log(`Node ${process.version} on ${process.platform}, ${layout.length} keys, ${SOUNDS} sounds in ${CATEGORIES} categories, simulated Soundpad`);
console.log(`Memory at start, no keys    ${MB(atStart.rss)}`);
console.log(`Memory with keys drawn      ${MB(afterRender.rss)} (heap ${MB(afterRender.heapUsed)}, WASM and buffers ${MB(afterRender.external)})`);
console.log(`Memory after ${IDLE_SECONDS} s idle       ${MB(afterIdle.rss)}`);
console.log(`Memory after all keys left  ${MB(afterClear.rss)}`);
console.log(`CPU idle                    ${cpuPercent(afterRender, afterIdle, IDLE_SECONDS * 1000)}% of one core, ${commandsWhileIdle} Soundpad requests in ${IDLE_SECONDS} s`);
console.log(`CPU while a sound plays     ${cpuPercent(playingStart, playingEnd, PLAYING_SECONDS * 1000)}% of one core, ${pollsPerSecond.toFixed(1)} status requests a second`);
console.log(`First paint of every key    ${firstPaint.toFixed(0)} ms, ${(afterRender.cpuMs - atStart.cpuMs).toFixed(0)} ms of CPU`);
console.log(`One press that plays        ${((afterPresses.cpuMs - beforePresses.cpuMs) / presses).toFixed(1)} ms of CPU, ${(pressSpan / presses).toFixed(0)} ms apart`);
console.log(`Image sent per key          ${(imageSize / 1024).toFixed(1)} KB`);
console.log(`After every key left        ${connectionsAfterClear} pipe connections, ${commandsWhileEmpty} requests in 3 s`);
