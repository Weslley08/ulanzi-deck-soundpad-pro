// Playback controls that do not name a sound: stop, pause, next, previous, random, replay, volume.
import { normalizeControlSettings } from '../settings.js';
import { BaseKey, connectionView } from './base-key.js';

const VOLUME_ACTIONS = new Set(['volumeUp', 'volumeDown', 'mute']);
// These show Soundpad's own state, so they need to hear about sounds started elsewhere.
const STATUS_ACTIONS = new Set(['stop', 'pause']);

export class ControlKey extends BaseKey {
  settings = normalizeControlSettings();
  #sub = null;

  updateSettings(param) {
    const next = normalizeControlSettings(param);
    const needsChanged = !this.#sub || VOLUME_ACTIONS.has(next.action) !== VOLUME_ACTIONS.has(this.settings.action)
      || STATUS_ACTIONS.has(next.action) !== STATUS_ACTIONS.has(this.settings.action);
    this.settings = next;
    if (needsChanged) {
      // Subscribing again with what this action needs, before closing the old one, so the
      // connection never drops in between.
      const old = this.#sub;
      this.#sub = this.service.subscribe({
        active: this.active,
        onChange: () => this.refresh(),
        wantsVolume: VOLUME_ACTIONS.has(next.action),
        wantsStatus: STATUS_ACTIONS.has(next.action),
      });
      old?.close();
    }
    this.refresh();
  }

  onActiveChanged(active) {
    this.#sub?.setActive(active);
  }

  buildView() {
    const { action, background, accent, showTitle } = this.settings;
    const t = (key) => this.host.t(key);
    const offline = connectionView(this.service, t, background);
    if (offline) return { ...offline, symbol: offline.state === 'loading' ? 'dots' : offline.symbol, title: showTitle ? offline.title : '' };
    const view = { background, accent, state: 'ready', symbol: action };
    const status = this.service.playStatus;
    if (action === 'pause') {
      if (status === 'PAUSED') return { ...view, state: 'paused', symbol: 'play' };
      return status === 'STOPPED' ? { ...view, state: 'disabled' } : view;
    }
    if (action === 'stop') return status === 'STOPPED' ? { ...view, state: 'disabled' } : { ...view, state: 'playing' };
    if (VOLUME_ACTIONS.has(action)) {
      const volume = this.service.volume;
      const badge = volume ? `${volume.volume}%` : '';
      if (action === 'mute') return { ...view, symbol: volume?.muted ? 'mute' : 'speaker', state: volume?.muted ? 'paused' : 'ready', badge };
      return { ...view, badge };
    }
    return view;
  }

  status() {
    return { kind: 'control', action: this.settings.action, volume: this.service.volume };
  }

  async run() {
    const { result } = await this.service.control(this.settings.action, { output: this.settings.output });
    if (result !== 'done') this.alert();
    this.refresh();
  }

  destroy() {
    super.destroy();
    this.#sub?.close();
    this.#sub = null;
  }
}
