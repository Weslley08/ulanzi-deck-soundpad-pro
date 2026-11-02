// Runs the settings panel in a real Chromium, the engine Ulanzi Studio embeds, with the real SDK
// against a fake host. Skipped when no browser is installed; set CHROME_PATH to point at one.
// Set PI_SCREENSHOT=<folder> to also save pictures of the panel.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLUGIN = 'com.ulanzi.soundpadpro.ulanziPlugin';
let ACTION_UUID = `${PLUGIN}.sound`;
const WAIT_MS = 8000;

const browserPath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find((path) => path && existsSync(path));

const options = { skip: browserPath ? false : 'no Chromium found; set CHROME_PATH to run' };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

let web;
let host;
let hostSocket;
let browser;
let profile;
let page;
let messages = [];
const consoleOutput = [];
let notify = () => {};
let nextId = 1;
const pending = new Map();

function waitForMessage(predicate) {
  return new Promise((resolve, reject) => {
    const limit = setTimeout(() => reject(new Error(`no matching message; got ${messages.map((m) => m.cmd).join(', ')}`)), WAIT_MS);
    const check = () => {
      const found = messages.find(predicate);
      if (!found) return;
      clearTimeout(limit);
      notify = () => {};
      resolve(found);
    };
    notify = check;
    check();
  });
}

const fromHost = (message) => hostSocket.send(JSON.stringify({ uuid: ACTION_UUID, key: '0_0', actionid: 'a1', ...message }));

function cdp(method, params = {}) {
  const id = nextId++;
  page.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function run(expression) {
  const { result, exceptionDetails } = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

const type = (selector, value) => run(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  el.focus();
  el.value = ${JSON.stringify(value)};
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`);

async function until(expression) {
  const end = Date.now() + WAIT_MS;
  while (Date.now() < end) {
    if (await run(expression)) return;
    await sleep(25);
  }
  assert.fail(`never became true: ${expression}`);
}

async function screenshot(name) {
  if (!process.env.PI_SCREENSHOT) return;
  // The panel is transparent and its text is white; the host provides this background.
  await run(`document.documentElement.style.background = '#1e1f22'`);
  const { data } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(join(process.env.PI_SCREENSHOT, `${name}.png`), Buffer.from(data, 'base64'));
}

let webPort;
let hostPort;
function pageUrl(action) {
  const params = new URLSearchParams({ address: '127.0.0.1', port: hostPort, uuid: `${PLUGIN}.${action}`, key: '0_0', actionid: 'a1', language: 'pt_BR' });
  return `http://127.0.0.1:${webPort}/${PLUGIN}/property-inspector/soundpad/inspector.html?${params}`;
}

before(async () => {
  if (!browserPath) return;
  web = http.createServer((request, response) => {
    const path = join(ROOT, decodeURIComponent(new URL(request.url, 'http://x').pathname));
    if (!existsSync(path)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(readFileSync(path));
  });
  web.listen(0, '127.0.0.1');
  await once(web, 'listening');
  webPort = web.address().port;

  host = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(host, 'listening');
  hostPort = host.address().port;
  host.on('connection', (socket) => {
    hostSocket = socket;
    socket.on('message', (raw) => {
      messages.push(JSON.parse(raw));
      notify();
    });
  });

  profile = mkdtempSync(join(tmpdir(), 'soundpad-pro-browser-'));
  // Linux CI restricts the namespaces Chromium's sandbox needs. This only ever loads our own local pages.
  const sandbox = process.platform === 'linux' ? ['--no-sandbox'] : [];
  browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=620,1100', ...sandbox, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const debugUrl = await new Promise((resolve, reject) => {
    const limit = setTimeout(() => reject(new Error('browser did not start')), 20_000);
    let log = '';
    browser.stderr.on('data', (chunk) => {
      log += chunk;
      const match = log.match(/DevTools listening on (ws:\S+)/);
      if (match) {
        clearTimeout(limit);
        resolve(match[1]);
      }
    });
  });

  const created = await fetch(`http://${new URL(debugUrl).host}/json/new?${encodeURIComponent(pageUrl('sound'))}`, { method: 'PUT' }).then((r) => r.json());
  page = new WebSocket(created.webSocketDebuggerUrl);
  await once(page, 'open');
  page.on('message', (raw) => {
    const reply = JSON.parse(raw);
    if (reply.method === 'Runtime.consoleAPICalled') consoleOutput.push(JSON.stringify(reply.params.args));
    pending.get(reply.id)?.resolve(reply.result);
    pending.delete(reply.id);
  });
  await cdp('Runtime.enable');
  await cdp('Page.enable');
});

// Chromium's helper processes can outlive the main one and keep writing to the profile. rmSync's own
// retries never list the folder again, so one new file makes all of them fail.
async function removeProfile() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      rmSync(profile, { recursive: true, force: true });
      return;
    } catch {
      await sleep(500);
    }
  }
  // A leftover temporary folder says nothing about the panel, so it does not fail the run.
  console.warn(`could not remove ${profile}`);
}

after(async () => {
  page?.close();
  browser?.kill();
  if (browser && browser.exitCode === null) await Promise.race([once(browser, 'exit'), sleep(3000)]);
  for (const client of host?.clients ?? []) client.terminate();
  host?.close();
  web?.close();
  if (profile) await removeProfile();
});

const ID = (c) => c.repeat(24);
const LIBRARY = {
  type: 'library',
  ready: true,
  revision: 'r1',
  count: 3,
  categoriesKnown: true,
  categories: [
    { key: 'all', name: '', depth: 0, count: 3 },
    { key: 'c0123456789abcdef', name: 'Memes', depth: 0, count: 2 },
    { key: 'cfedcba9876543210', name: 'Memes › Old', depth: 1, count: 1 },
  ],
};
const resultsFor = (q, category = 'all') => ({
  type: 'sounds',
  q,
  category,
  ready: true,
  total: 3,
  items: [
    { id: ID('a'), alt: ID('b'), index: 1, title: 'Air horn', artist: 'Studio', duration: '0:02', duplicate: false },
    { id: ID('c'), alt: ID('d'), index: 2, title: 'Laugh', artist: '', duration: '0:04', duplicate: true },
    { id: ID('e'), alt: ID('f'), index: 3, title: '<img src=x onerror="window.pwned=1">', artist: '', duration: '', duplicate: true },
  ],
});
const CONNECTED = { type: 'status', state: 'connected', lastError: null, attempts: 0, rcVersion: '1.1.2', version: '4.0.35', trial: false, sounds: 3, categories: 2, categoriesSupported: true, libraryAgeMs: 4000, playStatus: 'STOPPED' };

test('connects, shows itself and says hello to the plugin', options, async () => {
  await waitForMessage((m) => m.cmd === 'connected');
  await waitForMessage((m) => m.cmd === 'sendToPlugin' && m.payload?.type === 'hello');
  await until(`!document.querySelector('.uspi-wrapper').classList.contains('hidden')`);
});

test('the page has no background of its own, as the store requires', options, async () => {
  assert.equal(await run(`getComputedStyle(document.body).backgroundColor`), 'rgba(0, 0, 0, 0)');
});

test('a favorite shows its own sections only, in the host language', options, async () => {
  await until(`document.querySelector('section[data-action=sound]').offsetParent !== null`);
  assert.equal(await run(`document.querySelector('section[data-action=slot]').offsetParent`), null);
  assert.equal(await run(`document.querySelector('#groupOptions').offsetParent`), null);
  await until(`document.querySelector('label[for=search]').textContent === 'Pesquisar'`);
  assert.equal(await run(`document.querySelector('#search').placeholder`), 'Digite parte do nome');
  assert.equal(await run(`document.querySelector('#iconGrid').children.length`), 11);
  await until(`document.querySelector('#chosen').textContent === 'Nenhum escolhido'`);
  assert.equal(await run(`document.querySelector('#feedback').checked`), true, 'defaults show before any saved setting arrives');
  assert.equal(await run(`document.querySelector('#showTitle').checked`), true);
});

test('the connection and diagnostics show what the plugin reports', options, async () => {
  fromHost({ cmd: 'sendToPropertyInspector', payload: CONNECTED });
  await until(`document.querySelector('#connection').textContent.includes('4.0.35')`);
  assert.equal(await run(`document.querySelector('#connection').className`), 'tip success');
  assert.match(await run(`document.querySelector('#diagnosticList').textContent`), /1\.1\.2/);
  fromHost({ cmd: 'sendToPropertyInspector', payload: { ...CONNECTED, state: 'offline', lastError: 'not-running', sounds: null } });
  await until(`document.querySelector('#connection').className === 'tip error'`);
  assert.match(await run(`document.querySelector('#connectionHint').textContent`), /Abra o Soundpad/);
  fromHost({ cmd: 'sendToPropertyInspector', payload: { ...CONNECTED, state: 'offline', lastError: 'rejected-500' } });
  await until(`document.querySelector('#connectionHint').textContent.includes('500')`);
  fromHost({ cmd: 'sendToPropertyInspector', payload: CONNECTED });
});

test('reconnect and refresh ask the plugin', options, async () => {
  messages = [];
  await run(`document.querySelector('#reconnect').click()`);
  await waitForMessage((m) => m.payload?.type === 'reconnect');
  await run(`document.querySelector('#refresh').click()`);
  await waitForMessage((m) => m.payload?.type === 'refresh');
});

test('the library fills the categories and asks for the sounds', options, async () => {
  messages = [];
  fromHost({ cmd: 'sendToPropertyInspector', payload: LIBRARY });
  const search = await waitForMessage((m) => m.payload?.type === 'search');
  assert.deepEqual([search.payload.q, search.payload.category], ['', 'all']);
  assert.deepEqual(await run(`[...document.querySelectorAll('#category option')].map((o) => o.textContent)`), ['Todos os sons (3)', 'Memes (2)', '  Memes › Old (1)']);
});

test('results show, sound names cannot inject markup, and a stale reply is ignored', options, async () => {
  fromHost({ cmd: 'sendToPropertyInspector', payload: resultsFor('') });
  await until(`document.querySelectorAll('#results .result').length === 3`);
  assert.equal(await run(`document.querySelector('#results img')`), null);
  await sleep(50);
  assert.equal(await run(`window.pwned ?? null`), null);
  assert.match(await run(`document.querySelectorAll('.result-meta')[1].textContent`), /#2/, 'a repeated name shows its position');
  fromHost({ cmd: 'sendToPropertyInspector', payload: { ...resultsFor('old search'), items: [] } });
  await sleep(100);
  assert.equal(await run(`document.querySelectorAll('#results .result').length`), 3);
  await screenshot('panel-sound');
});

test('typing searches after a pause, and changing the category searches at once', options, async () => {
  messages = [];
  await type('#search', 'horn');
  const search = await waitForMessage((m) => m.payload?.type === 'search' && m.payload.q === 'horn');
  assert.equal(search.payload.category, 'all');
  messages = [];
  await run(`(() => { const el = document.querySelector('#category'); el.value = 'c0123456789abcdef'; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitForMessage((m) => m.payload?.type === 'search' && m.payload.category === 'c0123456789abcdef');
  assert.equal(messages.find((m) => m.cmd === 'paramfromplugin'), undefined, 'searching saves nothing');
});

test('choosing a sound saves its identity, not only its position', options, async () => {
  fromHost({ cmd: 'sendToPropertyInspector', payload: resultsFor('horn', 'c0123456789abcdef') });
  await until(`document.querySelectorAll('#results .result').length === 3`);
  messages = [];
  await run(`document.querySelector('#results .pick').click()`);
  const saved = await waitForMessage((m) => m.cmd === 'paramfromplugin');
  assert.equal(saved.param.soundId, ID('a'));
  assert.equal(saved.param.soundAlt, ID('b'));
  assert.equal(saved.param.soundIndex, 1);
  assert.equal(saved.param.soundTitle, 'Air horn');
  assert.equal(await run(`document.querySelector('#chosen').textContent`), 'Air horn');
});

test('preview asks the plugin to play the sound', options, async () => {
  messages = [];
  await run(`document.querySelectorAll('#results .preview')[1].click()`);
  const preview = await waitForMessage((m) => m.payload?.type === 'preview');
  assert.equal(preview.payload.id, ID('c'));
  fromHost({ cmd: 'sendToPropertyInspector', payload: { type: 'preview', result: 'missing' } });
  await until(`document.querySelector('#resultInfo').textContent.includes('não está mais')`);
});

test('saved settings fill the form, and changing one saves the rest as they were', options, async () => {
  fromHost({ cmd: 'paramfromapp', param: { soundId: ID('c'), soundAlt: ID('d'), soundIndex: 2, soundTitle: 'Laugh', output: 'mic', mode: 'toggle', feedback: false, label: 'Haha', icon: 'laugh', accent: 'pink', background: 'graphite', showTitle: false } });
  await until(`document.querySelector('#output').value === 'mic'`);
  assert.equal(await run(`document.querySelector('#mode').value`), 'toggle');
  assert.equal(await run(`document.querySelector('#feedback').checked`), false);
  assert.equal(await run(`document.querySelector('[name=icon]:checked').value`), 'laugh');
  assert.equal(await run(`document.querySelector('#chosen').textContent`), 'Laugh');
  messages = [];
  await run(`(() => { const el = document.querySelector('#feedback'); el.click(); })()`);
  const saved = await waitForMessage((m) => m.cmd === 'paramfromplugin');
  assert.equal(saved.param.feedback, true, 'a checkbox saves as true or false');
  assert.equal(saved.param.output, 'mic');
  assert.equal(saved.param.soundId, ID('c'));
  assert.equal(saved.param.label, 'Haha');
  assert.equal(saved.param.showTitle, false);
});

test('the state of the chosen sound reads clearly', options, async () => {
  fromHost({ cmd: 'sendToPropertyInspector', payload: { ...CONNECTED, kind: 'sound', sound: 'missing', title: 'Laugh' } });
  await until(`document.querySelector('#soundState').className === 'tip error'`);
  assert.match(await run(`document.querySelector('#soundState').textContent`), /não está mais/);
  fromHost({ cmd: 'sendToPropertyInspector', payload: { ...CONNECTED, kind: 'sound', sound: 'ok', relinked: true } });
  await until(`document.querySelector('#soundState').className === 'tip warn'`);
});

test('the version from the plugin shows up', options, async () => {
  fromHost({ cmd: 'sendToPropertyInspector', payload: { type: 'about', version: '1.2.3' } });
  await until(`document.querySelector('#version').textContent === 'Soundpad Controller v1.2.3'`);
});

test('a library position shows its group and the shared group options', options, async () => {
  ACTION_UUID = `${PLUGIN}.slot`;
  messages = [];
  await cdp('Page.navigate', { url: pageUrl('slot') });
  await waitForMessage((m) => m.payload?.type === 'hello');
  await until(`document.querySelector('#groupOptions')?.offsetParent != null`);
  assert.equal(await run(`document.querySelector('section[data-action=sound]').offsetParent`), null);
  fromHost({ cmd: 'sendToPropertyInspector', payload: LIBRARY });
  fromHost({ cmd: 'paramfromapp', param: { group: 'Memes', position: 3, feedback: true, background: 'black', showTitle: true } });
  await until(`document.querySelector('#slotGroup').value === 'Memes'`);
  assert.equal(await run(`document.querySelector('#position').value`), '3');
  fromHost({ cmd: 'sendToPropertyInspector', payload: { ...CONNECTED, kind: 'slot', group: 'Memes', page: 2, pages: 5, mode: 'sounds', categoryName: 'Memes', positionsOnDeck: 4, pageSize: 4, options: { positions: 0, startCategory: 'c0123456789abcdef', startPage: 1, persist: true, output: 'speakers', mode: 'play' } } });
  await until(`document.querySelector('#groupState').textContent.includes('Página 2 de 5')`);
  assert.equal(await run(`document.querySelector('#groupOutput').value`), 'speakers');
  assert.equal(await run(`document.querySelector('#groupStartCategory').value`), 'c0123456789abcdef');
  assert.equal(await run(`document.querySelector('#groupPersist').checked`), true);
  await screenshot('panel-slot');
});

test('changing a group option sends it to the plugin for the whole group, not to the key', options, async () => {
  messages = [];
  await type('#groupPositions', '6');
  const sent = await waitForMessage((m) => m.payload?.type === 'groupOptions');
  assert.equal(sent.payload.group, 'Memes');
  assert.equal(sent.payload.options.positions, 6);
  assert.equal(sent.payload.options.persist, true);
  assert.equal(messages.find((m) => m.cmd === 'paramfromplugin'), undefined);
});

test('a control key hides what does not apply to its action', options, async () => {
  ACTION_UUID = `${PLUGIN}.control`;
  await cdp('Page.navigate', { url: pageUrl('control') });
  await until(`document.querySelector('section[data-action=control]')?.offsetParent != null && document.querySelector('.uspi-wrapper.hidden') === null`);
  fromHost({ cmd: 'paramfromapp', param: { action: 'stop' } });
  await until(`document.querySelector('#controlAction').value === 'stop'`);
  assert.equal(await run(`document.querySelector('#controlOutputRow').offsetParent`), null);
  fromHost({ cmd: 'paramfromapp', param: { action: 'random' } });
  await until(`document.querySelector('#controlOutputRow').offsetParent !== null`);
  fromHost({ cmd: 'paramfromapp', param: { action: 'volumeUp' } });
  await until(`document.querySelector('#volumeNote').offsetParent !== null`);
  assert.equal(await run(`document.querySelector('#groupOptions').offsetParent`), null);
});

test('nothing private reaches the browser console', options, async () => {
  await sleep(100);
  assert.deepEqual(consoleOutput, []);
});
