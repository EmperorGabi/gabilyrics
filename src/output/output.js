// Output renderer. URL params:
//   style  = follow | lower | full      (follow = whatever the operator picked)
//   target = ndi | projector | monitor | browser
//   feed   = live | next                (next = the console's preview monitor)
(function () {
  const qs = new URLSearchParams(location.search);
  const STYLE = qs.get('style') || 'follow';
  const TARGET = qs.get('target') || 'browser';
  const FEED = qs.get('feed') || 'live';
  const SAMPLE = qs.get('sample') === '1';
  const SAMPLE_TEXT = 'Amazing grace! How sweet the sound\nThat saved a wretch like me!';

  const $ = (s) => document.querySelector(s);
  const body = document.body;
  const bg = $('#bg'), bgimg = $('#bgimg'), bgdim = $('#bgdim'), cam = $('#camlabel');
  const full = $('#full'), fullTxt = $('#full .txt'), credit = $('#credit');
  const lower = $('#lower'), lowerBox = $('#lower .box'), lowerTxt = $('#lower .txt'), tag = $('#lower .tag');

  let last = null;
  let shownKey = '';
  let swapTimer = null;

  function unit() {
    const u = Math.min(innerWidth / 1920, innerHeight / 1080);
    body.style.setProperty('--u', u + 'px');
    return u;
  }
  addEventListener('resize', () => { unit(); if (last) render(last, true); });

  function hexA(hex, pct) {
    const h = String(hex || '#000000').replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16) || 0;
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + (pct / 100) + ')';
  }

  // Shadow and outline. Outline is drawn behind the letters (paint-order) so it grows outward
  // and never thins the text; the stroke is doubled because half of it is hidden under the fill.
  function applyEffects(el, o, u) {
    const n = (v, d) => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? d : Number(v));
    el.style.textShadow = o.shadow
      ? (n(o.shadowX, 0) * u) + 'px ' + (n(o.shadowY, 2) * u) + 'px ' + (n(o.shadowBlur, 8) * u) + 'px ' + hexA(o.shadowColor || '#000000', n(o.shadowOpacity, 80))
      : 'none';
    const w = o.outline ? n(o.outlineWidth, 2) : 0;
    el.style.webkitTextStroke = w > 0 ? (w * 2 * u) + 'px ' + (o.outlineColor || '#000000') : '0';
    el.style.paintOrder = 'stroke fill';
  }

  function fit(el, startPx, minPx) {
    const u = unit();
    let size = startPx;
    el.style.fontSize = (size * u) + 'px';
    const box = el.parentElement;
    let guard = 40;
    while (guard-- > 0 && size > minPx && (el.scrollHeight > box.clientHeight || el.scrollWidth > box.clientWidth)) {
      size *= 0.93;
      el.style.fontSize = (size * u) + 'px';
    }
  }

  function render(payload, force) {
    last = payload;
    const st = payload.state || {};
    const s = payload.settings || {};
    const L = s.lower || {}, F = s.full || {};
    body.style.setProperty('--fade', (s.transition ?? 200) + 'ms');
    const u = unit();

    let src = FEED === 'next' ? (st.next || { text: '', page: '', label: '' }) : st;
    if (SAMPLE) src = { text: SAMPLE_TEXT + '\nI once was lost, but now am found;\nWas blind, but now I see.', page: SAMPLE_TEXT, first: true };
    const mode = STYLE === 'follow' ? (st.mode || 'lower') : STYLE;
    const blank = SAMPLE ? false : FEED === 'next' ? !src.text : !!st.blank;
    const isLower = mode === 'lower';

    // ----- background -----
    cam.style.display = 'none';
    bgimg.style.backgroundImage = '';
    bgdim.style.background = 'transparent';
    if (isLower) {
      if (TARGET === 'monitor') { bg.style.background = '#232833'; cam.style.display = 'block'; }
      else if (TARGET === 'projector') bg.style.background = '#000000';
      else bg.style.background = 'transparent'; // NDI alpha / OBS browser source
    } else {
      bg.style.background = F.bg || '#000000';
      if (F.bgImage) {
        bgimg.style.backgroundImage = 'url("/media/background?v=' + encodeURIComponent(F.bgImage) + '")';
        bgdim.style.background = 'rgba(0,0,0,' + ((F.bgDim ?? 40) / 100) + ')';
      }
    }

    // ----- styles -----
    applyEffects(fullTxt, F, u);
    applyEffects(lowerTxt, L, u);
    fullTxt.style.fontFamily = F.font; fullTxt.style.fontWeight = F.weight; fullTxt.style.color = F.color;
    lower.style.left = (L.side * u) + 'px'; lower.style.right = (L.side * u) + 'px'; lower.style.bottom = (L.bottom * u) + 'px';
    lowerBox.style.background = hexA(L.boxColor, L.boxOpacity ?? 82);
    lowerTxt.style.fontFamily = L.font; lowerTxt.style.fontWeight = L.weight; lowerTxt.style.color = L.color;
    lowerTxt.style.fontSize = (L.size * u) + 'px';
    lowerTxt.style.textTransform = L.uppercase ? 'uppercase' : 'none';
    tag.style.background = L.accent || '#F5A524';

    const text = isLower ? (src.lower || src.page || src.text || '') : (src.text || '');
    const song = SAMPLE ? { title: 'Amazing Grace', author: 'John Newton', copyright: 'Public domain' } : (st.song || {});
    const showTag = isLower && !blank && song.title && (L.showTitle === 'always' || (L.showTitle === 'first' && src.first));
    let creditText = '';
    if (!isLower && !blank && song.title && F.credit !== 'off') {
      creditText = song.title;
      if (F.credit === 'full') {
        const bits = [song.author, song.copyright, F.licence ? 'Licence #' + F.licence : ''].filter(Boolean);
        if (bits.length) creditText += ' — ' + bits.join(' · ');
      }
    }

    const key = [mode, blank, text, showTag, creditText].join('|');
    if (key === shownKey && !force) return;
    const changedText = key !== shownKey;
    shownKey = key;

    const apply = () => {
      fullTxt.textContent = isLower ? '' : text;
      lowerTxt.textContent = isLower ? text : '';
      tag.textContent = song.title || '';
      tag.classList.toggle('on', !!showTag);
      credit.textContent = creditText;
      if (!isLower) fit(fullTxt, F.size || 72, 24);
      full.classList.toggle('on', !isLower && !blank && !!text);
      lower.classList.toggle('on', isLower && !blank && !!text);
      credit.classList.toggle('on', !!creditText);
    };

    clearTimeout(swapTimer);
    const fade = s.transition ?? 200;
    const anyOn = full.classList.contains('on') || lower.classList.contains('on');
    if (changedText && anyOn && fade > 0 && !force) {
      full.classList.remove('on'); lower.classList.remove('on'); credit.classList.remove('on');
      swapTimer = setTimeout(apply, fade);
    } else apply();
  }

  // Live updates over a WebSocket; reconnects automatically if the app restarts.
  function connect() {
    let ws;
    try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'); }
    catch (e) { setTimeout(connect, 1000); return; }
    ws.onmessage = (e) => { try { render(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    ws.onclose = () => setTimeout(connect, 1000);
  }
  unit();
  connect();
})();
