// Sharing song libraries between Gabilyrics computers on the same local network.
//
// Discovery: every few seconds each running copy broadcasts a small UDP message on port 7381
// ("I'm here, my name is …, my library is at port …, revision …"). Copies that have sharing turned on
// serve their library at http://<ip>:<port>/api/library on the app's local web server. When a peer's
// revision changes we fetch its library again. Nothing leaves the local network.
const dgram = require('dgram');
const os = require('os');

const PORT = 7381;
const ANNOUNCE_MS = 4000;
const EXPIRE_MS = 13000;

let net = null;
try { net = require('electron').net; } catch (e) { /* tests */ }
const doFetch = (url, opts) => (net && net.fetch ? net.fetch(url, opts) : fetch(url, opts));

function broadcastAddresses() {
  const out = new Set(['255.255.255.255']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal || !a.netmask) continue;
      const ip = a.address.split('.').map(Number);
      const mask = a.netmask.split('.').map(Number);
      out.add(ip.map((b, i) => (b | (~mask[i] & 255))).join('.'));
    }
  }
  return [...out];
}

function localIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}

class Share {
  /**
   * @param getInfo () => ({ id, name, enabled, port, rev, count })
   * @param onChange (peers) => void   called whenever the list of peers or their songs changes
   */
  constructor(getInfo, onChange) {
    this.getInfo = getInfo;
    this.onChange = onChange;
    this.peers = new Map();
    this.sock = null;
    this.timers = [];
    this.error = null;
  }

  start() {
    if (this.sock) return;
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('error', (e) => { this.error = e.message; console.error('[share]', e.message); });
    sock.on('message', (buf, rinfo) => this.receive(buf, rinfo));
    sock.bind(PORT, () => { try { sock.setBroadcast(true); } catch (e) { /* ignore */ } this.announce(); });
    this.sock = sock;
    this.timers.push(setInterval(() => this.announce(), ANNOUNCE_MS));
    this.timers.push(setInterval(() => this.expire(), 2000));
  }

  stop() {
    this.announce(true);
    this.timers.forEach(clearInterval); this.timers = [];
    if (this.sock) { try { this.sock.close(); } catch (e) { /* ignore */ } }
    this.sock = null;
  }

  announce(bye) {
    if (!this.sock) return;
    const i = this.getInfo();
    const msg = Buffer.from(JSON.stringify({ app: 'gabilyrics', v: 1, id: i.id, name: i.name, port: i.port, sharing: !!i.enabled && !bye, rev: i.rev, count: i.count, bye: !!bye }));
    for (const addr of broadcastAddresses()) { try { this.sock.send(msg, PORT, addr); } catch (e) { /* ignore */ } }
  }

  receive(buf, rinfo) {
    let m; try { m = JSON.parse(buf.toString('utf8')); } catch (e) { return; }
    if (!m || m.app !== 'gabilyrics' || !m.id || m.id === this.getInfo().id) return;
    if (m.bye || !m.sharing) {
      if (this.peers.delete(m.id)) this.onChange(this.list());
      return;
    }
    const prev = this.peers.get(m.id);
    const peer = Object.assign(prev || { songs: [], loading: false, error: null }, {
      id: m.id, name: String(m.name || 'Gabilyrics').slice(0, 60), host: rinfo.address, port: Number(m.port) || 7380,
      count: Number(m.count) || 0, seen: Date.now(),
    });
    this.peers.set(m.id, peer);
    if (!prev || prev.rev !== m.rev || prev.error) { peer.rev = m.rev; this.fetchLibrary(peer); }
  }

  async fetchLibrary(peer) {
    if (peer.loading) return;
    peer.loading = true;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await doFetch('http://' + peer.host + ':' + peer.port + '/api/library', { signal: ctrl.signal });
      if (!res.ok) throw new Error(res.status === 403 ? 'sharing is turned off on that computer' : 'HTTP ' + res.status);
      const data = await res.json();
      peer.songs = (data.songs || []).filter((s) => s && s.title && Array.isArray(s.slides)).map((s) => ({
        id: String(s.id), title: String(s.title), author: String(s.author || ''), copyright: String(s.copyright || ''),
        slides: s.slides.map((sl) => ({ label: String(sl.label || ''), text: String(sl.text || '') })), updatedAt: s.updatedAt || 0,
      }));
      peer.error = null;
    } catch (e) {
      peer.error = e.name === 'AbortError' ? 'no answer (firewall?)' : (e.message || String(e));
    } finally {
      clearTimeout(t);
      peer.loading = false;
      if (this.peers.has(peer.id)) this.onChange(this.list());
    }
  }

  expire() {
    const now = Date.now();
    let changed = false;
    for (const [id, p] of this.peers) if (now - p.seen > EXPIRE_MS) { this.peers.delete(id); changed = true; }
    if (changed) this.onChange(this.list());
  }

  list() {
    return [...this.peers.values()].sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ id: p.id, name: p.name, host: p.host, count: p.count, error: p.error, songs: p.songs }));
  }
}

module.exports = { Share, localIps, broadcastAddresses, PORT };
