// SUNSET SKY — disposable sunset-first fork of the island/Takram cloud sim.
// Start by proving island relighting before rebuilding the sky/cloud pipeline.

import * as THREE from 'three';
import './styles.css';
import './ui/panel.css';
import { Scene } from './core/Scene.js';
import { ParamStore } from './state/ParamStore.js';
import { schema as simSchema } from './config/paramSchema.js';
import { defaultParams } from './config/defaults.js';
import { ControlPanel } from './ui/ControlPanel.js';
import { PerfOverlay } from './ui/PerfOverlay.js';
import { BuildConsole } from './ui/BuildConsole.js';
import { loadPresets, savePresetToDisk } from './config/presets.js';
import { WORKSHOP_CAPTURE_SETTLE_MS } from './config/captureTiming.js';
import { loadIslandAssets } from './AssetLoader.js';
import { TakramSkyRig } from './TakramSkyRig.js';
import './island/island.css';
import { IslandSea } from './island/IslandSea.js';

const canvasContainer = document.getElementById('canvas-container');
const uiRoot = document.getElementById('ui-root');
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const workshopName = 'sunset-sky';
const workshopTitle = 'Sunset Sky';
const workshopPresetLabel = 'sunset-sky';

const schema = makeWorkshopSchema();
const tuningSections = ['waves'];
const cloudSections = ['cloudsRender', 'takramAtmosphere', 'cloudWeather', 'cloudLayer0', 'cloudLighting', 'cloudShadows', 'cloudDebug'];
const sectionOrder = ['skyDiagnosis', 'gain', ...cloudSections, 'water', 'waves', 'sun', 'atmosphere', 'lighting', 'island', 'lagoon', 'voxel', 'seasons', 'tree', 'shadows', 'render'];
const workshopDefaults = buildDefaults(schema, defaultParams);

const buildConsole = new BuildConsole({ parent: uiRoot, label: `${workshopName} build` });
buildConsole.start('bootstrap', 6, { mode: 'boot' });
buildConsole.step('ui shell');
await nextFrame();

buildConsole.step('presets');
const presets = await loadPresets();
buildConsole.step('param markers');
const tuningPathSet = new Set(tuningPaths());
const importantPaths = new Set();

const boot = structuredClone(defaultParams);
const bootPreset = presets.A1;
if (bootPreset?.params) deepMerge(boot, cloneScenePresetParams(bootPreset.params));
ensureWorkshopParams(boot);

const store = new ParamStore(boot);
buildConsole.step('param store');

const scene = new Scene(canvasContainer, store, {
  loader: buildConsole,
  autoGenerate: false,
  asyncRegenerate: true,
  SeaClass: IslandSea,
  afterGenerate: (s) => {
    s.sea?.setStyle?.(seaStyleParams());
  },
});
buildConsole.step('renderer');

const takramRig = new TakramSkyRig({
  scene: scene.scene,
  camera: scene.camera,
  renderer: scene.renderer,
});
scene.setTakramRig(takramRig);

if (bootPreset?.cam) {
  scene.camera.position.fromArray(bootPreset.cam.p);
  scene.camera.quaternion.fromArray(bootPreset.cam.q);
  scene.camera.updateMatrixWorld();
}

const sticky = {
  has: (path) => importantPaths.has(path),
  toggle: (path) => {
    if (importantPaths.has(path)) importantPaths.delete(path);
    else importantPaths.add(path);
    return importantPaths.has(path);
  },
};

let activeBank = 'A';
let activePresetKey = 'A1';
const keyOf = (slot) => `${activeBank}${slot}`;

function capturePreset() {
  const c = scene.camera;
  return {
    params: store.toJSON(),
    cam: { p: c.position.toArray(), q: c.quaternion.toArray() },
    t: Date.now(),
  };
}

function ensureMissingDefaults() {
  const walk = (defaults, prefix = '') => {
    for (const [key, value] of Object.entries(defaults)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        walk(value, path);
      } else if (store.get(path) === undefined) {
        store.set(path, structuredClone(value));
      }
    }
  };
  walk(workshopDefaults);
}

function applyPreset(preset) {
  if (!preset?.params) return false;
  store.fromJSON(hydratePresetParams(preset.params));
  scene.camDirector?.clearInput?.();
  scene.autoCameraDirector?.returnToHuman?.();
  if (!store.get('skyDiagnosis.fastSkyBoot') || scene.vol) {
    scene.regenerateAsync(`${workshopName} preset rebuild`);
  }
  if (preset.cam) {
    scene.camera.position.fromArray(preset.cam.p);
    scene.camera.quaternion.fromArray(preset.cam.q);
    scene.camera.updateMatrixWorld();
  }
  takramRig.resetTemporalState({ resetWeather: true });
  return true;
}

async function savePreset(slot) {
  const key = keyOf(slot);
  const preset = capturePreset();
  presets[key] = preset;
  activePresetKey = key;
  panel.refreshPresets();
  await savePresetToDisk(key, preset);
  panel.flashStatus(`saved ${key} · master preset`, 'ok');
}

function loadPreset(slot) {
  const key = keyOf(slot);
  const preset = presets[key];
  if (!preset) { panel.flashStatus(`${key} empty`, 'err'); return; }
  applyPreset(preset);
  activePresetKey = key;
  panel.refreshPresets();
  panel.flashStatus(`loaded ${key} · ${workshopPresetLabel}`, 'ok');
}

function setBank(bank) {
  if (!/^[A-H]$/.test(bank) || bank === activeBank) return;
  activeBank = bank;
  panel.refreshPresets();
  panel.flashStatus(`bank ${bank}`, 'ok');
}

const presetApi = {
  slots: presets,
  save: savePreset,
  load: loadPreset,
  setBank,
  getBank: () => activeBank,
  getActiveKey: () => activePresetKey,
};

const panel = new ControlPanel({
  store,
  schema,
  sectionOrder,
  sticky,
  presets: presetApi,
});
uiRoot.appendChild(panel.root);
panel.flashStatus(`${workshopTitle.toLowerCase()} · master presets`, 'ok');

const perf = new PerfOverlay({ scene });
perf.root.classList.add('sky-clouds-perf');
uiRoot.appendChild(perf.root);

const skyAssetsPromise = loadIslandAssets({
  onProgress: ({ loaded, total }) => panel.flashStatus(`sky assets ${loaded}/${total}`, 'ok'),
}).then((assets) => {
  takramRig.setAssets(assets);
  panel.flashStatus('sky assets loaded', 'ok');
  return assets;
}).catch((error) => {
  console.error('[island] asset load failed', error);
  panel.flashStatus('sky assets failed', 'err');
  throw error;
});

scene.start();
buildConsole.step('first frame');
if (store.get('skyDiagnosis.fastSkyBoot')) {
  buildConsole.done('island sky ready');
  panel.flashStatus('sky-only fast boot · island build skipped', 'ok');
} else {
  await scene.regenerateAsync(`${workshopName} asset build`);
}

store.subscribe((evt) => {
  if (evt.path === 'cloudsRender.mode') applyCloudMode(evt.value);
  if (evt.path === '*' || shouldResetTakramHistory(evt.path)) {
    takramRig.resetTemporalState();
  }
  if (tuningPathSet.has(evt.path)) {
    panel.refreshPresets();
  }
  if (evt.path === '*' || tuningPathSet.has(evt.path)) {
    scene.sea?.setStyle?.(seaStyleParams());
  }
  if (evt.path === 'skyDiagnosis.fastSkyBoot' && evt.value === false && !scene.vol) {
    scene.regenerateAsync(`${workshopName} diagnostic island build`);
  }
});

function shouldResetTakramHistory(path) {
  return path === 'cloudsRender.clouds' ||
    path === 'cloudsRender.aerialPerspective' ||
    path === 'cloudsRender.quality' ||
    path === 'cloudsRender.resolutionScale' ||
    path === 'cloudsRender.temporalUpscale' ||
    path.startsWith('cloudShadows.') ||
    path.startsWith('cloudDebug.');
}

function randomize() {
  store.set('voxel.seed', 1 + ((Math.random() * 99998) | 0));
  store.set('sun.elevationDeg', 8 + Math.random() * 54);
  store.set('sun.azimuthDeg', -180 + Math.random() * 360);
  store.set('seasons.sweepDeg', -180 + Math.random() * 360);
  if (!store.get('skyDiagnosis.fastSkyBoot') || scene.vol) {
    scene.regenerateAsync(`${workshopName} random rebuild`);
  }
}

function applyCloudMode(mode) {
  const takramReference = Math.round(mode ?? 0) === 0;
  const values = takramReference ? {
    'cloudsRender.atmosphere': true,
    'cloudsRender.clouds': true,
    'cloudsRender.aerialPerspective': true,
    'cloudsRender.exposure': 10,
    'cloudFinishing.toneMapping': 0,
    'cloudFinishing.dithering': true,
  } : {
    'cloudsRender.atmosphere': false,
    'cloudsRender.clouds': true,
    'cloudsRender.aerialPerspective': false,
    'cloudsRender.exposure': 1.05,
    'cloudFinishing.toneMapping': 0,
    'cloudFinishing.dithering': false,
  };
  for (const [path, value] of Object.entries(values)) {
    if (store.get(path) !== value) store.set(path, value);
  }
}

function seaStyleParams() {
  return {
    ...(store.get('water') || {}),
    ...(store.get('waves') || {}),
    ...(store.get('chaos') || {}),
    ...(store.get('lod') || {}),
    ...(store.get('layers') || {}),
  };
}

window.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target;
  const isTextEntry = target && (target.tagName === 'TEXTAREA' ||
    (target.tagName === 'INPUT' && target.type !== 'range'));
  if (isTextEntry) return;
  const key = event.key.toLowerCase();
  const blur = () => { if (target && target.tagName === 'INPUT' && target.blur) target.blur(); };
  if (target && target.tagName === 'INPUT' && target.type === 'range' && /^[wasdqe]$/.test(key)) blur();

  const slotMatch = /^(?:Digit|Numpad)([1-8])$/.exec(event.code);
  if (slotMatch) {
    event.preventDefault(); blur();
    const slot = Number(slotMatch[1]);
    if (event.shiftKey) savePreset(slot); else loadPreset(slot);
    return;
  }

  if (key === 'h' || key === 'b') { event.preventDefault(); blur(); panel.toggle(); }
  else if (key === 'p') {
    event.preventDefault(); blur();
    panel.collapseSections();
    panel.flashStatus('categories collapsed', 'ok');
  }
  else if (key === 'c') {
    event.preventDefault(); blur();
    const next = !store.get('water.enable');
    store.set('water.enable', next);
    panel.flashStatus(next ? 'water on' : 'water off', 'ok');
  } else if (key === 't') {
    event.preventDefault(); blur();
    const next = !store.get('cloudsRender.atmosphere');
    store.set('cloudsRender.atmosphere', next);
    panel.flashStatus(next ? 'takram sky on' : 'takram sky off', 'ok');
  } else if (key === 'g') {
    event.preventDefault(); blur();
    const next = !store.get('godrays.enable');
    store.set('godrays.enable', next);
    panel.flashStatus(next ? 'god rays on' : 'god rays off', 'ok');
  } else if (key === 'x') {
    event.preventDefault(); blur();
    const next = !store.get('shadows.enable');
    store.set('shadows.enable', next);
    panel.flashStatus(next ? 'shadows on' : 'shadows off', 'ok');
  } else if (key === 'f') {
    event.preventDefault(); blur(); perf.toggle();
  } else if (key === 'r') {
    event.preventDefault(); blur(); randomize(); panel.flashStatus('rolled', 'ok');
  } else if (key === 'escape') {
    event.preventDefault(); blur();
    if (!panel.collapsed) panel.toggle();
  }
});

function makeWorkshopSchema() {
  const out = structuredClone(simSchema);
  out.skyDiagnosis = {
    label: 'sky diagnosis',
    icon: '◐',
    blurb: 'horizon strip isolation · no fixes',
    fields: {
      skyOnly: { type: 'bool', label: 'Sky only', default: false, hint: 'hide island, trees, sea, and floor' },
      fastSkyBoot: { type: 'bool', label: 'Fast sky boot', default: false, hint: 'skip the slow voxel island build until this is on' },
      hideIsland: { type: 'bool', label: 'Hide island', default: false, hint: 'hide terrain, trees, and reference blocks while tuning sky/clouds' },
      seaOnlyStub: { type: 'bool', label: 'Sea only', default: false, hint: 'hide sky and terrain; keep sea surface/floor' },
      floorOnlyStub: { type: 'bool', label: 'Floor only', default: false, hint: 'hide sky, terrain, and sea surface; keep floor disc' },
      magentaClear: { type: 'bool', label: 'Magenta clear', default: false, hint: 'reveals uncovered pixels behind all rendered layers' },
      disableHorizonWarp: { type: 'bool', label: 'Disable warp', default: false, hint: 'forces unwarped sky-view LUT latitude mapping' },
      forceBelowHorizonFog: { type: 'bool', label: 'Below-horizon fog', default: false, hint: 'diagnostic fill for rays that hit the planet' },
    },
  };
  out.gain = {
    label: 'gain staging',
    icon: '◉',
    blurb: 'sun · atmosphere · Takram · clouds · finish',
    fields: {
      sunGroup: {
        type: 'group', label: 'sun', icon: '☉', map: 'sun.* + lighting.*',
        color: '#ff8a3a', wash: 'rgba(255, 138, 58, 0.13)',
      },
      elevationDeg: {
        path: 'sun.elevationDeg',
        type: 'float', label: 'Elevation', min: -10, max: 90, step: 0.5, default: 26, unit: '°',
        hint: 'sun.elevationDeg',
      },
      azimuthDeg: {
        path: 'sun.azimuthDeg',
        type: 'float', label: 'Azimuth', min: -180, max: 180, step: 1, default: -84, unit: '°',
        hint: 'sun.azimuthDeg',
      },
      sunIntensity: {
        path: 'sun.intensity',
        type: 'float', label: 'Intensity', min: 1, max: 60, step: 0.5, default: 22,
        hint: 'sun.intensity',
      },
      sunElevationGain: {
        path: 'lighting.sunElevationGain',
        type: 'float', label: 'Sun elev gain', min: 0, max: 1, step: 0.01, default: 0.45,
        hint: 'lighting.sunElevationGain',
      },
      sunFloor: {
        path: 'lighting.sunFloor',
        type: 'float', label: 'Sun floor', min: 0, max: 4, step: 0.02, default: 0.8,
        hint: 'lighting.sunFloor',
      },
      sunCeiling: {
        path: 'lighting.sunCeiling',
        type: 'float', label: 'Sun ceiling', min: 0, max: 5, step: 0.02, default: 2,
        hint: 'lighting.sunCeiling',
      },
      secondaryEnergy: {
        path: 'lighting.secondaryEnergy',
        type: 'float', label: 'Coarse energy', min: 0, max: 1.5, step: 0.01, default: 0.55,
        hint: 'lighting.secondaryEnergy',
      },
      secondaryMix: {
        path: 'shadows.secondaryMix',
        type: 'float', label: 'Coarse mix', min: 0, max: 1, step: 0.01, default: 1,
        hint: 'shadows.secondaryMix',
      },
      shadowBlend: {
        path: 'shadows.blendMode',
        type: 'int', label: 'Shadow blend', min: 0, max: 1, step: 1, default: 1,
        labels: ['split', 'add'],
        hint: 'shadows.blendMode',
      },
      fillGroup: {
        type: 'group', label: 'fill', icon: '✦', map: 'lighting.*',
        color: '#ffcf6a', wash: 'rgba(255, 206, 106, 0.13)',
      },
      skyBounce: {
        path: 'lighting.skyBounce',
        type: 'float', label: 'Sky bounce', min: 0, max: 1.6, step: 0.02, default: 0.55,
        hint: 'lighting.skyBounce',
      },
      groundBounce: {
        path: 'lighting.groundBounce',
        type: 'float', label: 'Ground bounce', min: 0, max: 1, step: 0.02, default: 0.3,
        hint: 'lighting.groundBounce',
      },
      bounceTint: {
        path: 'lighting.bounceTint',
        type: 'float', label: 'Bounce tint', min: 0, max: 1, step: 0.02, default: 0.7,
        hint: 'lighting.bounceTint',
      },
      glintWidth: {
        path: 'lighting.sunGlint',
        type: 'float', label: 'Glint width', min: 0, max: 2.5, step: 0.05, default: 0.7,
        hint: 'lighting.sunGlint',
      },
      glintSpread: {
        path: 'lighting.glintSpread',
        type: 'float', label: 'Glint spread', min: 0.2, max: 4, step: 0.05, default: 1.1,
        hint: 'lighting.glintSpread',
      },
      atmosphereGroup: {
        type: 'group', label: 'atmosphere', icon: '◐', map: 'atmosphere.* + render.fog',
        color: '#b68cff', wash: 'rgba(182, 140, 255, 0.13)',
      },
      legacyRayleigh: {
        path: 'atmosphere.rayleighMul',
        type: 'float', label: 'Rayleigh', min: 0, max: 4, step: 0.01, default: 1,
        hint: 'atmosphere.rayleighMul',
      },
      legacyMieBeta: {
        path: 'atmosphere.mieBeta',
        type: 'float', label: 'Mie β', min: 0, max: 0.05, step: 0.0005, default: 0.021,
        hint: 'atmosphere.mieBeta',
      },
      legacyMieG: {
        path: 'atmosphere.mieG',
        type: 'float', label: 'Mie g', min: 0, max: 0.95, step: 0.005, default: 0.758,
        hint: 'atmosphere.mieG',
      },
      legacyOzone: {
        path: 'atmosphere.ozoneMul',
        type: 'float', label: 'Ozone', min: 0, max: 3, step: 0.01, default: 1,
        hint: 'atmosphere.ozoneMul',
      },
      horizonHaze: {
        path: 'render.fogDensity',
        type: 'float', label: 'Horizon haze', min: 0, max: 0.006, step: 0.00005, default: 0.00072,
        hint: 'render.fogDensity',
      },
      takramGroup: {
        type: 'group', label: 'takram', icon: '◎', map: 'takramAtmosphere.*',
        color: '#2fd9c8', wash: 'rgba(47, 217, 200, 0.12)',
      },
      takramSunLight: {
        path: 'takramAtmosphere.sunLight',
        type: 'bool', label: 'Takram sun', default: true,
        hint: 'takramAtmosphere.sunLight',
      },
      takramSkyLight: {
        path: 'takramAtmosphere.skyLight',
        type: 'bool', label: 'Takram sky', default: true,
        hint: 'takramAtmosphere.skyLight',
      },
      takramGround: {
        path: 'takramAtmosphere.ground',
        type: 'bool', label: 'Ground branch', default: true,
        hint: 'takramAtmosphere.ground',
      },
      groundAlbedo: {
        path: 'takramAtmosphere.groundAlbedo',
        type: 'float', label: 'Ground albedo', min: 0, max: 0.35, step: 0.005, default: 0.018,
        hint: 'takramAtmosphere.groundAlbedo',
      },
      albedoScale: {
        path: 'takramAtmosphere.albedoScale',
        type: 'float', label: 'Albedo scale', min: 0, max: 2, step: 0.02, default: 1,
        hint: 'takramAtmosphere.albedoScale',
      },
      cloudGroup: {
        type: 'group', label: 'clouds', icon: '☁', map: 'cloudWeather + cloudLighting',
        color: '#f0e5cf', wash: 'rgba(240, 229, 207, 0.10)',
      },
      cloudCoverage: {
        path: 'cloudWeather.coverage',
        type: 'float', label: 'Cloud cover', min: 0, max: 1, step: 0.01, default: 0.4,
        hint: 'cloudWeather.coverage',
      },
      cloudScatter: {
        path: 'cloudLighting.scatteringCoefficient',
        type: 'float', label: 'Cloud scatter', min: 0, max: 3, step: 0.001, precision: 3, default: 1, curve: 4, uiStep: 0.001,
        hint: 'cloudLighting.scatteringCoefficient',
      },
      cloudGroundBounce: {
        path: 'cloudLighting.groundBounceScale',
        type: 'float', label: 'Cloud ground', min: 0, max: 3, step: 0.02, default: 1,
        hint: 'cloudLighting.groundBounceScale',
      },
      cloudSkyLight: {
        path: 'cloudLighting.skyLightScale',
        type: 'float', label: 'Cloud sky', min: 0, max: 3, step: 0.02, default: 1,
        hint: 'cloudLighting.skyLightScale',
      },
      cloudPowder: {
        path: 'cloudLighting.powderScale',
        type: 'float', label: 'Powder', min: 0, max: 2, step: 0.02, default: 0.8,
        hint: 'cloudLighting.powderScale',
      },
      cloudLayerShadow: {
        path: 'cloudShadows.layerShadow',
        type: 'bool', label: 'Cloud shadows', default: true,
        hint: 'cloudShadows.layerShadow',
      },
      finishGroup: {
        type: 'group', label: 'finish', icon: '◯', map: 'cloudFinishing + render',
        color: '#aab4be', wash: 'rgba(170, 180, 190, 0.11)',
      },
      takramExposure: {
        path: 'cloudsRender.exposure',
        type: 'float', label: 'Takram exposure', min: 0.2, max: 20, step: 0.05, default: 10,
        hint: 'cloudsRender.exposure',
      },
      renderExposure: {
        path: 'render.exposure',
        type: 'float', label: 'Legacy exposure', min: 0.2, max: 3, step: 0.01, default: 1.05,
        hint: 'render.exposure',
      },
      toneMapping: {
        path: 'cloudFinishing.toneMapping',
        type: 'int', label: 'Tone map', min: 0, max: 3, step: 1, default: 0,
        labels: ['ACES', 'neutral', 'AGX', 'linear'],
        hint: 'cloudFinishing.toneMapping',
      },
      dithering: {
        path: 'cloudFinishing.dithering',
        type: 'bool', label: 'Dither', default: true,
        hint: 'cloudFinishing.dithering',
      },
    },
  };
  out.cloudsRender = {
    label: 'clouds render',
    icon: '◎',
    blurb: 'sky choice · clouds compositor · quality',
    fields: {
      mode: {
        type: 'int', label: 'Mode', min: 0, max: 1, step: 1, default: 0,
        labels: ['Takram ref', 'legacy sky'],
        hint: 'switches between the faithful Takram sky/LUT stack and the legacy sim sky composite experiment',
      },
      atmosphere: { type: 'bool', label: 'Takram sky', default: true, hint: 'SkyMaterial fullscreen sky; off keeps the original sim sky' },
      clouds: { type: 'bool', label: 'Cloud layer', default: true, hint: 'Takram CloudsEffect over whichever sky is visible' },
      aerialPerspective: { type: 'bool', label: 'Takram haze', default: true, hint: 'Takram AerialPerspectiveEffect; off preserves the old sim color/lighting path' },
      quality: { type: 'int', label: 'Quality', min: 0, max: 3, step: 1, default: 2, labels: ['low', 'medium', 'high', 'ultra'] },
      resolutionScale: { type: 'float', label: 'Cloud res', min: 0.25, max: 1, step: 0.01, default: 0.75, hint: 'volumetric cloud render resolution scale' },
      temporalUpscale: { type: 'bool', label: 'Temporal upscale', default: true, hint: 'Takram 1/4-res temporal upscale path' },
      exposure: { type: 'float', label: 'Exposure', min: 0.2, max: 20, step: 0.05, default: 10, hint: 'Takram composer exposure; legacy sky clouds follow render.exposure to preserve scene color' },
    },
  };
  out.takramAtmosphere = {
    label: 'takram atmosphere',
    icon: '◐',
    blurb: 'Takram sky/material flags',
    fields: {
      sun: { type: 'bool', label: 'Sun disk', default: true, hint: 'draw analytic sun in Takram sky' },
      ground: { type: 'bool', label: 'Ground branch', default: true, hint: 'SkyMaterial ground intersection branch' },
      groundAlbedo: { type: 'float', label: 'Ground albedo', min: 0, max: 0.35, step: 0.005, default: 0.018, hint: 'neutral ground bounce for rays below horizon' },
      transmittance: { type: 'bool', label: 'Transmittance', default: true },
      inscatter: { type: 'bool', label: 'Inscatter', default: true },
      sunLight: { type: 'bool', label: 'Sun light', default: true, hint: 'post-process sun irradiance on scene geometry' },
      skyLight: { type: 'bool', label: 'Sky light', default: true, hint: 'post-process sky irradiance on scene geometry' },
      albedoScale: { type: 'float', label: 'Albedo scale', min: 0, max: 2, step: 0.02, default: 1 },
    },
  };
  out.cloudWeather = {
    label: 'cloud weather',
    icon: '☁',
    blurb: 'coverage · texture scale · drift',
    fields: {
      coverage: { type: 'float', label: 'Coverage', min: 0, max: 1, step: 0.01, default: 0.4, hint: 'global weather coverage' },
      weatherRepeatX: { type: 'float', label: 'Weather X', min: 5, max: 260, step: 1, default: 100 },
      weatherRepeatY: { type: 'float', label: 'Weather Y', min: 5, max: 260, step: 1, default: 100 },
      weatherVelocityX: { type: 'float', label: 'Weather drift X', min: -0.003, max: 0.003, step: 0.00001, precision: 5, default: 0.001, hint: 'cloud-shadow time scale; 0 freezes · 0.00005 is very slow · 0.001 is brisk' },
      weatherVelocityY: { type: 'float', label: 'Weather drift Y', min: -0.003, max: 0.003, step: 0.00001, precision: 5, default: 0, hint: 'vertical weather-map drift; 0 freezes · keep small unless you want time-lapse shadow motion' },
      shapeRepeat: { type: 'float', label: 'Shape repeat', min: 0.00005, max: 0.0012, step: 0.00001, precision: 5, default: 0.0003 },
      detailRepeat: { type: 'float', label: 'Detail repeat', min: 0.0005, max: 0.02, step: 0.0001, precision: 4, default: 0.006 },
      turbulenceRepeat: { type: 'float', label: 'Turbulence repeat', min: 1, max: 80, step: 0.5, default: 20 },
      turbulenceDisplacement: { type: 'float', label: 'Turbulence push', min: 0, max: 900, step: 5, default: 350 },
    },
  };
  out.cloudLayer0 = {
    label: 'cloud layer',
    icon: '▤',
    blurb: 'Takram reference stack · optional single-layer isolate',
    fields: {
      referenceStack: { type: 'bool', label: 'Reference stack', default: true, hint: 'use Takram default r/g/b cloud layers instead of the single-layer isolate' },
      enabled: { type: 'bool', label: 'Layer on', default: true },
      altitude: { type: 'float', label: 'Altitude', min: 100, max: 5000, step: 25, default: 750, unit: 'm' },
      height: { type: 'float', label: 'Height', min: 0, max: 2400, step: 25, default: 600, unit: 'm' },
      densityScale: { type: 'float', label: 'Density', min: 0, max: 1.6, step: 0.01, default: 0.4 },
      shapeAmount: { type: 'float', label: 'Shape amount', min: 0, max: 2, step: 0.02, default: 1 },
      shapeDetailAmount: { type: 'float', label: 'Detail amount', min: 0, max: 2, step: 0.02, default: 0.8 },
      weatherExponent: { type: 'float', label: 'Weather exponent', min: 0.2, max: 4, step: 0.02, default: 1 },
      shapeAlteringBias: { type: 'float', label: 'Shape bias', min: 0, max: 1, step: 0.01, default: 0.35 },
      coverageFilterWidth: { type: 'float', label: 'Coverage feather', min: 0.05, max: 1.5, step: 0.01, default: 0.6 },
    },
  };
  out.cloudLighting = {
    label: 'cloud lighting',
    icon: '✦',
    blurb: 'phase · powder · bounce',
    fields: {
      scatteringCoefficient: { type: 'float', label: 'Scatter', min: 0, max: 3, step: 0.001, precision: 3, default: 1, curve: 4, uiStep: 0.001, hint: 'curved so the useful low range around 0.04 is tunable' },
      absorptionCoefficient: { type: 'float', label: 'Absorb', min: 0, max: 3, step: 0.02, default: 0 },
      skyLightScale: { type: 'float', label: 'Sky light', min: 0, max: 3, step: 0.02, default: 1 },
      groundBounceScale: { type: 'float', label: 'Ground bounce', min: 0, max: 3, step: 0.02, default: 1 },
      powderScale: { type: 'float', label: 'Powder', min: 0, max: 2, step: 0.02, default: 0.8 },
      powderExponent: { type: 'float', label: 'Powder exp', min: 5, max: 300, step: 1, default: 150 },
      anisotropy1: { type: 'float', label: 'Anisotropy A', min: -0.95, max: 0.95, step: 0.01, default: 0.7 },
      anisotropy2: { type: 'float', label: 'Anisotropy B', min: -0.95, max: 0.95, step: 0.01, default: -0.2 },
      anisotropyMix: { type: 'float', label: 'Phase mix', min: 0, max: 1, step: 0.01, default: 0.5 },
      shapeDetail: { type: 'bool', label: 'Shape detail', default: true },
      turbulence: { type: 'bool', label: 'Turbulence', default: false },
      haze: { type: 'bool', label: 'Haze', default: true },
    },
  };
  out.cloudShadows = {
    label: 'cloud shadows',
    icon: '◒',
    blurb: 'Beer map · layer shadows',
    fields: {
      layerShadow: { type: 'bool', label: 'Layer shadow', default: true },
      cascadeCount: { type: 'int', label: 'Cascades', min: 1, max: 4, step: 1, default: 3 },
      mapSize: { type: 'int', label: 'Map size', min: 0, max: 3, step: 1, default: 0, labels: ['256', '512', '1024', '2048'] },
      temporalPass: { type: 'bool', label: 'Temporal smooth', default: true, hint: 'Takram shadow history resolve; keep on while tuning low-map shadows' },
      temporalSmoothing: { type: 'float', label: 'History', min: 0.99, max: 0.99995, step: 0.00001, precision: 5, default: 0.999, hint: 'temporal history amount; useful range lives near 0.999 for 256-map shadows' },
      varianceGamma: { type: 'float', label: 'History clamp', min: 0, max: 6, step: 0.05, default: 1, hint: 'variance clipping width; higher keeps more history, lower rejects ghosting sooner' },
      temporalJitter: { type: 'bool', label: 'Jitter', default: false, hint: 'structured temporal sampling in the Beer shadow march; off is calmer for 256-map island shadows' },
      shadowIterations: { type: 'int', label: 'Shadow steps', min: 8, max: 160, step: 1, default: 50 },
      shadowStep: { type: 'float', label: 'Shadow min step', min: 0.1, max: 500, step: 0.1, precision: 1, default: 100, curve: 5, uiStep: 0.001, unit: 'm', hint: 'curved: most travel lives below ~72 m; far right still reaches 300-500 m for quick cloud repositioning' },
    },
  };
  out.cloudDebug = {
    label: 'debug',
    icon: '□',
    blurb: 'shader overlays · march budgets',
    fields: {
      mode: {
        type: 'int', label: 'Debug view', min: 0, max: 7, step: 1, default: 0,
        labels: ['off', 'samples', 'front depth', 'shadow map', 'cascades', 'uv', 'shadow length', 'velocity'],
      },
      primarySteps: { type: 'int', label: 'Primary steps', min: 32, max: 520, step: 4, default: 200 },
      minStep: { type: 'float', label: 'Min step', min: 10, max: 300, step: 5, default: 80, unit: 'm' },
      maxStep: { type: 'float', label: 'Max step', min: 100, max: 2500, step: 25, default: 1000, unit: 'm' },
      rayDistance: { type: 'float', label: 'Ray distance', min: 20000, max: 220000, step: 5000, default: 120000, unit: 'm' },
    },
  };
  out.render.fields = {
    toneMapping: {
      path: 'cloudFinishing.toneMapping',
      type: 'int', label: 'Tone map', min: 0, max: 3, step: 1, default: 0,
      labels: ['ACES', 'neutral', 'AGX', 'linear'],
      hint: 'Takram composer tone map; neutral is the NORMAL look',
    },
    dithering: {
      path: 'cloudFinishing.dithering',
      type: 'bool', label: 'Dither', default: true,
      hint: 'postprocessing fullscreen dithering toggle',
    },
    ...out.render.fields,
  };
  out.cloudFinishing = {
    label: 'lens / finishing',
    icon: '◌',
    blurb: 'tone map · dither',
    fields: {
      toneMapping: {
        type: 'int', label: 'Tone map', min: 0, max: 3, step: 1, default: 0,
        labels: ['ACES', 'neutral', 'AGX', 'linear'],
        hint: 'ACES is the lab default; AGX is available for manual Takram comparison',
      },
      dithering: { type: 'bool', label: 'Dither', default: true, hint: 'postprocessing fullscreen dithering toggle' },
    },
  };
  out.water = {
    label: 'water',
    icon: '≈',
    blurb: 'datum · seafloor · depth tint · masks',
    fields: {
      enable: { type: 'bool', label: 'Water', default: true, hint: 'C toggles only the water surface in this workshop' },
      seaLevel: { type: 'float', label: 'Water datum', min: -2, max: 40, step: 0.5, default: 9, unit: 'm', hint: 'structural; rebuilds terrain/water data' },
      floorDepth: { type: 'float', label: 'Seafloor depth', min: 10, max: 140, step: 5, default: 64, unit: 'm' },
      floorShape: { type: 'float', label: 'Shelf shape', min: 0.35, max: 1.8, step: 0.05, default: 0.85, hint: 'lower = quick deep drop · higher = long shallow shelf' },
      floorRoughness: { type: 'float', label: 'Seafloor jag', min: 0, max: 3, step: 0.05, default: 1, hint: 'height variation below water' },
      deltaFloor: { type: 'float', label: 'Delta follow', min: 0, max: 1, step: 0.02, default: 0, hint: 'carves underwater floor along the river/delta channel' },
      surfaceLift: { type: 'float', label: 'Surface lift', min: -1, max: 2, step: 0.02, default: 0.08, unit: 'm', hint: 'shore z-fighting diagnostic' },
      landMask: { type: 'float', label: 'Land mask', min: 0, max: 1, step: 0.02, default: 1, hint: 'fade water off generated land cells' },
      debugView: {
        type: 'int', label: 'Debug view', min: 0, max: 5, step: 1, default: 0,
        labels: ['final', 'depth', 'channel', 'wave', 'normal', 'land'],
        hint: 'raw masks and procedural fields before art layering',
      },
      depthTint: { type: 'float', label: 'Depth tint', min: 0, max: 1.5, step: 0.02, default: 0.78, hint: 'absorption/fog amount from generated seafloor depth' },
      lagoonTint: { type: 'float', label: 'Channel tint', min: 0, max: 2, step: 0.02, default: 0.18, hint: 'generated river/delta mask tint; keep low while tuning PBR' },
    },
  };
  out.waves = {
    label: 'waves',
    icon: '≋',
    blurb: 'POOL surface stages 3-5',
    fields: {
      waveSpeed: { type: 'float', label: 'Wave speed', min: 0, max: 3, step: 0.02, default: 2.7, hint: 'phase speed; tune for rolling, not sheet sliding' },
      glintSpeed: { type: 'float', label: 'Glint motion', min: 0, max: 5, step: 0.02, default: 3.5, hint: 'multiplies only the sun-highlight normal motion; 0 = locked' },
      glintScale: { type: 'float', label: 'Glint scale', min: 0.1, max: 4, step: 0.02, default: 1.34, hint: 'wave-normal scale seen by the broad white sun path' },
      waveScale: { type: 'float', label: 'Wave scale', min: 0.0001, max: 0.05, step: 0.0001, precision: 4, default: 0.0275, curve: 2.8, uiStep: 0.001, hint: 'world-space wave frequency; curved for low-end tuning' },
      waveRotation: { type: 'float', label: 'Wave rotation', min: -180, max: 180, step: 1, default: 143, unit: '°', hint: 'rotates the wave basis so flow is not locked to island axes' },
      surfaceOpacity: { type: 'float', label: 'Opacity', min: 0.02, max: 1, step: 0.01, default: 0.55, hint: 'water surface alpha; high opacity should stay blue, not black' },
      waveHeight: { type: 'float', label: 'Wave height', min: 0, max: 3, step: 0.02, default: 1.92, unit: 'm', hint: 'top-down wants more; side angle wants less' },
      waveChoppy: { type: 'float', label: 'Wave chop', min: 0.5, max: 8, step: 0.05, default: 5.95, hint: 'shape sharpness from the tutorial sea octave' },
      surfaceStage: { type: 'int', label: 'Surface stage', min: 3, max: 5, step: 1, default: 5, hint: '3 = vertex waves · 4 = detail/normal · 5 = depth distortion' },
      detailMix: { type: 'float', label: 'Detail mix', min: 0, max: 1, step: 0.02, default: 0.42, hint: 'fragment detail over vertex waves' },
      normalStrength: { type: 'float', label: 'Normal strength', min: 0, max: 2, step: 0.02, default: 0.4, hint: 'stage 4 normal perturbation' },
      refractionStrength: { type: 'float', label: 'Distortion', min: 0, max: 0.7, step: 0.005, default: 0.18, hint: 'stage 5 depth/mask distortion; not true screen refraction yet' },
    },
  };
  return out;
}

function buildDefaults(schemaObj, base) {
  const out = structuredClone(base);
  for (const [sectionKey, section] of Object.entries(schemaObj)) {
    for (const [fieldKey, field] of Object.entries(section.fields || {})) {
      if (field.type === 'group') continue;
      const path = field.path || `${sectionKey}.${fieldKey}`;
      setAt(out, path, field.type === 'range' ? [...field.default] : field.default);
    }
  }
  return out;
}

function tuningPaths() {
  const paths = new Set();
  for (const sectionKey of tuningSections) {
    for (const [fieldKey, field] of Object.entries(schema[sectionKey]?.fields || {})) {
      if (field.type === 'group') continue;
      paths.add(field.path || `${sectionKey}.${fieldKey}`);
    }
  }
  return [...paths];
}

function getAt(obj, path) {
  const parts = path.split('.');
  let node = obj;
  for (const part of parts) {
    if (node == null) return undefined;
    node = node[part];
  }
  return node;
}

function cloneScenePresetParams(params) {
  const out = structuredClone(params || {});
  // Retired controls should not keep steering the canonical island after the
  // tree-bank/lagoon rewrite.
  if (out.tree) {
    delete out.tree.palmCount;
    delete out.tree.palmLine;
    delete out.tree.mixedTreeCount;
    delete out.tree.palmSway;
  }
  if (out.water) delete out.water.referenceBlocks;
  return out;
}

function hydratePresetParams(params) {
  return deepMerge(structuredClone(workshopDefaults), cloneScenePresetParams(params));
}

function ensureWorkshopParams(target) {
  for (const [sectionKey, section] of Object.entries(schema)) {
    for (const [fieldKey] of Object.entries(section.fields || {})) {
      const field = schema[sectionKey].fields[fieldKey];
      if (field.type === 'group') continue;
      const path = field.path || `${sectionKey}.${fieldKey}`;
      if (getAt(target, path) === undefined) {
        setAt(target, path, getAt(workshopDefaults, path));
      }
    }
  }
}

function deepMerge(target, source) {
  for (const key in source) {
    const value = source[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (target[key] == null || typeof target[key] !== 'object') target[key] = {};
      deepMerge(target[key], value);
    } else {
      target[key] = Array.isArray(value) ? value.slice() : value;
    }
  }
  return target;
}

function setAt(obj, path, value) {
  const parts = path.split('.');
  const last = parts.pop();
  let node = obj;
  for (const part of parts) node = (node[part] ??= {});
  node[last] = structuredClone(value);
}

window.island = {
  scene,
  store,
  panel,
  perf,
  captureSettleMs: WORKSHOP_CAPTURE_SETTLE_MS,
  assets: () => skyAssetsPromise,
  diagnostics: () => scene.getHorizonDiagnosticSnapshot(),
  takram: () => takramRig.getDebugSnapshot(),
  setDiagnosis: (values = {}) => {
    for (const [key, value] of Object.entries(values)) store.set(`skyDiagnosis.${key}`, value);
    return scene.getHorizonDiagnosticSnapshot();
  },
  setTakram: (values = {}) => {
    const aliases = {
      atmosphere: 'cloudsRender.atmosphere',
      mode: 'cloudsRender.mode',
      sky: 'cloudsRender.atmosphere',
      takramSky: 'cloudsRender.atmosphere',
      clouds: 'cloudsRender.clouds',
      haze: 'cloudsRender.aerialPerspective',
      aerialPerspective: 'cloudsRender.aerialPerspective',
      exposure: 'cloudsRender.exposure',
      quality: 'cloudsRender.quality',
      resolutionScale: 'cloudsRender.resolutionScale',
      temporalUpscale: 'cloudsRender.temporalUpscale',
      coverage: 'cloudWeather.coverage',
      toneMapping: 'cloudFinishing.toneMapping',
      dithering: 'cloudFinishing.dithering',
    };
    for (const [key, value] of Object.entries(values)) store.set(aliases[key] || key, value);
    return takramRig.getDebugSnapshot();
  },
};
window.sunsetSky = window.island;
