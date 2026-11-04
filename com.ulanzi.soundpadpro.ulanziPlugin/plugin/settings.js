// Settings arrive from the host and the panel as loose values and may predate this version. Each
// one is checked against a closed list or a pattern, so nothing saved in a profile can reach a
// command, and a key always has something sensible to show.
import { ID_PATTERN } from './soundpad/identity.js';
import { MAX_SOUND_INDEX } from './soundpad/protocol.js';

export const OUTPUTS = ['both', 'speakers', 'mic', 'default'];
export const PLAY_MODES = ['pause', 'play', 'toggle', 'restart'];
export const ICONS = ['play', 'note', 'horn', 'laugh', 'bell', 'mic', 'star', 'heart', 'bolt', 'fire', 'none'];
export const BACKGROUNDS = ['black', 'graphite'];
export const ACCENTS = ['white', 'cyan', 'violet', 'orange', 'pink'];
export const CONTROL_ACTIONS = ['stop', 'pause', 'next', 'previous', 'random', 'replay', 'volumeUp', 'volumeDown', 'mute'];
const MAX_LABEL = 40;
const CATEGORY_KEY = /^(all|c[0-9a-f]{16})$/;

const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

/** Checkboxes come as booleans from this panel, and as 'on' or strings from older ones or other tools. */
export function flag(value, fallback) {
  if (value === true || value === 'true' || value === 'on' || value === '1') return true;
  if (value === false || value === 'false' || value === 'off' || value === '0') return false;
  return fallback;
}

export function integer(value, min, max, fallback) {
  const number = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

export const categoryKey = (value) => (CATEGORY_KEY.test(String(value ?? '')) ? String(value) : '');

const appearance = (raw) => ({
  background: oneOf(raw.background, BACKGROUNDS, BACKGROUNDS[0]),
  showTitle: flag(raw.showTitle, true),
});

/** A favorite: one fixed sound on one key. */
export function normalizeSoundSettings(raw = {}) {
  const soundId = ID_PATTERN.test(String(raw.soundId ?? '')) ? String(raw.soundId) : '';
  const soundAlt = ID_PATTERN.test(String(raw.soundAlt ?? '')) ? String(raw.soundAlt) : '';
  const bound = Boolean(soundId || soundAlt);
  return {
    soundId,
    soundAlt,
    soundIndex: bound ? integer(raw.soundIndex, 1, MAX_SOUND_INDEX, 0) : 0,
    soundTitle: bound ? text(raw.soundTitle, 120) : '',
    label: text(raw.label, MAX_LABEL),
    icon: oneOf(raw.icon, ICONS, ICONS[0]),
    accent: oneOf(raw.accent, ACCENTS, ACCENTS[0]),
    output: oneOf(raw.output, OUTPUTS, OUTPUTS[0]),
    mode: oneOf(raw.mode, PLAY_MODES, PLAY_MODES[0]),
    ...appearance(raw),
  };
}

/** @returns {import('./soundpad/identity.js').SoundRef | null} */
export const soundRef = (settings) => (settings.soundId || settings.soundAlt
  ? { id: settings.soundId, alt: settings.soundAlt, index: settings.soundIndex }
  : null);

/** Playback controls that do not name a sound. */
export function normalizeControlSettings(raw = {}) {
  return {
    action: oneOf(raw.action, CONTROL_ACTIONS, CONTROL_ACTIONS[0]),
    output: oneOf(raw.output, OUTPUTS.filter((output) => output !== 'default'), 'both'),
    accent: oneOf(raw.accent, ACCENTS, ACCENTS[0]),
    ...appearance(raw),
  };
}
