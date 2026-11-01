// Everything the keys need from Soundpad, through one connection and one copy of the library.
// Nothing here runs while no key is on the deck: the pipe closes and every timer stops.
import { fileId, metaId } from './identity.js';
import { Library } from './library.js';
import { PipeClient } from './pipe-client.js';
import { SoundpadError, compareVersions, supports } from './protocol.js';

export const SYNC_DEBOUNCE_MS = 250;
export const MANUAL_REFRESH_GAP_MS = 2_000;
// Sounds added in Soundpad show up within this long while keys are on screen. Asking for the count is
// a few bytes, and a change in it is what triggers reading the whole list again.
export const COUNT_CHECK_MS = 30_000;
export const ACTIVATION_CHECK_GAP_MS = 5_000;
export const PLAYING_POLL_MS = 500;
export const PAUSED_POLL_MS = 1_500;
// Only while a key that shows Soundpad's own state (pause, stop) is on screen: sounds started from
// Soundpad itself are noticed within this long.
export const IDLE_POLL_MS = 3_000;
export const VOLUME_STEP = 10;
export const MIN_RC_VERSION = '1.0.0';

const OUTPUTS = {
  both: [true, true],
  speakers: [true, false],
  mic: [false, true],
};

/** @typedef {'disabled'|'connecting'|'connected'|'offline'|'incompatible'} ConnectionState */

class Subscription {
  constructor(service, { active = true, onChange = () => {}, wantsVolume = false, wantsStatus = false }) {
    this.service = service;
    this.active = active;
    this.onChange = onChange;
    this.wantsVolume = wantsVolume;
    this.wantsStatus = wantsStatus;
  }

  setActive(active) {
    if (active === this.active) return;
    this.active = active;
    this.service.onSubscriptionChanged(this, active);
  }

  close() {
    this.service.release(this);
  }
}

export class SoundpadService {
  /** @type {ConnectionState} */
  #state = 'disabled';
  #client;
  #timers;
  #now;
  #log;
  /** @type {Set<Subscription>} */
  #subs = new Set();
  /** @type {Library|null} */
  #library = null;
  #libraryStale = false;
  #lastError = null;
  #rcVersion = null;
  #version = null;
  #trial = null;
  #categoriesSupported = true;
  // Whether GetSoundlist(i, i) returns entry i. Not documented, so it is checked before relied on.
  #rangeCheck = 'unknown';
  /** @type {Promise<Library|null>|null} */
  #syncing = null;
  #syncAgain = false;
  #syncTimer = null;
  #lastManualSync = -Infinity;
  #countTimer = null;
  #lastActivationCheck = -Infinity;
  #statusTimer = null;
  #playStatus = 'STOPPED';
  /** @type {{id: string, index: number}|null} */
  #nowPlaying = null;
  /** @type {{volume: number, muted: boolean}|null} */
  #volume = null;
  #handshake = null;
  #disposed = false;

  constructor({ client = new PipeClient(), timers = globalThis, now = Date.now, log = () => {} } = {}) {
    this.#client = client;
    this.#timers = timers;
    this.#now = now;
    this.#log = log;
    client.on('open', () => this.#onOpen());
    client.on('close', (reason) => this.#onClose(reason));
    client.on('retry', () => this.#notify('connection'));
  }

  get state() {
    return this.#state;
  }

  get library() {
    return this.#library;
  }

  get playStatus() {
    return this.#playStatus;
  }

  get nowPlaying() {
    return this.#nowPlaying;
  }

  get volume() {
    return this.#volume;
  }

  /** What the panel shows under "Connection". Short codes only: no paths, titles or raw errors. */
  diagnostics() {
    return {
      state: this.#state,
      lastError: this.#lastError,
      attempts: this.#client.attempts,
      retrying: this.#client.retryScheduled,
      rcVersion: this.#rcVersion,
      version: this.#version,
      trial: this.#trial,
      sounds: this.#library?.count ?? null,
      categories: this.#library ? this.#library.categories.length - 1 : null,
      categoriesSupported: this.#categoriesSupported,
      libraryStale: this.#libraryStale,
      libraryAgeMs: this.#library ? Math.max(0, this.#now() - this.#library.fetchedAt) : null,
      playStatus: this.#playStatus,
    };
  }

  /**
   * @param {{active?: boolean, onChange?: (what: string) => void, wantsVolume?: boolean, wantsStatus?: boolean}} options
   */
  subscribe(options = {}) {
    const sub = new Subscription(this, options);
    this.#subs.add(sub);
    if (this.#state === 'disabled') this.#state = 'connecting';
    this.#client.setWanted(true);
    this.#syncTimersToDemand();
    if (sub.wantsVolume && sub.active && this.#state === 'connected') this.refreshVolume();
    return sub;
  }

  release(sub) {
    if (!this.#subs.delete(sub)) return;
    if (this.#subs.size) {
      this.#syncTimersToDemand();
      return;
    }
    this.#stopEverything();
  }

  onSubscriptionChanged(sub, active) {
    this.#syncTimersToDemand();
    if (!active || this.#state !== 'connected') return;
    // Coming back on screen is when a stale list would be noticed, so check it then.
    if (this.#now() - this.#lastActivationCheck >= ACTIVATION_CHECK_GAP_MS) {
      this.#lastActivationCheck = this.#now();
      this.#checkCount();
    }
    if (sub.wantsVolume) this.refreshVolume();
  }

  /** Closes the pipe and stops every timer, for when the plugin stops. */
  dispose() {
    this.#disposed = true;
    this.#subs.clear();
    this.#stopEverything();
    this.#client.removeAllListeners();
  }

  /** A press or the panel asked to try now. */
  reconnect() {
    if (!this.#subs.size) return Promise.resolve();
    this.#lastError = null;
    if (this.#state !== 'connected') this.#setState('connecting');
    return this.#client.reconnectNow();
  }

  /** The panel's refresh button. Reads the whole list at once, at most every couple of seconds. */
  async refreshLibrary() {
    if (this.#now() - this.#lastManualSync < MANUAL_REFRESH_GAP_MS) return this.#library;
    this.#lastManualSync = this.#now();
    return this.#sync('manual');
  }

  /** Asks for a new copy of the list soon, once, however many things asked. */
  requestSync() {
    if (this.#syncTimer || this.#state !== 'connected') return;
    this.#syncTimer = this.#timers.setTimeout(() => {
      this.#syncTimer = null;
      this.#sync('requested').catch(() => {});
    }, SYNC_DEBOUNCE_MS);
  }

  /**
   * Plays a sound a key saved, after checking that the position still holds that sound.
   * @param {import('./identity.js').SoundRef} ref
   * @param {{output?: 'both'|'speakers'|'mic'|'default', mode?: 'play'|'toggle'|'restart'}} options
   * @returns {Promise<{result: 'played'|'stopped'|'missing'|'offline'|'failed', sound?: import('./identity.js').SoundEntry}>}
   */
  async playSound(ref, { output = 'both', mode = 'play' } = {}) {
    if (!(await this.#ensureConnected())) return { result: 'offline' };
    try {
      if (mode === 'toggle' && this.#nowPlaying && ref.id && this.#nowPlaying.id === ref.id) {
        const status = await this.#readPlayStatus(true);
        if (status === 'PLAYING' || status === 'PAUSED' || status === 'SEEKING') {
          await this.#client.request('DoStopSound', [], { urgent: true });
          this.#setPlayback('STOPPED', null);
          return { result: 'stopped' };
        }
      }
      const sound = await this.#locate(ref);
      if (!sound) return { result: this.#state === 'connected' ? 'missing' : 'offline' };
      if (mode === 'restart') await this.#client.request('DoStopSound', [], { urgent: true });
      await this.#play(sound.index, output);
      this.#setPlayback('PLAYING', { id: sound.id, index: sound.index });
      return { result: 'played', sound };
    } catch (error) {
      return { result: this.#failure(error, 'play') };
    }
  }

  /**
   * Plays the sound at a position a navigator key shows, after checking it is still the same sound.
   * @param {import('./identity.js').SoundEntry} entry
   */
  playEntry(entry, options) {
    return this.playSound({ id: entry.id, alt: entry.alt, index: entry.index }, options);
  }

  /**
   * One of the playback controls.
   * @param {'stop'|'pause'|'next'|'previous'|'random'|'replay'|'volumeUp'|'volumeDown'|'mute'} action
   * @param {{output?: 'both'|'speakers'|'mic'|'default'}} [options]
   * @returns {Promise<{result: 'done'|'offline'|'failed'|'unsupported'}>}
   */
  async control(action, { output = 'both' } = {}) {
    if (!(await this.#ensureConnected())) return { result: 'offline' };
    const request = (name, args = []) => this.#client.request(name, args, { urgent: true });
    try {
      switch (action) {
        case 'stop':
          await request('DoStopSound');
          this.#setPlayback('STOPPED', null);
          break;
        case 'pause':
          await request('DoTogglePause');
          await this.#readPlayStatus(true);
          break;
        case 'next':
        case 'previous':
          await request(action === 'next' ? 'DoPlayNextSound' : 'DoPlayPreviousSound');
          // Soundpad picks the sound, so no key can claim it.
          this.#setPlayback('PLAYING', null);
          break;
        case 'replay':
          if (!supports(this.#rcVersion, 'DoPlayCurrentSoundAgain')) return { result: 'unsupported' };
          await request('DoPlayCurrentSoundAgain');
          this.#setPlayback('PLAYING', this.#nowPlaying);
          break;
        case 'random': {
          if (!supports(this.#rcVersion, 'DoPlayRandomSound')) return { result: 'unsupported' };
          const [speakers, mic] = OUTPUTS[output] ?? OUTPUTS.both;
          await request('DoPlayRandomSound', [speakers, mic]);
          this.#setPlayback('PLAYING', null);
          break;
        }
        case 'volumeUp':
        case 'volumeDown': {
          const current = await request('GetVolume');
          const step = action === 'volumeUp' ? VOLUME_STEP : -VOLUME_STEP;
          const target = Math.min(100, Math.max(0, Math.round((Number(current) + step) / VOLUME_STEP) * VOLUME_STEP));
          await request('SetVolume', [target]);
          await this.refreshVolume();
          break;
        }
        case 'mute':
          await request('DoToggleMute');
          await this.refreshVolume();
          break;
        default:
          return { result: 'unsupported' };
      }
      return { result: 'done' };
    } catch (error) {
      const failure = this.#failure(error, action);
      return { result: failure === 'missing' ? 'failed' : failure };
    }
  }

  /** The volume is read only when a key that shows it is on screen, and after it changes. */
  async refreshVolume() {
    if (this.#state !== 'connected') return this.#volume;
    try {
      const volume = await this.#client.request('GetVolume');
      const muted = await this.#client.request('IsMuted');
      const next = { volume: Math.min(100, Math.max(0, Number(volume))), muted: Boolean(muted) };
      if (next.volume !== this.#volume?.volume || next.muted !== this.#volume?.muted) {
        this.#volume = next;
        this.#notify('volume');
      }
    } catch (error) {
      this.#failure(error, 'volume');
    }
    return this.#volume;
  }

  // --- connection ---

  #setState(state) {
    if (state === this.#state) return;
    this.#state = state;
    this.#notify('connection');
  }

  async #ensureConnected() {
    if (this.#state === 'connected') return true;
    if (this.#state === 'incompatible' || !this.#subs.size) return false;
    try {
      await this.#client.reconnectNow();
      await this.#handshake;
    } catch {
      return false;
    }
    return this.#state === 'connected';
  }

  #onOpen() {
    this.#handshake = this.#greet();
  }

  async #greet() {
    try {
      const rcVersion = await this.#client.request('GetRemoteControlVersion');
      this.#rcVersion = rcVersion;
      if (compareVersions(rcVersion, MIN_RC_VERSION) < 0) {
        this.#lastError = 'incompatible';
        this.#setState('incompatible');
        return;
      }
      this.#version = await this.#client.request('GetVersion').catch(() => null);
      this.#trial = supports(rcVersion, 'IsTrial') ? await this.#client.request('IsTrial').catch(() => null) : null;
      this.#lastError = null;
      this.#setState('connected');
      this.#syncTimersToDemand();
      await this.#sync('connect');
      await this.#readPlayStatus(false).catch(() => {});
      if ([...this.#subs].some((sub) => sub.active && sub.wantsVolume)) await this.refreshVolume();
    } catch (error) {
      this.#failure(error, 'handshake');
    }
  }

  #onClose(reason) {
    if (this.#disposed) return;
    this.#stopPolling();
    this.#clear('countTimer');
    this.#clear('syncTimer');
    // What was read stays on the keys, but it has to be read again before it is trusted.
    if (this.#library) this.#libraryStale = true;
    this.#playStatus = 'STOPPED';
    this.#nowPlaying = null;
    if (reason !== 'unwanted' && reason !== 'closed') this.#lastError = reason;
    if (reason === 'closed' && this.#state === 'connected') this.#lastError = 'closed';
    if (this.#state === 'incompatible') return;
    this.#setState(this.#subs.size ? 'offline' : 'disabled');
  }

  #stopEverything() {
    this.#stopPolling();
    this.#clear('countTimer');
    this.#clear('syncTimer');
    this.#client.setWanted(false);
    this.#library = null;
    this.#libraryStale = false;
    this.#volume = null;
    this.#nowPlaying = null;
    this.#playStatus = 'STOPPED';
    this.#rangeCheck = 'unknown';
    this.#state = 'disabled';
  }

  /** @returns {'offline'|'failed'|'missing'} */
  #failure(error, during) {
    if (!(error instanceof SoundpadError)) {
      this.#log(`unexpected error during ${during}: ${error?.name}`);
      return 'failed';
    }
    if (error.kind === 'rejected' && error.code === 404 && during === 'handshake') {
      this.#lastError = 'incompatible';
      this.#setState('incompatible');
      return 'failed';
    }
    this.#lastError = error.code ? `rejected-${error.code}` : error.kind;
    this.#log(`soundpad ${during} failed: ${this.#lastError}`);
    this.#notify('connection');
    if (['offline', 'closed', 'timeout', 'stopped'].includes(error.kind)) return 'offline';
    return 'failed';
  }

  // --- library ---

  /** @returns {Promise<Library|null>} */
  #sync(reason) {
    if (this.#syncing) {
      this.#syncAgain = true;
      return this.#syncing;
    }
    this.#syncing = (async () => {
      try {
        do {
          this.#syncAgain = false;
          await this.#readLibrary();
        } while (this.#syncAgain && this.#state === 'connected');
      } catch (error) {
        this.#failure(error, `sync:${reason}`);
      } finally {
        this.#syncing = null;
      }
      return this.#library;
    })();
    return this.#syncing;
  }

  async #readLibrary() {
    const soundlist = await this.#client.request('GetSoundlist');
    let categories = null;
    if (this.#categoriesSupported && supports(this.#rcVersion, 'GetCategories')) {
      try {
        categories = await this.#client.request('GetCategories', [true, false]);
      } catch (error) {
        // An older Soundpad: carry on with the list alone.
        if (error instanceof SoundpadError && error.kind === 'rejected') this.#categoriesSupported = false;
        else throw error;
      }
    } else {
      this.#categoriesSupported = false;
    }
    const library = Library.fromXml(soundlist, categories, this.#now());
    const changed = !this.#library || library.revision !== this.#library.revision;
    this.#library = library;
    this.#libraryStale = false;
    if (changed) this.#notify('library');
    else this.#notify('connection');
  }

  async #checkCount() {
    if (this.#state !== 'connected' || this.#syncing) return;
    try {
      const count = await this.#client.request('GetSoundFileCount');
      if (!this.#library || this.#libraryStale || count !== this.#library.count) this.requestSync();
    } catch (error) {
      this.#failure(error, 'count');
    }
  }

  /**
   * Finds the sound a key saved in the current list and checks Soundpad still has it at that position.
   * Reads the list again when either fails, then tries once more.
   */
  async #locate(ref) {
    let readNow = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!this.#library || this.#libraryStale || attempt > 0) {
        await this.#sync('play');
        readNow = true;
      }
      const library = this.#library;
      if (!library) return null;
      const found = library.resolve(ref);
      if (found.status !== 'ok') {
        if (!readNow) continue;
        return null;
      }
      const check = await this.#confirmAt(found.sound);
      if (check === 'same') return found.sound;
      // Without the one-entry check, only a list read for this very press is trusted: one read even a
      // second earlier may predate a reorder.
      if (check === 'trust' && readNow) return found.sound;
    }
    return null;
  }

  /** @returns {Promise<'same'|'different'|'trust'>} */
  async #confirmAt(sound) {
    if (this.#rangeCheck === 'unsupported') return 'trust';
    const answer = await this.#client.request('GetSoundlistRange', [sound.index, sound.index], { urgent: true, timeoutMs: 2_000 });
    const element = answer?.name === 'Soundlist' ? answer.children.find((child) => child.name === 'Sound' && Number(child.attrs.index) === sound.index) : null;
    if (!element) {
      // This Soundpad does not answer a one-entry request the way the reference client suggests.
      // A fresh list is trusted instead, which the caller makes sure of.
      this.#rangeCheck = 'unsupported';
      this.#log('one-entry check not available; relying on fresh lists');
      return 'trust';
    }
    this.#rangeCheck = 'supported';
    const id = fileId(element.attrs.url);
    if (sound.id && id === sound.id) return 'same';
    if (!sound.id && !id && metaId(element.attrs) === sound.alt) return 'same';
    return 'different';
  }

  async #play(index, output) {
    if (output === 'default') {
      await this.#client.request('DoPlaySound', [index], { urgent: true });
      return;
    }
    const [speakers, mic] = OUTPUTS[output] ?? OUTPUTS.both;
    await this.#client.request('DoPlaySoundOn', [index, speakers, mic], { urgent: true });
  }

  // --- playback status ---

  #setPlayback(status, nowPlaying) {
    const changed = status !== this.#playStatus || nowPlaying?.id !== this.#nowPlaying?.id;
    this.#playStatus = status;
    this.#nowPlaying = status === 'STOPPED' ? null : nowPlaying;
    if (changed) this.#notify('playback');
    this.#syncTimersToDemand();
  }

  async #readPlayStatus(urgent) {
    const status = await this.#client.request('GetPlayStatus', [], { urgent });
    this.#setPlayback(status, status === 'STOPPED' ? null : this.#nowPlaying);
    return status;
  }

  #hasActiveSubscribers() {
    for (const sub of this.#subs) if (sub.active) return true;
    return false;
  }

  /** Starts the timers something on screen needs, and stops the rest. */
  #syncTimersToDemand() {
    const active = this.#state === 'connected' && this.#hasActiveSubscribers();
    if (active && !this.#countTimer) {
      this.#countTimer = this.#timers.setInterval(() => this.#checkCount(), COUNT_CHECK_MS);
    } else if (!active) {
      this.#clear('countTimer');
    }
    const playing = this.#playStatus !== 'STOPPED';
    const watching = active && [...this.#subs].some((sub) => sub.active && sub.wantsStatus);
    if (active && (playing || watching)) this.#schedulePoll();
    else this.#stopPolling();
  }

  #schedulePoll() {
    if (this.#statusTimer) return;
    const wait = this.#playStatus === 'STOPPED' ? IDLE_POLL_MS : this.#playStatus === 'PAUSED' ? PAUSED_POLL_MS : PLAYING_POLL_MS;
    this.#statusTimer = this.#timers.setTimeout(async () => {
      this.#statusTimer = null;
      if (this.#state !== 'connected') return;
      try {
        await this.#readPlayStatus(false);
      } catch (error) {
        this.#failure(error, 'status');
        return;
      }
      this.#syncTimersToDemand();
    }, wait);
  }

  #stopPolling() {
    this.#clear('statusTimer');
  }

  #clear(name) {
    if (name === 'countTimer' && this.#countTimer !== null) {
      this.#timers.clearInterval(this.#countTimer);
      this.#countTimer = null;
    } else if (name === 'syncTimer' && this.#syncTimer !== null) {
      this.#timers.clearTimeout(this.#syncTimer);
      this.#syncTimer = null;
    } else if (name === 'statusTimer' && this.#statusTimer !== null) {
      this.#timers.clearTimeout(this.#statusTimer);
      this.#statusTimer = null;
    }
  }

  #notify(what) {
    for (const sub of [...this.#subs]) sub.onChange(what);
  }
}
