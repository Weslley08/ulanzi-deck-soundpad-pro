// The plugin's global settings: options of each navigator group and where each group was left.
// Kept by Studio, read once when the first key appears, and written only when something changed.
import { normalizeGlobalSettings, normalizeGroupOptions, normalizeNavState } from './settings.js';

export const SAVE_DELAY_MS = 1_000;

export class GlobalStore {
  #data = normalizeGlobalSettings();
  #known = false;
  #saveTimer = null;
  #timers;
  #write;
  #context;
  #onChange;

  /**
   * @param {{ write: (settings: object, context: string) => void, context: () => string | null, onChange: (data: object) => void, timers?: typeof globalThis }} options
   */
  constructor({ write, context, onChange, timers = globalThis }) {
    this.#write = write;
    this.#context = context;
    this.#onChange = onChange;
    this.#timers = timers;
  }

  get data() {
    return this.#data;
  }

  /** Whether Studio has answered, which is not the same as having nothing saved. */
  get known() {
    return this.#known;
  }

  /** What Studio sent. Anything unexpected in it is dropped by the normalizer. */
  load(raw) {
    const next = normalizeGlobalSettings(raw);
    this.#known = true;
    if (JSON.stringify(next) === JSON.stringify(this.#data)) return;
    this.#data = next;
    this.#onChange(this.#data);
  }

  /** Studio never answered: carry on with defaults rather than waiting forever. */
  giveUp() {
    if (this.#known) return;
    this.#known = true;
    this.#onChange(this.#data);
  }

  setGroupOptions(group, options) {
    const next = normalizeGroupOptions(options);
    if (JSON.stringify(this.#data.groups[group]) === JSON.stringify(next)) return;
    this.#data = { ...this.#data, groups: { ...this.#data.groups, [group]: next } };
    // A group that stops remembering its place forgets the saved one.
    if (!next.persist && this.#data.nav[group]) {
      const { [group]: _dropped, ...nav } = this.#data.nav;
      this.#data = { ...this.#data, nav };
    }
    this.#onChange(this.#data);
    this.#saveSoon(0);
  }

  /** Called on every page turn, so the write waits for the user to stop pressing. */
  saveNavState(group, state) {
    const current = this.#data.nav[group];
    if (state === null) {
      if (!current) return;
      const { [group]: _dropped, ...nav } = this.#data.nav;
      this.#data = { ...this.#data, nav };
    } else {
      const next = normalizeNavState(state);
      if (JSON.stringify(current) === JSON.stringify(next)) return;
      this.#data = { ...this.#data, nav: { ...this.#data.nav, [group]: next } };
    }
    this.#saveSoon(SAVE_DELAY_MS);
  }

  #saveSoon(delay) {
    if (this.#saveTimer) this.#timers.clearTimeout(this.#saveTimer);
    this.#saveTimer = this.#timers.setTimeout(() => {
      this.#saveTimer = null;
      this.flush();
    }, delay);
  }

  /** Writes now, for when the plugin is about to stop. */
  flush() {
    if (this.#saveTimer) {
      this.#timers.clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
    }
    const context = this.#context();
    // Before Studio answers, a write would replace what it has with defaults.
    if (!context || !this.#known) return;
    this.#write(this.#data, context);
  }

  get pendingSave() {
    return this.#saveTimer !== null;
  }

  dispose() {
    if (this.#saveTimer) this.#timers.clearTimeout(this.#saveTimer);
    this.#saveTimer = null;
  }
}
