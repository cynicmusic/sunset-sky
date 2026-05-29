import * as THREE from 'three';
import '../../styles.css';
import '../../ui/panel.css';
import { FlyCameraDirector } from '../../camera/FlyCameraDirector.js';
import { PerfOverlay } from '../../ui/PerfOverlay.js';
import { section, sliderField, enumField, makeStatusFlasher, makePanelChrome, SEL_STYLE } from '../_shared/panelShell.js';
import { TREE_STYLES } from './model.js';

const host = document.getElementById('ws-canvas');
const ui = document.getElementById('ui-root');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x0b1511, 1);
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x12201a, 260, 680);
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.4, 3000);
camera.position.set(0, 34, 138);
camera.lookAt(0, 8, 0);
const fly = new FlyCameraDirector(camera, renderer.domElement);

scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x40331e, 0.78));
const sun = new THREE.DirectionalLight(0xffe1b4, 1.45);
sun.position.set(120, 170, 70);
scene.add(sun);
scene.add(new THREE.AmbientLight(0xffffff, 0.10));

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x1f3024, roughness: 1, side: THREE.DoubleSide }),
);
ground.position.y = -0.03;
scene.add(ground);
const grid = new THREE.GridHelper(1500, 75, 0x2e5538, 0x1a3023);
grid.position.y = 0.01;
scene.add(grid);

const STATE_KEY = 'treeMethodology.state.v1';
function loadState() {
  try { return JSON.parse(localStorage.getItem(STATE_KEY) || 'null'); }
  catch { return null; }
}
const saved = loadState();
const state = {
  seed: saved?.seed || 2401,
  variants: saved?.variants || 3,
  family: saved?.family || 'all',
  spacingX: saved?.spacingX || 18,
  spacingZ: saved?.spacingZ || 20,
  scale: saved?.scale || 1,
  labels: saved?.labels ?? 1,
};
let saveTimer = null;
function saveState() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); }
    catch { /* ignore private mode */ }
  }, 120);
}

let forest = null;
let lastRebuildMs = 0;
function visibleStyles() {
  return TREE_STYLES.filter((s) => state.family === 'all' || s.family === state.family);
}
function disposeObject(o) {
  o.traverse((child) => {
    child.geometry?.dispose();
    if (Array.isArray(child.material)) {
      for (const m of child.material) {
        m.map?.dispose();
        m.dispose?.();
      }
    } else {
      child.material?.map?.dispose?.();
      child.material?.dispose?.();
    }
  });
}
function treeStats() {
  const trees = forest?.children.filter((c) => c.userData?.styleId) || [];
  const total = trees.reduce((a, t) => a + (t.userData.tris || 0), 0);
  const max = trees.length ? Math.max(...trees.map((t) => t.userData.tris || 0)) : 0;
  return { trees: trees.length, total, mean: trees.length ? total / trees.length : 0, max };
}

function labelSprite(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 48;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(6, 16, 12, 0.72)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(47, 217, 200, 0.42)';
  ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
  ctx.font = '600 18px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(220, 238, 230, 0.92)';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(8.2, 1.55, 1);
  return sprite;
}

function rebuild() {
  const t0 = performance.now();
  if (forest) {
    scene.remove(forest);
    disposeObject(forest);
  }
  forest = new THREE.Group();
  const styles = visibleStyles();
  const cols = styles.length;
  const x0 = -((cols - 1) * state.spacingX) / 2;
  const z0 = -((state.variants - 1) * state.spacingZ) / 2;

  styles.forEach((style, ix) => {
    const x = x0 + ix * state.spacingX;
    for (let iz = 0; iz < state.variants; iz++) {
      const seed = (state.seed + ix * 10007 + iz * 2654435761) >>> 0;
      const tree = style.make(seed);
      tree.position.set(x, 0, z0 + iz * state.spacingZ);
      tree.scale.setScalar(state.scale);
      tree.rotation.y = (seed % 6283) / 1000;
      forest.add(tree);
    }
    if (state.labels) {
      const label = labelSprite(style.label);
      label.position.set(x, 0.9, z0 + state.variants * state.spacingZ * 0.5 + 4);
      forest.add(label);
    }
  });

  scene.add(forest);
  lastRebuildMs = performance.now() - t0;
  readout();
}

const panel = document.createElement('div');
panel.className = 'ff-panel';
panel.innerHTML =
  `<div class="ff-panel-header"><div class="ff-panel-status ok">tree methodology</div></div>
   <div class="ff-panel-body" id="ws-body"></div>`;
ui.appendChild(panel);
const body = panel.querySelector('#ws-body');
const statusEl = panel.querySelector('.ff-panel-status');
const flashStatus = makeStatusFlasher(statusEl, 'tree methodology');
const chrome = makePanelChrome(panel, body, {
  collapsed: true,
  hintsHtml: '<kbd>WASD</kbd> fly <kbd>Q/↑↓</kbd> alt <kbd>drag</kbd> look <kbd>H</kbd> panel <kbd>F</kbd> perf <kbd>R</kbd> seed',
});
const togglePanel = chrome.toggle;

const perf = new PerfOverlay({
  scene: { renderer, get treeCount() { return treeStats().trees; } },
  rows: () => {
    const s = treeStats();
    return [
      { key: 'treeTotal', label: 'tree tris', value: s.total.toLocaleString() },
      { key: 'treeAvg', label: 'tri/tree', value: s.mean.toFixed(0) },
    ];
  },
});
ui.appendChild(perf.root);
perf.toggle();

const SEL = SEL_STYLE;
let readoutEl = null;
function fieldWrap(parent, label, el) {
  const f = document.createElement('div');
  f.className = 'ff-field';
  f.innerHTML = `<div class="ff-field-label"><span class="ff-field-name">${label}</span></div>`;
  const c = document.createElement('div');
  c.className = 'ff-field-control';
  c.appendChild(el);
  f.appendChild(c);
  parent.appendChild(f);
}
function rebuildPanel() {
  body.innerHTML = '';
  section(body, {
    icon: '#', label: 'compare', blurb: 'seven visual languages', open: true, accent: 'info',
    build: (bx) => {
      enumField(bx, {
        key: 'family',
        label: 'Set',
        hint: 'show all, pine only, or deciduous only',
        value: state.family,
        options: [
          { value: 'all', label: 'all 7 styles' },
          { value: 'pine', label: 'pine 3 styles' },
          { value: 'deciduous', label: 'deciduous 4 styles' },
        ],
        onChange: (v) => { state.family = v; rebuild(); saveState(); },
      });
      sliderField(bx, {
        key: 'variants', min: 1, max: 4, default: state.variants, isInt: true,
        label: 'Variants', hint: 'seed rows per style',
        onChange: (v) => { state.variants = v | 0; rebuild(); saveState(); },
      });
      sliderField(bx, {
        key: 'scale', min: 0.65, max: 1.35, default: state.scale, step: 0.01,
        label: 'Scale', hint: 'same scalar applied to every tree',
        onChange: (v) => { state.scale = v; rebuild(); saveState(); },
      });
      sliderField(bx, {
        key: 'spacingX', min: 12, max: 26, default: state.spacingX, step: 0.5,
        label: 'Column spacing', hint: 'space between style columns',
        onChange: (v) => { state.spacingX = v; rebuild(); saveState(); },
      });
      const seedInput = document.createElement('input');
      seedInput.type = 'number';
      seedInput.value = String(state.seed);
      seedInput.style.cssText = SEL;
      seedInput.addEventListener('change', () => {
        state.seed = Math.max(1, Number(seedInput.value) | 0);
        rebuild();
        saveState();
      });
      fieldWrap(bx, 'Seed', seedInput);
      const labels = document.createElement('select');
      labels.style.cssText = SEL;
      labels.innerHTML = '<option value="1">labels on</option><option value="0">labels off</option>';
      labels.value = String(state.labels ? 1 : 0);
      labels.addEventListener('change', () => {
        state.labels = Number(labels.value) ? 1 : 0;
        rebuild();
        saveState();
      });
      fieldWrap(bx, 'Nameplates', labels);
      readoutEl = document.createElement('div');
      readoutEl.id = 'method-readout';
      readoutEl.style.cssText = 'font-size:10px;opacity:.72;white-space:pre-line;padding:2px 0';
      bx.appendChild(readoutEl);
    },
  });
  section(body, {
    icon: '*', label: 'styles', blurb: 'current candidate list', open: false, accent: 'flora',
    build: (bx) => {
      const list = document.createElement('div');
      list.style.cssText = 'font:10px var(--font-mono);line-height:1.55;color:rgba(220,238,230,.74);white-space:pre-line';
      list.textContent = TREE_STYLES.map((s, i) => `${i + 1}. ${s.label}`).join('\n');
      bx.appendChild(list);
    },
  });
  readout();
}

function readout() {
  if (!readoutEl) return;
  const s = treeStats();
  readoutEl.textContent =
    `seed ${state.seed}\n` +
    `styles ${visibleStyles().length} · trees ${s.trees}\n` +
    `tree tris ${s.total.toLocaleString()} total · ${s.mean.toFixed(0)} avg · ${s.max} max\n` +
    `rebuild ${lastRebuildMs.toFixed(1)} ms`;
}

rebuildPanel();
rebuild();

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  const k = e.key.toLowerCase();
  if (k === 'h' || k === 'b') { e.preventDefault(); togglePanel(); }
  else if (k === 'f') { e.preventDefault(); perf.toggle(); }
  else if (k === 'r') {
    e.preventDefault();
    state.seed = 1 + ((Math.random() * 99998) | 0);
    rebuildPanel();
    rebuild();
    saveState();
    flashStatus(`seed ${state.seed}`);
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
  const dt = Math.min(0.05, ((now || prev) - prev) / 1000);
  prev = now || prev;
  fly.update(dt);
  renderer.render(scene, camera);
})(prev);

window.treeMethodology = {
  scene, camera, renderer, state, rebuild, TREE_STYLES,
  stats: treeStats,
};
