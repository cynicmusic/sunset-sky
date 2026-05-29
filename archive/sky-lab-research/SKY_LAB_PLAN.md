# SKY_LAB_PLAN — clouds-only

Follow-up to [SKY_LAB_PLANNING_HANDOFF.md](SKY_LAB_PLANNING_HANDOFF.md).
Read that first for context + research; this doc is the actionable plan.

## Preamble — decisions baked in from user feedback

User answers to the earlier §7 open questions, now committed:

1. **Horizon strip** — diagnose in the lab, then fix only after clouds are
   integrated successfully (see Phase 7). If clouds don't pan out, we don't
   spend effort fixing a strip we won't be looking at.
2. **WebGPU** — tabled. Not in research scope for this lab. The WebGL
   clouds path requires three ≥0.170 (we have it); that's enough.
3. **New port + new vite config** — the lab is called `sky`, runs on its
   own port, and (see §0.5) lives in a **separate repo** at `~/clouds`.
4. **Cloned from water lab only.** Not from waves, not from pool.
5. **Credits + license** — yes, included in lab-only README + ATTRIBUTION
   files. No credit surface in the main sim (that's a consolidated
   attribution job for later, with other attributions in the repo).

## 0 · Scope

**In scope:**
- New `~/clouds` repo, a sky lab forked from this repo's water workshop shell.
- Takram **clouds** (WebGL path) prototype → extraction map.
- Black horizon strip — **diagnose** in Phase 1; **fix** in Phase 7, gated on cloud success.
- Cloud light shafts research (Phase 6).

**Explicit non-goals (user-confirmed):**
- **No water work of any kind.** `src/water/Sea.js`, `WaterWorkshopSea.js`, `/workshop/water/`, `/workshop/waves/`, `/workshop/pool/` — untouched. User is actively tuning waves.
- **No LOD work.** The waves-LOD redesign (separate patch material, feathered radial alpha, base-layer suppression) is **not** part of this plan.
- **WebGPU tabled.** Not researched in this lab. Door stays open for the future; the door is not opened now.
- **No edits to `public/presets.json` or main-sim files.** Lab is a separate repo by design.
- **No credits in the main sim.** Attribution lives in `~/clouds/ATTRIBUTION.md` and the lab's README.

## 0.5 · Separate repo: why and what to copy

The lab lives at `~/clouds`, **not** inside `~/isometric`.

**Why separate:**
- The main repo is busy — pine workshop has work in flight, and other agents are iterating against it. A separate repo means no vite-restart collisions.
- The Takram atmosphere/cloud payload + `postprocessing` dep + `@takram/*` packages don't bloat the main repo until we know we're keeping them. The lab is temporarily back on the full LUT payload; compaction is a later packaging pass.
- Cleaner handoff target for a different Claude instance in VS Code, per user.
- If extraction succeeds (Phase 5+), we promote the result back to `~/isometric` as a clean PR; if it fails, we delete `~/clouds` without disturbing anything.

**What to copy from `~/isometric` into `~/clouds/src/shared/`** (one-time, at scaffold):

| file in main repo | role in lab |
|---|---|
| `src/workshop/_shared/panelShell.js` | `section`, `sliderField`, `enumField`, `makePanelChrome`, `makeStatusFlasher`, `ACCENTS` |
| `src/camera/FlyCameraDirector.js` | WASD camera (same as palm/pine workshops) |
| `src/ui/PerfOverlay.js` | fps/tris/draws overlay |
| `src/ui/panel.css` | panel styling, accent rails, slider tracks |
| `src/styles.css` | base styles (must import before `panel.css`) |
| `src/gen/noise.js` | `mulberry32` if we want deterministic per-instance variance |

Total: ~500 LOC + ~6 KB CSS. Acceptable copy-once cost.

**Drift risk:** if `panelShell.js` improves in the main repo, the lab doesn't get it automatically. Mitigation: the lab is research code by design; back-port deliberately if a main-repo improvement is worth it. The lab's panel UI is also a smaller surface than the sim's — most of the cloud UI will be Takram-specific anyway.

**What stays in the main repo:** `workshop/water/index.html` is the *template* for the lab's `index.html` (FOUC-killing CSS pattern + canvas mount), but the lab clones the file pattern, not the file itself. No import path from `~/clouds` reaches back into `~/isometric`.

## 1 · Five architectural decisions (recap from earlier draft, unchanged)

These are the architectural forks; the plan picks a default for each. The user should challenge any they disagree with before implementation starts.

### 1.1 · Will the lab use Takram's atmosphere LUTs, or only their clouds?

**Decision: use Takram atmosphere LUTs *in the sky lab only*.**

Reason: `CloudsEffect.frag` depends on Takram/Bruneton atmosphere textures for
the per-sample lighting model. Stubbing them with white textures degrades
clouds to "no scattering, no Mie peak, no ground bounce" — i.e., it stops
looking like Takram clouds, which defeats the prototype.

Payload correction, 2026-05-23: the compact combined-scattering experiment
proved useful for the eventual sub-15 MB goal, but it changed the reference
while we were still evaluating the sky. The lab is back to the full Takram LUT
set under `public/atmosphere/` with `combinedScattering: false` and
`higherOrderScattering: true`. The compact experiment remains documented by
`artifacts/compact-atmosphere-reference.md` and should be re-applied later
only after the full reference look is understood. Our
`SkyBackdrop`/`SkyViewLUT`/`TransmittanceLUT` in `~/isometric` are untouched.

### 1.2 · Vendor source from day one, or temporary package import?

**Decision: temporary package import for Phase 1, then extract in Phase 5.**

Reason: extracting Takram source up-front requires reimplementing their `resolveIncludes()` GLSL preprocessor, bundling 30+ shader chunks, packaging the WGS84 ellipsoid math, and pinning a fork of their internal API — before we know if clouds even look right in our scene. That's days of yak-shaving against an unknown outcome.

The package import gets clouds on-screen in hours, lets us tune UI + see performance on the target hardware, and only *then* commits to extraction with a known feature set. Marked clearly in code as a temporary spike (`// TODO(sky-lab): extract before integrating into main sim`).

### 1.3 · Replace the lab's sky with Takram's, or run both?

**Original decision: replace the lab's sky with Takram's `SkyMaterial` + `AerialPerspectiveEffect`.**

Reason: clouds composite against atmosphere via radiance buffers exchanged with `AerialPerspectiveEffect` (see `Clouds-Vanilla.tsx` lines 173-185, `setOverlayBuffer`/`setShadowBuffers` event wiring). Keeping two skies in the lab gives unclear color management. Pick one for the lab.

Correction, 2026-05-23: the lab now runs both modes. The default is the
faithful `Takram ref` stack with Takram sky, haze, clouds, full LUTs, ACES
finishing, and dithering. AGX is available manually for comparison. `legacy
sky` keeps Takram clouds but disables
Takram sky/haze so the old sim sky composite can be evaluated separately.
When clouds darken only in `legacy sky`, treat that first as a
radiance-domain mismatch, not a blend-mode bug.

### 1.4 · Postprocessing pipeline: integrate `postprocessing` lib or skip it?

**Decision: install `postprocessing` ≥6.36.7 in `~/clouds`. Stays out of `~/isometric`.**

Reason: `CloudsEffect` extends `postprocessing.Effect` and the vanilla path uses `EffectComposer` with HalfFloatType buffers, `NormalPass`, AGX `ToneMappingEffect`, and `DitheringEffect`. Forking `Effect` to standalone-Three multiplies extraction work.

### 1.5 · How does the lab handle the camera / ECEF coordinate frame?

**Decision: pin a fixed `worldToECEFMatrix` for the lab and align our FlyCamera against it.**

Reason: Takram clouds raymarch against a WGS84 ellipsoid. Place the lab camera at a fixed geodetic point (e.g. 35°N, 0°E, 100m altitude — Mediterranean-style), set `worldToECEFMatrix` once at lab init, let the FlyCamera roam in local meters. Cloud layer altitude is set in ECEF meters above the ellipsoid.

This is purely a research convenience — the lab is not pretending to be the sim.

## 2 · Sky lab file layout (`~/clouds`)

```
~/clouds/
  package.json                          ← three ^0.170, postprocessing ^6.36.7,
                                          @takram/three-clouds, @takram/three-atmosphere,
                                          @takram/three-geospatial, vite ^6
  vite.config.mjs                       ← host 127.0.0.1, port 57170, strictPort
  index.html                            ← lab entry (FOUC-killing CSS pattern from water workshop)
  README.md                             ← what it is, how to run, license summary
  ATTRIBUTION.md                        ← Takram MIT + Bruneton citation
  SKY_LAB_PLAN.md                       ← copy of this doc
  SKY_LAB_PLANNING_HANDOFF.md           ← copy of the earlier handoff
  SKY_LAB_HORIZON_NOTES.md              ← written in Phase 1
  SKY_LAB_EXTRACTION_MAP.md             ← written in Phase 5

  src/
    skyWorkshop.js                      ← entry: composer + camera + UI wiring
    SkyLabScene.js                      ← flat horizon stub + sun pivot, NO voxel island, NO water
    CloudsRig.js                        ← thin wrapper around Takram CloudsEffect + AerialPerspectiveEffect
    AssetLoader.js                      ← loads atmosphere LUTs + cloud weather/shape/STBN
    skyLabPanel.js                      ← 9-section panel (see §4)
    skyLabState.js                      ← localStorage namespaced `skyLab.state.v1`
    shared/                             ← copied from ~/isometric at scaffold (see §0.5)
      panelShell.js
      FlyCameraDirector.js
      PerfOverlay.js
      panel.css
      styles.css
      noise.js

  public/
    atmosphere/transmittance.bin
    atmosphere/scattering.bin
    atmosphere/irradiance.bin
    clouds/local_weather.png
    clouds/shape.bin
    clouds/shape_detail.bin
    clouds/turbulence.png
    clouds/stbn.bin
```

**Port choice:** `57170`. The original scaffold used `5170`; after the
water-fork repair we moved to a high unique port because other agents may
have local Vite/browser sessions active. Keep this repo headless unless the
user explicitly asks to open it.

**Headless capture timing:** wait at least `10_000ms` after workshop boot or
after loading a scene preset before screenshots, pixel reads, screenshots grids,
or UI assertions. The canonical value is `WORKSHOP_CAPTURE_SETTLE_MS` in
`src/config/captureTiming.js`, mirrored at `window.skyLab.captureSettleMs`.
This avoids judging half-built frames on the target MacBook.

## 3 · Phased work plan

Original cadence: each phase ends with a screenshot the user can sign off on.
**2026-05-23 update:** user explicitly allowed running ahead without stopping
at checkpoints for a while. Keep producing headless proof artifacts, but do not
pause at every phase gate unless something risky or cross-repo appears.

### Phase 0 — scaffold (1 small step)
- `mkdir ~/clouds`, init `package.json`, `vite.config.mjs`, `index.html`.
- Copy shared infra from `~/isometric/src/` per §0.5.
- Create `src/skyWorkshop.js` with: renderer, scene, FlyCamera, empty Group, panel shell from copied `panelShell.js`, status flasher.
- Confirm `http://127.0.0.1:57170/` loads the copied water-workshop fork.
- Write `README.md` + `ATTRIBUTION.md` skeletons (Takram MIT, Bruneton precomputed atmospheric scattering citation).
- **Exit:** screenshot of empty lab.

### Phase 1 — horizon-strip diagnosis (no fixing)
- Add a `sky diagnosis` panel section with toggles: sky-only / sea-only-stub / floor-only-stub / magenta-clear / disable-horizon-warp / force-below-horizon-fog.
- Reproduce the black band in the lab by **mirroring the sim's `SkyBackdrop` logic** (copy the GLSL/JS, do NOT import it; the lab is a separate repo).
- Generate a short diagnosis report: which toggle eliminates the band, and which `SkyViewLUT` ray path returns black. Save findings to `~/clouds/SKY_LAB_HORIZON_NOTES.md`.
- **Do not fix the strip.** Phase 7 may fix it, gated on cloud success.
- **Exit:** diagnosis doc + screenshot grid.

### Phase 2 — Takram atmosphere + cloud asset load
- `npm install postprocessing@^6.36.7 @takram/three-clouds @takram/three-atmosphere @takram/three-geospatial`.
- Copy atmosphere + cloud assets to `public/` from `node_modules/@takram/*/assets/` (one-time, document the source commit hash in `ATTRIBUTION.md`).
  - `stbn.bin` is the exception: `@takram/three-geospatial@0.9.1` exposes
    `STBNLoader` but does not ship the binary. Download it from the Takram
    GitHub media URL pinned in the package's `constants.ts`; blobless clones
    leave only a 132-byte Git LFS pointer.
- Build `AssetLoader.js`: loads the full runtime set via Takram's
  `PrecomputedTexturesLoader` + `Data3DTextureLoader`. Cache promises, report
  load progress to the panel.
- Set up the EffectComposer: HalfFloat target, `RenderPass` → `NormalPass` →
  optional cloud/haze effect slot → final `ToneMappingEffect`. Renderer
  tonemap = `NoToneMapping` only while the Takram composer renders.
  - Dithering note, 2026-05-23: Takram's vanilla story imports
    `DitheringEffect` from `@takram/three-geospatial-effects`, not from
    `postprocessing`. The current lab intentionally did **not** add that extra
    package. The finishing panel now exposes `postprocessing`'s built-in
    fullscreen pass dithering toggle; it defaults on in `Takram ref` and off in
    `legacy sky`.
  - Tone-map correction, 2026-05-24: ACES is the lab default because the old
    sim aesthetic was tuned around it. AGX remains available only when the user
    manually selects it in the tone-map control.
- Drop the lab's existing sky stub; install Takram's `SkyMaterial`. Sun direction wired to "sun azimuth/elevation" pair in the panel.
- **Exit:** clean horizon, no clouds yet. The point is "atmosphere only, drawn the Takram way, in our lab".

### Phase 3 — first cloud layer
- Instantiate `CloudsEffect`, set `worldToECEFMatrix` per §1.5, set `sunDirection`, default to `qualityPresets.medium` for the original smoke test.
- Insert into the effect pass alongside `AerialPerspectiveEffect`. Wire the overlay/shadow buffer event exchange per `Clouds-Vanilla.tsx:173-185`.
- One enabled `CloudLayer` (the others off): altitude 750m, height 600m, density 0.4, coverage 0.6.
- Reference correction, 2026-05-23: the single-layer smoke test was too muted
  and read as haze. Takram's own vanilla/default stack is visibly cloudy: r
  layer at 750m/650m/density 0.2, g layer at 1000m/1200m/density 0.2, b layer
  at 7500m/500m/density 0.003/shape 0.4, global coverage 0.4. The lab now
  defaults to that reference stack with quality `high` and resolution scale
  `0.75`, while the panel's `Reference stack` toggle can still isolate one
  editable layer. Proof artifact:
  `artifacts/visible-clouds/grid.png`; probe: `artifacts/visible-clouds/probe.json`.
- Verify FPS budget on MacBook-class hardware (target ≥30 fps at quality=medium at 1280×800).
- **Exit:** screenshot grid: looking up / horizon / toward sun / away from sun. **This is the gate** — if clouds don't look promising here, stop and reassess with the user; do not proceed to Phase 4+.

### Phase 4 — UI segmentation
- Implement the 9-section panel from §4 below.
- All sections collapsible; lab defaults: `sky diagnosis` + `clouds render` open, rest collapsed.
- Sticky / pin pattern: out of scope for this lab (different lab, different problem). Plain sliders.
- **Exit:** screenshot of full panel + matrix of rolls if randomize lands.

### Phase 5 — extraction map (NOT extraction itself)
- **2026-05-23 status:** written as `SKY_LAB_EXTRACTION_MAP.md`.
  Extraction itself has not started. The map repeats the dithering correction:
  Takram's story gets `DitheringEffect` from
  `@takram/three-geospatial-effects`, not from `postprocessing`.
- Write `~/clouds/SKY_LAB_EXTRACTION_MAP.md`. Inventory:
  - exact `.ts` files to vendor (CloudsEffect, CloudsPass, CloudsMaterial, ShadowPass, CascadedShadowMaps, CloudLayers, qualityPresets, uniforms, PassBase),
  - all `.glsl` chunks under `packages/clouds/src/shaders/` + the `packages/core/src/shaders/` chunks they #include (math, depth, raySphereIntersection, cascadedShadowMaps, vogelDisk, interleavedGradientNoise, generators),
  - atmosphere shader chunks if we keep Takram atmosphere (bruneton/definitions, bruneton/common, bruneton/runtime),
  - the `resolveIncludes()` shader preprocessor (~150 LOC),
  - asset list + license attribution boilerplate,
  - which classes need API surgery to drop the `@takram/three-geospatial` peer dep.
- **Do not extract in Phase 5.** Extraction is its own approved task. The map is the deliverable.

### Phase 6 — cloud light shafts (only if Phase 3 was a win)
- **2026-05-23 status:** written as `SKY_LAB_LIGHT_SHAFTS_NOTES.md`.
  Light shafts are wired, the shadow-length debug view is exposed, and
  headless proof artifacts live under `artifacts/light-shafts/`.
- Toggle `clouds.lightShafts = true`. Verify shadow length buffer wires into `AerialPerspectiveEffect` correctly.
- Compare visually with `~/isometric/src/postfx/`'s god-ray pass: these are NOT the same effect (screen-space radial scatter vs volumetric cloud-shadow integration). Comparison is conceptual; we don't import that pass.
- Document budget impact: `maxShadowLengthIterationCount`, `minShadowLengthStepSize`, `maxShadowLengthRayDistance`.
- **Exit:** comparison screenshots, perf numbers.

### Phase 7 — fix the horizon strip (only if Phase 3 succeeded)
**This phase did not exist in the earlier draft.** Added per user instruction: fix only if clouds are working and worth keeping.

- Re-read the Phase 1 diagnosis report.
- The fix probably lives in `~/isometric/src/atmosphere/SkyBackdrop.js` (ground-albedo branch for rays that hit the planet), not in `~/clouds`. So Phase 7 is **the first time work crosses back into `~/isometric`** — it should be a small, scoped PR proposed to the user, not bundled with the cloud work.
- If the diagnosis points elsewhere (finite ocean disc edge, fog color mismatch, tonemap), that's a different fix — surface the alternative and let the user pick.
- **Do not modify `Sea.js` or any water file** even if the diagnosis implicates water-disc geometry. Surface the finding; user decides.
- **Exit:** before/after screenshots in `~/isometric` main sim, user sign-off.

## 4 · UI segmentation (clouds-only slice)

Follows the 9-section structure from the handoff, with sections ordered to reflect "what blocks what":

| # | Section | Open by default? | Why this order |
|---|---|---|---|
| 1 | sky diagnosis | yes | The horizon strip must be understood before clouds add noise |
| 2 | atmosphere | no | Takram atmosphere params (Rayleigh / Mie / ozone / sun) once the sky is correct |
| 3 | clouds render | yes | Quality preset + resolution scale — performance modes, not art |
| 4 | cloud weather | no | Coverage + repeat + velocity for the weather noise |
| 5 | cloud layers | no | Up to 4 layer cards; altitude + height + density per layer; solo/mute toggles |
| 6 | cloud lighting | no | Scattering / absorption / anisotropy / sky-light / ground-bounce / powder |
| 7 | cloud shadows + shafts | no | Beer shadow map cascade controls + light shafts (Phase 6) |
| 8 | debug | no | Sample count, front depth, shadow map, cascades, UV, shadow length, velocity views |
| 9 | lens / finishing | collapsed | Tone-map selector + optional built-in pass dithering; lens effects remain research-only |

Notably absent (intentionally):
- No "atmosphere debug view" of *our* `SkyViewLUT` / `TransmittanceLUT` — the lab uses Takram's atmosphere, not ours. Comparing our LUTs to Takram's is a different research question.
- No water section.
- No LOD section.

## 5 · Asset + dependency inventory

**Runtime asset weight (`~/clouds/public/`):**

| asset | size | purpose |
|---|---:|---|
| `atmosphere/scattering.bin` | 8.0 MB | Bruneton scattering LUT |
| `atmosphere/single_mie_scattering.bin` | 8.0 MB | Single Mie scattering LUT |
| `atmosphere/higher_order_scattering.bin` | 8.0 MB | Higher-order scattering LUT |
| `atmosphere/transmittance.bin` | 128 KB | Transmittance LUT |
| `atmosphere/irradiance.bin` | 8 KB | Ground + sky irradiance |
| `clouds/shape.bin` | 2.0 MB | 3D Perlin noise (64³) |
| `clouds/stbn.bin` | 1.0 MB | Spatio-temporal blue noise |
| `clouds/local_weather.png` | 680 KB | 2D weather/coverage map |
| `clouds/shape_detail.bin` | 32 KB | 3D detail noise (16³) |
| `clouds/turbulence.png` | 50 KB | 2D flow distortion |
| **Total** | **27.86 MiB** | current Vite public atmosphere+cloud payload |

The compact combined-scattering experiment is retained as a reference for the
later packaging pass. It used `scattering.bin`, `transmittance.bin`, and
`irradiance.bin` only with `combinedScattering: true` and
`higherOrderScattering: false`, reducing the public atmosphere+cloud payload
to `11.86 MiB`. Do not re-enable it until the full-LUT Takram reference is
visually pinned down.

**npm dependencies (`~/clouds/package.json`):**

| package | version | role |
|---|---|---|
| `three` | `^0.170.0` | match the main sim version |
| `postprocessing` | `^6.36.7` | required by Takram clouds |
| `@takram/three-clouds` | latest | spike — extracted in Phase 5 |
| `@takram/three-atmosphere` | latest | spike — extracted in Phase 5 |
| `@takram/three-geospatial` | latest | spike (provides `resolveIncludes()` + ellipsoid math) |
| `@takram/three-geospatial-effects` | not installed | optional later source of `DitheringEffect` / lens effects |
| `vite` | `^6.0.0` | match main sim |

All four research deps are MIT. Attribution lives in `~/clouds/ATTRIBUTION.md`.

## 6 · Risks (ordered by likelihood × cost)

1. **Color management mismatch.** Takram's story uses AGX and high exposure, while the old sim uses ACES and a more stylized exposure range. — *Mitigation: the lab defaults to `Takram ref`; `legacy sky` is explicitly marked as a radiance-domain experiment, and the panel exposes ACES/neutral/AGX/linear.*
2. **Performance on MacBook Air.** Takram clouds at `high` preset stress integrated GPUs (per [[hardware-target]]). — *Mitigation: current default uses `high` only because it makes the reference stack legible for review; keep `low`/`medium` toggles prominent and report fps in the panel.*
3. **Horizon strip diagnosis points to `SkyViewLUT`, not the geometry.** Phase 7 then has to modify `~/isometric/src/atmosphere/SkyBackdrop.js` — crossing the repo boundary. — *Mitigation: Phase 7 is its own scoped PR with user sign-off; doesn't bundle with cloud work.*
4. **Extraction in Phase 5 reveals deeper Takram internals than estimated.** `resolveIncludes()` is straightforward (~150 LOC) but the GLSL chunk include order is layered. — *Mitigation: Phase 5 writes the map only; extraction is a separately-approved follow-up.*
5. **Shared-infra drift.** `panelShell.js` and friends are *copies* in `~/clouds/src/shared/`. Main-repo improvements don't reach the lab automatically. — *Mitigation: lab is research code; back-port deliberately or live with the older shell. Re-sync from main is a one-line `cp`.*
6. **`postprocessing` lib upgrade pressure.** Pinned to `^6.36.7`. Future three.js upgrades may pull on it. — *Mitigation: lab is throwaway by design; pin is acceptable.*
7. **Asset weight balloons the dev build.** The full Takram atmosphere set is ~24 MB before cloud assets. — *Mitigation: accept the full payload while evaluating the reference; keep the compact combined-scattering recipe as the later path back toward the sub-15 MB target.*

## 7 · User answers (was "open questions", now committed)

| # | Question | Answer |
|---|---|---|
| 1 | Horizon strip — fix in lab, fix in main, or just diagnose? | Diagnose now; fix in Phase 7 only if clouds succeed. |
| 2 | WebGPU scope? | Tabled. Research-only door stays open; not pursued in this lab. |
| 3 | Port? | New port `57170` in `~/clouds` repo with its own vite config. |
| 4 | Clone from which lab? | Water lab only. Not waves, not pool. |
| 5 | Credits & license? | `~/clouds/ATTRIBUTION.md` + README. No credits surface in the main sim. |

## 8 · What the next agent does first

1. Read [SKY_LAB_PLANNING_HANDOFF.md](SKY_LAB_PLANNING_HANDOFF.md) end-to-end.
2. Read this plan.
3. `mkdir ~/clouds`, run Phase 0 scaffold. Copy shared infra from `~/isometric/src/` per §0.5.
4. Re-clone Takram source for reference: `git clone --depth 1 --filter=blob:none https://github.com/takram-design-engineering/three-geospatial.git /tmp/three-geospatial` (handoff pinned commit `fc25526342a01d8e2b02f527fceb7f876e34b6d8` — use that if it still resolves). Do not use that blobless clone as the source for `stbn.bin`; download the real 1.0 MB asset from Takram's media URL as documented in `ATTRIBUTION.md`.
5. Phase 0 → screenshot → stop → user sign-off → Phase 1.

## 9 · What this plan does NOT cover

- Extraction itself (Phase 5 writes the map; extraction is a follow-up plan).
- Main-sim integration of clouds (post-extraction decision, not on the horizon).
- WebGPU migration of clouds or atmosphere.
- Lens-flare implementation.
- Reworking `~/isometric/src/atmosphere/` (except possibly the horizon-strip fix in Phase 7, which is a separate scoped PR).
- Anything in `~/isometric/src/water/`, `src/workshop/water/`, `src/workshop/waves/`, `src/workshop/pool/`.
- LOD / patch-material work in any lab.
- Sticky / pin UI in the sky lab (deferred to a separate design).
- Consolidated attribution surface in the main sim (separate later task per user).
