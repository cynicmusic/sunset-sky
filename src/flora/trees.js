// Phase-1 tree generators — one builder per species/season. Recognizable,
// faceted, locked Tropical-RPG-Warm palette, per-segment gradients. The
// palm gets its own bowed stacked-segment trunk + golden-angle crown +
// drooped (cantilever) angular fronds. Frond physics, space-colonization
// skeletons and the tuning workshop are Phase 2 (PLAN.md §7) — this proves
// the generators end-to-end for the vertical slice.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../gen/noise.js';
import { TREE, mixRgb } from '../gen/palette.js';
import { makePalm } from './palmReal.js';   // re-integrated workshop palm

const _box = new THREE.BoxGeometry(1, 1, 1);
const _cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
const _cone = new THREE.ConeGeometry(0.5, 1, 7);
for (const g of [_box, _cyl, _cone]) g.deleteAttribute('uv');

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

class Builder {
  constructor() { this.parts = []; }
  _add(base, px, py, pz, sx, sy, sz, rx, ry, rz, rgb) {
    const g = base.clone();
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    _p.set(px, py, pz);
    _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = rgb[0]; c[i * 3 + 1] = rgb[1]; c[i * 3 + 2] = rgb[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    this.parts.push(g);
  }
  box(px, py, pz, sx, sy, sz, ry, rgb) { this._add(_box, px, py, pz, sx, sy, sz, 0, ry, 0, rgb); }
  boxR(px, py, pz, sx, sy, sz, rx, ry, rz, rgb) { this._add(_box, px, py, pz, sx, sy, sz, rx, ry, rz, rgb); }
  cyl(px, py, pz, rt, rb, h, rgb) { this._add(_cyl, px, py, pz, rb * 2, h, rt * 2, 0, 0, 0, rgb); }
  cone(px, py, pz, r, h, rgb) { this._add(_cone, px, py, pz, r * 2, h, r * 2, 0, 0, 0, rgb); }
  build(name) {
    const geo = mergeGeometries(this.parts, false);
    for (const g of this.parts) g.dispose();
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.castShadow = true;
    return mesh;
  }
}

// ---- Palm ----------------------------------------------------------------
function palm(rand) {
  const b = new Builder();
  const segs = 11;
  const H = 11 + rand() * 5;
  const leanX = (rand() - 0.5) * 3.0;       // bow direction
  const leanZ = (rand() - 0.5) * 3.0;
  let px = 0, pz = 0;
  for (let k = 0; k < segs; k++) {
    const t = k / (segs - 1);
    const y = t * H;
    // Bowed trunk: quadratic lean (heavier toward the crown).
    const bx = leanX * t * t, bz = leanZ * t * t;
    const r = THREE.MathUtils.lerp(0.62, 0.34, t);
    const cr = mixRgb(TREE.palmTrunkLow, TREE.palmTrunkHigh, t);   // per-segment gradient
    b.cyl(bx, y + (H / segs) * 0.5, bz, r * 0.9, r, H / segs * 1.04, cr);
    // Stylized stacked leaf-base ring (the "very stylized segments").
    const ring = mixRgb(cr, [cr[0] * 0.7, cr[1] * 0.7, cr[2] * 0.55], 0.6);
    b.cyl(bx, y + (H / segs) * 0.5, bz, r * 1.22, r * 1.22, (H / segs) * 0.34, ring);
    px = bx; pz = bz;
  }
  // Crown: golden-angle fronds with cantilever droop + angular leaflets.
  const golden = Math.PI * (3 - Math.sqrt(5));
  const fronds = 10 + ((rand() * 4) | 0);
  for (let f = 0; f < fronds; f++) {
    const ang = f * golden;
    const dx = Math.cos(ang), dz = Math.sin(ang);
    const fl = 5.0 + rand() * 2.2;
    const sag = 2.6 + rand() * 1.4;
    const rib = 7;
    for (let s = 0; s < rib; s++) {
      const t0 = s / rib, t1 = (s + 1) / rib;
      const arc = (tt) => 1.05 * Math.sin(tt * Math.PI * 0.62);   // up then over
      const x0 = px + dx * fl * t0, z0 = pz + dz * fl * t0;
      const x1 = px + dx * fl * t1, z1 = pz + dz * fl * t1;
      const y0 = H + arc(t0) - sag * t0 * t0;
      const y1 = H + arc(t1) - sag * t1 * t1;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
      const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
      const fcol = mixRgb(TREE.palmFrondLow, TREE.palmFrondHigh, t0);
      // rachis
      const yaw = Math.atan2(dz, dx);
      const pitch = Math.atan2(y1 - y0, Math.hypot(x1 - x0, z1 - z0));
      b.boxR(cx, cy, cz, 0.16, 0.16, len, 0, -yaw + Math.PI / 2, pitch, fcol);
      // angular leaflets — length follows sin(pi t)^0.7 envelope
      const env = Math.pow(Math.sin(t0 * Math.PI), 0.7);
      const blade = (0.5 + env * 2.3);
      for (const side of [-1, 1]) {
        b.boxR(cx + Math.cos(yaw + side * 1.2) * blade * 0.5,
          cy + 0.05,
          cz + Math.sin(yaw + side * 1.2) * blade * 0.5,
          blade, 0.07, 0.34, 0, yaw + side * 1.2, side * 0.5,
          mixRgb(fcol, TREE.palmFrondHigh, 0.35));
      }
    }
  }
  return b.build('Palm');
}

// ---- Conifer -------------------------------------------------------------
function conifer(rand) {
  const b = new Builder();
  const H = 13 + rand() * 6;
  b.cyl(0, H * 0.32, 0, 0.34, 0.5, H * 0.64, TREE.coniferTrunk);
  const tiers = 6;
  for (let k = 0; k < tiers; k++) {
    const t = k / (tiers - 1);
    const y = H * 0.28 + t * H * 0.7;
    const r = THREE.MathUtils.lerp(3.4, 0.5, t);
    const h = H * 0.22;
    b.cone(0, y + h * 0.5, 0, r, h, mixRgb(TREE.coniferLow, TREE.coniferHigh, 0.2 + t * 0.7));
  }
  return b.build('Conifer');
}

// ---- Broadleaf (summer / autumn / winter share the skeleton) ------------
function broadleaf(rand, season) {
  const b = new Builder();
  const H = 8 + rand() * 4;
  // Slightly leaning trunk in 3 segments.
  let lx = 0, lz = 0;
  for (let k = 0; k < 3; k++) {
    const t = k / 3;
    const y = t * H * 0.62;
    lx += (rand() - 0.5) * 0.5; lz += (rand() - 0.5) * 0.5;
    b.cyl(lx, y + H * 0.11, lz, 0.34, 0.5 - t * 0.12, H * 0.22,
      mixRgb(TREE.broadleafTrunkLow, TREE.broadleafTrunkHigh, t));
  }
  const crownY = H * 0.62 + 1.2;
  // A few angular limbs.
  const limbs = 4 + ((rand() * 3) | 0);
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + rand();
    const ll = 1.6 + rand() * 1.8;
    b.boxR(lx + Math.cos(a) * ll * 0.5, crownY - 0.4 + rand() * 0.6, lz + Math.sin(a) * ll * 0.5,
      0.22, 0.22, ll, 0, -a, 0.4 + rand() * 0.3,
      season === 'winter' ? TREE.winterBark : TREE.broadleafTrunkLow);
  }
  if (season === 'winter') {
    // Bare branches + snow caps + cyan rim.
    for (let i = 0; i < 10; i++) {
      const a = rand() * Math.PI * 2, rr = rand() * 2.4;
      const x = lx + Math.cos(a) * rr, z = lz + Math.sin(a) * rr;
      const y = crownY + (rand() - 0.2) * 2.2;
      b.boxR(x, y, z, 0.12, 0.12, 1.0 + rand(), 0, -a, 0.6, TREE.winterBark);
      if (rand() > 0.45) b.box(x, y + 0.5, z, 0.5, 0.28, 0.5, 0,
        mixRgb(TREE.winterSnow, TREE.winterCyan, 0.25));
    }
    return b.build('BroadleafWinter');
  }
  // Foliage blobs. Autumn = sparser + ochre/rust/yellow per cluster.
  const dense = season === 'autumn' ? 7 : 13;
  for (let i = 0; i < dense; i++) {
    const a = rand() * Math.PI * 2;
    const rr = rand() * 2.6;
    const x = lx + Math.cos(a) * rr;
    const z = lz + Math.sin(a) * rr;
    const y = crownY + (rand() - 0.3) * 2.6;
    const sz = 1.5 + rand() * 1.8;
    let col;
    if (season === 'autumn') {
      col = TREE.autumnLeaf[(rand() * 3) | 0];
      col = mixRgb(col, [col[0] * 0.8, col[1] * 0.8, col[2] * 0.7], rand() * 0.4);
    } else {
      col = mixRgb(TREE.summerLeafLow, TREE.summerLeafHigh, rand());
    }
    b.box(x, y, z, sz, sz * 0.85, sz, rand() * 0.6, col);
  }
  return b.build(season === 'autumn' ? 'BroadleafAutumn' : 'BroadleafSummer');
}

export function makeTree(kind, seed) {
  const rand = mulberry32(seed >>> 0);
  switch (kind) {
    // palm is now the locked, swept workshop palm (PROCGEN §1.4/§1.5).
    // The old box `palm(rand)` below is retired (kept only for reference).
    case 'palm': return makePalm(seed);
    case 'conifer': return conifer(rand);
    case 'autumn': return broadleaf(rand, 'autumn');
    case 'winter': return broadleaf(rand, 'winter');
    case 'summer':
    default: return broadleaf(rand, 'summer');
  }
}
