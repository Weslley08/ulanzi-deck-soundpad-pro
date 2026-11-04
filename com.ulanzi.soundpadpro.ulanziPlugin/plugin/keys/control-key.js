// Playback controls that do not name a sound: stop, pause, next, previous, random, replay, volume.
import { normalizeControlSettings } from '../settings.js';
import { microphone } from '../system/microphone.js';
import { VOLUME_BIG_STEP } from '../soundpad/service.js';
import { BaseKey, connectionView } from './base-key.js';

// Holding a volume key: after this long it moves by ten, again at this pace, and it gives up after the
// maximum in case the release never arrives.
export const HOLD_DELAY_MS = 500;
export const HOLD_REPEAT_MS = 300;
export const HOLD_MAX_MS = 10_000;

const VOLUME_ACTIONS = new Set(['volumeUp', 'volumeDown', 'mute']);
// These show Soundpad's own state, so they need to hear about sounds started elsewhere.
const STATUS_ACTIONS = new Set(['stop', 'pause']);

export class ControlKey extends BaseKey {
  settings = normalizeControlSettings();
  #sub = null;
  #timers;
  /** @type {any} */
  #holdTimer = null;
  /** @type {any} */
  #holdStop = null;
  #holdBusy = false;
  #microphone;
  /** Whether Windows has the microphone muted, as of the last time it was asked. Null before that. */
  #micMuted = null;

  constructor(context, deps) {
    super(context, deps);
    this.#timers = deps.timers ?? globalThis;
    this.#microphone = deps.microphone ?? microphone;
  }

  updateSettings(param) {
    const next = normalizeControlSettings(param);
    const needsChanged = !this.#sub || VOLUME_ACTIONS.has(next.action) !== VOLUME_ACTIONS.has(this.settings.action)
      || STATUS_ACTIONS.has(next.action) !== STATUS_ACTIONS.has(this.settings.action);
    this.settings = next;
    if (next.action === 'micMute') {
      // The microphone is Windows', not Soundpad's, so this key needs no connection to Soundpad.
      this.#sub?.close();
      this.#sub = null;
      this.#readMicrophone();
      this.refresh();
      return;
    }
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
    if (!active) this.#stopHold();
    // It may have been changed elsewhere while the deck was not showing.
    else if (this.settings.action === 'micMute') this.#readMicrophone();
  }

  async #readMicrophone() {
    try {
      const { muted } = await this.#microphone('read');
      if (this.destroyed || muted === this.#micMuted) return;
      this.#micMuted = muted;
      this.refresh();
    } catch {
      // The key shows its normal face until a press says more.
    }
  }

  pressStart() {
    const { action } = this.settings;
    if (action !== 'volumeUp' && action !== 'volumeDown') return;
    this.#stopHold();
    this.#holdTimer = this.#timers.setTimeout(() => {
      this.#holdTimer = this.#timers.setInterval(() => this.#holdTick(), HOLD_REPEAT_MS);
      return this.#holdTick();
    }, HOLD_DELAY_MS);
    this.#holdStop = this.#timers.setTimeout(() => this.#stopHold(), HOLD_MAX_MS);
  }

  pressEnd() {
    this.#stopHold();
  }

  async #holdTick() {
    // One change at a time: a slow Soundpad must not pile requests up.
    if (this.#holdBusy) return;
    this.#holdBusy = true;
    try {
      const { result } = await this.service.control(this.settings.action, { step: VOLUME_BIG_STEP });
      if (result !== 'done') {
        this.alert();
        this.#stopHold();
      }
      this.refresh();
    } finally {
      this.#holdBusy = false;
    }
  }

  #stopHold() {
    if (this.#holdTimer !== null) {
      // It is a timeout first and an interval after, and both clear the same way.
      this.#timers.clearTimeout(this.#holdTimer);
      this.#timers.clearInterval(this.#holdTimer);
      this.#holdTimer = null;
    }
    if (this.#holdStop !== null) {
      this.#timers.clearTimeout(this.#holdStop);
      this.#holdStop = null;
    }
  }

  buildView() {
    const { action, background, accent, showTitle } = this.settings;
    const t = (key) => this.host.t(key);
    if (action === 'micMute') {
      const muted = this.#micMuted === true;
      return { background, accent, state: muted ? 'paused' : 'ready', symbol: muted ? 'micOff' : 'mic', title: showTitle ? t(muted ? 'Microphone muted' : 'Microphone on') : '' };
    }
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
    if (this.settings.action === 'micMute') {
      try {
        this.#micMuted = (await this.#microphone('toggle')).muted;
      } catch {
        this.alert();
      }
      this.refresh();
      return;
    }
    const { result } = await this.service.control(this.settings.action, { output: this.settings.output });
    if (result !== 'done') this.alert();
    this.refresh();
  }

  destroy() {
    this.#stopHold();
    super.destroy();
    this.#sub?.close();
    this.#sub = null;
  }
}
