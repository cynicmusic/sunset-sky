// Pure tree-lab model — lane definitions, builders, season icons, and the
// makeLabTree(spec) generator. No DOM, no renderer, no top-level side effects,
// so both the contact-sheet renderer and the single-tree inspect page can pull
// from one source of truth.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../gen/noise.js';

const YUP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _roll = new THREE.Quaternion();
const _d = new THREE.Vector3();
const _s = new THREE.Vector3();

const nonIndexed = (geometry) => geometry.index ? geometry.toNonIndexed() : geometry;
const CYL = nonIndexed(new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1, false));
const CARD = nonIndexed(new THREE.PlaneGeometry(1, 1));
const OCT = nonIndexed(new THREE.OctahedronGeometry(0.5, 0));
const BOX = nonIndexed(new THREE.BoxGeometry(1, 1, 1));
for (const g of [CYL, CARD, OCT, BOX]) g.deleteAttribute('uv');

export const SUN_AZ = -0.68;
export const BARK_LOW = [0.14, 0.09, 0.065];
export const BARK_HIGH = [0.50, 0.31, 0.18];
export const BARK_GREY = [0.34, 0.31, 0.27];
export const PALETTES = [
  { name: 'deep',   dark: [0.035, 0.13, 0.055], mid: [0.24, 0.48, 0.16], lite: [0.72, 0.82, 0.24] },
  { name: 'lime',   dark: [0.025, 0.16, 0.060], mid: [0.31, 0.60, 0.14], lite: [0.86, 0.96, 0.19] },
  { name: 'blue',   dark: [0.028, 0.12, 0.12],  mid: [0.18, 0.42, 0.32], lite: [0.63, 0.86, 0.54] },
  { name: 'spring', dark: [0.050, 0.17, 0.045], mid: [0.36, 0.62, 0.18], lite: [0.92, 0.98, 0.28] },
  { name: 'gold',   dark: [0.15, 0.095, 0.025], mid: [0.58, 0.42, 0.08], lite: [1.00, 0.78, 0.16] },
  { name: 'rust',   dark: [0.18, 0.060, 0.030], mid: [0.64, 0.22, 0.08], lite: [0.98, 0.56, 0.12] },
  { name: 'maple',  dark: [0.20, 0.055, 0.075], mid: [0.72, 0.14, 0.12], lite: [1.00, 0.48, 0.20] },
  { name: 'late',   dark: [0.12, 0.10, 0.045],  mid: [0.42, 0.39, 0.10], lite: [0.92, 0.78, 0.22] },
];

// Seed bank is keyed by lane id, not grid position. Renumbering rows, culling
// a half-row, or moving a lane to a new row never loses a lock — the lane keeps
// its eight [seed, flavor] pairs (one per column 0..7).
export const LOCKED_SEEDS = {
  'carved-shell':   [[483458, 4], [659458, 5], [303894, 1], [749140, 2], [1391570, 7], [1080947, 6], [766760, 3], [397140, 0]],
  'carved-slices':  [[887327, 4], [784380, 4], [1095003, 5], [556511, 5], [149734665, 4], [2803642426, 2], [1163628399, 1], [3818616708, 1]],
  'chunk-erode':    [[1178592, 0], [1247661, 1], [1316730, 2], [1385799, 3], [1454868, 4], [1523937, 5], [1593006, 6], [1662075, 7]],
  'leaf-fans':      [[1732153, 0], [1801222, 1], [1870291, 2], [1939360, 3], [2008429, 4], [2077498, 5], [2146567, 6], [2215636, 7]],
  'leaf-sails':     [[1700319910, 4], [59857444, 6], [2714362274, 0], [1073899808, 2], [3728404638, 4], [2087942172, 6], [2700128, 6], [2769197, 7]],
  'autumn-pads':    [[2839275, 0], [4116027909, 6], [2977413, 2], [3046482, 3], [3115551, 4], [3184620, 5], [3253689, 6], [3322758, 7]],
  'voxel-carved':   [[3392836, 0], [3461905, 1], [3530974, 2], [3600043, 3], [3669112, 4], [3738181, 5], [3807250, 6], [3876319, 7]],
  'voxel-hollow':   [[3946397, 0], [4015466, 1], [4084535, 2], [4153604, 3], [4222673, 4], [4291742, 5], [4360811, 6], [4429880, 7]],
};

// season tags align with the sim's SEASON enum (src/gen/seasons.js):
//   summer · autumn · conifer · winter   (no spring)
// Pair = [primary, secondary]. A lane that reads the same year-round (palm,
// evergreen) uses the same tag twice, e.g. ['summer','summer'].
export const ROWS = [
  { kind: 'carved-shell',  label: 'seed-rolled carved shell', palettes: [0, 1, 2, 3, 0, 1, 2, 3], seasons: ['summer', 'autumn'] },
  { kind: 'carved-slices', label: 'subtractive slice plates', palettes: [0, 1, 2, 3, 0, 1, 2, 3], seasons: ['summer', 'autumn'] },
  { kind: 'chunk-erode',   label: 'eroded crown chunks',      palettes: [0, 1, 2, 3, 0, 1, 2, 3], seasons: ['summer', 'autumn'] },
  { kind: 'leaf-fans',     label: 'leaf pad fans',            palettes: [0, 1, 2, 3, 0, 1, 2, 3], seasons: ['summer', 'autumn'] },
  { kind: 'leaf-sails',    label: 'large leaf sails',         palettes: [0, 1, 2, 3, 0, 1, 2, 3], seasons: ['summer', 'autumn'] },
  { kind: 'autumn-pads',   label: 'autumn pad lane',          palettes: [4, 5, 6, 7, 4, 5, 6, 7], seasons: ['autumn', 'autumn'] },
  { kind: 'voxel-carved',  label: 'voxel carved crown',       palettes: [0, 1, 2, 3, 4, 5, 6, 7], seasons: ['summer', 'autumn'] },
  { kind: 'voxel-hollow',  label: 'voxel hollow crown',       palettes: [0, 1, 2, 3, 4, 5, 6, 7], seasons: ['autumn', 'winter'] },
];

// Inline-SVG icons. Colors chosen for legibility on the dark lab background;
// emoji fonts wash out and lose accent on this surface.
export const SEASON_ICONS = {
  summer: `<svg viewBox="0 0 16 16" width="14" height="14" aria-label="summer">
    <circle cx="8" cy="8" r="3" fill="#ffd24d"/>
    <g stroke="#ffd24d" stroke-width="1.4" stroke-linecap="round">
      <line x1="8" y1="1.5" x2="8" y2="3.5"/><line x1="8" y1="12.5" x2="8" y2="14.5"/>
      <line x1="1.5" y1="8" x2="3.5" y2="8"/><line x1="12.5" y1="8" x2="14.5" y2="8"/>
      <line x1="3.2" y1="3.2" x2="4.5" y2="4.5"/><line x1="11.5" y1="11.5" x2="12.8" y2="12.8"/>
      <line x1="3.2" y1="12.8" x2="4.5" y2="11.5"/><line x1="11.5" y1="4.5" x2="12.8" y2="3.2"/>
    </g>
  </svg>`,
  autumn: `<svg viewBox="0 0 16 16" width="14" height="14" aria-label="autumn">
    <path d="M8 1.7 C 10.4 4.0, 12.6 3.6, 13.2 5.6 C 13.7 7.5, 11.5 7.7, 12.6 9.6 C 13.2 10.7, 12.1 11.3, 10.5 10.7 C 9.5 10.4, 9.0 11.8, 8 12.8 C 7.0 11.8, 6.5 10.4, 5.5 10.7 C 3.9 11.3, 2.8 10.7, 3.4 9.6 C 4.5 7.7, 2.3 7.5, 2.8 5.6 C 3.4 3.6, 5.6 4.0, 8 1.7 Z" fill="#d46a2a"/>
    <line x1="8" y1="6" x2="8" y2="14.5" stroke="#7a3a14" stroke-width="1.1" stroke-linecap="round"/>
  </svg>`,
  conifer: `<svg viewBox="0 0 16 16" width="14" height="14" aria-label="conifer">
    <path d="M8 1.5 L 12 6 L 10 6 L 13 10 L 10.5 10 L 13.5 14 L 2.5 14 L 5.5 10 L 3 10 L 6 6 L 4 6 Z" fill="#2f7a44"/>
    <rect x="7" y="14" width="2" height="1.5" fill="#5a3a1f"/>
  </svg>`,
  winter: `<svg viewBox="0 0 16 16" width="14" height="14" aria-label="winter">
    <g stroke="#b8e8ff" stroke-width="1.3" stroke-linecap="round" fill="none">
      <line x1="8" y1="1.5" x2="8" y2="14.5"/>
      <line x1="1.5" y1="8" x2="14.5" y2="8"/>
      <line x1="3.3" y1="3.3" x2="12.7" y2="12.7"/>
      <line x1="3.3" y1="12.7" x2="12.7" y2="3.3"/>
      <line x1="6" y1="2.6" x2="8" y2="4.6"/><line x1="10" y1="2.6" x2="8" y2="4.6"/>
      <line x1="6" y1="13.4" x2="8" y2="11.4"/><line x1="10" y1="13.4" x2="8" y2="11.4"/>
    </g>
  </svg>`,
};

function mix(a, b, t) {
  const u = THREE.MathUtils.clamp(t, 0, 1);
  return [a[0] * (1 - u) + b[0] * u, a[1] * (1 - u) + b[1] * u, a[2] * (1 - u) + b[2] * u];
}

function ramp3(a, b, c, t) {
  const u = THREE.MathUtils.clamp(t, 0, 1);
  return u < 0.5 ? mix(a, b, u * 2) : mix(b, c, (u - 0.5) * 2);
}

function jitter(c, rng, amt = 0.08) {
  const k = (rng() - 0.5) * amt;
  return [
    THREE.MathUtils.clamp(c[0] + k * 0.7, 0, 1),
    THREE.MathUtils.clamp(c[1] + k, 0, 1),
    THREE.MathUtils.clamp(c[2] - k * 0.45, 0, 1),
  ];
}

function paletteColor(p, t, rng, amt = 0.08) {
  return jitter(ramp3(p.dark, p.mid, p.lite, t), rng, amt);
}

function pushRgb(arr, rgb) {
  arr.push(rgb[0], rgb[1], rgb[2]);
}

function triCount(obj) {
  let tris = 0;
  obj.traverse((o) => {
    const g = o.geometry;
    if (!g) return;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return Math.round(tris);
}

class Builder {
  constructor() { this.parts = []; }
  push(g, rgb) {
    if (g.index) {
      const flat = g.toNonIndexed();
      g.dispose();
      g = flat;
    }
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = rgb[0];
      colors[i * 3 + 1] = rgb[1];
      colors[i * 3 + 2] = rgb[2];
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.parts.push(g);
  }
  cyl(center, dir, len, baseRad, tipRad, rgb, sides = 6, openEnded = false) {
    _d.copy(dir).normalize();
    _q.setFromUnitVectors(YUP, _d);
    _s.set(1, len, 1);
    _m.compose(center, _q, _s);
    const g = new THREE.CylinderGeometry(tipRad, baseRad, 1, sides, 1, openEnded);
    g.deleteAttribute('uv');
    g.applyMatrix4(_m);
    this.push(g, rgb);
  }
  card(center, dir, len, width, rgb, roll = 0) {
    _d.copy(dir).normalize();
    _q.setFromUnitVectors(YUP, _d);
    if (roll) _q.multiply(_roll.setFromAxisAngle(YUP, roll));
    _s.set(width, len, 1);
    _m.compose(center, _q, _s);
    this.push(CARD.clone().applyMatrix4(_m), rgb);
  }
  oct(center, scale, rgb, rot = 0) {
    _q.setFromAxisAngle(YUP, rot);
    _s.set(scale.x, scale.y, scale.z);
    _m.compose(center, _q, _s);
    this.push(OCT.clone().applyMatrix4(_m), rgb);
  }
  octGradient(center, scale, palette, rng, rot = 0) {
    _q.setFromAxisAngle(YUP, rot);
    _s.set(scale.x, scale.y, scale.z);
    _m.compose(center, _q, _s);
    const g = OCT.clone().applyMatrix4(_m);
    const p = g.attributes.position;
    const colors = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const yT = (y - (center.y - scale.y * 0.5)) / Math.max(0.001, scale.y);
      const sun = 0.5 + 0.5 * Math.cos(Math.atan2(z - center.z, x - center.x) - SUN_AZ);
      const c = paletteColor(palette, 0.08 + yT * 0.55 + sun * 0.32, rng, 0.04);
      colors[i * 3] = c[0];
      colors[i * 3 + 1] = c[1];
      colors[i * 3 + 2] = c[2];
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.parts.push(g);
  }
  boxGradient(center, scale, palette, rng, rot = 0) {
    _q.setFromAxisAngle(YUP, rot);
    _s.set(scale.x, scale.y, scale.z);
    _m.compose(center, _q, _s);
    const g = BOX.clone().applyMatrix4(_m);
    const p = g.attributes.position;
    const colors = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const yT = (y - (center.y - scale.y * 0.5)) / Math.max(0.001, scale.y);
      const sun = 0.5 + 0.5 * Math.cos(Math.atan2(z - center.z, x - center.x) - SUN_AZ);
      const c = paletteColor(palette, 0.08 + yT * 0.52 + sun * 0.34, rng, 0.05);
      colors[i * 3] = c[0];
      colors[i * 3 + 1] = c[1];
      colors[i * 3 + 2] = c[2];
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.parts.push(g);
  }
  customColored(positions, colors) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
    g.computeVertexNormals();
    this.parts.push(g);
  }
  finish(name) {
    const group = new THREE.Group();
    if (!this.parts.length) return group;
    const geo = mergeGeometries(this.parts, false);
    for (const g of this.parts) g.dispose();
    geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.88,
      metalness: 0,
      side: THREE.DoubleSide,
    })));
    group.name = name;
    group.userData.tris = triCount(group);
    return group;
  }
}

function trunkSpine(rng, height, bend = 1.0, steps = 4) {
  const a = rng() * Math.PI * 2;
  const bx = Math.cos(a) * bend;
  const bz = Math.sin(a) * bend;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push(new THREE.Vector3(
      bx * Math.sin(t * Math.PI * 0.8) * t,
      height * t,
      bz * Math.sin(t * Math.PI * 0.92) * t,
    ));
  }
  return pts;
}

function addSkeleton(b, rng, opts = {}) {
  const height = opts.height ?? (8.5 + rng() * 3.4);
  const bend = opts.bend ?? (0.8 + rng() * 1.4);
  const limbs = opts.limbs ?? (5 + ((rng() * 5) | 0));
  const spine = trunkSpine(rng, height, bend, 4);
  for (let i = 0; i < spine.length - 1; i++) {
    const t = i / Math.max(1, spine.length - 2);
    const p0 = spine[i], p1 = spine[i + 1];
    b.cyl(
      p0.clone().lerp(p1, 0.5),
      p1.clone().sub(p0),
      p0.distanceTo(p1),
      THREE.MathUtils.lerp(0.44, 0.18, t),
      THREE.MathUtils.lerp(0.44, 0.18, t + 0.25),
      mix(BARK_LOW, opts.bark || BARK_HIGH, 0.25 + t * 0.75),
      6,
    );
  }

  const tips = [];
  for (let i = 0; i < limbs; i++) {
    const t = 0.38 + rng() * 0.48;
    const base = spine[Math.min(spine.length - 2, Math.max(1, Math.round(t * (spine.length - 1))))].clone();
    const a = i * 2.39996 + rng() * 0.9;
    const dir = new THREE.Vector3(Math.cos(a), 0.22 + rng() * 0.46, Math.sin(a)).normalize();
    const len = (opts.reach ?? 2.8) + rng() * (opts.reachVar ?? 2.2);
    const mid = base.clone().addScaledVector(dir, len * 0.54).addScaledVector(YUP, rng() * 0.42);
    const tip = base.clone().addScaledVector(dir, len).addScaledVector(YUP, 0.28 + rng() * 0.88);
    b.cyl(base.clone().lerp(mid, 0.5), mid.clone().sub(base), base.distanceTo(mid), 0.15, 0.08, mix(BARK_LOW, opts.bark || BARK_HIGH, t), 5, true);
    b.cyl(mid.clone().lerp(tip, 0.5), tip.clone().sub(mid), mid.distanceTo(tip), 0.08, 0.032, mix(BARK_LOW, opts.bark || BARK_HIGH, 0.55 + t * 0.35), 4, true);
    tips.push(tip);
  }
  return { spine, crown: spine[spine.length - 1].clone(), tips };
}

function shellPointUv(center, radius, u, v, phase) {
  const theta = v * Math.PI;
  const phi = u * Math.PI * 2;
  const lump = 1
    + 0.17 * Math.sin(phi * 3 + phase)
    + 0.10 * Math.sin(theta * 5 + phase * 0.7)
    + 0.07 * Math.sin((phi + theta) * 4.3 + phase * 1.7);
  return new THREE.Vector3(
    center.x + Math.sin(theta) * Math.cos(phi) * radius.x * lump,
    center.y + Math.cos(theta) * radius.y * lump,
    center.z + Math.sin(theta) * Math.sin(phi) * radius.z * lump,
  );
}

function shellPoint(center, radius, rIdx, sIdx, rings, segs, phase) {
  return shellPointUv(center, radius, sIdx / segs, rIdx / rings, phase);
}

function addBiteRim(b, rng, center, radius, palette, bite, segs, phase) {
  const base = shellPointUv(center, radius, bite.u, bite.v, phase);
  const normal = base.clone().sub(center).normalize();
  const phi = bite.u * Math.PI * 2;
  const tangentA = new THREE.Vector3(-Math.sin(phi), 0, Math.cos(phi)).normalize();
  const tangentB = new THREE.Vector3().crossVectors(normal, tangentA).normalize();
  if (tangentB.lengthSq() < 0.001) tangentB.set(1, 0, 0);

  // Rim outer must overlap the surviving shell ring; the digital hole footprint
  // can extend ~1.5 UV cells past the analytic bite ellipse, so oversize.
  // Inner ring dives INTO the canopy so the rim reads as a carved lip rather
  // than a flat sticker on the surface.
  const outerX = radius.x * bite.rx * (1.55 + rng() * 0.15);
  const outerY = radius.y * bite.ry * (1.48 + rng() * 0.14);
  const innerX = outerX * (0.46 + rng() * 0.08);
  const innerY = outerY * (0.48 + rng() * 0.08);
  const outerInset = -0.04;
  const innerInset = -Math.min(radius.x, radius.y) * 0.42;
  const segments = 16;
  const positions = [];
  const colors = [];
  const colorAt = (pt, i, outer = false) => {
    const yT = (pt.y - (center.y - radius.y)) / Math.max(0.001, radius.y * 2);
    const sun = 0.5 + 0.5 * Math.cos(((i / segments) * Math.PI * 2) - SUN_AZ);
    return paletteColor(palette, 0.08 + yT * 0.50 + sun * 0.36 + (outer ? 0.08 : -0.03), rng, 0.035);
  };
  const vertex = (pt, i, outer) => {
    positions.push(pt.x, pt.y, pt.z);
    pushRgb(colors, colorAt(pt, i, outer));
  };
  const point = (angle, sx, sy, inset) => base.clone()
    .addScaledVector(tangentA, Math.cos(angle) * sx)
    .addScaledVector(tangentB, Math.sin(angle) * sy)
    .addScaledVector(normal, inset);

  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const o0 = point(a0, outerX, outerY, outerInset);
    const o1 = point(a1, outerX, outerY, outerInset);
    const i0 = point(a0, innerX, innerY, innerInset);
    const i1 = point(a1, innerX, innerY, innerInset);
    vertex(o0, i, true); vertex(i0, i, false); vertex(i1, i + 1, false);
    vertex(o0, i, true); vertex(i1, i + 1, false); vertex(o1, i + 1, true);
  }
  b.customColored(positions, colors);
}

function addCarvedShell(b, rng, center, radius, palette, spec) {
  const rings = 6 + (spec.flavor % 2);
  const segs = 12 + ((spec.flavor % 3) * 2);
  const phase = rng() * 6.28;
  const biteCount = 2 + (spec.flavor % 3);
  // Bite floor bumped so every hole reliably drops 2-3 UV cells; small bites
  // were the source of isolated read-as-circles on slots 01/03/08.
  const bites = Array.from({ length: biteCount }, (_, i) => ({
    u: (rng() + i / biteCount) % 1,
    v: 0.30 + rng() * 0.42,
    rx: 0.13 + rng() * 0.060,
    ry: 0.14 + rng() * 0.055,
  }));
  // Track which bites actually punched through. A bite that drops zero cells
  // would otherwise still stamp a floating rim-decal on the surface.
  const biteDropped = new Array(bites.length).fill(false);
  const positions = [];
  const colors = [];
  const colorAt = (pt, sIdx) => {
    const yT = (pt.y - (center.y - radius.y)) / Math.max(0.001, radius.y * 2);
    const sun = 0.5 + 0.5 * Math.cos((sIdx / segs) * Math.PI * 2 - SUN_AZ);
    return paletteColor(palette, 0.06 + yT * 0.56 + sun * 0.34, rng, 0.045);
  };
  const add = (pt, sIdx) => {
    positions.push(pt.x, pt.y, pt.z);
    pushRgb(colors, colorAt(pt, sIdx));
  };
  for (let r = 1; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const u = (s + 0.5) / segs;
      const v = (r + 0.5) / rings;
      let biteIdx = -1;
      for (let i = 0; i < bites.length; i++) {
        const hole = bites[i];
        const du = Math.min(Math.abs(u - hole.u), 1 - Math.abs(u - hole.u));
        const dv = Math.abs(v - hole.v);
        if ((du / hole.rx) ** 2 + (dv / hole.ry) ** 2 < 1) { biteIdx = i; break; }
      }
      const fleck = Math.sin((r + 1) * (2.2 + spec.flavor * 0.11) + (s + 2) * 3.9 + phase) > 0.94;
      if (biteIdx >= 0) { biteDropped[biteIdx] = true; continue; }
      if (fleck && r > 1 && r < rings - 1) continue;
      const a = shellPoint(center, radius, r, s, rings, segs, phase);
      const b0 = shellPoint(center, radius, r + 1, s, rings, segs, phase);
      const c = shellPoint(center, radius, r + 1, s + 1, rings, segs, phase);
      const d = shellPoint(center, radius, r, s + 1, rings, segs, phase);
      add(a, s); add(b0, s); add(c, s + 1);
      add(a, s); add(c, s + 1); add(d, s + 1);
    }
  }
  b.customColored(positions, colors);
  for (let i = 0; i < bites.length; i++) {
    if (biteDropped[i]) addBiteRim(b, rng, center, radius, palette, bites[i], segs, phase);
  }
}

function addSlicePlates(b, rng, center, radius, palette, spec) {
  const tiers = 4 + (spec.flavor % 4);
  for (let r = 0; r < tiers; r++) {
    const t = tiers === 1 ? 0 : r / (tiers - 1);
    const segs = 9 + ((r + spec.flavor) % 5);
    const y = center.y + radius.y * (0.56 - t * 1.05);
    const rad = THREE.MathUtils.lerp(radius.x * 0.42, radius.x, Math.sin((1 - t) * Math.PI * 0.62));
    // Consistent downward droop: outer edge sits well below the slice center
    // so the tier reads as a shallow cone/umbrella from the side, not a flat
    // disc. Base droop bumped, randomization tightened to keep the angle
    // dominant over the jitter.
    const drop = 0.55 + t * 0.65;
    const phase = rng() * Math.PI * 2;
    const positions = [];
    const colors = [];
    for (let i = 0; i < segs; i++) {
      if (rng() < 0.10 + spec.flavor * 0.01) continue;
      const a0 = phase + (i / segs) * Math.PI * 2;
      const a1 = phase + ((i + 1) / segs) * Math.PI * 2;
      const y0 = y - drop * (0.78 + rng() * 0.22);
      const y1 = y - drop * (0.78 + rng() * 0.22);
      const c = new THREE.Vector3(center.x, y, center.z);
      const p0 = new THREE.Vector3(center.x + Math.cos(a0) * rad * (0.76 + rng() * 0.24), y0, center.z + Math.sin(a0) * rad);
      const p1 = new THREE.Vector3(center.x + Math.cos(a1) * rad * (0.76 + rng() * 0.24), y1, center.z + Math.sin(a1) * rad);
      positions.push(c.x, c.y, c.z, p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
      pushRgb(colors, paletteColor(palette, 0.12 + t * 0.42, rng, 0.04));
      pushRgb(colors, paletteColor(palette, 0.32 + t * 0.30 + rng() * 0.25, rng, 0.06));
      pushRgb(colors, paletteColor(palette, 0.32 + t * 0.30 + rng() * 0.25, rng, 0.06));
    }
    b.customColored(positions, colors);
  }
}

function addPadFans(b, rng, tips, palette, spec, autumn = false) {
  for (const tip of tips) {
    if (rng() < (spec.skip ?? 0.10)) continue;
    const count = spec.cards ?? (2 + ((rng() * 3) | 0));
    const base = rng() * Math.PI * 2;
    const colBase = autumn ? 0.28 + rng() * 0.68 : 0.20 + rng() * 0.72;
    for (let i = 0; i < count; i++) {
      const a = base + (i - (count - 1) * 0.5) * (0.58 + rng() * 0.24);
      const dir = new THREE.Vector3(Math.cos(a), 0.12 + rng() * 0.30, Math.sin(a)).normalize();
      const len = (spec.len ?? 2.0) + rng() * (spec.lenVar ?? 1.35);
      const width = (spec.width ?? 1.05) + rng() * (spec.widthVar ?? 0.75);
      const col = paletteColor(palette, colBase + (i / Math.max(1, count - 1)) * 0.18, rng, 0.10);
      b.card(tip.clone().addScaledVector(dir, len * 0.28), dir, len, width, col, rng() * Math.PI);
    }
  }
}

function addChunkCrown(b, rng, centers, palette, spec) {
  for (const c of centers) {
    if (rng() < (spec.skip ?? 0.08)) continue;
    const s = (spec.chunk ?? 1.55) + rng() * (spec.chunkVar ?? 1.15);
    b.octGradient(c, new THREE.Vector3(s * (0.9 + rng() * 0.6), s * (0.62 + rng() * 0.35), s * (0.82 + rng() * 0.5)), palette, rng, rng() * Math.PI);
  }
}

function addVoxelCrown(b, rng, center, radius, palette, spec, hollow = false) {
  const nx = 3 + (spec.flavor % 2);
  const ny = 3 + ((spec.flavor + 1) % 2);
  const nz = 3 + ((spec.flavor + 2) % 2);
  const carveCount = hollow ? 3 : 2;
  const carves = Array.from({ length: carveCount }, () => {
    const a = rng() * Math.PI * 2;
    return {
      x: Math.cos(a) * (0.30 + rng() * 0.45),
      y: -0.15 + rng() * 0.60,
      z: Math.sin(a) * (0.30 + rng() * 0.45),
      r: 0.34 + rng() * 0.18,
    };
  });
  const step = new THREE.Vector3(radius.x / nx, radius.y / ny, radius.z / nz);
  const candidates = [];
  for (let ix = -nx; ix <= nx; ix++) {
    for (let iy = -ny; iy <= ny; iy++) {
      for (let iz = -nz; iz <= nz; iz++) {
        const x = ix / nx;
        const y = iy / ny;
        const z = iz / nz;
        const d = x * x + y * y * 1.08 + z * z;
        if (d > 1.0) continue;
        if (hollow && d < 0.35 + (spec.flavor % 3) * 0.05) continue;
        const carved = carves.some((c) => ((x - c.x) ** 2 + (y - c.y) ** 2 + (z - c.z) ** 2) < c.r ** 2);
        const ragged = Math.sin(ix * 2.13 + iy * 3.71 + iz * 1.91 + spec.seed * 0.0001) > (hollow ? 0.86 : 0.92);
        if (carved || ragged) continue;

        const pos = new THREE.Vector3(
          center.x + x * radius.x + (rng() - 0.5) * step.x * 0.30,
          center.y + y * radius.y + (rng() - 0.5) * step.y * 0.25,
          center.z + z * radius.z + (rng() - 0.5) * step.z * 0.30,
        );
        const mode = spec.flavor % 4;
        const sx = step.x * (mode === 1 ? 1.65 : 1.10 + rng() * 0.36);
        const sy = step.y * (mode === 2 ? 1.55 : 1.00 + rng() * 0.38);
        const sz = step.z * (mode === 3 ? 1.70 : 1.10 + rng() * 0.36);
        candidates.push({
          pos,
          scale: new THREE.Vector3(sx, sy, sz),
          rot: rng() * Math.PI,
          score: d + rng() * 0.35,
        });
      }
    }
  }
  candidates.sort((a, b0) => b0.score - a.score);
  const maxBoxes = hollow ? 18 + (spec.flavor % 4) : 22 + (spec.flavor % 5);
  for (const c of candidates.slice(0, maxBoxes)) {
    b.boxGradient(c.pos, c.scale, palette, rng, c.rot);
  }
}

export function makeLabTree(spec) {
  const rng = mulberry32(spec.seed);
  const palette = PALETTES[spec.palette % PALETTES.length];
  const b = new Builder();
  const skeleton = addSkeleton(b, rng, spec.skeleton);
  const centers = [skeleton.crown.clone().add(new THREE.Vector3(0, 1.25, 0)), ...skeleton.tips];

  if (spec.kind === 'carved-shell') {
    addCarvedShell(b, rng, skeleton.crown.clone().add(new THREE.Vector3(0, 2.0, 0)), spec.radius, palette, spec);
  } else if (spec.kind === 'carved-slices') {
    addSlicePlates(b, rng, skeleton.crown.clone().add(new THREE.Vector3(0, 1.8, 0)), spec.radius, palette, spec);
  } else if (spec.kind === 'chunk-erode') {
    addChunkCrown(b, rng, centers, palette, { chunk: 1.15 + spec.flavor * 0.08, chunkVar: 0.9, skip: 0.18 });
    addPadFans(b, rng, skeleton.tips, palette, { cards: 1, len: 1.4, width: 0.7, skip: 0.45 });
  } else if (spec.kind === 'leaf-fans') {
    addPadFans(b, rng, skeleton.tips, palette, { cards: 3 + (spec.flavor % 3), len: 1.55, lenVar: 1.15, width: 0.8, widthVar: 0.8 });
  } else if (spec.kind === 'leaf-sails') {
    addPadFans(b, rng, skeleton.tips, palette, { cards: 2, len: 2.3, lenVar: 1.45, width: 1.35, widthVar: 0.9, skip: 0.05 });
  } else if (spec.kind === 'autumn-pads') {
    addPadFans(b, rng, skeleton.tips, palette, { cards: 2 + (spec.flavor % 2), len: 1.8, lenVar: 1.2, width: 1.1, widthVar: 0.85, skip: 0.12 }, true);
    if (spec.flavor % 2 === 0) addChunkCrown(b, rng, [skeleton.crown.clone().add(new THREE.Vector3(0, 1.0, 0))], palette, { chunk: 1.15, chunkVar: 0.75, skip: 0 });
  } else if (spec.kind === 'voxel-carved') {
    addVoxelCrown(b, rng, skeleton.crown.clone().add(new THREE.Vector3(0, 1.9, 0)), spec.radius, palette, spec, false);
  } else if (spec.kind === 'voxel-hollow') {
    addVoxelCrown(b, rng, skeleton.crown.clone().add(new THREE.Vector3(0, 1.9, 0)), spec.radius, palette, spec, true);
  } else {
    addSlicePlates(b, rng, skeleton.crown.clone().add(new THREE.Vector3(0, 1.8, 0)), spec.radius, palette, spec);
  }

  const group = b.finish(`${String(spec.index ?? 0).padStart(2, '0')} ${spec.kind}`);
  group.userData = {
    index: spec.index ?? 0,
    row: (spec.row ?? 0) + 1,
    col: (spec.col ?? 0) + 1,
    kind: spec.kind,
    flavor: spec.flavor,
    palette: palette.name,
    tris: triCount(group),
  };
  return group;
}

// Grid geometry for the contact sheet. The inspect page reuses this so a
// slot lookup is identical to the sheet.
export const GRID = {
  COLS: 8,
  ACTIVE_ROWS: 8,
  TOTAL_ROWS: 12,
  get TOTAL_SLOTS() { return this.COLS * this.TOTAL_ROWS; },
};

export function specForSlot(slotIndex) {
  const { COLS, ACTIVE_ROWS } = GRID;
  const row = Math.floor((slotIndex - 1) / COLS);
  const col = (slotIndex - 1) % COLS;
  if (row >= ACTIVE_ROWS) return { index: slotIndex, row, col, blank: true };
  const rowDef = ROWS[row];
  const [seed, flavor] = LOCKED_SEEDS[rowDef.kind][col];
  return {
    index: slotIndex,
    row,
    col,
    kind: rowDef.kind,
    rowLabel: rowDef.label,
    seasons: rowDef.seasons,
    seed,
    flavor,
    locked: true,
    palette: rowDef.palettes[col],
    radius: new THREE.Vector3(3.6 + (col % 3) * 0.45, 2.45 + (row % 3) * 0.25, 3.25 + ((col + row) % 3) * 0.35),
    skeleton: {
      height: 8.2 + ((slotIndex * 37) % 25) / 10,
      bend: 0.75 + ((slotIndex * 17) % 18) / 16,
      limbs: 5 + ((slotIndex + row) % 5),
      reach: 2.1 + (col % 4) * 0.28,
      reachVar: 1.55 + (row % 4) * 0.24,
      bark: row >= 5 ? mix(BARK_HIGH, [0.58, 0.34, 0.18], 0.45) : (row === 7 ? BARK_GREY : BARK_HIGH),
    },
  };
}

export function buildSlots() {
  const out = [];
  for (let i = 1; i <= GRID.TOTAL_SLOTS; i++) out.push(specForSlot(i));
  return out;
}
