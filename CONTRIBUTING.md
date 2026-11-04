# Contributing

You do not need a Ulanzi device or Soundpad to contribute. The tests run the real plugin and the real Ulanzi SDK against a fake host and a simulated Soundpad, and the settings panel runs in a real browser.

## Start

Fork the repository, then:

```bash
git clone https://github.com/<you>/ulanzi-deck-soundpad-pro.git
cd ulanzi-deck-soundpad-pro
nvm use          # Node 20.12.2, the version Ulanzi Studio runs plugins on
npm run setup
npm test
```

Open a pull request against `develop`. CI runs the tests on Windows, measures coverage, checks licenses, builds the zip and checks it. Keep each pull request to one change.

## Commands

| Command | What it does |
|---|---|
| `npm test` | All tests. The panel tests skip if no Chromium is installed; set `CHROME_PATH` to use one. |
| `npm run test:coverage` | All tests, and fails if coverage of `plugin/` drops below the floors in `scripts/run-tests.mjs`. The panel runs in a browser, so it is not measured. |
| `npm run typecheck` | Checks the Soundpad layer and settings with TypeScript. Nothing is built: the plugin is plain JavaScript. |
| `SOUNDPAD_LIVE=1 npm run test:live` | On Windows with Soundpad open: checks this plugin's assumptions against your real Soundpad. It only reads, unless you also set `SOUNDPAD_LIVE_PLAY=1`, which plays and stops one sound on your speakers. Skipped everywhere else. |
| `npm run build:assets` | Regenerates icons, panel previews, store art and `docs/keys.png`. |
| `npm run build:glyphs` | Regenerates font outlines. Only needed for a new character. |
| `npm run package` | Builds `dist/com.ulanzi.soundpadpro.ulanziPlugin.zip`. |
| `npm run verify:package` | Checks the zip against the store checklist and starts the plugin from it against a simulated Soundpad. |
| `npm run measure` | CPU and memory. Include the numbers if your change could affect them. Arguments: keys, sounds, idle seconds. |
| `npm run bump -- 1.2.3` | Raises the version in every file that has it. The flow does this by itself; use it for a bigger jump. |
| `npm run check:secrets`, `check:sdk`, `check:licenses`, `audit` | The security and license checks CI runs. |

## The simulated Soundpad

`test/support/soundpad-sim.mjs` answers the remote control commands this plugin uses, in the shapes described in [docs/SOUNDPAD-API.md](docs/SOUNDPAD-API.md). It can add, remove and move sounds the way a user would, split answers into pieces, pad them with NUL bytes, answer slowly, refuse, close the connection or send garbage. On Windows it listens on a named pipe, elsewhere on a Unix socket.

The plugin always opens Soundpad's own pipe. Tests point it at the simulator with `--import test/support/fake-pipe.mjs` and `SOUNDPAD_SIM_PATH`, so the shipped plugin has no setting that could point it anywhere else.

**Passing against the simulator says nothing about a real Soundpad.** Only `npm run test:live` on Windows and [docs/VERIFY.md](docs/VERIFY.md) do.

## Rules the code depends on

- **Never play the wrong sound.** A favorite is found by what it is, never by position alone, and the position is checked right before playing. A request that times out closes the connection, because a late answer would be read as the answer to the next request.
- **Only commands from the table in `protocol.js` reach Soundpad**, with whole numbers and `true`/`false` as the only arguments. Nothing from the panel, a profile or Soundpad itself becomes part of a command. Commands that change the user's library or record are not in the table, and must not be added.
- **Spend the user's machine carefully.** One connection for every key, nothing running while no key is on screen, no polling without a key that needs it, an unchanged image is not sent again. See [docs/PERFORMANCE.md](docs/PERFORMANCE.md).
- **Nothing private in logs.** Sound names and file paths say things about the user. `report()` in `app.js` and the service's log take short fixed messages only, and the panel never shows a path.
- **Every failed press calls `showAlert`.** The store guidelines require it.
- **Do not edit `libs/` or `plugin/ulanzi-api/`.** They are verbatim copies of the Ulanzi SDK pinned in `sdk-lock.json`, and CI fails if they change. To update them, review the upstream diff, copy the files, run `node scripts/check-sdk.mjs --write`, and update the commits in the lock file.
- **Runtime dependencies need a good reason.** Each one ships to every user. No install scripts and no native binaries.

## Trying it for real

**With Soundpad and a device**, follow [docs/VERIFY.md](docs/VERIFY.md).

**In the official simulator**, note that as of commit `550ab80` it crashes when a plugin uses global settings, because of two undefined variables in `UlanziDeckSimulator/server/clients.js`. Fix your local copy by adding one line at the start of each handler:

```js
if(data.cmd === 'setGlobalSettings'){
  const context = utils.encodeContext(data); const oldParam = data.settings;   // add this
  ...
if(data.cmd === 'getGlobalSettings'){
  const context = utils.encodeContext(data); const { uuid, actionid, key } = data;   // add this
```

Then copy the plugin folder into the simulator's `plugins/` folder and start the main service with the simulator's port, on Windows with Soundpad open:

```bash
node plugin/app.js 127.0.0.1 39069 en
```

## How a change ships

```
feature/*, fix/*, chore/*...  ->  develop  ->  release/vX.Y.Z  ->  main
```

A person merges at each arrow, and the rest happens by itself, in two workflows whose jobs live in [ulanzi-plugin-pipeline](https://github.com/Weslley08/ulanzi-plugin-pipeline). The files here only say when they run and what differs for this plugin:

- **Gate** (`gate.yml`) decides whether a change may merge: the branch rules, workflow lint, tests, coverage, the zip, licenses, known vulnerabilities, CodeQL and dependency review. It also runs each week. Its **Branch flow** check refuses a pull request that skips a step, and the rest waits for that check.
- **Delivery** (`delivery.yml`) moves the change along: it opens the pull requests, builds and validates a release, creates the draft and, once the maintainer allows it, publishes it.

1. **Push a branch** named `feature/`, `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `test/`, `ci/`, `build/` or `perf/`. Its pull request to `develop` opens by itself, unless you closed an earlier one. From a fork, open it by hand. The Gate must pass.
2. **Merge into `develop`.** If the version there is already released, or too low for what merged, a `bump/` pull request raises it and merges itself: a new feature raises the second number, and anything else the third. Then a pull request from `develop` to `release/vX.Y.Z` opens, and later merges join it.
3. **Merge into `release/vX.Y.Z`.** This is the approval, because GitHub does not let a person approve a pull request in their own name. The zip is built once and must start on Windows against a simulated Soundpad, and `npm run measure` runs on Windows. If all of that passes, a draft release gets the zip, its checksum and the numbers, and a pull request to `main` opens.
4. **Test the draft's zip** with [docs/VERIFY.md](docs/VERIFY.md) and put the result under "Technical details" in the draft's notes. Replace the top of the notes with what changes for customers, because stores show them the whole text. Then tick both boxes in the pull request.
5. **Merge into `main`.** Once the maintainer has turned publishing on (below), the draft is published as the final release, its tag is created on the commit that was validated, the release branch goes away, and the `latest` branch follows. Until then the draft stays a draft and the job says so.

A tag, its release and the plugin all carry the same number. `Version` in `manifest.json` is the source: the settings panel shows it at the bottom as `Soundpad Controller v1.2.3`, so a user can tell which release they run.

- **A problem in the draft:** fix it in a new branch and go through `develop` again. The new merge into the release branch validates again, replaces the zip and the technical details, keeps the text you wrote above them, and clears the boxes. No tag has to move, because a draft has none yet.
- **A problem after publishing:** the next version fixes it. A number is never reused, and an older version is never published after a newer one, because a store that orders by publish date would show it as current.
- **A release that stayed a draft after the merge:** the Delivery run fails if the top of the notes was not written. Write it and run that job again.
- **Something that reached `main` directly:** a pull request from `main` to `develop` opens and merges itself, and asks for no new version.
- **Merge commits only:** the repository allows no other kind, because the flow reads the merged branches from them and the release branch must end up inside `main`.
- **Dependabot:** its security updates always open against `main`, whatever the configuration says, so change their base to `develop`.

### Setup for the maintainer

Each of these is needed once, and a step that lacks a secret fails and names it.

- **Settings:** from a clone of [ulanzi-plugin-pipeline](https://github.com/Weslley08/ulanzi-plugin-pipeline), `node scripts/setup-repo.mjs Weslley08/ulanzi-deck-soundpad-pro` protects `develop`, `main` and `release/v*`, allows merge commits only, and turns on auto-merge and the security settings. Add `--dry-run` to see the changes first.
- **`AUTOMATION_TOKEN`:** a [fine-grained token](https://github.com/settings/personal-access-tokens/new) for this repository only, with read and write on **Contents** and **Pull requests**. A pull request opened with the workflow's own token leaves the Gate waiting for a click on "Approve workflows to run". Set it with `gh secret set AUTOMATION_TOKEN`, and again when it expires.
- **Publishing** is always on: merging a release into `main` publishes the draft, and there is no variable to turn it off.

No other secret is needed: no check talks to an outside service.

## Security

Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).
