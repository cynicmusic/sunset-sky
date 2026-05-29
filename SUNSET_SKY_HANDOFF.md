# Sunset Sky Handoff

This repo is a fork of `/Users/asmith/clouds` made for one purpose:

**Get Takram clouds working in dramatic sunset skies at all cost.**

The current island sim can already generate excellent sunset/cloud frames. The
missing piece is usually that the island/trees are too dark, too detached from
the sky, or not keyed by the same sunset energy. Do not start by assuming the
sky/cloud pipeline must be rebuilt. Start with the simpler hypothesis:

**The sky works; the island needs a controllable sunset-facing light model.**

## Repo

- Path: `/Users/asmith/sunset-sky`
- Run: `npm install`, then `npm run dev`
- URL: `http://127.0.0.1:57210/`
- Package name: `sunset-sky`
- Preset endpoint: `/__sunset-sky-presets`
- Local preset key: `sunset-sky.presets.v1`
- This repo owns its presets separately from `/Users/asmith/clouds`.

## Source Snapshot

Forked from `/Users/asmith/clouds` on May 29, 2026.

The fork intentionally includes the current island, Takram cloud stack, Hillaire
legacy atmosphere controls, water, trees, lagoon, and preset system. It also
includes the in-progress conifer cutout texture fix from the source tree:
`src/workshop/methodology/model.js` disables mipmaps on silhouette conifer
canvas textures and raises alpha test to reduce card-plane bleed.

## Updated Scope

Earlier theory was that Takram clouds might need a ground-up sunset rebuild
because they appeared to subtract/darken against the legacy sky. New evidence
from the Desktop capture says:

- The sim already produces many strong sunset skies with Takram clouds.
- Some great frames are legacy/Hillaire sky plus Takram clouds.
- Some great frames are Takram sky plus Takram clouds.
- The primary failure is often island illumination, not sky generation.
- Therefore Phase 1 should be a small island-lighting experiment before any
  pipeline demolition.

## Prior Art

Curated evidence copied from:

`/Users/asmith/Desktop/clouds-preset-contact-metal-20260529-051122 copy`

Into:

- `reference/sunset-prior-art/originals/`
- `reference/sunset-prior-art/annotated/`
- `reference/sunset-prior-art/sheets/sunset-prior-art-contact.png`
- `reference/sunset-prior-art/metrics.csv`
- `reference/sunset-prior-art/metrics.json`

Important examples:

| Preset | File | Route clue | Note |
| --- | --- | --- | --- |
| D2 | `D2_wide_sunset0.8595.png` | legacy sky + clouds | strongest wide sunset score |
| D2 | `D2_best_s02_sunset0.6953.png` | legacy sky + clouds | strong close/sample frame |
| D1 | `D1_wide_sunset0.6293.png` | legacy sky + clouds | strong sky, dark island risk |
| E7 | `E7_best_s02_sunset0.5731.png` | partial preset, inherits cloud defaults | stunning current-preset evidence |
| E6 | `E6_best_s02_sunset0.5502.png` | partial preset, inherits cloud defaults | stunning current-preset evidence |
| D3 | `D3_best_s03_sunset0.5455.png` | legacy sky + clouds | strong alternate sun azimuth |
| C7 | `C7_best_s02_sunset0.5139.png` | Takram sky + clouds | Takram route also works |
| C1 | `C1_best_s02_sunset0.4509.png` | Takram sky + clouds | good Takram reference |
| C4 | `C4_best_s02_sunset0.4480.png` | Takram sky + clouds | good Takram reference |

Do not treat the `sunsetN` score as an aesthetic rank. It is only a machine
selector for warm/cloudy frames.

## First Experiment

Start from the current presets. Do not rewrite sky composition first.

1. Load D2, E7, E6, D1, C7.
2. Verify the sky/cloud frame still resembles the prior art.
3. Add an experimental island-only sunset light layer.
4. Compare island/trees/water before/after with the sky unchanged.

The light should be isolated enough that it can be deleted if wrong. Suggested
shape:

- A new `sunsetLighting` or `islandSunsetLight` section.
- Default off or low, so current presets remain interpretable.
- A warm directional/key light aimed from the sunset horizon toward the island.
- A soft sky/fill term for terrain/trees.
- Optional shadow bypass for the extra light at first.
- Controls for intensity, color temperature/hue, elevation, azimuth offset,
  terrain-only/tree-only weighting if needed.

The first success criterion is not physical correctness. It is:

**Keep the exact sunset/cloud look, but make the island readable and color-gradeable.**

## Pipeline Cautions

- Preserve both sky routes until proven otherwise:
  - Hillaire/legacy atmosphere gives ozone, Mie G, Mie B, Rayleigh, purple/pink/orange range.
  - Takram sky gives LUT-backed atmosphere and reference cloud integration.
- Do not let a preset button silently change tone mapping behind the user's back.
- The current presets are still current and useful. Work from them.
- Rebuild from scratch only after the island-light experiment fails.
- If adding island light fixes most of the issue, sunset-sky becomes an island
  relighting fork, not a full atmospheric rewrite.

## Useful Current Preset Clues

From current `presets.json`:

- `D2`: sun elevation `1`, azimuth `-57`, legacy sky route, clouds on, coverage `0.33`, render exposure `0.3`, cloud exposure `5`.
- `D1`: sun elevation `1`, azimuth `-47`, legacy sky route, clouds on, coverage `0.4`, render exposure `0.3`, cloud exposure `10`.
- `D3`: sun elevation `1`, azimuth `18`, legacy sky route, clouds on, coverage `0.4`, render exposure `0.3`, cloud exposure `10`.
- `C1/C4/C7`: Takram sky route, clouds on, cloud exposure `15`, coverage `0.4`, render exposure `0.3`.
- `E6/E7`: partial older presets with great current results because missing cloud sections inherit current defaults. Be careful when normalizing them.

## Suggested Codex First Move

```sh
cd /Users/asmith/sunset-sky
npm install
npm run dev
# open http://127.0.0.1:57210/
```

Then inspect:

- `reference/sunset-prior-art/sheets/sunset-prior-art-contact.png`
- `reference/sunset-prior-art/originals/E7_best_s02_sunset0.5731.png`
- `reference/sunset-prior-art/originals/E6_best_s02_sunset0.5502.png`
- `reference/sunset-prior-art/originals/D2_wide_sunset0.8595.png`
- `src/core/Scene.js`
- `src/config/paramSchema.js`
- `src/island.js`
- `src/TakramSkyRig.js`

Implement the smallest possible controlled island-light experiment first.
