import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SAMPLE_FACES, STRESS_TITLES } from '../scripts/lib/samples.mjs';
import { SIZE, STATE_COLORS } from '../com.ulanzi.soundpadpro.ulanziPlugin/plugin/render/face.js';
import { cachedFaces, clearFaceCache, renderFace, renderSvg, svgToPng } from '../com.ulanzi.soundpadpro.ulanziPlugin/plugin/render/renderer.js';
import { SYMBOLS } from '../com.ulanzi.soundpadpro.ulanziPlugin/plugin/render/symbols.js';
import { ICONS } from '../com.ulanzi.soundpadpro.ulanziPlugin/plugin/settings.js';

const pngSize = (bytes) => {
  const data = Buffer.from(bytes);
  assert.equal(data.toString('latin1', 1, 4), 'PNG');
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
};

const STATES = ['ready', 'playing', 'paused', 'error', 'unavailable', 'disabled', 'loading'];

test('every symbol draws in every state, with and without a name, at key size', async () => {
  for (const symbol of Object.keys(SYMBOLS)) {
    for (const state of STATES) {
      for (const title of ['', 'Air horn']) {
        const svg = await renderSvg({ background: 'black', state, symbol, title, badge: '3/9' });
        assert.ok(!/undefined|NaN/.test(svg), `${symbol} ${state}`);
        assert.deepEqual(pngSize(await svgToPng(svg)), [SIZE, SIZE]);
      }
    }
  }
});

test('a bar shows only while a sound plays or is paused, and the idle mark only on a ready key', async () => {
  const draw = (view) => renderSvg({ background: 'black', symbol: 'note', title: 'Horn', ...view });
  const plain = await draw({ state: 'playing' });
  const half = await draw({ state: 'playing', progress: 25 });
  const full = await draw({ state: 'playing', progress: 50 });
  assert.ok(half.length > plain.length);
  assert.match(half, /width="42"/, 'half of the bar');
  assert.match(full, /width="84" height="6" rx="3" fill="#2BD96B"/, 'all of it, in the state color');
  assert.ok(!/NaN|undefined/.test(half + full));
  assert.equal((await draw({ state: 'ready', progress: 25 })).length, (await draw({ state: 'ready' })).length, 'no bar on a ready key');
  assert.equal((await draw({ state: 'paused', progress: 10 })).includes('#FFC83D'), true);
  assert.ok((await draw({ state: 'ready', idle: true })).length > (await draw({ state: 'ready' })).length);
  assert.equal((await draw({ state: 'playing', idle: true })).length, plain.length, 'playing has its own mark');
  assert.ok(!/NaN/.test(await draw({ state: 'playing', progress: 9999 })));
});

test('every icon offered in the panel exists as a symbol', () => {
  for (const icon of ICONS) if (icon !== 'none') assert.ok(SYMBOLS[icon], icon);
});

test('names from Soundpad can never inject markup, and any length still renders', async () => {
  for (const title of STRESS_TITLES) {
    const svg = await renderSvg({ background: 'graphite', state: 'ready', symbol: 'note', title, badge: title });
    assert.ok(!svg.includes('evil.example'));
    assert.ok(!svg.includes('<script'));
    assert.ok(!svg.includes('<image'));
    await svgToPng(svg);
  }
});

test('the states are told apart by more than color', async () => {
  const withoutColors = (svg) => svg.replace(/#[0-9A-Fa-f]{6}/g, '#');
  const faces = await Promise.all(['ready', 'playing', 'paused', 'error', 'unavailable'].map((state) => renderSvg({ background: 'black', state, symbol: 'note', title: 'X' })));
  assert.equal(new Set(faces.map(withoutColors)).size, 5);
});

test('the state colors are the ones agreed: green, yellow, red and grey', async () => {
  assert.equal(STATE_COLORS.playing.toUpperCase(), '#2BD96B');
  assert.equal(STATE_COLORS.paused.toUpperCase(), '#FFC83D');
  assert.equal(STATE_COLORS.error.toUpperCase(), '#FF4D4D');
  const ready = await renderSvg({ background: 'black', state: 'ready', symbol: 'note' });
  assert.match(ready, /fill="#FFFFFF"/, 'a ready key draws its symbol in white');
  assert.match(ready, /fill="#000000"/, 'on black');
});

test('an unknown symbol or color falls back instead of breaking', async () => {
  const svg = await renderSvg({ background: 'neon', state: 'weird', symbol: 'constructor', accent: 'gold' });
  assert.ok(!/undefined|NaN/.test(svg));
  await svgToPng(svg);
});

test('the key image is a full data URI, or the device ignores it', async () => {
  assert.match(await renderFace(SAMPLE_FACES[0]), /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
});

test('identical faces reuse one render, and the cache stays bounded', async () => {
  clearFaceCache();
  const first = await renderFace(SAMPLE_FACES[1]);
  assert.equal(await renderFace({ ...SAMPLE_FACES[1] }), first);
  assert.equal(cachedFaces(), 1);
  for (let i = 0; i < 150; i += 1) await renderFace({ background: 'black', state: 'ready', symbol: 'note', badge: String(i) });
  assert.ok(cachedFaces() <= 96);
  clearFaceCache();
  assert.equal(cachedFaces(), 0);
});

test('a face stays small enough to send often', async () => {
  for (const view of SAMPLE_FACES) {
    const uri = await renderFace(view);
    assert.ok(uri.length < 20_000, `${uri.length} bytes for ${view.symbol}`);
  }
});
