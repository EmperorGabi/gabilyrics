// Online lyrics lookup — only used when nothing matches in the local library.
// All enabled sources are asked at the same time; results stream back to the console as each
// source answers, so one slow or busy site never holds up the others.
//
//   LRCLIB      lrclib.net        free, no key — title / artist search
//   lyrics.ovh  api.lyrics.ovh    free, no key — title / artist search (via Deezer), lyrics per song
//   Hymnary     hymnary.org       free, no key — hymn titles, first lines AND full-text (lyric line) search;
//                                 full words only for public-domain hymns
//   Genius      api.genius.com    free token — finds songs from a LINE of the lyrics; Genius only
//                                 identifies the song, the words are then fetched from LRCLIB / lyrics.ovh
const Lyrics = require('../shared/lyrics');

let net = null;
try { net = require('electron').net; } catch (e) { /* running outside Electron (tests) */ }
// Electron's net.fetch uses Chromium's network stack, so system proxies and certificates work.
const doFetch = (url, opts) => (net && net.fetch ? net.fetch(url, opts) : fetch(url, opts));

const UA = 'Gabilyrics/1.0 (lyrics presenter)';
const cache = new Map(); // query → final results (per session)
let inflight = null;

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(abortErr()); }, { once: true });
});
const abortErr = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

const BACKOFF = [400, 1000];
// GET with retries for "busy" answers (429 / 5xx), which LRCLIB sends when overloaded.
async function get(url, signal, tries, opts) {
  const host = new URL(url).host;
  const n = tries || 3;
  let last = null;
  for (let i = 0; i < n; i++) {
    let res;
    try {
      res = await doFetch(url, { signal, headers: Object.assign({ 'User-Agent': UA }, opts && opts.headers) });
    } catch (e) {
      if (e.name === 'AbortError' || (signal && signal.aborted)) throw abortErr();
      last = new Error(host + ' unreachable');
      if (i < n - 1) await sleep(BACKOFF[i], signal);
      continue;
    }
    if (res.ok) return opts && opts.text ? res.text() : res.json();
    last = new Error(host + (res.status === 503 || res.status === 429 ? ' is busy' : res.status === 401 ? ' rejected the token' : ' HTTP ' + res.status));
    last.status = res.status;
    if (![429, 500, 502, 503, 504].includes(res.status)) break;
    if (i < n - 1) await sleep(BACKOFF[i], signal);
  }
  throw last;
}

function cleanLyrics(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/^Paroles de la chanson[^\n]*\n/i, '') // lyrics.ovh sometimes prefixes this line
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const keyOf = (title, author) => (String(title || '').replace(/\(.*?\)|\[.*?\]/g, '') + '|' + String(author || '').split(/[;,&]/)[0])
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9|]+/g, '');

function dedupe(rows) {
  const seen = new Set();
  return rows.filter((r) => { const k = keyOf(r.title, r.author); if (seen.has(k)) return false; seen.add(k); return true; });
}

// ---- small CSV + HTML helpers (Hymnary) ----
function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&rsquo;|&#8217;/g, '’').replace(/&lsquo;|&#8216;/g, '‘')
  .replace(/&ldquo;|&#8220;/g, '“').replace(/&rdquo;|&#8221;/g, '”').replace(/&mdash;|&#8212;/g, '—').replace(/&ndash;|&#8211;/g, '–').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

// Hymnary text page → slides. Stanzas are <p> blocks; the last block without line breaks is the source credit.
function hymnaryText(html) {
  const m = /<div property=["']text["']>([\s\S]*?)<\/div>\s*<\/div>/.exec(html) || /<div property=["']text["']>([\s\S]*?)<\/div>/.exec(html);
  if (!m) return [];
  const paras = m[1].split(/<\/p>/i).map((p) => p.replace(/<p[^>]*>/gi, '')).filter((p) => p.replace(/<[^>]*>/g, '').trim());
  if (paras.length && !/<br/i.test(paras[paras.length - 1])) paras.pop();
  const REPEAT = /\s*[\[(]?\s*refrain\s*[\])]?\.?$/i;      // "… soul. [Refrain]" = sing the refrain here
  const blocks = [];
  let verse = 0;
  paras.forEach((p) => {
    let lines = decode(p.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')).split('\n').map((l) => l.trim())
      .filter((l) => l && !/^\(.*\):?$/.test(l) && !/^source:/i.test(l));   // drop "(may be sung…)" notes and source credits
    if (!lines.length) return;
    let label = null;
    const ref = /^(refrain|chorus)\s*:?\s*/i.exec(lines[0]);
    if (ref) { label = 'Chorus'; lines[0] = lines[0].slice(ref[0].length).replace(/^\(.*?\):?\s*/, ''); if (!lines[0]) lines.shift(); }
    if (!lines.length) return;
    lines[0] = lines[0].replace(/^\d+\.?\s+/, '');
    let repeat = false;
    const last = lines[lines.length - 1];
    if (!label && REPEAT.test(last)) { repeat = true; lines[lines.length - 1] = last.replace(REPEAT, ''); if (!lines[lines.length - 1]) lines.pop(); }
    if (!label) { verse += 1; label = 'Verse ' + verse; }
    if (lines.length) blocks.push({ label, text: lines.join('\n'), repeat });
  });
  // put the refrain back after every verse that says to sing it
  const chorus = blocks.find((b) => b.label === 'Chorus');
  const slides = [];
  blocks.forEach((b, i) => {
    slides.push({ label: b.label, text: b.text });
    const next = blocks[i + 1];
    if (b.repeat && chorus && !(next && next.label === 'Chorus')) slides.push({ label: 'Chorus', text: chorus.text });
  });
  const totalLines = slides.reduce((n, sl) => n + sl.text.split('\n').length, 0);
  return totalLines >= 4 ? slides : [];   // skip one-line responses ("Amen.") that aren't songs
}

// Look up the words for a known title + artist (used after Genius has identified the song).
async function wordsFor(title, artist, signal) {
  try {
    const rows = await get('https://lrclib.net/api/search?track_name=' + encodeURIComponent(title) + '&artist_name=' + encodeURIComponent(artist), signal, 2);
    const hit = (rows || []).find((r) => r && r.plainLyrics && !r.instrumental);
    if (hit) return { text: cleanLyrics(hit.plainLyrics), via: 'LRCLIB' };
  } catch (e) { if (e.name === 'AbortError') throw e; }
  try {
    const r = await get('https://api.lyrics.ovh/v1/' + encodeURIComponent(artist) + '/' + encodeURIComponent(title), signal, 1);
    const text = cleanLyrics(r && r.lyrics);
    if (text) return { text, via: 'lyrics.ovh' };
  } catch (e) { if (e.name === 'AbortError') throw e; }
  return null;
}

const providers = {
  genius: {
    name: 'Genius',
    enabled: (o) => !!(o.sources && o.sources.genius !== false && o.geniusToken),
    async search(q, signal, o) {
      const data = await get('https://api.genius.com/search?q=' + encodeURIComponent(q), signal, 2, { headers: { Authorization: 'Bearer ' + o.geniusToken } });
      const hits = (data && data.response && data.response.hits || [])
        .filter((h) => h.type === 'song' && h.result)
        .map((h) => ({ id: h.result.id, title: h.result.title, author: h.result.primary_artist && h.result.primary_artist.name }))
        .filter((h) => h.title && h.author);
      const picks = dedupe(hits).slice(0, 4);
      const got = await Promise.all(picks.map(async (p) => {
        const w = await wordsFor(p.title, p.author, signal);
        if (!w) return null;
        return { provider: 'genius', source: 'Genius → ' + w.via, remoteId: 'genius:' + p.id, title: p.title, author: p.author, slides: Lyrics.fromPlain(w.text) };
      }));
      return got.filter((x) => x && x.slides.length);
    },
  },
  lrclib: {
    name: 'LRCLIB',
    enabled: (o) => !o.sources || o.sources.lrclib !== false,
    async search(q, signal) {
      const rows = await get('https://lrclib.net/api/search?q=' + encodeURIComponent(q), signal, 3);
      return dedupe((rows || [])
        .filter((r) => r && r.plainLyrics && !r.instrumental)
        .map((r) => ({ provider: 'lrclib', source: 'LRCLIB', remoteId: 'lrclib:' + r.id, title: r.trackName, author: r.artistName, slides: Lyrics.fromPlain(cleanLyrics(r.plainLyrics)) })))
        .slice(0, 10);
    },
  },
  hymnary: {
    name: 'Hymnary',
    enabled: (o) => !o.sources || o.sources.hymnary !== false,
    async search(q, signal) {
      const term = q.replace(/[:"]/g, ' ').replace(/\s+/g, ' ').trim();
      const url = (qu) => 'https://hymnary.org/search?qu=' + encodeURIComponent(qu) + '&export=csv';
      // titles & first lines, plus full-text so a line from a later verse also finds the hymn
      const [byTitle, byText] = await Promise.all([
        get(url(term + ' in:texts'), signal, 2, { text: true }).catch((e) => { if (e.name === 'AbortError') throw e; return ''; }),
        get(url('fullText:' + term + ' in:texts'), signal, 2, { text: true }).catch((e) => { if (e.name === 'AbortError') throw e; return ''; }),
      ]);
      if (!byTitle && !byText) throw new Error('hymnary.org unreachable');
      const rows = [];
      [byTitle, byText].forEach((csv) => {
        const r = parseCsv(String(csv || '')); r.shift();
        r.forEach((c) => { if (c.length >= 7 && c[4]) rows.push({ key: c[4], title: c[0] || c[2], author: c[6] || '', uses: Number(c[9]) || 0 }); });
      });
      const seen = new Set();
      const picks = rows.filter((r) => (seen.has(r.key) ? false : seen.add(r.key))).slice(0, 5);
      const got = await Promise.all(picks.map(async (p) => {
        try {
          const html = await get('https://hymnary.org/text/' + encodeURIComponent(p.key), signal, 1, { text: true });
          const slides = hymnaryText(html);
          if (!slides.length) return null; // still under copyright: Hymnary has no words for it
          return { provider: 'hymnary', source: 'Hymnary', remoteId: 'hymnary:' + p.key, title: p.title, author: p.author.split(';')[0].trim(), copyright: 'Public domain (Hymnary.org)', slides };
        } catch (e) { if (e.name === 'AbortError') throw e; return null; }
      }));
      return got.filter(Boolean);
    },
  },
  lyricsovh: {
    name: 'lyrics.ovh',
    enabled: (o) => !o.sources || o.sources.lyricsovh !== false,
    async search(q, signal) {
      const sug = await get('https://api.lyrics.ovh/suggest/' + encodeURIComponent(q), signal, 2);
      const picks = dedupe((sug && sug.data || []).map((d) => ({ title: d.title_short || d.title, author: d.artist && d.artist.name, id: d.id }))
        .filter((d) => d.title && d.author)).slice(0, 5);
      const got = await Promise.all(picks.map(async (p) => {
        try {
          const r = await get('https://api.lyrics.ovh/v1/' + encodeURIComponent(p.author) + '/' + encodeURIComponent(p.title), signal, 1);
          const text = cleanLyrics(r && r.lyrics);
          if (!text) return null;
          return { provider: 'lyricsovh', source: 'lyrics.ovh', remoteId: 'lyricsovh:' + p.id, title: p.title, author: p.author, slides: Lyrics.fromPlain(text) };
        } catch (e) { if (e.name === 'AbortError') throw e; return null; }
      }));
      return got.filter((x) => x && x.slides.length);
    },
  },
};

// Order results are listed in: lyric-line matches (Genius) first, then the title searches, hymns, fallback.
const ORDER = ['genius', 'lrclib', 'hymnary', 'lyricsovh'];

function clearCache() { cache.clear(); }

/**
 * @param query    what the operator typed
 * @param opts     settings.search ({ sources: {lrclib,lyricsovh,hymnary,genius}, geniusToken })
 * @param onProgress(partial) called each time a source answers: { query, results, done: [names], pending }
 */
async function search(query, opts, onProgress) {
  opts = opts || {};
  const q = String(query || '').trim();
  if (q.length < 2) return { query: q, results: [], ms: 0 };
  const active = ORDER.filter((k) => providers[k].enabled(opts));
  if (!active.length) return { query: q, results: [], error: 'all online sources are turned off in Settings' };
  const key = q.toLowerCase();
  if (cache.has(key)) return Object.assign({ query: q, ms: 0, cached: true }, cache.get(key));
  if (inflight) inflight.abort();
  const ctrl = new AbortController();
  inflight = ctrl;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, 15000);
  const t0 = Date.now();
  const byProvider = {};
  const errors = [];
  const done = [];
  const merged = () => dedupe(ORDER.reduce((all, k) => all.concat(byProvider[k] || []), []));
  try {
    await Promise.all(active.map((k) => providers[k].search(q, ctrl.signal, opts)
      .then((rows) => { byProvider[k] = rows; })
      .catch((e) => { if (e.name === 'AbortError' || ctrl.signal.aborted) return; errors.push(providers[k].name + ': ' + (e.message || e)); })
      .then(() => {
        if (ctrl.signal.aborted) return;
        done.push(providers[k].name);
        if (onProgress) onProgress({ query: q, results: merged(), done: done.slice(), pending: active.length - done.length, ms: Date.now() - t0 });
      })));
    if (ctrl.signal.aborted && !timedOut) return { query: q, results: [], aborted: true };
    const results = merged();
    const out = { results, sources: done.slice(), errors };
    if (results.length) cache.set(key, out);
    if (timedOut) return Object.assign({ query: q, ms: Date.now() - t0 }, out, results.length ? {} : { error: 'the lyrics sites took too long to answer' });
    if (!results.length && errors.length === active.length) return { query: q, results: [], error: errors.join(' · ') };
    return Object.assign({ query: q, ms: Date.now() - t0 }, out);
  } finally {
    clearTimeout(timer);
    if (inflight === ctrl) inflight = null;
  }
}

module.exports = { search, providers, cleanLyrics, hymnaryText, parseCsv, clearCache };
