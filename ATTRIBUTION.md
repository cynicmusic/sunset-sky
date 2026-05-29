# Attribution

This lab depends on third-party research code and assets. All inbound
licenses are MIT or equivalent. This file is the lab's single source of
truth for attribution. The main sim at `~/isometric` does NOT carry
these attributions — when work is promoted from this lab back into the
main sim, the consolidated attribution pass over there will absorb the
relevant lines.

## Takram three-geospatial

**License:** MIT
**Copyright:** © 2024 Shota Matsuda
**Source:** https://github.com/takram-design-engineering/three-geospatial
**Pinned commit (research):** `fc25526342a01d8e2b02f527fceb7f876e34b6d8`

Packages installed in Phase 2:

- `@takram/three-clouds@0.7.6` — volumetric cloud raymarching, Beer shadow
  maps, temporal upscaling, light shafts.
- `@takram/three-atmosphere@0.19.1` — Bruneton precomputed atmospheric
  scattering, sky material, aerial perspective effect.
- `@takram/three-geospatial@0.9.1` — shared utilities incl. `resolveIncludes`
  GLSL preprocessor and WGS84 ellipsoid math.

Assets shipped under `public/atmosphere/` and `public/clouds/` are
copies from these packages and inherit their MIT license. The current public
atmosphere payload uses Takram's full binary LUT set:
`scattering.bin`, `single_mie_scattering.bin`,
`higher_order_scattering.bin`, `transmittance.bin`, and `irradiance.bin`.

Asset sources:

- `public/atmosphere/*.bin` copied from
  `node_modules/@takram/three-atmosphere/assets/`.
- `public/clouds/local_weather.png`, `shape.bin`, `shape_detail.bin`,
  and `turbulence.png` copied from
  `node_modules/@takram/three-clouds/assets/`.
- `public/clouds/stbn.bin` downloaded from Takram's GitHub media URL pinned
  in `node_modules/@takram/three-geospatial/src/constants.ts`:
  `https://media.githubusercontent.com/media/takram-design-engineering/three-geospatial/9627216cc50057994c98a2118f3c4a23765d43b9/packages/core/assets/stbn.bin`.
  The npm `@takram/three-geospatial@0.9.1` package exposes `STBNLoader` but
  does not ship the asset, and a blobless Git clone leaves only a 132-byte
  Git LFS pointer.

When extracting source (Phase 5+ in the plan), preserve the upstream
copyright headers verbatim. Suggested attribution boilerplate for any
extracted file:

```
Includes code from Takram three-geospatial
(c) 2024 Shota Matsuda, licensed under MIT
https://github.com/takram-design-engineering/three-geospatial
```

## Bruneton et al., Precomputed Atmospheric Scattering

The atmosphere LUTs (`transmittance.bin`, `scattering.bin`,
`single_mie_scattering.bin`, `higher_order_scattering.bin`, and
`irradiance.bin`) are derived from the precomputed atmospheric scattering
model by Eric Bruneton et al.

**Reference:** https://ebruneton.github.io/precomputed_atmospheric_scattering/

Cite in any documentation or paper that uses the rendered output.

## Cloned shared infrastructure from ~/isometric (no external license)

The files under `src/shared/`, the island sim/source directories under `src/`,
and `src/island/IslandSea.js` are point-in-time copies or local forks from the
`isometric-island` repo at `~/isometric`. That repo is private (`"private":
true` in its `package.json`), no separate license required for the copy.

## postprocessing library

**License:** Zlib
**Source:** https://github.com/pmndrs/postprocessing
**Version installed:** `postprocessing@6.39.1`
**Used by:** `@takram/three-clouds` (required peer dependency).

## Three.js

**License:** MIT
**Source:** https://github.com/mrdoob/three.js
**Version pinned:** `^0.170.0` (matches `~/isometric`).
