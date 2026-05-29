// Declarative schema for the control panel. Same shape as sunset's so the
// ported ControlPanel builds it verbatim. Every tunable in PLAN.md becomes a
// field here — the whole island is live-tunable through the ported UI.

export const schema = {
  sun: {
    label: 'sun',
    icon: '☉',
    blurb: 'drives both the Hillaire sky and the island key light',
    fields: {
      elevationDeg: { type: 'float', label: 'Elevation', min: -10, max: 90, step: 0.5, default: 26, unit: '°', hint: 'low = warm sunset · high = bright noon' },
      azimuthDeg: { type: 'float', label: 'Azimuth', min: -180, max: 180, step: 1, default: -84, unit: '°', hint: 'rakes the terrain — avoids flat back-to-sun lighting' },
      intensity: { type: 'float', label: 'Intensity', min: 1, max: 60, step: 0.5, default: 22 },
    },
  },

  atmosphere: {
    label: 'atmosphere',
    icon: '◐',
    blurb: 'Hillaire 2020 — Rayleigh / Mie / ozone',
    fields: {
      rayleighMul: { type: 'float', label: 'Rayleigh ×', min: 0.0, max: 4.0, step: 0.01, default: 1.0 },
      mieBeta: { type: 'float', label: 'Mie β', min: 0.0, max: 0.05, step: 0.0005, default: 0.021, hint: 'haze thickness' },
      mieG: { type: 'float', label: 'Mie g', min: 0.0, max: 0.95, step: 0.005, default: 0.758 },
      ozoneMul: { type: 'float', label: 'Ozone ×', min: 0.0, max: 3.0, step: 0.01, default: 1.0 },
      planetRadiusKm: { type: 'float', label: 'Planet R', min: 150, max: 6371, step: 25, default: 6371, unit: 'km', hint: '6371 = Earth · lower bends the horizon/sky harder' },
    },
  },

  // Lighting / post. Sky-tinted ambient bounce + analytic water sun-glint
  // are live (free, in-shader). Bloom + aerial haze are staged behind a
  // shared offscreen pass (mobile budget — built once, not per-effect).
  lighting: {
    label: 'lighting',
    icon: '✦',
    blurb: 'sky-tinted bounce · water sun-glint · bloom · aerial haze',
    fields: {
      skyBounce: { type: 'float', label: 'Sky bounce', min: 0, max: 1.6, step: 0.02, default: 0.55, hint: 'faked GI — hemisphere fill tinted by the live sky' },
      bounceTint: { type: 'float', label: 'Bounce tint', min: 0, max: 1, step: 0.02, default: 0.7, hint: 'how hard the bounce pulls toward the sampled sky colour' },
      groundBounce: { type: 'float', label: 'Ground bounce', min: 0, max: 1, step: 0.02, default: 0.3, hint: 'warm up-light from the lit ground' },
      sunElevationGain: { type: 'float', label: 'Sun elev gain', min: 0, max: 1, step: 0.01, default: 0.45, hint: 'how much sun elevation changes island light power; lower = steadier grading' },
      sunFloor: { type: 'float', label: 'Sun floor', min: 0, max: 4, step: 0.02, default: 0.8, hint: 'minimum legacy direct-light power at low sun' },
      sunCeiling: { type: 'float', label: 'Sun ceiling', min: 0, max: 5, step: 0.02, default: 2.0, hint: 'maximum legacy direct-light power at high sun' },
      secondaryEnergy: { type: 'float', label: 'Coarse energy', min: 0, max: 1.5, step: 0.01, default: 0.55, hint: 'energy scale for the second legacy sun in add shadow mode' },
      sunGlint: { type: 'float', label: 'Sun glint width', min: 0, max: 2.5, step: 0.05, default: 0.7, hint: 'analytic specular sun streak on the sea' },
      glintSpread: { type: 'float', label: 'Glint spread', min: 0.2, max: 4, step: 0.05, default: 1.1, hint: 'lower = tight mirror streak · higher = broad shimmer' },
      bloom: { type: 'float', label: 'Bloom', min: 0, max: 1.5, step: 0.02, default: 0, hint: 'staged — shared post pass (0 = off, zero cost)' },
      aerialHaze: { type: 'float', label: 'Aerial haze', min: 0, max: 1, step: 0.02, default: 0, hint: 'staged — sky-coloured depth haze (0 = off)' },
    },
  },

  // World structure. These are NOT randomized (by design) and use the
  // amber "structural pin" — pinning them is a deliberate, major decision,
  // not the fun lime "roll-friendly" pin.
  voxel: {
    label: 'voxel',
    icon: '⬚',
    blurb: 'world structure — never randomized · pin (◆ amber) to lock',
    fields: {
      seed: { type: 'int', label: 'Seed', min: 1, max: 99999, step: 1, default: 1337, hint: 'the island. not rolled by random — ◆ to keep one' },
      resolution: { type: 'int', label: 'Voxel grid', min: 128, max: 1024, step: 32, default: 384, hint: 'cells across the world · structural, never randomized' },
      terraceStep: { type: 'float', label: 'Terrace step', min: 0, max: 8, step: 0.5, default: 2.5, unit: 'm', hint: '0 = smooth · >0 = stepped terraces · structural' },
    },
  },

  island: {
    label: 'island',
    icon: '▲',
    blurb: 'bounded voxel island — mask + domain-warp + ridged multifractal',
    fields: {
      radius: { type: 'float', label: 'Radius', min: 300, max: 1100, step: 10, default: 700, unit: 'm', hint: 'island size — bigger = more room for beaches/relief' },
      shape: { type: 'int', label: 'Shape', min: 0, max: 4, step: 1, default: 0, hint: '0 auto (from seed) · 1 round · 2 crescent · 3 long · 4 lobed' },
      lowland: { type: 'float', label: 'Lowland relief', min: 6, max: 90, step: 2, default: 32, unit: 'm', hint: 'rolling-hill amplitude of the bulk of the island' },
      massif: { type: 'float', label: 'Massif height', min: 0, max: 480, step: 10, default: 150, unit: 'm', hint: 'localized mountain uplift above the lowland' },
      massifSharpness: { type: 'float', label: 'Massif sharpness', min: 0.45, max: 2.2, step: 0.05, default: 1, hint: 'higher = narrower, pointier summit envelope' },
      massifOffsetX: { type: 'float', label: 'Massif east/west', min: -0.45, max: 0.45, step: 0.01, default: 0, hint: 'manual mountain placement as a fraction of island radius' },
      massifOffsetZ: { type: 'float', label: 'Massif north/south', min: -0.45, max: 0.45, step: 0.01, default: 0, hint: 'manual mountain placement as a fraction of island radius' },
      warp: { type: 'float', label: 'Domain warp', min: 0, max: 2, step: 0.05, default: 0.85, hint: 'bends the noise sampling coordinates; not a simple rotation' },
      ridge: { type: 'float', label: 'Ridge weight', min: 0, max: 1.5, step: 0.05, default: 0.7, hint: 'ridged multifractal — sharp spines' },
      beachWidth: { type: 'float', label: 'Beach apron', min: 2, max: 50, step: 1, default: 16, unit: 'm', hint: 'raises/extends the low coastal apron; also preserves golf-course greens' },
      valleyDepth: { type: 'float', label: 'Valley carve', min: 0, max: 180, step: 5, default: 55, unit: 'm', hint: 'gully → river → delta cut (post-build subtraction) · 0 = off' },
      valleyWidth: { type: 'float', label: 'Valley width', min: 8, max: 60, step: 2, default: 22, unit: 'm', hint: 'channel half-width near source · widens downstream' },
    },
  },

  lagoon: {
    label: 'lagoon',
    icon: '◌',
    blurb: 'inland water · white sand · palm/fringe anchor',
    fields: {
      enable: { type: 'bool', label: 'Lagoon', default: true, hint: 'first-class inland lagoon, separate from valley/delta' },
      x: { type: 'float', label: 'East/west', min: -0.55, max: 0.55, step: 0.01, default: 0.24, hint: 'lagoon center as island-radius fraction' },
      z: { type: 'float', label: 'North/south', min: -0.55, max: 0.55, step: 0.01, default: -0.12, hint: 'lagoon center as island-radius fraction' },
      radiusX: { type: 'float', label: 'Long radius', min: 40, max: 420, step: 5, default: 230, unit: 'm', hint: 'major axis of the lagoon bowl' },
      radiusZ: { type: 'float', label: 'Short radius', min: 30, max: 320, step: 5, default: 135, unit: 'm', hint: 'minor axis of the lagoon bowl' },
      rotation: { type: 'float', label: 'Rotation', min: -180, max: 180, step: 1, default: -24, unit: '°', hint: 'rotates the lagoon ellipse' },
      depth: { type: 'float', label: 'Depth', min: 0.1, max: 8, step: 0.1, default: 1.4, unit: 'm', hint: 'floor below sea datum at the center' },
      lowlandCap: { type: 'float', label: 'Lowland cap', min: 0, max: 180, step: 2, default: 54, unit: 'm', hint: 'fades lagoon carving above this rise over water; avoids caldera cuts into the massif' },
      inlet: { type: 'float', label: 'Inlet', min: 0, max: 1, step: 0.01, default: 0.12, hint: '0 = closed lagoon · higher carves a narrow ocean connection' },
      apronWidth: { type: 'float', label: 'Apron width', min: 4, max: 90, step: 2, default: 42, unit: 'm', hint: 'white-sand / grass transition around lagoon' },
      whiteSand: { type: 'float', label: 'White sand', min: 0, max: 1, step: 0.02, default: 0.9, hint: 'strength of lagoon white-sand material' },
      treeAttraction: { type: 'float', label: 'Tree pull', min: 0, max: 2, step: 0.02, default: 1.1, hint: 'extra palm/fringe cluster pull near lagoon apron' },
    },
  },

  seasons: {
    label: 'seasons',
    icon: '❄',
    blurb: 'altitude bands · coast=summer → peak=winter · winter never touches summer',
    fields: {
      sweepDeg: { type: 'float', label: 'Region drift', min: -180, max: 180, step: 1, default: 35, unit: '°', hint: 'rotates the lateral-variety noise' },
      summerEnd: { type: 'float', label: 'Summer line', min: 0.15, max: 0.6, step: 0.01, default: 0.44, hint: 'altitude frac · below = tropical lowland; keep below autumn' },
      autumnEnd: { type: 'float', label: 'Autumn line', min: 0.4, max: 0.78, step: 0.01, default: 0.66, hint: 'altitude frac · keep between summer and snow' },
      coniferEnd: { type: 'float', label: 'Snow line', min: 0.6, max: 0.92, step: 0.01, default: 0.84, hint: 'below = conifer band · above = winter/snow cap' },
      borderWarp: { type: 'float', label: 'Border warp', min: 0, max: 1.5, step: 0.05, default: 0.6, hint: 'organic wander of the altitude bands' },
      craggy: { type: 'float', label: 'Craggy peaks', min: 0, max: 1, step: 0.02, default: 0.4, hint: 'rock speckled through the snow/upper zone' },
      // "Golf course" look — a brighter-lime fairway/"greens" band where grass
      // meets the beach, with sparse sand-trap "bunkers". Default OFF so the
      // big-beach presets (A-1) are byte-identical; opt-in for the B-1 vibe.
      fairway: { type: 'float', label: 'Fairway (greens)', min: 0, max: 1, step: 0.02, default: 0, hint: '0 = off · lime "greens" band above the beach' },
      fairwayBand: { type: 'float', label: 'Fairway band', min: 4, max: 80, step: 2, default: 24, unit: 'm', hint: 'how far the greens reach inland from the sand' },
      bunkerDensity: { type: 'float', label: 'Bunkers', min: 0, max: 1, step: 0.02, default: 0.18, hint: 'sand-trap frequency inside the greens' },
      bunkerSize: { type: 'float', label: 'Bunker size', min: 3, max: 30, step: 1, default: 11, unit: 'm', hint: 'sand-trap blob radius' },
    },
  },

  water: {
    label: 'water',
    icon: '≈',
    blurb: 'water datum · seafloor depth · masks',
    fields: {
      enable: { type: 'bool', label: 'Water', default: true, hint: 'C toggles the sea surface/glow/floor stack' },
      seaLevel: { type: 'float', label: 'Water datum', min: -2, max: 40, step: 0.5, default: 9, unit: 'm', hint: 'structural build datum; terrain is generated around it' },
      floorDepth: { type: 'float', label: 'Seafloor depth', min: 10, max: 140, step: 5, default: 64, unit: 'm' },
      floorShape: { type: 'float', label: 'Shelf shape', min: 0.35, max: 1.8, step: 0.05, default: 0.85, hint: 'lower = quick deep drop · higher = long shallow shelf' },
      floorRoughness: { type: 'float', label: 'Seafloor jag', min: 0, max: 3, step: 0.05, default: 1, hint: 'height variation below water' },
      deltaFloor: { type: 'float', label: 'Delta follow', min: 0, max: 1, step: 0.02, default: 0, hint: 'carves underwater floor along the river/delta channel' },
      surfaceLift: { type: 'float', label: 'Surface lift', min: -1, max: 2, step: 0.02, default: 0.08, unit: 'm', hint: 'nudges the water skin off the terrain to fight shore z-flicker' },
      landMask: { type: 'float', label: 'Land mask', min: 0, max: 1, step: 0.02, default: 1, hint: 'fade water off generated land cells; lower exposes seam behavior' },
      debugView: { type: 'int', label: 'Debug view', min: 0, max: 5, step: 1, default: 0, labels: ['final', 'depth', 'channel', 'wave', 'normal', 'land'], hint: 'visualize the generated water masks' },
      depthTint: { type: 'float', label: 'Depth tint', min: 0, max: 1.5, step: 0.02, default: 0.78, hint: 'Beer-Lambert-ish blue/green tint from generated seafloor depth' },
      lagoonTint: { type: 'float', label: 'Lagoon tint', min: 0, max: 2, step: 0.02, default: 0.18, hint: 'extra cyan along generated valley/delta channel' },
    },
  },

  waves: {
    label: 'waves',
    icon: '≋',
    blurb: 'POOL surface stage 3-5 · displacement · detail · distortion',
    fields: {
      waveSpeed: { type: 'float', label: 'Wave speed', min: 0, max: 3, step: 0.02, default: 2.7, hint: 'phase speed; tune for rolling, not sheet sliding' },
      glintSpeed: { type: 'float', label: 'Glint motion', min: 0, max: 5, step: 0.02, default: 3.5, hint: 'multiplies only the sun-highlight normal motion; 0 = locked' },
      glintScale: { type: 'float', label: 'Glint scale', min: 0.1, max: 4, step: 0.02, default: 1.34, hint: 'wave-normal scale seen by the broad white sun path' },
      waveScale: { type: 'float', label: 'Wave scale', min: 0.0001, max: 0.05, step: 0.0001, precision: 4, default: 0.0275, curve: 2.8, uiStep: 0.001, hint: 'world-space wave frequency; curved for low-end tuning' },
      waveRotation: { type: 'float', label: 'Wave rotation', min: -180, max: 180, step: 1, default: 143, unit: '°', hint: 'rotates the wave basis so flow is not locked to the island axes' },
      surfaceOpacity: { type: 'float', label: 'Opacity', min: 0.02, max: 1, step: 0.01, default: 0.55, hint: 'water surface alpha; high opacity should stay blue, not black' },
      waveHeight: { type: 'float', label: 'Wave height', min: 0, max: 3, step: 0.02, default: 1.92, unit: 'm', hint: 'vertex displacement; top-down wants more, side angle wants less' },
      waveChoppy: { type: 'float', label: 'Wave chop', min: 0.5, max: 8, step: 0.05, default: 5.95, hint: 'shape sharpness from the tutorial sea octave' },
      surfaceStage: { type: 'int', label: 'Surface stage', min: 3, max: 5, step: 1, default: 5, hint: '3 = vertex waves · 4 = detail/normal · 5 = depth distortion' },
      detailMix: { type: 'float', label: 'Detail mix', min: 0, max: 1, step: 0.02, default: 0.42, hint: 'fragment detail over the vertex waves' },
      normalStrength: { type: 'float', label: 'Normal strength', min: 0, max: 2, step: 0.02, default: 0.4, hint: 'procedural normal perturbation; visible in stage 4+' },
      refractionStrength: { type: 'float', label: 'Distortion', min: 0, max: 0.7, step: 0.005, default: 0.18, hint: 'stage 5 depth/mask distortion; not true screen refraction yet' },
    },
  },

  // Tree population. The island now uses the imported tree-lab bank plus
  // production palm variants; palms are a fringe layer, not the whole forest.
  tree: {
    label: 'tree',
    icon: '🌴',
    blurb: 'tree-lab bank · region clusters · palms as fringe',
    fields: {
      enable: { type: 'bool', label: 'Trees', default: true, hint: 'turn off the whole tree-bank allocator' },
      totalCount: { type: 'int', label: 'Total trees', min: 0, max: 2600, step: 25, default: 1300, hint: 'target instances from the 128-slot tree bank' },
      globalScale: { type: 'float', label: 'Global scale', min: 0.35, max: 2, step: 0.02, default: 1.35, hint: 'overall tree scale after per-slot normalization' },
      spacing: { type: 'float', label: 'Spacing', min: 5, max: 34, step: 1, default: 9, unit: 'm', hint: 'occupancy grid spacing; lower = denser groves' },
      clusterBias: { type: 'float', label: 'Cluster bias', min: 0, max: 1, step: 0.02, default: 1, hint: '0 = even scatter · 1 = strong groves and open cuts' },
      autumnWeight: { type: 'float', label: 'Autumn weight', min: 0, max: 3, step: 0.05, default: 1.55, hint: 'overweights autumn trees beyond raw terrain percent' },
      summerWeight: { type: 'float', label: 'Summer weight', min: 0, max: 3, step: 0.05, default: 0.95, hint: 'green lowland tree mass' },
      spruceWeight: { type: 'float', label: 'Spruce weight', min: 0, max: 3, step: 0.05, default: 0.75, hint: '65-72 and 81-88 conifer families on upper slopes' },
      palmWeight: { type: 'float', label: 'Palm fringe', min: 0, max: 3, step: 0.05, default: 0.25, hint: 'palms around coast, lagoon, bunkers, and fairway edges' },
      palmTarget: { type: 'int', label: 'Palm count', min: 0, max: 900, step: 25, default: 400, hint: 'classic palm pepper pass after regional groves' },
      peakSparse: { type: 'float', label: 'Peak sparse', min: 0, max: 1, step: 0.02, default: 0.08, hint: 'small chance of sparse pines/skeletons high on the massif' },
      openCuts: { type: 'float', label: 'Open cuts', min: 0, max: 1, step: 0.02, default: 0.6, hint: 'deliberate bare lawns/terrain windows' },
      autumnScale: { type: 'float', label: 'Autumn scale', min: 0.5, max: 2, step: 0.02, default: 1.3, hint: 'family trim for 38-72-ish autumn trees' },
      spruceScale: { type: 'float', label: 'Spruce scale', min: 0.5, max: 2, step: 0.02, default: 1.22, hint: 'family trim for 65-72 and 81-88 conifers' },
      palmScale: { type: 'float', label: 'Palm scale', min: 0.4, max: 1.6, step: 0.02, default: 0.9, hint: 'family trim for palm slots 97-128' },
    },
  },

  shadows: {
    label: 'shadows',
    icon: '◒',
    blurb: 'two sun shadow maps · fine layer plus coarse motion layer',
    fields: {
      enable: { type: 'bool', label: 'Shadows', default: true, hint: 'X toggles shadow casting without killing sun light' },
      primaryEnable: { type: 'bool', label: 'Primary layer', default: true, hint: 'main sun shadow map' },
      primarySize: { type: 'int', label: 'Primary map', min: 512, max: 8192, step: 512, default: 8192, hint: 'texels per side; GPU clamps if unsupported' },
      primaryCoverage: { type: 'float', label: 'Primary span', min: 0.35, max: 1.6, step: 0.01, default: 1.28, hint: 'smaller = sharper but can clip island-edge shadows' },
      secondaryEnable: { type: 'bool', label: 'Coarse layer', default: true, hint: 'second sun shadow map for low-res dance' },
      secondarySize: { type: 'int', label: 'Coarse map', min: 512, max: 8192, step: 512, default: 2560, hint: 'try 512, 1024, 2048 against the primary' },
      secondaryCoverage: { type: 'float', label: 'Coarse span', min: 0.35, max: 1.8, step: 0.01, default: 1, hint: 'coarse layer shadow-camera coverage' },
      secondaryMix: { type: 'float', label: 'Coarse mix', min: 0, max: 1, step: 0.01, default: 1, hint: 'add mode: amount of extra coarse-map sun' },
      blendMode: { type: 'int', label: 'Blend mode', min: 0, max: 1, step: 1, default: 1, labels: ['split', 'add'], hint: 'split keeps total light stable · add is stylized and brighter' },
      filterMode: { type: 'int', label: 'Filter', min: 0, max: 2, step: 1, default: 1, labels: ['hard', 'pcf', 'soft'], hint: 'shadow-map sampling kernel' },
      softness: { type: 'float', label: 'Softness', min: 0, max: 8, step: 0.1, default: 1.7, hint: 'shadow radius used by filtered modes' },
      bias: { type: 'float', label: 'Bias', min: -0.005, max: 0.005, step: 0.0001, precision: 4, default: -0.0006, hint: 'depth offset; fights acne vs detached shadows' },
      normalBias: { type: 'float', label: 'Normal bias', min: 0, max: 6, step: 0.05, default: 2.2, hint: 'offset along voxel normals; original default was 2.2' },
    },
  },

  render: {
    label: 'render',
    icon: '◯',
    blurb: 'camera, exposure, horizon haze',
    fields: {
      fov: { type: 'float', label: 'FOV', min: 40, max: 95, step: 1, default: 68, unit: '°' },
      exposure: { type: 'float', label: 'Exposure', min: 0.2, max: 3.0, step: 0.01, default: 1.05 },
      fogDensity: { type: 'float', label: 'Horizon haze', min: 0, max: 0.006, step: 0.00005, default: 0.00072, hint: 'dissolves the bounded sea edge into the sky' },
      horizonWarp: { type: 'bool', label: 'Horizon warp', default: true },
    },
  },

  godrays: {
    label: 'god rays',
    icon: '✺',
    blurb: 'screen-space radial scatter · downsample→march→upsample',
    fields: {
      enable: { type: 'bool', label: 'Enable', default: true, hint: 'G toggles · off = golden bypass (zero cost)' },
      source: { type: 'float', label: 'Source mask', min: 0, max: 1, step: 0.02, default: 1, hint: '1 = clean depth sky/occluder · 0 = raw-scene debug echoes' },
      intensity: { type: 'float', label: 'Intensity', min: 0, max: 3, step: 0.05, default: 0.85, hint: 'first gain knob' },
      density: { type: 'float', label: 'Density', min: 0.2, max: 1, step: 0.02, default: 0.32, hint: 'ray reach toward the sun' },
      decay: { type: 'float', label: 'Decay', min: 0.8, max: 1, step: 0.005, default: 0.915, hint: 'tail length' },
      weight: { type: 'float', label: 'Weight', min: 0.1, max: 2, step: 0.05, default: 2, hint: 'per-sample lift' },
      exposure: { type: 'float', label: 'Exposure', min: 0.1, max: 3, step: 0.05, default: 0.7, hint: 'final ray gain after the march' },
      threshold: { type: 'float', label: 'Threshold', min: 0.05, max: 0.95, step: 0.01, default: 0.62, hint: 'source cutoff' },
      groundMask: { type: 'float', label: 'Ground mask', min: 0, max: 1, step: 0.02, default: 0.5, hint: 'suppresses sources below the sun' },
      reach: { type: 'float', label: 'Reach', min: 0.4, max: 2.5, step: 0.05, default: 1.45, hint: 'screen-space falloff radius' },
      warmth: { type: 'float', label: 'Warmth', min: 0, max: 1, step: 0.02, default: 0.5, hint: '0 = sky-colour rays · 1 = warm sun' },
      samples: { type: 'int', label: 'March taps', min: 6, max: 48, step: 1, default: 16, hint: 'sample count in the radial march' },
      resScale: { type: 'float', label: 'Buffer scale', min: 0.06, max: 1, step: 0.02, default: 0.25, hint: 'LOW = cheap + blocky scatter' },
      sharp: { type: 'float', label: 'Upsample snap', min: 0, max: 1, step: 0.05, default: 0.25, hint: '0 = bilinear · 1 = raw low-res blocks; no blur pass' },
      blurEnable: { type: 'bool', label: 'Blur', default: false, hint: 'off = raw march · on = optional coalescing pass' },
      blurAmount: { type: 'float', label: 'Blur mix', min: 0, max: 1, step: 0.01, default: 0.18, hint: 'blend raw rays with the blur pass' },
      blurRadius: { type: 'float', label: 'Blur radius', min: 0.25, max: 8, step: 0.05, default: 1.5, hint: 'god-buffer texel radius' },
      blurPasses: { type: 'int', label: 'Blur passes', min: 1, max: 4, step: 1, default: 1, hint: 'extra separable passes; cost is linear' },
    },
  },

  camera: {
    label: 'camera',
    icon: '◌',
    blurb: 'director scaffold · human input always wins',
    fields: {
      director: { type: 'bool', label: 'Camera director', default: false, hint: 'AFK handoff scaffold; no path/focus math yet' },
      focusMountain: { type: 'float', label: 'Mountain focus', min: 0, max: 1, step: 0.01, default: 0.35, hint: 'future focus probability · not wired yet' },
      focusSky: { type: 'float', label: 'Sky focus', min: 0, max: 1, step: 0.01, default: 0.18, hint: 'future focus probability · not wired yet' },
      focusGreenway: { type: 'float', label: 'Greenway focus', min: 0, max: 1, step: 0.01, default: 0.16, hint: 'future focus probability · not wired yet' },
      focusMassif: { type: 'float', label: 'Massif focus', min: 0, max: 1, step: 0.01, default: 0.22, hint: 'future focus probability · not wired yet' },
      focusValley: { type: 'float', label: 'Valley focus', min: 0, max: 1, step: 0.01, default: 0.14, hint: 'future focus probability · not wired yet' },
      focusShoreline: { type: 'float', label: 'Shoreline focus', min: 0, max: 1, step: 0.01, default: 0.24, hint: 'future focus probability · not wired yet' },
      focusPalms: { type: 'float', label: 'Palms focus', min: 0, max: 1, step: 0.01, default: 0.12, hint: 'future focus probability · not wired yet' },
      focusWater: { type: 'float', label: 'Water focus', min: 0, max: 1, step: 0.01, default: 0.16, hint: 'future focus probability · not wired yet' },
    },
  },

  orbitSweep: {
    label: 'orbit sweep',
    icon: '↻',
    blurb: 'sun elevation + azimuth overlay · real sliders stay authoritative',
    fields: {
      enable: { type: 'bool', label: 'Orbit sweep', default: false, hint: 'slow hidden sun path; touching sun controls turns it off' },
      speed: { type: 'float', label: 'Sim speed', min: 0, max: 4, step: 0.001, precision: 3, default: 1.0, curve: 2.4, uiStep: 0.001, hint: 'curved time multiplier · most slider travel lives below 1.2' },
      elevationDeg: { type: 'float', label: 'Elevation', min: -10, max: 90, step: 0.01, precision: 2, default: 26, unit: '°', pin: false, hint: 'runtime sweep value; not saved to presets' },
      azimuthDeg: { type: 'float', label: 'Azimuth', min: -180, max: 180, step: 0.01, precision: 2, default: -84, unit: '°', pin: false, hint: 'runtime sweep value; wraps through 360° under the hood' },
      elevationSpeed: { type: 'float', label: 'Elevation speed', min: 0, max: 24, step: 0.01, default: 4, hint: 'multiplies sim speed for sunset cycling' },
      azimuthSpeed: { type: 'float', label: 'Azimuth speed', min: 0, max: 8, step: 0.01, default: 0.5, hint: 'multiplies sim speed for horizontal orbit drift' },
      elevationRange: { type: 'range', label: 'Elevation arc', min: -10, max: 90, step: 0.5, default: [2, 50], unit: '°', handle: 'ticks', hint: 'sweep band; current elevation can drift outside before re-entering' },
    },
  },
};

export const sectionOrder = ['orbitSweep', 'sun', 'atmosphere', 'lighting', 'voxel', 'island', 'lagoon', 'seasons', 'water', 'waves', 'tree', 'shadows', 'render', 'godrays', 'camera'];
