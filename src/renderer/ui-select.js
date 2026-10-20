/* Styled select (shadcn-style) layered over native <select> elements.
 * The native select stays in the DOM (hidden) and remains the source of truth:
 * app code keeps reading .value and listening for 'change'. Call UISelect.refresh()
 * after setting .value from code. */
(function () {
  const CHEVRON = '<svg class="ui-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  const CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  let current = null;
  let uid = 0;

  class Select {
    constructor(sel) {
      this.sel = sel;
      this.id = 'uis' + (++uid);
      sel.classList.add('ui-native');
      sel.tabIndex = -1;
      sel.setAttribute('aria-hidden', 'true');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ui-select-trigger';
      b.setAttribute('aria-haspopup', 'listbox');
      b.setAttribute('aria-expanded', 'false');
      if (sel.title) b.title = sel.title;
      b.innerHTML = '<span class="ui-select-value"></span>' + CHEVRON;
      sel.parentNode.insertBefore(b, sel);
      this.btn = b;
      sel._ui = this;
      b.addEventListener('click', (e) => { e.preventDefault(); if (this.isOpen()) this.close(); else this.open(false); });
      b.addEventListener('keydown', (e) => {
        if (!this.isOpen() && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); e.stopPropagation(); this.open(true); }
      });
      new MutationObserver(() => this.refresh()).observe(sel, { childList: true, subtree: true, attributes: true, characterData: true });
      sel.addEventListener('change', () => this.refresh());
      this.refresh();
    }

    refresh() {
      const o = this.sel.options[this.sel.selectedIndex];
      this.btn.querySelector('.ui-select-value').textContent = o ? o.textContent : '';
      this.btn.disabled = this.sel.disabled;
    }

    isOpen() { return current === this; }

    open(viaKey) {
      if (current) current.close();
      current = this;
      this.viaKey = viaKey;
      const list = document.createElement('div');
      list.className = 'ui-select-content';
      list.id = this.id + '-list';
      list.setAttribute('role', 'listbox');
      Array.from(this.sel.options).forEach((o, i) => {
        const it = document.createElement('div');
        it.className = 'ui-select-item';
        it.id = this.id + '-o' + i;
        it.dataset.i = i;
        it.setAttribute('role', 'option');
        it.setAttribute('aria-selected', String(i === this.sel.selectedIndex));
        it.innerHTML = '<span class="ui-select-label"></span><span class="ui-check">' + (i === this.sel.selectedIndex ? CHECK : '') + '</span>';
        it.firstChild.textContent = o.textContent;
        list.appendChild(it);
      });
      document.body.appendChild(list);
      this.list = list;
      this.btn.setAttribute('aria-expanded', 'true');
      this.btn.setAttribute('aria-controls', list.id);
      this.position();
      this.active = Math.max(0, this.sel.selectedIndex);
      this.highlight(true);

      list.addEventListener('mousemove', (e) => { const it = e.target.closest('.ui-select-item'); if (it && +it.dataset.i !== this.active) { this.active = +it.dataset.i; this.highlight(false); } });
      list.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus on the trigger
      list.addEventListener('click', (e) => { const it = e.target.closest('.ui-select-item'); if (it) this.choose(+it.dataset.i); });

      this.onKey = (e) => this.key(e);
      this.onDown = (e) => { if (!list.contains(e.target) && !this.btn.contains(e.target)) this.close(); };
      this.onScroll = (e) => { if (!list.contains(e.target)) this.close(); };
      this.onResize = () => this.close();
      document.addEventListener('keydown', this.onKey, true);
      document.addEventListener('mousedown', this.onDown, true);
      window.addEventListener('scroll', this.onScroll, true);
      window.addEventListener('resize', this.onResize);
      window.addEventListener('blur', this.onResize);
      requestAnimationFrame(() => list.classList.add('open'));
    }

    position() {
      const r = this.btn.getBoundingClientRect();
      const l = this.list;
      l.style.minWidth = r.width + 'px';
      const below = innerHeight - r.bottom - 8, above = r.top - 8;
      const natural = Math.min(l.scrollHeight, 320);
      const up = below < natural && above > below;
      l.style.maxHeight = Math.max(120, Math.min(320, up ? above - 4 : below - 4)) + 'px';
      const h = l.offsetHeight;
      l.style.top = (up ? r.top - h - 4 : r.bottom + 4) + 'px';
      l.dataset.side = up ? 'top' : 'bottom';
      const w = l.offsetWidth;
      l.style.left = Math.max(8, Math.min(r.left, innerWidth - 8 - w)) + 'px';
    }

    highlight(scroll) {
      Array.from(this.list.children).forEach((it, i) => it.classList.toggle('active', i === this.active));
      const el = this.list.children[this.active];
      if (el) { this.btn.setAttribute('aria-activedescendant', el.id); if (scroll) el.scrollIntoView({ block: 'nearest' }); }
    }

    key(e) {
      const n = this.sel.options.length;
      const handled = () => { e.preventDefault(); e.stopPropagation(); };
      if (e.key === 'ArrowDown') { handled(); this.active = Math.min(n - 1, this.active + 1); this.highlight(true); }
      else if (e.key === 'ArrowUp') { handled(); this.active = Math.max(0, this.active - 1); this.highlight(true); }
      else if (e.key === 'Home') { handled(); this.active = 0; this.highlight(true); }
      else if (e.key === 'End') { handled(); this.active = n - 1; this.highlight(true); }
      else if (e.key === 'Enter' || e.key === ' ') { handled(); this.choose(this.active); }
      else if (e.key === 'Escape') { handled(); this.close(); this.btn.focus(); }
      else if (e.key === 'Tab') { this.close(); }
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        handled();
        const ch = e.key.toLowerCase();
        const opts = Array.from(this.sel.options);
        const start = (this.active + 1) % n;
        for (let k = 0; k < n; k++) {
          const i = (start + k) % n;
          if (opts[i].textContent.trim().toLowerCase().startsWith(ch)) { this.active = i; this.highlight(true); break; }
        }
      }
    }

    choose(i) {
      const viaKey = this.viaKey;
      if (i !== this.sel.selectedIndex) {
        this.sel.selectedIndex = i;
        this.sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      this.close();
      if (viaKey) this.btn.focus(); else this.btn.blur();
    }

    close() {
      if (current !== this) return;
      current = null;
      document.removeEventListener('keydown', this.onKey, true);
      document.removeEventListener('mousedown', this.onDown, true);
      window.removeEventListener('scroll', this.onScroll, true);
      window.removeEventListener('resize', this.onResize);
      window.removeEventListener('blur', this.onResize);
      this.btn.setAttribute('aria-expanded', 'false');
      this.btn.removeAttribute('aria-activedescendant');
      const l = this.list; this.list = null;
      if (l) { l.classList.remove('open'); setTimeout(() => l.remove(), 120); }
    }
  }

  window.UISelect = {
    enhance(root) { (root || document).querySelectorAll('select:not(.ui-native)').forEach((s) => new Select(s)); },
    refresh(root) { (root || document).querySelectorAll('select.ui-native').forEach((s) => s._ui && s._ui.refresh()); },
  };
})();
