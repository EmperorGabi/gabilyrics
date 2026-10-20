/* Gabilyrics operator console */
(async function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const vc = window.vc;

  // ---------------- theme ----------------
  function applyTheme(t) {
    const light = t === 'light';
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    const b = document.getElementById('themeBtn');
    if (b) { b.setAttribute('aria-label', light ? 'Switch to dark mode' : 'Switch to light mode'); b.title = (light ? 'Dark' : 'Light') + ' mode (T)'; }
    try { localStorage.setItem('gl-theme', light ? 'light' : 'dark'); } catch (e) { /* ignore */ }
  }
  try { applyTheme(localStorage.getItem('gl-theme') || 'dark'); } catch (e) { applyTheme('dark'); }

  // ---------------- state ----------------
  const S = {
    songs: [], plans: null, plan: null, settings: null, info: null,
    index: new SongSearch.Index(),
    query: '', local: [], localMs: 0,
    online: { state: 'idle', query: '', results: [], ms: 0, error: null }, forceOnline: false,
    temp: {},              // online songs being previewed (not saved yet)
    selectedId: null, tab: 'plan',
    live: { songId: null, line: 0 }, mode: 'lower', blank: true,
    kb: -1,
    colsChoice: (() => { try { return Number(localStorage.getItem('gl-cols')) || 0; } catch (e) { return 0; } })(),   // 0 = auto
    groupVerses: (() => { try { return localStorage.getItem('gl-group') === '1'; } catch (e) { return false; } })(),                // keyboard-highlighted search result
  };

  const getSong = (id) => S.songs.find((s) => s.id === id) || S.temp[id] || null;
  const reindex = () => { S.index.build(S.songs); };

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 2200);
  }

  // ---------------- boot ----------------
  [S.songs, S.plans, S.settings, S.info] = await Promise.all([vc.library.all(), vc.plans.get(), vc.settings.get(), vc.info()]);
  S.plan = S.plans.plans.find((p) => p.id === S.plans.current) || S.plans.plans[0];
  reindex();
  S.selectedId = S.plan.items.find((id) => getSong(id)) || (S.songs[0] && S.songs[0].id) || null;
  applyTheme(S.settings.theme || 'dark');
  async function toggleTheme() {
    const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(t);
    S.settings = await vc.settings.set({ theme: t });
  }
  $('#themeBtn').onclick = toggleTheme;
  setMonitors();
  vc.onStatus((info) => { const portChanged = S.info && info.port !== S.info.port; S.info = info; renderStatus(); if (portChanged) setMonitors(); });

  function setMonitors() {
    const base = S.info.serverUrl;
    $('#monProgram').src = base + '/output?style=follow&target=monitor';
    $('#monPreview').src = base + '/output?style=follow&target=monitor&feed=next';
    $('#setLower').src = base + '/output?style=lower&target=monitor&sample=1';
    $('#setFull').src = base + '/output?style=full&target=monitor&sample=1';
  }

  // ---------------- live / screens ----------------
  // A "card" is exactly one screen of the current output style (e.g. 2 lines for a lower third).
  // The live position is a song-wide line number, so switching style — or outputs that use
  // different styles at the same time — never loses your place.
  function linesPer(mode) { return mode === 'lower' ? (Number(S.settings.lower.linesPerPage) || 0) : 0; }
  function cardsOf(song, mode) { return song ? Lyrics.cards(song.slides, linesPer(mode || S.mode), S.settings.lower.orphan || 'own') : []; }
  function cardAt(cards, g) { return cards.find((c) => g >= c.g && g < c.gEnd) || null; }
  function allLines(song) { return song.slides.reduce((a, sl) => a.concat(String(sl.text || '').split('\n')), []); }

  // What one output style shows at line g: a whole card, or (after Shift+click) a window starting mid-card.
  function screenAt(song, g, mode) {
    mode = mode || S.mode;
    const cards = cardsOf(song, mode);
    const card = cardAt(cards, g) || cards[0];
    if (!card) return null;
    if (mode !== 'lower' || g <= card.g) return { card, cards, g: card.g, gEnd: card.gEnd, custom: false };
    const n = linesPer('lower') || (card.gEnd - card.g);
    const slideEnd = Lyrics.slideStarts(song.slides)[card.slide + 1];
    return { card, cards, g, gEnd: Math.min(g + n, slideEnd), custom: true };
  }
  function screenText(song, sc) { return allLines(song).slice(sc.g, sc.gEnd).join('\n'); }
  function cardLabel(c) { return c.label + (c.parts > 1 ? ' · ' + c.part + '/' + c.parts : ''); }

  function nextG(song, g) {
    const sc = screenAt(song, g); if (!sc) return null;
    const c = cardAt(sc.cards, sc.gEnd);   // after a mid-card start this snaps back onto the grid
    return c ? c.g : null;
  }
  function prevG(song, g) {
    const sc = screenAt(song, g); if (!sc) return null;
    if (sc.custom) return sc.card.g;
    const i = sc.cards.indexOf(sc.card);
    return i > 0 ? sc.cards[i - 1].g : null;
  }

  function pushLive() {
    const song = getSong(S.live.songId);
    const payload = { mode: S.mode, blank: S.blank, song: null, label: '', text: '', page: '', lower: '', first: false, next: null };
    const sc = song && song.slides.length ? screenAt(song, S.live.line) : null;
    if (sc) {
      const lowSc = screenAt(song, S.live.line, 'lower');
      Object.assign(payload, {
        song: { id: song.id, title: song.title, author: song.author || '', copyright: song.copyright || '' },
        label: cardLabel(sc.card), text: song.slides[sc.card.slide].text,
        page: screenText(song, sc), lower: screenText(song, lowSc), first: sc.g === 0, line: S.live.line,
      });
      const ng = nextG(song, S.live.line);
      if (ng != null) {
        const nc = cardAt(sc.cards, ng);
        payload.next = { label: cardLabel(nc), text: song.slides[nc.slide].text, page: nc.text, lower: screenText(song, screenAt(song, ng, 'lower')), first: false };
      }
    } else {
      // nothing live yet: preview shows the selected song's first screen
      const sel = getSong(S.selectedId);
      const c = cardsOf(sel)[0];
      if (c) payload.next = { label: cardLabel(c), text: sel.slides[c.slide].text, page: c.text, lower: cardsOf(sel, 'lower')[0].text, first: true };
    }
    vc.live.set(payload);
    renderLiveBits(payload, sc);
  }

  async function goLive(songId, line) {
    let song = getSong(songId);
    if (!song) return;
    if (song.source === 'online-temp' && S.settings.search.cacheOnline) song = await saveOnline(song, true);
    S.live = { songId: song.id, line: line || 0 };
    S.blank = false;
    pushLive(); renderSlides(); renderList();
  }

  function step(dir) {
    if (!S.live.songId) { const sel = getSong(S.selectedId); if (sel && sel.slides.length) goLive(sel.id, 0); return; }
    const song = getSong(S.live.songId);
    const g = song ? (dir > 0 ? nextG(song, S.live.line) : prevG(song, S.live.line)) : null;
    if (g == null) { toast(dir > 0 ? 'End of song' : 'Start of song'); return; }
    S.live.line = g; S.blank = false; pushLive(); renderSlides();
  }

  function setMode(m) {
    if (S.mode === m) return;
    S.mode = m;   // live line is kept: lower → full shows the verse containing it, full → lower its 2-line screen
    $('#modeLower').setAttribute('aria-pressed', m === 'lower');
    $('#modeFull').setAttribute('aria-pressed', m === 'full');
    $('#railLower').setAttribute('aria-pressed', m === 'lower');
    $('#railFull').setAttribute('aria-pressed', m === 'full');
    pushLive(); renderSlides();
  }

  function toggleBlank() { S.blank = !S.blank; pushLive(); }

  // ---------------- search ----------------
  let onlineTimer = null;
  function runSearch(q) {
    S.query = q; S.kb = -1;
    const t0 = performance.now();
    S.local = S.index.search(q, 40);
    S.localMs = performance.now() - t0;
    clearTimeout(onlineTimer);
    const qq = q.trim();
    if (qq.length >= 2 && (S.forceOnline || (S.local.length === 0 && S.settings.search.autoOnline))) {
      if (S.online.query !== qq || S.online.state === 'error') {
        S.online = { state: 'loading', query: qq, results: [], ms: 0, error: null };
        onlineTimer = setTimeout(() => fetchOnline(qq), 280);
      }
    } else if (S.online.query !== qq) {
      S.online = { state: 'idle', query: '', results: [], ms: 0, error: null };
    }
    renderResults();
  }

  const notSaved = (rows) => { const saved = new Set(S.songs.map((s) => s.remoteId).filter(Boolean)); return (rows || []).filter((x) => !saved.has(x.remoteId)); };
  // results stream in as each lyrics site answers
  vc.online.onProgress((p) => {
    if (p.query !== S.query.trim() || S.online.query !== p.query || S.online.state !== 'loading') return;
    S.online.results = notSaved(p.results); S.online.ms = p.ms; S.online.pending = p.pending; S.online.done = p.done;
    renderResults();
  });
  async function fetchOnline(q) {
    const r = await vc.online.search(q);
    if (r.aborted || q !== S.query.trim()) return;
    S.online = { state: r.error ? 'error' : 'done', query: q, results: notSaved(r.results), ms: r.ms || 0, error: r.error || null, done: r.sources || [], errors: r.errors || [], cached: !!r.cached };
    renderResults();
  }

  function onlineToTemp(r) {
    const id = 'tmp:' + r.remoteId;
    S.temp[id] = { id, title: r.title, author: r.author, copyright: r.copyright || '', source: 'online-temp', remoteId: r.remoteId, slides: r.slides };
    return S.temp[id];
  }

  async function saveOnline(song, quiet) {
    const toSave = { title: song.title, author: song.author, copyright: song.copyright || '', source: 'online', remoteId: song.remoteId, slides: song.slides };
    const saved = await vc.library.save(toSave);
    S.songs.push(saved); reindex();
    delete S.temp[song.id];
    if (S.selectedId === song.id) S.selectedId = saved.id;
    if (S.live.songId === song.id) S.live.songId = saved.id;
    if (!S.plan.items.includes(saved.id)) { S.plan.items.push(saved.id); savePlans(); }
    S.online.results = S.online.results.filter((x) => x.remoteId !== song.remoteId);
    if (!quiet) toast('Saved “' + saved.title + '” to your library');
    renderAll();
    return saved;
  }

  function hl(line, q) { const h = SongSearch.highlight(line, q); return esc(h.pre) + (h.hit ? '<mark>' + esc(h.hit) + '</mark>' : '') + esc(h.post); }

  function renderResults() {
    const box = $('#results');
    const q = S.query.trim();
    if (!q) { box.hidden = true; $('#searchStatus').textContent = 'Searches your library first, then the web'; return; }
    box.hidden = false;
    const showOnline = S.online.query === q && S.online.state !== 'idle';
    const status = S.local.length
      ? 'Found in your library' + (showOnline ? '' : ' — online search skipped')
      : (S.settings.search.autoOnline ? 'Not in your library → searching online' : 'Not in your library');
    $('#searchStatus').textContent = status;

    let h = '<div class="res-head"><span class="eyebrow"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/></svg>Local library</span>'
      + '<span class="ms">' + S.local.length + (S.local.length === 1 ? ' match' : ' matches') + ' · ' + Math.max(0.1, S.localMs).toFixed(1) + ' ms</span></div>';
    let n = 0;
    S.local.slice(0, 12).forEach((r) => {
      const s = r.song;
      const title = r.kind === 'title' ? hl(s.title, q) : esc(s.title);
      const kind = r.kind === 'title' ? 'Title match' : r.kind === 'author' ? 'Author' : 'Lyrics · ' + esc(r.label || '');
      h += '<button type="button" class="res' + (s.id === S.selectedId ? ' sel' : '') + (n === S.kb ? ' kb' : '') + '" data-pick="' + esc(s.id) + '" data-n="' + n + '"><span class="body"><span class="t">' + title + '</span>'
        + (r.line ? '<span class="l">“' + hl(r.line, q) + '”</span>' : '')
        + '<span class="m"><span class="k">' + kind + '</span><span>' + esc(s.author || '') + '</span></span></span></button>';
      n++;
    });
    if (!S.local.length) h += '<div class="note">No match in your library.</div>';

    if (!showOnline && S.local.length) {
      h += '<button type="button" class="btn ghost" id="alsoOnline"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"/></svg>Also search online</button>';
    }
    if (showOnline) {
      const o = S.online;
      h += '<div class="res-head"><span class="eyebrow"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"/></svg>Online</span><span class="ms">'
        + (o.state === 'loading' ? (o.results.length ? o.results.length + ' so far · ' : '') + '<span class="spinner"></span>' : o.state === 'error' ? 'offline' : o.results.length + ' results' + (o.cached ? ' · cached' : o.ms ? ' · ' + o.ms + ' ms' : '')) + '</span></div>';
      if (o.state === 'error') h += '<div class="note">Couldn’t get lyrics online — ' + esc(o.error) + '. <button type="button" class="btn small" id="retryOnline">Try again</button></div>';
      else if (o.state === 'done' && !o.results.length) h += '<div class="note">Nothing found online either. ' + (S.settings.search.geniusToken ? 'Try the song title or artist.' : 'Try the song title — or add a free Genius token in Settings to find songs from any line of the lyrics.') + '</div>';
      o.results.forEach((r) => {
        const first = r.slides[0] ? r.slides[0].text.split('\n')[0] : '';
        const lines = r.slides.map((x) => x.text).join('\n').split('\n');
        const words = SongSearch.norm(q).split(' ')[0];
        const hit = lines.find((l) => SongSearch.norm(l).includes(SongSearch.norm(q))) || lines.find((l) => SongSearch.norm(l).includes(words)) || first;
        h += '<div class="res" data-online="' + esc(r.remoteId) + '" data-n="' + n + '" role="button" tabindex="0"><span class="body"><span class="t">' + hl(r.title, q) + '</span>'
          + '<span class="l">“' + hl(hit, q) + '”</span><span class="m"><span>' + esc(r.author) + '</span><span>' + r.slides.length + ' slides</span><span class="k">' + esc(r.source || '') + '</span></span></span>'
          + '<button type="button" class="btn primary small" data-save="' + esc(r.remoteId) + '" aria-label="Save to library">+ Save</button></div>';
        n++;
      });
    }
    box.innerHTML = h;
  }

  $('#results').addEventListener('click', (e) => {
    const save = e.target.closest('[data-save]');
    if (save) { e.stopPropagation(); const r = S.online.results.find((x) => x.remoteId === save.dataset.save); if (r) saveOnline(onlineToTemp(r)); return; }
    if (e.target.closest('#alsoOnline')) { S.forceOnline = true; runSearch(S.query); return; }
    if (e.target.closest('#retryOnline')) { S.online = { state: 'idle', query: '', results: [], ms: 0, error: null }; S.forceOnline = true; runSearch(S.query); return; }
    const pick = e.target.closest('[data-pick]');
    if (pick) { select(pick.dataset.pick); return; }
    const on = e.target.closest('[data-online]');
    if (on) { const r = S.online.results.find((x) => x.remoteId === on.dataset.online); if (r) select(onlineToTemp(r).id); }
  });

  function resultEls() { return $$('#results [data-n]'); }
  $('#q').addEventListener('input', (e) => { S.forceOnline = false; runSearch(e.target.value); });
  $('#q').addEventListener('keydown', (e) => {
    const els = resultEls();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!els.length) return;
      S.kb = (S.kb + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length;
      els.forEach((el, i) => el.classList.toggle('kb', i === S.kb));
      els[S.kb].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const el = els[Math.max(0, S.kb)]; if (el) el.click();
    } else if (e.key === 'Escape') {
      e.target.value = ''; runSearch(''); e.target.blur();
    }
  });

  function select(id) { S.selectedId = id; renderSlides(); renderList(); renderResults(); if (!S.live.songId) pushLive(); }

  // ---------------- plan / library list ----------------
  function renderList() {
    const list = $('#list');
    $('#tabPlan').setAttribute('aria-selected', S.tab === 'plan');
    $('#tabLib').setAttribute('aria-selected', S.tab === 'library');
    $('#tabLib').textContent = 'Library (' + S.songs.length + ')';
    const songs = S.tab === 'plan'
      ? S.plan.items.map(getSong).filter(Boolean)
      : S.songs.slice().sort((a, b) => a.title.localeCompare(b.title));
    if (!songs.length) { list.innerHTML = '<div class="note">' + (S.tab === 'plan' ? 'Your plan is empty. Select a song and press “Add to plan”.' : 'No songs yet.') + '</div>'; return; }
    list.innerHTML = songs.map((s, i) => '<div class="item' + (s.id === S.selectedId ? ' sel' : '') + '" role="button" tabindex="0" data-pick="' + esc(s.id) + '"'
      + (S.tab === 'plan' ? ' draggable="true" data-i="' + i + '"' : '') + '>'
      + '<span class="n">' + String(i + 1).padStart(2, '0') + '</span>'
      + '<span class="b"><span class="t">' + esc(s.title) + '</span><span class="m">' + s.slides.length + ' slides · ' + esc(s.author || (s.source === 'online' ? 'Saved from online' : 'Local')) + '</span></span>'
      + (s.id === S.live.songId && !S.blank ? '<span class="livetag">LIVE</span>' : '')
      + (S.tab === 'plan' ? '<button type="button" class="x" data-remove="' + i + '" aria-label="Remove from plan">✕</button>' : '')
      + '</div>').join('');
  }
  $('#list').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) { e.stopPropagation(); S.plan.items.splice(Number(rm.dataset.remove), 1); savePlans(); renderList(); return; }
    const p = e.target.closest('[data-pick]'); if (p) select(p.dataset.pick);
  });
  $('#list').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const p = e.target.closest('[data-pick]'); if (p) select(p.dataset.pick); } });
  let dragFrom = null;
  $('#list').addEventListener('dragstart', (e) => { const it = e.target.closest('[data-i]'); if (it) { dragFrom = Number(it.dataset.i); e.dataTransfer.effectAllowed = 'move'; } });
  $('#list').addEventListener('dragover', (e) => { const it = e.target.closest('[data-i]'); if (it && dragFrom !== null) { e.preventDefault(); $$('.item.drag-over').forEach((x) => x.classList.remove('drag-over')); it.classList.add('drag-over'); } });
  $('#list').addEventListener('drop', (e) => {
    const it = e.target.closest('[data-i]'); if (!it || dragFrom === null) return;
    e.preventDefault();
    const to = Number(it.dataset.i); const [m] = S.plan.items.splice(dragFrom, 1); S.plan.items.splice(to, 0, m);
    dragFrom = null; savePlans(); renderList();
  });
  $('#list').addEventListener('dragend', () => { dragFrom = null; $$('.item.drag-over').forEach((x) => x.classList.remove('drag-over')); });
  $('#tabPlan').onclick = () => { S.tab = 'plan'; renderList(); };
  $('#tabLib').onclick = () => { S.tab = 'library'; renderList(); };

  // ---------------- slides (cards = screens) ----------------
  function renderSlides() {
    const song = getSong(S.selectedId);
    const grid = $('#slides');
    $('#saveOnline').hidden = !(song && song.source === 'online-temp');
    $('#editSong').hidden = !song || song.source === 'online-temp';
    $('#addToPlan').hidden = !song || song.source === 'online-temp' || S.plan.items.includes(song.id);
    if (!song) { $('#selTitle').textContent = 'No song selected'; $('#selMeta').textContent = 'Search or pick a song from the plan'; grid.innerHTML = ''; return; }
    $('#selTitle').textContent = song.title;
    const src = song.source === 'online-temp' ? 'Online — preview, not saved yet' : song.source === 'online' ? 'Saved from online' : 'Local';
    const cards = cardsOf(song);
    const split = cards.length !== song.slides.length;
    $('#selMeta').textContent = [song.author, song.slides.length + ' slides' + (split ? ' → ' + cards.length + ' screens of ' + linesPer('lower') + ' lines' : ''), src].filter(Boolean).join(' · ');
    if (!song.slides.length) { grid.innerHTML = '<div class="empty">This song has no lyrics yet. Press “Edit lyrics”.</div>'; return; }
    const isLiveSong = song.id === S.live.songId;
    const sc = isLiveSong ? screenAt(song, S.live.line) : null;
    const ng = isLiveSong ? nextG(song, S.live.line) : null;
    const lowerMode = S.mode === 'lower' && linesPer('lower') > 0;
    const grouped = lowerMode && S.groupVerses;
    $('#groupBtn').hidden = !lowerMode;
    $('#groupBtn').setAttribute('aria-pressed', grouped);
    const cardHtml = (c, i) => {
      const live = !!sc && sc.card.g === c.g;
      const next = !live && ng != null && c.g === ng;
      const body = c.lines.map((ln, k) => {
        const g = c.g + k;
        const on = !!sc && sc.custom && g >= sc.g && g < sc.gEnd;
        return '<span class="ln' + (on ? ' on' : '') + '" data-g="' + g + '">' + (esc(ln) || '&nbsp;') + '</span>';
      }).join('');
      return '<button type="button" class="slide' + (lowerMode ? ' mini' : '') + (lowerMode && c.part === 1 && !grouped ? ' vstart' : '') + (live ? ' live' : '') + (next ? ' next' : '') + '" data-card="' + i + '" data-g="' + c.g + '">'
        + '<span class="h"><span class="lab">' + (i + 1) + ' · ' + esc(cardLabel(c)) + '</span>'
        + (live ? '<span class="livetag">' + (sc.custom ? 'LIVE · FROM LINE ' + (sc.g - c.g + 1) : 'LIVE') + '</span>' : next ? '<span class="nexttag">NEXT</span>' : '') + '</span>'
        + '<span class="tx">' + body + '</span></button>';
    };
    let h = '';
    if (grouped) {
      // Verse groups pack side by side on one shared column grid (CSS subgrid), so every card keeps
      // the same width and short verses sit next to each other instead of stretching.
      const groups = [];
      cards.forEach((c, i) => { if (c.part === 1) groups.push([]); groups[groups.length - 1].push([c, i]); });
      const cols = S.colsChoice || bestCols(groups.map((g) => g.length), S.cols);
      h = '<div class="sgrid packed" style="grid-template-columns: repeat(' + cols + ', minmax(0, 1fr))">' + groups.map((g) => {
        const c0 = g[0][0];
        return '<div class="vgroup" style="grid-column: span ' + Math.min(g.length, cols) + '">'
          + '<div class="sect"><span>' + esc(c0.label) + '</span><span class="muted">' + (c0.parts > 1 ? c0.parts + ' screens' : '1 screen') + '</span></div>'
          + g.map(([c, i]) => cardHtml(c, i)).join('') + '</div>';
      }).join('') + '</div>';
    } else {
      // one continuous grid: screens flow across the full width, verse starts are marked on the card
      const fixed = S.colsChoice ? ' style="grid-template-columns: repeat(' + S.colsChoice + ', minmax(0, 1fr))"' : '';
      h = '<div class="sgrid flow"' + fixed + '>' + cards.map(cardHtml).join('') + '</div>';
    }
    grid.innerHTML = h;
  }
  // Pick the column count for grouped verses: as many as fit, but fewer (wider cards) when that
  // packs the verses with fewer rows or fewer empty cells — e.g. 2-screen verses in 3 columns
  // would leave a hole in every row, so use 2 wider columns instead.
  function bestCols(sizes, maxCols) {
    const minCols = Math.max(1, Math.ceil(maxCols / 2));
    let best = null;
    for (let c = maxCols; c >= minCols; c--) {
      let rows = 0, rowH = 0, used = 0;
      sizes.forEach((n) => {
        const span = Math.min(n, c), h = Math.ceil(n / c);
        if (used + span > c) { rows += rowH; used = 0; rowH = 0; }
        used += span; rowH = Math.max(rowH, h);
      });
      rows += rowH;
      const total = sizes.reduce((a, b) => a + b, 0);
      const waste = rows * c - total;
      if (!best || rows < best.rows || (rows === best.rows && waste < best.waste)) best = { c, rows, waste };
    }
    return best ? best.c : maxCols;
  }

  // how many card columns fit — grouped verses must never span more than this
  S.cols = 1;
  const CARD_MIN = 240, GAP = 12;
  new ResizeObserver(() => {
    const w = $('#slides').clientWidth;
    const cols = Math.max(1, Math.floor((w + GAP) / (CARD_MIN + GAP)));
    if (cols !== S.cols) { S.cols = cols; if (S.groupVerses) renderSlides(); }
  }).observe($('#slides'));
  $('#colsSelect').value = String(S.colsChoice);
  UISelect.enhance(document);
  $('#colsSelect').addEventListener('change', (e) => {
    S.colsChoice = Number(e.target.value) || 0; e.target.blur();
    try { localStorage.setItem('gl-cols', String(S.colsChoice)); } catch (err) { /* ignore */ }
    renderSlides();
  });
  $('#groupBtn').onclick = () => {
    S.groupVerses = !S.groupVerses;
    try { localStorage.setItem('gl-group', S.groupVerses ? '1' : '0'); } catch (e) { /* ignore */ }
    renderSlides();
  };
  $('#slides').addEventListener('click', (e) => {
    const b = e.target.closest('[data-card]'); if (!b) return;
    const ln = e.target.closest('.ln');
    // Shift+click a line: start the screen at exactly that line (for a singer who restarts mid-pair)
    const g = e.shiftKey && ln && S.mode === 'lower' ? Number(ln.dataset.g) : Number(b.dataset.g);
    goLive(S.selectedId, g);
  });

  function renderLiveBits(p, sc) {
    $('#liveCaption').textContent = p.song ? (p.blank ? 'Cleared · ' : '') + p.song.title + ' · ' + p.label : 'Nothing live';
    $('#nextCaption').textContent = p.next ? p.next.label : (p.song ? 'End of song' : '—');
    $('#blankBtn').setAttribute('aria-pressed', S.blank && !!p.song);
    const rl = $('#railLive'); const onAir = !!p.song && !p.blank;
    rl.classList.toggle('on', onAir); rl.title = onAir ? 'Live: ' + p.song.title + ' · ' + p.label : 'Nothing live';
    if (sc) {
      const i = sc.cards.indexOf(sc.card);
      $('#livePos').textContent = 'Screen ' + (i + 1) + ' of ' + sc.cards.length + (sc.custom ? ' · from line ' + (sc.g - sc.card.g + 1) : '');
    } else $('#livePos').textContent = '';
  }

  // ---------------- status / outputs ----------------
  function renderStatus() {
    const i = S.info; if (!i) return;
    const o = S.settings.outputs;
    const ndiOut = (k) => (i.ndi.outputs || []).find((x) => x.key === k);
    const ndiDot = (k) => { if (!o[k].enabled) return 'off'; if (!i.ndi.available) return 'warn'; const x = ndiOut(k); return x && x.running ? 'ok' : 'warn'; };
    const ndiText = (k) => { if (!o[k].enabled) return 'Off'; if (!i.ndi.available) return i.ndi.error ? 'NDI unavailable' : 'Starting…'; const x = ndiOut(k); if (!x) return 'Starting…'; if (x.error) return x.error; return x.connections + ' receiver' + (x.connections === 1 ? '' : 's') + ' · ' + o[k].width + '×' + o[k].height + ' ' + o[k].fps + 'fps'; };
    const styleName = { follow: 'follows style', lower: 'lower third', full: 'full screen' };
    $('#statusPills').innerHTML =
      '<span class="pill"><i class="dot ' + ndiDot('ndiProgram') + '"></i>NDI · Program</span>'
      + '<span class="pill"><i class="dot ' + ndiDot('ndiKey') + '"></i>NDI · Lower-third key</span>'
      + '<span class="pill"><i class="dot ' + (o.projector.enabled ? (i.projector ? 'ok' : 'warn') : 'off') + '"></i>Projector</span>';
    $('#outList').innerHTML = [
      ['ndiProgram', 'NDI · ' + o.ndiProgram.name, ndiText('ndiProgram') + ' · ' + styleName[o.ndiProgram.style]],
      ['ndiKey', 'NDI · ' + o.ndiKey.name, ndiText('ndiKey') + ' · alpha'],
    ].map(([k, t, m]) => '<div class="out"><i class="dot ' + ndiDot(k) + '"></i><span class="b"><span class="t">' + esc(t) + '</span><span class="m">' + esc(m) + '</span></span></div>').join('')
      + '<div class="out"><i class="dot ' + (o.projector.enabled ? (i.projector ? 'ok' : 'warn') : 'off') + '"></i><span class="b"><span class="t">Projector</span><span class="m">' + (o.projector.enabled ? (i.projector ? 'On · ' + styleName[o.projector.style] : 'No screen found') : 'Off — turn on in settings') + '</span></span></div>'
      + '<div class="out"><i class="dot ok"></i><span class="b"><span class="t">Browser source</span><span class="m">' + esc(i.serverUrl) + '/output</span></span></div>';
    $('#footLeft').textContent = S.songs.length + ' songs in your library · indexed for title + lyrics search';
    // settings page bits
    $$('[data-ndi]').forEach((el) => { const k = el.dataset.ndi; el.innerHTML = '<i class="dot ' + ndiDot(k) + '"></i>' + esc(ndiText(k)); });
    const help = $('#ndiHelp');
    help.hidden = i.ndi.available;
    if (!i.ndi.available) help.innerHTML = '<b>NDI could not start.</b> ' + esc(i.ndi.error || 'The NDI module is missing.') + ' — run <code>npm install</code> in the project folder and restart the app. The browser source for OBS/vMix works without NDI.';
    $('#browserUrls').innerHTML = ['lower', 'full', 'follow'].map((st) => {
      const u = i.serverUrl + '/output?style=' + st;
      return '<div class="url"><code>' + esc(u) + '</code><button type="button" class="btn small" data-copy="' + esc(u) + '">Copy</button></div>';
    }).join('') + (i.lanUrls || []).map((b) => '<div class="url"><code>' + esc(b) + '/output?style=lower</code><button type="button" class="btn small" data-copy="' + esc(b) + '/output?style=lower">Copy</button></div>').join('');
    $('#dataDir').textContent = i.dataDir;
    const ds = $('#displaySelect');
    const want = String(o.projector.displayId || '');
    ds.innerHTML = '<option value="">Auto (second screen)</option>' + i.displays.map((d) => '<option value="' + d.id + '"' + (String(d.id) === want ? ' selected' : '') + '>' + esc(d.label) + '</option>').join('');
  }
  $('#browserUrls').addEventListener('click', (e) => { const b = e.target.closest('[data-copy]'); if (b) { navigator.clipboard.writeText(b.dataset.copy); toast('Copied'); } });

  // ---------------- song editor ----------------
  let editingId = null;
  function openEditor(song) {
    editingId = song ? song.id : null;
    $('#edTitleH').textContent = song ? 'Edit song' : 'New song';
    $('#edTitle').value = song ? song.title : '';
    $('#edAuthor').value = song ? song.author || '' : '';
    $('#edCopy').value = song ? song.copyright || '' : '';
    $('#edLyrics').value = song ? Lyrics.serialize(song.slides) : '[Verse 1]\n\n\n[Chorus]\n';
    $('#edDelete').hidden = !song;
    $('#editor').showModal();
    $('#edTitle').focus();
  }
  $('#edForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('#edTitle').value.trim(); if (!title) return;
    const prev = editingId ? getSong(editingId) : null;
    const song = Object.assign({}, prev || { source: 'local' }, { id: editingId || undefined, title, author: $('#edAuthor').value.trim(), copyright: $('#edCopy').value.trim(), slides: Lyrics.parse($('#edLyrics').value) });
    const saved = await vc.library.save(song);
    const i = S.songs.findIndex((s) => s.id === saved.id);
    if (i >= 0) S.songs[i] = saved; else S.songs.push(saved);
    reindex();
    S.selectedId = saved.id;
    if (!editingId && !S.plan.items.includes(saved.id)) { S.plan.items.push(saved.id); savePlans(); }
    $('#editor').close();
    toast('Saved “' + saved.title + '”');
    if (S.live.songId === saved.id) pushLive();
    renderAll();
  });
  $('#edCancel').onclick = () => $('#editor').close();
  $('#edDelete').onclick = async () => {
    if (!editingId) return;
    const s = getSong(editingId);
    if (!confirm('Delete “' + s.title + '” from your library?')) return;
    await vc.library.remove(editingId);
    S.songs = S.songs.filter((x) => x.id !== editingId);
    S.plan.items = S.plan.items.filter((x) => x !== editingId);
    if (S.live.songId === editingId) { S.live = { songId: null, line: 0 }; S.blank = true; }
    reindex(); S.selectedId = S.plan.items[0] || (S.songs[0] && S.songs[0].id) || null;
    $('#editor').close(); pushLive(); renderAll();
  };

  $('#newSong').onclick = () => openEditor(null);
  $('#editSong').onclick = () => { const s = getSong(S.selectedId); if (s) openEditor(s); };
  $('#addToPlan').onclick = () => { if (S.selectedId && !S.plan.items.includes(S.selectedId)) { S.plan.items.push(S.selectedId); savePlans(); toast('Added to plan'); renderList(); renderSlides(); } };
  $('#saveOnline').onclick = () => { const s = getSong(S.selectedId); if (s && s.source === 'online-temp') saveOnline(s); };
  async function doImport() {
    const r = await vc.library.importFiles();
    if (r.added) { S.songs = await vc.library.all(); reindex(); renderAll(); toast('Imported ' + r.added + ' song' + (r.added === 1 ? '' : 's')); }
  }
  $('#importBtn').onclick = doImport;
  $('#importBtn2').onclick = doImport;
  $('#exportBtn').onclick = async () => { const p = await vc.library.exportAll(); if (p) toast('Exported to ' + p); };
  $('#openData').onclick = () => vc.openData();
  $('#geniusLink').onclick = (e) => { e.preventDefault(); vc.openUrl('https://genius.com/api-clients'); };

  // ---------------- transport buttons ----------------
  $('#nextBtn').onclick = () => step(1);
  $('#prevBtn').onclick = () => step(-1);
  $('#blankBtn').onclick = toggleBlank;
  $('#modeLower').onclick = () => setMode('lower');
  $('#modeFull').onclick = () => setMode('full');

  // ---------------- settings view ----------------
  const getK = (obj, k) => k.split('.').reduce((o, p) => (o == null ? o : o[p]), obj);
  function fillSettings() {
    $$('[data-k]').forEach((el) => {
      const k = el.dataset.k;
      if (el.hasAttribute('data-res')) { const base = k.replace(/\.res$/, ''); const c = getK(S.settings, base); el.value = c.width + 'x' + c.height; return; }
      const v = getK(S.settings, k);
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v == null ? '' : String(v);
    });
    UISelect.refresh();
    $('#bgName').textContent = S.settings.full.bgImage ? S.settings.full.bgImage.split(/[\\/]/).pop() : 'None';
  }
  function setPath(obj, k, v) { const ps = k.split('.'); let o = obj; ps.slice(0, -1).forEach((p) => { o[p] = o[p] || {}; o = o[p]; }); o[ps[ps.length - 1]] = v; }
  async function applySetting(el) {
    const k = el.dataset.k;
    const partial = {};
    if (el.hasAttribute('data-res')) { const [w, h] = el.value.split('x').map(Number); const base = k.replace(/\.res$/, ''); setPath(partial, base + '.width', w); setPath(partial, base + '.height', h); }
    else {
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (el.hasAttribute('data-num')) v = v === '' ? null : Number(v);
      setPath(partial, k, v);
    }
    S.settings = await vc.settings.set(partial);
    if (/^lower\.(linesPerPage|orphan)/.test(k)) { pushLive(); renderSlides(); }
    renderStatus();
  }
  $('#settingsView').addEventListener('change', (e) => { if (e.target.dataset && e.target.dataset.k) applySetting(e.target); });
  $('#settingsView').addEventListener('input', (e) => { if (e.target.type === 'range' && e.target.dataset.k) { clearTimeout(applySetting._t); applySetting._t = setTimeout(() => applySetting(e.target), 120); } });
  $('#pickBg').onclick = async () => { const f = await vc.pickImage(); if (f) { S.settings = await vc.settings.set({ full: { bgImage: f } }); fillSettings(); } };
  $('#clearBg').onclick = async () => { S.settings = await vc.settings.set({ full: { bgImage: '' } }); fillSettings(); };

  let inSettings = false;
  $('#toggleView').onclick = () => {
    inSettings = !inSettings;
    $('#consoleView').hidden = inSettings; $('#settingsView').hidden = !inSettings;
    $('#toggleView span').textContent = inSettings ? 'Back to console' : 'Settings';
    $('#toggleView').title = inSettings ? 'Back to console' : 'Settings';
    $('#toggleView .ic-settings').style.display = inSettings ? 'none' : '';
    $('#toggleView .ic-back').style.display = inSettings ? '' : 'none';
    if (inSettings) { fillSettings(); renderStatus(); }
  };

  // ---------------- service plans (switcher) ----------------
  function savePlans() { S.plan.updatedAt = Date.now(); S.plans.current = S.plan.id; vc.plans.set(S.plans); }
  function renderPlanBtn() {
    $('#planBtnName').textContent = S.plan.name;
    $('#tabPlan').textContent = S.plan.name;
    $('#tabPlan').title = 'Songs in “' + S.plan.name + '”';
  }
  function switchPlan(id) {
    const p = S.plans.plans.find((x) => x.id === id); if (!p) return;
    S.plan = p; S.plans.current = id; vc.plans.set(S.plans);
    S.tab = 'plan';
    if (!S.live.songId) S.selectedId = p.items.find((x) => getSong(x)) || S.selectedId;
    renderPlanBtn(); renderList(); renderSlides(); if (!S.live.songId) pushLive();
    toast('Switched to “' + p.name + '”');
  }
  function uniqueName(base) {
    const names = new Set(S.plans.plans.map((p) => p.name.toLowerCase()));
    if (!names.has(base.toLowerCase())) return base;
    for (let i = 2; ; i++) { const n = base + ' ' + i; if (!names.has(n.toLowerCase())) return n; }
  }
  function newPlanId() { return 'plan-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // small name dialog (Electron has no window.prompt)
  function askName(title, value, okText) {
    return new Promise((resolve) => {
      const d = $('#nameDialog');
      $('#nameTitle').textContent = title;
      $('#nameOk').textContent = okText || 'Save';
      $('#nameInput').value = value || '';
      const done = (v) => { d.close(); $('#nameForm').onsubmit = null; $('#nameCancel').onclick = null; d.onclose = null; resolve(v); };
      $('#nameForm').onsubmit = (e) => { e.preventDefault(); const v = $('#nameInput').value.trim(); if (v) done(v); };
      $('#nameCancel').onclick = () => done(null);
      d.onclose = () => resolve(null);
      d.showModal(); $('#nameInput').select();
    });
  }

  const planActions = {
    async new() { const n = await askName('New service plan', uniqueName('Untitled plan'), 'Create'); if (!n) return; const p = { id: newPlanId(), name: n, items: [], updatedAt: Date.now() }; S.plans.plans.push(p); switchPlan(p.id); },
    async duplicate() { const n = await askName('Duplicate plan', uniqueName(S.plan.name + ' copy'), 'Duplicate'); if (!n) return; const p = { id: newPlanId(), name: n, items: S.plan.items.slice(), updatedAt: Date.now() }; S.plans.plans.push(p); switchPlan(p.id); },
    async rename() { const n = await askName('Rename plan', S.plan.name, 'Rename'); if (!n) return; S.plan.name = n; savePlans(); renderPlanBtn(); },
    async remove() {
      if (S.plans.plans.length < 2) { toast('You need at least one plan'); return; }
      if (!confirm('Delete the plan “' + S.plan.name + '”? Songs stay in your library.')) return;
      const i = S.plans.plans.indexOf(S.plan);
      S.plans.plans.splice(i, 1);
      switchPlan(S.plans.plans[Math.max(0, i - 1)].id);
    },
  };

  // dropdown menu, styled like the selects
  let planMenu = null;
  function closePlanMenu() {
    if (!planMenu) return;
    const m = planMenu; planMenu = null;
    document.removeEventListener('mousedown', m.onDown, true);
    document.removeEventListener('keydown', m.onKey, true);
    window.removeEventListener('resize', closePlanMenu);
    $('#planBtn').setAttribute('aria-expanded', 'false');
    m.el.classList.remove('open'); setTimeout(() => m.el.remove(), 120);
  }
  function openPlanMenu(viaKey) {
    if (planMenu) { closePlanMenu(); return; }
    const btn = $('#planBtn');
    const el = document.createElement('div');
    el.className = 'ui-select-content plan-menu'; el.setAttribute('role', 'menu'); el.id = 'planMenu';
    const sorted = S.plans.plans.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    let html = '<div class="menu-label">Service plans</div>';
    html += sorted.map((p) => '<div class="ui-select-item" role="menuitemradio" aria-checked="' + (p.id === S.plan.id) + '" data-plan="' + esc(p.id) + '">'
      + '<span class="ui-select-label plan-name">' + esc(p.name) + '</span><span class="menu-meta">' + p.items.length + (p.items.length === 1 ? ' song' : ' songs') + '</span>'
      + '<span class="ui-check">' + (p.id === S.plan.id ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>' : '') + '</span></div>').join('');
    const ic = (d) => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
    html += '<div class="menu-sep" role="separator"></div>'
      + '<div class="ui-select-item menu-action" role="menuitem" data-act="new">' + ic('<path d="M12 5v14M5 12h14"/>') + 'New plan</div>'
      + '<div class="ui-select-item menu-action" role="menuitem" data-act="duplicate">' + ic('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>') + 'Duplicate “' + esc(S.plan.name) + '”</div>'
      + '<div class="ui-select-item menu-action" role="menuitem" data-act="rename">' + ic('<path d="M12 20h9"/><path d="M16.4 3.6a2 2 0 0 1 3 3L7 19l-4 1 1-4z"/>') + 'Rename</div>'
      + '<div class="ui-select-item menu-action danger" role="menuitem" data-act="remove">' + ic('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>') + 'Delete plan</div>';
    el.innerHTML = html;
    document.body.appendChild(el);
    const r = btn.getBoundingClientRect();
    el.style.top = (r.bottom + 4) + 'px'; el.style.left = r.left + 'px'; el.style.minWidth = Math.max(260, r.width) + 'px';
    el.style.maxHeight = Math.max(160, innerHeight - r.bottom - 16) + 'px';
    btn.setAttribute('aria-expanded', 'true');
    const items = Array.from(el.querySelectorAll('.ui-select-item'));
    let active = Math.max(0, items.findIndex((x) => x.dataset.plan === S.plan.id));
    const hl = () => items.forEach((x, i) => x.classList.toggle('active', i === active));
    if (viaKey) hl();
    const pick = (it) => { closePlanMenu(); if (it.dataset.plan) { if (it.dataset.plan !== S.plan.id) switchPlan(it.dataset.plan); } else planActions[it.dataset.act](); };
    el.addEventListener('mousemove', (e) => { const it = e.target.closest('.ui-select-item'); if (it) { active = items.indexOf(it); hl(); } });
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', (e) => { const it = e.target.closest('.ui-select-item'); if (it) pick(it); });
    const m = { el };
    m.onDown = (e) => { if (!el.contains(e.target) && !btn.contains(e.target)) closePlanMenu(); };
    m.onKey = (e) => {
      const stop = () => { e.preventDefault(); e.stopPropagation(); };
      if (e.key === 'ArrowDown') { stop(); active = Math.min(items.length - 1, active + 1); hl(); }
      else if (e.key === 'ArrowUp') { stop(); active = Math.max(0, active - 1); hl(); }
      else if (e.key === 'Enter' || e.key === ' ') { stop(); pick(items[active]); }
      else if (e.key === 'Escape') { stop(); closePlanMenu(); btn.focus(); }
      else if (e.key === 'Tab') closePlanMenu();
      else stop();
    };
    document.addEventListener('mousedown', m.onDown, true);
    document.addEventListener('keydown', m.onKey, true);
    window.addEventListener('resize', closePlanMenu);
    planMenu = m;
    requestAnimationFrame(() => el.classList.add('open'));
  }
  $('#planBtn').addEventListener('click', () => openPlanMenu(false));
  $('#planBtn').addEventListener('keydown', (e) => { if (!planMenu && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); openPlanMenu(true); } });
  renderPlanBtn();

  // ---------------- collapsible panels ----------------
  const panels = (() => { try { return JSON.parse(localStorage.getItem('gl-panels')) || {}; } catch (e) { return {}; } })();
  function setPanel(side, collapsed) {
    panels[side] = collapsed;
    $(side === 'left' ? '#leftCol' : '#rightCol').classList.toggle('collapsed', collapsed);
    try { localStorage.setItem('gl-panels', JSON.stringify(panels)); } catch (e) { /* ignore */ }
  }
  ['left', 'right'].forEach((side) => setPanel(side, !!panels[side]));
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-collapse]'); if (c) { setPanel(c.dataset.collapse, true); return; }
    const x = e.target.closest('[data-expand]'); if (x) setPanel(x.dataset.expand, false);
  });
  function focusSearch() { if (panels.left) setPanel('left', false); $('#q').focus(); $('#q').select(); }
  $('#railSearch').onclick = focusSearch;
  $('#railPlan').onclick = () => { setPanel('left', false); S.tab = 'plan'; renderList(); };
  $('#railLower').onclick = () => setMode('lower');
  $('#railFull').onclick = () => setMode('full');

  // ---------------- keyboard ----------------
  document.addEventListener('keydown', (e) => {
    if ($('#editor').open) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'k'))) { e.preventDefault(); focusSearch(); return; }
    if (typing || inSettings || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'c' || e.key === 'C' || e.key === '.') toggleBlank();
    else if (e.key === 'Escape') { if (!S.blank) toggleBlank(); }
    else if (e.key === 'l' || e.key === 'L') setMode('lower');
    else if (e.key === 'f' || e.key === 'F') setMode('full');
    else if (e.key === 't' || e.key === 'T') toggleTheme();
    else if (e.key === '[') setPanel('left', !panels.left);
    else if (e.key === ']') setPanel('right', !panels.right);
    else if (/^[1-9]$/.test(e.key)) { const s = getSong(S.selectedId); const c = cardsOf(s)[Number(e.key) - 1]; if (c) goLive(s.id, c.g); }
  });

  function renderAll() { renderResults(); renderList(); renderSlides(); renderStatus(); }
  renderAll();
  pushLive();
})();
