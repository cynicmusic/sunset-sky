# Sunset Sky Plan

## Goal

Make dramatic orange, pink, white, blue, and purple sunset skies with Takram
clouds and a readable island.

The fork may destroy or replace the current sim if needed, but the first pass
should not. The prior art proves the sky/cloud side already works in several
presets.

## Phase 0: Preserve Evidence

- Keep `reference/sunset-prior-art/` in the repo.
- Treat D2, E7, E6, D1, C7 as starting presets.
- Keep screenshots and metrics together.

## Phase 1: Island Relighting Probe

Add one isolated island/trees light layer while leaving the sky and clouds
unchanged.

Questions:

- Can D2/E7/E6 keep their sunset sky while the island becomes readable?
- Can orange trees receive warm sunset color without blowing out to white?
- Can trees and terrain be lit independently enough to tune?
- Does the extra light need to affect water, or should water remain driven by
  the legacy atmosphere/sun coupling?

Success:

- A before/after sheet where sky/clouds are visually stable and island/trees
  become usable.

Failure:

- The sky shifts when only island light changes.
- Terrain colors still go black-to-white across tiny sun elevation changes.
- Additional light destroys water/sunset strips.

## Phase 2: Gain-Staging Cockpit

If Phase 1 works, make a single tuning panel for:

- sunset island key intensity
- sunset key hue/temperature
- sunset key elevation/azimuth offset
- sky/fill strength
- tree response
- terrain response
- water coupling/bypass

Do not remove original controls yet.

## Phase 3: Pipeline Split Only If Needed

If island relighting cannot solve it, split the renderer into explicit layers:

- sky background
- cloud radiance
- cloud shadow/irradiance
- island/trees
- water
- post/tone map

The objective is to prevent cloud radiance from subtracting from stylized
sunset sky while still getting cloud shape and cloud-shadow drama.

## Phase 4: Rebuild Option

Only after Phases 1-3 fail:

- Start a minimal sky/cloud sandbox.
- Reintroduce Hillaire atmosphere color controls or equivalent controls:
  ozone, Mie G, Mie B, Rayleigh, haze.
- Integrate Takram clouds against that sky.
- Add simple landmass cards/terrain for grading.
- Bring the island back last.

## Non-Goals For The First Pass

- Mobile work.
- GitHub Pages deploy.
- Full tree/lagoon polish.
- Replacing all presets.
- Physically correct sunsets.
