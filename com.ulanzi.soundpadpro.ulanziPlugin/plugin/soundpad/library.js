// The sound list and categories, as read from Soundpad, in the form keys and the panel use.
import { createHash } from 'node:crypto';
import { categoryId, fileId, metaId, resolveSound } from './identity.js';
import { MAX_SOUND_INDEX } from './protocol.js';

export const ALL_SOUNDS = 'all';
export const MAX_TITLE = 120;
const CATEGORY_SEPARATOR = ' › ';

/** Last part of a path, without its extension: Soundpad leaves the title empty for some files. */
function fileTitle(url) {
  const name = String(url ?? '').split(/[\\/]/).pop() ?? '';
  return name.replace(/\.[^.]{1,5}$/, '');
}

const clean = (text, max = MAX_TITLE) => String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const isTrue = (value) => value === 'true' || value === '1';

/** @param {import('./xml.js').XmlElement} element */
function soundFrom(element) {
  const index = Number(element.attrs.index);
  if (!Number.isInteger(index) || index < 1 || index > MAX_SOUND_INDEX) return null;
  const { url = '', artist = '', duration = '' } = element.attrs;
  const title = clean(element.attrs.title) || clean(fileTitle(url));
  const entry = {
    index,
    id: fileId(url),
    alt: metaId({ title, artist, duration }),
    title,
    artist: clean(artist, 80),
    duration: clean(duration, 16),
  };
  return entry.id || entry.alt ? entry : null;
}

/**
 * @typedef {import('./identity.js').SoundEntry} SoundEntry
 * @typedef {{ key: string, name: string, depth: number, sounds: SoundEntry[] }} CategoryEntry
 */

export class Library {
  /**
   * @param {SoundEntry[]} sounds in Soundpad's order
   * @param {CategoryEntry[]} categories without the "all sounds" entry, which is added here
   * @param {{ categoriesKnown?: boolean, fetchedAt?: number }} [details]
   */
  constructor(sounds, categories, { categoriesKnown = true, fetchedAt = Date.now() } = {}) {
    this.sounds = sounds;
    this.categoriesKnown = categoriesKnown;
    this.fetchedAt = fetchedAt;
    this.byIndex = new Map(sounds.map((sound) => [sound.index, sound]));
    this.byId = new Map();
    this.byAlt = new Map();
    for (const sound of sounds) {
      if (sound.id) this.byId.set(sound.id, [...(this.byId.get(sound.id) ?? []), sound]);
      if (sound.alt) this.byAlt.set(sound.alt, [...(this.byAlt.get(sound.alt) ?? []), sound]);
    }
    /** @type {CategoryEntry[]} */
    this.categories = [{ key: ALL_SOUNDS, name: '', depth: 0, sounds }, ...categories];
    this.byCategory = new Map(this.categories.map((category) => [category.key, category]));
    // Changes when anything a key or the panel shows changes, and only then.
    this.revision = createHash('sha256')
      .update(sounds.map((sound) => `${sound.index}:${sound.id}:${sound.alt}:${sound.title}`).join('\n'))
      .update('\0')
      .update(categories.map((category) => `${category.key}:${category.sounds.map((sound) => sound.index).join(',')}`).join('\n'))
      .digest('hex')
      .slice(0, 16);
  }

  get count() {
    return this.sounds.length;
  }

  /** @param {import('./identity.js').SoundRef | null} ref */
  resolve(ref) {
    return resolveSound(ref, this);
  }

  /** @returns {CategoryEntry | null} */
  category(key) {
    return this.byCategory.get(key) ?? null;
  }

  /**
   * @param {import('./xml.js').XmlElement} soundlist the answer to GetSoundlist()
   * @param {import('./xml.js').XmlElement | null} categoryTree the answer to GetCategories(true, false),
   *   or null when this Soundpad has no categories command
   */
  static fromXml(soundlist, categoryTree, fetchedAt = Date.now()) {
    if (soundlist?.name !== 'Soundlist') throw new TypeError('not a sound list');
    const seen = new Set();
    const sounds = [];
    for (const element of soundlist.children) {
      if (element.name !== 'Sound') continue;
      const sound = soundFrom(element);
      // A repeated index would make two keys disagree about what one position plays.
      if (!sound || seen.has(sound.index)) continue;
      seen.add(sound.index);
      sounds.push(sound);
    }
    sounds.sort((a, b) => a.index - b.index);
    const byIndex = new Map(sounds.map((sound) => [sound.index, sound]));
    const categories = categoryTree?.name === 'Categories' ? flattenCategories(categoryTree, byIndex) : [];
    return new Library(sounds, categories, { categoriesKnown: categoryTree?.name === 'Categories', fetchedAt });
  }
}

/** Nested categories become one list, each named by its path, in Soundpad's order. */
function flattenCategories(tree, byIndex) {
  /** @type {CategoryEntry[]} */
  const out = [];
  const occurrences = new Map();
  const visit = (element, parents) => {
    for (const child of element.children) {
      if (child.name !== 'Category') continue;
      const name = clean(child.attrs.name, 80);
      const path = [...parents, name || '?'];
      // A hidden category is left out with everything under it.
      if (isTrue(child.attrs.hidden)) continue;
      const label = path.join(CATEGORY_SEPARATOR);
      const occurrence = (occurrences.get(label) ?? 0) + 1;
      occurrences.set(label, occurrence);
      const sounds = [];
      const inCategory = new Set();
      for (const entry of child.children) {
        if (entry.name !== 'Sound') continue;
        const sound = byIndex.get(Number(entry.attrs.index));
        if (sound && !inCategory.has(sound.index)) {
          inCategory.add(sound.index);
          sounds.push(sound);
        }
      }
      out.push({ key: categoryId(label, occurrence), name: occurrence > 1 ? `${label} (${occurrence})` : label, depth: parents.length, sounds });
      visit(child, path);
    }
  };
  visit(tree, []);
  return out;
}

/** Plain text for matching typed searches: no case, no accents. */
export const searchText = (text) => String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
