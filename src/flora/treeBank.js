import { buildSlots, makeLabTree } from '../workshop/tree-lab/treeLabModel.js';
import { makeTreeStyle } from '../workshop/methodology/model.js';
import { makePalm } from './palmReal.js';

// Mirrors the live tree-lab workshop overrides. This is production metadata:
// the island should not import the workshop renderer just to learn which slots
// are real.
const METHODOLOGY_OVERRIDES = {
  21: 'pine-sparse-scots',
  22: 'pine-sparse-scots',
  23: 'pine-sparse-scots',
  24: 'decid-limb-chunks',
  25: 'decid-limb-chunks',
  26: 'decid-limb-chunks',
  27: 'decid-winter-skeleton',
  28: 'decid-winter-skeleton',
  52: 'pine-fins-on-skeleton',
  58: 'pine-fins-on-skeleton',
  60: 'pine-fins-on-skeleton',
  65: 'pine-tiered-plates',
  66: 'pine-tiered-plates',
  67: 'pine-tiered-plates',
  68: 'pine-tiered-plates-alt',
  69: 'pine-tiered-plates-alt',
  70: 'pine-tiered-plates-alt',
  71: 'pine-tiered-plates-alt',
  72: 'pine-tiered-plates-alt',
  81: 'pine-silhouette-shell',
  82: 'pine-silhouette-shell',
  83: 'pine-silhouette-shell',
  84: 'pine-silhouette-shell-blue',
  85: 'pine-silhouette-shell-blue',
  86: 'pine-silhouette-shell-blue',
  87: 'pine-fins-on-skeleton',
  88: 'pine-fins-on-skeleton',
};

const SEED_OVERRIDES = {
  3: 1003,
  5: 1005,
  7: 7007,
  8: 8008,
  50: 5050,
  51: 5151,
  66: 1066,
  68: 168,
};

const SLOT_PARAMS = {
  52: {
    palette: { dark: [0.16, 0.035, 0.018], mid: [0.76, 0.30, 0.08], lite: [1.00, 0.78, 0.22] },
    finScale: 1.08,
    limbCount: 7,
  },
  58: {
    palette: { dark: [0.010, 0.022, 0.058], mid: [0.055, 0.155, 0.330], lite: [0.42, 0.62, 0.72] },
    winter: true,
    finScale: 0.78,
    finDrop: 1.18,
    limbCount: 6,
  },
  60: {
    finsPerTip: 3,
    finScale: 0.6,
    finDrop: 0.72,
    limbCount: 8,
  },
  82: { widthMul: 1.30 },
  85: { widthMul: 1.35, baseRadiusMul: 1.85, yLiftMul: 0.84 },
  66: {
    palette: { dark: [0.006, 0.040, 0.022], mid: [0.110, 0.345, 0.205], lite: [0.86, 1.00, 0.22] },
    lowTierDark: 0.42,
  },
  67: { lowTierDark: 0.40, lowTierDarkProb: 0.55 },
};

function classifyLabSlot(slot) {
  const n = slot.index;
  const seasons = slot.seasons || ['summer', 'autumn'];
  if (slot.blank) {
    return {
      slot: n,
      source: 'tree-lab',
      family: 'reserved',
      season: 'reserved',
      strength: 'avoid',
      layer: 'reserved',
      terrainAffinity: [],
      scale: 1,
      active: false,
    };
  }
  const base = {
    slot: n,
    source: 'tree-lab',
    family: 'broadleaf',
    season: seasons[0] || 'summer',
    strength: 'secondary',
    layer: 'summerCanopy',
    terrainAffinity: ['grass'],
    scale: 1.25,
    active: !slot.blank,
  };

  if (n <= 40) {
    return {
      ...base,
      family: n >= 27 && n <= 28 ? 'sparse' : 'green-shape',
      season: n >= 27 && n <= 28 ? 'winter' : 'summer',
      strength: n >= 27 && n <= 28 ? 'accent' : 'secondary',
      layer: n >= 27 && n <= 28 ? 'peakSparse' : 'summerCanopy',
      terrainAffinity: n >= 27 && n <= 28 ? ['upper-slope'] : ['grass', 'fairway-edge'],
      scale: n >= 27 && n <= 28 ? 1.05 : 1.18,
    };
  }
  if (n >= 41 && n <= 64) {
    return {
      ...base,
      family: 'autumn-broadleaf',
      season: 'autumn',
      strength: n >= 49 ? 'primary' : 'secondary',
      layer: 'autumnCanopy',
      terrainAffinity: ['autumn', 'mid-slope', 'lagoon-apron'],
      scale: 1.22,
    };
  }
  if (n >= 65 && n <= 72) {
    return {
      ...base,
      family: 'spruce-mix',
      season: 'conifer',
      strength: 'primary',
      layer: 'spruceMix',
      terrainAffinity: ['upper-slope', 'autumn-edge'],
      scale: 1.08,
    };
  }
  if (n >= 81 && n <= 88) {
    return {
      ...base,
      family: 'hero-conifer',
      season: 'conifer',
      strength: 'primary',
      layer: 'spruceMix',
      terrainAffinity: ['upper-slope', 'ridge-edge'],
      scale: 1.16,
    };
  }
  if (n >= 89 && n <= 96) {
    return {
      ...base,
      family: 'reserved',
      season: 'reserved',
      strength: 'avoid',
      layer: 'reserved',
      terrainAffinity: [],
      active: false,
      scale: 1,
    };
  }
  return base;
}

function makePalmSlot(slot) {
  const variant = slot - 96;
  return {
    slot,
    source: 'palm',
    family: 'palm',
    season: 'fringe',
    strength: 'primary',
    layer: 'palmFringe',
    terrainAffinity: ['beach', 'fairway-edge', 'lagoon-apron', 'bunker'],
    scale: 0.86 + (variant % 8) * 0.025,
    active: true,
    palmVariant: variant,
  };
}

function buildBank() {
  const slots = buildSlots().map((spec) => {
    const methodology = METHODOLOGY_OVERRIDES[spec.index];
    if (methodology) {
      spec.blank = false;
      spec.methodology = methodology;
      spec.seed = SEED_OVERRIDES[spec.index] ?? spec.index;
    } else if (SEED_OVERRIDES[spec.index] != null) {
      spec.seed = SEED_OVERRIDES[spec.index];
    }
    return { ...spec, ...classifyLabSlot(spec) };
  });
  for (let slot = 97; slot <= 128; slot++) slots.push(makePalmSlot(slot));
  return slots;
}

export const TREE_BANK = buildBank();

export const TREE_BANK_GROUPS = {
  summerCanopy: TREE_BANK.filter((s) => s.active && s.layer === 'summerCanopy'),
  autumnCanopy: TREE_BANK.filter((s) => s.active && s.layer === 'autumnCanopy'),
  spruceMix: TREE_BANK.filter((s) => s.active && s.layer === 'spruceMix'),
  peakSparse: TREE_BANK.filter((s) => s.active && s.layer === 'peakSparse'),
  palmFringe: TREE_BANK.filter((s) => s.active && s.layer === 'palmFringe'),
  accentTrees: TREE_BANK.filter((s) => s.active && s.strength === 'accent'),
};

export function treeBankSummary() {
  const counts = {};
  for (const slot of TREE_BANK) {
    const key = slot.active ? slot.layer : 'inactive';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export function chooseTreeSlot(layer, rand) {
  const list = TREE_BANK_GROUPS[layer] || TREE_BANK_GROUPS.summerCanopy;
  if (!list.length) return null;
  const weighted = [];
  let total = 0;
  for (const slot of list) {
    const weight = slot.strength === 'primary' ? 1 : slot.strength === 'accent' ? 0.45 : 0.62;
    total += weight;
    weighted.push([slot, total]);
  }
  let roll = rand() * total;
  for (const [slot, edge] of weighted) {
    if (roll <= edge) return slot;
  }
  return list[list.length - 1];
}

export function makeTreeBankTree(slot, seed) {
  if (!slot) return null;
  if (slot.source === 'palm') return makePalm(((seed >>> 0) ^ (slot.slot * 2654435761)) >>> 0);
  const spec = { ...slot, seed: ((slot.seed ?? seed) ^ (seed >>> 0)) >>> 0 };
  if (slot.methodology) return makeTreeStyle(slot.methodology, spec.seed, SLOT_PARAMS[slot.slot]);
  return makeLabTree(spec);
}
