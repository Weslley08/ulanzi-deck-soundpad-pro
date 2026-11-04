# Patterns taken from Clima Pro

The maintainer asked for this plugin to keep the engineering of [ulanzi-deck-clima-pro](https://github.com/Weslley08/ulanzi-deck-clima-pro) (read at `ed7ef6b`, v1.4.1), without its weather domain. This lists what was found there and what became of it here, so a later change to either can be carried across.

| Pattern in Clima Pro | Where it is | Here |
|---|---|---|
| Node 20.12.2 everywhere, the runtime Studio bundles | `.nvmrc`, `engines` | Same |
| Native ESM, no build step; types checked with `tsc --allowJs --checkJs --noEmit` on the riskiest modules | `tsconfig.json` | Same, on the Soundpad layer and settings, with null checks on |
| SDK copied verbatim and pinned by file hash and upstream commit; extended only in `host.js` | `sdk-lock.json`, `scripts/check-sdk.mjs`, `plugin/host.js` | Same files, same commits (`9e478b2`, `0aeb6a2`) |
| `host.js` overrides `send` so the SDK's console logging never sees messages, and keeps port and language on reconnect | `plugin/host.js` | Copied |
| `report()` to stderr is the only output; never settings or URLs | `plugin/app.js` | Same, prefixed `[Soundpad Pro]`; never sound names or paths |
| One router, one object per key, created on `add` or on a `run` that came first | `plugin/app.js` | Same, with a type per action |
| Only `run` for presses (D200H sends `keydown` and `run`) | `plugin/app.js` | Same |
| Shared hub: keys subscribe, polling only while a subscriber is on screen | `plugin/weather-hub.js` | `plugin/soundpad/service.js` |
| Dedupe faces: render only on change, never resend the same image, full data URI | `plugin/weather-key.js`, `render/renderer.js` | `plugin/keys/base-key.js`, `render/renderer.js` |
| Text as pre-built outlines, so remote text cannot inject SVG markup | `render/text.js`, `scripts/build-glyphs.mjs` | Copied; Outfit only |
| resvg-wasm, loaded on first use, freed explicitly | `render/renderer.js` | Same, plus the WASM optimizer turned off |
| Settings normalized against closed lists | `plugin/settings.js` | Same idea, more actions |
| Panel: plain HTML and JS on the SDK's `uspi.css`, console silenced, `textContent` only, links through `openUrl` | `property-inspector/weather/` | `property-inspector/soundpad/`, one panel for four actions |
| Real plugin and real SDK against a fake host over WebSocket | `test/host.test.mjs` | Same, plus a simulated Soundpad on a pipe |
| Panel in headless Chromium driven over CDP, no extra dependency | `test/inspector.test.mjs` | Same harness |
| Contract tests: manifest, languages by position, panel choices match code | `test/manifest.test.mjs` | Same, plus panel defaults match code |
| Outside services faked by `--import` preloads, so the shipped plugin has no setting that redirects it | `test/support/fake-fetch.mjs` | `test/support/fake-pipe.mjs` |
| Test runner listing files, coverage floors | `scripts/run-tests.mjs`, `scripts/lib/coverage.mjs` | Same, own floors |
| Zip by allowlist, deterministic, store checklist and a start from the unpacked zip | `scripts/package.mjs`, `scripts/verify-package.mjs`, `scripts/lib/zip.mjs` | Same; the smoke start reads a simulated Soundpad |
| Secret scan of the repository and the zip | `scripts/scan-secrets.mjs`, `scripts/lib/secrets.mjs` | Same, patterns for this project |
| `npm run measure`: CPU and memory against a fake host, put in the release notes | `scripts/measure.mjs`, `test/support/metrics.mjs` | Same approach, Soundpad workload |
| Version in the manifest as the source, bumped everywhere at once | `scripts/lib/version.mjs`, `scripts/bump-version.mjs` | Copied |
| Branch flow `work → develop → release/vX.Y.Z → main` in two workflows | `.github/workflows/gate.yml`, `delivery.yml`, calling `Weslley08/ulanzi-plugin-pipeline` | Shared with Clima Pro; `.github/pipeline.json` holds what differs, and merging into `main` publishes |
| Actions pinned by SHA; `pull_request`, never `pull_request_target`; jobs with the token run no npm | workflows | Same |
| Weekly scan, CodeQL, dependency review, `npm audit`, Dependabot to `develop` | `gate.yml`, `dependabot.yml` | Same, plus a license check |
| Issue templates asking device, OS, versions | `.github/ISSUE_TEMPLATE/` | Same, plus the Soundpad version |
| `CLAUDE.md` with the maintainer's permanent requirements and what has not been verified | `CLAUDE.md` | Same |

Not carried over: the WeatherAPI.com key handling, the Defesa Civil alert feed, themes, the `watch:updates` script and the live tests against web services. Clima Pro's `release-validation` environment and its secret are not needed here, because no check talks to an outside service.
