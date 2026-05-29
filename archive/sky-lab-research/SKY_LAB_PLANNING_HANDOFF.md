# Sky Lab Planning Handoff

Audience: Claude, planning-only pass first. Do not start by implementing Takram clouds. The next useful output is a plan that explains the extraction path, black-horizon-strip diagnosis, UI segmentation, risks, and proof steps.

## Mission

Create a `sky lab` as a fork of the current water/waves workshop flow. The lab should be visually obvious, should not write to main sim presets, and should be used to research clouds, aerial perspective, horizon cleanup, and eventually crepuscular rays.

The user wants Takram's `three-geospatial` researched as primary prior art, but does not want a blind package import. We may prototype from the library to learn, but the desired direction is to understand the implementation and extract only the pieces we can maintain.

Primary URLs:

- Takram repo: https://github.com/takram-design-engineering/three-geospatial
- WebGL Storybook: https://takram-design-engineering.github.io/three-geospatial/
- Lens flare story link the user called out: https://takram-design-engineering.github.io/three-geospatial/?path=/story/effects-lens-flare--basic
- WebGPU Storybook/docs: https://takram-design-engineering.github.io/three-geospatial-webgpu/?path=/docs/atmosphere-readme--docs
- Bruneton reference: https://ebruneton.github.io/precomputed_atmospheric_scattering/

I cloned the Takram repo shallow into `/tmp/three-geospatial` at commit `fc25526342a01d8e2b02f527fceb7f876e34b6d8` for source inspection. Re-clone if `/tmp` has been cleaned.

## Current Local Context

Repo: `/Users/asmith/isometric`

Main sim:

- Entry: `src/main.js`
- Core scene: `src/core/Scene.js`
- Current sky: `src/atmosphere/SkyBackdrop.js`, `src/atmosphere/SkyViewLUT.js`, `src/atmosphere/TransmittanceLUT.js`
- Current water: `src/water/Sea.js`
- Main UI schema: `src/config/paramSchema.js`
- Control panel: `src/ui/ControlPanel.js`

Workshops/labs:

- `/workshop/water/`: `src/workshop/water/waterWorkshop.js` plus `WaterWorkshopSea.js`. This is an island water surface bench using the real sim scene, read-only scene presets, reference lagoon blocks, and the tutorial-derived water shader stages 3-5.
- `/workshop/waves/`: same base as water workshop but more aggressive. It currently adds `chaos`, `lod`, and shared layer mute/solo controls. It is for learning/tuning; do not treat it as finished.
- `/workshop/pool/`: clean pool lab derived from the water tutorial, with colored blocks. User liked stages 3, 4, 5 there a lot. Pool is useful for isolating shader behavior from island/seafloor complexity.
- God-ray workshop is stale/removed from current focus. Do not revive it for this task.

Current waves status:

- User hand-tuned a good water/waves look in `/workshop/water/` and `/workshop/waves/`.
- Current tuned core values are roughly: `waveSpeed 2.7`, `glintSpeed 3.5`, `glintScale 1.34`, `waveScale 0.0275`, `waveRotation 143`, `surfaceOpacity 0.55`, `waveHeight 1.92`, `waveChoppy 5.95`, `surfaceStage 5`, `detailMix 0.42`, `normalStrength 0.4`, `refractionStrength 0.18`, `depthTint 0.78`, `lagoonTint 0.18`.
- The waves lab has a naive LOD patch. It currently overlays the same material/pattern over the background water, so the user can see a double pattern offset by a tiny amount. This is not the intended high-amplitude near-wave experiment yet.
- If you plan LOD improvements: propose a separate patch material/uniform set, radial/lobed alpha feather, and a way to suppress or mask the base mesh under the patch. Do not make the patch just a lifted duplicate of the base ocean.

## Takram Source Notes

Local source paths to inspect:

- `packages/atmosphere/README.md`
- `packages/atmosphere/WEBGPU.md`
- `packages/atmosphere/src/AerialPerspectiveEffect.ts`
- `packages/atmosphere/src/SkyMaterial.ts`
- `packages/atmosphere/src/shaders/sky.frag`
- `packages/atmosphere/src/webgpu/AerialPerspectiveNode.ts`
- `packages/atmosphere/src/webgpu/ShadowLengthNode.ts`
- `packages/clouds/README.md`
- `packages/clouds/src/CloudsEffect.ts`
- `packages/clouds/src/qualityPresets.ts`
- `packages/clouds/src/CloudLayer.ts`
- `packages/clouds/src/CloudLayers.ts`
- `packages/clouds/src/shaders/clouds.frag`
- `packages/clouds/src/shaders/clouds.glsl`
- `packages/clouds/src/shaders/cloudsResolve.frag`
- `packages/clouds/src/shaders/shadow.frag`
- `storybook/src/clouds/Clouds-Vanilla.tsx`
- `storybook/src/clouds/helpers/useCloudsControls.ts`

Important findings from source:

- `@takram/three-clouds` is WebGL/GLSL today, beta status, and includes Beer shadow maps, temporal upscaling/filtering, light shafts, and haze.
- Clouds need more than a component snippet. The vanilla path uses `postprocessing` with `RenderPass`, `NormalPass`, `CloudsEffect`, `AerialPerspectiveEffect`, HalfFloat render targets, AGX tone mapping, lens flare, dithering, and multiple texture assets.
- Required cloud assets: `packages/clouds/assets/local_weather.png`, `shape.bin`, `shape_detail.bin`, `turbulence.png`, plus `packages/core/assets/stbn.bin`.
- Required atmosphere assets for Takram's precomputed loader: `packages/atmosphere/assets/transmittance.bin`, `scattering.bin`, `single_mie_scattering.bin`, `higher_order_scattering.bin`, `irradiance.bin`, and related `.exr` source assets.
- Takram cloud quality presets are real budget levers:
  - Low disables shape detail, light shafts, turbulence; drops raymarch precision and shadow resolution.
  - Medium disables light shafts and turbulence; lowers precision.
  - High is baseline.
  - Ultra increases cloud shadow resolution and lowers min step size.
- WebGPU atmosphere is done in Takram's repo, but it requires `three >= 0.182.0` and a node/TSL architecture. This repo currently uses `three ^0.170.0` and WebGL custom shaders. Treat WebGPU as research/reference first, not an implementation path unless the plan explicitly accounts for a Three.js upgrade and fallback.
- Clouds WebGPU support is not done in the current package. The main README says clouds are work in progress for WebGPU.
- Takram's WebGPU light shafts are interesting: `ShadowLengthNode` computes shadow length along camera rays using epipolar sampling and cascaded shadow maps. That is high-value prior art for future crepuscular rays, but it is not a quick drop-in.

## Sky Lab Shape

Fork from the water workshop, not the main sim:

- Suggested route: `/workshop/sky/`
- Suggested files: copy `workshop/water/index.html` to `workshop/sky/index.html`, fork `src/workshop/water/waterWorkshop.js` into a sky-lab entry, and reuse the current `Scene` initially.
- It should load scene presets read-only, exactly like the water/waves workshops.
- It must not save or mutate `public/presets.json`.
- It can have its own localStorage for lab-only sky/cloud params, clearly namespaced.
- Keep the water/waves/pool labs intact while planning and prototyping. The user is actively tuning waves.

## UI Segmentation Guidance

Do not shoehorn clouds into one panel. Clouds have too many coupled controls. Plan a segmented UI with sections in this approximate order:

1. `sky diagnosis`
   - Black strip mode, sky-only, sea-only, fog-only, horizon row sampler, sky ground fill, horizon clamp, backdrop below-horizon fill.
   - This is the first section because the black band must be understood before clouds become visual noise.

2. `atmosphere`
   - Keep current local atmosphere params visible: Rayleigh, Mie, ozone, sun intensity/disk/corona, planet radius, horizon warp.
   - Include debug views for current `SkyViewLUT` and transmittance if feasible.

3. `clouds render`
   - Enable, quality preset, resolution scale, temporal upscale/filter, shape detail, turbulence, haze, light shafts.
   - This section is for performance modes and pass topology, not art.

4. `cloud weather`
   - Coverage, weather repeat/offset/velocity, shape repeat/offset, detail repeat/offset, turbulence repeat/displacement.
   - This is the "where are the clouds and how do they move?" section.

5. `cloud layers`
   - Up to four layer cards/rows. For each: enable/channel, altitude, height, density scale, shape amount, shape detail amount, weather exponent, coverage filter width, shadow.
   - Keep it compact. The user will tune visually; make layers solo/mute if possible.

6. `cloud lighting`
   - Scattering coefficient, absorption coefficient, anisotropy 1/2/mix, sky light scale, ground bounce, powder scale/exponent.
   - This should not be mixed with cloud placement.

7. `cloud shadows / rays`
   - Beer shadow map cascade count/map size, split mode/lambda, shadow march counts, light shafts, shadow length debug.
   - Crepuscular rays matter even though we already have a separate god-ray pass. Takram's cloud light shafts are a distinct volume/cloud-shadow feature.

8. `debug`
   - Sample count, front depth, shadow map, cascades, UV, shadow length, velocity.
   - Debug views should be clear and one-click, not buried.

9. `lens / finishing`
   - Lens flare and dithering can be researched, but keep them separated from atmosphere/clouds. The user called out the lens-flare Storybook, but this is not the first implementation task.

## Black Horizon Strip: Non-Authoritative Triage Ideas

The screenshot shows a dark/black band between the bright sky horizon and the water. Do not assume this is one bug until you isolate it. Start with toggles/screenshots:

- Sky-only, sea-only, floor-only.
- Force renderer clear color to bright magenta behind everything to detect uncovered pixels.
- Temporarily extend sea surface/floor radius and disable horizon alpha fade.
- Temporarily force `SkyBackdrop` below-horizon rays to fog/horizon color.
- Disable `horizonWarp`.
- Compare normal sim water `Sea.js` and workshop water `WaterWorkshopSea.js`.

Likely candidates:

1. Below-horizon sky is black.
   - Current `SkyBackdrop.js` samples `SkyViewLUT` for all rays. It only conditionally adds the sun when the ray misses the planet. It does not implement a ground-albedo path for rays that hit the planet.
   - Current `SkyViewLUT.js` can return black when the atmosphere segment is degenerate, including ground-intersection cases.
   - Takram's `SkyMaterial` has `GROUND` / `GROUND_ALBEDO` handling that computes radiance for rays intersecting the ground. Our backdrop does not.
   - Possible local fix: in the backdrop, if a ray intersects the planet/below horizon, blend to sampled horizon/fog color or add a simple ground albedo branch. This is a diagnostic idea, not yet a final design.

2. Finite ocean/floor geometry edge.
   - `Sea.js` and `WaterWorkshopSea.js` use a large circle/disc for sea/floor, with horizon fade toward fog color and alpha fade near the rim.
   - If the camera is far/high or the FOV exposes below-horizon pixels outside the water disc, those pixels may show the black below-horizon sky.
   - If this is it, fixes include larger sea/floor radius, different fade radii, no alpha fade below horizon, or making the sky ground branch non-black.

3. Fog/horizon color mismatch.
   - `Scene._syncHorizonFog()` samples the sky LUT horizon row and applies ACES-like tonemapping in JS to drive fog and sea horizon color.
   - The sampled row is `floor(h * 0.5) - 1`, averaged across azimuth. Near the sun or with horizon warp, average horizon color may not match the visible local horizon.
   - This probably explains color mismatch, not a fully black band, but test it.

4. Tonemap/composite ordering.
   - The renderer uses ACES tone mapping and custom post effects. A mismatch between LUT linear radiance, fog color, and water material color space can exaggerate bands.
   - Treat this as secondary unless sky-only/sea-only tests point at it.

## Extraction/Prototype Strategy

Plan in phases. Do not jump straight to clouds plus aerial perspective plus rays.

Phase 0: black strip diagnosis

- Create sky lab fork.
- Add diagnostic toggles/screenshots for sky, water surface, floor, and backdrop below-horizon fill.
- Decide whether the band is uncovered pixels, below-horizon sky, finite sea edge, fog color mismatch, or a combination.
- Fix only enough to make the horizon sane before cloud visual work.

Phase 1: Takram inventory and minimal vanilla prototype

- Read `Clouds-Vanilla.tsx` and translate the pass graph into a small plan for our non-React WebGL app.
- Inventory dependencies:
  - `postprocessing` is not currently in this repo.
  - Our `three` is `^0.170.0`.
  - Takram packages use TS source and package build conventions; direct source vendoring will require GLSL include handling and asset paths.
- Decide whether to make a temporary package-based spike inside sky lab to learn controls. If yes, keep it clearly temporary and document why. The desired final path is source extraction, not permanent dependency usage.

Phase 2: local atmosphere compatibility

- Compare our existing Hillaire-ish `SkyViewLUT`/`TransmittanceLUT` with Takram's Bruneton precomputed assets.
- Decide whether sky lab should:
  - keep our current sky and only prototype clouds visually, or
  - replace sky in lab with Takram atmosphere, or
  - run a hybrid only long enough to evaluate clouds.
- Explicitly account for color management and tonemapping. Takram vanilla uses floating-point composer + `NoToneMapping` renderer + final `ToneMappingEffect` AGX. Our sim uses renderer ACES plus local postfx.

Phase 3: clouds without scene-object rays

- Get clouds visible in sky lab at low/medium quality.
- Expose the segmented UI.
- Verify clouds draw behind/around the island without breaking water/waves.
- Generate review screenshots/contact sheets, especially looking toward the sun and along the horizon.

Phase 4: cloud light shafts / crepuscular rays

- Only after clouds are stable, investigate Takram light shafts:
  - WebGL clouds support light shafts in quality presets.
  - WebGPU `ShadowLengthNode` is strong prior art but likely too large for direct use right now.
- Compare with our existing god-ray pass. These are not the same effect:
  - current god rays: screen-space radial scatter from scene/sun source.
  - Takram cloud shafts: volumetric cloud shadow/scattering integration.

Phase 5: extraction plan

- Write down the minimal vendored subset:
  - GLSL chunks needed.
  - JS/TS classes needed.
  - assets needed.
  - pass graph.
  - UI params and debug views.
  - performance budget.
- Include license attribution (Takram repo is MIT).

## Research Questions Claude Should Answer

1. What is the smallest Takram WebGL cloud subset that can render one cloud layer in our vanilla Three/Vite app?
2. Can it run without replacing our current sky, or does it require Takram atmosphere textures/AerialPerspective to look coherent?
3. What are the minimum assets and loaders?
4. What post-processing changes are required, and do they conflict with our current `PostFX`/tone mapping path?
5. What are the real performance knobs on a MacBook-class GPU?
6. How does Takram's cloud `lightShafts` path work in WebGL, and what inputs does it need?
7. What does the WebGPU atmosphere path buy us, and what would upgrading Three.js from 0.170 to 0.182+ risk?
8. What exactly causes the black strip in our current scene?
9. How should sky lab presets work without corrupting main sim presets?
10. Which UI controls belong in artist-facing sections versus debug/perf sections?

## What Not To Do

- Do not mutate `public/presets.json`.
- Do not wire cloud params into the main sim first.
- Do not add a giant single cloud panel.
- Do not hide complexity under "quality high" and call it done.
- Do not use R3F examples as if this repo were React; this repo is vanilla Three.
- Do not start with WebGPU implementation. Research it, but treat it as a separate architecture unless the plan justifies the migration.
- Do not disturb `/workshop/water/`, `/workshop/waves/`, or `/workshop/pool/` while planning unless the user explicitly asks.

## Useful Commands

```sh
# Run current app
npm run dev

# Open waves lab
open http://127.0.0.1:5193/workshop/waves/

# Open water workshop
open http://127.0.0.1:5193/workshop/water/

# Clone Takram source for inspection
rm -rf /tmp/three-geospatial
git clone --depth 1 --filter=blob:none https://github.com/takram-design-engineering/three-geospatial.git /tmp/three-geospatial
```

## Suggested First Claude Deliverable

Write `SKY_LAB_PLAN.md` with:

- Horizon strip diagnosis matrix and test sequence.
- Sky lab file/route plan.
- Takram WebGL clouds extraction map by file/class/asset.
- WebGPU research summary and why it is or is not in scope.
- UI section wireframe for sky/clouds/rays/debug.
- Risks, estimated complexity, and first safe prototype checkpoint.

