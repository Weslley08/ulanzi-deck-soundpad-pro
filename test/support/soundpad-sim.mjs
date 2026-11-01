// A SIMULATED Soundpad remote control, for tests that must not need Soundpad. It answers the commands
// the plugin uses, in the shapes documented by Leppsoft's reference client and seen in the public
// .NET and JavaScript clients (see docs/SOUNDPAD-API.md). It is not Soundpad: passing against it
// says nothing about a real installation. On Windows it listens on a named pipe, elsewhere on a
// Unix socket, which Node's net module treats the same way.
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let counter = 0;

/** A fresh address for one simulator. */
export function simPath() {
  counter += 1;
  const name = `spsim-${process.pid}-${counter}-${randomBytes(3).toString('hex')}`;
  return process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : join(tmpdir(), `${name}.sock`);
}

const escape = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

/**
 * @typedef {{ url: string, title?: string, artist?: string, duration?: string, addedOn?: string }} SimSound
 * @typedef {{ name: string, hidden?: boolean, sounds?: number[], children?: SimCategory[] }} SimCategory
 *   sounds holds positions in the sound list, 1-based, as Soundpad numbers them.
 */

export function makeSounds(count, prefix = 'Sound') {
  return Array.from({ length: count }, (_, i) => ({
    url: `C:\\Users\\Someone\\Sounds\\${prefix.toLowerCase()}-${i + 1}.mp3`,
    title: `${prefix} ${i + 1}`,
    artist: i % 3 === 0 ? 'Artist' : '',
    duration: `0:0${(i % 9) + 1}`,
    addedOn: '2026-01-01T10:00:00',
  }));
}

export class SoundpadSimulator {
  /** Every command received, in order. */
  log = [];
  status = 'STOPPED';
  current = 0;
  volume = 70;
  muted = false;
  lastOutput = null;
  /** @type {Map<string, {mode: 'silence'|'garbage'|'close'|'reject'|'delay', times: number, code?: number, ms?: number}>} */
  #faults = new Map();
  #server = null;
  #sockets = new Set();
  #stopTimer = null;

  /**
   * @param {{ sounds?: SimSound[], categories?: SimCategory[], rcVersion?: string, version?: string, trial?: boolean,
   *   rangeSupported?: boolean, chunkSize?: number, nulTerminate?: boolean, playMs?: number, delayMs?: number }} options
   */
  constructor({
    sounds = makeSounds(6),
    categories = [],
    rcVersion = '1.1.2',
    version = '4.0.35',
    trial = false,
    rangeSupported = true,
    chunkSize = 0,
    nulTerminate = false,
    playMs = 0,
    delayMs = 0,
  } = {}) {
    Object.assign(this, { sounds, categories, rcVersion, version, trial, rangeSupported, chunkSize, nulTerminate, playMs, delayMs });
  }

  get connections() {
    return this.#sockets.size;
  }

  /** @returns {Promise<string>} the path to connect to */
  async listen(path = simPath()) {
    this.path = path;
    this.#server = net.createServer((socket) => {
      this.#sockets.add(socket);
      socket.on('close', () => this.#sockets.delete(socket));
      socket.on('error', () => {});
      socket.on('data', (data) => this.#onData(socket, data.toString('utf8')));
    });
    await new Promise((resolve, reject) => {
      this.#server.once('error', reject);
      this.#server.listen(path, resolve);
    });
    return path;
  }

  async close() {
    clearTimeout(this.#stopTimer);
    for (const socket of this.#sockets) socket.destroy();
    if (this.#server) await new Promise((resolve) => this.#server.close(resolve));
    this.#server = null;
  }

  /** Writes to every client without being asked. */
  sendRaw(text) {
    for (const socket of this.#sockets) socket.write(text);
  }

  /** Drops every open connection, as Soundpad closing would, but keeps listening. */
  dropClients() {
    for (const socket of this.#sockets) socket.destroy();
  }

  /**
   * Makes the next `times` requests for a command misbehave.
   * @param {string} command the name before the parenthesis, e.g. "GetSoundlist"
   */
  fault(command, mode, { times = 1, code = 500, ms = 0 } = {}) {
    this.#faults.set(command, { mode, times, code, ms });
  }

  countOf(command) {
    return this.log.filter((line) => line.startsWith(`${command}(`)).length;
  }

  // --- changing the library, as a user would in Soundpad ---

  addSound(sound, at = this.sounds.length) {
    this.#mutate(() => this.sounds.splice(at, 0, sound));
  }

  /** @param {number} position 1-based */
  removeSound(position) {
    this.#mutate(() => this.sounds.splice(position - 1, 1));
  }

  /** @param {number} from 1-based @param {number} to 1-based */
  moveSound(from, to) {
    this.#mutate(() => {
      const [sound] = this.sounds.splice(from - 1, 1);
      this.sounds.splice(to - 1, 0, sound);
    });
  }

  /** Changes the list while keeping every category pointing at the same sounds, as Soundpad does. */
  #mutate(change) {
    const members = this.#allCategories().map((category) => [category, (category.sounds ?? []).map((p) => this.sounds[p - 1])]);
    change();
    for (const [category, sounds] of members) {
      category.sounds = sounds.filter((sound) => this.sounds.includes(sound)).map((sound) => this.sounds.indexOf(sound) + 1);
    }
  }

  * #walk(list) {
    for (const category of list) {
      yield category;
      yield* this.#walk(category.children ?? []);
    }
  }

  #allCategories() {
    return [...this.#walk(this.categories)];
  }

  // --- answering ---

  #soundXml(sound, position) {
    const attrs = { index: position, url: sound.url, artist: sound.artist ?? '', title: sound.title ?? '', duration: sound.duration ?? '', addedOn: sound.addedOn ?? '', playCount: 0 };
    return `<Sound ${Object.entries(attrs).map(([key, value]) => `${key}="${escape(value)}"`).join(' ')}/>`;
  }

  #soundlist(from = 1, to = this.sounds.length) {
    const items = this.sounds.map((sound, i) => [sound, i + 1]).filter(([, position]) => position >= from && position <= to);
    if (!items.length) return '<?xml version="1.0" encoding="UTF-8"?>\n<Soundlist/>';
    return `<?xml version="1.0" encoding="UTF-8"?>\n<Soundlist>${items.map(([sound, position]) => this.#soundXml(sound, position)).join('')}</Soundlist>`;
  }

  #categoryXml(category, withSounds, counter) {
    counter.n += 1;
    const sounds = withSounds ? (category.sounds ?? []).filter((p) => this.sounds[p - 1]).map((p) => this.#soundXml(this.sounds[p - 1], p)).join('') : '';
    const children = (category.children ?? []).map((child) => this.#categoryXml(child, withSounds, counter)).join('');
    const hidden = category.hidden ? ' hidden="true"' : '';
    return `<Category index="${counter.n}" type="0" name="${escape(category.name)}"${hidden}>${sounds}${children}</Category>`;
  }

  #categoriesXml(withSounds) {
    const counter = { n: 0 };
    return `<?xml version="1.0" encoding="UTF-8"?>\n<Categories>${this.categories.map((category) => this.#categoryXml(category, withSounds, counter)).join('')}</Categories>`;
  }

  #since(version) {
    const parts = (v) => v.split('.').map(Number);
    const [a, b] = [parts(this.rcVersion), parts(version)];
    for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
    return true;
  }

  #startPlaying(position, output) {
    if (!this.sounds[position - 1]) return 'R-404';
    this.current = position;
    this.status = 'PLAYING';
    this.lastOutput = output;
    clearTimeout(this.#stopTimer);
    if (this.playMs) {
      this.#stopTimer = setTimeout(() => {
        this.status = 'STOPPED';
      }, this.playMs);
    }
    return 'R-200';
  }

  /** @returns {string} */
  answer(line) {
    const match = /^(\w+)\((.*)\)$/s.exec(line);
    if (!match) return 'R-400';
    const [, name, rawArgs] = match;
    const args = rawArgs.trim() ? rawArgs.split(',').map((arg) => arg.trim()) : [];
    const int = (i) => Number.parseInt(args[i], 10);
    const bool = (i) => args[i] === 'true';
    switch (name) {
      case 'IsAlive': return 'R-200';
      case 'GetRemoteControlVersion': return this.rcVersion;
      case 'GetVersion': return this.version;
      case 'IsTrial': return this.#since('1.1.2') ? (this.trial ? '1' : '0') : 'R-404';
      case 'GetSoundFileCount': return String(this.sounds.length);
      case 'GetSoundlist':
        if (args.length === 2) return this.rangeSupported ? this.#soundlist(int(0), int(1)) : this.#soundlist(1, 0);
        return this.#soundlist();
      case 'GetCategories': return this.#since('1.1.0') ? this.#categoriesXml(bool(0)) : 'R-404';
      case 'GetPlayStatus': return this.status;
      case 'DoPlaySound': return this.#startPlaying(int(0), args.length === 3 ? { speakers: bool(1), mic: bool(2) } : 'default');
      case 'DoStopSound':
        this.status = 'STOPPED';
        return 'R-200';
      case 'DoTogglePause':
        if (this.status === 'PLAYING') this.status = 'PAUSED';
        else if (this.status === 'PAUSED') this.status = 'PLAYING';
        return 'R-200';
      case 'DoPlayNextSound': return this.#startPlaying(Math.min(this.current + 1, this.sounds.length), 'default');
      case 'DoPlayPreviousSound': return this.#startPlaying(Math.max(this.current - 1, 1), 'default');
      case 'DoPlayCurrentSoundAgain': return this.#since('1.1.0') ? this.#startPlaying(this.current || 1, 'default') : 'R-404';
      case 'DoPlayRandomSound': return this.#since('1.1.2') ? this.#startPlaying(1 + Math.floor(Math.random() * this.sounds.length), { speakers: bool(0), mic: bool(1) }) : 'R-404';
      case 'GetVolume': return String(this.volume);
      case 'SetVolume':
        this.volume = int(0);
        return 'R-200';
      case 'IsMuted': return this.muted ? '1' : '0';
      case 'DoToggleMute':
        this.muted = !this.muted;
        return 'R-200';
      default: return 'R-404';
    }
  }

  #onData(socket, text) {
    this.log.push(text);
    const name = /^(\w+)/.exec(text)?.[1] ?? '';
    const fault = this.#faults.get(name);
    if (fault) {
      fault.times -= 1;
      if (fault.times <= 0) this.#faults.delete(name);
      if (fault.mode === 'silence') return;
      if (fault.mode === 'close') {
        socket.destroy();
        return;
      }
      if (fault.mode === 'garbage') {
        socket.write('\u0001\u0002not an answer');
        return;
      }
      if (fault.mode === 'reject') {
        socket.write(`R-${fault.code}`);
        return;
      }
      if (fault.mode === 'delay') {
        setTimeout(() => this.#reply(socket, this.answer(text)), fault.ms);
        return;
      }
    }
    const reply = () => this.#reply(socket, this.answer(text));
    if (this.delayMs) setTimeout(reply, this.delayMs);
    else reply();
  }

  #reply(socket, answer) {
    if (socket.destroyed) return;
    const bytes = Buffer.from(this.nulTerminate ? `${answer}\0` : answer, 'utf8');
    if (!this.chunkSize || bytes.length <= this.chunkSize) {
      socket.write(bytes);
      return;
    }
    // In pieces, with a pause between them, so the reader has to wait for the end of the document.
    let at = 0;
    const next = () => {
      if (socket.destroyed) return;
      socket.write(bytes.subarray(at, at + this.chunkSize));
      at += this.chunkSize;
      if (at < bytes.length) setTimeout(next, 2);
    };
    next();
  }
}
