import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import v8 from 'node:v8';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import { FONT_IDS, SIZE, faceSvg } from './face.js';
import { loadFont } from './text.js';

// A navigator page and its neighbours, plus a few favorites, fit without re-rendering.
const CACHE_LIMIT = 96;
const require = createRequire(import.meta.url);

let ready = null;
const cache = new Map();

// V8 compiles WASM twice: first quickly (Liftoff), then again with its optimizer (TurboFan) once the
// code is hot. For the resvg engine that second pass cost about 55 MB of memory that never came back
// and 0.5 s of CPU, measured on Node 20.12.2, to save under 1 ms per key image. Studio starts the
// process, so the flag cannot go on its command line; it is set here, before the engine is compiled,
// and it only affects WASM. See docs/PERFORMANCE.md.
export const WASM_FLAGS = '--liftoff-only';
v8.setFlagsFromString(WASM_FLAGS);

// The WASM engine loads on first use, so a plugin with no key on the deck costs almost nothing.
function initEngine() {
  ready ??= Promise.all([
    readFile(require.resolve('@resvg/resvg-wasm/index_bg.wasm')).then((wasm) => initWasm(wasm)),
    ...FONT_IDS.map(loadFont),
  ]);
  return ready;
}

/** Rasterizes an SVG. WASM memory is not garbage collected, so everything is freed explicitly. */
export async function svgToPng(svg, width = SIZE) {
  await initEngine();
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } });
  const image = resvg.render();
  try {
    return image.asPng();
  } finally {
    image.free();
    resvg.free();
  }
}

export async function renderSvg(view) {
  await initEngine();
  return faceSvg(view);
}

/**
 * Returns the key image as a full data URI: the device ignores a bare base64 string.
 * Identical faces share one render, so paging back and forth costs nothing extra.
 */
export async function renderFace(view) {
  const key = JSON.stringify(view);
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const png = await svgToPng(await renderSvg(view));
  const uri = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
  cache.set(key, uri);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return uri;
}

export function clearFaceCache() {
  cache.clear();
}

export const cachedFaces = () => cache.size;
