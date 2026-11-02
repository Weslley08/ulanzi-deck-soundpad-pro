// What the settings panel may ask the plugin. Every field is checked here: the panel is a web page,
// and what it sends is treated as input, never as a command.
import { ID_PATTERN } from './soundpad/identity.js';
import { ALL_SOUNDS, searchText } from './soundpad/library.js';
import { MAX_SOUND_INDEX } from './soundpad/protocol.js';
import { categoryKey, groupId, integer } from './settings.js';

export const MAX_RESULTS = 200;
const MAX_CATEGORIES = 500;
const MAX_QUERY = 80;

/** @param {import('./soundpad/library.js').Library | null} library */
export function librarySummary(library) {
  if (!library) return { type: 'library', ready: false };
  return {
    type: 'library',
    ready: true,
    revision: library.revision,
    count: library.count,
    categoriesKnown: library.categoriesKnown,
    categories: library.categories.slice(0, MAX_CATEGORIES).map(({ key, name, depth, sounds }) => ({ key, name, depth, count: sounds.length })),
  };
}

/**
 * @param {import('./soundpad/library.js').Library | null} library
 * @param {{ q?: unknown, category?: unknown, limit?: unknown }} request
 */
export function searchSounds(library, request) {
  const q = String(request?.q ?? '').trim().slice(0, MAX_QUERY);
  const category = categoryKey(request?.category) || ALL_SOUNDS;
  const limit = integer(request?.limit, 1, MAX_RESULTS, MAX_RESULTS);
  if (!library) return { type: 'sounds', q, category, items: [], total: 0, ready: false };
  const words = searchText(q).split(/\s+/).filter(Boolean);
  const pool = library.category(category)?.sounds ?? [];
  const matches = words.length
    ? pool.filter((sound) => {
      const haystack = searchText(`${sound.title} ${sound.artist}`);
      return words.every((word) => haystack.includes(word));
    })
    : pool;
  // Names shared by several sounds are told apart by artist, length and position in the panel.
  const titles = new Map();
  for (const sound of matches) titles.set(sound.title, (titles.get(sound.title) ?? 0) + 1);
  return {
    type: 'sounds',
    q,
    category,
    total: matches.length,
    ready: true,
    items: matches.slice(0, limit).map(({ id, alt, index, title, artist, duration }) => ({
      id, alt, index, title, artist, duration, duplicate: titles.get(title) > 1,
    })),
  };
}

/** A sound named by the panel, accepted only in the shape the plugin itself sent. */
export function soundRefFrom(payload) {
  const id = ID_PATTERN.test(String(payload?.id ?? '')) ? String(payload.id) : '';
  const alt = ID_PATTERN.test(String(payload?.alt ?? '')) ? String(payload.alt) : '';
  if (!id && !alt) return null;
  return { id, alt, index: integer(payload?.index, 1, MAX_SOUND_INDEX, 0) };
}

/**
 * @param {import('./keys/base-key.js').BaseKey} key
 * @param {unknown} payload
 * @param {{ service: import('./soundpad/service.js').SoundpadService, store: import('./global-store.js').GlobalStore, version: string }} deps
 */
export async function handleInspectorMessage(key, payload, { service, store, version }) {
  const reply = (message) => key.host.sendToPropertyInspector(message, key.context);
  switch (payload?.type) {
    case 'hello':
      key.pushStatus(true);
      reply({ type: 'about', version });
      reply(librarySummary(service.library));
      return;
    case 'library':
      reply(librarySummary(service.library));
      return;
    case 'search':
      reply(searchSounds(service.library, payload));
      return;
    case 'refresh':
      if (service.state === 'connected') await service.refreshLibrary();
      else await service.reconnect();
      reply(librarySummary(service.library));
      key.pushStatus(true);
      return;
    case 'reconnect':
      await service.reconnect();
      key.pushStatus(true);
      return;
    case 'preview': {
      const ref = soundRefFrom(payload);
      if (!ref) return;
      // A preview goes to the speakers only, so nobody on a call hears the user browsing.
      const { result } = await service.playSound(ref, { output: 'speakers', mode: 'restart' });
      reply({ type: 'preview', result });
      return;
    }
    case 'stopPreview':
      await service.control('stop');
      return;
    case 'groupOptions':
      store.setGroupOptions(groupId(payload.group), payload.options ?? {});
      return;
    default:
  }
}
