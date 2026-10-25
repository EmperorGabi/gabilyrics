// Local web server: serves the output renderer and pushes live state to it over WebSockets.
// (WebSockets rather than Server-Sent Events: Chromium allows only 6 open SSE/HTTP connections per
// server, and the console monitors + NDI outputs alone use 6, which would leave the projector blank.)
// /events (SSE) is kept for older browser-source URLs.
// Used by the projector window, the NDI renderers, the console monitors and OBS/vMix browser sources.
const http = require('http');
const crypto = require('crypto');
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
    this.sockets = new Set();   // WebSocket clients
    this.server = null;
    this.port = null;
    this.host = null;
  }

  url(p) { return 'http://127.0.0.1:' + this.port + (p || ''); }

  start(port, lan) {
    return new Promise((resolve) => {
      const host = lan ? '0.0.0.0' : '127.0.0.1';
      const srv = http.createServer((req, res) => this.handle(req, res));
      srv.on('upgrade', (req, socket) => this.upgrade(req, socket));
      srv.on('error', (e) => {
        if (e.code === 'EADDRINUSE') { srv.close(); this.start(port + 1, lan).then(resolve); }
        else { console.error('[server]', e); resolve(null); }
      });
      srv.listen(port, host, () => {
        this.server = srv; this.port = port; this.host = host;
        clearInterval(this.pinger);
        this.pinger = setInterval(() => { const ping = wsFrame(0x9, Buffer.alloc(0)); for (const sock of this.sockets) { try { sock.write(ping); } catch (e) { this.sockets.delete(sock); } } }, 20000);
        resolve(port);
      });
    });
  }

  stop() {
    for (const c of this.clients) { try { c.end(); } catch (e) { /* ignore */ } }
    this.clients.clear();
    for (const sock of this.sockets) { try { sock.destroy(); } catch (e) { /* ignore */ } }
    this.sockets.clear();
    clearInterval(this.pinger);
    return new Promise((r) => (this.server ? this.server.close(() => r()) : r()));
  }

  payload() { return JSON.stringify({ state: this.getState(), settings: this.getSettings() }); }

  broadcast() {
    const json = this.payload();
    const msg = 'data: ' + json + '\n\n';
    for (const c of this.clients) { try { c.write(msg); } catch (e) { this.clients.delete(c); } }
    const frame = wsFrame(0x1, Buffer.from(json));
    for (const sock of this.sockets) { try { sock.write(frame); } catch (e) { this.sockets.delete(sock); } }
  }

  // Minimal WebSocket server (RFC 6455): server → client text messages, plus ping/close handling.
  upgrade(req, socket) {
    const u = new URL(req.url, 'http://x');
    const key = req.headers['sec-websocket-key'];
    if (u.pathname !== '/ws' || !key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    socket.setNoDelay(true);
    this.sockets.add(socket);
    socket.write(wsFrame(0x1, Buffer.from(this.payload())));
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 2) {
        const op = buf[0] & 0x0f;
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        const masked = (buf[1] & 0x80) !== 0;
        const total = off + (masked ? 4 : 0) + len;
        if (buf.length < total) return;
        let payload = buf.subarray(off + (masked ? 4 : 0), total);
        if (masked) { const m = buf.subarray(off, off + 4); payload = Buffer.from(payload.map((b, i) => b ^ m[i % 4])); }
        buf = buf.subarray(total);
        if (op === 0x8) { try { socket.end(wsFrame(0x8, Buffer.alloc(0))); } catch (e) { /* closed */ } this.sockets.delete(socket); return; }
        if (op === 0x9) { try { socket.write(wsFrame(0xA, payload)); } catch (e) { /* closed */ } }
      }
    });
    const drop = () => this.sockets.delete(socket);
    socket.on('close', drop);
    socket.on('error', drop);
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

function wsFrame(opcode, payload) {
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | opcode, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, payload]);
}

module.exports = { OutputServer };
