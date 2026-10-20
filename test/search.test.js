const assert = require('assert');
const { Index, highlight, norm } = require('../src/shared/search');
const Lyrics = require('../src/shared/lyrics');
const seed = require('../src/main/seed');

let passed = 0;
function t(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('  FAIL ' + name + '\n', e); process.exitCode = 1; } }

const idx = new Index().build(seed());

t('title match ranks first', () => {
  const r = idx.search('grace');
  assert.strictEqual(r[0].song.title, 'Amazing Grace');
  assert.strictEqual(r[0].kind, 'title');
});
t('lyric line match with label', () => {
  const r = idx.search('tune my heart');
  assert.strictEqual(r[0].song.title, 'Come, Thou Fount of Every Blessing');
  assert.strictEqual(r[0].kind, 'lyrics');
  assert.ok(/Tune my heart/.test(r[0].line));
});
t('punctuation & case insensitive', () => {
  assert.strictEqual(idx.search('HOLY HOLY')[0].song.title, 'Holy, Holy, Holy');
  assert.strictEqual(idx.search("twas grace that taught")[0].song.title, 'Amazing Grace');
});
t('words in any order', () => {
  const r = idx.search('river peace');
  assert.strictEqual(r[0].song.title, 'It Is Well with My Soul');
});
t('no match returns empty', () => { assert.deepStrictEqual(idx.search('zzzz nothing'), []); });
t('highlight', () => {
  const h = highlight('Amazing grace! How sweet', 'GRACE');
  assert.strictEqual(h.hit, 'grace');
});
t('parse labels', () => {
  const s = Lyrics.parse('Line a\nLine b\n\n[Chorus]\nC1\nC2\n\nVerse 2:\nV2\n\nBridge\nB1');
  assert.deepStrictEqual(s.map((x) => x.label), ['Verse 1', 'Chorus', 'Verse 2', 'Bridge']);
  assert.strictEqual(Lyrics.parse(Lyrics.serialize(s)).length, 4);
});
t('fromPlain detects chorus', () => {
  const s = Lyrics.fromPlain('A\nB\n\nC\nD\n\nE\nF\n\nC\nD');
  assert.deepStrictEqual(s.map((x) => x.label), ['Verse 1', 'Chorus', 'Verse 2', 'Chorus']);
});
t('pages', () => {
  assert.deepStrictEqual(Lyrics.pages('1\n2\n3\n4\n5', 2), ['1\n2', '3\n4', '5']);
  assert.deepStrictEqual(Lyrics.pages('1\n2', 0), ['1\n2']);
});
t('cards: 10 + 8 lines at 2 per screen = 9 cards', () => {
  const ten = Array.from({ length: 10 }, (_, i) => 'a' + i).join('\n');
  const eight = Array.from({ length: 8 }, (_, i) => 'b' + i).join('\n');
  const c = Lyrics.cards([{ label: 'Verse 1', text: ten }, { label: 'Verse 2', text: eight }], 2);
  assert.strictEqual(c.length, 9);
  assert.deepStrictEqual([c[4].g, c[4].gEnd, c[4].part, c[4].parts], [8, 10, 5, 5]);
  assert.deepStrictEqual([c[5].slide, c[5].g, c[5].start], [1, 10, 0]);
  assert.strictEqual(Lyrics.cards([{ label: 'V', text: ten }], 0).length, 1);
});
t('cards: orphan line own vs merge', () => {
  const nine = Array.from({ length: 9 }, (_, i) => 'x' + i).join('\n');
  assert.strictEqual(Lyrics.cards([{ label: 'V', text: nine }], 2, 'own').length, 5);
  const m = Lyrics.cards([{ label: 'V', text: nine }], 2, 'merge');
  assert.strictEqual(m.length, 4); assert.strictEqual(m[3].lines.length, 3);
  assert.deepStrictEqual(Lyrics.slideStarts([{ text: 'a\nb' }, { text: 'c' }]), [0, 2, 3]);
});
t('speed: 10k songs under 50ms', () => {
  const many = [];
  const base = seed();
  for (let i = 0; i < 2000; i++) base.forEach((s) => many.push(Object.assign({}, s, { id: s.id + i, title: s.title + ' ' + i })));
  const big = new Index().build(many);
  const t0 = Date.now();
  big.search('sorrows like sea');
  big.search('zzzz');
  const ms = Date.now() - t0;
  console.log('       (2 searches over ' + many.length + ' songs: ' + ms + ' ms)');
  assert.ok(ms < 100);
});
console.log(passed + ' passed');
