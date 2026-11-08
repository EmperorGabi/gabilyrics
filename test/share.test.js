// Two Gabilyrics "computers" in one process: they find each other over UDP broadcast and fetch libraries.
const assert = require('assert');
const { Share } = require('../src/main/share');
const { OutputServer } = require('../src/main/server');

(async () => {
  const libA = { name: 'Front of house', rev: '1:1', songs: [{ id: 'a1', title: 'Amazing Grace', author: 'John Newton', slides: [{ label: 'Verse 1', text: 'Amazing grace' }] }] };
  let sharingA = true;
  const srvA = new OutputServer(() => ({}), () => ({}), () => (sharingA ? libA : null));
  const srvB = new OutputServer(() => ({}), () => ({}), () => null);
  const portA = await srvA.start(7451, true);
  const portB = await srvB.start(7452, true);

  let seenByB = [];
  const a = new Share(() => ({ id: 'A', name: 'Front of house', enabled: sharingA, port: portA, rev: libA.rev, count: 1 }), () => {});
  const b = new Share(() => ({ id: 'B', name: 'Stream PC', enabled: false, port: portB, rev: '0:0', count: 0 }), (peers) => { seenByB = peers; });
  a.start(); b.start();

  const until = async (fn, ms) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 100)); } return true; };
  const found = await until(() => seenByB.length === 1 && seenByB[0].songs.length === 1, 8000);
  try {
    assert.ok(found, 'B found A: ' + JSON.stringify(seenByB));
    assert.strictEqual(seenByB[0].name, 'Front of house');
    assert.strictEqual(seenByB[0].songs[0].title, 'Amazing Grace');
    assert.ok(!b.list().some((p) => p.id === 'B'), 'does not list itself');
    console.log('  ok  computers find each other and share songs');

    // A turns sharing off → disappears from B's list
    sharingA = false; a.announce();
    assert.ok(await until(() => seenByB.length === 0, 6000), 'A removed after turning sharing off');
    console.log('  ok  turning sharing off hides the library');

    const r = await fetch('http://127.0.0.1:' + portA + '/api/library');
    assert.strictEqual(r.status, 403);
    console.log('  ok  /api/library refuses when sharing is off');
  } catch (e) { console.error('  FAIL share\n', e); process.exitCode = 1; }
  a.stop(); b.stop(); await srvA.stop(); await srvB.stop();
  process.exit();
})();
