const assert = require('assert');
const T = require('../src/shared/textrules');
let passed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.error('  FAIL ' + name + '\n', e); process.exitCode = 1; } };
const c = T.compile({ words: ['God', 'Jesus', 'Holy Spirit'], replacements: [{ find: 'thru', replace: 'through' }], capFirst: true });
t('always-capitalised words, any case, whole words only', () => {
  assert.strictEqual(T.apply('our god is great, GOD is good', c), 'Our God is great, God is good');
  assert.strictEqual(T.apply("god's love and goddess", c), "God's love and goddess");
  assert.strictEqual(T.apply('come holy  spirit\njesus!', c), 'Come Holy Spirit\nJesus!');
});
t('replacements', () => assert.strictEqual(T.apply('walk thru the fire', c), 'Walk through the fire'));
t('capitalise first letter of each line, skipping quotes', () => assert.strictEqual(T.apply('“amazing grace\n  how sweet', c), '“Amazing grace\n  How sweet'));
t('no rules → unchanged', () => assert.strictEqual(T.apply('our god', T.compile({})), 'our god'));
console.log(passed + ' text rule tests passed');
