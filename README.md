# Sunset Sky

Disposable sunset-first fork of `/Users/asmith/clouds`.

The goal is to get Takram clouds working in dramatic sunset skies, even if this
fork eventually destroys or rebuilds the current sim. The current evidence says
the sky/cloud side already works; the first experiment should be island
relighting, not a full rewrite.

## Run

```sh
npm install
npm run dev
# http://127.0.0.1:57210/
```

Start with [SUNSET_SKY_HANDOFF.md](SUNSET_SKY_HANDOFF.md), then inspect
[sunset-prior-art-contact.png](reference/sunset-prior-art/sheets/sunset-prior-art-contact.png).

Headless smoke check:

```sh
npm run smoke
```

Canonical capture timing: wait 10 seconds after boot or after loading a preset
before judging screenshots or pixel samples. The shared value is
`WORKSHOP_CAPTURE_SETTLE_MS` in `src/config/captureTiming.js`, and the live app
exposes it as `window.sunsetSky.captureSettleMs` and `window.island.captureSettleMs`.

## Current Shape

- Root entrypoint: `index.html` -> `src/island.js`.
- Upper-left badge: `sunset-sky`.
- One preset system: banks `A-H`, slots `1-8`.
- Shift-click or shift-number saves a master preset.
- A master preset captures all current params plus camera pose.
- Cloud and wave mini preset rows have been removed.
- Sticky persistence is removed. The diamond is only a purple, local,
  in-session important-param marker.
- Takram ref and legacy sky paths remain available; ACES is the default tone
  mapping path, with AGX only for manual comparison.
- Pool, methodology, palm, and pine workshops remain. Water, waves, godray,
  old lab, and old main entrypoints have been retired.

## Files

```
~/sunset-sky/
├── index.html
├── src/island.js
├── src/island/IslandSea.js
├── src/TakramSkyRig.js
├── src/config/presets.js
├── src/ui/
├── src/core/
├── src/atmosphere/
├── workshop/pool/
├── workshop/methodology/
├── workshop/palm/
├── workshop/pine/
├── public/atmosphere/
└── public/clouds/
```

## Notes

- Do not import from `~/isometric`; this repo is a local fork.
- Do not assume the sky/cloud path is broken: inspect `reference/sunset-prior-art/` first.
- Do not mutate `presets.json` unless deliberately saving/replacing a preset.
- Tree workshop code is golden and should stay isolated from island cleanup.
- Atmosphere payload is still the full Takram/Bruneton LUT set for now. The
  later packaging pass can re-compact toward the sub-15 MB goal.
