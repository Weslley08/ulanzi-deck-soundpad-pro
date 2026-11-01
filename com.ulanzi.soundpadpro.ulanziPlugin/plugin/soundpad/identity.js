// Soundpad identifies a sound only by its position in the list, and that position changes whenever
// sounds are added, removed or moved. A key that kept the position could play another sound after
// any of those. So a key keeps a fingerprint of what the sound is instead: a hash of its file, and
// a second hash of its title, artist and length for when the file was moved. Hashes, because a key's
// settings travel in exported profiles and a file path can name the user's account.
import { createHash } from 'node:crypto';

const ID_LENGTH = 24;
export const ID_PATTERN = /^[0-9a-f]{24}$/;

const digest = (text) => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, ID_LENGTH);

/** Windows paths ignore case and accept either slash, so both spellings of one file get one id. */
export function normalizeLocation(url) {
  const text = String(url ?? '').trim();
  if (!text) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) && !/^file:\/\//i.test(text)) return text;
  return text.replace(/^file:\/\/\/?/i, '').replaceAll('/', '\\').toLowerCase();
}

/** @returns {string} empty when Soundpad gave no location */
export function fileId(url) {
  const location = normalizeLocation(url);
  return location ? digest(`file\n${location}`) : '';
}

/** @returns {string} empty when there is nothing to tell the sound apart by */
export function metaId({ title, artist, duration }) {
  const name = String(title ?? '').trim().toLowerCase();
  if (!name) return '';
  return digest(`meta\n${name}\n${String(artist ?? '').trim().toLowerCase()}\n${String(duration ?? '').trim()}`);
}

/**
 * What a key saved about its sound. index is only a hint for picking between copies of one file.
 * @typedef {{ id: string, alt: string, index: number }} SoundRef
 */

/**
 * @typedef {{ index: number, id: string, alt: string, title: string, artist: string, duration: string }} SoundEntry
 * @typedef {{ status: 'ok', sound: SoundEntry, relinked: boolean } | { status: 'missing' | 'ambiguous' | 'unset' }} Resolution
 */

/**
 * Finds a saved sound in the current list, never by position alone.
 * @param {SoundRef | null} ref
 * @param {{ byId: Map<string, SoundEntry[]>, byAlt: Map<string, SoundEntry[]> }} library
 * @returns {Resolution}
 */
export function resolveSound(ref, library) {
  if (!ref || (!ref.id && !ref.alt)) return { status: 'unset' };
  const sameFile = ref.id ? library.byId.get(ref.id) ?? [] : [];
  if (sameFile.length) {
    // The same file twice in the list plays the same audio either way. Prefer the copy the key last
    // saw, then the first, so the choice does not move around.
    const sound = sameFile.find((entry) => entry.index === ref.index) ?? sameFile[0];
    return { status: 'ok', sound, relinked: false };
  }
  const sameMeta = ref.alt ? library.byAlt.get(ref.alt) ?? [] : [];
  if (sameMeta.length === 1) return { status: 'ok', sound: sameMeta[0], relinked: true };
  // Two sounds with the same title, artist and length, neither of them the saved file: guessing could
  // play the wrong one, so the key says it cannot find its sound.
  if (sameMeta.length > 1) return { status: 'ambiguous' };
  return { status: 'missing' };
}

/** Category names are shown, and their hash is what navigation remembers. */
export const categoryId = (path, occurrence = 1) => `c${digest(`category\n${path}\n${occurrence}`).slice(0, 16)}`;
