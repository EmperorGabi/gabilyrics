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
    songs: [], plan: { name: 'Service plan', items: [] }, settings: null, info: null,
    index: new SongSearch.Index(),
    query: '', local: [], localMs: 0,
    online: { state: 'idle', query: '', results: [], ms: 0, error: null }, forceOnline: false,
    temp: {},              // online songs being previewed (not saved yet)
    selectedId: null, tab: 'plan',
    live: { songId: null, slide: 0, page: 0 }, mode: 'lower', blank: true,
    kb: -1,                // keyboard-highlighted search result
  };

  const getSong = (id) => S.songs.find((s) => s.id === id) || S.temp[id] || null;
  const reindex = () => { S.index.build(S.songs); };

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 2200);
  }

  // ---------------- boot ----------------
  [S.songs, S.plan, S.settings, S.info] = await Promise.all([vc.library.all(), vc.plan.get(), vc.settings.get(), vc.info()]);
  reindex();
  S.selectedId = S.plan.items.find((id) => getSong(id)) || (S.songs[0] && S.songs[0].id) || null;
  $('#planName').value = S.plan.name || 'Service plan';
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

  // ---------------- live / paging ----------------
  function pagesOf(slide, mode) {
    const n = mode === 'lower' ? Number(S.settings.lower.linesPerPage) : 0;
    return Lyrics.pages(slide.text, n);
  }

  function nextPos(pos) {
    const song = getSong(pos.songId); if (!song) return null;
    const sl = song.slides[pos.slide]; if (!sl) return null;
    const pages = pagesOf(sl, S.mode);
    if (pos.page < pages.length - 1) return { songId: pos.songId, slide: pos.slide, page: pos.page + 1 };
    if (pos.slide < song.slides.length - 1) return { songId: pos.songId, slide: pos.slide + 1, page: 0 };
    return null;
  }
  function prevPos(pos) {
    const song = getSong(pos.songId); if (!song) return null;
    if (pos.page > 0) return { songId: pos.songId, slide: pos.slide, page: pos.page - 1 };
    if (pos.slide > 0) { const p = pagesOf(song.slides[pos.slide - 1], S.mode); return { songId: pos.songId, slide: pos.slide - 1, page: p.length - 1 }; }
    return null;
  }

  function pushLive() {
    const pos = S.live;
    const song = getSong(pos.songId);
    const payload = { mode: S.mode, blank: S.blank, song: null, label: '', text: '', page: '', first: false, next: null };
    if (song && song.slides[pos.slide]) {
      const sl = song.slides[pos.slide];
      const pages = pagesOf(sl, S.mode);
      pos.page = Math.min(pos.page, pages.length - 1);
      Object.assign(payload, {
        song: { id: song.id, title: song.title, author: song.author || '', copyright: song.copyright || '' },
        label: sl.label, text: sl.text, page: pages[pos.page], first: pos.slide === 0 && pos.page === 0,
      });
      const np = nextPos(pos);
      if (np) { const ns = song.slides[np.slide]; payload.next = { label: ns.label, text: ns.text, page: pagesOf(ns, S.mode)[np.page], first: false }; }
    } else {
      // nothing live yet: preview shows the selected song's first slide
      const sel = getSong(S.selectedId);
      if (sel && sel.slides[0]) payload.next = { label: sel.slides[0].label, text: sel.slides[0].text, page: pagesOf(sel.slides[0], S.mode)[0], first: true };
    }
    vc.live.set(payload);
    renderLiveBits(payload);
  }

  async function goLive(songId, slide, page) {
    let song = getSong(songId);
    if (!song) return;
    if (song.source === 'online-temp' && S.settings.search.cacheOnline) song = await saveOnline(song, true);
    S.live = { songId: song.id, slide, page: page || 0 };
    S.blank = false;
    pushLive(); renderSlides(); renderList();
  }

  function step(dir) {
    if (!S.live.songId) { const sel = getSong(S.selectedId); if (sel && sel.slides.length) goLive(sel.id, 0, 0); return; }
    const p = dir > 0 ? nextPos(S.live) : prevPos(S.live);
    if (!p) { toast(dir > 0 ? 'End of song' : 'Start of song'); return; }
    S.live = p; S.blank = false; pushLive(); renderSlides();
  }

  function setMode(m) {
    if (S.mode === m) return;
    S.mode = m; S.live.page = 0;
    $('#modeLower').setAttribute('aria-pressed', m === 'lower');
    $('#modeFull').setAttribute('aria-pressed', m === 'full');
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

  async function fetchOnline(q) {
    const r = await vc.online.search(q);
    if (r.aborted || q !== S.query.trim()) return;
    const saved = new Set(S.songs.map((s) => s.remoteId).filter(Boolean));
    S.online = { state: r.error ? 'error' : 'done', query: q, results: (r.results || []).filter((x) => !saved.has(x.remoteId)), ms: r.ms || 0, error: r.error || null, source: r.source };
    renderResults();
  }

  function onlineToTemp(r) {
    const id = 'tmp:' + r.remoteId;
    S.temp[id] = { id, title: r.title, author: r.author, copyright: '', source: 'online-temp', remoteId: r.remoteId, slides: r.slides };
    return S.temp[id];
  }

  async function saveOnline(song, quiet) {
    const toSave = { title: song.title, author: song.author, copyright: song.copyright || '', source: 'online', remoteId: song.remoteId, slides: song.slides };
    const saved = await vc.library.save(toSave);
    S.songs.push(saved); reindex();
    delete S.temp[song.id];
    if (S.selectedId === song.id) S.selectedId = saved.id;
    if (S.live.songId === song.id) S.live.songId = saved.id;
    if (!S.plan.items.includes(saved.id)) { S.plan.items.push(saved.id); vc.plan.set(S.plan); }
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
        + (o.state === 'loading' ? '<span class="spinner"></span>' : o.state === 'error' ? 'offline' : o.results.length + ' results' + (o.ms ? ' · ' + o.ms + ' ms' : ' · cached')) + '</span></div>';
      if (o.state === 'error') h += '<div class="note">Couldn’t reach the online source (' + esc(o.error) + '). Check your internet connection.</div>';
      else if (o.state === 'done' && !o.results.length) h += '<div class="note">Nothing found online either. Try the song title or artist.</div>';
      o.results.forEach((r) => {
        const first = r.slides[0] ? r.slides[0].text.split('\n')[0] : '';
        const lines = r.slides.map((x) => x.text).join('\n').split('\n');
        const words = SongSearch.norm(q).split(' ')[0];
        const hit = lines.find((l) => SongSearch.norm(l).includes(SongSearch.norm(q))) || lines.find((l) => SongSearch.norm(l).includes(words)) || first;
        h += '<div class="res" data-online="' + esc(r.remoteId) + '" data-n="' + n + '" role="button" tabindex="0"><span class="body"><span class="t">' + hl(r.title, q) + '</span>'
          + '<span class="l">“' + hl(hit, q) + '”</span><span class="m"><span>' + esc(r.author) + '</span><span>' + r.slides.length + ' slides</span></span></span>'
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
    if (rm) { e.stopPropagation(); S.plan.items.splice(Number(rm.dataset.remove), 1); vc.plan.set(S.plan); renderList(); return; }
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
    dragFrom = null; vc.plan.set(S.plan); renderList();
  });
  $('#list').addEventListener('dragend', () => { dragFrom = null; $$('.item.drag-over').forEach((x) => x.classList.remove('drag-over')); });
  $('#tabPlan').onclick = () => { S.tab = 'plan'; renderList(); };
  $('#tabLib').onclick = () => { S.tab = 'library'; renderList(); };
  $('#planName').addEventListener('change', (e) => { S.plan.name = e.target.value; vc.plan.set(S.plan); });

  // ---------------- slides ----------------
  function renderSlides() {
    const song = getSong(S.selectedId);
    const grid = $('#slides');
    $('#saveOnline').hidden = !(song && song.source === 'online-temp');
    $('#editSong').hidden = !song || song.source === 'online-temp';
    $('#addToPlan').hidden = !song || song.source === 'online-temp' || S.plan.items.includes(song.id);
    if (!song) { $('#selTitle').textContent = 'No song selected'; $('#selMeta').textContent = 'Search or pick a song from the plan'; grid.innerHTML = ''; return; }
    $('#selTitle').textContent = song.title;
    const src = song.source === 'online-temp' ? 'Online — preview, not saved yet' : song.source === 'online' ? 'Saved from online' : 'Local';
    $('#selMeta').textContent = [song.author, song.slides.length + ' slides', src].filter(Boolean).join(' · ');
    if (!song.slides.length) { grid.innerHTML = '<div class="empty">This song has no lyrics yet. Press “Edit lyrics”.</div>'; return; }
    const isLiveSong = song.id === S.live.songId;
    const np = isLiveSong ? nextPos(S.live) : null;
    grid.innerHTML = song.slides.map((sl, i) => {
      const live = isLiveSong && i === S.live.slide;
      const next = np && np.slide === i && !live;
      const pages = pagesOf(sl, S.mode).length;
      return '<button type="button" class="slide' + (live ? ' live' : '') + (next ? ' next' : '') + '" data-slide="' + i + '">'
        + '<span class="h"><span class="lab">' + (i + 1) + ' · ' + esc(sl.label) + '</span>'
        + (live ? '<span class="livetag">LIVE</span>' : next ? '<span class="nexttag">NEXT</span>' : '') + '</span>'
        + '<span class="tx">' + esc(sl.text) + '</span>'
        + (pages > 1 ? '<span class="pg">' + (live ? 'Page ' + (S.live.page + 1) + ' of ' + pages : pages + ' lower-third pages') + '</span>' : '')
        + '</button>';
    }).join('');
  }
  $('#slides').addEventListener('click', (e) => { const b = e.target.closest('[data-slide]'); if (b) goLive(S.selectedId, Number(b.dataset.slide), 0); });

  function renderLiveBits(p) {
    $('#liveCaption').textContent = p.song ? (p.blank ? 'Cleared · ' : '') + p.song.title + ' · ' + p.label : 'Nothing live';
    $('#nextCaption').textContent = p.next ? p.next.label : (p.song ? 'End of song' : '—');
    $('#blankBtn').setAttribute('aria-pressed', S.blank && !!p.song);
    const song = getSong(S.live.songId);
    if (song && song.slides[S.live.slide]) {
      const pages = pagesOf(song.slides[S.live.slide], S.mode).length;
      $('#livePos').textContent = 'Slide ' + (S.live.slide + 1) + ' of ' + song.slides.length + (pages > 1 ? ' · page ' + (S.live.page + 1) + '/' + pages : '');
    } else $('#livePos').textContent = '';
  }

  // ---------------- status / outputs ----------------
  function renderStatus() {
    const i = S.info; if (!i) return;
    const o = S.settings.outputs;
    const ndiOut = (k) => (i.ndi.outputs || []).find((x) => x.key === k);
    const ndiDot = (k) => { if (!o[k].enabled) return 'off'; if (!i.ndi.available) return 'warn'; const x = ndiOut(k); return x && x.running ? 'ok' : 'warn'; };
    const ndiText = (k) => { if (!o[k].enabled) return 'Off'; if (!i.ndi.available) return 'NDI runtime not installed'; const x = ndiOut(k); if (!x) return 'Starting…'; if (x.error) return x.error; return x.connections + ' receiver' + (x.connections === 1 ? '' : 's') + ' · ' + o[k].width + '×' + o[k].height + ' ' + o[k].fps + 'fps'; };
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
    if (!i.ndi.available) help.innerHTML = '<b>NDI is not active.</b> Install the free NDI Tools / Runtime from ndi.video, then reinstall this app’s NDI module (see README → “Enable NDI”). Everything else, including the browser source for OBS/vMix, works without it.';
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
    if (!editingId && !S.plan.items.includes(saved.id)) { S.plan.items.push(saved.id); vc.plan.set(S.plan); }
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
    if (S.live.songId === editingId) { S.live = { songId: null, slide: 0, page: 0 }; S.blank = true; }
    reindex(); S.selectedId = S.plan.items[0] || (S.songs[0] && S.songs[0].id) || null;
    $('#editor').close(); pushLive(); renderAll();
  };

  $('#newSong').onclick = () => openEditor(null);
  $('#editSong').onclick = () => { const s = getSong(S.selectedId); if (s) openEditor(s); };
  $('#addToPlan').onclick = () => { if (S.selectedId && !S.plan.items.includes(S.selectedId)) { S.plan.items.push(S.selectedId); vc.plan.set(S.plan); toast('Added to plan'); renderList(); renderSlides(); } };
  $('#saveOnline').onclick = () => { const s = getSong(S.selectedId); if (s && s.source === 'online-temp') saveOnline(s); };
  async function doImport() {
    const r = await vc.library.importFiles();
    if (r.added) { S.songs = await vc.library.all(); reindex(); renderAll(); toast('Imported ' + r.added + ' song' + (r.added === 1 ? '' : 's')); }
  }
  $('#importBtn').onclick = doImport;
  $('#importBtn2').onclick = doImport;
  $('#exportBtn').onclick = async () => { const p = await vc.library.exportAll(); if (p) toast('Exported to ' + p); };
  $('#openData').onclick = () => vc.openData();

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
    if (/^lower\.linesPerPage/.test(k)) { pushLive(); renderSlides(); }
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
    $('#toggleView span').textContent = inSettings ? 'Back to console' : 'Outputs & settings';
    if (inSettings) { fillSettings(); renderStatus(); }
  };

  // ---------------- keyboard ----------------
  document.addEventListener('keydown', (e) => {
    if ($('#editor').open) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'k'))) { e.preventDefault(); $('#q').focus(); $('#q').select(); return; }
    if (typing || inSettings || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'c' || e.key === 'C' || e.key === '.') toggleBlank();
    else if (e.key === 'Escape') { if (!S.blank) toggleBlank(); }
    else if (e.key === 'l' || e.key === 'L') setMode('lower');
    else if (e.key === 'f' || e.key === 'F') setMode('full');
    else if (e.key === 't' || e.key === 'T') toggleTheme();
    else if (/^[1-9]$/.test(e.key)) { const s = getSong(S.selectedId); const i = Number(e.key) - 1; if (s && s.slides[i]) goLive(s.id, i, 0); }
  });

  function renderAll() { renderResults(); renderList(); renderSlides(); renderStatus(); }
  renderAll();
  pushLive();
})();
