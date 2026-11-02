// The buttons of a navigator group: pages, categories, back and refresh.
import { ALL_SOUNDS } from '../soundpad/library.js';
import { normalizeNavSettings } from '../settings.js';
import { BaseKey, connectionView } from './base-key.js';
import { groupStatus } from './slot-key.js';

const SYMBOLS = {
  nextPage: 'pageNext',
  previousPage: 'pagePrevious',
  nextCategory: 'categoryNext',
  previousCategory: 'categoryPrevious',
  back: 'back',
  refresh: 'refresh',
};

export class NavKey extends BaseKey {
  settings = normalizeNavSettings();
  /** @type {import('../navigation.js').GroupNavigator | null} */
  navigator = null;
  #sub;
  #registry;

  constructor(context, deps) {
    super(context, deps);
    this.#registry = deps.registry;
    this.#sub = this.service.subscribe({ active: this.active, onChange: () => this.refresh() });
  }

  updateSettings(param) {
    const next = normalizeNavSettings(param);
    if (next.group !== this.settings.group || !this.navigator) {
      if (this.navigator) this.#registry.leave(this.settings.group, this.context);
      this.navigator = this.#registry.join(next.group);
      this.navigator.joinControl(this.context);
    }
    this.settings = next;
    this.refresh();
  }

  onActiveChanged(active) {
    this.#sub.setActive(active);
  }

  buildView() {
    const { background, function: action } = this.settings;
    const t = (key) => this.host.t(key);
    const view = { background, state: 'ready', symbol: SYMBOLS[action] };
    if (action === 'refresh') {
      const offline = connectionView(this.service, t, background);
      return offline?.state === 'error' ? { ...offline, symbol: 'refresh' } : view;
    }
    const navigator = this.navigator;
    if (!navigator || !this.service.library) return connectionView(this.service, t, background) ?? { ...view, state: 'loading' };
    if (!navigator.canPress(action)) return { ...view, state: 'disabled' };
    if (action === 'nextPage' || action === 'previousPage') return { ...view, badge: `${navigator.state.page + 1}/${navigator.pageCount}` };
    if (action === 'back') return { ...view, title: navigator.category?.key === ALL_SOUNDS ? t('All sounds') : navigator.category?.name ?? '' };
    const neighbour = this.service.library.category(navigator.neighbourKey(action));
    return { ...view, title: neighbour?.key === ALL_SOUNDS ? t('All sounds') : neighbour?.name ?? '' };
  }

  status() {
    return { kind: 'nav', function: this.settings.function, ...(this.navigator ? groupStatus(this.navigator) : { group: this.settings.group }) };
  }

  async run() {
    const action = this.settings.function;
    if (action === 'refresh') {
      if (this.service.state === 'connected') await this.service.refreshLibrary();
      else await this.service.reconnect();
      if (this.service.state !== 'connected') this.alert();
      this.refresh();
      return;
    }
    if (!this.service.library) {
      this.alert();
      this.service.reconnect();
      return;
    }
    // A button with nowhere to go looks disabled, so pressing it is not a failure.
    this.navigator?.press(action);
  }

  destroy() {
    super.destroy();
    this.#sub.close();
    if (this.navigator) this.#registry.leave(this.settings.group, this.context);
    this.navigator = null;
  }
}
