// PINE WORKSHOP — same posture as src/workshop/palm/palmWorkshop.js.
// One species (Scots pine), the shared shell does all panel work, no
// preset slots, no JSON IO, no species selector. The whole purpose is
// fast iteration on one tree — palm formula, palm bar.

import * as THREE from 'three';
import '../../styles.css';
import '../../ui/panel.css';
import { FlyCameraDirector } from '../../camera/FlyCameraDirector.js';
import { PerfOverlay } from '../../ui/PerfOverlay.js';
import { section, sliderField, enumField, makeStatusFlasher, makePanelChrome, SEL_STYLE } from '../_shared/panelShell.js';
import { PINE_CLASS, classDefaults, makePine } from './model.js';

const host = document.getElementById('ws-canvas');
const ui = document.getElementById('ui-root');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x0c1612, 1);
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x14201c, 320, 760);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.4, 3000);
camera.position.set(0, 26, 96);
camera.lookAt(0, 13, 0);
const fly = new FlyCameraDirector(camera, renderer.domElement);

scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x46381f, 0.78));
const sun = new THREE.DirectionalLight(0xffe9c8, 1.4);
sun.position.set(120, 180, 80);
scene.add(sun);
scene.add(new THREE.AmbientLight(0xffffff, 0.12));

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x223226, roughness: 1, side: THREE.DoubleSide }));
ground.position.y = -0.02;
scene.add(ground);
const grid = new THREE.GridHelper(1600, 80, 0x2f5a3c, 0x1c3326);
grid.position.y = 0.01;
scene.add(grid);

// ---- variant matrix ------------------------------------------------------
//
// Tuning auto-persists to localStorage so vite reloads / browser refreshes
// don't wipe your slider work. The other agent restarts the dev server a
// lot — this is the difference between "I lost an hour of tuning" and
// "the panel comes back exactly where I left it".
//
// Schema is conservative: only the small surface of mutable state lives in
// localStorage. New params added to `classDefaults()` later are merged in
// at load time (forward-compat).
const STATE_KEY = 'pineWorkshop.state.v1';
const PINS_KEY = 'pineWorkshop.pins.v1';
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
    if (!s) return null;
    return s;
  } catch { return null; }
}
function loadPins() {
  try {
    const raw = JSON.parse(localStorage.getItem(PINS_KEY) || '[]');
    return Array.isArray(raw) ? new Set(raw) : new Set();
  } catch { return new Set(); }
}
function savePins() {
  try { localStorage.setItem(PINS_KEY, JSON.stringify([...pins])); }
  catch { /* private mode / quota — silent */ }
}
let saveTimer = null;
function saveState() {
  // debounced — slider drags fire many events per second; localStorage
  // is sync but ~1ms is still wasted work during a continuous drag.
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({
        axisParam: state.axisParam, gx: state.gx, gz: state.gz,
        seed: state.seed, overrides: state.overrides,
      }));
    } catch { /* private mode / quota — silent */ }
  }, 120);
}

const defaults = classDefaults();
const persisted = loadState();
const pins = loadPins();
const state = {
  axisParam: persisted?.axisParam || 'crownSkew',
  gx: persisted?.gx || 6,
  gz: persisted?.gz || 4,
  spacing: 22,
  seed: persisted?.seed || 1337,
  // merge persisted overrides ON TOP of fresh defaults so newly added
  // params (e.g. trunkVar, coneShape, pomTint) appear at their default
  // value instead of vanishing when an older save is loaded.
  overrides: { ...defaults, ...(persisted?.overrides || {}) },
};
// guard: if the persisted axisParam no longer exists, fall back.
if (!PINE_CLASS.params[state.axisParam]) state.axisParam = 'crownSkew';
let matrix = null;

// keep rebuild timing for the smoke gate. The panel reads it.
let lastRebuildMs = 0;

function treeTriStats() {
  const tris = (matrix?.children || []).map((g) => g.userData?.stats?.tris || 0);
  const total = tris.reduce((a, b) => a + b, 0);
  return {
    total,
    max: tris.length ? Math.max(...tris) : 0,
    mean: tris.length ? total / tris.length : 0,
  };
}

function rebuildMatrix() {
  const t0 = performance.now();
  if (matrix) {
    scene.remove(matrix);
    matrix.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  }
  matrix = new THREE.Group();
  const [min, max] = PINE_CLASS.params[state.axisParam];
  const x0 = -((state.gx - 1) * state.spacing) / 2;
  const z0 = -((state.gz - 1) * state.spacing) / 2;
  for (let ix = 0; ix < state.gx; ix++) {
    const v = state.gx === 1 ? (min + max) / 2 : min + (max - min) * (ix / (state.gx - 1));
    for (let iz = 0; iz < state.gz; iz++) {
      const m = makePine((state.seed + ix * 911 + iz * 2654435761) >>> 0,
        { ...state.overrides, [state.axisParam]: v });
      if (!m) continue;
      m.position.set(x0 + ix * state.spacing, 0, z0 + iz * state.spacing);
      matrix.add(m);
    }
  }
  scene.add(matrix);
  lastRebuildMs = performance.now() - t0;
  readout();
}

// ---- panel — sim grammar via shared shell --------------------------------
const panel = document.createElement('div');
panel.className = 'ff-panel';
panel.innerHTML =
  `<div class="ff-panel-header"><div class="ff-panel-status ok">pine workshop</div></div>
   <div class="ff-panel-body" id="ws-body"></div>`;
ui.appendChild(panel);
const body = panel.querySelector('#ws-body');
const statusEl = panel.querySelector('.ff-panel-status');
const flashStatus = makeStatusFlasher(statusEl, 'pine workshop');

const chrome = makePanelChrome(panel, body, {
  collapsed: true,
  hintsHtml: '<kbd>WASD</kbd> fly <kbd>Q/↑↓</kbd> alt <kbd>drag</kbd> look <kbd>H</kbd> panel <kbd>F</kbd> perf <kbd>R</kbd> randomize',
});
const togglePanel = chrome.toggle;

const perf = new PerfOverlay({
  scene: { renderer, get treeCount() { return matrix ? matrix.children.length : 0; } },
  rows: () => {
    const stats = treeTriStats();
    return [
      { key: 'treeTotal', label: 'tree tris', value: stats.total.toLocaleString() },
      { key: 'treeAvg', label: 'tri/tree', value: stats.mean.toFixed(0) },
    ];
  },
});
ui.appendChild(perf.root);
perf.toggle();

// ---- shared-shell wrapped slider --------------------------------------
const SEL = SEL_STYLE;
function pinApi(key, major = false) {
  return {
    major,
    has: () => pins.has(key),
    toggle: () => {
      if (pins.has(key)) pins.delete(key);
      else pins.add(key);
      savePins();
      saveState();
      return pins.has(key);
    },
  };
}
function isMajorPin(key) {
  return key === 'branchModel' || key === 'foliageModel'
    || ['height', 'trunkBaseR', 'trunkTopR', 'trunkBareFrac', 'trunkVar', 'branchCount', 'branchScale', 'branchWidth', 'branchTaper', 'coneShape'].includes(key);
}
function addSlider(parent, key, def, isAxis) {
  const [min, max] = PINE_CLASS.params[key];
  const meta = PINE_CLASS.meta[key] || {};
  sliderField(parent, {
    key, min, max, default: def, isAxis,
    label: meta.label, hint: meta.hint, unit: meta.unit,
    step: meta.step, isInt: meta.isInt, precision: meta.precision,
    sticky: pinApi(key, isMajorPin(key)),
    onChange: (v) => { state.overrides[key] = v; rebuildMatrix(); saveState(); },
  });
}
function addEnum(parent, key) {
  const spec = PINE_CLASS.enums[key];
  enumField(parent, {
    key, options: spec.options, value: state.overrides[key] ?? spec.default,
    label: spec.label, hint: spec.hint,
    onChange: (v) => { state.overrides[key] = v; rebuildMatrix(); saveState(); },
  });
  const row = parent.lastElementChild;
  if (row) {
    const name = row.querySelector('.ff-field-name');
    if (name) {
      const d = document.createElement('button');
      d.className = 'ff-sticky major' + (pins.has(key) ? ' on' : '');
      d.title = 'structural pin — R keeps this method';
      d.textContent = pins.has(key) ? '◆' : '◇';
      d.addEventListener('click', (e) => {
        e.stopPropagation();
        if (pins.has(key)) pins.delete(key);
        else pins.add(key);
        savePins();
        saveState();
        d.classList.toggle('on', pins.has(key));
        d.textContent = pins.has(key) ? '◆' : '◇';
      });
      name.prepend(d);
    }
  }
}

let axisSel;
function rebuildPanel() {
  body.innerHTML = '';

  // preview grid — single species (pine), so no species selector. Teal info accent.
  section(body, {
    icon: '▦', label: 'preview grid', blurb: 'sweep axis · seed rows',
    open: false, accent: 'info',
    build: (bx) => {
      const mk = (label, el) => {
        const f = document.createElement('div'); f.className = 'ff-field';
        f.innerHTML = `<div class="ff-field-label"><span class="ff-field-name">${label}</span></div>`;
        const c = document.createElement('div'); c.className = 'ff-field-control';
        c.appendChild(el); f.appendChild(c); bx.appendChild(f);
      };
      axisSel = document.createElement('select'); axisSel.style.cssText = SEL;
      for (const k of Object.keys(PINE_CLASS.params)) {
        const o = document.createElement('option'); o.value = k;
        const m = PINE_CLASS.meta[k];
        o.textContent = m?.label ? `${m.label} (${k})` : k;
        axisSel.appendChild(o);
      }
      axisSel.value = state.axisParam;
      axisSel.addEventListener('change', () => { state.axisParam = axisSel.value; rebuildPanel(); rebuildMatrix(); saveState(); });
      mk('preview X (sweep)', axisSel);
      const grid2 = document.createElement('div');
      grid2.style.cssText = 'display:flex;gap:8px';
      grid2.innerHTML =
        `<label style="flex:1;font-size:11px">X steps<input id="ws-gx" type="number" min="1" max="10" value="${state.gx}" style="${SEL}"></label>
         <label style="flex:1;font-size:11px">Z seeds<input id="ws-gz" type="number" min="1" max="8" value="${state.gz}" style="${SEL}"></label>`;
      mk('grid', grid2);
      grid2.querySelector('#ws-gx').addEventListener('change', (e) => { state.gx = Math.max(1, Math.min(10, +e.target.value | 0)); rebuildMatrix(); saveState(); });
      grid2.querySelector('#ws-gz').addEventListener('change', (e) => { state.gz = Math.max(1, Math.min(8, +e.target.value | 0)); rebuildMatrix(); saveState(); });
      // (UI buttons removed per user — R hotkey still randomizes; undo /
      // defaults are reachable from devtools via `window.pineWorkshop` if
      // needed during the handoff transition.)
      const ro = document.createElement('div'); ro.id = 'ws-readout';
      ro.style.cssText = 'font-size:10px;opacity:.7;white-space:pre-line;padding:2px 0';
      bx.appendChild(ro);
    },
  });

  for (const sec of PINE_CLASS.sections) {
    section(body, {
      icon: sec.icon, label: sec.label, blurb: sec.blurb,
      open: false, accent: sec.accent,
      build: (bx) => {
        for (const key of sec.enumKeys || []) {
          addEnum(bx, key);
        }
        for (const key of sec.keys || []) {
          const [, , def] = PINE_CLASS.params[key];
          addSlider(bx, key, state.overrides[key] ?? def, key === state.axisParam);
        }
      },
    });
  }
  readout();
}

function readout() {
  const el = panel.querySelector('#ws-readout');
  if (!el) return;
  const [min, max] = PINE_CLASS.params[state.axisParam];
  const triStats = treeTriStats();
  el.textContent =
    `seed ${state.seed}\n` +
    `methods ${state.overrides.branchModel} / ${state.overrides.foliageModel}\n` +
    `X = ${state.axisParam}: ${min} → ${max} (${state.gx})  ·  Z = ${state.gz} seeds\n` +
    `tree tris ${triStats.total.toLocaleString()} total · ${triStats.mean.toFixed(0)} avg · ${triStats.max} max\n` +
    `rebuild ${lastRebuildMs.toFixed(1)} ms · pinned ${pins.size}`;
}

// Pre-randomize snapshot — saved every time R fires so the user can ALWAYS
// step back to their tuned state. Lives in a separate localStorage key so
// it survives reloads too (you can randomize, close the browser, come
// back, and still hit "↺ restore" to recover what you had).
const UNDO_KEY = 'pineWorkshop.preRandom.v1';
function snapshotForUndo() {
  try {
    localStorage.setItem(UNDO_KEY, JSON.stringify({
      axisParam: state.axisParam, gx: state.gx, gz: state.gz,
      seed: state.seed, overrides: { ...state.overrides },
    }));
  } catch { /* private mode */ }
}
function hasUndo() {
  try { return !!localStorage.getItem(UNDO_KEY); } catch { return false; }
}
function restoreUndo() {
  try {
    const s = JSON.parse(localStorage.getItem(UNDO_KEY) || 'null');
    if (!s) return false;
    state.axisParam = s.axisParam || state.axisParam;
    state.gx = s.gx || state.gx;
    state.gz = s.gz || state.gz;
    state.seed = s.seed || state.seed;
    state.overrides = { ...classDefaults(), ...(s.overrides || {}) };
    if (!PINE_CLASS.params[state.axisParam]) state.axisParam = 'crownSkew';
    rebuildPanel();
    rebuildMatrix();
    saveState();
    return true;
  } catch { return false; }
}

// Full randomize across SAFE ranges (per-param `meta[k].rand`, narrower
// than the slider's full range so R doesn't roll into broken zones like
// trunkBareFrac=0.70). Also picks a new seed. Saves the pre-randomize
// state to UNDO_KEY first so the user can step back. Sticky pins mean
// "R skips this param" for the workshop tuning flow.
function randomize() {
  snapshotForUndo();
  let skipped = 0;
  let randomized = 0;
  for (const key of Object.keys(PINE_CLASS.params)) {
    if (pins.has(key)) { skipped++; continue; }
    const meta = PINE_CLASS.meta[key] || {};
    const fallback = PINE_CLASS.params[key];
    const [lo, hi] = meta.rand || [fallback[0], fallback[1]];
    let v = lo + Math.random() * (hi - lo);
    if (meta.isInt) v = Math.round(v);
    state.overrides[key] = v;
    randomized++;
  }
  state.seed = 1 + ((Math.random() * 99998) | 0);
  rebuildPanel();
  rebuildMatrix();
  saveState();
  return { randomized, skipped };
}

// Restore the baked-in defaults (which match the user's last "good"
// tuned screenshot — see model.js · params default values).
function restoreDefaults() {
  snapshotForUndo();    // also save current as undo target in case this
                        // wasn't what they wanted either
  state.overrides = classDefaults();
  pins.clear();
  savePins();
  rebuildPanel();
  rebuildMatrix();
  saveState();
}

rebuildPanel();
rebuildMatrix();

window.addEventListener('keydown', (e) => {
  // CMD/CTRL/ALT held: a modifier shortcut, NOT a workshop hotkey. The
  // big one we were stepping on is CMD+R (browser refresh) — it was
  // triggering our R-randomize before the page reloaded AND persisting
  // the random state, so the user could never refresh back to their
  // tuned shot. Skip on any modifier.
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  const k = e.key.toLowerCase();
  if (k === 'h' || k === 'b') { e.preventDefault(); togglePanel(); }
  else if (k === 'f') { e.preventDefault(); perf.toggle(); }
  else if (k === 'r') {
    e.preventDefault();
    const roll = randomize();
    flashStatus(roll.skipped ? `randomized · ${roll.skipped} pinned` : 'randomized');
  }
});

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let prev = performance.now();
(function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, ((now || prev) - prev) / 1000); prev = now || prev;
  fly.update(dt);
  renderer.render(scene, camera);
})(prev);

window.pineWorkshop = {
  scene, camera, renderer, fly, state, rebuildMatrix, PINE_CLASS,
  randomize, restoreUndo, restoreDefaults,
  pins,
  pin: (key) => { pins.add(key); savePins(); rebuildPanel(); saveState(); },
  unpin: (key) => { pins.delete(key); savePins(); rebuildPanel(); saveState(); },
  hasUndo,
  get lastRebuildMs() { return lastRebuildMs; },
};
