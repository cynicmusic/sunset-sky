# ISLAND_INTEGRATION_PLAN

Authoritative plan for collapsing the Takram clouds lab into the canonical
island sim.

The older sky-lab phase docs remain in `archive/sky-lab-research/` as research
notes. This file is the current source of truth.

## Current Truth

- Live URL: `http://127.0.0.1:57170/`
- Root app name: `island`
- Upper-left badge text: `island`
- Root entrypoint: `index.html` loads `src/island.js`
- Current default reload state is intentional.
- Current scene preset slots `A1-H8` are intentional and accepted as-is.
- User-verified priority slots: reload, then presets `1`, `2`, and `3` are good.
- Cloud and wave values that ship with current slots are fine for now.
- Tree workshop/state is golden. Do not touch tree workshop code as part of
  island consolidation.

## Preset Direction

One master preset surface wins:

- Banks `A-H`, slots `1-8`.
- Click loads the selected master preset.
- Shift-click or shift-number saves a complete master preset.
- A master preset captures every user-facing sim parameter: clouds, Takram
  atmosphere, cloud lighting/weather/layers/shadows, water, waves, sun, legacy
  atmosphere, lighting, island, voxel, seasons, tree, shadows, render, god rays,
  finishing, and camera pose.
- Loading a master preset fully replaces workshop state and then fills any new
  missing defaults.
- Purple diamond markers are local in-session reminders only. They never persist
  and never override preset load/save.
- Separate cloud and wave mini rows are retired.

## Sky Direction

- Keep the legacy/Hillaire sky path available for now.
- The approved mix where the old sky influences the water while Takram owns the
  clouds remains valid.
- Keep Takram ref/Takram atmosphere routed through ACES by default.
- AGX remains a manual comparison option only.
- Do not allow route buttons or mode switches to silently invoke AGX.

## Retired Entrypoints

Retired from this repo's active app surface:

- old main sim entrypoint
- old lab entrypoint
- water workshop route
- waves workshop route
- godray workshop route

Kept:

- pool workshop
- methodology workshop
- palm workshop
- pine workshop

## Guardrails

- Do not write preset files while refactoring unless the task explicitly says to
  save/replace a preset.
- Do not reintroduce sticky persistence.
- Do not let cloud or wave partial presets mutate state.
- Do not change tree workshop code during island cleanup.
- Use the 10 second settle rule before screenshot or smoke assertions.

## Exit Criteria

- Reload at `http://127.0.0.1:57170/` preserves the accepted default.
- Presets `1`, `2`, and `3` remain visually correct.
- One master preset package captures and restores every parameter plus camera.
- No cloud/wave mini preset UI or API remains active.
- No sticky persistence remains active.
