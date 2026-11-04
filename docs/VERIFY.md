# Manual check on a real device

CI cannot see the device or run Soundpad. Run this in Ulanzi Studio on Windows, with Soundpad, before publishing each release, and record the result under "Technical details" in the draft's notes. Pushing an image gets no reply from the device, so a lost frame looks exactly like a drawn one: look at the keys, not just Studio's preview.

Setup: download the zip from the draft release, or run `npm run package`, and install it as in [INSTALL.md](INSTALL.md). Start Studio with `--log` to see the `[Soundpad Pro]` lines. Use a Soundpad with at least 30 sounds in a few categories, one empty category, and two sounds with the same title. Before starting, run `npm run test:live` with `SOUNDPAD_LIVE=1` on the same machine and record its output: it checks this plugin's assumptions about Soundpad without playing anything.

## First run

- [ ] The plugin and its four actions appear in Studio, with the right icons and names, in English and in Portuguese
- [ ] A new **Favorite sound** key shows "Choose a sound" on the device, and a press shows Studio's alert
- [ ] The settings panel has no background of its own, readable labels, and the connection line says "Connected" with the Soundpad version and sound count
- [ ] Diagnostics shows the remote control version, and no file path

## Favorites

- [ ] Searching finds sounds by part of the name, without accents or case; the category filter works; an empty category says so
- [ ] ▶ plays the sound on the speakers only: someone on a call does not hear it
- [ ] Choosing a sound updates the key **on the device** at once
- [ ] A press plays it, on each **Plays on** choice: both, speakers, microphone (check on a call or with Soundpad's own meter), and as set in Soundpad
- [ ] The key turns green while playing and white when the sound ends by itself; with **Turn green** off it stays white
- [ ] **Play, or stop if playing** stops on a second press; **Stop the current sound, then play** cuts another sound off
- [ ] On the D200H, one touch plays once, not twice
- [ ] Adding sounds before it in Soundpad, then pressing, plays the same sound
- [ ] Dragging it to another place in Soundpad's list, then pressing, plays the same sound
- [ ] Removing it from Soundpad turns the key grey within 30 seconds, or at once after **Refresh library**; a press alerts and plays nothing else
- [ ] Moving its file on disk and adding it again finds it by name; the panel says it was found by name
- [ ] Two sounds with the same title both appear in the panel, each with its position, and each key plays its own
- [ ] Title, icon, icon color, background and "show the name" each change the key as expected, and the text is readable at arm's length
- [ ] A long name and a name with accents (Ação, Ñandú) draw correctly

## Library on the keys

- [ ] Ten **Library position** keys and three **Library navigation** keys in group `A` show the categories with their counts
- [ ] Opening a category shows its sounds; page buttons show `1/N` and move; the last page wraps to the first
- [ ] Next and previous category show the name they lead to and move through all of them
- [ ] Back returns to the category list on the right page
- [ ] A sound on a page plays on the group's **Plays on**; the key turns green
- [ ] Changing **Positions** in the group options changes the page size on every key of the group
- [ ] With **Remember where I left off** on, restarting Studio comes back to the same category and page; with it off, to **Start in** and **Start page**
- [ ] A second group `B` browses on its own; moving `B` never redraws `A` or any favorite
- [ ] Removing the open category in Soundpad sends the group back to the list after a refresh
- [ ] An empty category shows "Empty category" on its first position

## Playback controls

- [ ] Stop is dim while nothing plays and green while something plays, including a sound started from Soundpad itself (within 3 seconds)
- [ ] Pause turns yellow and resumes; next, previous, random and replay do what they say
- [ ] Volume up and down move Soundpad's slider by 1 per press and by 10 while held (letting go stops it, and the D200H sends a release) and show the value; mute shows the crossed speaker and Soundpad's mute; the microphone key mutes and unmutes the default Windows microphone (check the Windows sound settings or a call) and shows the crossed microphone

## Life cycle

- [ ] Closing Soundpad turns every key red within a few seconds; opening it again brings them back by themselves within 30 seconds
- [ ] Starting Studio before Soundpad works: the keys turn from red to ready once Soundpad opens
- [ ] Soundpad and Studio run one as administrator and one not: the panel says Windows refused the connection
- [ ] Going to another page and back redraws the keys at once
- [ ] Unplugging and replugging the device redraws the keys
- [ ] Removing every key of the plugin: Soundpad's remote control log (see [TROUBLESHOOTING.md](TROUBLESHOOTING.md)) shows no more requests
- [ ] Quitting Studio leaves no `node` process of this plugin running after about 3 minutes, the time it spends retrying the connection

## Performance

- [ ] `npm run measure` on this machine: record the numbers in the release notes
- [ ] With 13 keys, Studio's Node process stays near 0% CPU while idle in Task Manager, and under 100 MB of memory
