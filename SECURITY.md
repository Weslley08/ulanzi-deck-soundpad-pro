# Security

## Reporting a problem

Use [GitHub's private report](https://github.com/Weslley08/ulanzi-deck-soundpad-pro/security/advisories/new), not a public issue.

## What the plugin does with your data

- It talks to Soundpad through Soundpad's own remote control, the named pipe `\\.\pipe\sp_remote_control`, which only programs on this computer can open. It sends nothing over the internet, opens no port, runs no other program and reads or writes no file of yours.
- It reads your Soundpad sound list, with titles, artists, lengths and file locations, and keeps it in memory only. File locations never leave the plugin process: keys save a hash of a sound's location, not the location, because key settings travel in exported Studio profiles. The settings panel gets titles, artists and lengths, never locations.
- Each key's settings are stored by Ulanzi Studio: the chosen sound's hashes, position and title, and the key's options. The plugin's global settings hold the options and the last page of each library group. Studio's storage is not documented as encrypted.
- The only commands it can send to Soundpad are a fixed list: reading the list, categories, versions, playback state and volume; playing, stopping, pausing, next, previous, random and replay; and setting the speaker volume and mute. It cannot add, remove, move, save or record anything. Nothing typed in the panel or found in a profile can become part of a command.
- Its log lines in Studio's log are short and fixed: they never include sound names or file locations.

## How it is checked

Every pull request and release runs `npm audit`, dependency review, CodeQL, a license check, a secret scan of the repository and of the final zip, and an integrity check of the bundled SDK. The same checks run every week to catch problems found after a release, and Dependabot proposes updates.

These tools only find problems that are already known. Passing them does not prove the plugin has no vulnerabilities.

## Known limits

**Runtime.** Ulanzi Studio runs plugins on the Node.js it bundles, reported as v20.12.2. That version is past end of life and has known vulnerabilities, and a plugin cannot change it. To limit the exposure, the plugin opens no listening socket, runs no child processes, reads no user files and talks only to Soundpad's local pipe, treating everything that comes back as data with size limits.

**Soundpad's pipe.** Any program running as your user can open the same pipe and control Soundpad, with or without this plugin. Soundpad offers no authentication on it. If two programs use it at once, each waits for the other.

**Answers from Soundpad.** Sound and category names come from your files and are shown as text: on the keys they only select letter shapes, and in the panel they are set as plain text, so they cannot inject markup. The XML reader accepts elements and attributes only, refuses DTDs and entity declarations, and has size and depth limits.

**Bundled SDK.** The Ulanzi SDK is copied into the plugin, outside the reach of `npm audit` and Dependabot. It is pinned to reviewed commits in `sdk-lock.json`, and the weekly check reports upstream changes for a person to review.

**Local access.** Anything running as your user can read Studio's settings and connect to Studio's local socket. The plugin cannot protect against malware already on the machine.
