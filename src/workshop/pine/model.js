// PINE — palm-formula generator. Bounded by PLAN-PINE.md + the follow-up
// handoff. This file is now also the methodology benchmark surface:
//   • One species (Scots pine), no spruce/larch siblings yet.
//   • ≤ 1.5k tris per tree — verified by the workshop's smoke test.
//   • No shaders, no textures. Vertex colors + MeshStandardMaterial.
//   • Branch/foliage construction is selectable so we can compare methods
//     before freezing a production pineReal.js.
//   • Asymmetry is a first-class param family — lean, wind, skew, jitter.
//   • Cool blue-green palette, NOT lime. The references gave us teal/sage.
//
// Current methods:
//   branchModel:  tubes | crossCards | flatCards
//   foliageModel: branchlets | volumeClumps | legacyCards | none
// Defaults intentionally avoid the rejected flat branch / pom-only path.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../gen/noise.js';

// ---- palette (cool blue-green — moodier than v1, contrast knob expands) -
// Endpoints stretched: darks darker + bluer (moody spruce shadow), tips
// brighter + limier. The `contrast` knob (per tree) lerps each tree's
// effective dark/lite away from the MID, so contrast=0 reads "uniform
// mid", contrast=1 reads "default", contrast=2 reads "high-key tip
// highlights + deep shadow". MID stays fixed.
const NEEDLE_DARK = [0.05, 0.12, 0.10];   // #0d1f1a — very dark blue-green shadow
const NEEDLE_MID  = [0.20, 0.36, 0.28];   // #335c47 — deep sage
const NEEDLE_LITE = [0.62, 0.84, 0.50];   // #9fd680 — bright lime-green for sunlit tips
const CONE_LOW    = [0.18, 0.10, 0.06];   // #2e1a10 — pine cone brown (dark)
const CONE_HIGH   = [0.30, 0.18, 0.10];   // #4d2e1a — pine cone brown (lit)
const BARK_LOW    = [0.18, 0.14, 0.11];   // #2e231c — darker bark for moody base
const BARK_HIGH   = [0.36, 0.30, 0.24];   // #5c4d3d

function mix(a, b, t) {
  const u = Math.max(0, Math.min(1, t));
  return [a[0]*(1-u) + b[0]*u, a[1]*(1-u) + b[1]*u, a[2]*(1-u) + b[2]*u];
}

// Per-tree palette tint — the user-requested `colorVar` slider scales the
// magnitude of a random RGB shift per tree, so a matrix of pines reads as
// a varied stand rather than 24 copies. tint directions are deliberate
// (warm/cool/etc.) not pure noise — keeps the family of greens recognisable.
const TINT_DIRS = [
  [ 0.05, -0.02, -0.06],  // warmer (more yellow-green)
  [-0.04, -0.02,  0.06],  // cooler (more blue-grey-green)
  [-0.04,  0.04, -0.02],  // greener
  [ 0.02,  0.02,  0.02],  // brighter
  [-0.04, -0.04, -0.04],  // dimmer / older
];
function pickTint(rng) { return TINT_DIRS[(rng() * TINT_DIRS.length) | 0]; }
function tinted(rgb, dir, amt) {
  return [
    Math.max(0, Math.min(1, rgb[0] + dir[0] * amt)),
    Math.max(0, Math.min(1, rgb[1] + dir[1] * amt)),
    Math.max(0, Math.min(1, rgb[2] + dir[2] * amt)),
  ];
}

// ---- shared scratch ----------------------------------------------------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _rollQ = new THREE.Quaternion();
const _d = new THREE.Vector3(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _YUP = new THREE.Vector3(0, 1, 0);

const _cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
const _card = new THREE.PlaneGeometry(1, 1);
const _oct = new THREE.OctahedronGeometry(0.5, 0);
for (const g of [_cyl, _card, _oct]) g.deleteAttribute('uv');

// Builder copies the palm workshop's tiny vocabulary: cyl + card, vertex
// colors on a Float32Array, merged at the end. Keeps the per-tree budget
// honest because every primitive is one of two cheap shapes.
class Builder {
  constructor() { this.parts = []; }
  _paintAndPush(g, rgb) {
    if (g.index) {
      const flat = g.toNonIndexed();
      g.dispose();
      g = flat;
    }
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i*3]=rgb[0]; c[i*3+1]=rgb[1]; c[i*3+2]=rgb[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    this.parts.push(g);
  }
  _push(base, rgb) {
    this._paintAndPush(base.clone().applyMatrix4(_m), rgb);
  }
  cyl(center, dir, len, rad, rgb) {
    _d.copy(dir).normalize();
    _q.setFromUnitVectors(_YUP, _d);
    _s.set(rad * 2, len, rad * 2);
    _m.compose(center, _q, _s);
    this._push(_cyl, rgb);
  }
  taperedCyl(center, dir, len, baseRad, tipRad, rgb, sides = 5) {
    _d.copy(dir).normalize();
    _q.setFromUnitVectors(_YUP, _d);
    _s.set(1, len, 1);
    _m.compose(center, _q, _s);
    const g = new THREE.CylinderGeometry(tipRad, baseRad, 1, sides, 1, true);
    g.deleteAttribute('uv');
    g.applyMatrix4(_m);
    this._paintAndPush(g, rgb);
  }
  card(center, dir, len, w, rgb, roll = 0) {
    _d.copy(dir).normalize();
    _q.setFromUnitVectors(_YUP, _d);
    if (roll) _q.multiply(_rollQ.setFromAxisAngle(_YUP, roll));
    _s.set(w, len, 1);
    _m.compose(center, _q, _s);
    this._push(_card, rgb);
  }
  oct(center, radius, yScale, rgb, roll = 0) {
    _q.setFromAxisAngle(_YUP, roll);
    _s.set(radius * 1.12, radius * yScale, radius);
    _m.compose(center, _q, _s);
    this._push(_oct, rgb);
  }
  finish(name, dbl) {
    if (!this.parts.length) return null;
    const geo = mergeGeometries(this.parts, false);
    for (const g of this.parts) g.dispose();
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0,
      side: dbl ? THREE.DoubleSide : THREE.FrontSide,
    }));
    mesh.name = name; mesh.castShadow = true;
    return mesh;
  }
}

// clamp helper for contrast extrapolation
function c01(rgb) {
  return [
    Math.max(0, Math.min(1, rgb[0])),
    Math.max(0, Math.min(1, rgb[1])),
    Math.max(0, Math.min(1, rgb[2])),
  ];
}

// ---- the generator -----------------------------------------------------
function pine(rng, p) {
  // CONTRAST — stretch the dark/lite endpoints away from the MID by a
  // factor of `contrast` ∈ [0, 2]. At 1 the palette is the literal
  // NEEDLE_* constants; at 2 the spread doubles (extrapolated and
  // clamped to [0,1]). Per-TREE rather than per-pom so a whole tree's
  // mood is consistent.
  const c = p.contrast;
  const nDarkBase = c01(mix(NEEDLE_MID, NEEDLE_DARK, c));
  const nMidBase  = NEEDLE_MID;
  const nLiteBase = c01(mix(NEEDLE_MID, NEEDLE_LITE, c));

  // per-tree palette tint — user-controlled colorVar amount, random
  // direction per tree out of TINT_DIRS so the matrix reads as varied.
  const tDir = pickTint(rng);
  const tAmt = p.colorVar;
  const nDark = tinted(nDarkBase, tDir, tAmt);
  const nMid  = tinted(nMidBase,  tDir, tAmt);
  const nLite = tinted(nLiteBase, tDir, tAmt);
  const bLow  = tinted(BARK_LOW,  tDir, tAmt * 0.4);
  const bHigh = tinted(BARK_HIGH, tDir, tAmt * 0.4);

  // per-tree pose — leanAngle is the global RANGE, each tree gets a value
  // ∈ [-leanAngle, +leanAngle] in a random azimuth so the matrix shows
  // pines leaning every which way.
  const H = p.height * (0.88 + rng() * 0.24);
  const leanMag = (rng() - 0.5) * 2 * p.leanAngle;
  const leanAz = rng() * Math.PI * 2;
  const trunkDir = new THREE.Vector3(
    Math.sin(leanMag) * Math.cos(leanAz),
    Math.cos(leanMag),
    Math.sin(leanMag) * Math.sin(leanAz),
  ).normalize();
  const trunkBase = new THREE.Vector3(0, 0, 0);

  // per-tree TRUNK variance — `trunkVar` scales how much each tree's
  // baseR / topR / bareFrac jitters BELOW the slider value. DOWN-biased
  // only (variance never thickens a trunk, never lengthens the bare zone).
  // The slider value sets the MAXIMUM thickness; variance gives some
  // trees thinner trunks. Net effect: more visible needles per trunk-area
  // because no tree blows out wider than the chosen base.
  const v = p.trunkVar;
  const baseRMul = 1 - rng() * 0.55 * v;            // [1 - 0.55v, 1]
  const topRMul  = 1 - rng() * 0.65 * v;            // [1 - 0.65v, 1]
  const bareFracJit = -rng() * 0.22 * v;            // [-0.22v, 0] — only SHORTER bare
  const treeBaseR = Math.max(0.04, p.trunkBaseR * baseRMul);
  const treeTopR  = Math.max(0.02, p.trunkTopR  * topRMul);
  const treeBareFrac = THREE.MathUtils.clamp(p.trunkBareFrac + bareFracJit, 0.05, 0.85);

  // a tree's "growth wind" — windward branches end up shorter.
  const windAz = rng() * Math.PI * 2;

  const b = new Builder();

  // ---- TRUNK: one tapered cylinder. (6-radial, 1-segment → ~26 v / 30 tris.)
  // CylinderGeometry has independent top/bottom radii — get free taper.
  // We use the shared unit _cyl above and scale uniformly; for taper we
  // recreate a dedicated geo with the right ratio. One geo per tree is cheap.
  {
    const taper = new THREE.CylinderGeometry(treeTopR, treeBaseR, 1, 6, 1);
    taper.deleteAttribute('uv');
    _q.setFromUnitVectors(_YUP, trunkDir);
    _p.copy(trunkBase).addScaledVector(trunkDir, H * 0.5);
    _s.set(1, H, 1);
    _m.compose(_p, _q, _s);
    let g = taper.clone().applyMatrix4(_m);
    taper.dispose();
    if (g.index) {
      const flat = g.toNonIndexed();
      g.dispose();
      g = flat;
    }
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    // gradient bark — verts above the midpoint use bHigh, below use bLow.
    // (after applyMatrix4 we read y to decide.)
    const pos = g.attributes.position.array;
    for (let i = 0; i < n; i++) {
      const yFrac = (pos[i * 3 + 1] - trunkBase.y) / Math.max(1e-3, H);
      const col = mix(bLow, bHigh, Math.max(0, Math.min(1, yFrac)));
      c[i*3] = col[0]; c[i*3+1] = col[1]; c[i*3+2] = col[2];
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    b.parts.push(g);
  }

  // ---- BRANCHES: N primary branches, each ONE 2-tri card oriented along
  // the branch direction. Bare lower trunk (per the references) — branches
  // emerge from yMin = treeBareFrac * H upward.
  const N = Math.max(4, p.branchCount | 0);
  const yMin = treeBareFrac * H;
  const yMax = H * 0.97;

  // remember branch tips so we can hang pine cones from them after the loop.
  const branchTips = [];

  for (let i = 0; i < N; i++) {
    const t = i / Math.max(1, N - 1);          // 0 at base of crown → 1 at top
    const y = yMin + (yMax - yMin) * t;
    const trunkPoint = new THREE.Vector3().copy(trunkBase).addScaledVector(trunkDir, y);

    // azimuth: golden-angle stagger so adjacent branches don't stack, PLUS
    // random jitter so it doesn't look mechanical.
    const az = i * 2.39996 + (rng() - 0.5) * 0.9;

    // pitch: pine umbrella — lower branches near-horizontal, upper branches
    // tilt up (the candelabra apex). Slight per-branch jitter.
    const pitch = THREE.MathUtils.lerp(0.05, 0.85, t) + (rng() - 0.5) * 0.22;
    const horiz = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const branchDir = new THREE.Vector3(
      horiz.x * Math.cos(pitch),
      Math.sin(pitch),
      horiz.z * Math.cos(pitch),
    ).normalize();

    // length curve: umbrella peaks mid-crown, cone peaks at the BASE.
    // `coneShape` blends between them — 0 = umbrella, 1 = aggressive cone.
    // Aggressive cone uses a POWER curve (steeper than linear) AND a
    // bottom-bias multiplier so the BASE branches actually grow longer at
    // high coneShape, not just the top shrinking. At coneShape=1 the
    // base/apex length ratio reaches ~6× — readable spruce silhouette.
    const cs = p.coneShape;
    const umbrella = Math.max(0.35, 1 - Math.abs(t - 0.40) * 1.3);
    const coneCurve = Math.pow(Math.max(0.05, 1 - t * 0.93), 1 - cs * 0.35);
    const lenCurve = umbrella * (1 - cs) + coneCurve * cs;
    const baseMul = 1 + cs * 0.55 * (1 - t);                 // base branches actually grow
    const baseLen = p.branchScale * lenCurve * baseMul;
    // wind asymmetry: windward branches shorter, leeward longer.
    const angleToWind = Math.cos(az - windAz);
    const windFactor = 1 - p.windStrength * angleToWind * 0.5;
    // per-branch length jitter — knob-controlled "messy" amount.
    const jitter = 1 + (rng() - 0.5) * p.branchLenJitter;
    const len = baseLen * windFactor * jitter;

    // crown skew: upper crown drifts horizontally (lee direction) to break
    // the perfect cone. Lower branches stay anchored.
    const skewAz = windAz + Math.PI;
    const skewAmt = p.crownSkew * t * H * 0.15;
    const branchOrigin = trunkPoint.clone()
      .addScaledVector(new THREE.Vector3(Math.cos(skewAz), 0, Math.sin(skewAz)), skewAmt);

    const branchTip = branchOrigin.clone().addScaledVector(branchDir, len);
    const branchCenter = branchOrigin.clone().lerp(branchTip, 0.5);

    // primary branch. The old single-card method remains available as a
    // benchmark baseline, but the default is a cheap tapered tube so side
    // views keep volume.
    const taperPow = Math.pow(1 - t, 0.55);
    const taperMul = 1 + taperPow * p.branchTaper * 2.2;
    const branchW = p.branchWidth * taperMul;
    const barkCol = mix(bLow, bHigh, 0.6 + (rng() - 0.5) * 0.1);
    if (p.branchModel === 'flatCards') {
      b.card(branchCenter, branchDir, len, branchW, barkCol);
    } else if (p.branchModel === 'crossCards') {
      b.card(branchCenter, branchDir, len, branchW * 0.85, barkCol, 0);
      b.card(branchCenter, branchDir, len, branchW * 0.70, barkCol, Math.PI * 0.5);
    } else {
      const baseRad = THREE.MathUtils.clamp(branchW * 0.24, 0.012, 0.16);
      const tipRad = THREE.MathUtils.clamp(baseRad * (0.26 + 0.16 * t), 0.006, baseRad * 0.7);
      b.taperedCyl(branchCenter, branchDir, len, baseRad, tipRad, barkCol, 5);
    }

    // ---- FOLIAGE: selectable benchmark method.
    // `none` lets us tune the woody skeleton first. `legacyCards` keeps the
    // rejected pom-card path for comparison. The two serious contenders are:
    //   branchlets   — sheet-only needle sprays attached along primaries
    //   volumeClumps — low-poly shaded octahedra, real 3D volume
    const pDir = pickTint(rng);
    const pAmt = p.pomTint;
    const pDark = tinted(nDark, pDir, pAmt);
    const pMid  = tinted(nMid,  pDir, pAmt);
    const pLite = tinted(nLite, pDir, pAmt);

    // size factor: BOTH ends move. At t=0 (base) the multiplier is
    // (1 + pomTaper * 1.4), at t=1 (apex) it's (0.2 + 0.8 * (1-pomTaper))
    // so the apex SHRINKS hard as pomTaper rises — base/apex ratio reaches
    // ~10× at pomTaper=1. Without this the foliage envelope was always fat
    // even at coneShape=1.
    const taperFactor = Math.pow(1 - t, 0.6);                 // 1→0 along trunk
    const apexShrink = 1 - p.pomTaper * 0.8 * (1 - taperFactor);
    const baseGrow   = 1 + p.pomTaper * 1.4 * taperFactor;
    const pomTrunkBias = apexShrink * baseGrow;

    const densityBias = 0.4 + 0.6 * taperFactor;              // apex gets ~40% as many
    const baseClumps = Math.max(1, Math.round(p.pomDensity * Math.max(1, len * 0.50) * densityBias));
    const side = new THREE.Vector3().crossVectors(branchDir, _YUP);
    if (side.lengthSq() < 1e-4) side.set(Math.cos(az + Math.PI * 0.5), 0, Math.sin(az + Math.PI * 0.5));
    side.normalize();

    const colorAt = (u, litBias = 0) => {
      const c = Math.max(0, p.contrast);
      const target = 0.50 + ((u + litBias) - 0.50) * c + (rng() - 0.5) * 0.05 * c;
      const colorU = THREE.MathUtils.clamp(target, 0, 1);
      return colorU < 0.5
        ? mix(pDark, pMid, colorU * 2)
        : mix(pMid, pLite, (colorU - 0.5) * 2);
    };

    if (p.foliageModel === 'legacyCards') {
      for (let cI = 0; cI < baseClumps; cI++) {
        const u = (cI + 0.45) / baseClumps;
        const clumpCenter = branchOrigin.clone().addScaledVector(branchDir, len * u);
        const branchBias = 0.55 + 0.55 * u;
        const cSize = p.pomSize * pomTrunkBias * branchBias * (0.80 + rng() * 0.40);
        const ang = p.pomAngle;
        for (let k = 0; k < 2; k++) {
          const azBase = (k / 2) * Math.PI;
          const azJit = (rng() - 0.5) * (0.4 + ang * 1.4);
          const cardAz = azBase + azJit;
          const pitch = 0.15 + ang * 0.18 + (rng() - 0.5) * ang * 1.4;
          const cardDir = new THREE.Vector3(
            Math.cos(cardAz) * Math.cos(pitch),
            Math.sin(pitch),
            Math.sin(cardAz) * Math.cos(pitch),
          ).normalize();
          b.card(clumpCenter, cardDir, cSize, cSize * 0.95, colorAt(k === 0 ? 0.75 : 0.25, u * 0.15), rng() * Math.PI);
        }
      }
    } else if (p.foliageModel === 'volumeClumps') {
      const clumpsHere = Math.max(1, Math.round(baseClumps * 0.75));
      for (let cI = 0; cI < clumpsHere; cI++) {
        const u = (cI + 0.55) / clumpsHere;
        const clumpCenter = branchOrigin.clone().addScaledVector(branchDir, len * u)
          .addScaledVector(side, (rng() - 0.5) * p.pomSize * 0.18);
        const branchBias = 0.55 + 0.55 * u;
        const cSize = p.pomSize * pomTrunkBias * branchBias * (0.72 + rng() * 0.36);
        b.oct(clumpCenter, cSize * 0.52, 0.85 + rng() * 0.55, colorAt(0.48 + u * 0.28, 0.05), rng() * Math.PI);
      }
    } else if (p.foliageModel !== 'none') {
      const twigsHere = Math.max(1, Math.min(5, Math.round(baseClumps * 0.82)));
      for (let cI = 0; cI < twigsHere; cI++) {
        const u = (cI + 0.65) / (twigsHere + 0.25);
        const twigBase = branchOrigin.clone().addScaledVector(branchDir, len * u);
        const branchBias = 0.52 + 0.62 * u;
        const cSize = p.pomSize * pomTrunkBias * branchBias * (0.78 + rng() * 0.36);
        const sideSign = rng() < 0.5 ? -1 : 1;
        const twigDir = branchDir.clone()
          .multiplyScalar(0.25 + rng() * 0.28)
          .addScaledVector(side, sideSign * (0.55 + rng() * 0.35))
          .addScaledVector(_YUP, -0.34 - 0.22 * (1 - t) - rng() * 0.16)
          .normalize();
        const twigLen = Math.max(0.34, cSize * (0.95 + rng() * 0.55));
        const sprayCenter = twigBase.clone().addScaledVector(twigDir, twigLen * 0.78);
        const needleLen = twigLen * (0.72 + rng() * 0.40);
        const needleW = cSize * (0.23 + p.pomAngle * 0.22);
        const sprayA = twigDir.clone().addScaledVector(_YUP, -0.10 - p.pomAngle * 0.16).normalize();
        const sprayB = twigDir.clone().addScaledVector(side, -sideSign * (0.18 + p.pomAngle * 0.28)).normalize();
        b.card(sprayCenter, sprayA, needleLen, needleW, colorAt(0.62 + u * 0.18, 0.04), rng() * Math.PI);
        b.card(sprayCenter.clone().addScaledVector(side, sideSign * needleW * 0.20),
          sprayB, needleLen * 0.78, needleW * 0.68, colorAt(0.38 + u * 0.20, -0.03), rng() * Math.PI);
      }
    }

    // store tip for cone attachment after the branch loop
    branchTips.push({ tip: branchTip.clone(), branchDir: branchDir.clone(), t });
  }

  // ---- PINE CONES — ~50% of trees (tunable via `coneChance`) carry small
  // hanging cones near branch tips in the UPPER crown. Each cone is a
  // single 2-tri card pointed mostly downward (long axis ≈ vertical, narrow
  // width) — reads as a cone silhouette without any actual cone geometry.
  // Cheap (≤6 cones × 2 tris = ~12 tris per tree max).
  if (rng() < p.coneChance) {
    const upperTips = branchTips.filter((bt) => bt.t > 0.45);
    const numCones = Math.min(upperTips.length, 1 + Math.floor(rng() * 4));
    for (let cI = 0; cI < numCones; cI++) {
      const bt = upperTips[(rng() * upperTips.length) | 0];
      // hang slightly below the tip, jittered
      const conePos = bt.tip.clone()
        .addScaledVector(bt.branchDir, -0.18 - rng() * 0.25)
        .add(new THREE.Vector3(0, -0.35 - rng() * 0.3, 0));
      const cSize = p.coneSize * (0.75 + rng() * 0.45);
      const coneCol = mix(CONE_LOW, CONE_HIGH, rng());
      // mostly down + tiny lateral drift so cones don't all align
      const coneDir = new THREE.Vector3(
        (rng() - 0.5) * 0.25, -1, (rng() - 0.5) * 0.25,
      ).normalize();
      b.card(conePos, coneDir, cSize, cSize * 0.42, coneCol);
    }
  }

  const mesh = b.finish('Pine', true);
  const group = new THREE.Group();
  if (mesh) group.add(mesh);
  // sway deferred (per the plan — tune static shape first). Stub a no-op
  // entry so the workshop's tick treats this consistently with palm.
  group.userData.sway = { amp: 0, speed: 0, phase: rng() * 6.28, crown: null };
  group.userData.stats = {
    tris: mesh ? Math.round((mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3) : 0,
    branchModel: p.branchModel,
    foliageModel: p.foliageModel,
  };
  group.name = 'Pine';
  return group;
}

// ---- params + meta + sections (sim-grammar) ----------------------------
export const PINE_CLASS = {
  label: 'Scots Pine',
  make: pine,
  enums: {
    branchModel: {
      label: 'Branch method',
      hint: 'benchmark woody skeleton construction',
      default: 'tubes',
      options: [
        { value: 'tubes', label: 'tapered tubes' },
        { value: 'crossCards', label: 'cross cards' },
        { value: 'flatCards', label: 'flat cards' },
      ],
    },
    foliageModel: {
      label: 'Foliage method',
      hint: 'benchmark needle mass before reintegration',
      default: 'branchlets',
      options: [
        { value: 'branchlets', label: 'branchlets' },
        { value: 'volumeClumps', label: 'volume clumps' },
        { value: 'legacyCards', label: 'legacy cards' },
        { value: 'none', label: 'none' },
      ],
    },
  },
  params: {
    // defaults baked from user's MOST-RECENT tuned screenshot.
    // Foliage section was the most-tuned: pomSize=0.60, pomTaper=1.00,
    // pomDensity=2.06, coneChance=1.00, coneSize=0.54.
    // Shading: contrast=0.00, colorVar=1.00, pomTint=1.00 (per-tree +
    // per-pom variance handles the diversity, within-clump variation OFF).
    // Other sections unchanged from previous defaults.
    height:           [8, 26, 25.5],
    trunkBaseR:       [0.12, 0.65, 0.65],
    trunkTopR:        [0.04, 0.30, 0.10],
    trunkBareFrac:    [0.20, 0.70, 0.46],
    trunkVar:         [0, 1, 0.56],
    leanAngle:        [0, 0.4, 0.11],
    branchCount:      [8, 22, 19],
    branchScale:      [1.5, 6.5, 3.5],
    branchWidth:      [0.04, 0.40, 0.13],
    branchTaper:      [0, 1, 0.62],
    branchLenJitter:  [0, 0.5, 0.41],
    coneShape:        [0, 1, 1.0],
    // pomSize range opened down to 0.15 (user said <1.0 is useful);
    // ceiling lowered too because >2.0 was making fat-cloud trees.
    pomSize:          [0.15, 2.0, 0.60],
    pomTaper:         [0, 1, 1.0],
    pomDensity:       [0.6, 3.5, 2.06],
    pomAngle:         [0, 1, 0.35],
    coneChance:       [0, 1, 1.0],
    coneSize:         [0.2, 1.6, 0.54],
    windStrength:     [0, 0.8, 0.30],
    crownSkew:        [0, 0.4, 0.18],
    colorVar:         [0, 1, 1.0],
    pomTint:          [0, 1, 1.0],
    // contrast reworked: now `within-clump variation amount`. 0 = uniform
    // mid (the user's preferred baseline — colorVar+pomTint carry the
    // diversity), 1 = noticeable lit/shadow split with lite tips, 1.5 =
    // exaggerated. Default 0 matches the user's screenshot.
    contrast:         [0, 1.5, 0.0],
  },
  // `rand` per param: SAFE range R uses for full randomize. Narrower than
  // the param's full slider range so randomize doesn't produce broken trees
  // (e.g. trunkBareFrac at 0.70 makes the tree mostly bare trunk — slider
  // can reach it for manual tuning, R won't roll into that zone).
  meta: {
    height:          { label: 'Height',         hint: 'trunk length — per-tree ±12 % jitter', unit: 'm',
                       rand: [16, 24] },
    trunkBaseR:      { label: 'Trunk base',     hint: 'radius at the soil line · trunkVar jitters per tree', unit: 'm',
                       rand: [0.32, 0.60] },
    trunkTopR:       { label: 'Trunk top',      hint: 'radius below the apex · trunkVar jitters per tree', unit: 'm',
                       rand: [0.06, 0.18] },
    trunkBareFrac:   { label: 'Bare trunk',     hint: 'fraction below first branch · trunkVar jitters per tree',
                       rand: [0.38, 0.55] },
    trunkVar:        { label: 'Trunk variance', hint: 'per-tree DOWN-bias for baseR / topR / bareFrac · slider sets max, variance only shrinks',
                       rand: [0.40, 0.75] },
    leanAngle:       { label: 'Lean range',     hint: 'max trunk lean ± · random per tree', unit: 'rad',
                       rand: [0.05, 0.22] },
    branchCount:     { label: 'Branch count',   hint: 'primary branches per tree', isInt: true,
                       rand: [15, 21] },
    branchScale:     { label: 'Branch length',  hint: 'max primary length',
                       rand: [3.0, 4.5] },
    branchWidth:     { label: 'Branch width',   hint: 'apex branch thickness · branchTaper scales the base up',
                       rand: [0.08, 0.20] },
    branchTaper:     { label: 'Branch taper',   hint: 'lower branches thicker — POWER curve · 0=uniform, 1=base 3× apex',
                       rand: [0.50, 0.90] },
    branchLenJitter: { label: 'Length jitter',  hint: 'per-branch random length variation',
                       rand: [0.20, 0.50] },
    coneShape:       { label: 'Cone shape',     hint: '0 = umbrella · 1 = sharp spruce cone (base grows, apex shrinks)',
                       rand: [0.70, 1.0] },
    pomSize:         { label: 'Foliage size',   hint: 'needle mass base size · useful range <1.0',
                       rand: [0.35, 0.80] },
    pomTaper:        { label: 'Foliage taper',  hint: 'base BIG · apex SMALL · ratio up to 10× at 1.0',
                       rand: [0.70, 1.0] },
    pomDensity:      { label: 'Foliage density', hint: 'branchlets/clumps per unit branch length',
                       rand: [1.2, 2.2] },
    pomAngle:        { label: 'Foliage angle',  hint: 'spray/card pitch + yaw spread',
                       rand: [0.20, 0.60] },
    coneChance:      { label: 'Pine-cone trees', hint: 'fraction of trees that grow pine cones · per-tree roll',
                       rand: [0.30, 0.85] },
    coneSize:        { label: 'Pine-cone size',  hint: 'how big the hanging cone reads',
                       rand: [0.40, 0.75] },
    windStrength:    { label: 'Wind shaping',   hint: 'windward branches shorter · lee longer',
                       rand: [0.10, 0.40] },
    crownSkew:       { label: 'Crown skew',     hint: 'upper crown drifts off-axis (lee direction)',
                       rand: [0.05, 0.25] },
    colorVar:        { label: 'Color variance', hint: 'per-tree palette hue jitter across the matrix',
                       rand: [0.60, 1.0] },
    pomTint:         { label: 'Pom-pom tint',   hint: 'per-pom random palette shift · breaks the uniform-canopy look',
                       rand: [0.60, 1.0] },
    contrast:        { label: 'Contrast',       hint: 'within-clump lit/shadow split · 0 = uniform mid, 1 = base, 1.5 = high-key',
                       rand: [0.0, 0.7] },
  },
  sections: [
    { icon: '◇', label: 'method',    blurb: 'benchmark branch + foliage construction', enumKeys: ['branchModel', 'foliageModel'],                                       accent: 'info' },
    { icon: '┃', label: 'trunk',     blurb: 'lean + radius + bare + per-tree variance',     keys: ['height', 'trunkBaseR', 'trunkTopR', 'trunkBareFrac', 'trunkVar', 'leanAngle'],                                accent: 'structural' },
    { icon: '⌇', label: 'branches',  blurb: 'count + length + thickness taper + cone',       keys: ['branchCount', 'branchScale', 'branchWidth', 'branchTaper', 'branchLenJitter', 'coneShape'],                  accent: 'flora' },
    { icon: '✺', label: 'foliage',   blurb: 'clumps along the branch (size + density + angle)', keys: ['pomSize', 'pomTaper', 'pomDensity', 'pomAngle', 'coneChance', 'coneSize'],                                accent: 'seasons' },
    { icon: '⌖', label: 'asymmetry', blurb: 'wind + skew · breaks the perfect cone',         keys: ['windStrength', 'crownSkew'],                                                                                 accent: 'motion' },
    { icon: '✦', label: 'shading',   blurb: 'moody blue-green · contrast + per-tree variance',keys: ['contrast', 'colorVar', 'pomTint'],                                                                          accent: 'shading' },
  ],
};

export function classDefaults() {
  const out = {};
  for (const [k, spec] of Object.entries(PINE_CLASS.enums || {})) {
    const first = spec.options?.[0];
    out[k] = spec.default ?? (typeof first === 'object' ? first.value : first);
  }
  for (const [k, [, , def]] of Object.entries(PINE_CLASS.params)) out[k] = def;
  return out;
}

export function makePine(seed, overrides) {
  return PINE_CLASS.make(mulberry32((seed >>> 0) || 1), { ...classDefaults(), ...(overrides || {}) });
}
