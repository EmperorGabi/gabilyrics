# Gabilyrics — lyrics presenter

A desktop app for showing song lyrics at live events, church services and livestreams.

## Download

| Windows | Mac (Apple Silicon: M1–M4) | Mac (Intel) |
|---|---|---|
| [**Download for Windows**](https://github.com/EmperorGabi/gabilyrics/releases/latest/download/Gabilyrics-Setup.exe) | [**Download for Mac (Apple Silicon)**](https://github.com/EmperorGabi/gabilyrics/releases/latest/download/Gabilyrics-mac-arm64.dmg) | [**Download for Mac (Intel)**](https://github.com/EmperorGabi/gabilyrics/releases/latest/download/Gabilyrics-mac-x64.dmg) |

All versions and release notes: [Releases](https://github.com/EmperorGabi/gabilyrics/releases/latest).

**First launch:** the app isn't code-signed yet.
- **Windows:** if SmartScreen says "Windows protected your PC", click **More info → Run anyway**.
- **Mac:** open the `.dmg`, drag Gabilyrics to Applications, then **right-click the app → Open → Open** the first time.

> Not sure which Mac you have? Apple menu → **About This Mac**: "Chip: Apple M…" means Apple Silicon, "Processor: Intel" means Intel.

- **Instant search**: searches song titles and every line of the lyrics in your local library as you type (well under 1 ms for normal libraries, a few ms at 10,000 songs).
- **Online search**: runs only when nothing local matches (or when you press *Also search online*). Results come from free sources searched at the same time: Genius (finds songs from a line of the lyrics, needs a free token), LRCLIB, Hymnary.org and lyrics.ovh. Save a result to your library with one click. Songs you send live from the web are saved automatically, so next time they come from your library, even offline.
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

### Publishing a new version

GitHub builds Windows and Mac installers automatically (`.github/workflows/build.yml`). To publish a version that people can download from the links above:

```bash
git tag v1.0.1
git push origin v1.0.1
```

After about 15 minutes the new release is live and the download links point to it.

## NDI

NDI works out of the box: `npm install` downloads the `grandi` package, which includes prebuilt NDI binaries for Windows, macOS and Linux. Nothing needs to be compiled, and you don't need to install the NDI SDK.

- The status pills at the top turn green when the senders are running. The output list shows how many receivers are connected.
- In OBS, install the DistroAV plugin, add an **NDI Source** and pick `GABILYRICS (Lower third)`. vMix, Wirecast, TriCaster and NDI Studio Monitor see it directly.
- If the pills stay orange, Settings shows the exact error. Windows Firewall may ask to allow Gabilyrics on first launch: allow it on private networks, or other computers won't see the NDI sources.

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
