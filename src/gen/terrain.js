// Island generation (PLAN.md §5, Phase-1 subset):
//   1. island mask     — noise-warped radial falloff → bounded coastline
//   2. macro relief     — domain-warped fBm  +  ridged multifractal spines
//   3. beach / sea split — clean waterline ring, sloping blue seafloor
//   4. material channel  — sand / rock / grass / snow / grassy-snow / autumn / seafloor
//   5. season channel    — monotonic gradient (gen/seasons.js)
// Erosion, terracing-as-pass and carved cliffs are Phase 2; the stepped
// voxel look comes from height quantization in the mesher (vstep).

import { fbm2, ridgedFbm2, mulberry32, lerp, valueNoise2 } from './noise.js';
import { SparseVolume } from '../voxel/SparseVolume.js';
import { MAT } from './palette.js';
import { makeSeasonField, SEASON } from './seasons.js';

export function generateIsland(opts) {
  const {
    seed, radius, shape, resolution, lowland, massif, massifSharpness,
    massifOffsetX, massifOffsetZ, terraceStep, warp, ridge, beachWidth,
    valleyDepth, valleyWidth, seaLevel, floorDepth, floorShape, floorRoughness,
    deltaFloor, seasons, lagoon,
  } = opts;

  // Decoupled relief: `lowland` is the rolling-hill amplitude of the bulk of
  // the island; `massif` is the localized mountain uplift on top. maxHeight
  // is just their sum, used for normalisation (snow line etc).
  const maxHeight = lowland + massif;
  const peakSharp = Math.max(0.45, massifSharpness ?? 1);
  const peakOffsetX = Math.max(-0.45, Math.min(0.45, massifOffsetX ?? 0)) * radius;
  const peakOffsetZ = Math.max(-0.45, Math.min(0.45, massifOffsetZ ?? 0)) * radius;
  const seaShelfPow = Math.max(0.35, floorShape ?? 0.85);
  const seaRough = Math.max(0, floorRoughness ?? 1);
  const deltaFollow = Math.max(0, Math.min(1, deltaFloor ?? 0));

  // Must comfortably exceed the island so it isn't clipped AND leaves a
  // seafloor ring for the circular opacity fade to dissolve.
  const worldSize = radius * 2.3;
  const cellSize = worldSize / resolution;
  const vstep = terraceStep > 0 ? terraceStep : Math.max(1.5, cellSize * 0.85);

  const vol = new SparseVolume({ resolution, worldSize, vstep });
  const seasonAt = makeSeasonField(seasons, seed);

  // Macro elevation (metres above an arbitrary land datum), shared by the
  // cell and its neighbours so we can estimate slope by finite difference.
  const fScale = 0.0015;

  // ---- island-shape archetype --------------------------------------------
  // shape: 0 auto (seed-picked → reseeds already diversify) · 1 round ·
  // 2 crescent · 3 long · 4 lobed. All seed-randomised in orientation so two
  // "long" islands still differ.
  const srng = mulberry32((seed * 2654435761) >>> 0);
  const SH = (shape >= 1 && shape <= 4)
    ? shape
    : 1 + Math.floor(mulberry32((seed * 40503) >>> 0)() * 4);
  const shRot = srng() * Math.PI * 2;
  const cRot = Math.cos(shRot), sRot = Math.sin(shRot);
  const elong = 1.55 + srng() * 0.55;             // long: stretch factor
  const lobeK = 3 + Math.floor(srng() * 3);       // lobed: 3..5 peninsulas
  const lobePhase = srng() * Math.PI * 2;
  const lobeAmp = 0.17 + srng() * 0.10;
  const bayAng = srng() * Math.PI * 2;            // crescent: bay direction
  const bayDist = radius * (0.52 + srng() * 0.18);
  const bayR = radius * (0.50 + srng() * 0.22);
  const bx = Math.cos(bayAng) * bayDist, bz = Math.sin(bayAng) * bayDist;

  // Irregular coastline mask: one connected landmass, but with real bays,
  // headlands and a peninsula or two — modulated by the archetype. >0.5 land,
  // 0.5 = waterline. Low-frequency so the mass stays connected.
  function coast(x, z) {
    const lx = x * cRot - z * sRot;               // shape-local frame
    const lz = x * sRot + z * cRot;
    const rr = SH === 3 ? Math.hypot(lx / elong, lz) : Math.hypot(lx, lz);
    const wob = fbm2(x * 0.0010 + 4.2, z * 0.0010 - 7.8, { seed: seed + 5, octaves: 4, warp: 0.55 });
    const lobes = fbm2(x * 0.0026 - 2.1, z * 0.0026 + 5.4, { seed: seed + 23, octaves: 3, warp: 0.4 }) - 0.5;
    let effR = radius * (0.74 + 0.46 * (wob - 0.5) + 0.16 * lobes);
    if (SH === 4) {                               // angular radius lobing
      const ang = Math.atan2(lz, lx);
      effR *= 1 + lobeAmp * Math.cos(lobeK * ang + lobePhase + (wob - 0.5) * 1.5);
    }
    // Wide transition band so land can emerge gradually → room for long beaches.
    let land = 1 - smooth01(0.45, 1.04, rr / Math.max(1, effR));
    if (SH === 2) {                               // carve a bay → C-shape
      const bd = Math.hypot(x - bx, z - bz);
      land *= smooth01(bayR * 0.45, bayR * 1.0, bd);
    }
    return land;
  }

  // Shore profile: 0 = sea-cliff stretch, 1 = gentle long-beach stretch.
  // Low-frequency so each side of the island is consistently one or the
  // other; tuned so ~60% of the coast is gentle, ~40% cliff.
  function shoreType(x, z) {
    const n = fbm2(x * 0.0016 + 31.7, z * 0.0016 - 12.3,
      { seed: seed + 131, octaves: 3, warp: 0.45 });
    return Math.max(0, Math.min(1, (n - 0.34) / 0.5));
  }

  // One dominant massif + 0–2 minor spurs, constrained so seed-to-seed
  // variance is low (most seeds read as "a lush island with a mountain").
  const peaks = (() => {
    const rnd = mulberry32((seed * 911) >>> 0);
    const out = [];
    const a0 = rnd() * Math.PI * 2;
    const d0 = radius * (0.08 + rnd() * 0.24);          // off-centre, off the rim
    out.push({
      cx: Math.cos(a0) * d0 + peakOffsetX, cz: Math.sin(a0) * d0 + peakOffsetZ,
      h: massif * (0.80 + rnd() * 0.16), sig: radius * (0.13 + rnd() * 0.05),
      rot: rnd() * Math.PI * 2, sk: rnd(), spur: 3 + Math.floor(rnd() * 4),
    });
    const minor = (rnd() < 0.55 ? 1 : 0) + (rnd() < 0.25 ? 1 : 0);
    for (let k = 0; k < minor; k++) {
      const a = a0 + (rnd() - 0.5) * 2.6;
      const dd = radius * (0.22 + rnd() * 0.30);
      out.push({
        cx: Math.cos(a) * dd + peakOffsetX, cz: Math.sin(a) * dd + peakOffsetZ,
        h: massif * (0.20 + rnd() * 0.20), sig: radius * (0.09 + rnd() * 0.05),
        rot: rnd() * Math.PI * 2, sk: rnd(), spur: 3 + Math.floor(rnd() * 3),
      });
    }
    return out;
  })();

  // A massif is a Gaussian ENVELOPE × ridged-multifractal × radial spur
  // ridges — a real mountain with descending ridgelines and gullies, not a
  // smooth caldera cone. Slope-driven rock/snow then reads it as a mountain.
  function massifAt(x, z) {
    let m = 0;
    for (const p of peaks) {
      const dx = x - p.cx, dz = z - p.cz;
      const g = Math.exp(-(dx * dx + dz * dz) / (2 * p.sig * p.sig));
      if (g < 0.0025) continue;
      const env = Math.pow(g, 1.22 * peakSharp);        // peakier than a dome
      const cr = Math.cos(p.rot), sr = Math.sin(p.rot);
      const lx = dx * cr - dz * sr, lz = dx * sr + dz * cr;
      const rg = ridgedFbm2(lx * 0.011 + p.sk * 7, lz * 0.011 - p.sk * 4,
        { seed: seed + 17 + ((p.cx | 0) & 255), octaves: 5, warp: 0.55 });
      const ang = Math.atan2(lz, lx);
      const spurs = 0.5 + 0.5 * Math.cos(ang * p.spur + rg * 3.0);
      // Multiplier averages ~0.8 and peaks ~1.15 so the summit reaches ≈p.h,
      // not 2×; ridges/spurs carve relief without inflating overall height.
      m += p.h * env * (0.50 + 0.50 * rg) * (0.85 + 0.30 * spurs);
    }
    return m;
  }

  // ---- carved valley / gully + river delta -------------------------------
  // A seeded meandering channel from the massif out to the coast, SUBTRACTED
  // from the already-built surface (post-build carve) so its banks pick up
  // slope→rock automatically and, near the mouth, the floor dips below sea
  // level → the Sea floods it into a river delta.
  const hasChannel = valleyDepth > 0;
  const channelPaths = [];
  if (hasChannel) {
    const crng = mulberry32(((seed * 2246822519) >>> 0) ^ 0x9e3779b1);
    const p0 = peaks[0] || { cx: 0, cz: 0 };
    const Sx = p0.cx * 0.6 + (crng() - 0.5) * radius * 0.12;
    const Sz = p0.cz * 0.6 + (crng() - 0.5) * radius * 0.12;
    const baseAng = Math.atan2(Sz, Sx) + (crng() - 0.5) * 1.6;   // flow outward
    const dirx = Math.cos(baseAng), dirz = Math.sin(baseAng);
    const perpx = -dirz, perpz = dirx;
    const reach = radius * 1.20;
    const NS = 48;
    const main = [];
    for (let s = 0; s <= NS; s++) {
      const t = s / NS;
      const along = t * reach;
      const meander = (fbm2(t * 2.6 + 11.3, 7.7, { seed: seed + 201, octaves: 3 }) - 0.5)
        * radius * 0.55 * (0.2 + t);
      main.push({ x: Sx + dirx * along + perpx * meander,
                  z: Sz + dirz * along + perpz * meander, t });
    }
    channelPaths.push(main);
    // Delta: two distributary branches diverging near the mouth.
    const apex = main[Math.floor(NS * 0.80)];
    for (const sgn of [-1, 1]) {
      const bAng = baseAng + sgn * (0.34 + crng() * 0.26);
      const bdx = Math.cos(bAng), bdz = Math.sin(bAng);
      const blen = radius * 0.55;
      const br = [];
      for (let s = 0; s <= 16; s++) {
        const u = s / 16;
        br.push({ x: apex.x + bdx * u * blen, z: apex.z + bdz * u * blen,
                  t: 0.80 + 0.20 * u });
      }
      channelPaths.push(br);
    }
  }

  // Nearest-path Gaussian bell + its downstream param. Half-width grows
  // downstream and flares at the delta.
  function channelAt(x, z) {
    let best = 0, bt = 0;
    for (const pth of channelPaths) {
      for (let k = 0; k < pth.length; k++) {
        const p = pth[k];
        const dx = x - p.x, dz = z - p.z;
        const hw = valleyWidth * (0.5 + 1.7 * p.t)
          + (p.t > 0.78 ? valleyWidth * 2.4 * (p.t - 0.78) / 0.22 : 0);
        const f = Math.exp(-(dx * dx + dz * dz) / (hw * hw));
        if (f > best) { best = f; bt = p.t; }
      }
    }
    return { field: best, t: bt };
  }
  function channelCarve(x, z) {
    if (!hasChannel) return 0;
    const { field, t } = channelAt(x, z);
    if (field < 0.02) return 0;
    const prof = 0.32 + 0.68 * smooth01(0.0, 0.42, t);   // shallow source → deep valley
    return valleyDepth * prof * field;
  }

  // ---- inland lagoon ------------------------------------------------------
  // Separate from the mountain valley/delta. It carves a mostly enclosed
  // shallow bowl below sea datum so the existing water disc fills it, then
  // marks a white-sand apron for palms/fringe trees.
  const lagoonCfg = lagoon || {};
  const lagoonOn = lagoonCfg.enable !== false;
  const lagoonRx = Math.max(8, lagoonCfg.radiusX ?? 230);
  const lagoonRz = Math.max(8, lagoonCfg.radiusZ ?? 135);
  const lagoonApron = Math.max(0, lagoonCfg.apronWidth ?? 42);
  const lagoonDepth = Math.max(0.1, lagoonCfg.depth ?? 1.4);
  const lagoonLowlandCap = Math.max(0, lagoonCfg.lowlandCap ?? 54);
  const lagoonWhiteSand = Math.max(0, Math.min(1, lagoonCfg.whiteSand ?? 0.9));
  const lagoonInlet = Math.max(0, Math.min(1, lagoonCfg.inlet ?? 0.12));
  const lagoonCx = Math.max(-0.55, Math.min(0.55, lagoonCfg.x ?? 0.24)) * radius;
  const lagoonCz = Math.max(-0.55, Math.min(0.55, lagoonCfg.z ?? -0.12)) * radius;
  const lagoonRot = ((lagoonCfg.rotation ?? -24) * Math.PI) / 180;
  const lagoonCa = Math.cos(lagoonRot), lagoonSa = Math.sin(lagoonRot);
  const outLen = Math.hypot(lagoonCx, lagoonCz) || 1;
  const inletDx = lagoonCx / outLen;
  const inletDz = lagoonCz / outLen;
  const inletStartX = lagoonCx + inletDx * Math.max(lagoonRx, lagoonRz) * 0.48;
  const inletStartZ = lagoonCz + inletDz * Math.max(lagoonRx, lagoonRz) * 0.48;
  const inletEndX = inletDx * radius * 1.05;
  const inletEndZ = inletDz * radius * 1.05;
  const inletLen2 = Math.max(1, (inletEndX - inletStartX) ** 2 + (inletEndZ - inletStartZ) ** 2);

  function lagoonAt(x, z) {
    if (!lagoonOn) return { water: 0, apron: 0, inlet: 0, d: 999 };
    const dx = x - lagoonCx, dz = z - lagoonCz;
    const lx = dx * lagoonCa + dz * lagoonSa;
    const lz = -dx * lagoonSa + dz * lagoonCa;
    const d = Math.hypot(lx / lagoonRx, lz / lagoonRz);
    const water = 1 - smooth01(0.84, 1.0, d);
    const apronOuter = 1 + lagoonApron / Math.max(lagoonRx, lagoonRz);
    const apron = smooth01(0.90, 1.02, d) * (1 - smooth01(1.0, apronOuter, d));

    let inlet = 0;
    if (lagoonInlet > 0.001) {
      const px = x - inletStartX, pz = z - inletStartZ;
      const sx = inletEndX - inletStartX, sz = inletEndZ - inletStartZ;
      const t = Math.max(0, Math.min(1, (px * sx + pz * sz) / inletLen2));
      const qx = inletStartX + sx * t, qz = inletStartZ + sz * t;
      const dist = Math.hypot(x - qx, z - qz);
      const width = 3 + lagoonInlet * 24;
      inlet = (1 - smooth01(width * 0.35, width, dist)) * smooth01(0.04, 0.9, t);
    }
    return { water, apron, inlet, d };
  }

  function lagoonLowlandFade(rawH) {
    if (!lagoonOn || lagoonLowlandCap <= 0) return 1;
    const rise = rawH - seaLevel;
    return 1 - smooth01(lagoonLowlandCap * 0.62, lagoonLowlandCap, rise);
  }

  function lagoonSurfaceAt(x, z, rawH) {
    const l = lagoonAt(x, z);
    const carve = Math.max(l.water, l.inlet * 0.95) * lagoonLowlandFade(rawH);
    if (carve <= 0) return rawH;
    const bowl = Math.max(l.water, 0.35 + l.inlet * 0.35);
    const target = seaLevel - lagoonDepth * (0.28 + 0.72 * bowl);
    return rawH * (1 - carve) + Math.min(rawH, target) * carve;
  }

  function surfaceAt(x, z) {
    const c = coast(x, z);
    if (c > 0.5) {
      const lf = (c - 0.5) * 2;                       // 0 shoreline → 1 inland
      const rNorm = Math.min(1, Math.hypot(x, z) / radius);
      const st = shoreType(x, z);                     // 0 cliff → 1 gentle

      // Lowland: rolling hills + ridgelines (independent of the massif).
      const base = fbm2(x * fScale, z * fScale, { seed, octaves: 5, warp });
      const ridgeN = ridgedFbm2(x * fScale * 1.7 + 9.7, z * fScale * 1.7 - 3.3,
        { seed: seed + 17, octaves: 5, warp: warp * 0.6 });
      const connect = (1 - Math.pow(rNorm, 1.5)) * lowland * 0.5;
      const relief =
        base * lowland * 0.85
        + Math.pow(ridgeN, 1.5) * lowland * 1.1 * (0.35 + ridge)
        + massifAt(x, z)                                 // localized mountain
        + connect;

      // Coastal apron: a wide, low, near-flat beach that rises only a few
      // metres over a landFrac span that is LARGE on gentle shores and tiny
      // on sea-cliff shores. Beyond the apron the land climbs into relief.
      // This is the "beach extends OUTWARD, flat, only where gradual" fix.
      const apron = lerp(0.03, 0.46, smooth01(0.30, 0.74, st));
      const aprT = Math.min(1, lf / apron);
      const aprH = smooth01(0, 1, aprT) * (beachWidth * lerp(0.35, 0.9, st));
      const beyond = smooth01(apron, Math.min(0.98, apron + 0.5), lf);
      const surf = seaLevel + 0.5 + aprH + beyond * relief;
      // Post-build carve: a notch in the highlands, dipping below sea level
      // near the mouth so the delta floods.
      return surf - channelCarve(x, z);
    }
    const seaFrac = (0.5 - c) * 2;                     // 0 at coast → 1 open sea
    const ripple = (fbm2(x * 0.01, z * 0.01, { seed: seed + 90, octaves: 3 }) - 0.5) * 4 * seaRough;
    let floor = seaLevel - 1.0 - Math.pow(seaFrac, seaShelfPow) * floorDepth + ripple;
    if (hasChannel && deltaFollow > 0) {
      const ch = channelAt(x, z);
      const mouth = smooth01(0.58, 1.0, ch.t);
      floor -= valleyDepth * deltaFollow * ch.field * mouth * 0.85;
    }
    return floor;
  }

  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      const [x, z] = vol.cellToWorld(i, j);
      const rawH = surfaceAt(x, z);
      const h = lagoonSurfaceAt(x, z, rawH);
      const idx = vol.idx(i, j);

      // Slope from finite difference of the surface (metres / metre).
      const hx = lagoonSurfaceAt(x + cellSize, z, surfaceAt(x + cellSize, z));
      const hz = lagoonSurfaceAt(x, z + cellSize, surfaceAt(x, z + cellSize));
      const slope = Math.hypot(hx - h, hz - h) / cellSize;
      const lagoonRaw = lagoonAt(x, z);
      const lagoonFade = lagoonLowlandFade(rawH);
      const lagoonInfo = {
        ...lagoonRaw,
        water: lagoonRaw.water * lagoonFade,
        apron: lagoonRaw.apron * lagoonFade,
        inlet: lagoonRaw.inlet * lagoonFade,
      };
      const lagoonWater = lagoonInfo.water > 0.08 || lagoonInfo.inlet > 0.45;
      const lagoonApronCell = !lagoonWater && lagoonInfo.apron > 0.05;

      const a = (h - seaLevel) / Math.max(1, maxHeight);   // 0 shore → ~1 peak
      const { season } = seasonAt(x, z, a);
      vol.season[idx] = season;                            // tint + tree pick ONLY

      const isLand = h > seaLevel - 0.35;
      vol.land[idx] = isLand ? 1 : 0;
      // Mark the gully/valley/delta core so the mesher can shimmer-cyan the
      // flooded stretch against the deeper-blue open ocean.
      vol.channel[idx] = ((hasChannel && channelAt(x, z).field > 0.30) || lagoonWater) ? 1 : 0;
      vol.lagoon[idx] = lagoonWater ? 1 : lagoonApronCell ? 2 : 0;
      const st = shoreType(x, z);

      // Snow line tied to the existing "Conifer line" knob (its hint already
      // says "above = winter snow caps"). Mapped BELOW the raw frac + an
      // organic altitude jitter so caps actually form with a ragged edge,
      // never a contour ring. Altitude/slope only → does NOT re-couple
      // material to season, so the neapolitan-banding fix is preserved.
      const snowJit = (fbm2(x * 0.02 + 5.1, z * 0.02 - 2.7,
        { seed: seed + 88, octaves: 3, warp: 0.4 }) - 0.5) * 0.13;
      const snowLine = (seasons.coniferEnd ?? 0.84) * 0.78;
      const aS = a + snowJit;

      // Material is DECOUPLED from season — driven by slope / height / shore.
      // So grass meets sand directly (no forced autumn ring → no neapolitan);
      // season only re-tints grass + selects trees (done in the mesher).
      let mat;
      if (lagoonWater) {
        mat = MAT.WHITE_SAND;
      } else if (!isLand) {
        mat = MAT.SEAFLOOR;
      } else if (aS > snowLine + 0.05) {
        mat = MAT.SNOW;                                     // summit cap — wins even on steep
      } else if (slope > 0.92) {
        mat = MAT.ROCK;                                     // sheer faces below the cap
      } else if (h <= seaLevel + beachWidth * 1.25 && slope < 0.34) {
        mat = MAT.SAND;                                     // flat & low = wide beach (preserved)
      } else if (h <= seaLevel + beachWidth * 0.9 && st < 0.34) {
        mat = MAT.ROCK;                                     // rocky shore on cliff stretches
      } else if (aS > snowLine - 0.06 && slope < 0.8) {
        mat = MAT.GRASSY_SNOW;                              // frosty fringe (ragged, not a ring)
      } else if (a > 0.66) {
        mat = MAT.ROCK;                                     // bare upper crags
      } else if (a > 0.5 && slope > 0.62) {
        mat = MAT.DIRT;                                     // scree / talus
      } else {
        mat = MAT.GRASS;                                    // lush — season TINTS this
      }

      // Craggy peaks: speckle ROCK through the snow zone so caps read rugged,
      // not a solid dome. valueNoise2 (≈uniform) so the knob maps ~linearly
      // to the rock fraction; craggy 0 ⇒ untouched.
      if ((mat === MAT.SNOW || mat === MAT.GRASSY_SNOW) && (seasons.craggy ?? 0) > 0) {
        const cg = valueNoise2(x * 0.085 + 2.3, z * 0.085 - 4.1, seed + 211);
        if (cg < seasons.craggy * 0.6) mat = MAT.ROCK;
      }

      // "Golf course" look — OPT-IN (fairway 0 ⇒ block skipped, so the
      // big-beach presets like A-1 stay byte-identical). A lime "greens"
      // band just inland of the sand + sparse sand-trap "bunkers". Only
      // ever rewrites GRASS on gentle, low ground — never rock/snow/beach.
      const fw = seasons.fairway ?? 0;
      if (fw > 0 && mat === MAT.GRASS && slope < 0.42) {
        // Low apron of grass just inland of the beach (no strict lower edge —
        // height bands are too seed-dependent to be reliable).
        const top = seaLevel + beachWidth * 1.25 + (seasons.fairwayBand ?? 24);
        if (h <= top) {
          const fn = fbm2(x * 0.011 + 7.7, z * 0.011 - 3.3, { seed: seed + 223, octaves: 3, warp: 0.45 });
          if (fn < 0.30 + fw * 0.62) {                       // patchy when fw < 1
            mat = MAT.FAIRWAY;
            const bs = Math.max(3, seasons.bunkerSize ?? 11);
            const bn = valueNoise2(x / bs + 41.0, z / bs - 17.0, seed + 233);
            if (bn < (seasons.bunkerDensity ?? 0) * 0.45) mat = MAT.SAND;  // sand trap
          }
        }
      }

      if (lagoonApronCell && mat !== MAT.ROCK && mat !== MAT.SNOW && mat !== MAT.GRASSY_SNOW) {
        const wn = valueNoise2(x * 0.04 + 8.7, z * 0.04 - 6.2, seed + 293);
        if (wn < lagoonWhiteSand * lagoonInfo.apron) mat = MAT.WHITE_SAND;
      }

      vol.material[idx] = mat;
      // Irregular ("randomized") terraces — perturb height before quantizing
      // so step boundaries wander organically instead of forming perfect
      // concentric contour rings.
      const tj = (fbm2(x * 0.05 + 3.1, z * 0.05 - 6.7,
        { seed: seed + 53, octaves: 3, warp: 0.5 }) - 0.5) * vstep * 1.5;
      vol.heightVox[idx] = Math.round((h + tj) / vstep);
    }
  }

  vol.meta = { seed, radius, worldSize, cellSize, vstep, seaLevel, floorDepth, maxHeight };
  return vol;
}

function smooth01(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0 || 1)));
  return t * t * (3 - 2 * t);
}
