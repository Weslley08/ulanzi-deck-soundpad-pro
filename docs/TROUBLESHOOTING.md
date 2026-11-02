# Troubleshooting

Open a key's settings: **Connection** and **Diagnostics** at the top say most of what is below.

| You see | Likely cause | What to do |
|---|---|---|
| Keys red, **Soundpad closed** | Soundpad is not open | Open Soundpad. The keys connect by themselves within 30 seconds, or press **Reconnect** |
| Keys red, panel says Windows refused the connection | One of Soundpad and Ulanzi Studio runs as administrator and the other does not | Run both the same way |
| Panel says another program is using the remote control | Another tool holds Soundpad's pipe | Close it, or wait: the plugin retries |
| Keys red, **Update Soundpad** | This Soundpad has no remote control, or answers commands as unknown | Update Soundpad |
| A favorite is grey | Its sound was removed from Soundpad, or several sounds now match it | Choose the sound again in the panel |
| A favorite plays nothing on the microphone | **Plays on** is set to speakers, or Soundpad's microphone is not set up | Check **Plays on**; in Soundpad, check the microphone in its settings |
| Random or replay keys alert | Soundpad's remote control is older than 1.1.2 | Update Soundpad; Diagnostics shows the version |
| Categories missing | Soundpad's remote control is older than 1.1.0, or the categories are hidden in Soundpad | Update Soundpad, or show the categories in Soundpad |
| New sounds take a while to show | The plugin compares the sound count every 30 seconds | Press **Refresh library**, or a refresh key |
| A renamed sound keeps its old name on a page | Renaming keeps the count the same, so it is seen on the next refresh | Press **Refresh library** |
| A sound started in Soundpad does not turn its key green | The remote control cannot say which sound plays | Expected; stop and pause keys still follow it |
| The plugin is missing in Studio | The folder is in the wrong place, or the **Source code** archive was used | See [INSTALL.md](INSTALL.md) |
| Keys stay blank | The plugin stopped | Start Studio with `--log` and look for `[Soundpad Pro]` lines |

## Studio's log

Close Studio, then start it from a shortcut whose Target ends with `--log`, for example:

```
"C:\Program Files\Ulanzi Studio\Ulanzi Studio.exe" --log
```

The plugin writes short lines starting with `[Soundpad Pro]`: its version and Node at startup, each connection to Studio, each kind of failure talking to Soundpad, and why it stopped. They never include sound names or file paths. `exitCode=1` means it failed, and `exitCode=0` means it was asked to stop.

## Soundpad's own log of remote commands

Soundpad can log every remote command it receives. Set the registry value `logRcCalls` to `1` under `HKEY_CURRENT_USER\SOFTWARE\Leppsoft\Soundpad\MainFrame`, restart Soundpad, and open **Help ▶ Show logs**. Lines look like `Remote control: DoPlaySound(5, true, false): R-200: 2 ms`. This is from Soundpad's manual; it changes your registry, so set it back to `0` afterwards.

## Reporting a problem

Use the [bug report](https://github.com/Weslley08/ulanzi-deck-soundpad-pro/issues/new/choose) with the Diagnostics section of the panel and, if you can, a photo of the key. Check log lines for anything you would rather not share before pasting them.
