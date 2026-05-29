// PALM WORKSHOP — standalone tuning rig for the locked Weber-Penn palm.
// Reuses the sim's panel grammar via `src/workshop/_shared/panelShell.js`
// + `src/ui/panel.css` so the panel renders IDENTICALLY to the main sim
// (colour rails per section, gradient labels, ff-slider track, italic
// hints, units). styles.css MUST be imported BEFORE panel.css so the
// CSS custom props (--accent-soft, --track, --bg-glass, --font-mono…)
// are defined; otherwise the panel falls back to a serif-no-track
// "old netscape" look.
//
// The workshop is intentionally bare: ONE species (palm), a parameter
// matrix of variants (X = swept param, Z = seed seeds), no preset
// slots, no JSON IO. Tuning that needs to survive a reload lives in
// the codebase (palmReal.js for the sim, this models.js for the rig).
// Headless contact-sheets are the share medium.

import * as THREE from 'three';
import '../../styles.css';
import '../../ui/panel.css';
import { FlyCameraDirector } from '../../camera/FlyCameraDirector.js';
import { PerfOverlay } from '../../ui/PerfOverlay.js';
import { section, sliderField, makeStatusFlasher, makePanelChrome, SEL_STYLE } from '../_shared/panelShell.js';
import { PALM_CLASS, classDefaults, makePalm } from './models.js';

const host = document.getElementById('ws-canvas');
const ui = document.getElementById('ui-root');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x0d1410, 1);
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x12201c, 320, 720);
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.4, 3000);
camera.position.set(0, 24, 92);
camera.lookAt(0, 13, 0);
const fly = new FlyCameraDirector(camera, renderer.domElement);

scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x46381f, 0.75));
const sun = new THREE.DirectionalLight(0xffe9c8, 1.45);
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
const state = {
  axisParam: 'droop', gx: 6, gz: 4, spacing: 22,
  seed: 1337, overrides: classDefaults(),
};
let matrix = null;

function rebuildMatrix() {
  if (matrix) {
    scene.remove(matrix);
    matrix.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  }
  matrix = new THREE.Group();
  const [min, max] = PALM_CLASS.params[state.axisParam];
  const x0 = -((state.gx - 1) * state.spacing) / 2;
  const z0 = -((state.gz - 1) * state.spacing) / 2;
  for (let ix = 0; ix < state.gx; ix++) {
    const v = state.gx === 1 ? (min + max) / 2 : min + (max - min) * (ix / (state.gx - 1));
    for (let iz = 0; iz < state.gz; iz++) {
      const m = makePalm((state.seed + ix * 911 + iz * 2654435761) >>> 0,
        { ...state.overrides, [state.axisParam]: v });
      if (!m) continue;
      m.position.set(x0 + ix * state.spacing, 0, z0 + iz * state.spacing);
      matrix.add(m);
    }
  }
  scene.add(matrix);
  readout();
}

// ---- panel — sim grammar via shared shell --------------------------------
const panel = document.createElement('div');
panel.className = 'ff-panel';
panel.innerHTML =
  `<div class="ff-panel-header"><div class="ff-panel-status ok">palm workshop</div></div>
   <div class="ff-panel-body" id="ws-body"></div>`;
ui.appendChild(panel);
const body = panel.querySelector('#ws-body');
const statusEl = panel.querySelector('.ff-panel-status');
const flashStatus = makeStatusFlasher(statusEl, 'palm workshop');

// handle (◧) + hint strip + collapse — shared shell. Boots COLLAPSED (sim
// parity); the chrome owns the panel-class + handle-class + hints-class
// toggles so the FIRST click on the handle flips reality correctly.
const chrome = makePanelChrome(panel, body, {
  collapsed: true,
  hintsHtml: '<kbd>WASD</kbd> fly <kbd>Q/↑↓</kbd> alt <kbd>drag</kbd> look <kbd>H</kbd> panel <kbd>F</kbd> perf',
});
const togglePanel = chrome.toggle;

// PerfOverlay reused verbatim from the sim — tri / draw / fps + tree count.
const perf = new PerfOverlay({ scene: { renderer, get treeCount() { return matrix ? matrix.children.length : 0; } } });
ui.appendChild(perf.root);
perf.toggle();                                  // workshop: show it by default

// --- shared-shell wrapped slider — adds the workshop's onChange + meta ----
const SEL = SEL_STYLE;
function addSlider(parent, key, def, isAxis) {
  const [min, max] = PALM_CLASS.params[key];
  const meta = PALM_CLASS.meta[key] || {};
  sliderField(parent, {
    key, min, max, default: def, isAxis,
    label: meta.label, hint: meta.hint, unit: meta.unit,
    step: meta.step, isInt: meta.isInt, precision: meta.precision,
    onChange: (v) => { state.overrides[key] = v; rebuildMatrix(); },
  });
}

let axisSel;
function rebuildPanel() {
  body.innerHTML = '';

  // matrix — sweep axis + grid. ONE species only (palm), so no species
  // selector. Teal "info" accent so this group reads as metadata not a
  // parameter category. Sections all start CLOSED on reload (sim parity).
  section(body, {
    icon: '▦', label: 'matrix', blurb: 'sweep axis · grid',
    open: false, accent: 'info',
    build: (bx) => {
      const mk = (label, el) => {
        const f = document.createElement('div'); f.className = 'ff-field';
        f.innerHTML = `<div class="ff-field-label"><span class="ff-field-name">${label}</span></div>`;
        const c = document.createElement('div'); c.className = 'ff-field-control';
        c.appendChild(el); f.appendChild(c); bx.appendChild(f);
      };
      axisSel = document.createElement('select'); axisSel.style.cssText = SEL;
      for (const k of Object.keys(PALM_CLASS.params)) {
        const o = document.createElement('option'); o.value = k;
        const m = PALM_CLASS.meta[k];
        o.textContent = m?.label ? `${m.label} (${k})` : k;
        axisSel.appendChild(o);
      }
      axisSel.value = state.axisParam;
      axisSel.addEventListener('change', () => { state.axisParam = axisSel.value; rebuildPanel(); rebuildMatrix(); });
      mk('matrix X (sweep)', axisSel);
      const grid2 = document.createElement('div');
      grid2.style.cssText = 'display:flex;gap:8px';
      grid2.innerHTML =
        `<label style="flex:1;font-size:11px">X steps<input id="ws-gx" type="number" min="1" max="10" value="${state.gx}" style="${SEL}"></label>
         <label style="flex:1;font-size:11px">Z seeds<input id="ws-gz" type="number" min="1" max="8" value="${state.gz}" style="${SEL}"></label>`;
      mk('grid', grid2);
      grid2.querySelector('#ws-gx').addEventListener('change', (e) => { state.gx = Math.max(1, Math.min(10, +e.target.value | 0)); rebuildMatrix(); });
      grid2.querySelector('#ws-gz').addEventListener('change', (e) => { state.gz = Math.max(1, Math.min(8, +e.target.value | 0)); rebuildMatrix(); });
      const rb = document.createElement('button');
      rb.className = 'ff-btn ff-mini'; rb.textContent = 'reseed variants';
      rb.style.cssText = 'width:100%;margin-top:6px;';
      rb.addEventListener('click', () => { state.seed = 1 + ((Math.random() * 99998) | 0); rebuildMatrix(); });
      mk('', rb);
      const ro = document.createElement('div'); ro.id = 'ws-readout';
      ro.style.cssText = 'font-size:10px;opacity:.7;white-space:pre-line;padding:2px 0';
      bx.appendChild(ro);
    },
  });

  // categorized palm-param sections — closed on load (sim grammar).
  for (const sec of PALM_CLASS.sections) {
    section(body, {
      icon: sec.icon, label: sec.label, blurb: sec.blurb,
      open: false, accent: sec.accent,
      build: (bx) => {
        for (const key of sec.keys) {
          const [, , def] = PALM_CLASS.params[key];
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
  const [min, max] = PALM_CLASS.params[state.axisParam];
  el.textContent = `seed ${state.seed}\nX = ${state.axisParam}: ${min} → ${max} (${state.gx})  ·  Z = ${state.gz} seeds`;
}

rebuildPanel();
rebuildMatrix();

window.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  const k = e.key.toLowerCase();
  if (k === 'h' || k === 'b') { e.preventDefault(); togglePanel(); }
  else if (k === 'f') { e.preventDefault(); perf.toggle(); }
  else if (k === 'r') {
    e.preventDefault();
    state.seed = 1 + ((Math.random() * 99998) | 0); rebuildMatrix();
    flashStatus(`reseeded · ${state.seed}`);
  }
});

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let prev = performance.now(), tSway = 0;
(function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, ((now || prev) - prev) / 1000); prev = now || prev;
  tSway += dt;
  fly.update(dt);
  if (matrix) for (const g of matrix.children) {
    const s = g.userData.sway; if (!s) continue;
    const ang = Math.sin(tSway * s.speed + s.phase) * s.amp;
    if (s.crown) { s.crown.rotation.z = ang; s.crown.rotation.x = ang * 0.5; }
    g.rotation.z = ang * 0.25;
  }
  renderer.render(scene, camera);
})(prev);

window.palmWorkshop = { scene, state, rebuildMatrix, PALM_CLASS };
