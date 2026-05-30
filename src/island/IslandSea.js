import * as THREE from 'three';

function makeWaterDataTexture(volume, seaLevel, floorDepth) {
  const res = volume?.res || 1;
  const data = new Uint8Array(res * res * 4);
  const maxDepth = Math.max(1, floorDepth || volume?.meta?.floorDepth || 64);

  if (volume?.heightVox) {
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const idx = volume.idx(i, j);
        const y = volume.heightVox[idx] * volume.vstep;
        const depth = Math.max(0, seaLevel - y);
        const k = idx * 4;
        data[k] = Math.round(THREE.MathUtils.clamp(depth / maxDepth, 0, 1) * 255);
        data[k + 1] = volume.channel?.[idx] ? 255 : 0;
        data[k + 2] = volume.land?.[idx] ? 255 : 0;
        data[k + 3] = 255;
      }
    }
  }

  const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function markPatchRole(geometry, role) {
  const count = geometry.attributes.position.count;
  const data = new Float32Array(count);
  data.fill(role);
  geometry.setAttribute('aPatchRole', new THREE.BufferAttribute(data, 1));
  return geometry;
}

const waterCommon = /* glsl */`
uniform float uStage;
uniform float uTime;
uniform float uWaveHeight;
uniform float uWaveScale;
uniform float uWaveSpeed;
uniform float uGlintSpeed;
uniform float uGlintScale;
uniform float uWaveChoppy;
uniform float uWaveRotation;
uniform float uExtraDetailMix;
uniform float uExtraDetailOpacity;
uniform float uExtraDetailScale;
uniform float uExtraDetailSpeed;
uniform float uExtraDetailRotation;
uniform float uExtraDetailContrast;
uniform float uExtraDetailBias;
uniform float uExtraDetailSharp;
uniform float uExtraDetailTint;
uniform float uExtraDetailDistort;
uniform float uLayerVertex;
uniform float uLayerBroad;
uniform float uLayerFine;
uniform float uLayerGlint;
uniform float uLayerChaos;
uniform float uLodEnabled;
uniform float uLodSize;
uniform float uLodFeather;
uniform float uLodLobes;
uniform float uLodAlpha;
uniform float uLodSuppress;
uniform float uLodHeightMul;
uniform float uLodScaleMul;
uniform float uLodSpeedMul;
uniform float uLodChopBoost;
uniform float uLodDetailBoost;
uniform float uLodNormalBoost;

float whash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float wnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(whash(i), whash(i + vec2(1.0, 0.0)), u.x),
    mix(whash(i + vec2(0.0, 1.0)), whash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float seaOctave(vec2 uv, float choppy) {
  uv += wnoise(uv);
  vec2 wv = 1.0 - abs(sin(uv));
  vec2 swv = abs(cos(uv));
  wv = mix(wv, swv, wv);
  return pow(1.0 - pow(clamp(wv.x * wv.y, 0.0, 1.0), 0.65), max(0.5, choppy));
}

mat2 waveRot(float deg) {
  float a = radians(deg);
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

float waterHeightAt(vec2 xz, float speedMul, float scaleMul, float heightMul, float chopBoost) {
  float freq = max(0.0001, uWaveScale * max(0.05, scaleMul));
  float amp = uWaveHeight * max(0.0, heightMul);
  float chop = max(0.5, uWaveChoppy + chopBoost);
  float t = uTime * uWaveSpeed * max(0.0, speedMul);
  vec2 uv = waveRot(uWaveRotation) * xz;
  uv.x *= 0.75;
  float h = 0.0;
  mat2 octaveM = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 3; i++) {
    float d = seaOctave((uv + vec2(t, t * 0.63)) * freq, chop)
      + seaOctave((uv - vec2(t * 0.34, t)) * freq, chop);
    h += (d - 1.0) * amp;
    uv = octaveM * uv;
    freq *= 1.9;
    amp *= 0.22;
    chop = mix(chop, 1.0, 0.2);
  }
  return h;
}
float waterHeight(vec2 xz) { return waterHeightAt(xz, 1.0, 1.0, 1.0, 0.0); }
vec3 waterWaveNormal(vec2 xz, float speedMul, float scaleMul, float heightMul, float chopBoost) {
  float eps = max(1.0, 0.012 / max(0.0001, uWaveScale * max(0.05, scaleMul)));
  float h0 = waterHeightAt(xz, speedMul, scaleMul, heightMul, chopBoost);
  float hx = waterHeightAt(xz + vec2(eps, 0.0), speedMul, scaleMul, heightMul, chopBoost);
  float hz = waterHeightAt(xz + vec2(0.0, eps), speedMul, scaleMul, heightMul, chopBoost);
  return normalize(vec3(-(hx - h0) / eps, 1.0, -(hz - h0) / eps));
}
`;

const floorGlowCommon = /* glsl */`
varying vec2 vFloorXZ;
uniform float uTime;
uniform sampler2D uWaterData;
uniform vec2 uWaterTexel;
uniform float uWaterWorldSize;
uniform float uIslandRadius;
uniform float uShoreGlow;
uniform float uShoreGlowWidth;
uniform float uShoreGlowFollow;
uniform float uShoreGlowSubstrate;
uniform float uShoreGlowIntensity;
uniform float uShoreGlowCaustic;
uniform float uShoreGlowFalloff;
uniform float uShoreGlowSoftness;

float fgHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float fgNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(fgHash(i), fgHash(i + vec2(1.0, 0.0)), u.x),
    mix(fgHash(i + vec2(0.0, 1.0)), fgHash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fgInside(vec2 uv) {
  return step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
}

vec4 fgDataAt(vec2 uv) {
  float inside = fgInside(uv);
  vec4 data = texture2D(uWaterData, clamp(uv, 0.0, 1.0));
  data.r = mix(1.0, data.r, inside);
  data.g *= inside;
  data.b *= inside;
  data.a = inside;
  return data;
}

float fgLandAt(vec2 uv) {
  return fgDataAt(uv).b;
}

vec4 fgGlowSample(vec2 rawUv, float radius) {
  vec2 px = uWaterTexel * radius;
  vec4 sum = fgDataAt(rawUv) * 0.24;
  sum += fgDataAt(rawUv + vec2( px.x, 0.0)) * 0.12;
  sum += fgDataAt(rawUv + vec2(-px.x, 0.0)) * 0.12;
  sum += fgDataAt(rawUv + vec2(0.0,  px.y)) * 0.12;
  sum += fgDataAt(rawUv + vec2(0.0, -px.y)) * 0.12;
  sum += fgDataAt(rawUv + vec2( px.x,  px.y) * 0.72) * 0.07;
  sum += fgDataAt(rawUv + vec2(-px.x,  px.y) * 0.72) * 0.07;
  sum += fgDataAt(rawUv + vec2( px.x, -px.y) * 0.72) * 0.07;
  sum += fgDataAt(rawUv + vec2(-px.x, -px.y) * 0.72) * 0.07;
  return sum;
}

float fgShoreProximity(vec2 uv, float width, float follow) {
  float tightReach = mix(6.5, 2.2, follow) * max(0.2, width);
  float broadReach = tightReach * mix(2.8, 1.55, follow);
  vec2 a = uWaterTexel * tightReach;
  vec2 b = uWaterTexel * broadReach;
  float tightMax = 0.0;
  float tightAvg = 0.0;
  float broadMax = 0.0;
  float broadAvg = 0.0;
  float s;
  s = fgLandAt(uv + vec2( a.x, 0.0)); tightMax = max(tightMax, s); tightAvg += s;
  s = fgLandAt(uv + vec2(-a.x, 0.0)); tightMax = max(tightMax, s); tightAvg += s;
  s = fgLandAt(uv + vec2(0.0,  a.y)); tightMax = max(tightMax, s); tightAvg += s;
  s = fgLandAt(uv + vec2(0.0, -a.y)); tightMax = max(tightMax, s); tightAvg += s;
  s = fgLandAt(uv + vec2( a.x,  a.y) * 0.72); tightMax = max(tightMax, s); tightAvg += s;
  s = fgLandAt(uv + vec2(-a.x,  a.y) * 0.72); tightMax = max(tightMax, s); tightAvg += s;
  s = fgLandAt(uv + vec2( a.x, -a.y) * 0.72); tightMax = max(tightMax, s); tightAvg += s;
  s = fgLandAt(uv + vec2(-a.x, -a.y) * 0.72); tightMax = max(tightMax, s); tightAvg += s;
  s = fgLandAt(uv + vec2( b.x, 0.0)); broadMax = max(broadMax, s); broadAvg += s;
  s = fgLandAt(uv + vec2(-b.x, 0.0)); broadMax = max(broadMax, s); broadAvg += s;
  s = fgLandAt(uv + vec2(0.0,  b.y)); broadMax = max(broadMax, s); broadAvg += s;
  s = fgLandAt(uv + vec2(0.0, -b.y)); broadMax = max(broadMax, s); broadAvg += s;
  s = fgLandAt(uv + vec2( b.x,  b.y) * 0.68); broadMax = max(broadMax, s); broadAvg += s;
  s = fgLandAt(uv + vec2(-b.x,  b.y) * 0.68); broadMax = max(broadMax, s); broadAvg += s;
  s = fgLandAt(uv + vec2( b.x, -b.y) * 0.68); broadMax = max(broadMax, s); broadAvg += s;
  s = fgLandAt(uv + vec2(-b.x, -b.y) * 0.68); broadMax = max(broadMax, s); broadAvg += s;
  float tight = mix(tightAvg * 0.24, tightMax, follow * 0.55);
  float broad = mix(broadAvg * 0.23, broadMax, follow * 0.35) * (1.0 - follow * 0.35);
  return smoothstep(0.03, 0.72, clamp(max(tight, broad), 0.0, 1.0));
}

float fgCaustic(vec2 xz) {
  float a = fgNoise(xz * 0.020 + vec2(uTime * 0.028, -uTime * 0.018));
  float b = fgNoise(xz * 0.052 + vec2(-uTime * 0.044, uTime * 0.026));
  float threads = smoothstep(0.52, 0.98, a * 0.68 + b * 0.44);
  return mix(1.0, 0.58 + threads * 0.95, clamp(uShoreGlowCaustic, 0.0, 4.0) * 0.25);
}
`;

function shoreGlowAmount(value) {
  if (value === false) return 0;
  if (value === true || value == null) return 1;
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? 1 : 0;
}

function shoreGlowParams(params = {}) {
  return {
    amount: shoreGlowAmount(params.shoreGlow),
    width: THREE.MathUtils.clamp(params.shoreGlowWidth ?? 1.2, 0.2, 10),
    follow: THREE.MathUtils.clamp(params.shoreGlowFollow ?? 0.65, 0, 1),
    substrate: THREE.MathUtils.clamp(params.shoreGlowSubstrate ?? 0.45, 0, 4),
    intensity: THREE.MathUtils.clamp(params.shoreGlowIntensity ?? 1.0, 0, 16),
    surface: THREE.MathUtils.clamp(params.shoreGlowSurface ?? 0.65, 0, 8),
    caustic: THREE.MathUtils.clamp(params.shoreGlowCaustic ?? 0.55, 0, 4),
    falloff: THREE.MathUtils.clamp(params.shoreGlowFalloff ?? 1.4, 0.2, 6),
    softness: THREE.MathUtils.clamp(params.shoreGlowSoftness ?? 0.55, 0, 1),
    canyon: THREE.MathUtils.clamp(params.shoreGlowCanyon ?? 0.45, 0, 4),
  };
}

function syncShoreGlowUniforms(uniforms, params = {}) {
  if (!uniforms) return;
  const glow = shoreGlowParams(params);
  uniforms.uShoreGlow.value = glow.amount;
  uniforms.uShoreGlowWidth.value = glow.width;
  uniforms.uShoreGlowFollow.value = glow.follow;
  uniforms.uShoreGlowSubstrate.value = glow.substrate;
  uniforms.uShoreGlowIntensity.value = glow.intensity;
  if (uniforms.uShoreGlowSurface) uniforms.uShoreGlowSurface.value = glow.surface;
  uniforms.uShoreGlowCaustic.value = glow.caustic;
  uniforms.uShoreGlowFalloff.value = glow.falloff;
  if (uniforms.uShoreGlowSoftness) uniforms.uShoreGlowSoftness.value = glow.softness;
  if (uniforms.uShoreGlowCanyon) uniforms.uShoreGlowCanyon.value = glow.canyon;
}

export class IslandSea {
  constructor(params) {
    this.group = new THREE.Group();
    this.group.name = 'IslandSea';
    this._enabled = params.enable !== false;
    this._seaLevel = params.seaLevel;
    this._surfaceLift = params.surfaceLift ?? 0.08;
    this._horizon = new THREE.Color('#bcd4d6');
    this._sunDir = new THREE.Vector3(0, 1, 0);
    this._sunCol = new THREE.Color('#fff3df');
    this._waterData = makeWaterDataTexture(params.volume, params.seaLevel, params.floorDepth);
    this._floorUniforms = null;

    const radius = Math.max(params.worldSize * 12, 26000) * 0.5;
    const waterWorldSize = params.worldSize || params.radius * 2.3;
    this._waterWorldSize = waterWorldSize;
    this._waterTexel = new THREE.Vector2(1 / this._waterData.image.width, 1 / this._waterData.image.height);
    const floorMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#062a36'), fog: true });
    floorMat.onBeforeCompile = (shader) => {
      const glow = shoreGlowParams(params);
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uWaterData = { value: this._waterData };
      shader.uniforms.uWaterTexel = { value: this._waterTexel };
      shader.uniforms.uWaterWorldSize = { value: waterWorldSize };
      shader.uniforms.uIslandRadius = { value: params.radius || waterWorldSize * 0.435 };
      shader.uniforms.uShoreGlow = { value: glow.amount };
      shader.uniforms.uShoreGlowWidth = { value: glow.width };
      shader.uniforms.uShoreGlowFollow = { value: glow.follow };
      shader.uniforms.uShoreGlowSubstrate = { value: glow.substrate };
      shader.uniforms.uShoreGlowIntensity = { value: glow.intensity };
      shader.uniforms.uShoreGlowCaustic = { value: glow.caustic };
      shader.uniforms.uShoreGlowFalloff = { value: glow.falloff };
      shader.uniforms.uShoreGlowSoftness = { value: glow.softness };
      this._floorUniforms = shader.uniforms;

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
varying vec2 vFloorXZ;
`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
  vec4 floorWorld = modelMatrix * vec4(transformed, 1.0);
  vFloorXZ = floorWorld.xz;
`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
${floorGlowCommon}
`)
        .replace('#include <color_fragment>', `#include <color_fragment>
  vec2 floorUv = vFloorXZ / max(1.0, uWaterWorldSize) + 0.5;
  float floorInside = step(0.0, floorUv.x) * step(floorUv.x, 1.0) * step(0.0, floorUv.y) * step(floorUv.y, 1.0);
  float floorWidth = max(0.2, uShoreGlowWidth);
  float floorBlur = mix(1.4, 9.5, clamp(uShoreGlowSoftness, 0.0, 1.0)) * mix(0.7, 1.35, clamp(floorWidth / 10.0, 0.0, 1.0));
  vec4 floorWater = fgGlowSample(floorUv, floorBlur);
  float floorDepth = floorWater.r;
  float floorLand = floorWater.b;
  float floorWaterMask = (1.0 - smoothstep(0.10, 0.78, floorLand)) * floorInside * floorWater.a;
  float floorNearShore = fgShoreProximity(floorUv, floorWidth, clamp(uShoreGlowFollow, 0.0, 1.0));
  float floorIslandGate = 1.0 - smoothstep(uIslandRadius * 1.03, uIslandRadius * 1.36, length(vFloorXZ));
  float floorDepthReach = mix(0.09, 0.36, clamp(floorWidth / 10.0, 0.0, 1.0));
  float floorShallow = 1.0 - smoothstep(0.025, floorDepthReach, floorDepth);
  float floorFalloff = pow(clamp(floorNearShore * floorShallow, 0.0, 1.0), max(0.25, uShoreGlowFalloff * 0.34));
  float floorBreath = 0.82 + 0.18 * fgNoise(vFloorXZ * 0.018 + vec2(uTime * 0.030, -uTime * 0.020));
  float floorSubstrateGain = pow(max(0.0, uShoreGlowSubstrate), 0.62);
  float floorIntensityGain = max(0.0, uShoreGlowIntensity);
  float floorDarkBoost = 1.0 + smoothstep(0.0, 0.55, floorSubstrateGain) * 1.4;
  float floorGlow = max(0.0, uShoreGlow) * floorIntensityGain * floorSubstrateGain
    * floorWaterMask * floorIslandGate * floorFalloff * floorBreath * floorDarkBoost * fgCaustic(vFloorXZ);
  vec3 floorBio = mix(vec3(0.0, 0.18, 0.24), vec3(0.0, 0.66, 0.78), floorShallow);
  diffuseColor.rgb += floorBio * floorGlow * 3.2;
`);
    };
    this.floor = new THREE.Mesh(new THREE.CircleGeometry(radius, 96), floorMat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = params.seaLevel - (params.floorDepth || 64) - 10;
    this.floor.renderOrder = 1;
    this.group.add(this.floor);

    this.surfaceMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#1f8fa3'),
      transparent: true,
      opacity: 1,
      depthWrite: false,
      roughness: 0.24,
      metalness: 0,
      specularIntensity: 1,
      transmission: 0,
      side: THREE.DoubleSide,
    });
    this.surfaceMat.forceSinglePass = true;

    const fade0 = params.radius * 1.4;
    const fade1 = radius * 0.96;
    this.surfaceMat.onBeforeCompile = (shader) => {
      const glow = shoreGlowParams(params);
      shader.uniforms.uHorizon = { value: this._horizon };
      shader.uniforms.uF0 = { value: fade0 };
      shader.uniforms.uF1 = { value: fade1 };
      shader.uniforms.uSunDir = { value: this._sunDir };
      shader.uniforms.uSunCol = { value: this._sunCol };
      shader.uniforms.uCamPos = { value: new THREE.Vector3() };
      shader.uniforms.uWaterData = { value: this._waterData };
      shader.uniforms.uWaterTexel = { value: this._waterTexel };
      shader.uniforms.uWaterWorldSize = { value: waterWorldSize };
      shader.uniforms.uIslandRadius = { value: params.radius || waterWorldSize * 0.435 };
      shader.uniforms.uStage = { value: params.surfaceStage ?? params.tutorialStage ?? 5 };
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uSurfaceAlpha = { value: params.surfaceOpacity ?? 0.55 };
      shader.uniforms.uDepthTint = { value: params.depthTint ?? 0.78 };
      shader.uniforms.uWaveHeight = { value: params.waveHeight ?? 1.92 };
      shader.uniforms.uWaveScale = { value: params.waveScale ?? 0.0275 };
      shader.uniforms.uWaveSpeed = { value: params.waveSpeed ?? 2.7 };
      shader.uniforms.uGlintSpeed = { value: params.glintSpeed ?? 3.5 };
      shader.uniforms.uGlintScale = { value: params.glintScale ?? 1.34 };
      shader.uniforms.uWaveChoppy = { value: params.waveChoppy ?? 5.95 };
      shader.uniforms.uWaveRotation = { value: params.waveRotation ?? 143 };
      shader.uniforms.uExtraDetailMix = { value: params.extraDetailMix ?? 0 };
      shader.uniforms.uExtraDetailOpacity = { value: params.extraDetailOpacity ?? 1 };
      shader.uniforms.uExtraDetailScale = { value: params.extraDetailScale ?? 2.4 };
      shader.uniforms.uExtraDetailSpeed = { value: params.extraDetailSpeed ?? 0.7 };
      shader.uniforms.uExtraDetailRotation = { value: params.extraDetailRotation ?? 119 };
      shader.uniforms.uExtraDetailContrast = { value: params.extraDetailContrast ?? 1.4 };
      shader.uniforms.uExtraDetailBias = { value: params.extraDetailBias ?? 0 };
      shader.uniforms.uExtraDetailSharp = { value: params.extraDetailSharp ?? 1 };
      shader.uniforms.uExtraDetailTint = { value: params.extraDetailTint ?? 0.55 };
      shader.uniforms.uExtraDetailDistort = { value: params.extraDetailDistort ?? 0.25 };
      shader.uniforms.uLayerVertex = { value: 1 };
      shader.uniforms.uLayerBroad = { value: 1 };
      shader.uniforms.uLayerFine = { value: 1 };
      shader.uniforms.uLayerGlint = { value: 1 };
      shader.uniforms.uLayerChaos = { value: params.extraDetailMix ? 1 : 0 };
      shader.uniforms.uLodEnabled = { value: params.nearPatch ? 1 : 0 };
      shader.uniforms.uLodSize = { value: params.patchSize ?? 820 };
      shader.uniforms.uLodFeather = { value: params.patchFeather ?? 0.38 };
      shader.uniforms.uLodLobes = { value: params.patchLobes ?? 5 };
      shader.uniforms.uLodAlpha = { value: params.patchAlpha ?? 0.9 };
      shader.uniforms.uLodSuppress = { value: params.patchSuppress ?? 0.82 };
      shader.uniforms.uLodHeightMul = { value: params.patchHeightMul ?? 3.5 };
      shader.uniforms.uLodScaleMul = { value: params.patchScaleMul ?? 2.4 };
      shader.uniforms.uLodSpeedMul = { value: params.patchSpeedMul ?? 1.15 };
      shader.uniforms.uLodChopBoost = { value: params.patchChopBoost ?? 1.1 };
      shader.uniforms.uLodDetailBoost = { value: params.patchDetailBoost ?? 1.35 };
      shader.uniforms.uLodNormalBoost = { value: params.patchNormalBoost ?? 1.6 };
      shader.uniforms.uDetailMix = { value: params.detailMix ?? 0.42 };
      shader.uniforms.uNormalStrength = { value: params.normalStrength ?? 0.4 };
      shader.uniforms.uRefractionStrength = { value: params.refractionStrength ?? 0.18 };
      shader.uniforms.uLagoonTint = { value: params.lagoonTint ?? 0.18 };
      shader.uniforms.uShoreGlow = { value: glow.amount };
      shader.uniforms.uShoreGlowWidth = { value: glow.width };
      shader.uniforms.uShoreGlowFollow = { value: glow.follow };
      shader.uniforms.uShoreGlowSubstrate = { value: glow.substrate };
      shader.uniforms.uShoreGlowIntensity = { value: glow.intensity };
      shader.uniforms.uShoreGlowSurface = { value: glow.surface };
      shader.uniforms.uShoreGlowCaustic = { value: glow.caustic };
      shader.uniforms.uShoreGlowFalloff = { value: glow.falloff };
      shader.uniforms.uShoreGlowSoftness = { value: glow.softness };
      shader.uniforms.uLandMask = { value: params.landMask ?? 1 };
      shader.uniforms.uDebugView = { value: params.debugView ?? 0 };
      this._uniforms = shader.uniforms;

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
${waterCommon}
attribute float aPatchRole;
varying vec2 vWaterXZ;
varying vec3 vWaterWorld;
varying float vWaterWave;
varying float vPatchRole;
varying vec2 vPatchLocal;
`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
  vPatchLocal = transformed.xy;
  float waterPatchRole = clamp(aPatchRole, 0.0, 1.0);
  vec4 waterPreWorld = modelMatrix * vec4(transformed, 1.0);
  float waterWaveGate = step(2.5, uStage) * uLayerVertex;
  float waterHeightMul = mix(1.0, max(0.0, uLodHeightMul), waterPatchRole);
  float waterScaleMul = mix(1.0, max(0.05, uLodScaleMul), waterPatchRole);
  float waterSpeedMul = mix(1.0, max(0.0, uLodSpeedMul), waterPatchRole);
  float waterChopBoost = mix(0.0, uLodChopBoost, waterPatchRole);
  float waterWave = waterHeightAt(waterPreWorld.xz, waterSpeedMul, waterScaleMul, waterHeightMul, waterChopBoost) * waterWaveGate;
  transformed.z += waterWave;
  vec4 waterWorld = modelMatrix * vec4(transformed, 1.0);
  vWaterXZ = waterWorld.xz;
  vWaterWorld = waterWorld.xyz;
  vWaterWave = waterWave;
  vPatchRole = waterPatchRole;
`);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
${waterCommon}
varying vec2 vWaterXZ;
varying vec3 vWaterWorld;
varying float vWaterWave;
varying float vPatchRole;
varying vec2 vPatchLocal;
uniform vec3 uHorizon;
uniform float uF0;
uniform float uF1;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uCamPos;
uniform sampler2D uWaterData;
uniform vec2 uWaterTexel;
uniform float uWaterWorldSize;
uniform float uIslandRadius;
uniform float uSurfaceAlpha;
uniform float uDepthTint;
uniform float uDetailMix;
uniform float uNormalStrength;
uniform float uRefractionStrength;
uniform float uLagoonTint;
uniform float uShoreGlow;
uniform float uShoreGlowWidth;
uniform float uShoreGlowFollow;
uniform float uShoreGlowSubstrate;
uniform float uShoreGlowIntensity;
uniform float uShoreGlowSurface;
uniform float uShoreGlowCaustic;
uniform float uShoreGlowFalloff;
uniform float uShoreGlowSoftness;
uniform float uLandMask;
uniform float uDebugView;

vec4 waterSample(vec2 rawUv) {
  float inside = step(0.0, rawUv.x) * step(rawUv.x, 1.0) * step(0.0, rawUv.y) * step(rawUv.y, 1.0);
  vec4 wd = texture2D(uWaterData, clamp(rawUv, 0.0, 1.0));
  wd.r = mix(1.0, wd.r, inside);
  wd.g *= inside;
  wd.b *= inside;
  wd.a = inside;
  return wd;
}

float waterLandAt(vec2 uv) {
  return texture2D(uWaterData, clamp(uv, 0.0, 1.0)).b;
}

vec4 waterGlowSample(vec2 rawUv, float radius) {
  vec2 px = uWaterTexel * radius;
  vec4 sum = waterSample(rawUv) * 0.24;
  sum += waterSample(rawUv + vec2( px.x, 0.0)) * 0.12;
  sum += waterSample(rawUv + vec2(-px.x, 0.0)) * 0.12;
  sum += waterSample(rawUv + vec2(0.0,  px.y)) * 0.12;
  sum += waterSample(rawUv + vec2(0.0, -px.y)) * 0.12;
  sum += waterSample(rawUv + vec2( px.x,  px.y) * 0.72) * 0.07;
  sum += waterSample(rawUv + vec2(-px.x,  px.y) * 0.72) * 0.07;
  sum += waterSample(rawUv + vec2( px.x, -px.y) * 0.72) * 0.07;
  sum += waterSample(rawUv + vec2(-px.x, -px.y) * 0.72) * 0.07;
  return sum;
}

float shoreProximity(vec2 uv, float width, float follow) {
  float tightReach = mix(6.5, 2.2, follow) * max(0.2, width);
  float broadReach = tightReach * mix(2.6, 1.55, follow);
  vec2 a = uWaterTexel * tightReach;
  vec2 b = uWaterTexel * broadReach;
  float tightMax = 0.0;
  float tightAvg = 0.0;
  float broadMax = 0.0;
  float broadAvg = 0.0;
  float s;
  s = waterLandAt(uv + vec2( a.x, 0.0)); tightMax = max(tightMax, s); tightAvg += s;
  s = waterLandAt(uv + vec2(-a.x, 0.0)); tightMax = max(tightMax, s); tightAvg += s;
  s = waterLandAt(uv + vec2(0.0,  a.y)); tightMax = max(tightMax, s); tightAvg += s;
  s = waterLandAt(uv + vec2(0.0, -a.y)); tightMax = max(tightMax, s); tightAvg += s;
  s = waterLandAt(uv + vec2( a.x,  a.y) * 0.72); tightMax = max(tightMax, s); tightAvg += s;
  s = waterLandAt(uv + vec2(-a.x,  a.y) * 0.72); tightMax = max(tightMax, s); tightAvg += s;
  s = waterLandAt(uv + vec2( a.x, -a.y) * 0.72); tightMax = max(tightMax, s); tightAvg += s;
  s = waterLandAt(uv + vec2(-a.x, -a.y) * 0.72); tightMax = max(tightMax, s); tightAvg += s;
  s = waterLandAt(uv + vec2( b.x, 0.0)); broadMax = max(broadMax, s); broadAvg += s;
  s = waterLandAt(uv + vec2(-b.x, 0.0)); broadMax = max(broadMax, s); broadAvg += s;
  s = waterLandAt(uv + vec2(0.0,  b.y)); broadMax = max(broadMax, s); broadAvg += s;
  s = waterLandAt(uv + vec2(0.0, -b.y)); broadMax = max(broadMax, s); broadAvg += s;
  s = waterLandAt(uv + vec2( b.x,  b.y) * 0.68); broadMax = max(broadMax, s); broadAvg += s;
  s = waterLandAt(uv + vec2(-b.x,  b.y) * 0.68); broadMax = max(broadMax, s); broadAvg += s;
  s = waterLandAt(uv + vec2( b.x, -b.y) * 0.68); broadMax = max(broadMax, s); broadAvg += s;
  s = waterLandAt(uv + vec2(-b.x, -b.y) * 0.68); broadMax = max(broadMax, s); broadAvg += s;
  float tight = mix(tightAvg * 0.24, tightMax, follow * 0.55);
  float broad = mix(broadAvg * 0.23, broadMax, follow * 0.35) * (1.0 - follow * 0.35);
  return smoothstep(0.03, 0.72, clamp(max(tight, broad), 0.0, 1.0));
}
`)
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
  float waterNormalGate = step(3.5, uStage);
  float normalPatchRole = clamp(vPatchRole, 0.0, 1.0);
  float waterNormalHeightMul = mix(1.0, max(0.0, uLodHeightMul), normalPatchRole);
  float waterNormalScaleMul = mix(1.0, max(0.05, uLodScaleMul), normalPatchRole);
  float waterNormalSpeedMul = mix(1.0, max(0.0, uLodSpeedMul), normalPatchRole);
  float waterNormalChopBoost = mix(0.0, uLodChopBoost, normalPatchRole);
  float waterNormalBoost = mix(1.0, max(0.0, uLodNormalBoost), normalPatchRole);
  vec3 waterWorldNormal = waterWaveNormal(vWaterXZ, max(0.0, uGlintSpeed) * waterNormalSpeedMul, max(0.05, uGlintScale) * waterNormalScaleMul, waterNormalHeightMul, waterNormalChopBoost);
  vec3 waterViewNormal = normalize((viewMatrix * vec4(waterWorldNormal, 0.0)).xyz);
  normal = normalize(mix(normal, waterViewNormal, waterNormalGate * clamp(uNormalStrength * waterNormalBoost, 0.0, 4.0) * uLayerGlint));
`)
        .replace('#include <color_fragment>', `#include <color_fragment>
  vec2 rawWaterUv = vWaterXZ / max(1.0, uWaterWorldSize) + 0.5;
  float detailGate = step(3.5, uStage);
  float distortGate = step(4.5, uStage);
  float waterPatchRole = clamp(vPatchRole, 0.0, 1.0);
  float patchScaleMul = mix(1.0, max(0.05, uLodScaleMul), waterPatchRole);
  float patchSpeedMul = mix(1.0, max(0.0, uLodSpeedMul), waterPatchRole);
  float patchHeightMul = mix(1.0, max(0.0, uLodHeightMul), waterPatchRole);
  float patchDetailBoost = mix(1.0, max(0.0, uLodDetailBoost), waterPatchRole);
  mat2 basis = waveRot(uWaveRotation);
  vec2 detailXZ = basis * vWaterXZ;
  vec2 dirA = normalize(basis * vec2(1.0, 0.33));
  vec2 dirB = normalize(waveRot(uWaveRotation + 71.0) * vec2(-0.25, 1.0));
  vec2 dirC = normalize(waveRot(uWaveRotation - 38.0) * vec2(0.62, -1.0));
  float t = uTime * uWaveSpeed * patchSpeedMul;
  float waveFreq = max(0.0001, uWaveScale) * patchScaleMul;
  float broadRaw = wnoise(detailXZ * waveFreq * 2.1 + dirA * t * 0.72);
  float fineRaw = wnoise(detailXZ * waveFreq * 8.5 - dirB * t * 0.48);
  float chaosRaw = wnoise((waveRot(uWaveRotation + uExtraDetailRotation) * vWaterXZ) * waveFreq * max(0.05, uExtraDetailScale) + dirC * t * uExtraDetailSpeed);
  float chaos = clamp((chaosRaw - 0.5) * max(0.01, uExtraDetailContrast) + 0.5 + uExtraDetailBias, 0.0, 1.0);
  chaos = pow(chaos, max(0.1, uExtraDetailSharp));
  float broad = mix(0.5, broadRaw, uLayerBroad);
  float fine = mix(0.5, fineRaw, uLayerFine);
  float chaosLayer = mix(0.5, chaos, uLayerChaos * uExtraDetailOpacity);
  vec2 distort = (vec2(broad, fine) - 0.5 + (chaosLayer - 0.5) * uExtraDetailDistort) * uRefractionStrength * distortGate;
  vec4 waterData = waterSample(rawWaterUv + distort);
  float depth = waterData.r;
  float channel = waterData.g;
  float land = waterData.b;
  float waterMask = mix(1.0, 1.0 - smoothstep(0.14, 0.82, land), clamp(uLandMask, 0.0, 1.0));
  float clear = smoothstep(0.0, 0.2, depth);
  float glowWidth = max(0.2, uShoreGlowWidth);
  float glowFollow = clamp(uShoreGlowFollow, 0.0, 1.0);
  float glowBlur = mix(1.4, 9.5, clamp(uShoreGlowSoftness, 0.0, 1.0)) * mix(0.7, 1.35, clamp(glowWidth / 10.0, 0.0, 1.0));
  vec4 glowData = waterGlowSample(rawWaterUv + distort * 0.35, glowBlur);
  float glowDepth = glowData.r;
  float glowLand = glowData.b;
  float glowWaterMask = mix(1.0, 1.0 - smoothstep(0.10, 0.78, glowLand), clamp(uLandMask, 0.0, 1.0)) * glowData.a;
  float glowIslandGate = 1.0 - smoothstep(uIslandRadius * 1.03, uIslandRadius * 1.36, length(vWaterXZ));

  vec3 surfaceColor = vec3(0.10, 0.58, 0.66);
  vec3 shallowColor = vec3(0.08, 0.86, 0.93);
  vec3 midColor = vec3(0.02, 0.36, 0.45);
  vec3 deepColor = vec3(0.004, 0.055, 0.10);
  vec3 lagoonColor = vec3(0.13, 0.92, 0.84);
  vec3 depthColor = mix(shallowColor, midColor, smoothstep(0.02, 0.45, depth));
  depthColor = mix(depthColor, deepColor, smoothstep(0.36, 1.0, depth));
  depthColor = mix(depthColor, lagoonColor, clamp(channel * uLagoonTint, 0.0, 1.0));
  float nearShore = shoreProximity(rawWaterUv, glowWidth, glowFollow);
  float glowDepthReach = mix(0.09, 0.36, clamp(glowWidth / 10.0, 0.0, 1.0));
  float shallowGate = 1.0 - smoothstep(0.035, glowDepthReach, glowDepth);
  float shoreMask = pow(clamp(nearShore * shallowGate, 0.0, 1.0), max(0.25, uShoreGlowFalloff * 0.34)) * glowWaterMask * glowIslandGate;
  float shoreNoise = wnoise(vWaterXZ * 0.035 + vec2(uTime * 0.055, -uTime * 0.035));
  float causticA = seaOctave(vWaterXZ * 0.018 + vec2(uTime * 0.035, -uTime * 0.022), 1.2);
  float causticB = wnoise(vWaterXZ * 0.057 + vec2(-uTime * 0.045, uTime * 0.030));
  float caustic = mix(1.0, 0.55 + smoothstep(0.46, 1.08, causticA * 0.78 + causticB * 0.44) * 1.25, clamp(uShoreGlowCaustic, 0.0, 4.0) * 0.25);
  float shorePulse = 0.80 + 0.20 * sin(uTime * 0.9 + shoreNoise * 6.2831);
  float glowGain = max(0.0, uShoreGlowIntensity);
  float substrateGain = pow(max(0.0, uShoreGlowSubstrate), 0.62);
  float surfaceGain = max(0.0, uShoreGlowSurface);
  float overdrive = smoothstep(1.0, 10.0, glowGain);
  float shoreEnergy = max(0.0, uShoreGlow) * glowGain * shoreMask * shorePulse * caustic;
  float substrateDarkGate = 1.0 - smoothstep(0.16, 0.58, dot(depthColor, vec3(0.2126, 0.7152, 0.0722)));
  vec3 shoreDeep = vec3(0.0, 0.18, 0.25);
  vec3 shoreCyan = vec3(0.0, 0.62, 0.76);
  vec3 bioGlow = mix(shoreDeep, shoreCyan, shallowGate);
  depthColor += bioGlow * shoreEnergy * substrateGain * mix(0.75, 2.35, substrateDarkGate);

  float depthGate = step(1.5, uStage);
  float colorGate = step(5.5, uStage);
  vec3 waterColor = mix(surfaceColor, mix(surfaceColor, depthColor, clamp(0.22 + uDepthTint * 0.62, 0.0, 0.95)), depthGate);
  waterColor = mix(waterColor, depthColor, colorGate);
  float waterDarkGate = 1.0 - smoothstep(0.18, 0.62, dot(waterColor, vec3(0.2126, 0.7152, 0.0722)));
  float nightGlowBoost = mix(1.0, 2.6, waterDarkGate);
  vec3 surfaceBio = mix(vec3(0.0, 0.22, 0.30), vec3(0.0, 0.78, 0.90), waterDarkGate);
  waterColor += surfaceBio * shoreEnergy * surfaceGain * nightGlowBoost * mix(0.34, 1.45, waterDarkGate);
  waterColor += vec3(0.0, 0.42, 0.50) * shoreMask * max(0.0, uShoreGlow) * overdrive * (surfaceGain + substrateGain * 0.35) * waterDarkGate * 0.85;

  float waveVis = clamp(vWaterWave / max(0.001, uWaveHeight * patchHeightMul * 2.4), 0.0, 1.0);
  float detail = mix(broad, fine, clamp(uDetailMix, 0.0, 1.0));
  detail = clamp((detail - 0.5) * patchDetailBoost + 0.5, 0.0, 1.0);
  float chaosMix = clamp(uExtraDetailMix * uLayerChaos, 0.0, 2.0);
  detail = mix(detail, chaosLayer, clamp(chaosMix, 0.0, 1.0));
  detail = clamp(detail + (chaosLayer - 0.5) * max(0.0, chaosMix - 1.0), 0.0, 1.0);
  float crest = smoothstep(0.56, 0.95, max(waveVis, detail * 0.8));
  waterColor += vec3(0.08, 0.16, 0.15) * crest * detailGate * clear;
  vec3 chaosTint = mix(vec3(-0.08, 0.02, 0.03), vec3(0.16, 0.24, 0.22), clamp(uExtraDetailTint, 0.0, 1.0));
  waterColor += chaosTint * (chaosLayer - 0.5) * uExtraDetailMix * detailGate * clear;

  float alpha = clamp(mix(0.16, uSurfaceAlpha, smoothstep(0.04, 0.9, depth)), 0.03, 1.0) * waterMask;
  vec3 dbgNormal = waterWaveNormal(vWaterXZ, max(0.0, uGlintSpeed) * patchSpeedMul, max(0.05, uGlintScale) * patchScaleMul, patchHeightMul, mix(0.0, uLodChopBoost, waterPatchRole));

  if (uDebugView > 0.5) {
    float mode = floor(uDebugView + 0.5);
    if (mode == 1.0) waterColor = vec3(depth);
    if (mode == 2.0) waterColor = vec3(0.0, channel, channel);
    if (mode == 3.0) waterColor = vec3(waveVis, detail, crest);
    if (mode == 4.0) waterColor = dbgNormal * 0.5 + 0.5;
    if (mode == 5.0) waterColor = vec3(land, 0.0, 1.0 - land);
    if (mode == 6.0) waterColor = vec3(chaosLayer);
    if (mode == 7.0) waterColor = vec3(shoreMask, nearShore, shallowGate);
    alpha = mix(0.18, 0.9, max(max(waterColor.r, waterColor.g), waterColor.b)) * waterMask;
  }

  vec2 lodVec = mix(vWaterWorld.xz - uCamPos.xz, vPatchLocal, step(0.5, waterPatchRole));
  float lodHalf = max(1.0, uLodSize * 0.5);
  vec2 lodUv = lodVec / lodHalf;
  float lodDist = length(lodUv);
  float lodAngle = atan(lodUv.y, lodUv.x);
  float lodLobes = max(0.0, uLodLobes);
  float lobeAmp = 0.13 * step(0.5, lodLobes);
  float lodLobe = 1.0 + lobeAmp * sin(lodAngle * max(1.0, lodLobes) + uTime * 0.18);
  float lodEdge0 = clamp(1.0 - uLodFeather, 0.02, 0.98) * lodLobe;
  float lodMask = 1.0 - smoothstep(lodEdge0, lodLobe, lodDist);
  if (waterPatchRole > 0.5) {
    alpha *= lodMask * clamp(uLodAlpha, 0.0, 1.0);
  } else if (uLodEnabled > 0.5) {
    alpha *= mix(1.0, 1.0 - lodMask, clamp(uLodSuppress, 0.0, 1.0));
  }

  diffuseColor.rgb = waterColor;
  diffuseColor.a = alpha;
`)
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
  float horizonFade = smoothstep(uF0, uF1, length(vWaterXZ));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uHorizon, horizonFade);
  gl_FragColor.a = mix(gl_FragColor.a, 0.0, horizonFade * horizonFade);
`);
    };

    this.surface = new THREE.Mesh(markPatchRole(new THREE.PlaneGeometry(radius * 2, radius * 2, 320, 320), 0), this.surfaceMat);
    this.surface.rotation.x = -Math.PI / 2;
    this.surface.renderOrder = 4;
    this.group.add(this.surface);
    this._surfaceRadius = radius;
    this._baseSegments = 320;
    this._lodSize = 820;
    this._lodSegments = 180;
    this._lodLift = 0.05;
    this.lodSurface = new THREE.Mesh(markPatchRole(new THREE.PlaneGeometry(this._lodSize, this._lodSize, this._lodSegments, this._lodSegments), 1), this.surfaceMat);
    this.lodSurface.rotation.x = -Math.PI / 2;
    this.lodSurface.renderOrder = 5;
    this.lodSurface.visible = false;
    this.group.add(this.lodSurface);

    this.setLevel(params.seaLevel);
    this.setStyle(params);
    this.setEnabled(this._enabled);
  }

  setEnabled(on) {
    this._enabled = on !== false;
    this.group.visible = this._enabled;
    this._syncLodVisibility();
  }

  setLevel(y) {
    this._seaLevel = y;
    this.surface.position.y = y + this._surfaceLift;
    this.lodSurface.position.y = y + this._surfaceLift + this._lodLift;
  }

  setStyle(params = {}) {
    if (params.surfaceLift !== undefined) {
      this._surfaceLift = THREE.MathUtils.clamp(params.surfaceLift, -1, 2);
      this.setLevel(this._seaLevel);
    }
    syncShoreGlowUniforms(this._floorUniforms, params);
    if (!this._uniforms) return;
    this._uniforms.uStage.value = THREE.MathUtils.clamp(params.surfaceStage ?? params.tutorialStage ?? 5, 3, 5);
    this._uniforms.uSurfaceAlpha.value = THREE.MathUtils.clamp(params.surfaceOpacity ?? 0.55, 0.02, 1);
    this._uniforms.uDepthTint.value = THREE.MathUtils.clamp(params.depthTint ?? 0.78, 0, 1.5);
    this._uniforms.uWaveHeight.value = Math.max(0, params.waveHeight ?? 1.92);
    this._uniforms.uWaveScale.value = Math.max(0.0001, params.waveScale ?? 0.0275);
    this._uniforms.uWaveSpeed.value = Math.max(0, params.waveSpeed ?? 2.7);
    this._uniforms.uGlintSpeed.value = Math.max(0, params.glintSpeed ?? 3.5);
    this._uniforms.uGlintScale.value = Math.max(0.05, params.glintScale ?? 1.34);
    this._uniforms.uWaveChoppy.value = Math.max(0.5, params.waveChoppy ?? 5.95);
    this._uniforms.uWaveRotation.value = params.waveRotation ?? 143;
    this._uniforms.uExtraDetailMix.value = THREE.MathUtils.clamp(params.extraDetailMix ?? 0, 0, 2);
    this._uniforms.uExtraDetailOpacity.value = THREE.MathUtils.clamp(params.extraDetailOpacity ?? 1, 0, 1);
    this._uniforms.uExtraDetailScale.value = Math.max(0.05, params.extraDetailScale ?? 2.4);
    this._uniforms.uExtraDetailSpeed.value = params.extraDetailSpeed ?? 0.7;
    this._uniforms.uExtraDetailRotation.value = params.extraDetailRotation ?? 119;
    this._uniforms.uExtraDetailContrast.value = Math.max(0.01, params.extraDetailContrast ?? 1.4);
    this._uniforms.uExtraDetailBias.value = THREE.MathUtils.clamp(params.extraDetailBias ?? 0, -1, 1);
    this._uniforms.uExtraDetailSharp.value = Math.max(0.1, params.extraDetailSharp ?? 1);
    this._uniforms.uExtraDetailTint.value = THREE.MathUtils.clamp(params.extraDetailTint ?? 0.55, 0, 1);
    this._uniforms.uExtraDetailDistort.value = Math.max(0, params.extraDetailDistort ?? 0.25);
    this._uniforms.uDetailMix.value = THREE.MathUtils.clamp(params.detailMix ?? 0.42, 0, 1);
    this._uniforms.uNormalStrength.value = THREE.MathUtils.clamp(params.normalStrength ?? 0.4, 0, 2);
    this._uniforms.uRefractionStrength.value = THREE.MathUtils.clamp(params.refractionStrength ?? 0.18, 0, 0.7);
    this._uniforms.uLagoonTint.value = Math.max(0, params.lagoonTint ?? 0.18);
    syncShoreGlowUniforms(this._uniforms, params);
    this._uniforms.uLandMask.value = THREE.MathUtils.clamp(params.landMask ?? 1, 0, 1);
    this._uniforms.uDebugView.value = THREE.MathUtils.clamp(params.debugView ?? 0, 0, 7);
    const weights = this._layerWeights(params);
    this._uniforms.uLayerVertex.value = weights.vertex;
    this._uniforms.uLayerBroad.value = weights.broad;
    this._uniforms.uLayerFine.value = weights.fine;
    this._uniforms.uLayerGlint.value = weights.glint;
    this._uniforms.uLayerChaos.value = weights.chaos;

    const baseSegments = THREE.MathUtils.clamp(Math.round(params.baseSegments ?? 320), 80, 520);
    if (baseSegments !== this._baseSegments) {
      this._baseSegments = baseSegments;
      this.surface.geometry.dispose();
      this.surface.geometry = markPatchRole(new THREE.PlaneGeometry(this._surfaceRadius * 2, this._surfaceRadius * 2, this._baseSegments, this._baseSegments), 0);
    }
    const nextLodSize = THREE.MathUtils.clamp(params.patchSize ?? 820, 120, 2400);
    const nextLodSegments = THREE.MathUtils.clamp(Math.round(params.patchSegments ?? 180), 24, 420);
    if (nextLodSize !== this._lodSize || nextLodSegments !== this._lodSegments) {
      this._lodSize = nextLodSize;
      this._lodSegments = nextLodSegments;
      this.lodSurface.geometry.dispose();
      this.lodSurface.geometry = markPatchRole(new THREE.PlaneGeometry(this._lodSize, this._lodSize, this._lodSegments, this._lodSegments), 1);
    }
    this._lodEnabled = !!params.nearPatch;
    this._lodSolo = !!params.patchSolo;
    this._lodLift = THREE.MathUtils.clamp(params.patchLift ?? 0.05, 0, 0.4);
    this._uniforms.uLodEnabled.value = this._lodEnabled ? 1 : 0;
    this._uniforms.uLodSize.value = this._lodSize;
    this._uniforms.uLodFeather.value = THREE.MathUtils.clamp(params.patchFeather ?? 0.38, 0.02, 0.9);
    this._uniforms.uLodLobes.value = Math.max(0, params.patchLobes ?? 5);
    this._uniforms.uLodAlpha.value = THREE.MathUtils.clamp(params.patchAlpha ?? 0.9, 0, 1);
    this._uniforms.uLodSuppress.value = THREE.MathUtils.clamp(params.patchSuppress ?? 0.82, 0, 1);
    this._uniforms.uLodHeightMul.value = THREE.MathUtils.clamp(params.patchHeightMul ?? 3.5, 0, 10);
    this._uniforms.uLodScaleMul.value = THREE.MathUtils.clamp(params.patchScaleMul ?? 2.4, 0.05, 24);
    this._uniforms.uLodSpeedMul.value = THREE.MathUtils.clamp(params.patchSpeedMul ?? 1.15, 0, 8);
    this._uniforms.uLodChopBoost.value = THREE.MathUtils.clamp(params.patchChopBoost ?? 1.1, 0, 8);
    this._uniforms.uLodDetailBoost.value = THREE.MathUtils.clamp(params.patchDetailBoost ?? 1.35, 0, 8);
    this._uniforms.uLodNormalBoost.value = THREE.MathUtils.clamp(params.patchNormalBoost ?? 1.6, 0, 8);
    this.setLevel(this._seaLevel);
    this._syncLodVisibility();
  }

  _layerWeights(params = {}) {
    const names = ['Vertex', 'Broad', 'Fine', 'Glint', 'Chaos'];
    const anySolo = names.some((name) => !!params[`solo${name}`]);
    const value = (name) => {
      if (anySolo) return params[`solo${name}`] ? 1 : 0;
      return params[`mute${name}`] ? 0 : 1;
    };
    return {
      vertex: value('Vertex'),
      broad: value('Broad'),
      fine: value('Fine'),
      glint: value('Glint'),
      chaos: value('Chaos'),
    };
  }

  _syncLodVisibility() {
    if (!this.surface || !this.lodSurface) return;
    this.surface.visible = this._enabled && !(this._lodEnabled && this._lodSolo);
    this.lodSurface.visible = this._enabled && !!this._lodEnabled;
  }

  setCaustic() {}

  setHorizon(color) {
    this._horizon.copy(color);
    this.floor.material.color.copy(color).lerp(new THREE.Color('#062a36'), 0.72);
  }

  setSun(dir, color) {
    this._sunDir.copy(dir).normalize();
    this._sunCol.copy(color);
  }

  setGlint() {}

  getWaterGlowSource() {
    return {
      texture: this._waterData,
      texel: this._waterTexel,
      worldSize: this._waterWorldSize,
    };
  }

  update(elapsed, camPos) {
    if (this._floorUniforms) this._floorUniforms.uTime.value = elapsed;
    if (!this._uniforms) return;
    this._uniforms.uTime.value = elapsed;
    if (camPos) {
      this._uniforms.uCamPos.value.copy(camPos);
      if (this._lodEnabled) {
        this.lodSurface.position.x = camPos.x;
        this.lodSurface.position.z = camPos.z;
      }
    }
  }
}
