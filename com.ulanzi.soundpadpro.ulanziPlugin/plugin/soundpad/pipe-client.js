// The one connection to Soundpad's named pipe that every key shares. Requests go one at a time,
// because the pipe has no request ids: an answer belongs to whatever was asked last. That is also
// why a request that times out closes the connection: a late answer would be read as the answer
// to the next question, and could start the wrong sound.
import { EventEmitter } from 'node:events';
import net from 'node:net';
import { COMMANDS, PIPE_PATH, SoundpadError, buildCommand, parseAnswer } from './protocol.js';
import { MAX_XML_LENGTH, isCompleteDocument } from './xml.js';

export const DEFAULT_TIMEOUT_MS = 2_000;
export const LIST_TIMEOUT_MS = 15_000;
export const CONNECT_TIMEOUT_MS = 2_000;
export const RETRY_BASE_MS = 1_000;
export const RETRY_MAX_MS = 30_000;
export const MAX_QUEUE = 64;
// Below this size the whole answer is decoded to see if it is complete. Above it only its end is.
const SMALL_ANSWER = 64 * 1024;

/** Why the pipe could not be opened, in words the panel can show. Never the raw error, which can hold paths. */
export function connectFailureReason(error) {
  switch (error?.code) {
    case 'ENOENT':
      return 'not-running';
    case 'EBUSY':
    case 'EAGAIN':
      return 'pipe-busy';
    case 'EACCES':
    case 'EPERM':
      return 'denied';
    case 'ETIMEDOUT':
      return 'timeout';
    default:
      return 'other';
  }
}

/**
 * Events: 'open', 'close' (reason), 'retry' ({ attempt, waitMs }).
 */
export class PipeClient extends EventEmitter {
  /** @type {'closed'|'connecting'|'open'} */
  state = 'closed';
  /** @type {string|null} */
  lastFailure = null;
  attempts = 0;
  #path;
  #connect;
  #timers;
  #retryBase;
  #retryMax;
  #connectTimeout;
  /** @type {net.Socket|null} */
  #socket = null;
  #wanted = false;
  /** @type {Promise<void>|null} */
  #opening = null;
  #retryTimer = null;
  /** @type {{text: string, kind: string, timeoutMs: number, resolve: Function, reject: Function}[]} */
  #queue = [];
  /** @type {{text: string, kind: string, timeoutMs: number, resolve: Function, reject: Function, timer: any, chunks: Buffer[], size: number, xmlRoot: string|null|undefined}|null} */
  #current = null;
  #urgentCount = 0;
  #abortOpening = false;

  constructor({
    path = PIPE_PATH,
    connect = (target) => net.createConnection(target),
    timers = globalThis,
    retryBaseMs = RETRY_BASE_MS,
    retryMaxMs = RETRY_MAX_MS,
    connectTimeoutMs = CONNECT_TIMEOUT_MS,
  } = {}) {
    super();
    this.#path = path;
    this.#connect = connect;
    this.#timers = timers;
    this.#retryBase = retryBaseMs;
    this.#retryMax = retryMaxMs;
    this.#connectTimeout = connectTimeoutMs;
    // Without a listener an 'error' event would throw. Errors reach callers as rejected requests.
    this.on('error', () => {});
  }

  get pending() {
    return this.#queue.length + (this.#current ? 1 : 0);
  }

  get retryScheduled() {
    return this.#retryTimer !== null;
  }

  /**
   * Whether anything needs the connection. While wanted, a lost connection is retried with a
   * growing wait; while not, nothing runs at all.
   */
  setWanted(wanted) {
    if (wanted === this.#wanted) return;
    this.#wanted = wanted;
    if (wanted) {
      if (this.state === 'closed') this.#scheduleRetry(0);
      return;
    }
    this.#clearRetry();
    this.close('unwanted');
  }

  /** A press or the panel asked: try now instead of waiting for the next retry. */
  reconnectNow() {
    this.attempts = 0;
    this.#clearRetry();
    return this.open().catch(() => {});
  }

  /** @returns {Promise<void>} resolves once connected */
  open() {
    if (this.state === 'open') return Promise.resolve();
    if (this.#opening) return this.#opening;
    this.state = 'connecting';
    this.#abortOpening = false;
    this.#clearRetry();
    this.#opening = new Promise((resolve, reject) => {
      let settled = false;
      let socket;
      try {
        socket = this.#connect(this.#path);
      } catch (error) {
        this.#opening = null;
        this.#failedToOpen(error);
        reject(new SoundpadError('offline'));
        return;
      }
      const limit = this.#timers.setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.destroy();
        this.#opening = null;
        this.#failedToOpen({ code: 'ETIMEDOUT' });
        reject(new SoundpadError('offline'));
      }, this.#connectTimeout);
      socket.once('connect', () => {
        if (settled) return;
        settled = true;
        this.#timers.clearTimeout(limit);
        this.#opening = null;
        if (this.#abortOpening) {
          // close() was called while this was still connecting.
          this.#abortOpening = false;
          socket.destroy();
          this.state = 'closed';
          this.#rejectQueued(new SoundpadError('stopped'));
          reject(new SoundpadError('stopped'));
          return;
        }
        this.#socket = socket;
        this.state = 'open';
        this.attempts = 0;
        this.lastFailure = null;
        socket.on('data', (chunk) => this.#onData(chunk));
        socket.on('close', () => this.#onClosed(socket, 'closed'));
        this.emit('open');
        this.#pump();
        resolve();
      });
      socket.on('error', (error) => {
        if (settled) {
          // After connecting, 'close' follows and does the cleanup.
          return;
        }
        settled = true;
        this.#timers.clearTimeout(limit);
        socket.destroy();
        this.#opening = null;
        this.#failedToOpen(error);
        reject(new SoundpadError('offline'));
      });
    });
    return this.#opening;
  }

  /**
   * Sends one command and reads its answer.
   * @param {keyof typeof COMMANDS} name
   * @param {(number|boolean)[]} [args]
   * @param {{timeoutMs?: number, urgent?: boolean}} [options] urgent jumps the queue: a press must
   *   not wait behind a long list download.
   */
  request(name, args = [], { timeoutMs, urgent = false } = {}) {
    let text;
    try {
      text = buildCommand(name, ...args);
    } catch (error) {
      return Promise.reject(error);
    }
    const { kind } = COMMANDS[name];
    const wait = timeoutMs ?? (kind === 'xml' ? LIST_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
    if (this.#queue.length >= MAX_QUEUE) return Promise.reject(new SoundpadError('busy'));
    return new Promise((resolve, reject) => {
      const job = { text, kind, timeoutMs: wait, resolve, reject, urgent };
      if (urgent) {
        this.#queue.splice(this.#urgentCount, 0, job);
        this.#urgentCount += 1;
      } else {
        this.#queue.push(job);
      }
      if (this.state === 'open') {
        this.#pump();
        return;
      }
      this.open().catch(() => this.#rejectQueued(new SoundpadError('offline')));
    });
  }

  /** Closes the pipe and fails what was waiting. */
  close(reason = 'closed') {
    this.#clearRetry();
    const socket = this.#socket;
    if (socket) {
      this.#socket = null;
      socket.removeAllListeners('data');
      socket.destroy();
      this.#afterClose(reason);
      return;
    }
    if (this.state === 'connecting') this.#abortOpening = true;
    this.#rejectQueued(new SoundpadError('stopped'));
  }

  #failedToOpen(error) {
    this.state = 'closed';
    this.lastFailure = connectFailureReason(error);
    this.attempts += 1;
    this.emit('close', this.lastFailure);
    if (this.#wanted) this.#scheduleRetry();
  }

  #scheduleRetry(waitMs) {
    if (this.#retryTimer || !this.#wanted || this.state !== 'closed') return;
    const wait = waitMs ?? Math.min(this.#retryBase * 2 ** Math.max(this.attempts - 1, 0), this.#retryMax);
    if (wait > 0) this.emit('retry', { attempt: this.attempts, waitMs: wait });
    this.#retryTimer = this.#timers.setTimeout(() => {
      this.#retryTimer = null;
      this.open().catch(() => {});
    }, wait);
  }

  #clearRetry() {
    if (this.#retryTimer) this.#timers.clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
  }

  #onClosed(socket, reason) {
    if (socket !== this.#socket) return;
    this.#socket = null;
    this.#afterClose(reason);
  }

  #afterClose(reason) {
    this.state = 'closed';
    const current = this.#current;
    this.#current = null;
    if (current) {
      this.#timers.clearTimeout(current.timer);
      current.reject(new SoundpadError(reason === 'timeout' ? 'timeout' : 'closed'));
    }
    this.#rejectQueued(new SoundpadError('closed'));
    this.lastFailure = reason === 'unwanted' ? null : reason;
    this.emit('close', reason);
    if (this.#wanted && reason !== 'unwanted') this.#scheduleRetry(0);
  }

  #rejectQueued(error) {
    const queued = this.#queue;
    this.#queue = [];
    this.#urgentCount = 0;
    for (const job of queued) job.reject(error);
  }

  #pump() {
    if (this.#current || this.state !== 'open' || !this.#queue.length) return;
    const job = this.#queue.shift();
    if (job.urgent) this.#urgentCount -= 1;
    const current = { ...job, chunks: [], size: 0, xmlRoot: undefined, timer: null };
    this.#current = current;
    current.timer = this.#timers.setTimeout(() => {
      if (this.#current !== current) return;
      // The answer may still come, and would then be read as the answer to the next request.
      this.#dropConnection('timeout');
    }, job.timeoutMs);
    this.#socket.write(job.text, 'utf8');
  }

  #dropConnection(reason) {
    const socket = this.#socket;
    if (!socket) return;
    this.#socket = null;
    socket.removeAllListeners('data');
    socket.destroy();
    this.#afterClose(reason);
  }

  #onData(chunk) {
    const current = this.#current;
    if (!current) {
      // Nobody asked, so the conversation is out of step. Starting over is the only safe answer.
      this.#dropConnection('unexpected');
      return;
    }
    current.chunks.push(chunk);
    current.size += chunk.length;
    if (current.size > MAX_XML_LENGTH) {
      this.#finish(current, null, new SoundpadError('unexpected'));
      this.#dropConnection('unexpected');
      return;
    }
    if (!this.#isComplete(current)) return;
    const text = Buffer.concat(current.chunks, current.size).toString('utf8');
    let value;
    try {
      value = parseAnswer(current.kind, text);
    } catch (error) {
      this.#finish(current, null, error);
      return;
    }
    this.#finish(current, value, null);
  }

  #isComplete(current) {
    if (current.xmlRoot === undefined) {
      const head = Buffer.concat(current.chunks, current.size).subarray(0, 256).toString('utf8').replace(/^﻿/, '');
      const match = /^\s*(?:<\?[\s\S]*?\?>\s*)?<([A-Za-z_][\w.-]*)/.exec(head);
      // Soundpad answers an XML command with a status line when it fails, which is complete at once.
      current.xmlRoot = match ? match[1] : null;
    }
    if (current.xmlRoot === null) return true;
    if (current.size <= SMALL_ANSWER) {
      return isCompleteDocument(Buffer.concat(current.chunks, current.size).toString('utf8').replace(/\0+$/, ''));
    }
    const last = current.chunks.at(-1);
    const tail = (last.length >= 256 ? last.subarray(last.length - 256) : Buffer.concat(current.chunks, current.size).subarray(-256))
      .toString('utf8').replace(/\0+$/, '').trimEnd();
    return tail.endsWith(`</${current.xmlRoot}>`);
  }

  #finish(current, value, error) {
    if (this.#current !== current) return;
    this.#timers.clearTimeout(current.timer);
    this.#current = null;
    if (error) current.reject(error);
    else current.resolve(value);
    // Soundpad's own client waits a moment between requests sent in the same millisecond.
    this.#timers.setTimeout(() => this.#pump(), 1);
  }
}
