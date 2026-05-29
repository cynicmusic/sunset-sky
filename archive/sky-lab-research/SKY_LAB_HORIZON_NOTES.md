# Sky Lab Horizon Notes

Date: 2026-05-23
Repo: `/Users/asmith/clouds`
Port: `http://127.0.0.1:57170/`

## Status

Phase 1 diagnosis controls are wired into the local water-workshop fork:

- `sky only`
- `sea only`
- `floor only`
- `magenta clear`
- `disable warp`
- `below-horizon fog`
- `fast sky boot` for headless/sky-only probes, off by default
- `hide island`, off by default

The root page still boots the copied water workshop path by default. The
diagnosis toggles are opt-in and do not modify `~/isometric`.

## Evidence

Raw headless diagnostic data:

- `artifacts/horizon-diagnostics.json`

The probe used `window.skyLab.diagnostics()` to sample the copied
`SkyViewLUT` render target rows and record renderer stats after switching
diagnosis modes.

Screenshot capture note:

- Chromium headless reached the WebGL scene and diagnostics, but
  `Page.captureScreenshot` timed out on this page. I stopped after one
  controlled attempt to avoid background browser churn.

## LUT Findings

With default horizon warp enabled, the sampled `SkyViewLUT` rows did not
return exact black on this baseline:

| mode | row / v | avg rgb | dark pct |
|---|---:|---:|---:|
| default | 63 / 0.4961 | 0.3366, 0.53779, 1.7545 | 0 |
| default | 64 / 0.5039 | 0.33521, 0.53565, 1.7488 | 0 |
| default | 65 / 0.5118 | 0.32971, 0.5273, 1.726 | 0 |

Rows farther below/above the horizon are much darker, but still nonzero:

| mode | row / v | avg rgb | dark pct |
|---|---:|---:|---:|
| default | 0 / 0.0000 | 0.00030832, 0.0005263, 0.0019034 | 0 |
| default | 32 / 0.2520 | 0.0011497, 0.0019621, 0.0070947 | 0 |
| default | 127 / 1.0000 | 0.0069292, 0.011999, 0.043588 | 0 |

Disabling horizon warp makes the just-below-horizon rows dramatically
darker before the horizon row brightens:

| mode | row / v | avg rgb | dark pct |
|---|---:|---:|---:|
| disable warp | 61 / 0.4803 | 0.007313, 0.01247, 0.04498 | 0 |
| disable warp | 63 / 0.4961 | 0.047726, 0.080883, 0.28727 | 0 |
| disable warp | 64 / 0.5039 | 0.26239, 0.42365, 1.4324 | 0 |

This suggests horizon warp is not the source of an exact black return in
the current copied baseline. If anything, turning it off worsens the
near-horizon luminance cliff.

## Mode Sanity

Renderer stats confirm the isolation toggles are taking effect:

| mode | triangles | draw calls |
|---|---:|---:|
| default | 17,315,094 | 5,821 |
| sky only | 14 | 7 |
| sea only | 409,802 | 9 |
| floor only | 202 | 7 |

## Current Read

The current data does not show `SkyViewLUT` returning exact black at the
horizon in the default copied water fork. The likely issue is a visual
composite/contrast problem rather than a literal black LUT row:

- very dark below-horizon sky rows are present,
- ocean/floor alpha or finite-disc exposure can reveal those dark rows,
- disabling horizon warp creates a stronger luminance cliff,
- the diagnostic `below-horizon fog` branch is still useful as a future
  visual comparison, but it is not a committed fix.

## Not Fixed

No production horizon fix was made. The only shader change is a
diagnostic-only branch in `src/atmosphere/SkyBackdrop.js`, controlled by
the `sky diagnosis` panel.

Phase 7 should re-open this after Phase 3 cloud success, with screenshots
from a non-headless browser or a more reliable WebGL capture path.
