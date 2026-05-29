// SHARED WORKSHOP PANEL SHELL — the building blocks that make every workshop
// look like the main sim. Produces the SAME DOM markup as
// `src/ui/ControlPanel.js` so the SAME `panel.css` rules light up: colored
// section rails, gradient labels, slider tracks, glass body, bank row,
// preset slots — no duplicated CSS, no hand-rolled styles per workshop.
//
// **Consumers MUST import `src/styles.css` BEFORE `src/ui/panel.css`** — that
// stylesheet owns the CSS custom properties (--accent-soft, --track,
// --bg-glass, --font-mono, --border-*, --text-*). Without it the panel
// renders without slider tracks, in a serif fallback font, with no
// colour rails. (The whole "old netscape" look came from missing this one
// import.)
//
// Used by:
//   src/workshop/palm/palmWorkshop.js
//   (next: pine workshop, fixit workshops, ...)
//
// API surface
// -----------
//   section(parent, opts)        — collapsible card with optional accent
//   sliderField(parent, opts)    — number row with track, label + hint + unit
//   enumField(parent, opts)      — select row, same label/hint grammar
//   toggleField(parent, opts)    — ff-toggle pill, same label/hint grammar
//   makePanelChrome(panel)       — side handle + hint strip + collapse
//   makeStatusFlasher(el, label) — flash(msg, kind) status pill helper
//   bankRow(parent, opts)        — A-H bank picker (one tight row)
//   presetRow(parent, opts)      — 1-8 slot grid, click load / shift-click save
//   ACCENTS                      — named colour presets workshops pick from

const SEL_STYLE = 'background:#0e1a14;color:#cfe7d8;border:1px solid #2c4a38;border-radius:4px;padding:3px;width:100%;font:11.5px var(--font-mono, "SF Mono", monospace)';

// Each ACCENT mirrors a sim category's colour family (see panel.css
// `.ff-section[data-section="..."]`). Workshops pick by NAME so the visual
// taxonomy stays consistent — motion=warm, structural=red, flora=green,
// seasons=gold/cyan/green, shading=grey, info=teal.
export const ACCENTS = {
  motion:     { bar: '#ff8a3a', wash: 'rgba(255,138,58,0.07)',  strong: 'rgba(255,138,58,0.13)',  gradient: 'linear-gradient(110deg,#ffe070 0%,#ff8a3a 50%,#ff5a5a 100%)' },
  structural: { bar: '#e51d0e', wash: 'rgba(230,29,14,0.13)',   strong: 'rgba(230,29,14,0.22)',   gradient: 'linear-gradient(110deg,#ff5141 0%,#e21800 55%,#b00d00 100%)' },
  flora:      { bar: '#7cc07f', wash: 'rgba(120,196,128,0.07)', strong: 'rgba(120,196,128,0.13)', gradient: 'linear-gradient(110deg,#6abc78 0%,#b0cc66 50%,#e8cf94 100%)' },
  seasons:    { bar: '#7fd24a', wash: 'rgba(111,206,74,0.07)',  strong: 'rgba(111,206,74,0.13)',  gradient: 'linear-gradient(110deg,#6fce4a 0%,#e6b800 45%,#bfe9f0 100%)' },
  shading:    { bar: '#aab4be', wash: 'rgba(170,180,190,0.05)', strong: 'rgba(170,180,190,0.09)', gradient: 'linear-gradient(110deg,#a8b2bc 0%,#ecf0f4 50%,#889098 100%)' },
  info:       { bar: '#2fd9c8', wash: 'rgba(47,217,200,0.06)',  strong: 'rgba(47,217,200,0.12)',  gradient: 'linear-gradient(110deg,#4ad0ff 0%,#2fd9c8 50%,#ff8a3a 100%)' },
  lighting:   { bar: '#ffcf6a', wash: 'rgba(255,206,106,0.08)', strong: 'rgba(255,206,106,0.14)', gradient: 'linear-gradient(110deg,#fff1c2 0%,#ffd166 50%,#ff9e3d 100%)' },
};

function applyAccent(root, accent) {
  if (!accent) return;
  const a = typeof accent === 'string' ? ACCENTS[accent] : accent;
  if (!a) return;
  root.style.setProperty('--label-bar', a.bar);
  root.style.setProperty('--label-wash', a.wash);
  root.style.setProperty('--label-wash-strong', a.strong);
  root.style.setProperty('--label-gradient', a.gradient);
}

// camelCase → "Camel case" — for workshops that don't bother spelling
// labels explicitly. Used when opts.label is absent.
function autoLabel(key) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
}

// Number formatter mirroring `ControlPanel.makeFormatter` so workshop
// values display the same way as sim values (right-aligned, mono, unit
// suffix, decimal count derived from step).
function makeFormatter({ isInt, step, precision, unit, labels }) {
  const decimals = Number.isInteger(precision)
    ? precision
    : step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : step >= 0.001 ? 3 : 4;
  return (v) => {
    if (labels && labels[v | 0] !== undefined) return labels[v | 0];
    const formatted = isInt ? String(v | 0) : Number(v).toFixed(decimals);
    return unit ? `${formatted} ${unit}` : formatted;
  };
}

// section(parent, { icon, label, blurb, open, accent, build })
//
// Produces the exact markup `ControlPanel._buildSection` produces:
//   <div class="ff-section [open]" data-accent=...>
//     <div class="ff-section-head">
//       <span class="ff-section-icon"/> <span class="ff-section-label"/>
//       <span class="ff-section-blurb"/> <span class="ff-section-chevron">▸</span>
//     </div>
//     <div class="ff-section-body"> (built by `build(body)`) </div>
//   </div>
// `accent` = named ACCENT key OR a {bar, wash, strong, gradient} object →
// inline-set as CSS custom props on the section root so the rail/label
// gradient/wash all pick it up via panel.css.
export function section(parent, opts) {
  // Legacy positional shim — old callers passed (parent, icon, label, blurb, open, buildFn).
  // Detect and reshape.
  if (typeof opts === 'string') {
    const [icon, label, blurb, open, build] = [arguments[1], arguments[2], arguments[3], arguments[4], arguments[5]];
    opts = { icon, label, blurb, open, build };
  }
  const { icon = '·', label = '', blurb = '', open = true, accent, build } = opts;
  const root = document.createElement('div');
  root.className = 'ff-section' + (open ? ' open' : '');
  applyAccent(root, accent);
  root.innerHTML =
    `<div class="ff-section-head">
       <span class="ff-section-icon">${icon}</span>
       <span class="ff-section-label">${label}</span>
       <span class="ff-section-blurb">${blurb}</span>
       <span class="ff-section-chevron">▸</span>
     </div>
     <div class="ff-section-body"></div>`;
  root.querySelector('.ff-section-head').addEventListener('click', () =>
    root.classList.toggle('open'));
  if (build) build(root.querySelector('.ff-section-body'));
  parent.appendChild(root);
  return root;
}

// sliderField(parent, { key, min, max, default, label, hint, unit, step,
//                       isInt, isAxis, sticky, onChange })
//
// Produces the EXACT markup `ControlPanel._buildSliderField` produces:
//   <div class="ff-field">
//     <div class="ff-field-label">
//       <span class="ff-field-name">[◇] Label</span>
//       <span class="ff-field-hint">helpful hint</span>
//     </div>
//     <div class="ff-field-value">38 °</div>
//     <div class="ff-field-control"><div class="ff-slider">
//       <input type="range" .../>
//     </div></div>
//   </div>
//
// `sticky` — if provided as { has(key)->bool, toggle(key)->bool } the row
// gets a ◇/◆ pin like the sim's. If absent the pin is hidden.
export function sliderField(parent, opts) {
  // Legacy positional shim: (parent, key, min, max, def, isAxis, onChange).
  if (typeof opts === 'string') {
    const [key, min, max, def, isAxis, onChange] = [
      arguments[1], arguments[2], arguments[3],
      arguments[4], arguments[5], arguments[6]];
    opts = { key, min, max, default: def, isAxis, onChange };
  }
  const {
    key, min, max, step, isInt, isAxis = false,
    label = autoLabel(key), hint = '', unit = '',
    precision, labels, sticky, onChange,
  } = opts;
  const def = opts.default ?? opts.value;
  const span = max - min;
  const effStep = step ?? (isInt ? 1 : span <= 4 ? 0.01 : span <= 30 ? 0.5 : 1);

  const row = document.createElement('div');
  row.className = 'ff-field';
  if (isAxis) row.classList.add('is-axis');
  row.innerHTML =
    `<div class="ff-field-label">
       <span class="ff-field-name">${label}${isAxis ? ' · ▤ matrix X' : ''}</span>
       ${hint ? `<span class="ff-field-hint">${hint}</span>` : ''}
     </div>
     <div class="ff-field-value"></div>
     <div class="ff-field-control">
       <div class="ff-slider">
         <input type="range" min="${min}" max="${max}" step="${effStep}" value="${def}" ${isAxis ? 'disabled' : ''}/>
       </div>
     </div>`;
  if (isAxis) row.style.opacity = '0.55';

  const fmt = makeFormatter({ isInt, step: effStep, precision, unit, labels });
  const input = row.querySelector('input');
  const valueEl = row.querySelector('.ff-field-value');
  const slider = row.querySelector('.ff-slider');

  const apply = (raw) => {
    const v = isInt ? Math.round(Number(raw)) : Number(raw);
    input.value = String(v);
    valueEl.textContent = fmt(v);
    const pct = ((v - min) / span) * 100;
    slider.style.setProperty('--ff-pct', `${pct.toFixed(2)}%`);
  };
  apply(def);
  input.addEventListener('input', () => {
    const raw = Number(input.value);
    const v = isInt ? Math.round(raw) : raw;
    apply(v);
    onChange?.(v);
  });
  // release range focus on release/keys other than arrows so keyboard
  // shortcuts (H, F, etc.) work right after dragging a slider — same
  // posture ControlPanel uses.
  const blur = () => input.blur();
  input.addEventListener('pointerup', blur);
  input.addEventListener('change', blur);
  input.addEventListener('keydown', (e) => {
    if (!e.key.startsWith('Arrow') && e.key !== 'Tab') blur();
  });

  if (sticky) attachSticky(row, key, sticky);

  parent.appendChild(row);
  return { row, apply };
}

// ◇/◆ sticky pin before the field name. Workshops can pass an api
// {has, toggle, major?} — major=true gives the amber "structural pin"
// instead of the lime roll-friendly pin.
function attachSticky(row, key, sticky) {
  const name = row.querySelector('.ff-field-name');
  if (!name) return;
  const major = !!sticky.major;
  const pinned = !!sticky.has?.(key);
  const d = document.createElement('button');
  d.className = 'ff-sticky' + (major ? ' major' : '') + (pinned ? ' on' : '');
  d.title = major
    ? 'structural pin — lock this; it is never randomized'
    : 'sticky pin — keep this value across reseed/random';
  d.textContent = pinned ? '◆' : '◇';
  d.addEventListener('click', (e) => {
    e.stopPropagation();
    const on = sticky.toggle?.(key);
    d.classList.toggle('on', !!on);
    d.textContent = on ? '◆' : '◇';
  });
  name.prepend(d);
}

// enumField(parent, { key, options, value, label, hint, onChange })
//
// Same label/hint grammar; control is a styled <select>.
export function enumField(parent, opts) {
  const {
    key, options, value, onChange,
    label = autoLabel(key), hint = '',
  } = opts;
  const row = document.createElement('div');
  row.className = 'ff-field';
  row.innerHTML =
    `<div class="ff-field-label">
       <span class="ff-field-name">${label}</span>
       ${hint ? `<span class="ff-field-hint">${hint}</span>` : ''}
     </div>
     <div class="ff-field-value"></div>
     <div class="ff-field-control"></div>`;
  const sel = document.createElement('select');
  sel.style.cssText = SEL_STYLE;
  for (const o of options) {
    const op = document.createElement('option');
    const value = typeof o === 'object' ? o.value : o;
    op.value = String(value);
    op.textContent = String(typeof o === 'object' ? (o.label ?? o.value) : o);
    sel.appendChild(op);
  }
  sel.value = String(value);
  sel.addEventListener('change', () => onChange?.(sel.value));
  row.querySelector('.ff-field-control').appendChild(sel);
  parent.appendChild(row);
  return { row };
}

// toggleField(parent, { key, value, label, hint, onChange })
export function toggleField(parent, opts) {
  const { value, onChange, label = autoLabel(opts.key || ''), hint = '' } = opts;
  const row = document.createElement('div');
  row.className = 'ff-field';
  row.innerHTML =
    `<div class="ff-field-label">
       <span class="ff-field-name">${label}</span>
       ${hint ? `<span class="ff-field-hint">${hint}</span>` : ''}
     </div>
     <div class="ff-field-value">
       <div class="ff-toggle${value ? ' on' : ''}"></div>
     </div>`;
  const toggle = row.querySelector('.ff-toggle');
  toggle.addEventListener('click', () => {
    const next = !toggle.classList.contains('on');
    toggle.classList.toggle('on', next);
    onChange?.(next);
  });
  parent.appendChild(row);
  return { row };
}

// Status flasher attached to a .ff-panel-status span — same posture as
// ControlPanel.flashStatus. flash(msg, kind='ok') swaps text + class for ~2.4s.
export function makeStatusFlasher(statusEl, defaultLabel = '') {
  let timer = null;
  return function flash(msg, kind = 'ok') {
    statusEl.textContent = msg;
    statusEl.className = 'ff-panel-status ' + kind;
    clearTimeout(timer);
    timer = setTimeout(() => {
      statusEl.textContent = defaultLabel;
      statusEl.className = 'ff-panel-status ok';
    }, 2400);
  };
}

// Make the side-handle + hint strip + collapse toggling that workshops use.
// Returns { toggle, handle, hints }. Mutates document.body.
//
// opts.collapsed — start collapsed (default false). When true the chrome's
// internal flag, the handle's `.visible` class, and the hint strip's `.show`
// class are all set to match the COLLAPSED visual state at construction —
// otherwise the first click on the handle toggles AWAY from reality (caller
// pre-set the panel's `.collapsed` class but the chrome thought we were open).
export function makePanelChrome(panel, _body, opts = {}) {
  const handle = document.createElement('button');
  handle.className = 'ff-panel-handle';
  handle.textContent = '◧';
  handle.title = 'open controls (h)';
  document.body.appendChild(handle);
  const hints = document.createElement('div');
  hints.className = 'ff-hints';
  hints.innerHTML = opts.hintsHtml || '<kbd>WASD</kbd> fly <kbd>H</kbd> panel <kbd>F</kbd> perf';
  document.body.appendChild(hints);
  let collapsed = !!opts.collapsed;
  // Sync the panel + chrome to the initial state — no in-between hop.
  panel.classList.toggle('collapsed', collapsed);
  handle.classList.toggle('visible', collapsed);
  hints.classList.toggle('show', !collapsed);
  function toggle() {
    collapsed = !collapsed;
    panel.classList.toggle('collapsed', collapsed);
    handle.classList.toggle('visible', collapsed);
    hints.classList.toggle('show', !collapsed);
  }
  handle.addEventListener('click', toggle);
  return { toggle, handle, hints, get collapsed() { return collapsed; } };
}

// bankRow(parent, { getActive, setActive }) — A–H row, click selects.
// One row, tight, active bank glows (panel.css `.ff-bank.active`).
export function bankRow(parent, { getActive, setActive }) {
  const banks = document.createElement('div');
  banks.className = 'ff-banks';
  const els = new Map();
  for (const L of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
    const b = document.createElement('button');
    b.className = 'ff-bank';
    b.dataset.bank = L;
    b.textContent = L;
    b.title = `bank ${L}`;
    b.addEventListener('click', () => { setActive?.(L); sync(); });
    banks.appendChild(b);
    els.set(L, b);
  }
  parent.appendChild(banks);
  function sync() {
    const active = getActive?.() || 'A';
    for (const [L, b] of els) b.classList.toggle('active', L === active);
  }
  sync();
  return { sync };
}

// presetRow(parent, { getSlot, getGradient, onLoad, onSave, count=8 })
//
// 1..N preset slot grid (default 8). Click → onLoad(slot), shift-click → onSave(slot).
// getSlot(slot)     — return truthy if filled (any value)
// getGradient(slot) — optional, return CSS `background-image` value for a filled slot
//                     (use the main sim's `presetGradient` when wiring; or omit for
//                     a default warm sliver).
export function presetRow(parent, { getSlot, getGradient, onLoad, onSave, count = 8 }) {
  const grid = document.createElement('div');
  grid.className = 'ff-presets';
  const els = new Map();
  for (let i = 1; i <= count; i++) {
    const b = document.createElement('button');
    b.className = 'ff-preset';
    b.dataset.slot = String(i);
    b.innerHTML = `<span class="ff-preset-num">${i}</span>`;
    b.title = `slot ${i} — click load · shift-click save`;
    b.addEventListener('click', (e) => {
      if (e.shiftKey) onSave?.(i); else onLoad?.(i);
    });
    grid.appendChild(b);
    els.set(i, b);
  }
  parent.appendChild(grid);
  function sync() {
    for (const [i, b] of els) {
      const filled = !!getSlot?.(i);
      b.classList.toggle('filled', filled);
      // Either a caller-provided gradient OR a default warm sliver so
      // filled slots still LOOK filled even without per-slot art.
      const grad = filled
        ? (getGradient?.(i) ||
           'linear-gradient(180deg, rgba(255,138,58,0.32), rgba(255,138,58,0.10))')
        : '';
      b.style.backgroundImage = grad;
    }
  }
  sync();
  return { sync };
}

export { SEL_STYLE };
