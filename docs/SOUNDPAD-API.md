# Soundpad remote control: what this plugin uses

Read on 2026-11-01. Leppsoft's page <https://www.leppsoft.com/soundpad/en/rc/> says remote control 1.1.2 is current and links a Java reference client, `SoundpadRemoteControl.java` (MIT), as the description of "all available remote commands". The manual's remote control section (<https://www.leppsoft.com/soundpad/help/manual/tutorial/rc/>) describes the command line and logging, and says its own list may be outdated.

The Java file could not be downloaded from this session (the host was outside the network allowlist), so it was read through a web reader that quoted its code in pieces. Two public clients were read in full for the details it left out: [soundpad.js](https://github.com/Seblor/soundpad.js) (MIT) and [SoundpadConnector](https://github.com/medokin/soundpad-connector) (.NET). Where they disagree with the Java client, the Java client wins. Nothing here has been checked against a running Soundpad; `npm run test:live` does that on Windows.

## Transport

- Windows named pipe `\\.\pipe\sp_remote_control`, opened read-write. Local only.
- A request is the command text, for example `DoPlaySound(5, true, false)`. No terminator.
- The answer is UTF-8 text. It can be padded with NUL bytes. One request, one answer, with no request id, so requests must not overlap: this plugin sends one at a time.
- The Java client waits 1 ms between requests sent in the same millisecond. This plugin waits 1 ms after each answer.
- An empty answer means the remote control is offline (Java client).
- Large answers arrive in several reads. The .NET client found a 1,200-entry list of 735,757 bytes on Soundpad 4.0.35, and Node reads at most 64 KB at a time by default (soundpad.js issue #2). This plugin reads until the XML root closes.

## Answers

- `R-200` is success. Other `R-` codes are errors, modeled on HTTP: `R-404` is "command not found". The manual documents only these two.
- Commands that return a value answer the value itself: a number, `PLAYING`, a version, or XML.
- `DoAddSound` and `DoRemoveSelectedEntries` fail in the trial version (manual). This plugin uses neither.

## Commands used

| Command | Since | Answer | Used for |
|---|---|---|---|
| `GetRemoteControlVersion()` | 1.0.0 | text | Handshake; older versions lack some commands |
| `GetVersion()` | 1.0.0 | text | Diagnostics |
| `IsTrial()` | 1.1.2 | `1` or `0` | Diagnostics and a hint in the panel |
| `IsAlive()` | 1.0.0 | `R-200` | Live test |
| `GetSoundFileCount()` | 1.0.0 | number | Cheap check for changes, every 30 s while keys are on screen |
| `GetSoundlist()` | 1.0.0 | `<Soundlist>` XML | The library |
| `GetSoundlist(from, to)` | 1.0.0 | `<Soundlist>` XML | Checking one position before playing it (see below) |
| `GetCategories(withSounds, withIcons)` | 1.1.0 | `<Categories>` XML | Categories, with `true, false` |
| `GetPlaybackPositionInMs()`, `GetPlaybackDurationInMs()` | not documented, tried on any version | milliseconds | The bar on a key. Seen in the public .NET client only. The length is asked once per sound and the position at each status poll (every 500 ms while a sound plays), and only while a key that shows a bar is on screen. An R-404 turns the bar off until the next connection |
| `GetPlayStatus()` | 1.0.0 | `STOPPED`, `PLAYING`, `PAUSED` or `SEEKING` | Key colors |
| `DoPlaySound(index)` | 1.0.0 | `R-200` | Output "As set in Soundpad" |
| `DoPlaySound(index, speakers, mic)` | 1.0.0 | `R-200` | Output chosen on the key |
| `DoStopSound()` | 1.0.0 | `R-200` | Stop, toggle and restart modes |
| `DoTogglePause()` | 1.0.0 | `R-200` | Pause and resume. Also the second press of a favorite in the default "pause" mode; `GetPlayStatus` after it says which happened |
| `DoPlayNextSound()`, `DoPlayPreviousSound()` | 1.0.0 | `R-200` | Next and previous |
| `DoPlayCurrentSoundAgain()` | 1.1.0 | `R-200` | Replay |
| `DoPlayRandomSound(speakers, mic)` | 1.1.2 | `R-200` | Random |
| `GetVolume()`, `SetVolume(n)` | 1.0.0 | number, `R-200` | Volume keys, 0 to 100: one step per press, ten (to the next multiple of ten) while the key is held |
| `IsMuted()`, `DoToggleMute()` | 1.0.0 | `1`/`0`, `R-200` | Mute key |

"Since" is the section of the Java client the command appears under. Commands are built only from a fixed table in `plugin/soundpad/protocol.js`, with whole numbers and `true`/`false` as the only arguments. No text from a profile, the panel or Soundpad itself ever becomes part of a command.

## XML

`GetSoundlist()`:

```xml
<Soundlist>
  <Sound index="1" url="C:\Sounds\horn.mp3" artist="" title="Horn" duration="0:02" addedOn="..." lastPlayedOn="..." playCount="0"/>
</Soundlist>
```

`GetCategories(true, false)`: nested `<Category index="" type="" name="" hidden="">` elements, each with the `<Sound>` entries that belong to it. A sound's `index` is its position in the whole list, the same as in `GetSoundlist()`. Attribute names come from the public clients and their test fixtures, not from a captured answer.

## Limits that shaped the plugin

- **A sound has no permanent id.** `index` is its position, and it changes when sounds are added, removed or moved. A key that kept only the position would play another sound after any of those. So each favorite keeps a hash of the file location, a second hash of title, artist and length (for a moved file), and the position only as a hint. See `plugin/soundpad/identity.js`.
- **Positions can change between reading the list and playing.** Before each play the plugin asks for that one position with `GetSoundlist(i, i)` and checks it is still the same file. That use of the range command is not documented as such; if a Soundpad answers it differently, the plugin notices once, logs it, and instead reads the whole list again right before each press.
- **No change notifications.** The pipe only answers. Changes are found by comparing the sound count every 30 s while keys are on screen, when a key comes back on screen, before a press when anything looks off, and on the panel's refresh button. A rename that keeps the count is only seen on those occasions.
- **No per-output volume.** `SetVolume` sets Soundpad's speaker volume, as the slider in Soundpad does. There is no command for the microphone level.
- **Next and previous** follow Soundpad's own order and selection. Which sound plays is Soundpad's choice, so no key can claim it and none turns green.
- **No command reads which sound is playing.** The plugin knows which sound its own keys started, so those keys turn green. A sound started from Soundpad itself, or by another program, turns no favorite green; it only shows on the keys that watch the playback state (stop and pause).
- **One client at a time.** Another program holding the pipe makes the plugin wait and retry (`pipe-busy`).
- **Windows only.** There is no remote control on other systems.

## Read again on 2026-11-03

Sources: Leppsoft's [remote control page](https://www.leppsoft.com/soundpad/en/rc/) (still 1.1.2, with no list of commands), the [manual](https://www.leppsoft.com/soundpad/help/manual/tutorial/rc/), the [changelog](https://www.leppsoft.com/soundpad/changelog) and its [archive](https://www.leppsoft.com/soundpad/en/changelog/archive/), and the source of the .NET client [SoundpadConnector](https://github.com/medokin/soundpad-connector) (tested by its maintainer on Soundpad 4.0.35, remote control 1.1.2). The Java reference client still could not be opened from here, so a command that only it would show is missing from this list. Nothing was run against a Soundpad.

### What each version of the interface added

| Interface | Soundpad | Date | Change |
|---|---|---|---|
| 1.1.0 | 3.3.0 | 2020-07 | Categories and new functions. Calls are logged (off by default since 3.3.1, turned on with the registry value `logRcCalls`) |
| 1.1.1 | 3.4.0 | 2021-04 | `DoPlaySoundFromCategory`. Access list so UWP apps can connect. **Return codes now carry additional information about errors** |
| 1.1.2 | 4.0.0 | 2024-04 | `DoPlayRandomSound`, `DoPlayRandomSoundFromCategory`, `IsTrial`. **The interface is available in the free version.** Fixed a crash when several commands arrived at once |
| (same) | 4.0.9 | 2024-08 | `GetSoundlist()` returns **color** and **tag** attributes of sounds |
| (same) | 4.0.29 | 2025-12 | `DoSeekMs` fixed for negative and zero values |

The crash fix in 4.0.0 is one more reason to keep sending one command at a time, as this plugin does. The new return codes mean an answer may be `R-` followed by a code and text we have never captured: the parser takes the three digits after `R-` and ignores the rest, so it should keep working, but only a real answer will say.

### Commands this plugin does not use yet

Read-only, so none of them changes anything:

| Command | Answer | What it could give a key |
|---|---|---|
| `GetPlaybackPositionInMs()`, `GetPlaybackDurationInMs()` | number | A progress bar and the time left on the stop key while a sound plays |
| `GetTitleText()`, `GetStatusBarText()` | text | Unknown. The .NET client has them without a comment. If either names the sound that is playing, it answers the one thing no other command does, and it would contain sound names, so it could never be logged |
| `GetRecordingPositionInMs()`, `GetRecordingPeak()` | number | A recording timer and a level meter |

They act, but only on playback:

| Command | What it does | What it could give a key |
|---|---|---|
| `DoPlaySoundFromCategory(categoryIndex, soundIndex, speakers, mic)` | Plays the sound at a position **inside a category**. `-1` stands for the selected category, and `soundIndex` counts from 1 within it, not in the whole list | A favorite that follows a category's own order |
| `DoPlayRandomSoundFromCategory(...)` | Plays a random sound of a category | A "random from this category" key. **The arguments are not confirmed**: only the Java client or a capture would say |
| `DoJumpMs(ms)`, `DoSeekMs(ms)` | Skips relatively, or goes to an absolute position, in the sound that plays | Skip back and forward keys, and restart |

They change Soundpad itself, so the command table keeps them out until the maintainer decides:

| Command | Why it is out |
|---|---|
| `DoStartRecording()`, `DoStopRecording()` | A recording ends up in the user's library. It would be a deliberate key press, like Soundpad's own button, but it is the one thing in this interface that writes |
| `DoSearch(text)`, `DoResetSearch()`, `DoSelectPreviousHit()`, `DoSelectNextHit()`, `DoSelectIndex(n)`, `DoScrollBy(n)`, `DoScrollTo(n)` | They move Soundpad's own window |
| `DoAddSound(path)`, `DoRemoveSelectedEntries(...)`, `DoUndo()`, `DoRedo()`, `DoSaveSoundlist()` | They change the library |

### Attributes

A sound has `index`, `url`, `artist`, `title`, `color`, `tag`, `duration`, `addedOn`, `lastPlayedOn` and `playCount`. A category has `index`, `type`, `name` and `icon`, with its sounds inside. Neither `color` nor `icon` has a documented format: they could be hex colors and image data, or something else. A captured answer is the only way to know, and `icon` comes only when `GetCategories(withSounds, withIcons)` is asked with icons, which would make the answer much larger.

### What this plugin could not do before and still cannot

- It cannot know which sound plays when Soundpad started it. Only `GetTitleText` or `GetStatusBarText` might, and nobody has said they do.
- It cannot set the microphone volume: `SetVolume` is the speaker level.
- It cannot hear about changes. It polls, as the table above says.

## Not used

`DoAddSound`, `DoRemoveSelectedEntries`, `DoAddCategory`, `DoRemoveCategory`, `DoSaveSoundlist`, `DoUndo`, `DoRedo` change the user's library, and `DoStartRecording*`, `DoStopRecording` record. None of them is in the plugin's command table, so nothing the plugin receives can reach them. `DoSearch`, `DoSelectIndex`, `DoScroll*`, `DoSelectCategory` and the like move Soundpad's own window, which a deck key should not do behind the user's back.
