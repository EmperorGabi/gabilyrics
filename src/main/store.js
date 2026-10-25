// JSON persistence in the user's app-data folder (atomic writes).
const fs = require('fs');
const path = require('path');
const seed = require('./seed');

const DEFAULT_SETTINGS = {
  outputs: {
    ndiProgram: { enabled: true, name: 'GABILYRICS (Program)', style: 'follow', width: 1920, height: 1080, fps: 30 },
    ndiKey: { enabled: true, name: 'GABILYRICS (Lower third)', style: 'lower', width: 1920, height: 1080, fps: 30 },
    projector: { enabled: false, displayId: null, style: 'full' },
  },
  lower: {
    font: 'Segoe UI, Helvetica Neue, Arial, sans-serif', size: 44, weight: 600, color: '#FFFFFF',
    boxColor: '#080A0E', boxOpacity: 82, bottom: 64, side: 120, linesPerPage: 2, orphan: 'own',
    showTitle: 'first', accent: '#F5A524', uppercase: false,
    // text effects (px at 1080p)
    shadow: false, shadowColor: '#000000', shadowOpacity: 80, shadowBlur: 8, shadowX: 0, shadowY: 2,
    outline: false, outlineColor: '#000000', outlineWidth: 2,
  },
  full: {
    font: 'Segoe UI, Helvetica Neue, Arial, sans-serif', size: 72, weight: 700, color: '#FFFFFF',
    bg: '#000000', bgImage: '', bgDim: 40, credit: 'full', licence: '',
    shadow: true, shadowColor: '#000000', shadowOpacity: 60, shadowBlur: 12, shadowX: 0, shadowY: 3,
    outline: false, outlineColor: '#000000', outlineWidth: 3,
  },
  search: { autoOnline: true, cacheOnline: true, sources: { genius: true, lrclib: true, hymnary: true, lyricsovh: true }, geniusToken: '' },
  server: { port: 7380, lan: false },
  transition: 200,
  theme: 'dark',
};

function deepMerge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const k of Object.keys(over)) {
    out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) ? deepMerge(base[k], over[k]) : over[k];
  }
  return out;
}

class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.files = {
      library: path.join(dir, 'library.json'),
      settings: path.join(dir, 'settings.json'),
      plans: path.join(dir, 'plans.json'),
    };
    this.library = this._read(this.files.library, null);
    if (!Array.isArray(this.library)) { this.library = seed(); this._write('library'); }
    this.settings = deepMerge(DEFAULT_SETTINGS, this._read(this.files.settings, {}));
    // Several saved service plans; one is current. Migrates the single plan.json from earlier versions.
    this.plans = this._read(this.files.plans, null);
    if (!this.plans || !Array.isArray(this.plans.plans) || !this.plans.plans.length) {
      const old = this._read(path.join(dir, 'plan.json'), null);
      const items = old && Array.isArray(old.items) ? old.items : ['amazing-grace', 'holy-holy-holy', 'it-is-well', 'blessed-assurance'];
      const name = old && old.name ? old.name : 'Sunday Service';
      this.plans = { current: 'plan-1', plans: [{ id: 'plan-1', name, items, updatedAt: Date.now() }] };
      this._write('plans');
    }
    if (!this.plans.plans.some((p) => p.id === this.plans.current)) this.plans.current = this.plans.plans[0].id;
    this._timers = {};
  }

  _read(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
  }

  _write(key) {
    const file = this.files[key];
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this[key], null, 1));
    fs.renameSync(tmp, file);
  }

  save(key) { // debounced
    clearTimeout(this._timers && this._timers[key]);
    this._timers[key] = setTimeout(() => this._write(key), 150);
  }

  flush() { for (const k of Object.keys(this.files)) { if (this._timers[k]) { clearTimeout(this._timers[k]); this._write(k); } } }

  upsertSong(song) {
    const now = Date.now();
    if (!song.id) song.id = slug(song.title) + '-' + now.toString(36);
    const i = this.library.findIndex((s) => s.id === song.id);
    song.updatedAt = now;
    if (i >= 0) this.library[i] = Object.assign({}, this.library[i], song);
    else { song.createdAt = now; this.library.push(song); }
    this.save('library');
    return song;
  }

  deleteSong(id) {
    this.library = this.library.filter((s) => s.id !== id);
    this.plans.plans.forEach((p) => { p.items = p.items.filter((x) => x !== id); });
    this.save('library'); this.save('plans');
  }

  setPlans(plans) {
    if (!plans || !Array.isArray(plans.plans) || !plans.plans.length) return false;
    this.plans = plans; this.save('plans'); return true;
  }

  setSettings(partial) { this.settings = deepMerge(this.settings, partial); this.save('settings'); return this.settings; }
}

function slug(s) {
  return String(s || 'song').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'song';
}

module.exports = { Store, DEFAULT_SETTINGS, deepMerge };
