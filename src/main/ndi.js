// NDI senders. Each output renders the output page in an off-screen (transparent) window
// and pushes its BGRA frames to the network with the NDI SDK (via @stagetimerio/grandiose).
// NDI is optional: if the native module is not installed the rest of the app works normally.
const { BrowserWindow } = require('electron');

let ndi = null;
let loadError = null;
try { ndi = require('@stagetimerio/grandiose'); } catch (e) { loadError = e.message; }

const FOURCC_BGRA = 1095911234; // 'BGRA'

// Chromium gives premultiplied alpha; NDI expects straight alpha.
function unpremultiply(buf) {
  for (let i = 0; i < buf.length; i += 4) {
    const a = buf[i + 3];
    if (a === 0 || a === 255) continue;
    const f = 255 / a;
    buf[i] = Math.min(255, buf[i] * f);
    buf[i + 1] = Math.min(255, buf[i + 1] * f);
    buf[i + 2] = Math.min(255, buf[i + 2] * f);
  }
  return buf;
}

class NdiOutput {
  constructor(key, cfg, url) {
    this.key = key; this.cfg = cfg; this.url = url;
    this.sender = null; this.win = null; this.timer = null;
    this.frame = null; this.busy = false; this.error = null;
  }

  async start() {
    if (!ndi) { this.error = 'NDI module not installed'; return; }
    const { name, width, height, fps } = this.cfg;
    try {
      this.sender = await ndi.send({ name, clockVideo: false, clockAudio: false });
    } catch (e) { this.error = 'NDI send failed: ' + e.message; return; }

    this.win = new BrowserWindow({
      show: false, width, height, frame: false, transparent: true, backgroundColor: '#00000000',
      useContentSize: true,
      webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true },
    });
    this.win.setContentSize(width, height);
    this.win.webContents.setFrameRate(fps);
    this.win.webContents.on('paint', (_e, _dirty, image) => {
      const size = image.getSize();
      this.frame = { w: size.width, h: size.height, data: unpremultiply(image.toBitmap()) };
    });
    this.win.loadURL(this.url);

    const interval = Math.max(10, Math.round(1000 / fps));
    this.timer = setInterval(() => this.push(), interval);
  }

  async push() {
    if (!this.sender || !this.frame || this.busy) return;
    this.busy = true;
    const f = this.frame;
    try {
      await this.sender.video({
        xres: f.w, yres: f.h, frameRateN: this.cfg.fps * 1000, frameRateD: 1000,
        fourCC: FOURCC_BGRA, pictureAspectRatio: f.w / f.h, frameFormatType: 1,
        lineStrideBytes: f.w * 4, data: f.data,
      });
    } catch (e) { this.error = e.message; }
    this.busy = false;
  }

  connections() { try { return this.sender ? this.sender.connections() : 0; } catch (e) { return 0; } }

  async stop() {
    clearInterval(this.timer); this.timer = null;
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    if (this.sender) { try { await this.sender.destroy(); } catch (e) { /* ignore */ } }
    this.sender = null;
  }

  status() {
    return { key: this.key, name: this.cfg.name, running: !!this.sender && !this.error, error: this.error, connections: this.connections() };
  }
}

class NdiManager {
  constructor(server) { this.server = server; this.outputs = {}; }

  available() { return !!ndi; }
  loadError() { return loadError; }

  async apply(outputsCfg) {
    for (const key of ['ndiProgram', 'ndiKey']) {
      const cfg = outputsCfg[key];
      const cur = this.outputs[key];
      const same = cur && JSON.stringify(cur.cfg) === JSON.stringify(cfg);
      if (cur && (!cfg.enabled || !same)) { await cur.stop(); delete this.outputs[key]; }
      if (cfg.enabled && !this.outputs[key]) {
        const url = this.server.url('/output?style=' + encodeURIComponent(cfg.style) + '&target=ndi');
        const o = new NdiOutput(key, Object.assign({}, cfg), url);
        this.outputs[key] = o;
        await o.start();
      }
    }
  }

  async stopAll() { for (const k of Object.keys(this.outputs)) { await this.outputs[k].stop(); } this.outputs = {}; }

  status() {
    return {
      available: !!ndi,
      error: loadError,
      outputs: Object.values(this.outputs).map((o) => o.status()),
    };
  }
}

module.exports = { NdiManager };
