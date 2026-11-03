// What may be said to Soundpad, and how its answers are read. Requests are built only from this
// table, from whole numbers and true/false, so nothing typed in a panel or saved in a profile can
// ever become part of a command. Names and arguments follow Leppsoft's reference client
// (SoundpadRemoteControl.java, remote control 1.1.2); see docs/SOUNDPAD-API.md.
import { parseXml } from './xml.js';

export const PIPE_PATH = '\\\\.\\pipe\\sp_remote_control';

/** The remote control version that reference client speaks. Older versions lack some commands. */
export const CLIENT_RC_VERSION = '1.1.2';

/**
 * kind says how to read the answer. since is the remote control version that added the command,
 * taken from the section it appears under in the reference client.
 * @type {Record<string, {args: string[], kind: 'ok'|'number'|'text'|'xml'|'status'|'flag', since: string}>}
 */
export const COMMANDS = Object.freeze({
  IsAlive: { args: [], kind: 'ok', since: '1.0.0' },
  GetRemoteControlVersion: { args: [], kind: 'text', since: '1.0.0' },
  GetVersion: { args: [], kind: 'text', since: '1.0.0' },
  IsTrial: { args: [], kind: 'flag', since: '1.1.2' },
  GetSoundFileCount: { args: [], kind: 'number', since: '1.0.0' },
  GetSoundlist: { args: [], kind: 'xml', since: '1.0.0' },
  GetSoundlistRange: { args: ['index', 'index'], kind: 'xml', since: '1.0.0' },
  GetCategories: { args: ['bool', 'bool'], kind: 'xml', since: '1.1.0' },
  // Read-only. Seen in the public .NET client; the version that added them is not documented, so an older Soundpad is told apart by its R-404.
  GetPlaybackPositionInMs: { args: [], kind: 'number', since: '1.0.0' },
  GetPlaybackDurationInMs: { args: [], kind: 'number', since: '1.0.0' },
  GetPlayStatus: { args: [], kind: 'status', since: '1.0.0' },
  DoPlaySound: { args: ['index'], kind: 'ok', since: '1.0.0' },
  DoPlaySoundOn: { args: ['index', 'bool', 'bool'], kind: 'ok', since: '1.0.0' },
  DoStopSound: { args: [], kind: 'ok', since: '1.0.0' },
  DoTogglePause: { args: [], kind: 'ok', since: '1.0.0' },
  DoPlayNextSound: { args: [], kind: 'ok', since: '1.0.0' },
  DoPlayPreviousSound: { args: [], kind: 'ok', since: '1.0.0' },
  DoPlayCurrentSoundAgain: { args: [], kind: 'ok', since: '1.1.0' },
  DoPlayRandomSound: { args: ['bool', 'bool'], kind: 'ok', since: '1.1.2' },
  GetVolume: { args: [], kind: 'number', since: '1.0.0' },
  SetVolume: { args: ['volume'], kind: 'ok', since: '1.0.0' },
  IsMuted: { args: [], kind: 'flag', since: '1.0.0' },
  DoToggleMute: { args: [], kind: 'ok', since: '1.0.0' },
});

// Two of our names are overloads of one Soundpad command.
const WIRE_NAMES = { GetSoundlistRange: 'GetSoundlist', DoPlaySoundOn: 'DoPlaySound' };

export const PLAY_STATUSES = ['STOPPED', 'PLAYING', 'PAUSED', 'SEEKING'];
export const MAX_SOUND_INDEX = 1_000_000;

export class SoundpadError extends Error {
  name = 'SoundpadError';

  /**
   * @param {'offline'|'timeout'|'closed'|'rejected'|'unexpected'|'busy'|'unsupported'|'stopped'} kind
   * @param {{code?: number}} [details]
   */
  constructor(kind, { code } = {}) {
    super(code ? `${kind} (R-${code})` : kind);
    this.kind = kind;
    this.code = code ?? null;
  }
}

const ARGUMENT = {
  index: (value) => Number.isInteger(value) && value >= 1 && value <= MAX_SOUND_INDEX,
  bool: (value) => typeof value === 'boolean',
  volume: (value) => Number.isInteger(value) && value >= 0 && value <= 100,
};

/**
 * @param {keyof typeof COMMANDS} name
 * @param {...(number|boolean)} args
 * @returns {string} the exact text sent through the pipe
 */
export function buildCommand(name, ...args) {
  const spec = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : null;
  if (!spec) throw new TypeError(`unknown command: ${String(name)}`);
  if (args.length !== spec.args.length) throw new TypeError(`${name} takes ${spec.args.length} arguments`);
  spec.args.forEach((type, i) => {
    if (!ARGUMENT[type](args[i])) throw new TypeError(`${name}: argument ${i + 1} is not a valid ${type}`);
  });
  return `${WIRE_NAMES[name] ?? name}(${args.map(String).join(', ')})`;
}

/** Soundpad pads some answers with NUL bytes. */
export const cleanAnswer = (text) => String(text ?? '').replace(/\0+$/, '').trim();

/** "R-200" and the like: Soundpad's status codes, modeled on HTTP. */
export function statusCode(text) {
  const match = /^R-(\d{3})\b/.exec(text);
  return match ? Number(match[1]) : null;
}

const MAX_TEXT_ANSWER = 256;

/**
 * @param {'ok'|'number'|'text'|'xml'|'status'|'flag'} kind
 * @param {string} raw
 */
export function parseAnswer(kind, raw) {
  const text = cleanAnswer(raw);
  if (!text) throw new SoundpadError('unexpected');
  const code = statusCode(text);
  if (kind === 'ok') {
    if (code === 200) return true;
    throw new SoundpadError(code ? 'rejected' : 'unexpected', { code: code ?? undefined });
  }
  if (code !== null) throw new SoundpadError('rejected', { code });
  switch (kind) {
    case 'number': {
      if (!/^-?\d{1,12}$/.test(text)) throw new SoundpadError('unexpected');
      return Number(text);
    }
    case 'flag': {
      if (text === '1' || text === 'true') return true;
      if (text === '0' || text === 'false') return false;
      throw new SoundpadError('unexpected');
    }
    case 'status': {
      const status = text.toUpperCase();
      if (!PLAY_STATUSES.includes(status)) throw new SoundpadError('unexpected');
      return status;
    }
    case 'text': {
      // Version strings and the like: short, and never control characters.
      if (text.length > MAX_TEXT_ANSWER || /[\u0000-\u001f]/.test(text)) throw new SoundpadError('unexpected');
      return text;
    }
    case 'xml': {
      try {
        return parseXml(text);
      } catch {
        throw new SoundpadError('unexpected');
      }
    }
    default:
      throw new TypeError(`unknown answer kind: ${kind}`);
  }
}

/** @returns {number} negative, zero or positive, like a sort comparator */
export function compareVersions(a, b) {
  const parts = (version) => String(version ?? '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const difference = (x[i] ?? 0) - (y[i] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

/** Whether a Soundpad that reports this remote control version knows the command. */
export function supports(rcVersion, name) {
  const spec = COMMANDS[name];
  if (!spec) return false;
  // An unknown version is tried anyway: Soundpad answers R-404 to a command it does not know.
  return !rcVersion || compareVersions(rcVersion, spec.since) >= 0;
}
