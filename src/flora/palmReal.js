// REAL PALM — re-integrated from the palm workshop (PROCGEN §1.4 monocot +
// §1.5 cantilever droop). The workshop's tuned baseline is AUTHORITATIVE and
// frozen here (no panel knobs in the sim — user-locked). Per instance we
// SWEEP around that baseline for grove variety (the user explicitly wants
// lots of variance over the ~hundreds of palms that land on the fairway /
// courseway): trunk lean & build, crown fullness, frond spread/droop,
// leaflets, and a subtly varied lime→mid→dark canopy.
//
// Independence note: this is a clean PORT (the throwaway workshop stays
// independent; the sim owns its production palm). Touches no god-ray files.
//
// Sizing: heights sample ~[15,24] (median ~17, mean ~19, right-skewed) which
// already reads ~50% bigger than the old test palms; Scene's own
// 0.85–1.35 scatter scale rides on top. Live sway is deferred (it needs the
// Scene render loop, which is off-limits while god rays are in flight) —
// the wind phase/speed is carried in userData for when that lands.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TREE, mixRgb } from '../gen/palette.js';
import { mulberry32 } from '../gen/noise.js';

const _cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
const _box = new THREE.BoxGeometry(1, 1, 1);
const _card = new THREE.PlaneGeometry(1, 1);
for (const g of [_cyl, _box, _card]) g.deleteAttribute('uv');
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
const _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _YUP = new THREE.Vector3(0, 1, 0);

class Builder {
  constructor() { this.parts = []; }
  _push(base, rgb) {
    const g = base.clone().applyMatrix4(_m);
    const n = g.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = rgb[0]; c[i * 3 + 1] = rgb[1]; c[i * 3 + 2] = rgb[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    this.parts.push(g);
  }
  seg(p0, p1, rad, rgb) {
    _a.copy(p0); _b.copy(p1); _d.subVectors(_b, _a);
    const len = Math.max(1e-3, _d.length());
    _q.setFromUnitVectors(_YUP, _d.normalize());
    _p.addVectors(p0, p1).multiplyScalar(0.5);
    _s.set(rad * 2, len, rad * 2);
    _m.compose(_p, _q, _s);
    this._push(_cyl, rgb);
  }
  box(center, dir, len, w, thick, twist, rgb) {
    _d.copy(dir).normalize();
    _q.setFromUnitVectors(_YUP, _d);
    if (twist) _q.multiply(new THREE.Quaternion().setFromAxisAngle(_YUP, twist));
    _s.set(w, len, thick);
    _m.compose(center, _q, _s);
    this._push(_box, rgb);
  }
  card(center, dir, len, w, rgb) {
    _d.copy(dir).normalize();
    _q.setFromUnitVectors(_YUP, _d);
    _s.set(w, len, 1);
    _m.compose(center, _q, _s);
    this._push(_card, rgb);
  }
  finish(name, dbl) {
    if (!this.parts.length) return null;
    const geo = mergeGeometries(this.parts, false);
    for (const g of this.parts) g.dispose();
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0,
      side: dbl ? THREE.DoubleSide : THREE.FrontSide,
    }));
    mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const F_DARK = [0.05, 0.17, 0.07];
const F_MID  = [0.20, 0.52, 0.18];
const F_LIME = [0.80, 1.00, 0.30];
function frondCol(t, ageT, p) {
  let u = Math.min(1, Math.max(0, t));
  u = Math.pow(u, 1 / Math.max(0.2, p.shadeContrast));
  let c = u < 0.5 ? mixRgb(F_DARK, F_MID, u * 2) : mixRgb(F_MID, F_LIME, (u - 0.5) * 2);
  c = mixRgb(c, F_DARK, p.shadeDark * Math.pow(1 - u, 1.4) * (0.35 + 0.65 * ageT));
  c = mixRgb(c, F_LIME, p.shadeLime * Math.pow(u, 1.6) * (1 - 0.45 * ageT));
  return c;
}

// ---- AUTHORITATIVE baseline (frozen from the locked workshop preset) -----
const BASE = {
  bend: 4.5, swayAmp: 0.06, swaySpeed: 0.42, height: 18,
  trunkSegs: 10, trunkBaseR: 0.81, trunkTopR: 0.22, ringFlare: 2.08,
  frondCount: 14, phyllo: 96, crownLift: 1.0, pitchSpread: 1.39,
  frondLen: 5.0, frondSpread: 1.81, frondLenVar: 0.02,
  droop: 1.45, droopBias: 2.40, rachisWidth: 0.5, rachisStations: 5,
  leaflets: 16, leafLenMax: 2.22, leafEnvExp: 0.68, leafCurl: 0.45,
  leafCurlGain: 0.90, leafWidthMax: 0.22, leafOut: 0.55,
  shadeDark: 0.84, shadeLime: 0.87, shadeContrast: 0.40,
};

// height ≈ [15,24], median ~17, mean ~19 (right-skewed) — per the brief.
function sampleHeight(r) {
  return r() < 0.68
    ? 15 + 5.5 * Math.pow(r(), 0.85)   // short cluster (the median)
    : 19 + 5 * r();                    // tall tail toward 24
}

// Per-instance sweep around the locked baseline. "There's not a lot that
// doesn't look good" — so these are deliberately generous EXCEPT droop (kept
// in the keeper band) and shading (subtle drift only).
function sweptParams(r) {
  const j = (base, frac) => base * (1 + (r() * 2 - 1) * frac);
  return {
    ...BASE,
    height: sampleHeight(r),
    bend: 2.6 + r() * 3.2,                 // strong trunk-lean variety
    trunkSegs: 8 + ((r() * 7) | 0),
    trunkBaseR: j(BASE.trunkBaseR, 0.16),
    trunkTopR: j(BASE.trunkTopR, 0.22),
    ringFlare: j(BASE.ringFlare, 0.18),
    frondCount: 11 + ((r() * 8) | 0),      // canopy fullness varies
    phyllo: BASE.phyllo + (r() * 2 - 1) * 7,
    crownLift: j(BASE.crownLift, 0.14),
    pitchSpread: j(BASE.pitchSpread, 0.22),
    frondLen: 4.3 + r() * 1.9,
    frondSpread: 1.55 + r() * 0.55,        // overall width varies
    droop: 1.15 + r() * 0.45,              // keeper band only
    droopBias: 1.9 + r() * 0.6,
    leaflets: 13 + ((r() * 7) | 0),
    leafLenMax: j(BASE.leafLenMax, 0.16),
    leafEnvExp: j(BASE.leafEnvExp, 0.18),
    leafCurl: j(BASE.leafCurl, 0.3),
    leafCurlGain: j(BASE.leafCurlGain, 0.22),
    leafWidthMax: j(BASE.leafWidthMax, 0.22),
    leafOut: j(BASE.leafOut, 0.16),
    shadeDark: Math.min(1, j(BASE.shadeDark, 0.07)),
    shadeLime: Math.min(1, j(BASE.shadeLime, 0.07)),
    shadeContrast: j(BASE.shadeContrast, 0.18),
  };
}

function build(p, rng) {
  const bT = new Builder(), bC = new Builder();
  const H = p.height;
  const segs = Math.max(4, p.trunkSegs | 0);
  const bowA = (rng() - 0.5) * p.bend, bowB = (rng() - 0.5) * p.bend;
  const spine = [];
  for (let k = 0; k <= segs; k++) {
    const t = k / segs;
    spine.push(new THREE.Vector3(
      bowA * Math.sin(t * Math.PI) + bowB * t * t,
      t * H,
      bowB * Math.sin(t * Math.PI * 0.8) - bowA * t * t * 0.6));
  }
  for (let k = 0; k < segs; k++) {
    const t = k / segs;
    const r = THREE.MathUtils.lerp(p.trunkBaseR, p.trunkTopR, t);
    const col = mixRgb(TREE.palmTrunkLow, TREE.palmTrunkHigh, t);
    bT.seg(spine[k], spine[k + 1], r, col);
    const ring = mixRgb(col, [col[0] * 0.66, col[1] * 0.62, col[2] * 0.5], 0.7);
    const mid = _p.copy(spine[k]).lerp(spine[k + 1], 0.5).clone();
    bT.box(mid, _YUP, (H / segs) * 0.42, r * p.ringFlare, r * p.ringFlare, k * GOLDEN, ring);
  }
  const crown = spine[segs];

  const N = Math.max(1, p.frondCount | 0);
  const phyllo = THREE.MathUtils.degToRad(p.phyllo);
  const R = Math.max(3, p.rachisStations | 0);
  for (let f = 0; f < N; f++) {
    const az = f * phyllo;
    const dirH = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const age = N > 1 ? f / (N - 1) : 0;
    const baseLift = p.crownLift + p.pitchSpread * (1 - age) - 0.15 * age;
    const L = p.frondLen * (1 - p.frondLenVar * 0.5 + rng() * p.frondLenVar);
    const pts = [];
    for (let sIdx = 0; sIdx <= R; sIdx++) {
      const t = sIdx / R;
      let shape = t * t * (6 - 4 * t + t * t) / 3;
      shape = Math.pow(Math.max(0, shape), p.droopBias);
      const rise = Math.sin(t * Math.PI * 0.5) * baseLift;
      pts.push(new THREE.Vector3(
        dirH.x * L * t * p.frondSpread,
        rise - p.droop * L * shape,
        dirH.z * L * t * p.frondSpread));
    }
    for (let sIdx = 0; sIdx < R; sIdx++) {
      const w = THREE.MathUtils.lerp(p.rachisWidth, p.rachisWidth * 0.3, sIdx / R);
      const a = pts[sIdx], b = pts[sIdx + 1];
      bC.card(a.clone().lerp(b, 0.5), b.clone().sub(a), a.distanceTo(b), w,
        frondCol(0.10 + 0.30 * sIdx / R, age, p));
    }
    const LE = Math.max(2, p.leaflets | 0);
    for (let sIdx = 1; sIdx < LE; sIdx++) {
      const t = sIdx / LE;
      const seg = Math.min(R - 1, (t * R) | 0);
      const ctr = pts[seg].clone().lerp(pts[seg + 1], (t * R) - seg);
      const tang = pts[seg + 1].clone().sub(pts[seg]).normalize();
      const side = _d.crossVectors(tang, _YUP).normalize();
      const env = Math.pow(Math.sin(t * Math.PI), p.leafEnvExp);
      const llen = (0.4 + env) * p.leafLenMax;
      const curl = p.leafCurl + p.leafCurlGain * (t + p.droop * 0.5);
      const col = frondCol(0.12 + 0.88 * t, age, p);
      for (const sgn of [-1, 1]) {
        const ldir = side.clone().multiplyScalar(sgn * p.leafOut)
          .addScaledVector(tang, 1 - p.leafOut).addScaledVector(_YUP, -curl).normalize();
        const c = ctr.clone().addScaledVector(ldir, llen * 0.5);
        bC.card(c, ldir, llen, 0.06 + p.leafWidthMax * env, col);
      }
    }
  }

  const group = new THREE.Group();
  const trunkMesh = bT.finish('PalmTrunk', false);
  const crownMesh = bC.finish('PalmCrown', true);
  if (trunkMesh) group.add(trunkMesh);
  if (crownMesh) { crownMesh.position.copy(crown); group.add(crownMesh); }

  group.userData.sway = { amp: p.swayAmp, speed: p.swaySpeed, phase: rng() * 6.28, crown: crownMesh };
  group.name = 'Palm';
  return group;
}

// Public seam used by src/flora/trees.js (Scene → makeTree('palm', seed)).
export function makePalm(seed) {
  const rng = mulberry32((seed >>> 0) || 1);
  return build(sweptParams(rng), rng);
}
