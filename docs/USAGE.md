# Using Soundpad Controller

There are four actions. Drag any of them onto any key, as many times as you like.

| Action | What the key does |
|---|---|
| **Favorite sound** | Plays one sound you choose |
| **Library position** | Shows one entry of a library page: a category, or a sound |
| **Library navigation** | Moves the library: next and previous page or category, back, refresh |
| **Playback control** | Stop, pause, next, previous, random, replay, volume or mute |

## What the colors mean

| Key | Meaning |
|---|---|
| White symbol | Ready |
| Green ring, bars in the corner | Playing |
| Yellow ring, pause sign in the corner | Paused |
| Red ring, warning in the corner | Soundpad is closed or cannot be reached; the panel says why |
| Grey ring, crossed circle in the corner | The sound is no longer in Soundpad |
| Dim ring, no symbol | An empty position past the end of the page |

The corner marks are there so the state reads without telling colors apart.

## Favorites

1. Put **Favorite sound** on a key and open its settings.
2. Under **Library**, pick a category or keep **All sounds**, and type part of a name to narrow the list.
3. Press ▶ to hear a sound first. Previews play on your speakers only, never on the microphone.
4. Click the sound to choose it. The key shows it at once.

Options:

- **Plays on**: speakers and microphone, speakers only, microphone only, or as set in Soundpad. "Microphone" means Soundpad plays the sound into your microphone, so people on a call hear it.
- **On press**: always play; play, or stop if this sound is already playing; or stop whatever plays, then play.
- **Turn green while playing**: off keeps the key white.
- **Title**: what the key says. Empty uses the sound's name. **Show the name on the key** off leaves only the symbol.
- **Icon** and **Icon color**, and **Background**, black or graphite.

A favorite remembers what the sound is, not where it was in the list. Adding, removing or reordering sounds in Soundpad does not make it play another sound. If its file moved, it finds the sound by name, artist and length, and the panel says so. If the sound is gone, the key turns grey and a press does nothing but alert; choose it again. Two sounds with the same name both show in the list, with their position after the name.

## The library on your keys

A **group** is a set of keys that browse together. Each group shows either the list of categories, or the sounds of one category, one page at a time.

A simple layout on a D200:

```
[pos 1] [pos 2] [pos 3] [pos 4] [pos 5]
[pos 6] [pos 7] [pos 8] [pos 9] [pos 10]
[ back ] [ ◀ page ] [ page ▶ ]
```

1. Put **Library position** on the keys that should show entries, all with the same **Group** name (for example `A`), numbered 1, 2, 3 and so on in **Position**.
2. Put **Library navigation** on the keys that move, with the same **Group** and a **Button**: next page, previous page, next category, previous category, back to categories, or refresh.
3. At first the positions show your categories, with how many sounds each holds. Press one to open it: the positions now show its sounds. Press a sound to play it. **Back** returns to the categories, on the page that holds the category you left.

The page buttons show the page you are on, like `2/5`, and wrap from the last page to the first. Category buttons show the name of the category they lead to. A button with nowhere to go looks dim.

**Group options**, in the panel of any key of the group, apply to the whole group:

- **Positions**: how many entries a page holds. 0 counts the position keys on the deck.
- **Start in** and **Start page**: where the group starts.
- **Remember where I left off**: the group comes back where it was after Studio restarts.
- **Plays on** and **On press**: as for favorites, for every sound the group plays.

Give a second set of keys another group name, such as `B`, and it browses on its own. Moving one group never changes another, and never changes a favorite.

When sounds are added or removed in Soundpad, the pages follow: a deleted sound disappears from its page rather than being replaced by whatever took its place. A category that was removed sends the group back to the category list.

## Playback controls

- **Stop** shows green while something plays and dims when nothing does.
- **Pause and resume** turns yellow while paused.
- **Next sound** and **Previous sound** follow Soundpad's own list and selection.
- **Random sound** plays any sound, on the outputs you choose.
- **Play the last sound again** replays what played last.
- **Volume up** and **Volume down** move Soundpad's speaker volume in steps of 10 and show it, like `70%`. **Mute and unmute** shows a crossed speaker when muted. There is no volume control for the microphone in Soundpad's remote control.

Random, replay and categories need a recent Soundpad. On an older one, those keys alert on press and the panel's Diagnostics shows the remote control version.

## The settings panel

At the top of every panel, **Connection** says whether Soundpad answers, its version and how many sounds it has, with **Reconnect** and **Refresh library** buttons. **Diagnostics** shows the details to include in a bug report. It never shows file paths.

## Languages

The panel and the messages on the keys are in English and Portuguese. Keys draw the Latin alphabet only, so other scripts in a sound's name are left out on the key; the panel shows them.
