# Shore Glow Port Plan

Goal: bring back the old cyan/reef/bioluminescent read as an optional art layer, without treating the old card implementation as the final shape.

## Source Of Truth

- Primary legacy source: `/Users/asmith/isometric`.
- First complete implementation: commit `5edd9bc` (`Checkpoint main sim loader and shore glow`).
- Tuned control version: commit `124d07c` (`Checkpoint island and shore tuning controls`).
- `/Users/asmith/clouds` carries the same lineage, but it is the newer fork of `isometric`; use it only as corroborating context.

## What The Old System Did

- `src/water/Sea.js` sampled the generated coastline from the voxel volume.
- `sampleCoastline(volume, seaLevel)` picked land cells near sea level that had water neighbors, then estimated a water-facing normal.
- `makeGlowGeometry(...)` built little additive ribbon quads for each sample.
- `_makeShoreGlow(params)` created two layers:
  - `CoastGlowCyan`: broad cyan wash.
  - `CoastGlowWhite`: tighter white lip.
- The later tuned version exposed:
  - `water.shoreGlow`
  - `water.shoreGlowWidth`
  - `water.shoreGlowFollow`

This explains why it looked good from a distance but broke down up close: it was many horizontal cards extending outward from sampled coastline normals.

## Current Fork Context

- `sunset-sky` uses `src/island/IslandSea.js`, not the old `src/water/Sea.js`, for the main app.
- The current sea already has a `uWaterData` texture containing depth, channel, and land mask data.
- The existing water shader already produces cyan-ish channel/lagoon tint via `water.lagoonTint`.
- Current presets still contain old `shoreGlow` params from lineage, but the active shader path does not consume them.

## Suggested Port Shape

1. Bring the old params into the water UI only when we are ready to tune:
   - `shoreGlow`
   - `shoreGlowWidth`
   - `shoreGlowFollow`
   - optionally `shoreGlowColor` later, but start fixed cyan/white.

2. First experimental port can revive the legacy card layer inside `IslandSea`:
   - port `sampleCoastline`
   - port `makeGlowGeometry`
   - port the two additive shader materials
   - rebuild glow geometry when terrain/sea-level changes
   - update amount live from `water.shoreGlow`

3. Do not make the card version the final answer.
   Better follow-up: derive a soft shore/reef mask from `uWaterData` in the water shader or from a generated distance field, then add glow directly in the sea material. That should preserve the distant bioluminescent read without visible perpendicular cards up close.

4. Keep it scaffolded:
   - one clearly named function or class path
   - one small param group
   - easy off switch (`shoreGlow = 0`)
   - no dependency on Takram clouds or atmosphere bridge

## Notes For Future Tuning

- Legacy default range was `0..1.5`; common preset values were around `1.1`, `1.35`, and `1.4`.
- Tuned width values seen in legacy presets include `0.85`, `1.0`, `1.3`, and `2.75`.
- Tuned follow values include `0`, `0.64`, `0.68`, and `1`.
- The "good from far away" look likely came from additive cyan plus white lip, not from geometric correctness.
