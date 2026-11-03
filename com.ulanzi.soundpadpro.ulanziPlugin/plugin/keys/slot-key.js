// One position of a navigator group: shows a category or a sound from the group's current page.
import { ALL_SOUNDS } from '../soundpad/library.js';
import { normalizeSlotSettings } from '../settings.js';
import { BaseKey, PRESSED, connectionView } from './base-key.js';

export class SlotKey extends BaseKey {
  settings = normalizeSlotSettings();
  /** @type {import('../navigation.js').GroupNavigator | null} */
  navigator = null;
  #sub;
  #registry;

  /**
   * @param {string} context
   * @param {object} deps
   * @param {import('../navigation.js').NavigationRegistry} deps.registry
   */
  constructor(context, deps) {
    super(context, deps);
    this.#registry = deps.registry;
    this.#sub = this.service.subscribe({ active: this.active, onChange: () => this.refresh(), wantsProgress: true });
  }

  updateSettings(param) {
    const next = normalizeSlotSettings(param);
    if (next.group !== this.settings.group || !this.navigator) {
      if (this.navigator) this.#registry.leave(this.settings.group, this.context);
      this.navigator = this.#registry.join(next.group);
    }
    this.settings = next;
    this.navigator.joinSlot(this.context, next.position);
    this.refresh();
  }

  onActiveChanged(active) {
    this.#sub.setActive(active);
  }

  item() {
    return this.navigator?.itemAt(this.settings.position) ?? { kind: 'empty', reason: 'noLibrary' };
  }

  buildView() {
    const { settings } = this;
    const t = (key) => this.host.t(key);
    const base = { background: settings.background };
    const item = this.item();
    const title = (text) => (settings.showTitle ? text : '');
    if (item.kind === 'empty') {
      if (item.reason === 'noLibrary') return connectionView(this.service, t, settings.background) ?? { ...base, state: 'loading', symbol: 'dots' };
      if (item.reason === 'emptyCategory') return { ...base, state: 'unavailable', symbol: 'folder', title: t('Empty category') };
      return { ...base, state: 'disabled', symbol: 'blank' };
    }
    const offline = connectionView(this.service, t, settings.background);
    if (offline?.state === 'error') return offline;
    if (item.kind === 'category') {
      const all = item.category.key === ALL_SOUNDS;
      return {
        ...base,
        state: 'ready',
        symbol: all ? 'all' : 'folder',
        title: title(all ? t('All sounds') : item.category.name),
        badge: String(item.category.sounds.length),
      };
    }
    const state = this.#playState(item.sound);
    const feedback = !settings.feedback ? {} : state === 'ready' ? { idle: true } : { progress: this.service.progressFor(item.sound.id) };
    return { ...base, state, symbol: 'note', title: title(item.sound.title), ...feedback };
  }

  #playState(sound) {
    if (!this.settings.feedback) return 'ready';
    const playing = this.service.nowPlaying;
    if (!playing || playing.id !== sound.id || !sound.id) return 'ready';
    if (this.service.playStatus === 'PAUSED') return 'paused';
    return this.service.playStatus === 'STOPPED' ? 'ready' : 'playing';
  }

  status() {
    const navigator = this.navigator;
    return {
      kind: 'slot',
      group: this.settings.group,
      position: this.settings.position,
      ...(navigator ? groupStatus(navigator) : {}),
    };
  }

  async run() {
    const item = this.item();
    if (item.kind === 'category') {
      this.navigator.openCategory(item.category.key);
      return;
    }
    if (item.kind === 'sound') {
      const { output, mode } = this.navigator.options;
      const { result } = await this.service.playEntry(item.sound, { output, mode });
      if (!PRESSED.has(result)) this.alert();
      this.refresh();
      return;
    }
    // An empty position past the end does nothing; a key that cannot reach Soundpad has failed.
    if (item.reason === 'noLibrary') {
      this.alert();
      this.service.reconnect();
    }
  }

  destroy() {
    super.destroy();
    this.#sub.close();
    if (this.navigator) this.#registry.leave(this.settings.group, this.context);
    this.navigator = null;
  }
}

/** What the panel shows about a group, for any of its keys. */
export function groupStatus(navigator) {
  const { state, options } = navigator;
  const category = navigator.category;
  return {
    group: navigator.id,
    page: state.page + 1,
    pages: navigator.pageCount,
    mode: state.mode,
    category: category ? category.key : '',
    categoryName: category?.name ?? '',
    positionsOnDeck: navigator.positionsOnDeck,
    pageSize: navigator.pageSize,
    options,
  };
}
