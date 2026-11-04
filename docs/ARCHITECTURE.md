# Architecture

Soundpad Controller follows the structure of [Clima Pro](https://github.com/Weslley08/ulanzi-deck-clima-pro): one Node process started by Ulanzi Studio, one object per key on the deck, one shared service per outside resource, and key faces drawn as SVG and turned into PNG with resvg. What is specific to Soundpad is below. [REFERENCE-PATTERNS.md](REFERENCE-PATTERNS.md) lists what was taken from Clima Pro and where.

```
Ulanzi Studio ──WebSocket── plugin/app.js ──┬── keys/*.js (one per key) ──┐
     (SDK in plugin/ulanzi-api, wrapped     │                             │ subscribe
      by plugin/host.js)                    │                             │
                                            │                             ▼
                                            └── soundpad/service.js ── pipe-client.js ──named pipe── Soundpad
                                                   │ library.js, identity.js, protocol.js, xml.js
                                                   ▼
                                            render/ (face.js, symbols.js, text.js, renderer.js)
```

## Modules

| File | Does |
|---|---|
| `plugin/app.js` | Routes Studio's events to keys, starts the shared pieces, reconnects to Studio with backoff, reports to stderr |
| `plugin/host.js` | Subclass of the SDK that keeps messages out of the console and keeps port and language on reconnect |
| `plugin/settings.js` | Normalizes every setting from Studio and the panel against closed lists and patterns |
| `plugin/inspector-api.js` | What the panel may ask, with every field checked |
| `plugin/keys/base-key.js` | What every key shares: render only when the face changed, never block a press on a render, stay quiet while hidden |
| `plugin/keys/sound-key.js` | Favorite: one fixed sound |
| `plugin/keys/control-key.js` | Stop, pause, next, previous, random, replay, volume, mute |
| `plugin/soundpad/protocol.js` | The fixed command table, argument checks and answer parsing |
| `plugin/soundpad/xml.js` | A bounded reader for the XML Soundpad sends: elements and attributes only, no DTD |
| `plugin/soundpad/pipe-client.js` | The one connection: serial queue with a lane for presses, timeouts, reconnection with backoff |
| `plugin/soundpad/identity.js` | Stable ids for sounds, and finding a saved sound again |
| `plugin/soundpad/library.js` | The list and categories in the shape keys and the panel use |
| `plugin/soundpad/service.js` | Everything keys need from Soundpad: handshake, sync, verified playback, polling, volume |
| `plugin/render/*` | Key faces |

## One connection, shared

Every key subscribes to `SoundpadService`, and the service keeps exactly one `PipeClient`. The pipe opens when the first key subscribes and closes when the last one leaves; while no key is on the deck nothing runs at all. Requests go one at a time, because the pipe has no request ids and an answer belongs to whatever was asked last. A press goes to the front of the queue, so it never waits behind a list download.

A request that times out closes the connection instead of waiting: the late answer would otherwise be read as the answer to the next request and could start the wrong sound. An answer nobody asked for does the same. The next request, or the retry timer, opens a new connection.

## Favorites that stay right

A favorite saves:

- `soundId`: a hash of the file's location, normalized for case and slashes (Windows paths)
- `soundAlt`: a hash of title, artist and length, used only if the file moved
- `soundIndex`: the position when last seen, used only to pick between two entries of the same file
- `soundTitle`: for the panel and for the face while Soundpad is closed

Hashes, because a key's settings travel in exported profiles and a path can name the user's account. A press finds the saved sound in the current list, asks Soundpad for that one position, and plays only if it is still the same file. If anything disagrees, it reads the list again and tries once more. A sound that is gone shows grey and alerts; its old position is never played. Two sounds with the same title, artist and length, neither of them the saved file, are not guessed between.

## Library and changes

The list and categories are read when the pipe opens, after each reconnection, on the panel's refresh, and when the sound count changes. The count is checked every 30 s while a key is on screen and when a key comes back on screen. Requests to read again within 250 ms are merged into one. A read that changes nothing a key shows does not redraw anything.

## Drawing

`render/face.js` draws one layout for every key: a black or graphite background, a solid white symbol, an optional name that takes the largest size that fits, in up to three lines beside an icon and four with none, and a ring whose color says the state. Each state also has its own mark in the corner, so it never depends on color alone. Text is drawn from outlines generated at build time (`scripts/build-glyphs.mjs`), so names from Soundpad only select glyphs and can never inject markup. resvg turns the SVG into a 144×144 PNG, sent as a full data URI because devices ignore bare base64. Identical faces share one render, and a face equal to the last one sent is not sent again.

A press never waits for drawing: the service call goes first, and the face follows when the service reports a change.

V8's WASM optimizer is turned off before resvg loads (`--liftoff-only`, set from `renderer.js`). See [PERFORMANCE.md](PERFORMANCE.md).

## Timers

| Timer | Runs while | Interval |
|---|---|---|
| Reconnect to Soundpad | a key is on the deck and the pipe is closed | 1 s, doubling to 30 s |
| Sound count check | the pipe is open and a key is on screen | 30 s |
| Playback status | a sound plays and a key is on screen | 0.5 s (1.5 s paused) |
| Playback status, idle | a stop or pause key is on screen | 3 s |
| Reconnect to Studio | the socket to Studio closed | 1 s, doubling to 30 s, 10 tries |

Every one of them stops when its condition ends, and all of them stop when the last key leaves. `test/service.test.mjs` and `test/load.test.mjs` check that.
