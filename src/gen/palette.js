// Tropical RPG Warm palette (locked art direction). Colour-led, not
// texture-led: every voxel face is a flat colour drawn from a per-element
// gradient, plus a tiny per-vertex value-noise jitter baked at gen time
// (the "faceted + gradient + micro-grain" style — no fragile shader).
// No purples, nothing spacey — warm, saturated, Sonic-meets-Minecraft.

function hx(h) {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// Terrain material ids (the SparseVolume `material` channel enum).
export const MAT = {
  SAND: 0,
  SEAFLOOR: 1,
  GRASS: 2,
  GRASSY_SNOW: 3,
  SNOW: 4,
  ROCK: 5,
  DIRT: 6,
  AUTUMN: 7,
  FAIRWAY: 8,            // manicured "greens" — uniform bright lime
  WHITE_SAND: 9,         // lagoon/apron highlight sand
};

// Each material: [lowColor, highColor] — gradient runs dark/low → light/high.
const GRAD = {
  [MAT.SAND]:        [hx('#cf9a4f'), hx('#f0d089')],
  [MAT.SEAFLOOR]:    [hx('#0a4e6e'), hx('#2fd9c8')],
  [MAT.GRASS]:       [hx('#2f8a2e'), hx('#7ad83e')],
  [MAT.GRASSY_SNOW]: [hx('#5f8a55'), hx('#aecaa0')],   // sage, not near-white
  [MAT.SNOW]:        [hx('#9fc3cc'), hx('#dceef0')],   // cooler, less blinding
  [MAT.ROCK]:        [hx('#5a554b'), hx('#8a8276')],
  [MAT.DIRT]:        [hx('#6a4a2c'), hx('#a8814a')],
  [MAT.AUTUMN]:      [hx('#b5601f'), hx('#e8a52e')],   // warmer, more saturated
  [MAT.FAIRWAY]:     [hx('#5fb22a'), hx('#a6ef4e')],   // golf "greens" — crisp lime
  [MAT.WHITE_SAND]:  [hx('#d8cfad'), hx('#fff5d7')],
};

const SEAFLOOR_DEEP = hx('#05293c');   // darker deep-blue open ocean
const SEAFLOOR_MID = hx('#137a8c');
const SEAFLOOR_SHALLOW = hx('#2fd9c8');

// Scaffold: flooded gully/valley/delta water reads brighter & shimmery-cyan
// vs the deep-blue open ocean. (Full per-region water-surface shimmer is a
// Sea-shader TODO — the Sea is a single disc; see Sea.js.)
export const CHANNEL_WATER = hx('#3debe0');

// Terrain face colour. `t` is normalized fill 0..1 (low band → high band).
export function terrainColor(matId, t) {
  const g = GRAD[matId] || GRAD[MAT.ROCK];
  return mix(g[0], g[1], Math.max(0, Math.min(1, t)));
}

// Blue-variety seafloor by depth fraction (0 = at sea level, 1 = deepest).
// Tropical-drone look: turquoise shallows → teal → deep blue.
export function seafloorColor(depthFrac) {
  const d = Math.max(0, Math.min(1, depthFrac));
  return d < 0.5
    ? mix(SEAFLOOR_SHALLOW, SEAFLOOR_MID, d * 2)
    : mix(SEAFLOOR_MID, SEAFLOOR_DEEP, (d - 0.5) * 2);
}

// Grass tinted by season — a SOFT large-region mood over the green, not a
// ground band. Summer lush, autumn warm-ochre, conifer deep, winter frost.
const GRASS_SEASON = {
  0: [hx('#2f8a2e'), hx('#7ad83e')],   // summer
  1: [hx('#7a5520'), hx('#d99a33')],   // autumn (warm grass, still grass)
  2: [hx('#1d5a2c'), hx('#3f8f3c')],   // conifer (deep green)
  3: [hx('#6f8a74'), hx('#cfe3da')],   // winter (frosted sage / cyan)
};
export function grassTint(seasonId, t) {
  const g = GRASS_SEASON[seasonId] || GRASS_SEASON[0];
  return mix(g[0], g[1], Math.max(0, Math.min(1, t)));
}

// Tree palettes per species/season.
export const TREE = {
  palmTrunkLow: hx('#7a5a30'),
  palmTrunkHigh: hx('#b08a4a'),
  palmFrondLow: hx('#2f7d33'),
  palmFrondHigh: hx('#6fce4a'),

  coniferLow: hx('#1f4d3a'),
  coniferHigh: hx('#2e6b4f'),
  coniferTrunk: hx('#5a4632'),

  broadleafTrunkLow: hx('#5a4127'),
  broadleafTrunkHigh: hx('#8a6a42'),
  summerLeafLow: hx('#3c8f33'),
  summerLeafHigh: hx('#7ad84f'),

  autumnLeaf: [hx('#e6b800'), hx('#d98a2b'), hx('#c6492f')],

  winterBark: hx('#6b5240'),
  winterSnow: hx('#eef6f8'),
  winterCyan: hx('#bfe9f0'),
};

export const SHORE_GLOW = 0xff8a36; // aquarium-sky pillar glow colour, verbatim

export { mix as mixRgb, hx as hexRgb };
