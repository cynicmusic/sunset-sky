import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../gen/noise.js';

const YUP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _roll = new THREE.Quaternion();
const _d = new THREE.Vector3();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

const nonIndexed = (geometry) => geometry.index ? geometry.toNonIndexed() : geometry;
const CYL = nonIndexed(new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1, false));
const CARD = nonIndexed(new THREE.PlaneGeometry(1, 1));
const OCT = nonIndexed(new THREE.OctahedronGeometry(0.5, 0));
for (const g of [CYL, CARD, OCT]) g.deleteAttribute('uv');

const PINE_BARK_LOW = [0.18, 0.12, 0.07];
const PINE_BARK_HIGH = [0.54, 0.35, 0.17];
const SCOTS_BARK_LOW = [0.16, 0.11, 0.08];
const SCOTS_BARK_HIGH = [0.58, 0.40, 0.27];
const DECID_BARK_LOW = [0.16, 0.10, 0.07];
const DECID_BARK_HIGH = [0.48, 0.31, 0.18];
const PINE_DARK = [0.015, 0.075, 0.070];
const PINE_MID = [0.095, 0.330, 0.225];
const PINE_LITE = [0.66, 0.86, 0.22];
const PINE2_PALETTES = [
  [[0.010, 0.035, 0.070], [0.060, 0.285, 0.355], [0.520, 0.940, 0.760]],
  [[0.065, 0.048, 0.018], [0.360, 0.360, 0.090], [0.980, 0.820, 0.180]],
  [[0.008, 0.050, 0.035], [0.030, 0.390, 0.180], [0.700, 1.000, 0.210]],
];
const LEAF_DARK = [0.055, 0.170, 0.055];
const LEAF_MID = [0.310, 0.560, 0.170];
const LEAF_LITE = [0.78, 0.86, 0.22];
const WINTER_BARK_LOW = [0.24, 0.23, 0.22];
const WINTER_BARK = [0.54, 0.50, 0.44];
const SUN_AZ = -0.75;

function mix(a, b, t) {
  const u = THREE.MathUtils.clamp(t, 0, 1);
  return [a[0] * (1 - u) + b[0] * u, a[1] * (1 - u) + b[1] * u, a[2] * (1 - u) + b[2] * u];
}

function tint(c, rng, amt = 0.08) {
  const k = (rng() - 0.5) * amt;
  return [
    THREE.MathUtils.clamp(c[0] + k * 0.7, 0, 1),
    THREE.MathUtils.clamp(c[1] + k, 0, 1),
    THREE.MathUtils.clamp(c[2] - k * 0.4, 0, 1),
  ];
}

function ramp3(a, b, c, t) {
  const u = THREE.MathUtils.clamp(t, 0, 1);
  return u < 0.5 ? mix(a, b, u * 2) : mix(b, c, (u - 0.5) * 2);
}

function pineColor(t, rng, amt = 0.08) {
  return tint(ramp3(PINE_DARK, PINE_MID, PINE_LITE, t), rng, amt);
}

function makePine2Color(seed) {
  const p = PINE2_PALETTES[seed % PINE2_PALETTES.length];
  return (t, rng, amt = 0.08) => tint(ramp3(p[0], p[1], p[2], t), rng, amt);
}

function leafColor(t, rng, amt = 0.10) {
  return tint(ramp3(LEAF_DARK, LEAF_MID, LEAF_LITE, t), rng, amt);
}

function pushRgb(arr, rgb) {
  arr.push(rgb[0], rgb[1], rgb[2]);
}

function configureCutoutTexture(tex) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
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
  octGradient(center, scale, rng, rot = 0) {
    _q.setFromAxisAngle(YUP, rot);
    _s.set(scale.x, scale.y, scale.z);
    _m.compose(center, _q, _s);
    const g = OCT.clone().applyMatrix4(_m);
    const p = g.attributes.position;
    const colors = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const yT = (y - (center.y - scale.y * 0.5)) / Math.max(0.001, scale.y);
      const radial = Math.atan2(z - center.z, x - center.x);
      const sun = 0.5 + 0.5 * Math.cos(radial - SUN_AZ);
      const c = leafColor(0.10 + yT * 0.56 + sun * 0.30, rng, 0.05);
      colors[i * 3] = c[0];
      colors[i * 3 + 1] = c[1];
      colors[i * 3 + 2] = c[2];
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.parts.push(g);
  }
  custom(positions, rgb) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    g.computeVertexNormals();
    this.push(g, rgb);
  }
  customColored(positions, colors) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
    g.computeVertexNormals();
    this.parts.push(g);
  }
  finish(name, doubleSide = true) {
    const group = new THREE.Group();
    if (!this.parts.length) return group;
    const geo = mergeGeometries(this.parts, false);
    for (const g of this.parts) g.dispose();
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.88,
      metalness: 0,
      side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    }));
    mesh.name = name;
    mesh.castShadow = true;
    group.add(mesh);
    group.name = name;
    group.userData.tris = triCount(group);
    return group;
  }
}

function trunkSpine(rng, height, bend = 1.5, steps = 5) {
  const a = rng() * Math.PI * 2;
  const bx = Math.cos(a) * bend;
  const bz = Math.sin(a) * bend;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push(new THREE.Vector3(
      bx * Math.sin(t * Math.PI * 0.82) * t,
      height * t,
      bz * Math.sin(t * Math.PI * 0.92) * t,
    ));
  }
  return pts;
}

function addSegmentedTrunk(b, rng, height, baseR, topR, color = DECID_BARK_HIGH, bend = 1.2, steps = 5, lowColor = DECID_BARK_LOW) {
  const spine = trunkSpine(rng, height, bend, steps);
  for (let i = 0; i < spine.length - 1; i++) {
    const t = i / Math.max(1, spine.length - 2);
    const p0 = spine[i], p1 = spine[i + 1];
    b.cyl(
      p0.clone().lerp(p1, 0.5),
      p1.clone().sub(p0),
      p0.distanceTo(p1),
      THREE.MathUtils.lerp(baseR, topR, t),
      THREE.MathUtils.lerp(baseR, topR, t + 1 / steps),
      mix(lowColor, color, 0.25 + t * 0.75),
      6,
    );
  }
  return spine;
}

function addPinePlate(b, center, radius, drop, phase, rng, tierT, colorFn = pineColor, lift = 0) {
  const segs = 12;
  const pos = [];
  const colors = [];
  for (let i = 0; i < segs; i++) {
    const a0 = phase + (i / segs) * Math.PI * 2;
    const a1 = phase + ((i + 1) / segs) * Math.PI * 2;
    const r0 = radius * (0.72 + 0.30 * rng());
    const r1 = radius * (0.72 + 0.30 * rng());
    const y0 = center.y - drop * (0.65 + 0.45 * rng());
    const y1 = center.y - drop * (0.65 + 0.45 * rng());
    const sun0 = 0.5 + 0.5 * Math.cos(a0 - SUN_AZ);
    const sun1 = 0.5 + 0.5 * Math.cos(a1 - SUN_AZ);
    const core = colorFn(0.12 + tierT * 0.32 + lift, rng, 0.05);
    const edge0 = colorFn(0.30 + tierT * 0.42 + sun0 * 0.25 + lift, rng, 0.08);
    const edge1 = colorFn(0.30 + tierT * 0.42 + sun1 * 0.25 + lift, rng, 0.08);
    pos.push(center.x, center.y, center.z);
    pushRgb(colors, core);
    pos.push(center.x + Math.cos(a0) * r0, y0, center.z + Math.sin(a0) * r0);
    pushRgb(colors, edge0);
    pos.push(center.x + Math.cos(a1) * r1, y1, center.z + Math.sin(a1) * r1);
    pushRgb(colors, edge1);
  }
  b.customColored(pos, colors);
}

function branchDirs(count, rng, lift = 0.2) {
  const dirs = [];
  for (let i = 0; i < count; i++) {
    const a = i * 2.39996 + rng() * 0.8;
    const y = lift + (rng() - 0.5) * 0.32;
    dirs.push(new THREE.Vector3(Math.cos(a), y, Math.sin(a)).normalize());
  }
  return dirs;
}

function pineTieredPlates(seed, opts = {}) {
  const rng = mulberry32(seed);
  const b = new Builder();
  const height = 14 + rng() * 4;
  const spine = addSegmentedTrunk(b, rng, height, 0.42, 0.13, PINE_BARK_HIGH, 0.9, 4, PINE_BARK_LOW);
  const tiers = 7;
  // opts.palette: { dark, mid, lite } RGB triplets override the default
  //   PINE_DARK / PINE_MID / PINE_LITE ramp.
  // opts.lowTierDark: 0..1, multiplies the color of tiers below 0.3 t-ratio
  //   by (1 - amt). Used to make the bottom rung visibly darker without
  //   touching the rest of the canopy.
  // opts.lowTierDarkProb: 0..1, when set, only this fraction of bottom-tier
  //   petals get darkened (the rest stay at base color) — gives a mottled
  //   "some petals darker" look without affecting every plate.
  const baseColorFn = opts.palette
    ? (t, r, amt = 0.08) => tint(ramp3(opts.palette.dark, opts.palette.mid, opts.palette.lite, t), r, amt)
    : pineColor;
  const lowAmt = opts.lowTierDark || 0;
  const lowProb = opts.lowTierDarkProb ?? 1;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const y = height * (0.27 + t * 0.68);
    const anchor = spine[Math.min(spine.length - 1, Math.round(t * (spine.length - 1)))].clone();
    anchor.y = y;
    const radius = THREE.MathUtils.lerp(4.8, 0.8, Math.pow(t, 0.85)) * (0.8 + rng() * 0.25);
    let tierColorFn = baseColorFn;
    if (t < 0.32 && lowAmt > 0) {
      tierColorFn = (innerT, r, amt = 0.08) => {
        const c = baseColorFn(innerT, r, amt);
        const apply = lowProb >= 1 ? true : r() < lowProb;
        if (!apply) return c;
        const k = 1 - lowAmt;
        return [c[0] * k, c[1] * k, c[2] * k];
      };
    }
    addPinePlate(b, anchor, radius, 0.55 + (1 - t) * 0.45, rng() * Math.PI * 2, rng, t, tierColorFn);
  }
  return finishStyle(b.finish('PineTieredPlates'), 'pine-tiered-plates', 'Pine tier plates');
}

function pineTieredPlatesAlt(seed) {
  const rng = mulberry32(seed);
  const b = new Builder();
  const height = 13.5 + rng() * 4.8;
  const spine = addSegmentedTrunk(b, rng, height, 0.46, 0.11, mix(PINE_BARK_HIGH, [0.34, 0.24, 0.12], 0.35), 1.35, 5, PINE_BARK_LOW);
  const tiers = 8;
  const colorFn = makePine2Color(seed);
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const y = height * (0.22 + t * 0.72);
    const anchor = spine[Math.min(spine.length - 1, Math.round(t * (spine.length - 1)))].clone();
    anchor.y = y;
    const radius = THREE.MathUtils.lerp(5.35, 0.55, Math.pow(t, 1.08)) * (0.78 + rng() * 0.34);
    const drop = 0.46 + (1 - t) * 0.72;
    addPinePlate(b, anchor, radius, drop, rng() * Math.PI * 2, rng, t, colorFn, 0.04);
  }
  return finishStyle(b.finish('PineTieredPlatesAlt'), 'pine-tiered-plates-alt', 'Pine tier plates alt');
}

const pineSilhouetteTextures = new Map();
function getPineSilhouetteTexture(seed) {
  const key = seed & 2047;
  if (pineSilhouetteTextures.has(key)) return pineSilhouetteTextures.get(key);
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';
  const grad = ctx.createLinearGradient(0, 28, 0, 232);
  grad.addColorStop(0, 'rgba(190,226,72,0.86)');
  grad.addColorStop(0.36, 'rgba(34,120,72,0.91)');
  grad.addColorStop(1, 'rgba(2,28,26,0.97)');
  ctx.fillStyle = grad;
  const rows = 8 + ((rng() * 2) | 0);
  for (let i = 0; i < rows; i++) {
    const t = rows === 1 ? 0 : i / (rows - 1);
    const y = 28 + t * (192 + rng() * 13);
    const w = (8 + Math.pow(t, 0.82) * 82) * (0.90 + rng() * 0.18);
    const h = (16 + t * 17) * (0.89 + rng() * 0.18);
    const peak = 96 + (rng() - 0.5) * 4.8;
    const leftLow = peak - w * (0.76 + rng() * 0.16);
    const rightLow = peak + w * (0.76 + rng() * 0.16);
    const tuck = w * (0.15 + rng() * 0.06);
    ctx.beginPath();
    ctx.moveTo(peak, y - h * 0.74);
    ctx.lineTo(leftLow, y + h * (0.06 + rng() * 0.20));
    ctx.lineTo(peak - tuck, y + h * (0.48 + rng() * 0.20));
    ctx.lineTo(peak, y + h * 0.14);
    ctx.lineTo(peak + tuck, y + h * (0.48 + rng() * 0.20));
    ctx.lineTo(rightLow, y + h * (0.06 + rng() * 0.20));
    ctx.closePath();
    ctx.fill();
    if (i > 0) {
      ctx.fillRect(88 + (rng() - 0.5) * 5, y - h * 0.55, 16 + rng() * 8, h * 0.98);
    }
  }
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  for (let i = 0; i < 8 + ((rng() * 6) | 0); i++) {
    const t = rng();
    const x = 96 + (rng() - 0.5) * (20 + t * 96);
    const y = 50 + t * 160;
    ctx.beginPath();
    ctx.ellipse(x, y, 5.5 + rng() * 10, 2.5 + rng() * 3.4, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = configureCutoutTexture(new THREE.CanvasTexture(canvas));
  pineSilhouetteTextures.set(key, tex);
  return tex;
}

// opts.widthMul: multiplier on silhouette card width (>1 = fatter).
// opts.baseRadiusMul: multiplier on trunk base radius (>1 = stockier base).
// opts.yLiftMul: multiplier on canopy vertical anchor (<1 = canopy sits lower).
function pineBillboardHybrid(seed, opts = {}) {
  const rng = mulberry32(seed);
  const b = new Builder();
  const height = 14 + rng() * 5;
  const widthMul = opts.widthMul ?? 1;
  const baseRadiusMul = opts.baseRadiusMul ?? 1;
  const yLiftMul = opts.yLiftMul ?? 1;
  const trunkLow = tint([0.060, 0.048, 0.035], rng, 0.04);
  const trunkHigh = tint([0.240, 0.170, 0.095], rng, 0.07);
  addSegmentedTrunk(b, rng, height * 0.82, (0.27 + rng() * 0.10) * baseRadiusMul, 0.065 + rng() * 0.035, trunkHigh, 0.45 + rng() * 0.55, 4, trunkLow);
  const group = b.finish('PineBillboardTrunk', false);
  const tex = getPineSilhouetteTexture(seed);
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: false,
    alphaTest: 0.55,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  const cards = 3 + ((rng() * 2) | 0);
  const yLift = height * (0.53 + rng() * 0.04) * yLiftMul;
  const rotOffset = rng() * Math.PI * 2;
  for (let i = 0; i < cards; i++) {
    const geo = new THREE.PlaneGeometry((7.6 + rng() * 1.4) * widthMul, height * (0.94 + rng() * 0.10), 1, 1);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((rng() - 0.5) * 0.30, yLift, (rng() - 0.5) * 0.30);
    mesh.rotation.y = rotOffset + (i / cards) * Math.PI;
    mesh.name = 'PineSilhouetteCard';
    group.add(mesh);
  }
  return finishStyle(group, 'pine-silhouette-shell', 'Pine silhouette shell');
}

function pineSparseScots(seed) {
  const rng = mulberry32(seed);
  const b = new Builder();
  const height = 12 + rng() * 5;
  const spine = addSegmentedTrunk(b, rng, height, 0.45, 0.16, SCOTS_BARK_HIGH, 2.2, 5, SCOTS_BARK_LOW);
  const limbs = 5 + ((rng() * 4) | 0);
  for (let i = 0; i < limbs; i++) {
    const t = 0.38 + rng() * 0.50;
    const baseIdx = Math.min(spine.length - 1, Math.round(t * (spine.length - 1)));
    const base = spine[baseIdx].clone();
    const a = rng() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(a), 0.24 + rng() * 0.25, Math.sin(a)).normalize();
    const len = (2.4 + rng() * 2.5) * (1.18 - t * 0.45);
    const tip = base.clone().addScaledVector(dir, len);
    b.cyl(base.clone().lerp(tip, 0.5), dir, len, 0.12 + (1 - t) * 0.08, 0.035, mix(SCOTS_BARK_LOW, SCOTS_BARK_HIGH, t), 5);
    const tuftCol = pineColor(0.40 + rng() * 0.42, rng, 0.12);
    for (let k = 0; k < 3; k++) {
      const td = dir.clone()
        .addScaledVector(YUP, -0.35 + rng() * 0.15)
        .add(new THREE.Vector3(Math.cos(a + k * 2.1), 0, Math.sin(a + k * 2.1)).multiplyScalar(0.25))
        .normalize();
      b.card(tip.clone().addScaledVector(td, 0.35), td, 1.15 + rng() * 0.7, 0.36 + rng() * 0.22, tuftCol, rng() * Math.PI);
    }
  }
  return finishStyle(b.finish('SparseScots'), 'pine-sparse-scots', 'Scots sparse');
}

function addDeciduousSkeleton(b, rng, height = 9, limbCount = 7, winter = false) {
  const high = winter ? WINTER_BARK : DECID_BARK_HIGH;
  const low = winter ? WINTER_BARK_LOW : DECID_BARK_LOW;
  const bend = (winter ? 1.35 : 1.0) + rng() * (winter ? 1.25 : 0.95);
  const spine = addSegmentedTrunk(
    b,
    rng,
    height,
    0.44 + rng() * 0.13,
    0.17 + rng() * 0.08,
    high,
    bend,
    4,
    low,
  );
  const crown = spine[spine.length - 1].clone();
  const tips = [];
  const dirs = branchDirs(limbCount, rng, 0.30 + rng() * 0.18);
  for (let i = 0; i < dirs.length; i++) {
    const t = 0.42 + rng() * 0.42;
    const base = spine[Math.min(spine.length - 2, Math.max(1, Math.round(t * (spine.length - 1))))].clone();
    const dir = dirs[i];
    const len = 2.2 + rng() * 2.45;
    const mid = base.clone().addScaledVector(dir, len * 0.55).addScaledVector(YUP, rng() * 0.55);
    const tip = base.clone().addScaledVector(dir, len).addScaledVector(YUP, 0.35 + rng() * 0.95);
    const branchCol = mix(low, high, t);
    b.cyl(base.clone().lerp(mid, 0.5), mid.clone().sub(base), base.distanceTo(mid), 0.16, 0.09, branchCol, 5, true);
    b.cyl(mid.clone().lerp(tip, 0.5), tip.clone().sub(mid), mid.distanceTo(tip), 0.09, 0.035, mix(branchCol, high, 0.35), 5, true);
    tips.push(tip);
  }
  return { spine, crown, tips };
}

function deciduousLimbChunks(seed) {
  const rng = mulberry32(seed);
  const b = new Builder();
  const { tips, crown } = addDeciduousSkeleton(b, rng, 9.3 + rng() * 2.4, 6 + ((rng() * 3) | 0), false);
  const centers = [crown.clone().add(new THREE.Vector3(0, 1.0, 0)), ...tips];
  for (let i = 0; i < centers.length; i++) {
    if (i > 0 && rng() < 0.18) continue;
    const c = centers[i];
    const s = 1.5 + rng() * 1.25;
    b.octGradient(c, new THREE.Vector3(s * (1.0 + rng() * 0.4), s * (0.75 + rng() * 0.3), s * (0.9 + rng() * 0.4)), rng, rng() * Math.PI);
  }
  return finishStyle(b.finish('DecidLimbChunks'), 'decid-limb-chunks', 'Limb crown chunks');
}

function addCanopyShell(b, center, radius, rng) {
  const rings = 7;
  const segs = 14;
  const phases = [rng() * 6.28, rng() * 6.28, rng() * 6.28];
  const p = [];
  const colors = [];
  const point = (rIdx, sIdx) => {
    const v = rIdx / rings;
    const theta = v * Math.PI;
    const u = sIdx / segs;
    const phi = u * Math.PI * 2;
    const lump = 1 + 0.16 * Math.sin(phi * 3 + phases[0]) + 0.10 * Math.sin(theta * 5 + phases[1]);
    return new THREE.Vector3(
      center.x + Math.sin(theta) * Math.cos(phi) * radius.x * lump,
      center.y + Math.cos(theta) * radius.y * lump,
      center.z + Math.sin(theta) * Math.sin(phi) * radius.z * lump,
    );
  };
  const colorAt = (pt, sIdx) => {
    const yT = (pt.y - (center.y - radius.y)) / Math.max(0.001, radius.y * 2);
    const phi = (sIdx / segs) * Math.PI * 2;
    const sun = 0.5 + 0.5 * Math.cos(phi - SUN_AZ);
    return leafColor(0.08 + yT * 0.56 + sun * 0.30, rng, 0.05);
  };
  const add = (pt, sIdx) => {
    p.push(pt.x, pt.y, pt.z);
    pushRgb(colors, colorAt(pt, sIdx));
  };
  for (let r = 1; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const hole = Math.sin((r + 1) * 1.7 + (s + 3) * 2.31 + phases[2]) > 0.38;
      if (hole) continue;
      const a = point(r, s);
      const b0 = point(r + 1, s);
      const c = point(r + 1, s + 1);
      const d = point(r, s + 1);
      add(a, s); add(b0, s); add(c, s + 1);
      add(a, s); add(c, s + 1); add(d, s + 1);
    }
  }
  b.customColored(p, colors);
}

function deciduousCarvedCanopy(seed) {
  const rng = mulberry32(seed);
  const b = new Builder();
  const { crown } = addDeciduousSkeleton(b, rng, 8.5 + rng() * 2, 4, false);
  addCanopyShell(
    b,
    crown.clone().add(new THREE.Vector3(0, 2.0, 0)),
    new THREE.Vector3(4.2 + rng(), 3.0 + rng() * 0.8, 3.8 + rng()),
    rng,
  );
  return finishStyle(b.finish('DecidCarvedCanopy'), 'decid-carved-canopy', 'Carved canopy');
}

function deciduousLeafPads(seed) {
  const rng = mulberry32(seed);
  const b = new Builder();
  const { tips, crown } = addDeciduousSkeleton(b, rng, 9 + rng() * 2, 8, false);
  const pads = [crown.clone().add(new THREE.Vector3(0, 1.4, 0)), ...tips];
  for (let i = 0; i < pads.length; i++) {
    const c = pads[i];
    const col = leafColor(0.28 + rng() * 0.62, rng, 0.16);
    for (let k = 0; k < 2; k++) {
      const dir = new THREE.Vector3(Math.cos(k * Math.PI * 0.5 + rng() * 0.2), 0.10 + rng() * 0.20, Math.sin(k * Math.PI * 0.5 + rng() * 0.2)).normalize();
      b.card(c.clone().addScaledVector(YUP, rng() * 0.35), dir, 2.0 + rng() * 1.2, 1.1 + rng() * 0.7, col, rng() * Math.PI);
    }
  }
  return finishStyle(b.finish('DecidLeafPads'), 'decid-leaf-pads', 'Leaf pads');
}

function deciduousWinterSkeleton(seed) {
  const rng = mulberry32(seed);
  const b = new Builder();
  const { tips } = addDeciduousSkeleton(b, rng, 9.0 + rng() * 3.1, 7 + ((rng() * 4) | 0), true);
  for (const tip of tips) {
    const twigs = 1 + (rng() > 0.55 ? 1 : 0);
    for (let k = 0; k < twigs; k++) {
      const a = rng() * Math.PI * 2;
      const dir = new THREE.Vector3(Math.cos(a), 0.24 + rng() * 0.35, Math.sin(a)).normalize();
      const len = 0.9 + rng() * 0.75;
      b.cyl(tip.clone().addScaledVector(dir, len * 0.5), dir, len, 0.035, 0.012, WINTER_BARK, 3, true);
    }
  }
  return finishStyle(b.finish('DecidWinterSkeleton'), 'decid-winter-skeleton', 'Winter skeleton');
}

// Spruce-blue billboard pine. Same shell shape as pineBillboardHybrid but
// the silhouette texture uses a dark-blue-to-light-teal gradient and the
// trunk is mixed darker. Cached per low-bit seed so we don't allocate per
// tree.
const pineSilhouetteBlueTextures = new Map();
function getPineSilhouetteBlueTexture(seed) {
  const key = seed & 2047;
  if (pineSilhouetteBlueTextures.has(key)) return pineSilhouetteBlueTextures.get(key);
  const rng = mulberry32((seed ^ 0x5a82799a) >>> 0);
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';
  const grad = ctx.createLinearGradient(0, 28, 0, 232);
  grad.addColorStop(0, 'rgba(160,210,225,0.88)');
  grad.addColorStop(0.36, 'rgba(38,98,135,0.92)');
  grad.addColorStop(1, 'rgba(4,12,28,0.98)');
  ctx.fillStyle = grad;
  const rows = 8 + ((rng() * 2) | 0);
  for (let i = 0; i < rows; i++) {
    const t = rows === 1 ? 0 : i / (rows - 1);
    const y = 28 + t * (192 + rng() * 13);
    const w = (8 + Math.pow(t, 0.82) * 82) * (0.90 + rng() * 0.18);
    const h = (16 + t * 17) * (0.89 + rng() * 0.18);
    const peak = 96 + (rng() - 0.5) * 4.8;
    const leftLow = peak - w * (0.76 + rng() * 0.16);
    const rightLow = peak + w * (0.76 + rng() * 0.16);
    const tuck = w * (0.15 + rng() * 0.06);
    ctx.beginPath();
    ctx.moveTo(peak, y - h * 0.74);
    ctx.lineTo(leftLow, y + h * (0.06 + rng() * 0.20));
    ctx.lineTo(peak - tuck, y + h * (0.48 + rng() * 0.20));
    ctx.lineTo(peak, y + h * 0.14);
    ctx.lineTo(peak + tuck, y + h * (0.48 + rng() * 0.20));
    ctx.lineTo(rightLow, y + h * (0.06 + rng() * 0.20));
    ctx.closePath();
    ctx.fill();
    if (i > 0) {
      ctx.fillRect(88 + (rng() - 0.5) * 5, y - h * 0.55, 16 + rng() * 8, h * 0.98);
    }
  }
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  for (let i = 0; i < 8 + ((rng() * 6) | 0); i++) {
    const t = rng();
    const x = 96 + (rng() - 0.5) * (20 + t * 96);
    const y = 50 + t * 160;
    ctx.beginPath();
    ctx.ellipse(x, y, 5.5 + rng() * 10, 2.5 + rng() * 3.4, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = configureCutoutTexture(new THREE.CanvasTexture(canvas));
  pineSilhouetteBlueTextures.set(key, tex);
  return tex;
}

function pineSilhouetteShellBlue(seed, opts = {}) {
  const rng = mulberry32(seed);
  const b = new Builder();
  const height = 14 + rng() * 5;
  const widthMul = opts.widthMul ?? 1;
  const baseRadiusMul = opts.baseRadiusMul ?? 1;
  const yLiftMul = opts.yLiftMul ?? 1;
  const trunkLow = tint([0.040, 0.032, 0.022], rng, 0.03);
  const trunkHigh = tint([0.180, 0.130, 0.075], rng, 0.06);
  addSegmentedTrunk(b, rng, height * 0.82, (0.27 + rng() * 0.10) * baseRadiusMul, 0.065 + rng() * 0.035, trunkHigh, 0.45 + rng() * 0.55, 4, trunkLow);
  const group = b.finish('PineBillboardBlueTrunk', false);
  const tex = getPineSilhouetteBlueTexture(seed);
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: false,
    alphaTest: 0.55,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  const cards = 3 + ((rng() * 2) | 0);
  const yLift = height * (0.53 + rng() * 0.04) * yLiftMul;
  const rotOffset = rng() * Math.PI * 2;
  for (let i = 0; i < cards; i++) {
    const geo = new THREE.PlaneGeometry((7.6 + rng() * 1.4) * widthMul, height * (0.94 + rng() * 0.10), 1, 1);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((rng() - 0.5) * 0.30, yLift, (rng() - 0.5) * 0.30);
    mesh.rotation.y = rotOffset + (i / cards) * Math.PI;
    mesh.name = 'PineSilhouetteBlueCard';
    group.add(mesh);
  }
  return finishStyle(group, 'pine-silhouette-shell-blue', 'Pine silhouette shell blue');
}

// Hybrid: deciduous-skeleton trunk + branches with pine "fins" (tier plates)
// hung at each branch tip. No needles, no leaves — just angular fan-shaped
// plates of pine color attached to bare branches.
// opts.palette: { dark, mid, lite } RGB triplets override the default green ramp.
// opts.winter: use winter-bark (silver-grey) trunk + branches.
// opts.finsPerTip: 1 = single plate, 2-4 = stacked mini-fins climbing the tip.
// opts.finScale: multiplier on each plate's radius (smaller = sparser canopy).
// opts.finDrop: multiplier on each plate's vertical droop.
// opts.limbCount: number of branches off the trunk.
function pineFinsOnSkeleton(seed, opts = {}) {
  const rng = mulberry32(seed);
  const b = new Builder();
  const height = 11 + rng() * 3;
  const limbCount = (opts.limbCount ?? 7) + ((rng() * 3) | 0);
  const { tips, crown } = addDeciduousSkeleton(b, rng, height, limbCount, !!opts.winter);
  const colorFn = opts.palette
    ? (t, r, amt = 0.08) => tint(ramp3(opts.palette.dark, opts.palette.mid, opts.palette.lite, t), r, amt)
    : pineColor;
  const finsPerTip = Math.max(1, opts.finsPerTip || 1);
  const finScale = opts.finScale ?? 1;
  const finDrop = opts.finDrop ?? 1;
  for (let i = 0; i < tips.length; i++) {
    const tip = tips[i];
    const baseRadius = (0.9 + rng() * 0.85) * finScale;
    const baseDrop = (0.40 + rng() * 0.45) * finDrop;
    if (finsPerTip === 1) {
      const phase = rng() * Math.PI * 2;
      const tierT = 0.35 + rng() * 0.45;
      addPinePlate(b, tip, baseRadius, baseDrop, phase, rng, tierT, colorFn);
    } else {
      // Stacked mini-fins: progressively smaller plates climbing the tip,
      // each tier slightly more "lite" so the stack gradients up.
      for (let k = 0; k < finsPerTip; k++) {
        const kt = k / Math.max(1, finsPerTip - 1);
        const radius = baseRadius * (1 - kt * 0.42);
        const drop = baseDrop * (1 - kt * 0.30);
        const lift = kt * (baseRadius * 0.62);
        const anchor = tip.clone().add(new THREE.Vector3(0, lift, 0));
        addPinePlate(b, anchor, radius, drop, rng() * Math.PI * 2, rng, 0.30 + kt * 0.55, colorFn);
      }
    }
  }
  const crownAnchor = crown.clone().add(new THREE.Vector3(0, 0.65 + rng() * 0.55, 0));
  addPinePlate(b, crownAnchor, (1.25 + rng() * 0.5) * finScale, 0.55, rng() * Math.PI * 2, rng, 0.85, colorFn);
  return finishStyle(b.finish('PineFinsOnSkeleton'), 'pine-fins-on-skeleton', 'Pine fins on skeleton');
}

function finishStyle(group, id, label) {
  group.name = label;
  group.userData.styleId = id;
  group.userData.label = label;
  group.userData.tris = triCount(group);
  return group;
}

export const TREE_STYLES = [
  { id: 'pine-tiered-plates', label: 'Pine tier plates', family: 'pine', make: pineTieredPlates },
  { id: 'pine-tiered-plates-alt', label: 'Pine tier plates B', family: 'pine', make: pineTieredPlatesAlt },
  { id: 'pine-silhouette-shell', label: 'Pine silhouette shell', family: 'pine', make: pineBillboardHybrid },
  { id: 'pine-silhouette-shell-blue', label: 'Pine silhouette shell blue', family: 'pine', make: pineSilhouetteShellBlue },
  { id: 'pine-fins-on-skeleton', label: 'Pine fins on skeleton', family: 'hybrid', make: pineFinsOnSkeleton },
  { id: 'pine-sparse-scots', label: 'Scots sparse', family: 'pine', make: pineSparseScots },
  { id: 'decid-limb-chunks', label: 'Limb crown chunks', family: 'deciduous', make: deciduousLimbChunks },
  { id: 'decid-carved-canopy', label: 'Carved canopy', family: 'deciduous', make: deciduousCarvedCanopy },
  { id: 'decid-leaf-pads', label: 'Leaf pads', family: 'deciduous', make: deciduousLeafPads },
  { id: 'decid-winter-skeleton', label: 'Winter skeleton', family: 'deciduous', make: deciduousWinterSkeleton },
];

export function makeTreeStyle(style, seed, opts) {
  const found = TREE_STYLES.find((s) => s.id === style || s.label === style) || TREE_STYLES[0];
  return found.make((seed >>> 0) || 1, opts);
}
