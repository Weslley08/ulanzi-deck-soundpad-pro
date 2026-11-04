# ulanzi-deck-soundpad-pro

Soundpad Controller, a plugin for Ulanzi Studio that plays Soundpad sounds from the keys of the D200, D200H and D200X, on Windows. Use the `ulanzi-plugin` skill for anything about the SDK, host or store. Its engineering follows `Weslley08/ulanzi-deck-clima-pro`; `docs/REFERENCE-PATTERNS.md` maps what came from there. Never change Clima Pro from work on this repository.

## Permanent requirements (set by the maintainer)

1. **Performance:** optimize to spare the user's device. Measure CPU and memory before each release (`npm run measure`) and report the numbers.
2. **Store compliance:** follow all marketplace policies and terms. Reread them before each submission, and never claim compliance with text nobody has read.
3. **Open source:** public repository, test pipeline, push validation, issue templates, simple fork flow.
4. **No known vulnerabilities ship:** blocking checks on PRs and releases, plus a weekly scan. Scanners only find known problems, so never present a green check as proof of safety.

Confirm with the maintainer before making the repository public, creating a release, publishing, or submitting to a store. The UUID `com.ulanzi.soundpadpro.ulanziPlugin` was chosen by the maintainer on 2026-11-01 and is fixed after publishing. Publishing stays off until the maintainer sets the repository variable `PUBLISHING_ENABLED` to `true`; never set it yourself.

## Commands

Run everything on Node 20.12.2 (`.nvmrc`), the version Studio runs plugins on. `npm run setup`, then `npm test`. See CONTRIBUTING.md for the rest.

## Decisions

- **Integration:** only Soundpad's documented remote control, the named pipe `\\.\pipe\sp_remote_control`. No keyboard automation. The commands, their sources and the interface's limits are in `docs/SOUNDPAD-API.md`. Leppsoft's Java reference client (remote control 1.1.2) wins where sources disagree.
- **One connection:** every key shares `SoundpadService` and one `PipeClient`. Never open a pipe per key. Requests go one at a time, presses jump the queue, and a timeout closes the connection.
- **Favorites by identity:** a key keeps hashes of the file location and of title, artist and length, and the position only as a hint. The position is checked with `GetSoundlist(i, i)` right before playing. If a Soundpad answers that differently, the plugin falls back to reading the whole list before each press.
- **Faces:** dark background, solid white symbols, green playing, yellow paused, red error or Soundpad closed, grey sound gone, each with a corner mark too. Text as outlines.
- **WASM:** `render/renderer.js` sets `--liftoff-only` before resvg loads. It saved about 70 MB and 0.6 s of CPU at startup on Node 20.12.2; see `docs/PERFORMANCE.md`.
- **Languages:** `en.json`, plus `pt_BR.json` and `pt_PT.json` with the same Brazilian Portuguese text, because Studio may report either.
- **No live service in CI:** there is nothing to reach, so there is no `release-validation` environment or secret.

## Things that are easy to break

- Only commands in the table in `plugin/soundpad/protocol.js` may reach Soundpad, with whole numbers and booleans as arguments. Never add a command that changes or records the user's library (`DoAddSound`, `DoRemove*`, `DoSave*`, `DoUndo`, `DoRedo`, `DoStartRecording*`).
- Never log sound names, titles or file paths, and never send a path to the panel. `report()` in `app.js` and the service's `log` take short fixed messages only.
- `libs/` and `plugin/ulanzi-api/` are verbatim SDK copies pinned in `sdk-lock.json`. Extend in `host.js`; do not edit them.
- Key images must be full data URIs. Devices silently ignore bare base64, and Studio's preview hides the bug.
- Handle only `run` for presses: the D200H fires `keydown` and `run` for one touch.
- The plugin keeps no global settings. Everything a key needs is in its own settings, so Studio is asked for nothing but the keys.
- A subscription to `SoundpadService` keeps the pipe open. Use `beforeNotify`, not a subscription, for anything that is not a key.
- The panel's `DEFAULTS` and option lists must match `plugin/settings.js`; `test/manifest.test.mjs` checks it.
- The simulator in `test/support/soundpad-sim.mjs` is not Soundpad. Never present a simulated pass as a check of the real thing.

## What has not been verified

As of 2026-11-02 nothing has run with a real Soundpad, in the real Ulanzi Studio, or on a device. All 263 tests pass with Node 20.12.2 on Linux and, in CI on PR #1, on Windows, where the simulated Soundpad listens on a real named pipe and the panel runs in Windows Chrome. That first Windows run found three problems the Linux runs had not: two tests racing the pipe server, and panel status written before its language file arrived. The protocol comes from Leppsoft's reference client read through a web reader (the file itself could not be downloaded) and two public clients, not from watching Soundpad. In particular unconfirmed: that `GetSoundlist(i, i)` returns that one entry, the exact XML attribute names, how answers are split on a real pipe, `IsTrial` and the handshake on old versions, whether `fs.existsSync` sees the pipe (used only by `test:live`), and Windows refusing the pipe between elevated and normal processes. `npm run test:live` on Windows and `docs/VERIFY.md` cover these. The Gate ran on PR #1. Still failing there for lack of settings the maintainer has to make: `review` (dependency graph off) and Delivery's `Next step` (no `AUTOMATION_TOKEN`). The rest of the branch flow, from `develop` on, has not run.
