// Runs the real plugin and the real Ulanzi SDK against a fake Studio and the simulated Soundpad.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { SoundpadSimulator, makeSounds } from './support/soundpad-sim.mjs';

const APP = fileURLToPath(new URL('../com.ulanzi.soundpadpro.ulanziPlugin/plugin/app.js', import.meta.url));
const FAKE_PIPE = pathToFileURL(fileURLToPath(new URL('./support/fake-pipe.mjs', import.meta.url))).href;
const PLUGIN_UUID = 'com.ulanzi.soundpadpro.ulanziPlugin';
const action = (name) => `${PLUGIN_UUID}.${name}`;
const WAIT_MS = 8000;
const QUIET_MS = 400;

let server;
let plugin;
let socket;
let sim;
let received = [];
const everything = [];
let notify = () => {};
let output = '';

function waitFor(predicate, ms = WAIT_MS) {
  return new Promise((resolve, reject) => {
    const limit = setTimeout(() => {
      notify = () => {};
      reject(new Error(`no matching message in ${ms} ms; got: ${received.map((m) => `${m.cmd}:${m.payload?.type ?? ''}`).join(', ')}`));
    }, ms);
    const check = () => {
      const found = received.find(predicate);
      if (!found) return;
      clearTimeout(limit);
      notify = () => {};
      resolve(found);
    };
    notify = check;
    check();
  });
}

function send(message) {
  received = [];
  socket.send(JSON.stringify(message));
}

const keyMessage = (name, key, actionid, extra = {}) => ({ uuid: action(name), key, actionid, ...extra });
const iconFor = (key) => (m) => m.cmd === 'state' && m.param?.statelist?.[0]?.key === key;
const toPanel = (key, type) => (m) => m.cmd === 'sendToPropertyInspector' && m.key === key && m.payload?.type === type;
const until = async (condition, ms = WAIT_MS) => {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error('condition never became true');
    await sleep(10);
  }
};

async function startHost(port) {
  server = new WebSocketServer({ host: '127.0.0.1', port });
  await once(server, 'listening');
  server.on('connection', (client) => {
    socket = client;
    client.on('message', (data) => {
      const message = JSON.parse(data);
      received.push(message);
      everything.push(message);
      notify();
    });
  });
}

before(async () => {
  sim = new SoundpadSimulator({
    sounds: makeSounds(30),
    categories: [
      { name: 'Memes', sounds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      { name: 'Games', sounds: [11, 12, 13] },
      { name: 'Empty', sounds: [] },
    ],
  });
  const simPath = await sim.listen();
  await startHost(0);
  plugin = spawn(process.execPath, ['--import', FAKE_PIPE, APP, '127.0.0.1', String(server.address().port), 'pt_BR'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SOUNDPAD_SIM_PATH: simPath },
  });
  plugin.stdout.on('data', (chunk) => { output += chunk; });
  plugin.stderr.on('data', (chunk) => { output += chunk; });
  await waitFor((m) => m.cmd === 'connected');
});

after(async () => {
  plugin?.kill();
  for (const client of server?.clients ?? []) client.terminate();
  server?.close();
  await sim?.close();
});

test('announces the plugin, and does not touch Soundpad while no key is on the deck', async () => {
  const connected = everything.find((m) => m.cmd === 'connected');
  assert.equal(connected.uuid, PLUGIN_UUID);
  await sleep(QUIET_MS);
  assert.equal(sim.log.length, 0);
  assert.equal(sim.connections, 0);
});

test('the first key asks for the global settings with its context, and connects to Soundpad once', async () => {
  send({ cmd: 'add', ...keyMessage('sound', '0_0', 'a1', { param: {} }) });
  const ask = await waitFor((m) => m.cmd === 'getGlobalSettings');
  assert.deepEqual([ask.uuid, ask.key, ask.actionid], [action('sound'), '0_0', 'a1']);
  send({ cmd: 'didReceiveGlobalSettings', uuid: PLUGIN_UUID, key: '', actionid: '', settings: {} });
  await waitFor(iconFor('0_0'));
  await until(() => sim.countOf('GetSoundlist') === 1);
  assert.equal(sim.connections, 1);
  assert.match(everything.filter(iconFor('0_0')).at(-1).param.statelist[0].data, /^data:image\/png;base64,/);
});

test('a favorite with no sound alerts on press, as the store guideline asks', async () => {
  send({ cmd: 'run', ...keyMessage('sound', '0_0', 'a1') });
  await waitFor((m) => m.cmd === 'showAlert' && m.key === '0_0');
  assert.equal(sim.countOf('DoPlaySound'), 0);
});

test('the panel gets the connection, the version, the library and search results', async () => {
  send({ cmd: 'sendToPlugin', ...keyMessage('sound', '0_0', 'a1', { payload: { type: 'hello' } }) });
  const status = await waitFor(toPanel('0_0', 'status'));
  assert.equal(status.payload.state, 'connected');
  assert.equal(status.payload.sounds, 30);
  assert.equal(status.payload.sound, 'unset');
  const about = await waitFor(toPanel('0_0', 'about'));
  assert.equal(about.payload.version, JSON.parse(readFileSync(new URL('../manifest.json', pathToFileURL(APP)), 'utf8')).Version);
  const library = await waitFor(toPanel('0_0', 'library'));
  assert.deepEqual(library.payload.categories.map((c) => [c.name, c.count]), [['', 30], ['Memes', 10], ['Games', 3], ['Empty', 0]]);

  const memes = library.payload.categories[1].key;
  send({ cmd: 'sendToPlugin', ...keyMessage('sound', '0_0', 'a1', { payload: { type: 'search', q: 'sound 1', category: memes } }) });
  const results = await waitFor(toPanel('0_0', 'sounds'));
  assert.deepEqual(results.payload.items.map((item) => item.title), ['Sound 1', 'Sound 10']);
  assert.ok(!JSON.stringify(results.payload).includes('Users'), 'paths never reach the panel');
});

async function chooseSound(key, actionid, title, extra = {}) {
  send({ cmd: 'sendToPlugin', ...keyMessage('sound', key, actionid, { payload: { type: 'search', q: title } }) });
  const results = await waitFor(toPanel(key, 'sounds'));
  const item = results.payload.items.find((entry) => entry.title === title);
  const param = { soundId: item.id, soundAlt: item.alt, soundIndex: item.index, soundTitle: item.title, ...extra };
  send({ cmd: 'paramfromplugin', ...keyMessage('sound', key, actionid, { param }) });
  await waitFor(iconFor(key));
  return param;
}

test('a chosen sound plays on press, on the outputs chosen, and the key turns green', async () => {
  await chooseSound('0_0', 'a1', 'Sound 5', { output: 'mic' });
  send({ cmd: 'run', ...keyMessage('sound', '0_0', 'a1') });
  await until(() => sim.status === 'PLAYING');
  assert.equal(sim.current, 5);
  assert.deepEqual(sim.lastOutput, { speakers: false, mic: true });
  await waitFor(iconFor('0_0'));
});

test('after sounds are added and moved in Soundpad, the favorite still plays its own sound', async () => {
  sim.status = 'STOPPED';
  sim.addSound({ url: 'C:\\Sounds\\fresh.mp3', title: 'Fresh' }, 0);
  sim.moveSound(6, 20);
  send({ cmd: 'run', ...keyMessage('sound', '0_0', 'a1') });
  await until(() => sim.sounds[sim.current - 1]?.title === 'Sound 5' && sim.current === 20);
});

test('a favorite whose sound was deleted never plays another one, and alerts', async () => {
  const position = sim.sounds.findIndex((sound) => sound.title === 'Sound 5') + 1;
  sim.removeSound(position);
  sim.status = 'STOPPED';
  const plays = sim.countOf('DoPlaySound');
  send({ cmd: 'run', ...keyMessage('sound', '0_0', 'a1') });
  await waitFor((m) => m.cmd === 'showAlert' && m.key === '0_0');
  assert.equal(sim.countOf('DoPlaySound'), plays);
  send({ cmd: 'sendToPlugin', ...keyMessage('sound', '0_0', 'a1', { payload: { type: 'hello' } }) });
  const status = await waitFor(toPanel('0_0', 'status'));
  assert.equal(status.payload.sound, 'missing');
});

test('a navigator group shows categories, opens one, pages through it and goes back', async () => {
  for (let i = 1; i <= 4; i += 1) send({ cmd: 'add', ...keyMessage('slot', `${i}_1`, `s${i}`, { param: { group: 'A', position: i } }) });
  send({ cmd: 'add', ...keyMessage('nav', '0_2', 'n1', { param: { group: 'A', function: 'nextPage' } }) });
  send({ cmd: 'add', ...keyMessage('nav', '1_2', 'n2', { param: { group: 'A', function: 'back' } }) });
  await waitFor(iconFor('4_1'));
  send({ cmd: 'sendToPlugin', ...keyMessage('slot', '2_1', 's2', { payload: { type: 'hello' } }) });
  let status = await waitFor(toPanel('2_1', 'status'));
  assert.equal(status.payload.mode, 'categories');
  assert.equal(status.payload.pageSize, 4);

  // Position 2 holds the Memes category.
  send({ cmd: 'run', ...keyMessage('slot', '2_1', 's2') });
  await waitFor(iconFor('1_1'));
  send({ cmd: 'sendToPlugin', ...keyMessage('slot', '2_1', 's2', { payload: { type: 'hello' } }) });
  status = await waitFor(toPanel('2_1', 'status'));
  assert.equal(status.payload.categoryName, 'Memes');
  assert.equal(status.payload.pages, 3, '9 sounds left in Memes after the deletion, 4 per page');

  send({ cmd: 'run', ...keyMessage('nav', '0_2', 'n1') });
  await waitFor(iconFor('1_1'));
  send({ cmd: 'sendToPlugin', ...keyMessage('slot', '2_1', 's2', { payload: { type: 'hello' } }) });
  status = await waitFor(toPanel('2_1', 'status'));
  assert.equal(status.payload.page, 2);

  send({ cmd: 'run', ...keyMessage('slot', '1_1', 's1') });
  await until(() => sim.status === 'PLAYING' && sim.sounds[sim.current - 1].title === 'Sound 6');

  send({ cmd: 'run', ...keyMessage('nav', '1_2', 'n2') });
  await waitFor(iconFor('1_1'));
  send({ cmd: 'sendToPlugin', ...keyMessage('slot', '2_1', 's2', { payload: { type: 'hello' } }) });
  status = await waitFor(toPanel('2_1', 'status'));
  assert.equal(status.payload.mode, 'categories');
});

test('the place of a group is saved in the global settings, once the presses stop', async () => {
  const save = await waitFor((m) => m.cmd === 'setGlobalSettings', 4000);
  assert.ok(save.key && save.actionid, 'the main service sends a context');
  assert.equal(save.settings.nav.A.mode, 'categories');
});

test('a second group moves on its own and never changes the first', async () => {
  send({ cmd: 'add', ...keyMessage('slot', '0_3', 'b1', { param: { group: 'B', position: 1 } }) });
  send({ cmd: 'add', ...keyMessage('nav', '1_3', 'b2', { param: { group: 'B', function: 'nextCategory' } }) });
  await waitFor(iconFor('0_3'));
  received = [];
  send({ cmd: 'run', ...keyMessage('nav', '1_3', 'b2') });
  await waitFor(iconFor('0_3'));
  await sleep(QUIET_MS);
  for (const key of ['1_1', '2_1', '3_1', '4_1', '0_0']) assert.equal(received.find(iconFor(key)), undefined, `${key} was redrawn`);
});

test('group options from the panel reach the group', async () => {
  send({ cmd: 'sendToPlugin', ...keyMessage('slot', '2_1', 's2', { payload: { type: 'groupOptions', group: 'A', options: { positions: 2, output: 'speakers', persist: false } } }) });
  const save = await waitFor((m) => m.cmd === 'setGlobalSettings');
  assert.equal(save.settings.groups.A.positions, 2);
  assert.equal(save.settings.nav.A, undefined, 'a group that does not remember forgets its place');
  send({ cmd: 'sendToPlugin', ...keyMessage('slot', '2_1', 's2', { payload: { type: 'hello' } }) });
  const status = await waitFor(toPanel('2_1', 'status'));
  assert.equal(status.payload.pageSize, 2);
});

test('playback controls work, and the volume key shows the volume', async () => {
  send({ cmd: 'add', ...keyMessage('control', '0_4', 'c1', { param: { action: 'pause' } }) });
  send({ cmd: 'add', ...keyMessage('control', '1_4', 'c2', { param: { action: 'volumeUp' } }) });
  await waitFor(iconFor('1_4'));
  sim.status = 'PLAYING';
  send({ cmd: 'run', ...keyMessage('control', '0_4', 'c1') });
  await until(() => sim.status === 'PAUSED');
  send({ cmd: 'run', ...keyMessage('control', '1_4', 'c2') });
  await until(() => sim.volume === 80);
});

test('an unchanged setting sends no image, so the device is not repainted for nothing', async () => {
  const param = { action: 'volumeUp' };
  await sleep(QUIET_MS);
  send({ cmd: 'paramfromapp', ...keyMessage('control', '1_4', 'c2', { param }) });
  await sleep(QUIET_MS);
  assert.equal(received.find(iconFor('1_4')), undefined);
});

test('bad input from the panel or the host changes nothing and breaks nothing', async () => {
  const commands = sim.log.length;
  send({ cmd: 'sendToPlugin', ...keyMessage('sound', '0_0', 'a1', { payload: { type: 'preview', id: '1); DoRemoveSelectedEntries(true', index: 'x' } }) });
  send({ cmd: 'sendToPlugin', ...keyMessage('sound', '0_0', 'a1', { payload: null }) });
  send({ cmd: 'sendToPlugin', ...keyMessage('sound', '0_0', 'a1', { payload: { type: '__proto__' } }) });
  send({ cmd: 'paramfromplugin', ...keyMessage('sound', '0_0', 'a1', { param: { soundId: '../../etc', soundIndex: -5, output: 'everywhere', mode: 'explode' } }) });
  socket.send('{"cmd":"add","uuid":"someone.else.entirely.here.x","key":"z","actionid":"z"}');
  socket.send(JSON.stringify({ cmd: 'clear' }));
  await sleep(QUIET_MS);
  assert.equal(plugin.exitCode, null);
  assert.ok(!sim.log.slice(commands).some((line) => /Remove|Add/.test(line)));
});

test('Soundpad closing turns the keys red, and they recover by themselves', async () => {
  received = [];
  await sim.close();
  await waitFor(iconFor('0_3'));
  await sim.listen(sim.path);
  await until(() => sim.connections === 1, 15_000);
  await waitFor(iconFor('0_3'), 15_000);
  assert.equal(plugin.exitCode, null);
});

test('clear removes keys, and the last one closes the connection to Soundpad', async () => {
  const all = everything.filter((m) => m.cmd === 'add' || m.cmd === 'state').map((m) => m.param?.statelist?.[0] ?? m)
    .map(({ uuid, key, actionid }) => ({ uuid, key, actionid }));
  const unique = [...new Map(all.filter((k) => k.uuid?.startsWith(PLUGIN_UUID)).map((k) => [`${k.key}/${k.actionid}`, k])).values()];
  send({ cmd: 'clear', param: [...unique, keyMessage('sound', '9_9', 'unknown')] });
  await until(() => sim.connections === 0);
  assert.equal(plugin.exitCode, null);
});

test('after losing Studio it reconnects on the same port and in the same language', async () => {
  send({ cmd: 'add', ...keyMessage('sound', '0_0', 'a1', { param: {} }) });
  await waitFor(iconFor('0_0'));
  received = [];
  socket.terminate();
  await waitFor((m) => m.cmd === 'connected');
  const ask = await waitFor((m) => m.cmd === 'getGlobalSettings');
  assert.ok(ask.key && ask.actionid);
  await waitFor(iconFor('0_0'));
});

test('nothing private reaches stdout, stderr or Studio\'s log', () => {
  assert.ok(!output.includes('base64'), 'image data logged');
  assert.ok(!output.includes('Users'), 'a file path was logged');
  assert.ok(!output.includes('Sound 1'), 'a sound name was logged');
  for (const line of output.split('\n').filter((text) => text.trim())) assert.match(line, /^\[Soundpad Pro\] /);
  for (const message of everything.filter((m) => m.cmd === 'logMessage')) assert.ok(!JSON.stringify(message).includes('Users'));
  assert.match(output, /\[Soundpad Pro\] \d+\.\d+\.\d+ starting on Node v\d+.* with arguments \["127\.0\.0\.1","\d+","pt_BR"\]/);
});

test('exits cleanly when asked to stop, and leaves Soundpad alone', async () => {
  const exit = once(plugin, 'exit');
  plugin.kill('SIGTERM');
  const [code] = await exit;
  plugin = null;
  // Windows has no signals: kill() ends the process at once, with no exit code of its own.
  if (process.platform !== 'win32') assert.equal(code, 0);
  await until(() => sim.connections === 0);
});
