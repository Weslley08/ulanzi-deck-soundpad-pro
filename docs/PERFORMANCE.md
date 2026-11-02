# Performance

The maintainer requires the plugin to spare the user's machine, and the numbers to be measured before each release. `npm run measure` runs the real plugin against a fake Studio and a **simulated** Soundpad, so it measures the plugin alone. On Linux and macOS the simulated pipe is a Unix socket; only on Windows is it a named pipe. The release workflow runs it on a GitHub Windows runner and puts the output in the draft's notes.

## Last measurement

2026-11-02, Node 20.12.2 on Linux (cloud container, 2 cores of an Intel Xeon at 2.1 GHz), `node scripts/measure.mjs 13 500 60`: 13 keys (4 favorites, 5 positions of one group, 2 navigation buttons, stop and volume), 500 sounds in 20 categories.

| | |
|---|---|
| Memory at start, no keys | 61.8 MB |
| Memory with keys drawn | 86.0 MB (heap 10.3 MB, WASM and buffers 8.2 MB) |
| Memory after 60 s idle | 79.0 MB |
| Memory after 40 page turns | 80.1 MB |
| Memory after all keys left | 84.4 MB |
| CPU idle | 0.12% of one core, 22 Soundpad requests in 60 s |
| CPU while a sound plays | 0.14% of one core, 2 status requests a second |
| First paint of every key | 185 ms, 227 ms of CPU |
| One page turn | 4.5 ms of CPU, 6.2 images sent |
| One press that plays | 4.6 ms of CPU |
| Image sent per key | 4.9 KB |
| After every key left | 0 pipe connections, 0 requests in 3 s |

Not measured: the real Ulanzi Studio, a real Soundpad, Windows itself, and the device. The idle requests are the stop key watching the playback state every 3 s and the sound count every 30 s; without a stop or pause key on screen, idle is 2 requests a minute.

## The WASM optimizer

Before 0.1.0 shipped, the same run showed 157 MB with keys drawn and 840 ms of CPU for the first paint. Profiling showed V8 compiling the resvg engine a second time with its optimizer (TurboFan) a few seconds after the first images, which cost about 55 MB that never came back and 0.5 s of CPU. With `--liftoff-only` each image takes about 3.7 ms instead of 2.9 ms, measured over 200 renders. Studio starts the process, so the flag is set from `plugin/render/renderer.js` with `v8.setFlagsFromString` before resvg is compiled. `test/load.test.mjs` fails if memory with 38 keys goes back over 130 MB.

Clima Pro uses the same engine and likely pays the same cost; its `npm run measure` reads memory one second after the first paint, which may be before the second compilation finishes.

## What keeps it light

- One pipe connection and one copy of the library for every key, opened with the first key and closed with the last.
- No timer runs without a key on screen that needs it (see [ARCHITECTURE.md](ARCHITECTURE.md#timers)).
- The library is read once on connect, then only when the sound count changes or someone asks; reads asked for within 250 ms are merged.
- A face equal to the last one sent is not sent again, and identical faces share one render, up to 96.
- A press goes ahead of any list download in the queue, and never waits for a render.
- No native binaries, no child processes.

## Load tests

`test/load.test.mjs` runs 38 keys in three groups with 800 sounds and checks one connection, one library read, memory, CPU while paging and idle, and that everything stops when the keys leave. `test/library.test.mjs` reads 2,000 sounds in 40 categories, and `test/navigation.test.mjs` pages through 1,000.
