// PALM WORKSHOP — generators. The PALM is the only first-class species
// here (real Weber-Penn monocot: PROCGEN §1.4 trunk + tunable-phyllotaxis
// crown + rachis-spline fronds with bell-envelope pinnate leaflets, plus
// §1.5 cantilever droop as a single art knob). The bend & sway knobs are
// first-class. Per-frond shading lerps lime→mid→dark by canopy depth.
//
// Poly budget: trunk = 6-radial cyl + ringed leaf-base scars (locked look).
// Crown rachis + leaflets are 2-tri CARDS (not boxes), rendered DoubleSide
// — ~4× cheaper than the box build, locked for many-palm re-integration.
//
// Conifer / broadleaf / winter generators that used to live here have been
// stripped. They were "rough stand-ins" only — never used by anyone, and
// the conifer is getting its own workshop with its own correct primitives.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TREE, mixRgb } from '../../gen/palette.js';
import { mulberry32 } from '../../gen/noise.js';

const _cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);   // trunk (locked look)
const _box = new THREE.BoxGeometry(1, 1, 1);               // trunk scar ring
const _card = new THREE.PlaneGeometry(1, 1);               // leaflet / rachis: 2 tris
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
  seg(p0, p1, rad, rgb) {                       // round segment (trunk)
    _a.copy(p0); _b.copy(p1); _d.subVectors(_b, _a);
    const len = Math.max(1e-3, _d.length());
    _q.setFromUnitVectors(_YUP, _d.normalize());
    _p.addVectors(p0, p1).multiplyScalar(0.5);
    _s.set(rad * 2, len, rad * 2);
    _m.compose(_p, _q, _s);
    this._push(_cyl, rgb);
  }
  box(center, dir, len, w, thick, twist, rgb) { // chunky (trunk scar ring)
    _d.copy(dir).normalize();
    _q.setFromUnitVectors(_YUP, _d);
    if (twist) _q.multiply(new THREE.Quaternion().setFromAxisAngle(_YUP, twist));
    _s.set(w, len, thick);
    _m.compose(center, _q, _s);
    this._push(_box, rgb);
  }
  card(center, dir, len, w, rgb) {              // flat 2-tri card (frond bits)
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
    mesh.name = name; mesh.castShadow = true;
    return mesh;
  }
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

// 3-tone frond palette — pushed harder than the shared 2-stop so the
// lime/mid/dark contrast actually reads in-canopy.
const F_DARK = [0.05, 0.17, 0.07];
const F_MID  = [0.20, 0.52, 0.18];
const F_LIME = [0.80, 1.00, 0.30];
// t = base→tip along the frond · ageT = frond's age in the crown (depth)
function frondCol(t, ageT, p) {
  let u = Math.min(1, Math.max(0, t));
  u = Math.pow(u, 1 / Math.max(0.2, p.shadeContrast));      // contrast steepens
  let c = u < 0.5 ? mixRgb(F_DARK, F_MID, u * 2) : mixRgb(F_MID, F_LIME, (u - 0.5) * 2);
  // inner/older fronds sink to dark (canopy depth); sunlit tips lift to lime
  c = mixRgb(c, F_DARK, p.shadeDark * Math.pow(1 - u, 1.4) * (0.35 + 0.65 * ageT));
  c = mixRgb(c, F_LIME, p.shadeLime * Math.pow(u, 1.6) * (1 - 0.45 * ageT));
  return c;
}

// ---- PALM (first-class, real) -------------------------------------------
function palm(rng, p) {
  const bT = new Builder();   // trunk (absolute)
  const bC = new Builder();   // crown (relative to trunk top → sway pivot)
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
    // frondSpread widens the horizontal reach (traditional broad palm) while
    // droop stays keyed to L → the frond arcs OUT then sags.
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
  const crownMesh = bC.finish('PalmCrown', true);     // cards → DoubleSide
  if (trunkMesh) group.add(trunkMesh);
  if (crownMesh) { crownMesh.position.copy(crown); group.add(crownMesh); }
  group.userData.sway = { amp: p.swayAmp, speed: p.swaySpeed, phase: rng() * 6.28, crown: crownMesh };
  group.name = 'Palm';
  return group;
}

// PARAM SPEC — `params` carries [min, max, default] tuples; `meta`
// carries the human face (label, italic hint, value unit). Sections
// declare an accent from `panelShell.ACCENTS` for the colour rail.
export const PALM_CLASS = {
  label: 'Palm', real: true, make: palm,
  params: {
    bend:        [0, 7, 4.50],
    swayAmp:     [0, 0.30, 0.06],
    swaySpeed:   [0, 3, 0.90],
    height:      [9, 24, 16.5],
    trunkSegs:   [6, 30, 10],
    trunkBaseR:  [0.25, 1.1, 0.81],
    trunkTopR:   [0.1, 0.7, 0.22],
    ringFlare:   [1.0, 4.0, 2.08],
    frondCount:  [4, 44, 14],
    phyllo:      [90, 165, 96],
    crownLift:   [-0.5, 1.0, 1.00],
    pitchSpread: [0, 1.8, 1.39],
    frondLen:    [3, 12, 5.0],
    frondSpread: [0.6, 2.6, 1.81],
    frondLenVar: [0, 0.7, 0.02],
    droop:       [0.6, 1.6, 1.45],
    droopBias:   [0.4, 2.4, 2.40],
    rachisWidth: [0.02, 0.5, 0.50],
    rachisStations: [4, 14, 5],
    leaflets:    [4, 40, 16],
    leafLenMax:  [0.6, 4.5, 2.22],
    leafEnvExp:  [0.3, 1.8, 0.68],
    leafCurl:    [0, 1.6, 0.45],
    leafCurlGain:[0, 2.2, 0.90],
    leafWidthMax:[0.04, 0.8, 0.22],
    leafOut:     [0.2, 1.0, 0.55],
    shadeDark:   [0, 1, 0.84],
    shadeLime:   [0, 1, 0.87],
    shadeContrast: [0.4, 2.5, 0.40],
  },
  meta: {
    bend:           { label: 'Bend',            hint: 'trunk lean at the base · random direction' },
    swayAmp:        { label: 'Sway amplitude',  hint: 'wind-driven crown wobble' },
    swaySpeed:      { label: 'Sway speed',      hint: 'oscillation rate · cycles/sec', unit: 'Hz' },
    height:         { label: 'Height',          hint: 'trunk length · meters', unit: 'm' },
    trunkSegs:      { label: 'Trunk segments',  hint: 'stack of stylized leaf-base rings', isInt: true },
    trunkBaseR:     { label: 'Trunk base',      hint: 'radius at the soil line', unit: 'm' },
    trunkTopR:      { label: 'Trunk top',       hint: 'radius just below the crown', unit: 'm' },
    ringFlare:      { label: 'Ring flare',      hint: 'leaf-base ring overhang vs trunk radius' },
    frondCount:     { label: 'Frond count',     hint: 'number of fronds in the crown', isInt: true },
    phyllo:         { label: 'Phyllotaxis',     hint: 'angle between successive fronds', unit: '°' },
    crownLift:      { label: 'Crown lift',      hint: 'how high fronds rise above the trunk top' },
    pitchSpread:    { label: 'Pitch spread',    hint: 'outer fronds spread wider than inner' },
    frondLen:       { label: 'Frond length',    hint: 'rachis length · meters', unit: 'm' },
    frondSpread:    { label: 'Frond spread',    hint: 'overall fan width — traditional palm' },
    frondLenVar:    { label: 'Length variance', hint: 'per-frond length jitter (0=uniform)' },
    droop:          { label: 'Droop',           hint: 'cantilever droop magnitude (PROCGEN §1.5)' },
    droopBias:      { label: 'Droop bias',      hint: 'where along the rachis the droop kicks in' },
    rachisWidth:    { label: 'Rachis width',    hint: 'frond stem thickness card width', unit: 'm' },
    rachisStations: { label: 'Rachis stations', hint: 'polyline samples along each frond', isInt: true },
    leaflets:       { label: 'Leaflets',        hint: 'pinnate-card count per frond side', isInt: true },
    leafLenMax:     { label: 'Leaflet length',  hint: 'longest leaflet (envelope peak)', unit: 'm' },
    leafEnvExp:     { label: 'Envelope curve',  hint: 'sin(πt)^exp · 1=bell, <1=flat, >1=peaky' },
    leafCurl:       { label: 'Leaflet curl',    hint: 'base droop angle of each leaflet' },
    leafCurlGain:   { label: 'Curl gain',       hint: 'how much curl accumulates toward the tip' },
    leafWidthMax:   { label: 'Leaflet width',   hint: 'widest leaflet at envelope peak', unit: 'm' },
    leafOut:        { label: 'Out vs along',    hint: 'leaflet sweep direction · 0=along, 1=out' },
    shadeDark:      { label: 'Dark mix',        hint: 'inner/older frond shading toward dark' },
    shadeLime:      { label: 'Lime mix',        hint: 'sunlit tips shading toward lime highlight' },
    shadeContrast:  { label: 'Shade contrast',  hint: 'gradient steepness from dark→lime' },
  },
  sections: [
    { icon: '∿', label: 'bend & sway', blurb: 'trunk lean + wind motion · first-class',           keys: ['bend', 'swayAmp', 'swaySpeed'],                                                                            accent: 'motion' },
    { icon: '┃', label: 'trunk',       blurb: 'monocot stem · locked look',                       keys: ['height', 'trunkSegs', 'trunkBaseR', 'trunkTopR', 'ringFlare'],                                              accent: 'structural' },
    { icon: '✺', label: 'crown',       blurb: 'frond fan · count · phyllotaxis · pitch',          keys: ['frondCount', 'phyllo', 'crownLift', 'pitchSpread'],                                                         accent: 'flora' },
    { icon: '⌒', label: 'frond',       blurb: 'spread (width) · cantilever droop (§1.5)',         keys: ['frondLen', 'frondSpread', 'frondLenVar', 'droop', 'droopBias', 'rachisWidth', 'rachisStations'],            accent: 'flora' },
    { icon: '⋔', label: 'leaflet',     blurb: 'pinnate cards · bell envelope + curl',             keys: ['leaflets', 'leafLenMax', 'leafEnvExp', 'leafCurl', 'leafCurlGain', 'leafWidthMax', 'leafOut'],             accent: 'seasons' },
    { icon: '✦', label: 'shading',     blurb: 'lime → mid → dark · per-frond depth',              keys: ['shadeDark', 'shadeLime', 'shadeContrast'],                                                                  accent: 'shading' },
  ],
};

export function classDefaults() {
  const out = {};
  for (const [k, [, , def]] of Object.entries(PALM_CLASS.params)) out[k] = def;
  return out;
}

export function makePalm(seed, overrides) {
  return PALM_CLASS.make(mulberry32((seed >>> 0) || 1), { ...classDefaults(), ...(overrides || {}) });
}
