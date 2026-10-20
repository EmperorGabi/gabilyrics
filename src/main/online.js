// Online lyrics lookup. Providers are pluggable; LRCLIB is free and needs no key.
const Lyrics = require('../shared/lyrics');

const cache = new Map(); // query → results (per session)
let inflight = null;

const providers = {
  lrclib: {
    name: 'LRCLIB',
    async search(q, signal) {
      const url = 'https://lrclib.net/api/search?q=' + encodeURIComponent(q);
      const res = await fetch(url, { signal, headers: { 'User-Agent': 'Gabilyrics/1.0 (lyrics presenter)' } });
      if (!res.ok) throw new Error('LRCLIB HTTP ' + res.status);
      const rows = await res.json();
      const seen = new Set();
      return rows
        .filter((r) => r && r.plainLyrics && !r.instrumental)
        .filter((r) => { const k = (r.trackName + '|' + r.artistName).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
        .slice(0, 12)
        .map((r) => ({
          provider: 'lrclib',
          remoteId: 'lrclib:' + r.id,
          title: r.trackName,
          author: r.artistName,
          album: r.albumName || '',
          slides: Lyrics.fromPlain(r.plainLyrics),
        }));
    },
  },
};

async function search(query, providerKey) {
  const q = String(query || '').trim();
  if (q.length < 2) return { query: q, results: [], ms: 0 };
  const key = (providerKey || 'lrclib') + '|' + q.toLowerCase();
  if (cache.has(key)) return { query: q, results: cache.get(key), ms: 0, cached: true };
  if (inflight) inflight.abort();
  const ctrl = new AbortController();
  inflight = ctrl;
  const timer = setTimeout(() => ctrl.abort(), 8000);
  const t0 = Date.now();
  try {
    const p = providers[providerKey] || providers.lrclib;
    const results = await p.search(q, ctrl.signal);
    cache.set(key, results);
    return { query: q, results, ms: Date.now() - t0, source: p.name };
  } catch (e) {
    if (e.name === 'AbortError') return { query: q, results: [], aborted: true };
    return { query: q, results: [], error: e.message || String(e) };
  } finally {
    clearTimeout(timer);
    if (inflight === ctrl) inflight = null;
  }
}

module.exports = { search, providers };
