import * as THREE from 'three';
import {
  AerialPerspectiveEffect,
  SkyMaterial,
} from '@takram/three-atmosphere';
import { CloudsEffect } from '@takram/three-clouds';
import { Ellipsoid, Geodetic } from '@takram/three-geospatial';
import {
  EffectComposer,
  EffectPass,
  NormalPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';

const QUALITY = ['low', 'medium', 'high', 'ultra'];
const SHADOW_MAP_SIZES = [256, 512, 1024, 2048];
const TONE_MAPPING_MODES = [
  ToneMappingMode.ACES_FILMIC,
  ToneMappingMode.NEUTRAL,
  ToneMappingMode.AGX,
  ToneMappingMode.LINEAR,
];
const TONE_MAPPING_LABELS = ['aces', 'neutral', 'agx', 'linear'];
const CLOUD_DEBUG_DEFINES = [
  'DEBUG_SHOW_SAMPLE_COUNT',
  'DEBUG_SHOW_FRONT_DEPTH',
  'DEBUG_SHOW_SHADOW_MAP',
  'DEBUG_SHOW_CASCADES',
  'DEBUG_SHOW_UV',
];
const RESOLVE_DEBUG_DEFINES = [
  'DEBUG_SHOW_SHADOW_LENGTH',
  'DEBUG_SHOW_VELOCITY',
];
const REFERENCE_CLOUD_LAYERS = [
  {
    channel: 'r',
    altitude: 750,
    height: 650,
    densityScale: 0.2,
    shapeAmount: 1,
    shapeDetailAmount: 1,
    weatherExponent: 1,
    shapeAlteringBias: 0.35,
    coverageFilterWidth: 0.6,
    shadow: true,
  },
  {
    channel: 'g',
    altitude: 1000,
    height: 1200,
    densityScale: 0.2,
    shapeAmount: 1,
    shapeDetailAmount: 1,
    weatherExponent: 1,
    shapeAlteringBias: 0.35,
    coverageFilterWidth: 0.6,
    shadow: true,
  },
  {
    channel: 'b',
    altitude: 7500,
    height: 500,
    densityScale: 0.003,
    shapeAmount: 0.4,
    shapeDetailAmount: 0,
    weatherExponent: 1,
    shapeAlteringBias: 0.35,
    coverageFilterWidth: 0.5,
    shadow: false,
  },
  { channel: 'a', height: 0, densityScale: 0, shapeAmount: 0, shapeDetailAmount: 0, shadow: false },
];
const LOCAL_TO_ENU = new THREE.Matrix4().set(
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, 1, 0, 0,
  0, 0, 0, 1,
);

function makeFullscreenTriangle() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -1, -1, 0,
    3, -1, 0,
    -1, 3, 0,
  ], 3));
  return geometry;
}

function makeWorldToECEFMatrix() {
  const anchor = new Geodetic(0, THREE.MathUtils.degToRad(35), 100);
  const position = anchor.toECEF(new THREE.Vector3());
  const enuToECEF = Ellipsoid.WGS84.getEastNorthUpFrame(position, new THREE.Matrix4());
  return enuToECEF.multiply(LOCAL_TO_ENU);
}

export class TakramSkyRig {
  constructor({ scene, camera, renderer }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.enabled = false;
    this.skyEnabled = false;
    this.skyVisibilityGate = true;
    this.cloudsEnabled = false;
    this.aerialPerspectiveEnabled = false;
    this.assetsReady = false;
    this.exposure = 10;
    this.qualityPreset = 'medium';
    this.resolutionScale = 0.7;
    this.coverage = 0.6;
    this.toneMappingIndex = 0;
    this.toneMappingMode = TONE_MAPPING_MODES[this.toneMappingIndex];
    this.dithering = true;
    this.shadowTemporalSmoothing = 0.999;
    this.shadowVarianceGamma = 1;
    this._lastShadowTemporalPass = true;
    this._lastShadowTemporalJitter = false;

    this.worldToECEFMatrix = makeWorldToECEFMatrix();
    this.sunECEF = new THREE.Vector3(0, 1, 0);
    this.sunRotation = new THREE.Matrix3().setFromMatrix4(this.worldToECEFMatrix);

    this.skyMaterial = new SkyMaterial({
      ground: true,
      moon: false,
      groundAlbedo: new THREE.Color('#05080b'),
    });
    this.skyMaterial.worldToECEFMatrix.copy(this.worldToECEFMatrix);

    this.skyMesh = new THREE.Mesh(makeFullscreenTriangle(), this.skyMaterial);
    this.skyMesh.name = 'TakramSkyMaterialFullscreen';
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = -1000;
    this.skyMesh.visible = false;
    this.scene.add(this.skyMesh);

    this.aerialPerspective = new AerialPerspectiveEffect(camera, {
      sky: false,
      sun: true,
      moon: false,
      ground: true,
      sunLight: true,
      skyLight: true,
      reconstructNormal: false,
    });
    this.aerialPerspective.worldToECEFMatrix.copy(this.worldToECEFMatrix);

    this.clouds = new CloudsEffect(camera);
    this.clouds.qualityPreset = this.qualityPreset;
    this.clouds.coverage = this.coverage;
    this.clouds.resolutionScale = this.resolutionScale;
    this.clouds.lightShafts = false;
    this.clouds.localWeatherVelocity.set(0.001, 0);
    this.clouds.worldToECEFMatrix.copy(this.worldToECEFMatrix);
    this._configureFirstCloudLayer();
    this.clouds.events.addEventListener('change', (event) => this._onCloudsChange(event));

    this.composer = new EffectComposer(renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: 0,
    });
    this.renderPass = new RenderPass(scene, camera);
    this.normalPass = new NormalPass(scene, camera);
    this.aerialPerspective.normalBuffer = this.normalPass.texture;
    this.toneMappingEffect = new ToneMappingEffect({ mode: this.toneMappingMode });
    this.finalPass = new EffectPass(camera, this.toneMappingEffect);
    this.finalPass.dithering = this.dithering;
    this.effectPass = null;
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.normalPass);
    this.composer.addPass(this.finalPass);
    this._rebuildEffectPass();
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    this._syncSkyMeshVisibility();
  }

  setSkyEnabled(enabled) {
    this.skyEnabled = !!enabled;
    this._syncSkyMeshVisibility();
  }

  setSkyVisible(visible) {
    this.skyVisibilityGate = !!visible;
    this._syncSkyMeshVisibility();
  }

  setParams(params = {}) {
    const render = params.render || params;
    const atmosphere = params.atmosphere || {};
    const weather = params.weather || params;
    const layer = params.layer || {};
    const lighting = params.lighting || {};
    const shadows = params.shadows || {};
    const debug = params.debug || {};
    const finishing = params.finishing || {};

    this.exposure = render.exposure ?? this.exposure;
    this.coverage = THREE.MathUtils.clamp(weather.coverage ?? this.coverage, 0, 1);
    this.resolutionScale = THREE.MathUtils.clamp(render.resolutionScale ?? this.resolutionScale, 0.25, 1);
    this.clouds.coverage = this.coverage;
    this.clouds.resolutionScale = this.resolutionScale;
    this.clouds.temporalUpscale = render.temporalUpscale !== false;

    const qualityIndex = THREE.MathUtils.clamp(Math.round(render.quality ?? 1), 0, QUALITY.length - 1);
    const qualityPreset = QUALITY[qualityIndex];
    if (qualityPreset !== this.qualityPreset) {
      this.qualityPreset = qualityPreset;
      this.clouds.qualityPreset = qualityPreset;
    }

    this._applyAtmosphereParams(atmosphere);
    this._applyWeatherParams(weather);
    this._applyLayerParams(layer, shadows);
    this._applyLightingParams(lighting);
    this._applyShadowParams(shadows);
    this._applyDebugParams(debug);
    this._applyFinishingParams(finishing);

    const cloudsEnabled = !!render.clouds;
    const aerialPerspectiveEnabled = !!render.aerialPerspective;
    if (
      cloudsEnabled !== this.cloudsEnabled ||
      aerialPerspectiveEnabled !== this.aerialPerspectiveEnabled
    ) {
      this.cloudsEnabled = cloudsEnabled;
      this.aerialPerspectiveEnabled = aerialPerspectiveEnabled;
      this._rebuildEffectPass();
    }
  }

  setAssets(assets) {
    if (!assets) return;
    const { atmosphere, clouds } = assets;
    Object.assign(this.skyMaterial, atmosphere);
    Object.assign(this.aerialPerspective, atmosphere);
    Object.assign(this.clouds, atmosphere);

    this.aerialPerspective.stbnTexture = clouds.stbnTexture;
    this.clouds.localWeatherTexture = clouds.localWeatherTexture;
    this.clouds.shapeTexture = clouds.shapeTexture;
    this.clouds.shapeDetailTexture = clouds.shapeDetailTexture;
    this.clouds.turbulenceTexture = clouds.turbulenceTexture;
    this.clouds.stbnTexture = clouds.stbnTexture;
    this.assetsReady = true;
  }

  syncFromScene(sim) {
    const localSun = sim.getSunDirection ? sim.getSunDirection() : sim._sunDir();
    this.sunECEF.copy(localSun).applyMatrix3(this.sunRotation).normalize();
    this.skyMaterial.sunDirection.copy(this.sunECEF);
    this.aerialPerspective.sunDirection.copy(this.sunECEF);
    this.clouds.sunDirection.copy(this.sunECEF);

    this.skyMaterial.worldToECEFMatrix.copy(this.worldToECEFMatrix);
    this.aerialPerspective.worldToECEFMatrix.copy(this.worldToECEFMatrix);
    this.clouds.worldToECEFMatrix.copy(this.worldToECEFMatrix);
  }

  render(deltaTime) {
    const prevToneMapping = this.renderer.toneMapping;
    const prevExposure = this.renderer.toneMappingExposure;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = this.exposure;
    this.composer.render(deltaTime);
    this.renderer.toneMapping = prevToneMapping;
    this.renderer.toneMappingExposure = prevExposure;
  }

  setSize(width = window.innerWidth, height = window.innerHeight) {
    this.composer.setSize(width, height);
  }

  resetTemporalState({ resetWeather = false } = {}) {
    const size = this.renderer.getSize(new THREE.Vector2());
    const temporalUpscale = this.clouds.temporalUpscale;
    const shadowTemporalPass = this.clouds.shadow.temporalPass;
    if (resetWeather) {
      this.clouds.localWeatherOffset.set(0, 0);
      this.clouds.shapeOffset.set(0, 0, 0);
      this.clouds.shapeDetailOffset.set(0, 0, 0);
    }
    this.clouds.temporalUpscale = !temporalUpscale;
    this.clouds.temporalUpscale = temporalUpscale;
    this.clouds.shadow.temporalPass = !shadowTemporalPass;
    this.clouds.shadow.temporalPass = shadowTemporalPass;
    this.clouds.setSize(size.x, size.y);
    this.composer.setSize(size.x, size.y);
    this.clouds.frame = 0;
  }

  getDebugSnapshot() {
    return {
      enabled: this.enabled,
      cloudsEnabled: this.cloudsEnabled,
      skyEnabled: this.skyEnabled,
      aerialPerspectiveEnabled: this.aerialPerspectiveEnabled,
      assetsReady: this.assetsReady,
      exposure: this.exposure,
      toneMapping: TONE_MAPPING_LABELS[this.toneMappingIndex] ?? 'aces',
      dithering: this.dithering,
      qualityPreset: this.qualityPreset,
      resolutionScale: this.resolutionScale,
      coverage: this.coverage,
      skyVisible: this.skyMesh.visible,
      temporalUpscale: this.clouds.temporalUpscale,
      lightShafts: this.clouds.lightShafts,
      cloudLayer: {
        layers: this.clouds.cloudLayers.map((layer) => ({
          channel: layer.channel,
          altitude: layer.altitude,
          height: layer.height,
          densityScale: layer.densityScale,
          shapeAmount: layer.shapeAmount,
          shapeDetailAmount: layer.shapeDetailAmount,
          shadow: layer.shadow,
        })),
      },
      shadow: {
        cascadeCount: this.clouds.shadowMaps.cascadeCount,
        mapSize: this.clouds.shadowMaps.mapSize.toArray(),
        temporalPass: this.clouds.shadow.temporalPass,
        temporalJitter: this.clouds.shadow.temporalJitter,
        temporalSmoothing: this.shadowTemporalSmoothing,
        varianceGamma: this.shadowVarianceGamma,
        shadowIterations: this.clouds.shadow.maxIterationCount,
        shadowStep: this.clouds.shadow.minStepSize,
        shadowLengthIterations: this.clouds.clouds.maxShadowLengthIterationCount,
        shadowLengthStep: this.clouds.clouds.minShadowLengthStepSize,
        shadowLengthDistance: this.clouds.clouds.maxShadowLengthRayDistance,
      },
      sunECEF: this.sunECEF.toArray().map((v) => Number(v.toFixed(5))),
      passes: this.composer.passes.map((pass) => ({
        name: pass.name,
        enabled: pass.enabled,
      })),
    };
  }

  _applyAtmosphereParams(params = {}) {
    const sun = params.sun !== false;
    const ground = params.ground !== false;
    this.skyMaterial.sun = sun;
    this.skyMaterial.ground = ground;
    this.skyMaterial.groundAlbedo.setScalar(THREE.MathUtils.clamp(params.groundAlbedo ?? 0.018, 0, 1));
    this.aerialPerspective.sun = sun;
    this.aerialPerspective.ground = ground;
    this.aerialPerspective.transmittance = params.transmittance !== false;
    this.aerialPerspective.inscatter = params.inscatter !== false;
    this.aerialPerspective.sunLight = params.sunLight !== false;
    this.aerialPerspective.skyLight = params.skyLight !== false;
    this.aerialPerspective.albedoScale = params.albedoScale ?? 1;
  }

  _applyWeatherParams(params = {}) {
    this.clouds.localWeatherRepeat.set(
      params.weatherRepeatX ?? 100,
      params.weatherRepeatY ?? 100,
    );
    this.clouds.localWeatherVelocity.set(
      params.weatherVelocityX ?? 0.001,
      params.weatherVelocityY ?? 0,
    );
    const shapeRepeat = params.shapeRepeat ?? 0.0003;
    this.clouds.shapeRepeat.setScalar(shapeRepeat);
    this.clouds.shapeDetailRepeat.setScalar(params.detailRepeat ?? 0.006);
    this.clouds.turbulenceRepeat.setScalar(params.turbulenceRepeat ?? 20);
    this.clouds.turbulenceDisplacement = params.turbulenceDisplacement ?? 350;
  }

  _applyLayerParams(layer = {}, shadows = {}) {
    const enabled = layer.enabled !== false;
    if (enabled && layer.referenceStack !== false) {
      this.clouds.cloudLayers.set(REFERENCE_CLOUD_LAYERS);
      return;
    }
    this.clouds.cloudLayers.set([
      {
        channel: 'r',
        altitude: layer.altitude ?? 750,
        height: enabled ? (layer.height ?? 600) : 0,
        densityScale: enabled ? (layer.densityScale ?? 0.4) : 0,
        shapeAmount: layer.shapeAmount ?? 1,
        shapeDetailAmount: layer.shapeDetailAmount ?? 0.8,
        weatherExponent: layer.weatherExponent ?? 1,
        shapeAlteringBias: layer.shapeAlteringBias ?? 0.35,
        coverageFilterWidth: layer.coverageFilterWidth ?? 0.6,
        shadow: enabled && shadows.layerShadow !== false,
      },
      { channel: 'g', altitude: 0, height: 0, densityScale: 0, shapeAmount: 0, shapeDetailAmount: 0, shadow: false },
      { channel: 'b', altitude: 0, height: 0, densityScale: 0, shapeAmount: 0, shapeDetailAmount: 0, shadow: false },
      { channel: 'a', altitude: 0, height: 0, densityScale: 0, shapeAmount: 0, shapeDetailAmount: 0, shadow: false },
    ]);
  }

  _applyLightingParams(params = {}) {
    this.clouds.scatteringCoefficient = params.scatteringCoefficient ?? 1;
    this.clouds.absorptionCoefficient = params.absorptionCoefficient ?? 0;
    this.clouds.skyLightScale = params.skyLightScale ?? 1;
    this.clouds.groundBounceScale = params.groundBounceScale ?? 1;
    this.clouds.powderScale = params.powderScale ?? 0.8;
    this.clouds.powderExponent = params.powderExponent ?? 150;
    this.clouds.scatterAnisotropy1 = params.anisotropy1 ?? 0.7;
    this.clouds.scatterAnisotropy2 = params.anisotropy2 ?? -0.2;
    this.clouds.scatterAnisotropyMix = params.anisotropyMix ?? 0.5;
    this.clouds.shapeDetail = params.shapeDetail !== false;
    this.clouds.turbulence = !!params.turbulence;
    this.clouds.haze = params.haze !== false;
  }

  _applyShadowParams(params = {}) {
    // The light-shaft path is intentionally muted for the island lab while
    // cloud-shadow temporal stability is being tuned. Presets or console calls
    // may still contain shaft params; they should not re-enable the buffer.
    this.clouds.lightShafts = false;
    const temporalPass = params.temporalPass !== false;
    const temporalJitter = params.temporalJitter === true;
    const temporalStateChanged =
      temporalPass !== this._lastShadowTemporalPass ||
      temporalJitter !== this._lastShadowTemporalJitter;
    this._lastShadowTemporalPass = temporalPass;
    this._lastShadowTemporalJitter = temporalJitter;
    this.clouds.shadow.temporalPass = temporalPass;
    this.clouds.shadow.temporalJitter = temporalJitter;
    if (temporalStateChanged) this.clouds.shadowMapSize?.set(0, 0);
    const cascadeCount = THREE.MathUtils.clamp(Math.round(params.cascadeCount ?? 3), 1, 4);
    const mapSize = SHADOW_MAP_SIZES[THREE.MathUtils.clamp(Math.round(params.mapSize ?? 0), 0, SHADOW_MAP_SIZES.length - 1)];
    this.clouds.shadowMaps.cascadeCount = cascadeCount;
    this.clouds.shadowMaps.mapSize.set(mapSize, mapSize);
    this.clouds.shadow.maxIterationCount = params.shadowIterations ?? 50;
    this.clouds.shadow.minStepSize = params.shadowStep ?? 100;
    this.shadowTemporalSmoothing = THREE.MathUtils.clamp(params.temporalSmoothing ?? 0.999, 0.99, 0.99995);
    this.shadowVarianceGamma = THREE.MathUtils.clamp(params.varianceGamma ?? 1, 0, 6);
    const resolveUniforms = this.clouds.shadowPass?.resolveMaterial?.uniforms;
    if (resolveUniforms) {
      resolveUniforms.temporalAlpha.value = THREE.MathUtils.clamp(1 - this.shadowTemporalSmoothing, 0.00005, 0.01);
      resolveUniforms.varianceGamma.value = this.shadowVarianceGamma;
    }
    if (temporalStateChanged) this.resetTemporalState();
  }

  _applyFinishingParams(params = {}) {
    const toneMappingIndex = THREE.MathUtils.clamp(
      Math.round(params.toneMapping ?? this.toneMappingIndex),
      0,
      TONE_MAPPING_MODES.length - 1,
    );
    if (toneMappingIndex !== this.toneMappingIndex) {
      this.toneMappingIndex = toneMappingIndex;
      this.toneMappingMode = TONE_MAPPING_MODES[toneMappingIndex];
      this.toneMappingEffect.mode = this.toneMappingMode;
    }
    this.dithering = !!params.dithering;
    this.finalPass.dithering = this.dithering;
  }

  _applyDebugParams(params = {}) {
    this.clouds.clouds.maxIterationCount = params.primarySteps ?? 200;
    this.clouds.clouds.minStepSize = params.minStep ?? 80;
    this.clouds.clouds.maxStepSize = params.maxStep ?? 1000;
    this.clouds.clouds.maxRayDistance = params.rayDistance ?? 120000;

    const cloudMaterial = this.clouds.cloudsPass.currentMaterial;
    const resolveMaterial = this.clouds.cloudsPass.resolveMaterial;
    const mode = Math.round(params.mode ?? 0);
    for (const name of CLOUD_DEBUG_DEFINES) setMaterialDefine(cloudMaterial, name, false);
    for (const name of RESOLVE_DEBUG_DEFINES) setMaterialDefine(resolveMaterial, name, false);
    if (mode >= 1 && mode <= 5) setMaterialDefine(cloudMaterial, CLOUD_DEBUG_DEFINES[mode - 1], true);
    if (mode === 6) setMaterialDefine(resolveMaterial, 'DEBUG_SHOW_SHADOW_LENGTH', true);
    if (mode === 7) setMaterialDefine(resolveMaterial, 'DEBUG_SHOW_VELOCITY', true);
  }

  _configureFirstCloudLayer() {
    this.clouds.cloudLayers.set(REFERENCE_CLOUD_LAYERS);
  }

  _rebuildEffectPass() {
    if (this.effectPass) {
      this.composer.removePass(this.effectPass);
      this.effectPass.setEffects?.([]);
      this.effectPass.dispose?.();
      this.effectPass = null;
    }
    this.clouds.skipRendering = !this.cloudsEnabled;
    const useCloudAtmosphereBuffers = this.cloudsEnabled && this.aerialPerspectiveEnabled;
    this.aerialPerspective.overlay = useCloudAtmosphereBuffers ? this.clouds.atmosphereOverlay : null;
    this.aerialPerspective.shadow = useCloudAtmosphereBuffers ? this.clouds.atmosphereShadow : null;
    this.aerialPerspective.shadowLength = null;

    const effects = [];
    if (this.cloudsEnabled) effects.push(this.clouds);
    if (this.aerialPerspectiveEnabled) effects.push(this.aerialPerspective);
    if (effects.length > 0) {
      this.effectPass = new EffectPass(this.camera, ...effects);
      const finalIndex = this.composer.passes.indexOf(this.finalPass);
      this.composer.addPass(this.effectPass, finalIndex >= 0 ? finalIndex : undefined);
      this._ensureDistinctComposerDepthTexture();
    }
  }

  _onCloudsChange(event) {
    if (!this.cloudsEnabled || !this.aerialPerspectiveEnabled) return;
    switch (event.property) {
      case 'atmosphereOverlay':
        this.aerialPerspective.overlay = this.clouds.atmosphereOverlay;
        break;
      case 'atmosphereShadow':
        this.aerialPerspective.shadow = this.clouds.atmosphereShadow;
        break;
      case 'atmosphereShadowLength':
        this.aerialPerspective.shadowLength = null;
        break;
      default:
        break;
    }
  }

  _ensureDistinctComposerDepthTexture() {
    const sourceDepth = this.composer.depthTexture;
    const stableDepth = this.composer.depthRenderTarget?.depthTexture;
    if (!sourceDepth || !stableDepth || sourceDepth.source !== stableDepth.source) return;

    // postprocessing 6.39.1 clones DepthTexture for the stable depth target.
    // Three r170 clones share Texture.source, which can trip WebGL feedback
    // checks during the depth blit. Keep the public composer shape, but give
    // the source side its own texture source.
    const replacement = new THREE.DepthTexture(
      sourceDepth.image?.width,
      sourceDepth.image?.height,
      sourceDepth.type,
      sourceDepth.mapping,
      sourceDepth.wrapS,
      sourceDepth.wrapT,
      sourceDepth.magFilter,
      sourceDepth.minFilter,
      sourceDepth.anisotropy,
      sourceDepth.format,
    );
    replacement.name = 'EffectComposer.SourceDepth';
    replacement.compareFunction = sourceDepth.compareFunction;
    this.composer.depthTexture = replacement;
  }

  _syncSkyMeshVisibility() {
    this.skyMesh.visible = this.enabled && this.skyEnabled && this.skyVisibilityGate;
  }
}

function setMaterialDefine(material, name, enabled, value = '1') {
  const has = material.defines?.[name] != null;
  if (enabled && !has) {
    material.defines[name] = value;
    material.needsUpdate = true;
  } else if (!enabled && has) {
    delete material.defines[name];
    material.needsUpdate = true;
  }
}
