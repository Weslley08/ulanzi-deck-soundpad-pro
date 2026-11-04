// Regenerates every image derived from the key faces, so previews never drift from what the keys
// draw: plugin and action icons, default key images, icon previews for the panel, the store banner
// and covers, and the sheet in the README.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PLUGIN_FOLDER, pluginDir, root } from './lib/project.mjs';
import { SAMPLE_FACES } from './lib/samples.mjs';

const load = (path) => import(pathToFileURL(join(pluginDir, 'plugin', path)).href);
const { renderSvg, svgToPng } = await load('render/renderer.js');
const { symbol } = await load('render/symbols.js');
const { text } = await load('render/text.js');
const { ICONS } = await load('settings.js');

function save(path, bytes) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, bytes);
}

const plugin = (rel) => join(PLUGIN_FOLDER, rel);
const facePng = async (view, width) => svgToPng(await renderSvg(view), width);
const dataUri = (png) => `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
// Faces become embedded images in composites, clipped to the rounded shape of a real key.
function placed(png, x, y, size) {
  const clip = `c${Math.round(x)}_${Math.round(y)}`;
  return `<clipPath id="${clip}"><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.14}"/></clipPath>`
    + `<image href="${dataUri(png)}" x="${x}" y="${y}" width="${size}" height="${size}" clip-path="url(#${clip})"/>`;
}

/** A sheet of faces in a grid. */
async function sheet(views, columns, face = 216, gap = 20, background = '#17181B') {
  const rows = Math.ceil(views.length / columns);
  const width = columns * (face + gap) + gap;
  const height = rows * (face + gap) + gap;
  let body = '';
  for (const [i, view] of views.entries()) {
    body += placed(await facePng(view, face), gap + (i % columns) * (face + gap), gap + Math.floor(i / columns) * (face + gap), face);
  }
  return svgToPng(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${background}"/>${body}</svg>`, width);
}

// The brand mark: a speaker with sound waves on a dark tile. Our own drawing, not Soundpad's logo.
function brandSvg(size) {
  const pad = size * 0.2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`
    + `<rect width="${size}" height="${size}" fill="#0B0B0D"/>`
    + `<rect x="${size * 0.04}" y="${size * 0.04}" width="${size * 0.92}" height="${size * 0.92}" rx="${size * 0.18}" fill="none" stroke="#2BD96B" stroke-width="${size * 0.035}"/>`
    + `${symbol('speaker', pad, pad, size - pad * 2, '#FFFFFF', '#0B0B0D')}</svg>`;
}

async function icons() {
  save(plugin('resources/plugin-icon.png'), await svgToPng(brandSvg(196), 196));
  save(plugin('resources/plugin-icon@2x.png'), await svgToPng(brandSvg(196), 392));

  // List icons: 20x20, one color, transparent, as the guideline asks.
  const listIcon = (name, color) => `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">${symbol(name, 1, 1, 18, color, 'none')}</svg>\n`;
  save(plugin('resources/category.svg'), listIcon('speaker', '#FFFFFF'));
  const actions = { sound: 'play', control: 'pause' };
  for (const [action, name] of Object.entries(actions)) {
    save(plugin(`resources/action-${action}.svg`), listIcon(name, '#A6A6A6'));
    const view = { background: 'black', state: 'ready', symbol: name };
    save(plugin(`resources/key-${action}.png`), await facePng(view, 144));
    save(plugin(`resources/key-${action}@2x.png`), await facePng(view, 288));
  }

  // Previews for the icon picker in the panel.
  for (const icon of ICONS) {
    save(plugin(`resources/icons/${icon}.png`), await facePng({ background: 'black', state: 'ready', symbol: icon === 'none' ? 'blank' : icon, title: icon === 'none' ? 'Aa' : '' }, 72));
  }
}

// Store art: real faces on a dark stage, with a title drawn from the plugin's own outlines.
async function storeArt(width, height, columns, faces) {
  const title = 'Soundpad Controller';
  const subtitle = 'Your sounds, one press away';
  const header = height * 0.27;
  const gap = height * 0.03;
  const rows = Math.ceil(faces.length / columns);
  const face = Math.min((height - header - gap * (rows + 1)) / rows, (width - gap * (columns + 1)) / columns);
  const left = (width - (columns * face + (columns - 1) * gap)) / 2;
  const top = Math.round((height - header - gap * (rows + 1) - rows * face) / 2);
  let body = text('outfit-700', title, width / 2, top + height * 0.135, height * 0.09, { anchor: 'middle', fill: '#FFFFFF' })
    + text('outfit-500', subtitle, width / 2, top + height * 0.205, height * 0.042, { anchor: 'middle', fill: '#A9ADB5' });
  for (const [i, view] of faces.entries()) {
    body += placed(await facePng(view, Math.round(face)), left + (i % columns) * (face + gap), top + header + gap + Math.floor(i / columns) * (face + gap), face);
  }
  return svgToPng(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#0E0F12"/>${body}</svg>`, width);
}

async function store() {
  save(plugin('assets/banners/banner-1.png'), await storeArt(1098, 732, 4, SAMPLE_FACES.slice(0, 8)));
  save('store/cover-2x1.png', await storeArt(1200, 600, 6, SAMPLE_FACES.slice(0, 6)));
  save('store/cover-1x1.png', await svgToPng(brandSvg(800), 800));
}

await icons();
await store();
save('docs/keys.png', await sheet(SAMPLE_FACES, 6));
console.log('assets written');
