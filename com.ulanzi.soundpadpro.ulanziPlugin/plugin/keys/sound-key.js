// A favorite: one sound on one key, found again by what it is, never by where it was.
import { normalizeSoundSettings, soundRef } from '../settings.js';
import { BaseKey, PRESSED, connectionView } from './base-key.js';

export class SoundKey extends BaseKey {
  settings = normalizeSoundSettings();
  #sub;

  constructor(context, deps) {
    super(context, deps);
    this.#sub = this.service.subscribe({ active: this.active, onChange: (what) => this.onServiceChange(what), wantsProgress: true });
  }

  updateSettings(param) {
    this.settings = normalizeSoundSettings(param);
    this.refresh();
  }

  onActiveChanged(active) {
    this.#sub.setActive(active);
  }

  onServiceChange(what) {
    if (what === 'library') this.#keepHintFresh();
    this.refresh();
  }

  /** @returns {import('../soundpad/identity.js').Resolution | null} null while there is no list yet */
  resolution() {
    const { library } = this.service;
    if (!library) return null;
    return library.resolve(soundRef(this.settings));
  }

  /**
   * After the list changes, saves where the sound is now and what it is called, so the panel shows
   * it and the hint picks the right copy of a file listed twice. Only when something changed.
   */
  #keepHintFresh() {
    const found = this.resolution();
    if (found?.status !== 'ok') return;
    const { sound } = found;
    const { soundIndex, soundTitle, soundId } = this.settings;
    if (soundIndex === sound.index && soundTitle === sound.title && (soundId === sound.id || !sound.id)) return;
    this.settings = { ...this.settings, soundIndex: sound.index, soundTitle: sound.title, soundId: sound.id || soundId };
    this.host.sendParamFromPlugin(this.settings, this.context);
  }

  buildView() {
    const { settings } = this;
    const t = (key) => this.host.t(key);
    const base = { background: settings.background, accent: settings.accent };
    const name = (fallback) => (settings.showTitle ? settings.label || fallback : '');
    const symbol = settings.icon === 'none' ? 'blank' : settings.icon;
    if (!soundRef(settings)) return { ...base, state: 'ready', symbol: 'note', title: t('Choose a sound') };
    const found = this.resolution();
    if (!found) {
      return connectionView(this.service, t, settings.background) ?? { ...base, state: 'loading', symbol: 'dots', title: name(settings.soundTitle) };
    }
    if (found.status !== 'ok') return { ...base, state: 'unavailable', symbol, title: name(settings.soundTitle) || t('Sound not found') };
    const offline = connectionView(this.service, t, settings.background);
    if (offline && offline.state === 'error') return { ...offline, title: name(found.sound.title) || offline.title };
    const state = this.#playState(found.sound);
    return { ...base, state, symbol, title: name(found.sound.title), ...this.#feedback(state, found.sound) };
  }

  /** The corner mark when idle, and the bar while this key's sound plays or is paused. */
  #feedback(state, sound) {
    if (!this.settings.feedback) return {};
    if (state === 'ready') return { idle: true };
    return { progress: this.service.progressFor(sound.id) };
  }

  #playState(sound) {
    if (!this.settings.feedback) return 'ready';
    const playing = this.service.nowPlaying;
    if (!playing || !sound.id || playing.id !== sound.id) return 'ready';
    if (this.service.playStatus === 'PAUSED') return 'paused';
    return this.service.playStatus === 'STOPPED' ? 'ready' : 'playing';
  }

  status() {
    const found = this.resolution();
    return {
      kind: 'sound',
      sound: found ? found.status : 'loading',
      title: found?.status === 'ok' ? found.sound.title : this.settings.soundTitle,
      relinked: found?.status === 'ok' && found.relinked,
    };
  }

  async run() {
    const ref = soundRef(this.settings);
    if (!ref) {
      this.alert();
      return;
    }
    const { result } = await this.service.playSound(ref, { output: this.settings.output, mode: this.settings.mode });
    if (!PRESSED.has(result)) this.alert();
    this.refresh();
  }

  destroy() {
    super.destroy();
    this.#sub.close();
  }
}
