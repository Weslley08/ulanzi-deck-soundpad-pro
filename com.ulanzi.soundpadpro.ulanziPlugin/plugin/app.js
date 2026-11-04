// Main service: routes host events to one key object per key on the deck. Every key shares one
// Soundpad connection and one copy of the library.
import { readFileSync } from 'node:fs';
import { HostConnection, silenceConsole } from './host.js';
import { handleInspectorMessage } from './inspector-api.js';
import { ControlKey } from './keys/control-key.js';
import { SoundKey } from './keys/sound-key.js';
import { clearFaceCache } from './render/renderer.js';
import { SoundpadService } from './soundpad/service.js';

const PLUGIN_UUID = 'com.ulanzi.soundpadpro.ulanziPlugin';
const KEY_TYPES = {
  [`${PLUGIN_UUID}.sound`]: SoundKey,
  [`${PLUGIN_UUID}.control`]: ControlKey,
};
const MAX_ATTEMPTS = 10;
const MAX_RECONNECT_WAIT_MS = 30_000;
// The manifest is the one place the version lives. The release branch is checked against it.
const { Version: VERSION } = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

silenceConsole();

// Studio prints a plugin's stderr next to its exit code, the only trace left when there is no socket
// to log through. Only short fixed messages come here: never settings, sound names or paths.
const report = (message, done) => process.stderr.write(`[Soundpad Pro] ${message}\n`, done);
// Without this, writing after Studio closes the pipe would throw, and logFailure would write again.
process.stderr.on('error', () => {});

const $UD = new HostConnection();
const logWarning = (message) => {
  report(message);
  $UD.logMessage(message, 'warn');
};

const service = new SoundpadService({ log: logWarning });
/** @type {Map<string, import('./keys/base-key.js').BaseKey>} */
const keys = new Map();

function keyFor(jsn) {
  let key = keys.get(jsn.context);
  const Type = KEY_TYPES[jsn.uuid];
  if (!key && Type) {
    key = new Type(jsn.context, { host: $UD, service });
    keys.set(jsn.context, key);
    key.updateSettings(jsn.param ?? {});
  }
  return key;
}

function applySettings(jsn) {
  const known = keys.has(jsn.context);
  const key = keyFor(jsn);
  if (known) key?.updateSettings(jsn.param ?? {});
}

function shutdown(reason, code = 0) {
  for (const key of keys.values()) key.destroy();
  keys.clear();
  service.dispose();
  const exit = () => process.exit(code);
  // stderr is asynchronous on Windows pipes, so exiting right away could lose the reason.
  report(`stopping: ${reason}`, exit);
  setTimeout(exit, 1000).unref();
}

let attempts = 0;
let reconnectTimer = null;

// The SDK does not reconnect and the host does not relaunch a dead plugin.
function reconnect() {
  if (reconnectTimer) return;
  attempts += 1;
  if (attempts > MAX_ATTEMPTS) {
    shutdown(`no connection to Studio after ${MAX_ATTEMPTS} attempts`, 1);
    return;
  }
  const wait = Math.min(1000 * 2 ** (attempts - 1), MAX_RECONNECT_WAIT_MS);
  report(`no connection to Studio, retrying in ${wait / 1000} s (${attempts} of ${MAX_ATTEMPTS})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    $UD.reconnect();
  }, wait);
}

$UD.onConnected(async () => {
  attempts = 0;
  report('connected to Studio');
  await $UD.localizeUI();
  for (const key of keys.values()) key.redraw();
});
$UD.onClose(reconnect);
// Without this listener the EventEmitter throws and the process dies. The close event follows.
$UD.onError(() => {});

$UD.onAdd(applySettings);
$UD.onParamFromApp(applySettings);
$UD.onParamFromPlugin(applySettings);

// Only run: on the D200H one touch fires keydown and run, and handling both would act twice.
$UD.onRun((jsn) => keyFor(jsn)?.run());
// Down and up are used only to tell a hold from a press (volume keys); they never act on their own.
$UD.onKeyDown((jsn) => keyFor(jsn)?.pressStart());
$UD.onKeyUp((jsn) => keyFor(jsn)?.pressEnd());

// active may arrive as a string.
$UD.onSetActive((jsn) => keys.get(jsn.context)?.setActive(String(jsn.active) === 'true'));

$UD.onSendToPlugin((jsn) => {
  const key = keyFor(jsn);
  if (key) handleInspectorMessage(key, jsn.payload, { service, version: VERSION });
});

// clear has no message.context: each item in param carries its own.
$UD.onClear((jsn) => {
  for (const { context } of jsn.param ?? []) {
    keys.get(context)?.destroy();
    keys.delete(context);
  }
  if (!keys.size) clearFaceCache();
});

// The host never relaunches this process, so one bad frame must not take every key down with it.
const logFailure = (error) => {
  const message = `unexpected failure: ${error?.name}: ${error?.message}`;
  report(message);
  $UD.logMessage(message, 'error');
  // During startup nothing may be keeping the process alive, and exiting with 0 would read as success.
  process.exitCode = 1;
};
process.on('uncaughtException', logFailure);
process.on('unhandledRejection', logFailure);

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

report(`${VERSION} starting on Node ${process.version} with arguments ${JSON.stringify(process.argv.slice(2))}`);
$UD.connect(PLUGIN_UUID);
