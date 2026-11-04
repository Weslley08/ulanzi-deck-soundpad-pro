// One layout for every key: a dark background, a solid symbol in the middle, an optional name under
// it, and a ring whose color says the state. The state never depends on color alone: playing,
// paused, error and unavailable each also get their own mark in the corner.
import { symbol } from './symbols.js';
import { fit, measure, normalizeText, text, wrap } from './text.js';

export const SIZE = 144;
export const FONT = { title: 'outfit-700', small: 'outfit-500' };

export const BACKGROUND_COLORS = { black: '#000000', graphite: '#16171A' };
export const ACCENT_COLORS = { white: '#FFFFFF', cyan: '#4FD8FF', violet: '#B79CFF', orange: '#FF9F43', pink: '#FF7AB6' };
export const STATE_COLORS = {
  playing: '#2BD96B',
  paused: '#FFC83D',
  error: '#FF4D4D',
  unavailable: '#6E7279',
  disabled: '#4A4D53',
};
const READY_RING = '#2A2C31';
export const PROGRESS_STEPS = 50;
const BAR_X = 30;
const BAR_Y = 128;
const BAR_WIDTH = 84;
const BAR_HEIGHT = 6;
const SUBTITLE = '#A9ADB5';

/** The mark in the corner for each state, so a color-blind user can still tell them apart. */
const STATE_MARKS = { playing: 'playing', paused: 'pause', error: 'warning', unavailable: 'unavailable' };

/**
 * @typedef {{
 *   background: 'black' | 'graphite',
 *   state: 'ready' | 'playing' | 'paused' | 'error' | 'unavailable' | 'disabled' | 'loading',
 *   symbol: string,
 *   accent?: string,
 *   title?: string,
 *   badge?: string,
 *   idle?: boolean,
 *   progress?: number | null,
 * }} FaceView
 *   idle shows a quiet mark in the corner (a sound that is not playing); progress is 0 to 50 steps of the bar.
 */

// The name takes the largest size that fits its box, in as many lines as the box allows. Beside an
// icon the box is the lower part of the key; with no icon it is nearly the whole key.
const WITH_ICON = { top: 64, height: 60, width: 128, max: 26, min: 15, lines: 3 };
const NAME_ONLY = { top: 34, height: 90, width: 124, max: 34, min: 17, lines: 4 };
const LINE_FACTOR = 1.12;
const ASCENT = 0.78;

/**
 * Wraps a name at one size. Returns null when a word is wider than the line or there are too many
 * lines, so the caller can try a smaller size.
 */
function wrapAt(title, size, box) {
  const lines = wrap(FONT.title, title, box.width, size);
  const maxLines = Math.min(box.lines, Math.floor(box.height / (size * LINE_FACTOR)));
  if (!lines.length || lines.length > maxLines) return null;
  return lines.every((line) => measure(FONT.title, line, size) <= box.width) ? lines.map((line) => ({ text: line, size })) : null;
}

/** The largest size that fits whole. At the smallest size, what does not fit is cut with an ellipsis. */
function titleLines(title, box) {
  for (let size = box.max; size >= box.min; size -= 1) {
    const lines = wrapAt(title, size, box);
    if (lines) return lines;
  }
  const size = box.min;
  const maxLines = Math.max(1, Math.min(box.lines, Math.floor(box.height / (size * LINE_FACTOR))));
  const wrapped = wrap(FONT.title, title, box.width, size);
  const kept = wrapped.slice(0, maxLines);
  if (wrapped.length > maxLines) kept[maxLines - 1] = [kept[maxLines - 1], ...wrapped.slice(maxLines)].join(' ');
  return kept.map((line) => fit(FONT.title, line, box.width, size, size));
}

/** @param {FaceView} view */
export function faceSvg(view) {
  const bg = Object.hasOwn(BACKGROUND_COLORS, view.background) ? BACKGROUND_COLORS[view.background] : BACKGROUND_COLORS.black;
  const state = Object.hasOwn(STATE_COLORS, view.state ?? '') || view.state === 'loading' ? view.state : 'ready';
  const stateColor = STATE_COLORS[state];
  const accent = view.accent && Object.hasOwn(ACCENT_COLORS, view.accent) ? ACCENT_COLORS[view.accent] : ACCENT_COLORS.white;
  const ink = stateColor ?? accent;
  const ring = stateColor ?? READY_RING;
  const title = normalizeText(FONT.title, view.title ?? '');
  const name = state === 'loading' ? 'dots' : view.symbol;
  // No icon asked for: the name gets the space the icon would have taken.
  const nameOnly = Boolean(title) && name === 'blank';
  const box = nameOnly ? NAME_ONLY : WITH_ICON;
  const lines = title ? titleLines(title, box) : [];

  let out = `<rect width="${SIZE}" height="${SIZE}" fill="${bg}"/>`;
  out += `<rect x="4" y="4" width="${SIZE - 8}" height="${SIZE - 8}" rx="22" fill="none" stroke="${ring}" stroke-width="${stateColor ? 5 : 3}"/>`;

  if (lines.length) {
    if (!nameOnly) out += symbol(name, (SIZE - 44) / 2, 14, 44, ink, bg);
    const height = lines.reduce((sum, line) => sum + line.size * LINE_FACTOR, 0);
    let y = box.top + (box.height - height) / 2;
    for (const line of lines) {
      out += text(FONT.title, line.text, SIZE / 2, y + line.size * ASCENT, line.size, { anchor: 'middle', fill: nameOnly ? ink : '#FFFFFF' });
      y += line.size * LINE_FACTOR;
    }
  } else {
    out += symbol(name, 30, 30, 84, ink, bg);
  }

  if (view.badge) {
    const badge = fit(FONT.small, view.badge, 64, 16, 11);
    out += text(FONT.small, badge.text, 18, 30, badge.size, { anchor: 'start', fill: SUBTITLE });
  }

  const progress = view.progress;
  if (typeof progress === 'number' && Number.isInteger(progress) && progress >= 0 && (state === 'playing' || state === 'paused')) {
    const done = Math.min(progress, PROGRESS_STEPS);
    out += `<rect x="${BAR_X}" y="${BAR_Y}" width="${BAR_WIDTH}" height="${BAR_HEIGHT}" rx="${BAR_HEIGHT / 2}" fill="${READY_RING}"/>`;
    if (done) out += `<rect x="${BAR_X}" y="${BAR_Y}" width="${(BAR_WIDTH * done) / PROGRESS_STEPS}" height="${BAR_HEIGHT}" rx="${BAR_HEIGHT / 2}" fill="${stateColor}"/>`;
  }

  if (view.idle === true && state === 'ready') {
    out += `<circle cx="${SIZE - 26}" cy="26" r="15" fill="${READY_RING}"/>`;
    out += symbol('stop', SIZE - 36, 16, 20, SUBTITLE, READY_RING);
  }

  const mark = STATE_MARKS[state];
  if (mark) {
    out += `<circle cx="${SIZE - 26}" cy="26" r="15" fill="${stateColor}"/>`;
    out += symbol(mark, SIZE - 38, 14, 24, bg, stateColor);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">${out}</svg>`;
}

export const FONT_IDS = Object.values(FONT);
