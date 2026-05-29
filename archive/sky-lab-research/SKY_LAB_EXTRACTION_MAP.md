# Sky Lab Extraction Map

Phase 5 deliverable. This is an extraction map only. It does not vendor
Takram code into this repo and does not modify `~/isometric`.

## Status

Current lab versions:

- `three@0.170.0`
- `vite@6.4.2`
- `postprocessing@6.39.1`
- `@takram/three-atmosphere@0.19.1`
- `@takram/three-clouds@0.7.6`
- `@takram/three-geospatial@0.9.1`

Current lab surface:

- `src/TakramSkyRig.js` imports `SkyMaterial`,
  `AerialPerspectiveEffect`, `CloudsEffect`, `Ellipsoid`, and `Geodetic`
  from the Takram packages.
- `src/AssetLoader.js` imports `PrecomputedTexturesLoader`,
  `DataTextureLoader`, `STBNLoader`, and `parseUint8Array`.
- The panel exposes cloud render, atmosphere, weather, layer, lighting,
  shadow, debug, and finishing sections.
- The composer path is `RenderPass -> NormalPass -> optional EffectPass(clouds
  and/or aerialPerspective) -> ToneMappingEffect`.
- The lab separates the faithful `Takram ref` stack from the `legacy sky`
  composite, so the old sim sky experiment does not overwrite the reference.
- Dithering is a real switch now using `EffectPass.dithering`; it defaults on
  in `Takram ref` and off in `legacy sky`. Takram's separate
  `DitheringEffect` still lives in
  `@takram/three-geospatial-effects`, which is not installed.

## Extraction Target

Keep the first extraction conservative:

- Keep `postprocessing` as a dependency. `CloudsEffect` and
  `AerialPerspectiveEffect` are real `postprocessing.Effect` classes, and
  replacing that contract would make this a rewrite rather than an
  extraction.
- Vendor only the WebGL runtime needed by the lab:
  - Takram clouds runtime
  - Takram atmosphere runtime
  - minimal Takram geospatial helpers, loaders, decorators, shader
    preprocessors, and shader chunks
- Keep using static assets under `public/atmosphere/` and `public/clouds/`.
  Do not vendor procedural texture generators unless the UI later needs
  in-browser asset generation.
- Leave React/R3F, WebGPU, stars, moon, and atmosphere precompute generation
  out of the first pass.

## Proposed Vendor Layout

Suggested local path if promoted into this lab first:

```text
src/vendor/takram/
  atmosphere/
  clouds/
  geospatial/
```

Suggested path if promoted to `~/isometric` later:

```text
src/third_party/takram/
  atmosphere/
  clouds/
  geospatial/
```

Keep upstream file headers and add attribution in the destination repo's
attribution file.

## Clouds Runtime Files

Vendor these from `node_modules/@takram/three-clouds/src/`:

```text
CascadedShadowMaps.ts
CloudLayer.ts
CloudLayers.ts
CloudsEffect.ts
CloudsMaterial.ts
CloudsPass.ts
CloudsResolveMaterial.ts
DensityProfile.ts
PassBase.ts
ShaderArrayPass.ts
ShadowMaterial.ts
ShadowPass.ts
ShadowResolveMaterial.ts
constants.ts
helpers/FrustumCorners.ts
helpers/setArrayRenderTargetLayers.ts
helpers/splitFrustum.ts
qualityPresets.ts
uniforms.ts
```

Optional only if generating or regenerating cloud textures in the browser:

```text
CloudShape.ts
CloudShapeDetail.ts
LocalWeather.ts
Procedural3DTexture.ts
ProceduralTexture.ts
Turbulence.ts
bayer.ts
```

The current lab uses shipped static textures, so the optional generator group
can be skipped at first.

## Clouds Shader Files

Vendor these from `node_modules/@takram/three-clouds/src/shaders/`:

```text
catmullRomSampling.glsl
clouds.frag
clouds.glsl
clouds.vert
cloudsEffect.frag
cloudsResolve.frag
cloudsResolve.vert
parameters.glsl
shadow.frag
shadow.vert
shadowResolve.frag
shadowResolve.vert
structuredSampling.glsl
types.glsl
varianceClipping.glsl
```

Optional with the procedural generator group:

```text
cloudShape.frag
cloudShapeDetail.frag
localWeather.frag
perlin.glsl
tileableNoise.glsl
turbulence.frag
```

## Atmosphere Runtime Files

Vendor these from `node_modules/@takram/three-atmosphere/src/`:

```text
AerialPerspectiveEffect.ts
AtmosphereMaterialBase.ts
AtmosphereParameters.ts
PrecomputedTexturesLoader.ts
SkyMaterial.ts
constants.ts
getAltitudeCorrectionOffset.ts
types.ts
```

Likely skip on first pass:

```text
LightingMaskPass.ts
PrecomputedTexturesGenerator.ts
SkyLightProbe.ts
StarsMaterial.ts
SunDirectionalLight.ts
celestialDirections.ts
getSunLightColor.ts
helpers/sampleTexture.ts
r3f/
webgpu/
```

Reason: the lab currently needs static LUT loading, sky background, aerial
perspective, cloud overlays, and cloud shadow buffers. It does not generate
LUTs, draw stars, use R3F, or use WebGPU.

## Atmosphere Shader Files

Vendor these from `node_modules/@takram/three-atmosphere/src/shaders/`:

```text
aerialPerspectiveEffect.frag
aerialPerspectiveEffect.vert
sky.frag
sky.glsl
sky.vert
bruneton/common.glsl
bruneton/definitions.glsl
bruneton/runtime.glsl
```

Skip unless regenerating LUTs:

```text
bruneton/precompute.glsl
precompute/
```

Skip unless stars/moon are brought back:

```text
stars.frag
stars.vert
```

## Geospatial Runtime Files

Vendor these from `node_modules/@takram/three-geospatial/src/`:

```text
DataTextureLoader.ts
Ellipsoid.ts
Geodetic.ts
STBNLoader.ts
TypedArrayLoader.ts
capabilities.ts
constants.ts
decorators.ts
defineShorthand.ts
math.ts
resolveIncludes.ts
typedArrayParsers.ts
unrollLoops.ts
```

Potentially needed depending on TypeScript compile strictness and exact
imports retained:

```text
types.ts
helpers/projectOnEllipsoidSurface.ts
```

Skip at first:

```text
r3f/
tiling/
webgpu/
```

## Geospatial Shader Chunks

Vendor these from `node_modules/@takram/three-geospatial/src/shaders/`:

```text
cascadedShadowMaps.glsl
depth.glsl
interleavedGradientNoise.glsl
math.glsl
packing.glsl
raySphereIntersection.glsl
transform.glsl
turbo.glsl
vogelDisk.glsl
```

Only needed with procedural texture generation:

```text
generators.glsl
```

## Static Assets

Keep these assets and their current public URLs:

```text
public/atmosphere/transmittance.bin
public/atmosphere/scattering.bin
public/atmosphere/single_mie_scattering.bin
public/atmosphere/higher_order_scattering.bin
public/atmosphere/irradiance.bin
public/clouds/local_weather.png
public/clouds/shape.bin
public/clouds/shape_detail.bin
public/clouds/turbulence.png
public/clouds/stbn.bin
```

The runtime currently uses `PrecomputedTexturesLoader({ combinedScattering:
false, higherOrderScattering: true })`. The compact combined-scattering recipe
is retained in `artifacts/compact-atmosphere-reference.md` for the later
sub-15 MB packaging pass.

Attribution state:

- Takram source/assets: MIT, copyright Shota Matsuda.
- Bruneton atmospheric scattering citation is already recorded in
  `ATTRIBUTION.md`.
- `stbn.bin` came from Takram's GitHub media URL pinned in
  `@takram/three-geospatial@0.9.1`:
  `https://media.githubusercontent.com/media/takram-design-engineering/three-geospatial/9627216cc50057994c98a2118f3c4a23765d43b9/packages/core/assets/stbn.bin`.
  Do not copy the 132-byte Git LFS pointer from a blobless clone.

## Required API Surgery

The likely extraction work:

- Replace package imports with local relative imports.
- Decide TypeScript vs JavaScript:
  - Lowest-risk path: keep vendored files as TypeScript and let Vite handle
    dependency transpilation.
  - If the destination repo stays JS-only, run a mechanical TS-to-JS pass and
    review the output rather than hand-editing hundreds of type annotations.
- Preserve `?raw` shader imports. Vite already supports this.
- Preserve `resolveIncludes()` and `unrollLoops()` rather than pre-expanding
  shaders. They are tiny and make future upstream diffing easier.
- Keep the `decorators.ts` behavior or rewrite it explicitly. Takram uses
  decorators such as `@define`, `@defineInt`, `@defineFloat`, and
  `@defineExpression` for material/effect shader defines. This is one of the
  main extraction risks because the destination build must support the
  decorator syntax or the properties must be converted to explicit
  `Object.defineProperty()` calls.
- Keep `definePropertyShorthand()` and `defineUniformShorthand()` unless all
  shorthand calls are rewritten.
- Keep `postprocessing` classes in place: `Effect`, `EffectPass`,
  `NormalPass`, `RenderPass`, `ShaderPass`, `Pass`, `Resolution`,
  `ToneMappingEffect`.
- Preserve or re-evaluate `TakramSkyRig._ensureDistinctComposerDepthTexture()`.
  In this lab, `postprocessing@6.39.1` creates its stable depth texture with
  `DepthTexture.clone()`, while `three@0.170.0` clones share
  `Texture.source`. Without the guard, headless WebGL reports repeated
  `glBlitFramebuffer` depth/stencil feedback warnings.
- Remove R3F and WebGPU exports/import paths from any vendored barrel files.
  Prefer direct imports over vendoring broad `index.ts` barrels.
- Keep static asset loading. Do not vendor cloud texture generator classes
  unless the lab proves those controls are needed.

## Dithering Decision

Do not import `DitheringEffect` from `postprocessing`; it is not exported
there. Takram's vanilla cloud story gets it from
`@takram/three-geospatial-effects`.

Current state: `cloudFinishing.dithering` toggles postprocessing's built-in
fullscreen pass dithering. `cloudFinishing.toneMapping` selects ACES,
neutral, AGX, or linear. ACES is the default. AGX is available only by manual
selection so preset/mode buttons do not silently move the lab into a more
photorealistic finishing curve.

Extraction options if we later need Takram's exact finishing stack:

1. Keep the current built-in pass dithering and tone-map selector.
2. Add `@takram/three-geospatial-effects` and attribute it.
3. Write a tiny local screen-space dithering effect and attribute only our own
   code.

Recommendation: stay with option 1 until image banding or finishing mismatch
is visible in proof captures. Add option 2 or 3 only if artifacts show up.

## Verification Checklist

After any actual vendoring pass:

1. `npm run build`
2. Headless runtime probe at `http://127.0.0.1:57170/`
3. Confirm `window.skyLab.takram()` returns:
   - `enabled: true`
   - `cloudsEnabled: true`
   - `assetsReady: true`
   - no fatal console logs
4. Regenerate the four-angle cloud grid:
   - `artifacts/cloud-grid/horizon.png`
   - `artifacts/cloud-grid/up.png`
   - `artifacts/cloud-grid/toward-sun.png`
   - `artifacts/cloud-grid/away-sun.png`
   - `artifacts/takram-clouds-grid.png`
5. Restore sticky state after probes.
6. Confirm no orphaned headless browser or one-off node probe processes remain.

## Main Risks

- Decorators: current upstream TS syntax may require build support or a
  rewrite.
- Peer dependency shape: direct local imports must avoid broad barrel files
  that pull in R3F or WebGPU modules.
- Effect pipeline: removing `postprocessing` is out of scope for first
  extraction.
- Shader include graph: missing one GLSL chunk can fail only at runtime.
- Asset provenance: preserve MIT headers and the pinned `stbn.bin` note.
- Dithering: the original story's final pass comes from an optional Takram
  package, not `postprocessing`.
