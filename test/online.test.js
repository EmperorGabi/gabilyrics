// Online search with a fake network: no real requests are made.
const assert = require('assert');
const calls = [];
const ok = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => o });
const fail = (status) => ({ ok: false, status, json: async () => ({}), text: async () => '' });

const HYMN_CSV = 'displayTitle,firstLine,textTitle,refrainFirstLine,textAuthNumber,languages,authors,meter,textSources,totalInstances\n'
  + '"Amazing grace! (how sweet the sound)","Amazing grace! (how sweet the sound) That saved a wretch like me","Amazing grace! (how sweet the sound)",,amazing_grace_how_sweet_the_sound,English,"John Newton",8.6.8.6,,1812\n'
  + '"Amazing Grace (My Chains Are Gone)","Amazing grace! how sweet the sound","Amazing Grace (My Chains Are Gone)","My chains are gone",amazing_grace_giglio,English,"John Newton; Chris Tomlin",Irregular,,17\n';
const HYMN_HTML = '<html><div property="text"><div class="authority_columns"><p>1 Amazing grace (how sweet the sound)<br>\nthat saved a wretch like me!<br>\n</p><p>Refrain:<br>\nPraise God, &amp; praise Him<br>\n</p><p>2 &#39;Twas grace that taught<br>\nmy heart to fear<br>\n</p><p>Ancient &amp; Modern, 2013</p></div></div></html>';

global.fetch = async (url, opts) => {
  calls.push(url);
  if (url.startsWith('https://lrclib.net/api/search?q=')) return fail(503);                    // LRCLIB busy
  if (url.startsWith('https://lrclib.net/api/search?track_name=')) {
    if (url.includes('Way%20Maker')) return ok([{ id: 9, trackName: 'Way Maker', artistName: 'Sinach', plainLyrics: 'You are here\nMoving in our midst\n\nWay maker\nMiracle worker' }]);
    return ok([]);
  }
  if (url.startsWith('https://api.genius.com/search')) {
    assert.strictEqual(opts.headers.Authorization, 'Bearer TEST-TOKEN');
    return ok({ response: { hits: [{ type: 'song', result: { id: 77, title: 'Way Maker', primary_artist: { name: 'Sinach' } } }] } });
  }
  if (url.includes('hymnary.org/search')) return url.includes('fullText') ? ok('') : ok(HYMN_CSV);
  if (url.includes('hymnary.org/text/amazing_grace_how_sweet_the_sound')) return ok(HYMN_HTML);
  if (url.includes('hymnary.org/text/')) return ok('<html>no words, still in copyright</html>');
  if (url.includes('/suggest/')) return ok({ data: [] });
  if (url.includes('api.lyrics.ovh/v1/')) return fail(404);
  throw new Error('unexpected ' + url);
};

const online = require('../src/main/online');
let passed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('  FAIL ' + name + '\n', e); process.exitCode = 1; } };

(async () => {
  await t('hymnary page → slides (numbers, refrain, credit line removed)', () => {
    const s = online.hymnaryText(HYMN_HTML);
    assert.deepStrictEqual(s.map((x) => x.label), ['Verse 1', 'Chorus', 'Verse 2']);
    assert.strictEqual(s[0].text, 'Amazing grace (how sweet the sound)\nthat saved a wretch like me!');
    assert.strictEqual(s[1].text, 'Praise God, & praise Him');
    assert.strictEqual(s[2].text, '’Twas grace that taught\nmy heart to fear');
  });

  await t('hymnary: refrain markers, numbering and notes cleaned up', () => {
    const html = '<div property="text"><div><p>1. Line one<br>line two. [Refrain]<br></p><p>Refrain (may be sung after final stanza only):<br>Chorus a<br>chorus b<br></p><p>2 Line three<br>line four Refrain<br></p><p>Source: Some Book #1</p></div></div>';
    const s = online.hymnaryText(html);
    assert.deepStrictEqual(s.map((x) => x.label), ['Verse 1', 'Chorus', 'Verse 2', 'Chorus']);
    assert.strictEqual(s[0].text, 'Line one\nline two.');
    assert.strictEqual(s[1].text, 'Chorus a\nchorus b');
    assert.strictEqual(s[2].text, 'Line three\nline four');
    assert.deepStrictEqual(online.hymnaryText('<div property="text"><p>Amen.<br></p></div>'), []);
  });

  await t('csv parser handles quotes and commas', () => {
    const r = online.parseCsv('a,b\n"x, y","say ""hi"""\n');
    assert.deepStrictEqual(r[1], ['x, y', 'say "hi"']);
  });

  await t('genius finds song from a lyric line, words fetched from LRCLIB', async () => {
    const progress = [];
    const r = await online.search('you are here moving in our midst', { sources: { genius: true, lrclib: true, hymnary: true, lyricsovh: true }, geniusToken: 'TEST-TOKEN' }, (p) => progress.push(p));
    const g = r.results.find((x) => x.provider === 'genius');
    assert.ok(g, JSON.stringify(r));
    assert.strictEqual(g.title, 'Way Maker');
    assert.strictEqual(g.source, 'Genius → LRCLIB');
    assert.ok(progress.length >= 4, 'one progress event per source');
    assert.ok(r.errors.some((e) => e.startsWith('LRCLIB')), 'LRCLIB busy reported, others still answered');
  });

  await t('hymnary returns only hymns with words', async () => {
    online.clearCache();
    const r = await online.search('amazing grace', { sources: { genius: false, lrclib: false, hymnary: true, lyricsovh: false } });
    assert.strictEqual(r.results.length, 1);
    assert.strictEqual(r.results[0].author, 'John Newton');
    assert.strictEqual(r.results[0].copyright, 'Public domain (Hymnary.org)');
  });

  await t('genius is skipped without a token', async () => {
    online.clearCache();
    calls.length = 0;
    await online.search('anything here', { sources: { genius: true, lrclib: false, hymnary: false, lyricsovh: true } });
    assert.ok(!calls.some((u) => u.includes('genius')));
  });

  await t('all sources off → clear message', async () => {
    const r = await online.search('zzz', { sources: { genius: false, lrclib: false, hymnary: false, lyricsovh: false } });
    assert.ok(/turned off/.test(r.error));
  });
  console.log(passed + ' online tests passed');
})();
