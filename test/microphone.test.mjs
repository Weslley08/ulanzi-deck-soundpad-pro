// The Windows microphone call, with the process launch replaced: what is sent, and how each answer is read.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POWERSHELL, microphone } from '../com.ulanzi.soundpadpro.ulanziPlugin/plugin/system/microphone.js';

/** A stand-in for execFile that answers with what it is given. */
const launcher = (stdout, error = null) => {
  const calls = [];
  const run = (file, args, options, callback) => {
    calls.push({ file, args, options });
    callback(error, stdout);
  };
  return { run, calls };
};

const scriptOf = (call) => Buffer.from(call.args[call.args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');

test('asking for the state runs a fixed script that only reads', async () => {
  const { run, calls } = launcher('unmuted\r\n');
  assert.deepEqual(await microphone('read', run), { muted: false });
  assert.equal(calls[0].file, POWERSHELL);
  assert.deepEqual(calls[0].args.slice(0, 4), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass']);
  assert.equal(calls[0].options.windowsHide, true);
  assert.ok(calls[0].options.timeout > 0, 'it can never hang a press for good');
  const script = scriptOf(calls[0]);
  assert.match(script, /GetMute/);
  assert.doesNotMatch(script, /Set\(-not/);
});

test('toggling sets the opposite of the current state, and the answer is the new state', async () => {
  const { run, calls } = launcher('muted');
  assert.deepEqual(await microphone('toggle', run), { muted: true });
  assert.match(scriptOf(calls[0]), /Set\(-not \[Microphone\]::Muted\(\)\)/);
});

test('a failed or unreadable answer is an error, never a guess', async () => {
  await assert.rejects(microphone('read', launcher('', new Error('boom')).run), /microphone/);
  await assert.rejects(microphone('read', launcher('Exception: no device').run), /microphone/);
  await assert.rejects(microphone('toggle', launcher(undefined).run), /microphone/);
});
