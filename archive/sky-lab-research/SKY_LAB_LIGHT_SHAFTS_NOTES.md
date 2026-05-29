# Sky Lab Light Shafts Notes

Phase 6 notes for Takram cloud light shafts.

## Status

Light shafts are wired and verified in the lab.

- `cloudShadows.lightShafts` toggles Takram's shadow-length output.
- `TakramSkyRig` feeds `clouds.atmosphereShadowLength` into
  `AerialPerspectiveEffect.shadowLength`.
- `cloudDebug.mode = 6` now exposes `DEBUG_SHOW_SHADOW_LENGTH`.
- `cloudDebug.mode = 7` remains the velocity debug view.
- Headless runtime probe reported no console error or warning events.

## Artifacts

```text
artifacts/light-shafts/off.png
artifacts/light-shafts/on-default.png
artifacts/light-shafts/on-cheap.png
artifacts/light-shafts/shadow-length-debug.png
artifacts/light-shafts/probe.json
artifacts/takram-light-shafts-grid.png
```

The grid layout is:

```text
off           | on-default
on-cheap      | shadow-length-debug
```

## Budget Probe

Headless Chrome, 1280x800, sky-only isolation, medium cloud quality,
resolution scale 0.5, temporal upscale on.

| case | shafts | steps | min step | reach | fps |
|---|---:|---:|---:|---:|---:|
| off | no | 180 | 80 m | 120 km | 101.80 |
| on-default | yes | 180 | 80 m | 120 km | 85.89 |
| on-cheap | yes | 80 | 120 m | 80 km | 101.56 |
| shadow-length-debug | yes | 180 | 80 m | 120 km | 121.64 |

The debug-view FPS is not visually comparable to the normal composite because
the resolve shader is showing the shadow-length buffer directly. Treat it as a
debug sanity check, not a production budget number.

The default shaft budget cost about 15.6 percent in this isolated probe:

```text
(101.80 - 85.89) / 101.80 = 0.156
```

The cheaper budget recovered almost all of the measured cost in this scene.
That does not mean it is universally free; it means the exposed budget knobs
are effective and should become quality-tier settings if this is promoted.

## Visual Read

The effect is subtle with the current cloud preset. It mostly changes the
cloud-shadow haze and near-sun aerial perspective rather than drawing obvious
screen-space streaks. The shadow-length debug view confirms the buffer is live
and reaching `AerialPerspectiveEffect`.

## Takram Shafts vs Main-Sim God Rays

Takram light shafts:

- Compute a cloud shadow-length buffer during cloud raymarch/resolve.
- Feed that shadow length into aerial perspective.
- Are tied to volumetric cloud density and atmosphere.
- Affect the physically motivated atmosphere/cloud composite.

The copied `src/fx/PostFX.js` god rays:

- Run as a low-resolution screen-space radial march from the projected sun UV.
- Use scene depth and sky/occluder masks.
- Add an upsampled ray buffer in the final composite.
- Are an artistic post effect, not a volumetric cloud-shadow integration.

They can coexist conceptually, but they are not interchangeable. If Takram
clouds move into the main sim, cloud shafts should be controlled separately
from the existing god-ray section.

## Recommendation

Keep light shafts default-off in the lab UI and any first integration. If the
look becomes important, enable it only in higher quality modes or use a cheaper
budget near:

```text
shadowLengthIterations = 80
shadowLengthStep = 120 m
shadowLengthDistance = 80 km
```

The current full default budget remains useful for proof captures and debug
comparison:

```text
shadowLengthIterations = 180
shadowLengthStep = 80 m
shadowLengthDistance = 120 km
```

