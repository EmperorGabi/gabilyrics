const { app, BrowserWindow, ipcMain, dialog, screen, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Store } = require('./store');
const { OutputServer } = require('./server');
const { NdiManager } = require('./ndi');
const online = require('./online');
const Lyrics = require('../shared/lyrics');

let store, server, ndi;
let consoleWin = null;
let projectorWin = null;

// What is on air right now. The console computes it; outputs render it.
let live = { mode: 'lower', blank: true, logo: false, seq: 0, song: null, label: '', text: '', page: '', first: true, next: null };

function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push('http://' + a.address + ':' + server.port);
  }
  return out;
}

function info() {
  return {
    version: app.getVersion(),
    port: server.port,
    serverUrl: server.url(''),
    lanUrls: store.settings.server.lan ? lanUrls() : [],
    dataDir: store.dir,
    displays: screen.getAllDisplays().map((d, i) => ({ id: d.id, label: 'Display ' + (i + 1) + ' — ' + d.size.width + '×' + d.size.height + (d.id === screen.getPrimaryDisplay().id ? ' (main)' : ''), primary: d.id === screen.getPrimaryDisplay().id })),
    ndi: ndi.status(),
    projector: !!(projectorWin && !projectorWin.isDestroyed()),
  };
}

function sendStatus() { if (consoleWin && !consoleWin.isDestroyed()) consoleWin.webContents.send('status', info()); }

// ---------- projector (second screen) ----------
function applyProjector() {
  const cfg = store.settings.outputs.projector;
  if (!cfg.enabled) { if (projectorWin && !projectorWin.isDestroyed()) projectorWin.destroy(); projectorWin = null; return; }
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const target = displays.find((d) => d.id === cfg.displayId) || displays.find((d) => d.id !== primary.id) || primary;
  const url = server.url('/output?style=' + encodeURIComponent(cfg.style) + '&target=projector');
  if (projectorWin && !projectorWin.isDestroyed()) {
    projectorWin.setBounds(target.bounds);
    projectorWin.loadURL(url);
    return;
  }
  projectorWin = new BrowserWindow({
    x: target.bounds.x, y: target.bounds.y, width: target.bounds.width, height: target.bounds.height,
    frame: false, backgroundColor: '#000000', show: false, skipTaskbar: true, title: 'Gabilyrics — Projector',
    fullscreen: target.id !== primary.id, webPreferences: { backgroundThrottling: false },
  });
  projectorWin.setMenuBarVisibility(false);
  projectorWin.loadURL(url);
  projectorWin.once('ready-to-show', () => { projectorWin.showInactive(); if (target.id === primary.id) projectorWin.setFullScreen(true); });
  projectorWin.on('closed', () => { projectorWin = null; sendStatus(); });
}

async function applyOutputs() {
  try { await ndi.apply(store.settings.outputs); } catch (e) { console.error('[ndi]', e); }
  applyProjector();
  sendStatus();
}

// ---------- console window ----------
function createConsole() {
  consoleWin = new BrowserWindow({
    width: 1440, height: 900, minWidth: 980, minHeight: 640, backgroundColor: store.settings.theme === 'light' ? '#F3F4F6' : '#0E1014', title: 'Gabilyrics',
    show: false,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  consoleWin.setMenuBarVisibility(false);
  consoleWin.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  consoleWin.once('ready-to-show', () => consoleWin.show());
  consoleWin.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  consoleWin.on('closed', () => { consoleWin = null; app.quit(); });
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('app:info', () => info());

  ipcMain.handle('library:all', () => store.library);
  ipcMain.handle('library:save', (_e, song) => store.upsertSong(song));
  ipcMain.handle('library:delete', (_e, id) => { store.deleteSong(id); return true; });

  ipcMain.handle('library:import', async () => {
    const r = await dialog.showOpenDialog(consoleWin, {
      title: 'Import songs', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Lyrics', extensions: ['txt', 'json'] }],
    });
    if (r.canceled) return { added: 0 };
    let added = 0;
    for (const f of r.filePaths) {
      const raw = fs.readFileSync(f, 'utf8');
      if (f.toLowerCase().endsWith('.json')) {
        let data; try { data = JSON.parse(raw); } catch (e) { continue; }
        const arr = Array.isArray(data) ? data : [data];
        for (const s of arr) {
          if (!s || !s.title) continue;
          const slides = Array.isArray(s.slides) ? s.slides : Lyrics.parse(s.lyrics || s.text || '');
          store.upsertSong({ id: s.id, title: s.title, author: s.author || '', copyright: s.copyright || '', source: 'local', slides });
          added++;
        }
      } else {
        // .txt: first line may be "Title: …" / "Author: …", else the file name is the title.
        let lines = raw.replace(/\r\n?/g, '\n').split('\n');
        let title = path.basename(f).replace(/\.[^.]+$/, '');
        let author = '';
        while (lines.length && /^(title|author|by|ccli|copyright)\s*:/i.test(lines[0])) {
          const [k, ...v] = lines.shift().split(':');
          if (/title/i.test(k)) title = v.join(':').trim();
          else if (/author|by/i.test(k)) author = v.join(':').trim();
        }
        store.upsertSong({ title, author, source: 'local', slides: Lyrics.parse(lines.join('\n')) });
        added++;
      }
    }
    return { added };
  });

  ipcMain.handle('library:export', async () => {
    const r = await dialog.showSaveDialog(consoleWin, { title: 'Export library', defaultPath: 'gabilyrics-library.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return false;
    fs.writeFileSync(r.filePath, JSON.stringify(store.library, null, 1));
    return r.filePath;
  });

  ipcMain.handle('plan:get', () => store.plan);
  ipcMain.handle('plan:set', (_e, plan) => { store.setPlan(plan); return true; });

  ipcMain.handle('settings:get', () => store.settings);
  ipcMain.handle('settings:set', async (_e, partial) => {
    const prevServer = JSON.stringify(store.settings.server);
    const s = store.setSettings(partial);
    nativeTheme.themeSource = s.theme === 'light' ? 'light' : 'dark';
    if (consoleWin) consoleWin.setBackgroundColor(s.theme === 'light' ? '#F3F4F6' : '#0E1014');
    if (JSON.stringify(s.server) !== prevServer) {
      await ndi.stopAll();
      await server.stop();
      await server.start(s.server.port, s.server.lan);
    }
    server.broadcast();
    await applyOutputs();
    return s;
  });

  ipcMain.handle('live:set', (_e, state) => {
    live = Object.assign({}, live, state, { seq: live.seq + 1 });
    server.broadcast();
    return live.seq;
  });

  ipcMain.handle('online:search', (_e, q) => online.search(q, store.settings.search.provider));

  ipcMain.handle('dialog:image', async () => {
    const r = await dialog.showOpenDialog(consoleWin, { title: 'Background image', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('open:data', () => shell.openPath(store.dir));
  ipcMain.handle('open:url', (_e, u) => { if (/^https?:\/\//.test(u)) shell.openExternal(u); });
}

app.whenReady().then(async () => {
  store = new Store(path.join(app.getPath('userData'), 'data'));
  nativeTheme.themeSource = store.settings.theme === 'light' ? 'light' : 'dark';
  server = new OutputServer(() => live, () => store.settings);
  await server.start(store.settings.server.port, store.settings.server.lan);
  ndi = new NdiManager(server);
  registerIpc();
  createConsole();
  await applyOutputs();
  setInterval(sendStatus, 3000);
  if (process.env.GABILYRICS_SELFTEST) selfTest(process.env.GABILYRICS_SELFTEST);
  screen.on('display-added', () => { applyProjector(); sendStatus(); });
  screen.on('display-removed', () => { applyProjector(); sendStatus(); });
});

// Developer self-test: drives the console, captures screenshots, then quits.
async function selfTest(dir) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => consoleWin.webContents.executeJavaScript(code);
  const shot = async (name, win) => { const img = await (win || consoleWin).webContents.capturePage(); fs.writeFileSync(path.join(dir, name + '.png'), img.toPNG()); };
  fs.mkdirSync(dir, { recursive: true });
  try {
    await wait(2500);
    await js(`document.querySelector('#q').value='grace';document.querySelector('#q').dispatchEvent(new Event('input'));`);
    await wait(400);
    await js(`document.querySelector('[data-card="1"]').click()`);
    await wait(900);
    await shot('1-console-lower');
    await js(`document.querySelector('#modeFull').click()`);
    await wait(900);
    await shot('2-console-full');
    await js(`document.querySelector('#q').value='marvelous';document.querySelector('#q').dispatchEvent(new Event('input'));`);
    await wait(2500);
    await shot('3-search-online');
    const res = await js(`document.querySelector('#results').innerText`);
    fs.writeFileSync(path.join(dir, 'results.txt'), res);
    await js(`document.querySelector('#toggleView').click()`);
    await wait(1200);
    await shot('4-settings');
    // render outputs standalone
    const out = new BrowserWindow({ show: false, width: 1280, height: 720, webPreferences: { offscreen: true } });
    await js(`document.querySelector('#toggleView').click(); document.querySelector('#modeLower').click()`);
    await wait(500);
    await out.loadURL(server.url('/output?style=lower&target=monitor')); await wait(800); await shot('5-output-lower', out);
    await out.loadURL(server.url('/output?style=full&target=projector')); await wait(800); await shot('6-output-full', out);
    const st = await (await fetch(server.url('/state'))).json();
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ live: st.state, ndi: ndi.status() }, null, 1));
  } catch (e) { fs.writeFileSync(path.join(dir, 'error.txt'), String(e.stack || e)); }
  app.quit();
}

app.on('before-quit', async () => { if (store) store.flush(); });
app.on('window-all-closed', async () => {
  if (store) store.flush();
  if (ndi) await ndi.stopAll();
  app.quit();
});
