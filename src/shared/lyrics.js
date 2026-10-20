/* Lyrics parsing helpers — shared by main process, renderer and tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Lyrics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const LABEL_RE = /^(verse|chorus|refrain|pre-?chorus|bridge|tag|intro|outro|ending|coda|interlude|vamp)(\s*\d+)?\s*:?$/i;
  const BRACKET_RE = /^\[(.+)\]$/;

  function cleanLines(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((l) => l.replace(/\s+$/g, ''));
  }

  function titleCase(s) {
    return s.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /**
   * Turn editor text into slides. Blocks are separated by blank lines.
   * A block may start with a label line: "[Chorus]", "Chorus", "Verse 2:" …
   */
  function parse(text) {
    const lines = cleanLines(text);
    const blocks = [];
    let cur = [];
    for (const l of lines) {
      if (l.trim() === '') { if (cur.length) { blocks.push(cur); cur = []; } }
      else cur.push(l.trim());
    }
    if (cur.length) blocks.push(cur);

    const slides = [];
    let verse = 0;
    for (const b of blocks) {
      let label = null;
      const first = b[0];
      const br = first.match(BRACKET_RE);
      if (br) label = br[1].trim();
      else if (LABEL_RE.test(first)) label = titleCase(first.replace(/:$/, '').trim());
      const body = label ? b.slice(1) : b;
      if (!body.length) continue;
      if (!label) { verse += 1; label = 'Verse ' + verse; }
      else if (/^verse/i.test(label)) { const n = parseInt(label.replace(/\D/g, ''), 10); verse = isNaN(n) ? verse + 1 : n; }
      slides.push({ label, text: body.join('\n') });
    }
    return slides;
  }

  /** Inverse of parse(): slides → editor text. */
  function serialize(slides) {
    return (slides || []).map((s) => '[' + s.label + ']\n' + s.text).join('\n\n');
  }

  /**
   * Plain lyrics from the internet: no labels. Detect a repeated stanza and call it Chorus.
   */
  function fromPlain(text) {
    const slides = parse(text).map((s) => ({ label: null, text: s.text }));
    const counts = {};
    slides.forEach((s) => { const k = s.text.toLowerCase(); counts[k] = (counts[k] || 0) + 1; });
    let verse = 0;
    slides.forEach((s) => {
      if (counts[s.text.toLowerCase()] > 1) s.label = 'Chorus';
      else { verse += 1; s.label = 'Verse ' + verse; }
    });
    return slides;
  }

  /** Split a slide into pages of n lines (n <= 0 → one page). */
  function pages(text, n) {
    const lines = String(text || '').split('\n');
    if (!n || n <= 0 || lines.length <= n) return [lines.join('\n')];
    const out = [];
    for (let i = 0; i < lines.length; i += n) out.push(lines.slice(i, i + n).join('\n'));
    return out;
  }

  /**
   * Split slides into "cards" — exactly what one screen will show.
   * n = lines per screen (0 = whole slide). orphan = 'own' | 'merge' (fold a lone last line into the card before).
   * Every card knows its slide and its line range, both within the slide and across the whole song (g).
   */
  function cards(slides, n, orphan) {
    const out = [];
    let g = 0;
    (slides || []).forEach((sl, si) => {
      const lines = String(sl.text || '').split('\n');
      const chunks = [];
      if (!n || n <= 0 || lines.length <= n) chunks.push([0, lines.length]);
      else {
        for (let i = 0; i < lines.length; i += n) chunks.push([i, Math.min(lines.length, i + n)]);
        const last = chunks[chunks.length - 1];
        if (orphan === 'merge' && n > 1 && chunks.length > 1 && last[1] - last[0] === 1) { chunks.pop(); chunks[chunks.length - 1][1] = last[1]; }
      }
      chunks.forEach(([a, b], ci) => {
        out.push({ slide: si, label: sl.label, start: a, end: b, g: g + a, gEnd: g + b, part: ci + 1, parts: chunks.length, lines: lines.slice(a, b), text: lines.slice(a, b).join('\n') });
      });
      g += lines.length;
    });
    return out;
  }

  /** Where each slide starts in song-wide line numbers. */
  function slideStarts(slides) {
    const out = []; let g = 0;
    (slides || []).forEach((sl) => { out.push(g); g += String(sl.text || '').split('\n').length; });
    out.push(g);
    return out;
  }

  return { parse, serialize, fromPlain, pages, cards, slideStarts };
});
