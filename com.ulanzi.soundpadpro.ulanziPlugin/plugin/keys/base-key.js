// What every key does the same way: draw only when the face changed, never hold up a press for a
// render, stay quiet while hidden, and clean up after itself.
import { renderFace } from '../render/renderer.js';

/**
 * @typedef {{
 *   setBaseDataIcon(context: string, data: string): void,
 *   showAlert(context: string): void,
 *   sendToPropertyInspector(payload: object, context: string): void,
 *   sendParamFromPlugin(settings: object, context: string): void,
 *   logMessage(message: string, level?: string): void,
 *   t(key: string): string,
 * }} Host
 */

export class BaseKey {
  active = true;
  /** @type {string|null} */
  #lastView = null;
  /** @type {string|null} */
  #lastIcon = null;
  #renderToken = 0;
  /** @type {string|null} */
  #lastStatus = null;
  #destroyed = false;

  /**
   * @param {string} context
   * @param {{ host: Host, service: import('../soundpad/service.js').SoundpadService, render?: (view: object) => Promise<string> }} deps
   */
  constructor(context, { host, service, render = renderFace }) {
    this.context = context;
    this.host = host;
    this.service = service;
    this.renderImage = render;
  }

  get destroyed() {
    return this.#destroyed;
  }

  /** @returns {object} the face, see render/face.js */
  buildView() {
    throw new Error('not implemented');
  }

  /** @returns {object} what the panel shows about this key */
  status() {
    return {};
  }

  setActive(active) {
    if (active === this.active) return;
    this.active = active;
    this.onActiveChanged(active);
    if (active) this.redraw();
  }

  /** @param {boolean} _active */
  onActiveChanged(_active) {}

  /** Forgets what was sent. The screen may have been repainted, or Studio restarted. */
  redraw() {
    this.#lastView = null;
    this.#lastIcon = null;
    this.render();
  }

  /**
   * Draws in the background. A press never waits for this, and an unchanged face is not sent again.
   */
  async render() {
    if (!this.active || this.#destroyed) return;
    const view = this.buildView();
    const serialized = JSON.stringify(view);
    if (serialized === this.#lastView) return;
    this.#lastView = serialized;
    const token = ++this.#renderToken;
    let icon;
    try {
      icon = await this.renderImage(view);
    } catch (error) {
      this.host.logMessage(`render failed: ${error?.name}`, 'error');
      this.#lastView = null;
      return;
    }
    // A newer render already started, so this one is out of date.
    if (token !== this.#renderToken || !this.active || this.#destroyed || icon === this.#lastIcon) return;
    this.#lastIcon = icon;
    this.host.setBaseDataIcon(this.context, icon);
  }

  /** The panel only exists while its key is selected; the host drops messages for others. */
  pushStatus(force = false) {
    const status = { type: 'status', ...this.service.diagnostics(), ...this.status() };
    const serialized = JSON.stringify(status);
    if (!force && serialized === this.#lastStatus) return;
    this.#lastStatus = serialized;
    this.host.sendToPropertyInspector(status, this.context);
  }

  /** Something the key shows may have changed. */
  refresh() {
    this.render();
    this.pushStatus();
  }

  /** The store guideline asks for showAlert on every failed press. */
  alert() {
    this.host.showAlert(this.context);
  }

  destroy() {
    this.#destroyed = true;
    this.active = false;
    this.#renderToken += 1;
  }
}

/** The face shared by every key while Soundpad cannot be reached. */
export function connectionView(service, t, background) {
  if (service.state === 'connecting' && !service.library) return { background, state: 'loading', symbol: 'dots', title: '' };
  if (service.state === 'incompatible') return { background, state: 'error', symbol: 'warning', title: t('Update Soundpad') };
  if (service.state === 'offline' || service.state === 'disabled') return { background, state: 'error', symbol: 'offline', title: t('Soundpad closed') };
  return null;
}
