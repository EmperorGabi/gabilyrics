/* Instant in-memory search over titles and lyrics — shared by renderer and tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SongSearch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function norm(s) {
    return String(s || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[’‘`]/g, "'")
      .replace(/[^a-z0-9'\s]/g, ' ')
      .replace(/'/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /** Locate the query (or its first word) inside an original-cased line for highlighting. */
  function highlight(line, query) {
    const words = norm(query).split(' ').filter(Boolean);
    const tries = [String(query).trim()].concat(words);
    for (const t of tries) {
      if (!t) continue;
      const re = new RegExp(escapeRe(t).replace(/\\?'/g, "['’]?"), 'i');
      const m = re.exec(line);
      if (m) return { pre: line.slice(0, m.index), hit: m[0], post: line.slice(m.index + m[0].length) };
    }
    return { pre: line, hit: '', post: '' };
  }

  class Index {
    constructor() { this.docs = []; }

    build(songs) {
      this.docs = songs.map((song) => {
        const lines = [];
        (song.slides || []).forEach((sl) => {
          String(sl.text || '').split('\n').forEach((l) => { if (l.trim()) lines.push({ text: l, n: norm(l), label: sl.label }); });
        });
        return {
          song,
          title: norm(song.title),
          author: norm(song.author),
          all: lines.map((l) => l.n).join(' \n '),
          lines,
        };
      });
      return this;
    }

    /** Returns [{ song, kind: 'title'|'lyrics', label, line, score }] best first. */
    search(query, limit) {
      const q = norm(query);
      if (!q) return [];
      const words = q.split(' ');
      const out = [];
      for (const d of this.docs) {
        let score = 0, kind = null, hitLine = null;
        if (d.title === q) { score = 120; kind = 'title'; }
        else if (d.title.startsWith(q)) { score = 110; kind = 'title'; }
        else if (d.title.includes(q)) { score = 100; kind = 'title'; }
        else if (words.length > 1 && words.every((w) => d.title.includes(w))) { score = 85; kind = 'title'; }
        else if (d.all.includes(q)) {
          score = 70; kind = 'lyrics';
          hitLine = d.lines.find((l) => l.n.includes(q)) || null;
          if (!hitLine) { // phrase spans two lines
            hitLine = d.lines.find((l) => l.n.includes(words[0])) || d.lines[0];
            score = 65;
          }
        } else if (words.length > 1 && words.every((w) => d.all.includes(w))) {
          score = 45; kind = 'lyrics';
          hitLine = d.lines.find((l) => words.every((w) => l.n.includes(w))) || d.lines.find((l) => l.n.includes(words[0]));
          if (hitLine && words.every((w) => hitLine.n.includes(w))) score = 55;
        } else if (d.author && d.author.includes(q)) { score = 30; kind = 'author'; }
        if (!kind) continue;
        out.push({
          song: d.song,
          kind,
          score,
          label: hitLine ? hitLine.label : null,
          line: hitLine ? hitLine.text : null,
        });
      }
      out.sort((a, b) => b.score - a.score || a.song.title.localeCompare(b.song.title));
      return limit ? out.slice(0, limit) : out;
    }
  }

  return { Index, norm, highlight };
});
