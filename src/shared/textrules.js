/* Text rules applied to everything shown on the outputs (and on the console's screen cards).
 *   words:        spellings that always win, matched as whole words in any case
 *                 ("God" turns "god", "GOD" and "God's" → "God", "God's"; "goddess" is left alone)
 *   replacements: [{ find, replace }] whole-word, any case ("thru" → "through")
 *   capFirst:     capitalise the first letter of every line
 * Shared by the renderer and the tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TextRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const word = (s) => '(?<![\\p{L}\\p{N}])' + esc(s.trim()).replace(/\s+/g, '\\s+') + '(?![\\p{L}\\p{N}])';

  function compile(rules) {
    rules = rules || {};
    const list = [];
    (rules.replacements || []).forEach((r) => {
      if (r && String(r.find || '').trim()) list.push({ re: new RegExp(word(String(r.find)), 'giu'), to: String(r.replace || '') });
    });
    (rules.words || []).forEach((w) => {
      w = String(w || '').trim();
      if (w) list.push({ re: new RegExp(word(w), 'giu'), to: w });
    });
    return { list, capFirst: !!rules.capFirst, sig: JSON.stringify([rules.words || [], rules.replacements || [], !!rules.capFirst]) };
  }

  function apply(text, compiled) {
    if (!compiled || (!compiled.list.length && !compiled.capFirst)) return text;
    let out = String(text || '');
    compiled.list.forEach((r) => { out = out.replace(r.re, () => r.to); });
    if (compiled.capFirst) out = out.split('\n').map((l) => l.replace(/^(\P{L}*)(\p{L})/u, (m, a, b) => a + b.toUpperCase())).join('\n');
    return out;
  }

  return { compile, apply };
});
