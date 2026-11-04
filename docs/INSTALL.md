# Installing on Windows

You need:

- Windows 10 or 11
- [Ulanzi Studio](https://www.ulanzi.com/pages/ulanzi-app) with a D200, D200H or D200X
- [Soundpad](https://www.leppsoft.com/soundpad/) (Steam or standalone), with your sounds in it

Nothing else: the plugin brings everything it needs, and you do not need Node.js or npm.

## Steps

1. Download `com.ulanzi.soundpadpro.ulanziPlugin.zip` from [Releases](https://github.com/Weslley08/ulanzi-deck-soundpad-pro/releases). Not the **Source code** archives: they lack the plugin's dependencies, and the plugin will not start from them.
2. Close Ulanzi Studio.
3. Unzip into `%APPDATA%\Ulanzi\UlanziDeck\Plugins\`, so that you end up with `%APPDATA%\Ulanzi\UlanziDeck\Plugins\com.ulanzi.soundpadpro.ulanziPlugin\manifest.json`. Paste `%APPDATA%\Ulanzi\UlanziDeck\Plugins` into the Explorer address bar to get there. It says `UlanziDeck` even though the app is now called Studio.
4. Open Soundpad.
5. Open Ulanzi Studio. **Soundpad Controller** appears in the list of actions.
6. Drag **Favorite sound** onto a key, and choose a sound in the settings panel.

To update, close Studio, delete the old `com.ulanzi.soundpadpro.ulanziPlugin` folder, and unzip the new one in its place. Key settings are kept by Studio, not in that folder.

To uninstall, close Studio and delete that folder.

## Soundpad and Studio as administrator

Windows keeps programs running as administrator apart from ordinary ones. If one of Soundpad and Ulanzi Studio runs as administrator and the other does not, the keys show **Soundpad closed** and the panel says Windows refused the connection. Run both the same way.

## What the plugin does on your computer

It talks to Soundpad through Soundpad's own remote control, a named pipe that only programs on this computer can open. It sends nothing over the internet, opens no port, runs no other program and reads no file of yours. See [SECURITY.md](../SECURITY.md).
