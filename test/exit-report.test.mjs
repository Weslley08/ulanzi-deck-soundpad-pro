// When the plugin stops in Studio, its stderr and exit code are all there is to go on.
import assert from 'node:assert/strict';
import { fork, spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';

const APP = fileURLToPath(new URL('../com.ulanzi.soundpadpro.ulanziPlugin/plugin/app.js', import.meta.url));
const METRICS = pathToFileURL(fileURLToPath(new URL('./support/metrics.mjs', import.meta.url))).href;

test('a failure during startup says why, and does not exit with 0', async () => {
  const plugin = spawn(process.execPath, [APP, '127.0.0.1', 'not-a-port', 'en'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  plugin.stderr.on('data', (chunk) => { stderr += chunk; });
  const [code] = await once(plugin, 'exit');
  assert.equal(code, 1);
  assert.match(stderr, /\[Soundpad Pro\] unexpected failure: SyntaxError/);
  assert.match(stderr, /with arguments \["127\.0\.0\.1","not-a-port","en"\]/);
});

test('a closed stderr neither takes the plugin down nor sends it into a loop', async () => {
  const host = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(host, 'listening');
  const nextConnection = () => new Promise((resolve) => { host.once('connection', resolve); });
  const first = nextConnection();
  const plugin = fork(APP, ['127.0.0.1', String(host.address().port), 'en'], {
    execArgv: ['--import', METRICS],
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  // A plugin stuck in a loop never answers, which has to fail the test instead of hanging it.
  const cpuMs = async () => {
    plugin.send('metrics');
    const [reply] = await once(plugin, 'message', { signal: AbortSignal.timeout(5000) });
    return reply.cpuMs;
  };
  try {
    const socket = await first;
    plugin.stderr.destroy();
    // Losing the host makes the plugin write to the closed pipe, and it should still come back.
    const second = nextConnection();
    socket.terminate();
    await second;
    const before = await cpuMs();
    await sleep(1000);
    const used = (await cpuMs()) - before;
    assert.ok(used < 400, `${used.toFixed(0)} ms of CPU in one idle second`);
    assert.equal(plugin.exitCode, null);
  } finally {
    plugin.kill();
    for (const client of host.clients) client.terminate();
    host.close();
  }
});
