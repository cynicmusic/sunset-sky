// Tree-lab contact sheet. Clean rewrite.
//   1. Black scene + black page. No green-tint inheritance from any other workshop.
//   2. Canvas display CSS size = viewport size on load (you see all 96 trees).
//   3. Canvas backing buffer is large (BUFFER_W) so browser zoom (Cmd+=) grows
//      the page cleanly and you scroll to see detail.
//   4. Camera angles set so the trees fill the visible area edge-to-edge.
//   5. Cell overlay = uniform-spaced rectangles, derived from camera projection
//      of grid steps (no per-tree probing, no drift between rows).

import * as THREE from 'three';
import { buildSlots, makeLabTree, GRID } from './treeLabModel.js';
import { makeTreeStyle } from '../methodology/model.js';

// Slot → methodology style overrides.
const METHODOLOGY_OVERRIDES = {
  // Row 2 (21-24) + Row 3 (25-28): variants of methodology 4 / 5 / 8
  21: 'pine-sparse-scots',
  22: 'pine-sparse-scots',
  23: 'pine-sparse-scots',
  24: 'decid-limb-chunks',
  25: 'decid-limb-chunks',
  26: 'decid-limb-chunks',
  27: 'decid-winter-skeleton',
  28: 'decid-winter-skeleton',
  // Three "more like 87/88" variants planted in lab rows for comparison.
  52: 'pine-fins-on-skeleton', // autumn ember palette
  58: 'pine-fins-on-skeleton', // blue spruce / winter skeleton
  60: 'pine-fins-on-skeleton', // stacked mini-fins per tip
  // Row 8 (65-72): four pine-tiered-plates + four pine-tiered-plates-alt
  65: 'pine-tiered-plates',
  66: 'pine-tiered-plates',
  67: 'pine-tiered-plates',
  68: 'pine-tiered-plates-alt', // darker spruce + bluer palette
  69: 'pine-tiered-plates-alt',
  70: 'pine-tiered-plates-alt',
  71: 'pine-tiered-plates-alt',
  72: 'pine-tiered-plates-alt',
  // Row 10 (81-88): pine-silhouette-shell + blue variants + new fins-on-skeleton hybrid
  81: 'pine-silhouette-shell',
  82: 'pine-silhouette-shell',
  83: 'pine-silhouette-shell',
  84: 'pine-silhouette-shell-blue',
  85: 'pine-silhouette-shell-blue',
  86: 'pine-silhouette-shell-blue',
  87: 'pine-fins-on-skeleton',
  88: 'pine-fins-on-skeleton',
  // 89-96 left blank for incoming palms.
};

// Per-slot seed overrides. Re-rolls swap the seed so the deterministic
// generator picks a different variation. For pine-tiered-plates-alt, the
// palette is keyed by seed % 3 — values 0 = blue/teal, 1 = yellow, 2 = green.
const SEED_OVERRIDES = {
  3: 1003,
  5: 1005,
  7: 7007,
  8: 8008,
  50: 5050,
  51: 5151,
  // 52, 58, 60 are now methodology hybrids — their lab-side re-rolls retired.
  66: 1066,
  68: 168,    // 168 % 3 == 0 → PINE2_PALETTES[0] (dark teal-blue)
};

// Per-slot params passed to methodology generators. Methodology functions
// that accept opts (currently pineTieredPlates and pineFinsOnSkeleton) use
// these to override palette + tweakable parameters per slot.
const SLOT_PARAMS = {
  // Slot 52: "autumn ember" fins-on-skeleton — warm dark→orange→yellow ramp.
  52: {
    palette: {
      dark: [0.16, 0.035, 0.018],
      mid:  [0.76, 0.30, 0.08],
      lite: [1.00, 0.78, 0.22],
    },
    finScale: 1.08,
    limbCount: 7,
  },
  // Slot 58: cool blue spruce variant — winter trunk, smaller droopier fins,
  // navy → mid-blue → pale ice palette.
  58: {
    palette: {
      dark: [0.010, 0.022, 0.058],
      mid:  [0.055, 0.155, 0.330],
      lite: [0.42, 0.62, 0.72],
    },
    winter: true,
    finScale: 0.78,
    finDrop: 1.18,
    limbCount: 6,
  },
  // Slot 60: stacked mini-fins — every branch tip gets a 3-plate mini cone
  // climbing upward (looks like a tiny pine sitting on each branch).
  60: {
    finsPerTip: 3,
    finScale: 0.6,
    finDrop: 0.72,
    limbCount: 8,
  },
  // Slot 82: fatter silhouette cards.
  82: {
    widthMul: 1.30,
  },
  // Slot 85: fatter cards AND stocky base — trunk almost twice as wide and
  // the canopy pulled down so the silhouette reads as a chubby spruce.
  85: {
    widthMul: 1.35,
    baseRadiusMul: 1.85,
    yLiftMul: 0.84,
  },
  // Slot 66: lime-green tip with the bottom rung pushed visibly darker.
  66: {
    palette: {
      dark: [0.006, 0.040, 0.022],
      mid:  [0.110, 0.345, 0.205],
      lite: [0.86, 1.00, 0.22],
    },
    lowTierDark: 0.42,
  },
  // Slot 67: keep the default palette but pull some petals on the bottom
  // two rungs noticeably darker (mottled, not uniform).
  67: {
    lowTierDark: 0.40,
    lowTierDarkProb: 0.55,
  },
};

const sheetEl = document.getElementById('sheet');
const overlay = document.getElementById('cell-overlay');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 1);
sheetEl.appendChild(renderer.domElement);
renderer.domElement.id = 'ws-canvas-el';

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xd7f4ff, 0x332814, 0.82));
const sun = new THREE.DirectionalLight(0xffe0a8, 1.35);
sun.position.set(80, 140, 90);
scene.add(sun);
scene.add(new THREE.AmbientLight(0xffffff, 0.10));

// Ground plane is the raycaster target for click navigation. Sized big enough
// to cover any reasonable grid spacing, and Basic-material black so it matches
// the renderer clear color exactly (no faint hemisphere tint giving the grid
// a visible rectangle).
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide }),
);
ground.position.y = -0.04;
scene.add(ground);

// Camera position scaled for the doubled-twice vertical spacing — grid now
// extends to z=±288, so the original (0, 92, 108) sat IN FRONT of the
// front-most rows and Three.js culled their sprites for being behind the
// camera. Pulled back proportionally; lookAt target stays at the origin.
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
camera.position.set(0, 320, 380);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);

const { COLS, TOTAL_ROWS } = GRID;

// Trees in lab models are ~14 tall at native scale; bumping 4× makes the
// canopy ~56 tall, comparable to the 48-unit vertical spacing so trees
// dominate the grid the way trees should.
const TREE_SCALE = 3;

const slots = buildSlots();
// Apply methodology overrides + per-slot seed overrides.
for (const spec of slots) {
  const style = METHODOLOGY_OVERRIDES[spec.index];
  if (style) {
    spec.blank = false;
    spec.methodology = style;
    spec.seed = SEED_OVERRIDES[spec.index] ?? spec.index;
  } else if (SEED_OVERRIDES[spec.index] != null) {
    spec.seed = SEED_OVERRIDES[spec.index];
  }
}

const trees = [];
for (const spec of slots) {
  if (spec.blank) continue;
  const tree = spec.methodology
    ? makeTreeStyle(spec.methodology, spec.seed, SLOT_PARAMS[spec.index])
    : makeLabTree(spec);
  tree.userData.spec = spec;
  tree.rotation.y = ((spec.seed % 6283) / 1000) + spec.col * 0.16;
  tree.scale.setScalar(TREE_SCALE);
  scene.add(tree);
  trees.push(tree);
}

// Slot label = 1..96, top-left to bottom-right (matches spec.index).
function slotLabel(spec) {
  return String(spec.index);
}

// Address labels are 3D floor decals — small textured planes lying flat at
// each slot's tree base. Because they live in the scene, they zoom/pan with
// the camera and can never overlap (each one has its own world position).
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function makeAddressSprite(text, blank) {
  // Square texture — the badge sits tight around 1–2-digit numbers instead
  // of leaving 3× empty padding to the sides.
  const W = 128; const H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = blank ? 'rgba(14,18,20,0.55)' : 'rgba(10,16,18,0.86)';
  roundRect(ctx, 6, 6, W - 12, H - 12, 24);
  ctx.fill();
  ctx.strokeStyle = blank ? 'rgba(150,185,195,0.24)' : 'rgba(210,235,240,0.5)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = blank ? 'rgba(180,210,220,0.7)' : 'rgba(232,248,252,1)';
  ctx.font = `${blank ? 600 : 800} 78px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, W / 2, H / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.center.set(1, 1); // world position = sprite TOP-RIGHT corner; badge sits to the upper-LEFT of the anchor point
  sprite.renderOrder = 1;
  sprite.frustumCulled = false;
  sprite.raycast = () => {}; // ground handles clicks
  return sprite;
}

const labels = slots.map((spec) => {
  const sprite = makeAddressSprite(slotLabel(spec), !!spec.blank);
  sprite.userData.spec = spec;
  scene.add(sprite);
  return sprite;
});

const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);

let curX0 = 0; let curZ0 = 0;
let curSX = 13; let curSZ = 12;

function positionTrees(spacingX, spacingZ) {
  curSX = spacingX; curSZ = spacingZ;
  curX0 = -((COLS - 1) * spacingX) / 2;
  curZ0 = -((TOTAL_ROWS - 1) * spacingZ) / 2;
  for (const tree of trees) {
    const spec = tree.userData.spec;
    tree.position.set(curX0 + spec.col * spacingX, 0, curZ0 + spec.row * spacingZ);
    tree.updateMatrixWorld(true);
  }
  positionLabels();
  return { x0: curX0, z0: curZ0 };
}

// Square label — fits 1–2 digit numbers tightly.
const LABEL_W = 8;
const LABEL_H = 8;
// Anchor point on each tree: upper-left corner of the canopy. Sprite hangs
// off this anchor going UP-LEFT (badge sits outside the tree, not on the
// foliage).
const TREE_TOP_Y_WORLD = 14 * TREE_SCALE;
const TREE_CANOPY_HALF_X = 4 * TREE_SCALE;

function positionLabels() {
  for (const label of labels) {
    const spec = label.userData.spec;
    label.position.set(
      curX0 + spec.col * curSX - TREE_CANOPY_HALF_X,
      TREE_TOP_Y_WORLD,
      curZ0 + spec.row * curSZ,
    );
    label.scale.set(LABEL_W, LABEL_H, 1);
  }
}

const _vert = new THREE.Vector3();
function computeBounds() {
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  // Tree vertices — active row mesh extent.
  for (const tree of trees) {
    tree.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        _vert.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).sub(camera.position);
        const sx = _vert.dot(camRight); const sy = _vert.dot(camUp);
        if (sx < minX) minX = sx;
        if (sx > maxX) maxX = sx;
        if (sy < minY) minY = sy;
        if (sy > maxY) maxY = sy;
      }
    });
  }
  // All 96 cell footprints at ground — so blank rows are framed in too.
  const hx = curSX / 2; const hz = curSZ / 2;
  for (const spec of slots) {
    const wx = curX0 + spec.col * curSX;
    const wz = curZ0 + spec.row * curSZ;
    for (const dx of [-hx, hx]) {
      for (const dz of [-hz, hz]) {
        _vert.set(wx + dx, 0, wz + dz).sub(camera.position);
        const sx = _vert.dot(camRight); const sy = _vert.dot(camUp);
        if (sx < minX) minX = sx;
        if (sx > maxX) maxX = sx;
        if (sy < minY) minY = sy;
        if (sy > maxY) maxY = sy;
      }
    }
  }
  return { minX, maxX, minY, maxY };
}

function projectGround(wx, wz, w, h) {
  const ndc = new THREE.Vector3(wx, 0, wz).project(camera);
  return {
    x: (ndc.x * 0.5 + 0.5) * w,
    y: (-ndc.y * 0.5 + 0.5) * h,
  };
}

// Stretching the canvas (frustum aspect ≠ viewport aspect) made canopies
// overlap on wide viewports. Instead: vary tree SPACING so the projected
// grid's aspect matches the viewport aspect — content fills edge-to-edge
// with no stretch and even gaps between trees. Spacings re-derived on
// every resize (browser zoom included).
const MIN_SPACING_X = 11;
const MIN_SPACING_Z = 10;
const BASE_SPACING_X = 13;
const BASE_SPACING_Z = 48;

function fitSpacings(vAspect) {
  let sx = BASE_SPACING_X; let sz = BASE_SPACING_Z;
  // Probe baseline → decide which axis to expand.
  positionTrees(sx, sz);
  let b = computeBounds();
  let cAspect = (b.maxX - b.minX) / (b.maxY - b.minY);

  if (vAspect >= cAspect) {
    // Viewport wider than baseline → expand X spacing.
    for (let i = 0; i < 5; i++) {
      sx *= vAspect / cAspect;
      positionTrees(sx, sz);
      b = computeBounds();
      cAspect = (b.maxX - b.minX) / (b.maxY - b.minY);
      if (Math.abs(cAspect / vAspect - 1) < 0.003) break;
    }
  } else {
    // Viewport narrower than baseline → expand Z spacing (camera tilt
    // dampens projected Z, so this converges in a few iterations too).
    for (let i = 0; i < 5; i++) {
      sz *= cAspect / vAspect;
      positionTrees(sx, sz);
      b = computeBounds();
      cAspect = (b.maxX - b.minX) / (b.maxY - b.minY);
      if (Math.abs(cAspect / vAspect - 1) < 0.003) break;
    }
  }
  if (sx < MIN_SPACING_X) sx = MIN_SPACING_X;
  if (sz < MIN_SPACING_Z) sz = MIN_SPACING_Z;
  positionTrees(sx, sz);
  return { sx, sz };
}

// Base frustum (no zoom) captured per relayout. Wheel zoom multiplies it
// and pans toward the cursor.
let base = { cx: 0, cy: 0, halfW: 1, halfH: 1 };
let zoomLevel = 1;
let panX = 0; let panY = 0;

function applyCamera() {
  const halfW = base.halfW / zoomLevel;
  const halfH = base.halfH / zoomLevel;
  const cx = base.cx + panX;
  const cy = base.cy + panY;
  camera.left = cx - halfW;
  camera.right = cx + halfW;
  camera.top = cy + halfH;
  camera.bottom = cy - halfH;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

function relayout() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const vAspect = w / h;

  fitSpacings(vAspect);

  // Reset zoom on resize. The base frustum reflects the fitted edge-to-edge view.
  zoomLevel = 1; panX = 0; panY = 0;
  const b = computeBounds();
  base = {
    cx: (b.minX + b.maxX) / 2,
    cy: (b.minY + b.maxY) / 2,
    halfW: (b.maxX - b.minX) / 2,
    halfH: (b.maxY - b.minY) / 2,
  };

  renderer.setSize(w, h, false);
  renderer.domElement.style.width = `${w}px`;
  renderer.domElement.style.height = `${h}px`;
  sheetEl.style.width = `${w}px`;
  sheetEl.style.height = `${h}px`;
  if (overlay) { overlay.style.width = `${w}px`; overlay.style.height = `${h}px`; }

  applyCamera();
}

relayout();
window.addEventListener('resize', relayout);

// Trackpad two-finger scroll / mouse wheel → cursor-centered zoom. Browser
// page-zoom won't reflow the canvas (we sized to viewport), so this is the
// primary zoom UI. Listen at the sheet (parent of canvas + overlay) so
// wheel events bubble up even when the cursor is over a clickable cell.
sheetEl.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = renderer.domElement.getBoundingClientRect();
  const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

  const halfWnow = (camera.right - camera.left) / 2;
  const halfHnow = (camera.top - camera.bottom) / 2;
  const cxNow = (camera.left + camera.right) / 2;
  const cyNow = (camera.top + camera.bottom) / 2;
  const worldX = cxNow + nx * halfWnow;
  const worldY = cyNow + ny * halfHnow;

  const factor = Math.exp(-e.deltaY * 0.0015);
  zoomLevel = Math.max(0.5, Math.min(zoomLevel * factor, 24));

  const newHalfW = base.halfW / zoomLevel;
  const newHalfH = base.halfH / zoomLevel;
  panX = (worldX - nx * newHalfW) - base.cx;
  panY = (worldY - ny * newHalfH) - base.cy;

  applyCamera();
}, { passive: false });

// Click-drag to pan. Tracked at window level so dragging off-canvas keeps
// working. Below the drag threshold (4px) the gesture stays a click — so
// cells still navigate to /inspect on simple click.
const DRAG_THRESHOLD = 4;
let dragState = null;
let suppressNextClick = false;

sheetEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  dragState = { x: e.clientX, y: e.clientY, moved: false, pointerId: e.pointerId };
});

window.addEventListener('pointermove', (e) => {
  if (!dragState) return;
  const dx = e.clientX - dragState.x;
  const dy = e.clientY - dragState.y;
  if (!dragState.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
    dragState.moved = true;
    sheetEl.classList.add('dragging');
  }
  if (!dragState.moved) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const halfW = (camera.right - camera.left) / 2;
  const halfH = (camera.top - camera.bottom) / 2;
  panX -= dx * (halfW * 2) / w;
  panY += dy * (halfH * 2) / h;
  dragState.x = e.clientX;
  dragState.y = e.clientY;
  applyCamera();
});

window.addEventListener('pointerup', () => {
  if (!dragState) return;
  if (dragState.moved) suppressNextClick = true;
  dragState = null;
  sheetEl.classList.remove('dragging');
});

// Raycast click → navigate. Cast a ray from cursor through the orthographic
// camera, snap the ground hit to the nearest slot, and jump to /inspect.
// Drag gestures suppress this so panning never opens an inspect tab.
const raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();

sheetEl.addEventListener('click', (e) => {
  if (suppressNextClick) {
    suppressNextClick = false;
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const rect = renderer.domElement.getBoundingClientRect();
  _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  _ndc.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
  raycaster.setFromCamera(_ndc, camera);
  const hits = raycaster.intersectObject(ground, false);
  if (!hits.length) return;
  const p = hits[0].point;
  const col = Math.round((p.x - curX0) / curSX);
  const row = Math.round((p.z - curZ0) / curSZ);
  if (col < 0 || col >= COLS || row < 0 || row >= TOTAL_ROWS) return;
  const slotIdx = row * COLS + col + 1;
  const spec = slots[slotIdx - 1];
  if (!spec || spec.blank) return;
  window.location.href = `./inspect.html?slot=${slotIdx}`;
});

function tick() {
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

window.treeLab = { scene, camera, renderer, slots };
