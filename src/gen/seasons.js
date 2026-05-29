// Season allocation — terrain-correlated (PLAN.md §6, revised per review).
//
// Seasons follow ALTITUDE, not a 1-D sweep:
//   coast/lowland → summer · mid-slope → autumn · upper → conifer · peak → winter
// plus a large-scale 2-D warped noise that wanders the band boundaries so it
// reads as organic regions hugging the terrain, not stripes. Every mountain
// gets its own winter cap; valleys stay tropical.
//
// "Winter never touches summer" still holds for free: the band coordinate is
// altitude (monotone in height) and the lateral noise perturbation is kept
// well below one band width, so winter (highest) can only ever border
// conifer — never summer (lowest). No runtime adjacency checking.

import { fbm2 } from './noise.js';

export const SEASON = { SUMMER: 0, AUTUMN: 1, CONIFER: 2, WINTER: 3 };

export function makeSeasonField(params, seed) {
  // sweepDeg rotates the lateral-variety noise so the regions aren't a fixed
  // pattern; borderWarp scales how far boundaries wander (bounded).
  const ang = (params.sweepDeg * Math.PI) / 180;
  const ox = Math.cos(ang) * 7.3;
  const oz = Math.sin(ang) * 7.3;
  const wander = Math.min(0.085, params.borderWarp * 0.14);   // < min band width

  return function seasonAt(x, z, aNorm) {
    const lat = fbm2(x * 0.0017 + ox, z * 0.0017 + oz,
      { seed: seed + 71, octaves: 3, warp: 0.5 }) - 0.5;
    const a = Math.max(0, Math.min(1, aNorm + lat * wander * 2));

    let season;
    if (a < params.summerEnd) season = SEASON.SUMMER;
    else if (a < params.autumnEnd) season = SEASON.AUTUMN;
    else if (a < params.coniferEnd) season = SEASON.CONIFER;
    else season = SEASON.WINTER;
    return { s: a, season };
  };
}
