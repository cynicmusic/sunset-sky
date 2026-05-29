// Vanilla DOM control panel for the island root app.
// The footer exposes only the master A-H / 1-8 preset surface.

import { presetGradient } from '../config/presets.js';

export class ControlPanel {
  constructor({ store, schema, sectionOrder, onToggle, sticky, presets }) {
    this.store = store;
    this.schema = schema;
    this.sectionOrder = sectionOrder;
    this.onToggle = onToggle;
    this.sticky = sticky || { has: () => false, toggle: () => false };
    this.presets = presets || { slots: {}, save: () => {}, load: () => {} };
    this.fieldUpdaters = new Map();
    this.stickyEls = new Map();
    this.collapsed = true;
    this.statusTimer = null;

    this.root = document.createElement('div');
    this.root.className = 'ff-panel' + (this.collapsed ? ' collapsed' : '');
    this._buildHeader();
    this._buildBody();
    this._buildFooter();

    this.unsubscribe = store.subscribe((evt) => this._onStoreChange(evt));
  }

  toggle() {
    this.collapsed = !this.collapsed;
    this.root.classList.toggle('collapsed', this.collapsed);
    this.onToggle?.(this.collapsed);
  }

  collapseSections() {
    this.root.querySelectorAll('.ff-section.open').forEach((section) => {
      section.classList.remove('open');
    });
  }

  flashStatus(text, kind = 'ok') {
    this.statusEl.textContent = text;
    this.statusEl.classList.remove('ok', 'err');
    this.statusEl.classList.add(kind);
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => {
      this.statusEl.textContent = '';
      this.statusEl.classList.remove('ok', 'err');
    }, 2200);
  }

  _onStoreChange(evt) {
    if (evt.path === '*') {
      for (const [path, updaters] of this.fieldUpdaters) {
        for (const update of updaters) update(this.store.get(path));
      }
      return;
    }
    const updaters = this.fieldUpdaters.get(evt.path);
    if (updaters) {
      for (const update of updaters) update(evt.value);
    }
  }

  _registerUpdater(path, apply) {
    if (!this.fieldUpdaters.has(path)) this.fieldUpdaters.set(path, new Set());
    this.fieldUpdaters.get(path).add(apply);
  }

  // No title; just a slim status line for preset feedback.
  _buildHeader() {
    const head = document.createElement('div');
    head.className = 'ff-panel-header';
    head.innerHTML = `<div class="ff-panel-status"></div>`;
    this.statusEl = head.querySelector('.ff-panel-status');
    this.root.appendChild(head);
  }

  _buildBody() {
    this.body = document.createElement('div');
    this.body.className = 'ff-panel-body';
    // Every category starts collapsed — a clean, compact panel on load.
    for (const sectionKey of this.sectionOrder) {
      const section = this.schema[sectionKey];
      this.body.appendChild(this._buildSection(sectionKey, section, false));
    }
    this.root.appendChild(this.body);
  }

  _buildSection(key, section, openByDefault) {
    const root = document.createElement('div');
    root.className = 'ff-section' + (openByDefault ? ' open' : '');
    root.setAttribute('data-section', key);

    const head = document.createElement('div');
    head.className = 'ff-section-head';
    head.innerHTML = `
      <span class="ff-section-icon">${section.icon || '·'}</span>
      <span class="ff-section-label">${section.label}</span>
      <span class="ff-section-blurb">${section.blurb || ''}</span>
      <span class="ff-section-chevron">▸</span>
    `;
    head.addEventListener('click', () => root.classList.toggle('open'));
    root.appendChild(head);

    const body = document.createElement('div');
    body.className = 'ff-section-body';
    for (const [fieldKey, field] of Object.entries(section.fields)) {
      const path = field.path || `${key}.${fieldKey}`;
      const row = this._buildField(path, field);
      if (row) body.appendChild(row);
    }
    root.appendChild(body);
    return root;
  }

  _buildField(path, field) {
    switch (field.type) {
      case 'group':
        return this._buildGroupField(field);
      case 'int':
      case 'float':
        return this._buildSliderField(path, field);
      case 'range':
        return this._buildRangeField(path, field);
      case 'bool':
        return this._buildToggleField(path, field);
      default:
        return null;
    }
  }

  _buildGroupField(field) {
    const row = document.createElement('div');
    row.className = 'ff-field-group';
    if (field.origin) row.dataset.origin = field.origin;
    if (field.color) row.style.setProperty('--group-color', field.color);
    if (field.wash) row.style.setProperty('--group-wash', field.wash);
    row.innerHTML = `
      <span class="ff-field-group-icon">${field.icon || '·'}</span>
      <span class="ff-field-group-label">${field.label || ''}</span>
      ${field.map ? `<span class="ff-field-group-map">${field.map}</span>` : ''}
    `;
    return row;
  }

  _buildSliderField(path, field) {
    const curved = Number(field.curve) > 0 && field.type !== 'int';
    const sliderMin = curved ? 0 : field.min;
    const sliderMax = curved ? 1 : field.max;
    const sliderStep = curved ? (field.uiStep ?? 0.001) : field.step;
    const row = document.createElement('div');
    row.className = 'ff-field';
    row.innerHTML = `
      <div class="ff-field-label">
        <span class="ff-field-name">${field.label}</span>
        ${field.hint ? `<span class="ff-field-hint">${field.hint}</span>` : ''}
      </div>
      <div class="ff-field-value"></div>
      <div class="ff-field-control">
        <div class="ff-slider">
          <input type="range" min="${sliderMin}" max="${sliderMax}" step="${sliderStep}" />
        </div>
      </div>
    `;
    const valueEl = row.querySelector('.ff-field-value');
    const slider = row.querySelector('.ff-slider');
    const input = row.querySelector('input');
    const formatter = makeFormatter(field);
    const toSlider = (num) => {
      if (!curved) return num;
      const t = (Number(num) - field.min) / (field.max - field.min);
      return Math.pow(Math.max(0, Math.min(1, t)), 1 / field.curve);
    };
    const fromSlider = (raw) => {
      if (!curved) return Number(raw);
      const t = Math.max(0, Math.min(1, Number(raw)));
      return field.min + (field.max - field.min) * Math.pow(t, field.curve);
    };

    const apply = (v) => {
      const num = Number(v);
      const sliderValue = toSlider(num);
      input.value = String(sliderValue);
      valueEl.textContent = formatter(num);
      const pct = curved ? sliderValue * 100 : ((num - field.min) / (field.max - field.min)) * 100;
      slider.style.setProperty('--ff-pct', `${pct.toFixed(2)}%`);
    };

    apply(this.store.get(path));
    input.addEventListener('input', () => {
      const raw = fromSlider(input.value);
      const v = field.type === 'int' ? Math.round(raw) : raw;
      this.store.set(path, v);
      apply(v);
    });
    this._releaseRangeFocus(input);

    this._attachSticky(row, path, field);
    this._registerUpdater(path, apply);
    return row;
  }

  _buildRangeField(path, field) {
    const row = document.createElement('div');
    row.className = 'ff-field';
    row.innerHTML = `
      <div class="ff-field-label">
        <span class="ff-field-name">${field.label}</span>
        ${field.hint ? `<span class="ff-field-hint">${field.hint}</span>` : ''}
      </div>
      <div class="ff-field-value"></div>
      <div class="ff-field-control">
        <div class="ff-range${field.handle === 'ticks' ? ' ff-range-ticks' : ''}">
          <div class="ff-range-track"><div class="ff-range-fill"></div></div>
          <input type="range" min="${field.min}" max="${field.max}" step="${field.step}" />
          <input type="range" min="${field.min}" max="${field.max}" step="${field.step}" />
        </div>
      </div>
    `;
    const valueEl = row.querySelector('.ff-field-value');
    const fill = row.querySelector('.ff-range-fill');
    const inputs = row.querySelectorAll('input');
    const inMin = inputs[0];
    const inMax = inputs[1];
    const formatter = makeFormatter(field);

    const apply = (tuple) => {
      const [lo, hi] = tuple;
      inMin.value = String(lo);
      inMax.value = String(hi);
      const span = field.max - field.min;
      const left = ((lo - field.min) / span) * 100;
      const right = (1 - (hi - field.min) / span) * 100;
      fill.style.left = `${left.toFixed(2)}%`;
      fill.style.right = `${right.toFixed(2)}%`;
      valueEl.textContent = `${formatter(lo)} ─ ${formatter(hi)}`;
    };

    const onChange = () => {
      let lo = Number(inMin.value);
      let hi = Number(inMax.value);
      const minGap = field.step;
      if (lo > hi - minGap) {
        if (lo > Number(this.store.get(path)[0])) lo = hi - minGap;
        else hi = lo + minGap;
      }
      lo = Math.max(field.min, Math.min(field.max - minGap, lo));
      hi = Math.max(field.min + minGap, Math.min(field.max, hi));
      const tuple = [lo, hi];
      this.store.set(path, tuple);
      apply(tuple);
    };

    apply(this.store.get(path));
    inMin.addEventListener('input', onChange);
    inMax.addEventListener('input', onChange);
    this._releaseRangeFocus(inMin);
    this._releaseRangeFocus(inMax);

    this._attachSticky(row, path, field);
    this._registerUpdater(path, apply);
    return row;
  }

  _releaseRangeFocus(input) {
    const blur = () => input.blur();
    input.addEventListener('pointerup', blur);
    input.addEventListener('change', blur);
    input.addEventListener('keydown', (event) => {
      if (!event.key.startsWith('Arrow') && event.key !== 'Tab') blur();
    });
  }

  _buildToggleField(path, field) {
    const row = document.createElement('div');
    row.className = 'ff-field';
    row.innerHTML = `
      <div class="ff-field-label">
        <span class="ff-field-name">${field.label}</span>
        ${field.hint ? `<span class="ff-field-hint">${field.hint}</span>` : ''}
      </div>
      <div class="ff-field-value">
        <div class="ff-toggle"></div>
      </div>
    `;
    const toggle = row.querySelector('.ff-toggle');
    const apply = (v) => {
      toggle.classList.toggle('on', !!v);
    };
    apply(this.store.get(path));
    toggle.addEventListener('click', () => {
      const next = !this.store.get(path);
      this.store.set(path, next);
      apply(next);
    });
    this._attachSticky(row, path, field);
    this._registerUpdater(path, apply);
    return row;
  }

  _buildFooter() {
    const footer = document.createElement('div');
    footer.className = 'ff-panel-footer';

    // Bank row A–H — selects which 8-slot bank the preset row + the 1-8
    // hotkeys address. Click-only (letters collide with WASD/h/b/f/r).
    const banks = document.createElement('div');
    banks.className = 'ff-banks';
    this.bankEls = new Map();
    for (const L of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
      const b = document.createElement('button');
      b.className = 'ff-bank';
      b.dataset.bank = L;
      b.textContent = L;
      b.title = `bank ${L}`;
      b.addEventListener('click', () => {
        b.blur();
        this.presets.setBank?.(L);
        this._syncBankActive();
      });
      banks.appendChild(b);
      this.bankEls.set(L, b);
    }
    footer.appendChild(banks);

    // Preset slots 1–8 of the active bank (one shrunk row). Click loads,
    // shift-click saves. Each filled slot is a tiny sky/land/water postcard.
    const grid = document.createElement('div');
    grid.className = 'ff-presets';
    this.presetEls = new Map();
    for (let slot = 1; slot <= 8; slot++) {
      const b = document.createElement('button');
      b.className = 'ff-preset';
      b.dataset.slot = String(slot);
      b.innerHTML = `<span class="ff-preset-num">${slot}</span>`;
      b.addEventListener('click', (e) => {
        b.blur();
        if (e.shiftKey) this.presets.save(slot);
        else this.presets.load(slot);
      });
      grid.appendChild(b);
      this.presetEls.set(slot, b);
    }
    footer.appendChild(grid);

    this.root.appendChild(footer);
    this.refreshPresets();
  }

  _syncBankActive() {
    if (!this.bankEls) return;
    const active = this.presets?.getBank?.() || 'A';
    for (const [L, b] of this.bankEls) b.classList.toggle('active', L === active);
  }

  refreshPresets() {
    this._syncBankActive();
    if (!this.presetEls) return;
    const bank = this.presets?.getBank?.() || 'A';
    const activeKey = this.presets?.getActiveKey?.() || '';
    const slots = this.presets?.slots || {};
    for (const [slot, b] of this.presetEls) {
      const key = `${bank}${slot}`;
      const p = slots[key];
      const filled = !!p;
      b.classList.toggle('filled', filled);
      b.classList.toggle('active', key === activeKey);
      b.style.backgroundImage = filled ? (presetGradient(p) || '') : '';
      b.title = `${key}${key === 'A1' ? ' (default)' : ''} — click load · shift-click save`;
    }
  }

  // ◇ before the field name -> ◆ when marked important. This no longer
  // persists or affects reload/randomize; it is just a local visual reminder.
  _attachSticky(row, path, field = {}) {
    if (field.pin === false) return;
    const label = row.querySelector('.ff-field-name');
    if (!label) return;
    const major = path.startsWith('voxel.');
    const d = document.createElement('button');
    d.className = 'ff-sticky' + (major ? ' major' : '') + (this.sticky.has(path) ? ' on' : '');
    d.title = 'important param marker — visual reminder only';
    d.textContent = this.sticky.has(path) ? '◆' : '◇';
    d.addEventListener('click', (e) => {
      e.stopPropagation();
      d.blur();
      const on = this.sticky.toggle(path);
      const buttons = this.stickyEls.get(path) || new Set([d]);
      for (const btn of buttons) {
        btn.classList.toggle('on', on);
        btn.textContent = on ? '◆' : '◇';
      }
    });
    label.prepend(d);
    if (!this.stickyEls.has(path)) this.stickyEls.set(path, new Set());
    this.stickyEls.get(path).add(d);
  }

  refreshSticky() {
    for (const [path, buttons] of this.stickyEls) {
      const on = this.sticky.has(path);
      for (const d of buttons) {
        d.classList.toggle('on', on);
        d.textContent = on ? '◆' : '◇';
      }
    }
  }

  destroy() {
    this.unsubscribe?.();
    this.root.remove();
  }
}

function makeFormatter(field) {
  const isInt = field.type === 'int';
  const decimals = Number.isInteger(field.precision)
    ? field.precision
    : field.step >= 1 ? 0 : field.step >= 0.1 ? 1 : field.step >= 0.01 ? 2 : field.step >= 0.001 ? 3 : 4;
  return (v) => {
    if (field.labels && field.labels[v | 0] !== undefined) return field.labels[v | 0];
    const formatted = isInt ? String(v | 0) : Number(v).toFixed(decimals);
    return field.unit ? `${formatted} ${field.unit}` : formatted;
  };
}
