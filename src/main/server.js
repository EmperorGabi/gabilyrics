// Local web server: serves the output renderer and pushes live state over Server-Sent Events.
// Used by the projector window, the NDI renderers, the console monitors and OBS/vMix browser sources.
const http = require('http');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

class OutputServer {
  constructor(getState, getSettings) {
    this.getState = getState;
    this.getSettings = getSettings;
    this.clients = new Set();
    this.server = null;
    this.port = null;
    this.host = null;
  }

  url(p) { return 'http://127.0.0.1:' + this.port + (p || ''); }

  start(port, lan) {
    return new Promise((resolve) => {
      const host = lan ? '0.0.0.0' : '127.0.0.1';
      const srv = http.createServer((req, res) => this.handle(req, res));
      srv.on('error', (e) => {
        if (e.code === 'EADDRINUSE') { srv.close(); this.start(port + 1, lan).then(resolve); }
        else { console.error('[server]', e); resolve(null); }
      });
      srv.listen(port, host, () => { this.server = srv; this.port = port; this.host = host; resolve(port); });
    });
  }

  stop() {
    for (const c of this.clients) { try { c.end(); } catch (e) { /* ignore */ } }
    this.clients.clear();
    return new Promise((r) => (this.server ? this.server.close(() => r()) : r()));
  }

  payload() { return JSON.stringify({ state: this.getState(), settings: this.getSettings() }); }

  broadcast() {
    const msg = 'data: ' + this.payload() + '\n\n';
    for (const c of this.clients) { try { c.write(msg); } catch (e) { this.clients.delete(c); } }
  }

  handle(req, res) {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    if (p === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
      res.write('retry: 1000\n\n');
      res.write('data: ' + this.payload() + '\n\n');
      this.clients.add(res);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { /* closed */ } }, 15000);
      req.on('close', () => { clearInterval(ping); this.clients.delete(res); });
      return;
    }
    if (p === '/state') { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(this.payload()); return; }
    if (p === '/media/background') {
      const f = this.getSettings().full.bgImage;
      if (!f || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(f).pipe(res);
      return;
    }
    let file = p === '/' || p === '/output' ? 'output.html' : p.replace(/^\/+/, '');
    file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
    const full = path.join(OUTPUT_DIR, file);
    if (!full.startsWith(OUTPUT_DIR) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(full).pipe(res);
  }
}

module.exports = { OutputServer };
