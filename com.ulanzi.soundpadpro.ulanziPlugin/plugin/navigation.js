// Navigator groups: a set of position keys that show one page of the library, and the keys that move
// it. Each group keeps its own place, so two groups never move each other, and favorites are never
// part of any group. A group only redraws keys of this plugin that joined it.
import { ALL_SOUNDS } from './soundpad/library.js';
import { MAX_PAGE, normalizeGroupOptions, normalizeNavState } from './settings.js';

/**
 * @typedef {import('./soundpad/library.js').Library} Library
 * @typedef {{ kind: 'category', category: import('./soundpad/library.js').CategoryEntry }
 *   | { kind: 'sound', sound: import('./soundpad/identity.js').SoundEntry }
 *   | { kind: 'empty', reason: 'end' | 'emptyCategory' | 'noLibrary' }} SlotItem
 */

export class GroupNavigator {
  /** @type {Map<string, number>} context to position */
  #slots = new Map();
  /** @type {Set<string>} contexts of the keys that move this group */
  #controls = new Set();
  #options = normalizeGroupOptions();
  #state = normalizeNavState();
  #savedState = null;
  #moved = false;

  /**
   * @param {string} id
   * @param {{ library: () => Library | null, onChange: (navigator: GroupNavigator) => void, saveState: (id: string, state: object | null) => void }} hooks
   */
  constructor(id, { library, onChange, saveState }) {
    this.id = id;
    this.library = library;
    this.onChange = onChange;
    this.saveState = saveState;
  }

  get options() {
    return this.#options;
  }

  get state() {
    return { ...this.#state };
  }

  get isEmpty() {
    return !this.#slots.size && !this.#controls.size;
  }

  /** Position keys present on the deck, so the panel can say how many pages hold. */
  get positionsOnDeck() {
    return this.#slots.size ? Math.max(...this.#slots.values()) : 0;
  }

  get pageSize() {
    return Math.max(1, this.#options.positions || this.positionsOnDeck);
  }

  joinSlot(context, position) {
    const before = this.pageSize;
    this.#slots.set(context, position);
    if (this.pageSize !== before) this.#clampAndNotify();
  }

  joinControl(context) {
    this.#controls.add(context);
  }

  leave(context) {
    const before = this.pageSize;
    this.#slots.delete(context);
    this.#controls.delete(context);
    if (!this.isEmpty && this.pageSize !== before) this.#clampAndNotify();
  }

  /** Options set in the panel, and the place remembered from the last session. */
  configure(options, savedState) {
    const next = normalizeGroupOptions(options);
    const changed = JSON.stringify(next) !== JSON.stringify(this.#options);
    this.#options = next;
    this.#savedState = savedState ? normalizeNavState(savedState) : null;
    // A place the user already moved to this session wins over the saved one.
    if (!this.#moved) this.#state = this.#startingState();
    if (!this.#options.persist) this.saveState(this.id, null);
    if (changed || !this.#moved) this.#clampAndNotify();
  }

  #startingState() {
    if (this.#options.persist && this.#savedState) return { ...this.#savedState };
    const { startCategory, startPage } = this.#options;
    return normalizeNavState({ mode: startCategory ? 'sounds' : 'categories', category: startCategory, page: startPage - 1 });
  }

  /** @returns {SlotItem[]} everything in the current list */
  #items(library) {
    if (this.#state.mode === 'categories') return library.categories.map((category) => ({ kind: 'category', category }));
    const category = library.category(this.#state.category);
    return (category?.sounds ?? []).map((sound) => ({ kind: 'sound', sound }));
  }

  get pageCount() {
    const library = this.library();
    if (!library) return 1;
    return Math.max(1, Math.ceil(this.#items(library).length / this.pageSize));
  }

  /** The current category, or null while the categories are listed. */
  get category() {
    if (this.#state.mode !== 'sounds') return null;
    return this.library()?.category(this.#state.category) ?? null;
  }

  /** @returns {SlotItem} */
  itemAt(position) {
    const library = this.library();
    if (!library) return { kind: 'empty', reason: 'noLibrary' };
    const items = this.#items(library);
    if (!items.length && this.#state.mode === 'sounds') return position === 1 ? { kind: 'empty', reason: 'emptyCategory' } : { kind: 'empty', reason: 'end' };
    if (position > this.pageSize) return { kind: 'empty', reason: 'end' };
    return items[this.#state.page * this.pageSize + position - 1] ?? { kind: 'empty', reason: 'end' };
  }

  /** A position key was pressed on a category: open it. */
  openCategory(key) {
    if (!this.library()?.category(key)) return;
    this.#move({ mode: 'sounds', category: key, page: 0 });
  }

  /**
   * One of the navigator buttons.
   * @param {'nextPage'|'previousPage'|'nextCategory'|'previousCategory'|'back'} action
   * @returns {boolean} whether anything moved
   */
  press(action) {
    const library = this.library();
    if (!library) return false;
    const pages = this.pageCount;
    switch (action) {
      case 'nextPage':
      case 'previousPage': {
        if (pages < 2) return false;
        const step = action === 'nextPage' ? 1 : -1;
        this.#move({ ...this.#state, page: (this.#state.page + step + pages) % pages });
        return true;
      }
      case 'nextCategory':
      case 'previousCategory': {
        const { categories } = library;
        if (categories.length < 2 && this.#state.mode === 'sounds') return false;
        const current = categories.findIndex((category) => category.key === this.#state.category);
        const step = action === 'nextCategory' ? 1 : -1;
        // From the category list, the first press opens the first or last category.
        const next = current < 0 ? (step > 0 ? 0 : categories.length - 1) : (current + step + categories.length) % categories.length;
        this.#move({ mode: 'sounds', category: categories[next].key, page: 0 });
        return true;
      }
      case 'back':
        if (this.#state.mode === 'categories') return false;
        this.#move({ mode: 'categories', category: '', page: this.#pageHolding(library, this.#state.category) });
        return true;
      default:
        return false;
    }
  }

  /** Back lands on the page of the category list that holds the category just left. */
  #pageHolding(library, key) {
    const index = library.categories.findIndex((category) => category.key === key);
    return index < 0 ? 0 : Math.floor(index / this.pageSize);
  }

  /** Whether a navigator button can do anything now, so it can look disabled when not. */
  canPress(action) {
    const library = this.library();
    if (!library) return false;
    if (action === 'nextPage' || action === 'previousPage') return this.pageCount > 1;
    if (action === 'back') return this.#state.mode === 'sounds';
    if (action === 'nextCategory' || action === 'previousCategory') return library.categories.length > 1 || this.#state.mode === 'categories';
    return true;
  }

  /** The neighbouring category, for the labels of the category buttons. */
  neighbourKey(action) {
    const library = this.library();
    if (!library) return '';
    const { categories } = library;
    const current = categories.findIndex((category) => category.key === this.#state.category);
    const step = action === 'nextCategory' ? 1 : -1;
    const next = current < 0 ? (step > 0 ? 0 : categories.length - 1) : (current + step + categories.length) % categories.length;
    return categories[next]?.key ?? '';
  }

  /** The library changed: the current category may be gone, or the page past the end. */
  libraryChanged() {
    this.#clampAndNotify();
  }

  #move(state) {
    this.#moved = true;
    this.#state = normalizeNavState(state);
    this.#clamp();
    if (this.#options.persist) this.saveState(this.id, this.#state);
    this.onChange(this);
  }

  #clamp() {
    const library = this.library();
    if (!library) return;
    if (this.#state.mode === 'sounds' && !library.category(this.#state.category)) {
      this.#state = { mode: 'categories', category: '', page: 0 };
    }
    const last = Math.min(this.pageCount - 1, MAX_PAGE);
    if (this.#state.page > last) this.#state = { ...this.#state, page: last };
  }

  #clampAndNotify() {
    this.#clamp();
    this.onChange(this);
  }
}

/** Every group on the deck, created when its first key appears and dropped with its last. */
export class NavigationRegistry {
  /** @type {Map<string, GroupNavigator>} */
  #groups = new Map();
  #hooks;
  #global = { groups: {}, nav: {} };

  /**
   * @param {{ library: () => Library | null, onChange: (navigator: GroupNavigator) => void, saveState: (id: string, state: object | null) => void }} hooks
   */
  constructor(hooks) {
    this.#hooks = hooks;
  }

  /** @returns {GroupNavigator} */
  join(id) {
    let navigator = this.#groups.get(id);
    if (!navigator) {
      navigator = new GroupNavigator(id, this.#hooks);
      navigator.configure(this.#global.groups[id] ?? {}, this.#global.nav[id] ?? null);
      this.#groups.set(id, navigator);
    }
    return navigator;
  }

  leave(id, context) {
    const navigator = this.#groups.get(id);
    if (!navigator) return;
    navigator.leave(context);
    if (navigator.isEmpty) this.#groups.delete(id);
  }

  get(id) {
    return this.#groups.get(id) ?? null;
  }

  get size() {
    return this.#groups.size;
  }

  /** Global settings arrived or changed. */
  applyGlobal(global) {
    this.#global = global;
    for (const [id, navigator] of this.#groups) navigator.configure(global.groups[id] ?? {}, global.nav[id] ?? null);
  }

  libraryChanged() {
    for (const navigator of this.#groups.values()) navigator.libraryChanged();
  }
}

export { ALL_SOUNDS };
