// One layout for every key: a dark background, a solid symbol in the middle, an optional name under
// it, and a ring whose color says the state. The state never depends on color alone: playing,
// paused, error and unavailable each also get their own mark in the corner.
import { symbol } from './symbols.js';
import { fit, normalizeText, text, wrap } from './text.js';

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
 * }} FaceView
 */

const TITLE_SIZE = 19;
const TITLE_MIN = 13;
const TITLE_WIDTH = 124;
const LINE_HEIGHT = 21;

/** Up to two lines, the second shortened with an ellipsis when the name is longer. */
function titleLines(title) {
  const words = wrap(FONT.title, title, TITLE_WIDTH, TITLE_SIZE);
  if (!words.length) return [];
  if (words.length === 1) return [fit(FONT.title, words[0], TITLE_WIDTH, TITLE_SIZE, TITLE_MIN)];
  const first = fit(FONT.title, words[0], TITLE_WIDTH, TITLE_SIZE, TITLE_MIN);
  const rest = words.slice(1).join(' ');
  return [first, fit(FONT.title, rest, TITLE_WIDTH, TITLE_SIZE, TITLE_MIN)];
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
  const lines = title ? titleLines(title) : [];

  let out = `<rect width="${SIZE}" height="${SIZE}" fill="${bg}"/>`;
  out += `<rect x="4" y="4" width="${SIZE - 8}" height="${SIZE - 8}" rx="22" fill="none" stroke="${ring}" stroke-width="${stateColor ? 5 : 3}"/>`;

  const name = state === 'loading' ? 'dots' : view.symbol;
  if (lines.length) {
    const size = lines.length > 1 ? 52 : 60;
    out += symbol(name, (SIZE - size) / 2, lines.length > 1 ? 18 : 22, size, ink, bg);
    const top = lines.length > 1 ? 100 : 112;
    lines.forEach((line, i) => {
      out += text(FONT.title, line.text, SIZE / 2, top + i * LINE_HEIGHT, line.size, { anchor: 'middle', fill: '#FFFFFF' });
    });
  } else {
    out += symbol(name, 30, 30, 84, ink, bg);
  }

  if (view.badge) {
    const badge = fit(FONT.small, view.badge, 64, 16, 11);
    out += text(FONT.small, badge.text, 18, 30, badge.size, { anchor: 'start', fill: SUBTITLE });
  }

  const mark = STATE_MARKS[state];
  if (mark) {
    out += `<circle cx="${SIZE - 26}" cy="26" r="15" fill="${stateColor}"/>`;
    out += symbol(mark, SIZE - 38, 14, 24, bg, stateColor);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">${out}</svg>`;
}

export const FONT_IDS = Object.values(FONT);
