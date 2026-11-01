// Timers a test fires by hand, to check what is scheduled and that nothing is left running.
export class ManualTimers {
  #next = 1;
  /** @type {Map<number, {fn: Function, ms: number, repeat: boolean}>} */
  pending = new Map();

  setTimeout = (fn, ms) => this.#add(fn, ms, false);
  setInterval = (fn, ms) => this.#add(fn, ms, true);
  clearTimeout = (id) => this.pending.delete(id);
  clearInterval = (id) => this.pending.delete(id);

  #add(fn, ms, repeat) {
    const id = this.#next++;
    this.pending.set(id, { fn, ms, repeat });
    return id;
  }

  /** Delays of what is waiting, smallest first. */
  get delays() {
    return [...this.pending.values()].map(({ ms }) => ms).sort((a, b) => a - b);
  }

  /** Runs every timer with this delay once. */
  async fire(ms) {
    const due = [...this.pending].filter(([, timer]) => timer.ms === ms);
    for (const [id, timer] of due) {
      if (!timer.repeat) this.pending.delete(id);
      await timer.fn();
    }
    return due.length;
  }
}
