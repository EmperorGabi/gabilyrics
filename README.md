# Gabilyrics — lyrics presenter

A desktop app for showing song lyrics at live events, church services and livestreams.

- **Instant search**: searches song titles and every line of the lyrics in your local library as you type (well under 1 ms for normal libraries, a few ms at 10,000 songs).
- **Online search**: runs only when nothing local matches (or when you press *Also search online*). Results come from [LRCLIB](https://lrclib.net), which is free and needs no key. Save a result to your library with one click. Songs you send live from the web are saved automatically, so next time they come from your library, even offline.
- **Lower third or full screen**: switch with one click (or `L` / `F`). Lower thirds split each slide into pages of 2 lines (you can change this).
- **Outputs**:
  - **NDI Program**: follows the operator's style; transparent background in lower-third mode.
  - **NDI Lower-third key**: always a lower third, with an alpha channel for keying in OBS / vMix / TriCaster / ATEM software.
  - **Projector**: a borderless full-screen window on a second display.
  - **Browser source**: `http://127.0.0.1:7380/output?style=lower` (or `full`, `follow`) for OBS, vMix or Ecamm. It's transparent wherever there is no text.

## Run it

You need [Node.js 20+](https://nodejs.org).

```bash
npm install
npm start
```

Your library, service plan and settings live in your user data folder (*Settings → Open data folder*).

## Build an installer

```bash
npm run dist:win   # Windows .exe installer   (run on Windows)
npm run dist:mac   # macOS .dmg               (run on a Mac)
```

The installer is written to `dist/`.

## Enable NDI

NDI uses the native module `@stagetimerio/grandiose`, which downloads the NDI SDK and compiles when you install. It's listed as optional, so if it can't build, the rest of the app still installs and works.

1. Install the free **NDI Tools** (which includes the runtime) from https://ndi.video.
2. Install a C++ build toolchain:
   - **Windows:** "Visual Studio Build Tools" with the *Desktop development with C++* workload, plus Python 3.
   - **macOS:** run `xcode-select --install`.
3. In the project folder, run `npm run ndi:install`, then `npm start`.

The status pills at the top of the console turn green when the senders are running. The output list shows how many receivers are connected. In OBS, add an **NDI Source** (with the DistroAV plugin) and pick `GABILYRICS (Lower third)`.

## Keyboard

| Key | Action |
| --- | --- |
| `/` or `Ctrl/Cmd+F` | Search |
| `↑ ↓ Enter` in search | Pick a result |
| `→` `Space` `PageDown` | Next page / slide |
| `←` `PageUp` | Previous |
| `1`–`9` | Send that slide of the selected song live |
| `C` | Clear / restore text |
| `Esc` | Clear text |
| `L` / `F` | Lower third / Full screen |

## Adding songs

- **New song**: type or paste the lyrics. A blank line starts a new slide. Label a slide with `[Chorus]`, `[Verse 2]`, `[Bridge]` and so on.
- **Import**: `.txt` files (the file name becomes the title; optional `Title:` / `Author:` lines at the top) or a `.json` export from Gabilyrics.
- **Export library**: makes a JSON backup.

## Licensing

Projecting or streaming copyrighted lyrics usually needs a licence (for example CCLI and its streaming licence). Put your licence number under *Settings → Full-screen style* and it appears in the credit line.

## Project layout

```
src/main/      Electron main process: windows, IPC, storage, NDI, output web server, online search
src/renderer/  Operator console (HTML/CSS/JS)
src/output/    Output renderer, used by the projector, NDI, monitors and browser sources
src/shared/    Search index and lyrics parser (shared and unit-tested)
test/          npm test
```

To add another online lyrics provider, add an entry to `providers` in `src/main/online.js`.
