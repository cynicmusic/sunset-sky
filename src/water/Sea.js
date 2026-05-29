// Sea surface.
//   · translucent surface plane extends past the island so the bounded edge
//     dissolves into the atmosphere's horizon haze (PLAN.md §9).

import * as THREE from 'three';

function makeWaterDataTexture(volume, seaLevel, floorDepth) {
  const res = volume?.res || 1;
  const data = new Uint8Array(res * res * 4);
  const maxDepth = Math.max(1, floorDepth || volume?.meta?.floorDepth || 64);
  if (!volume?.heightVox) {
    const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  }
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
  const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export class Sea {
  constructor(params) {
    this.group = new THREE.Group();
    this.group.name = 'Sea';
    // Sea must reach far past the island so its edge is always buried in fog
    // (PLAN §9) — no visible square, no "floating quad".
    // Sea reaches far past the fog-opaque distance so its geometric edge is
    // never visible regardless of FOV (the "main square at the horizon").
    // CIRCULAR discs (no corners) reaching far past the fog-opaque distance,
    // so there is no square edge at any FOV/altitude.
    const R = Math.max(params.worldSize * 12, 26000) * 0.5;
    const floorY = params.seaLevel - (params.floorDepth || 60) - 10;
    this._horizon = new THREE.Color('#bcd4d6');

    this.floor = new THREE.Mesh(
      new THREE.CircleGeometry(R, 96),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#0b4f68'), fog: true }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = floorY;
    this.floor.renderOrder = 1;
    this.group.add(this.floor);

    // Translucent surface; its outer ring fades (colour → live sky-horizon,
    // alpha → 0) so the ocean dissolves into the ACTUAL sunset every frame
    // regardless of brightness — not a fixed edge tint.
    this._enabled = params.enable !== false;
    this._seaLevel = params.seaLevel;
    this._surfaceLift = params.surfaceLift ?? 0.08;
    this._waterData = makeWaterDataTexture(params.volume, params.seaLevel, params.floorDepth);
    this.surfaceMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#1f93a4'),
      transparent: true,
      opacity: 1,
      depthWrite: false,
      roughness: 0.24,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    this.surfaceMat.forceSinglePass = true;
    const fade0 = params.radius * 1.4, fade1 = R * 0.96;
    // Analytic sun-glint: a stretched specular streak where the sun reflects
    // off the flat water plane. Pure in-shader (no extra pass) — mobile-cheap.
    this._sunDir = new THREE.Vector3(0, 1, 0);
    this._sunCol = new THREE.Color('#fff3df');
    this.surfaceMat.onBeforeCompile = (sh) => {
      sh.uniforms.uHorizon = { value: this._horizon };
      sh.uniforms.uF0 = { value: fade0 };
      sh.uniforms.uF1 = { value: fade1 };
      sh.uniforms.uSunDir = { value: this._sunDir };
      sh.uniforms.uSunCol = { value: this._sunCol };
      sh.uniforms.uGlint = { value: 0.7 };
      sh.uniforms.uGlintSpread = { value: 1.1 };
      sh.uniforms.uSurfaceSpecular = { value: 1 };
      sh.uniforms.uCamPos = { value: new THREE.Vector3() };
      sh.uniforms.uTime = { value: 0 };
      sh.uniforms.uWaterData = { value: this._waterData };
      sh.uniforms.uWaterWorldSize = { value: params.worldSize || params.radius * 2.3 };
      sh.uniforms.uStage = { value: params.surfaceStage ?? 5 };
      sh.uniforms.uSurfaceAlpha = { value: params.surfaceOpacity ?? 0.55 };
      sh.uniforms.uDepthTint = { value: params.depthTint ?? 0.78 };
      sh.uniforms.uWaveHeight = { value: params.waveHeight ?? 1.92 };
      sh.uniforms.uWaveScale = { value: params.waveScale ?? 0.0275 };
      sh.uniforms.uWaveRotation = { value: params.waveRotation ?? 143 };
      sh.uniforms.uDetailMix = { value: params.detailMix ?? 0.42 };
      sh.uniforms.uWaveSpeed = { value: params.waveSpeed ?? 2.7 };
      sh.uniforms.uGlintSpeed = { value: params.glintSpeed ?? 3.5 };
      sh.uniforms.uGlintScale = { value: params.glintScale ?? 1.34 };
      sh.uniforms.uWaveChoppy = { value: params.waveChoppy ?? 5.95 };
      sh.uniforms.uNormalStrength = { value: params.normalStrength ?? 0.4 };
      sh.uniforms.uRefractionStrength = { value: params.refractionStrength ?? 0.18 };
      sh.uniforms.uLagoonTint = { value: params.lagoonTint ?? 0.18 };
      sh.uniforms.uLandMask = { value: params.landMask ?? 1 };
      sh.uniforms.uDebugView = { value: params.debugView ?? 0 };
      this._surfUniforms = sh.uniforms;

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
float waterHash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float waterNoise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); vec2 u=f*f*(3.0-2.0*f); return mix(mix(waterHash(i),waterHash(i+vec2(1.0,0.0)),u.x),mix(waterHash(i+vec2(0.0,1.0)),waterHash(i+vec2(1.0,1.0)),u.x),u.y); }
float waterOctave(vec2 uv,float choppy){ uv+=waterNoise(uv); vec2 wv=1.0-abs(sin(uv)); vec2 swv=abs(cos(uv)); wv=mix(wv,swv,wv); return pow(1.0-pow(clamp(wv.x*wv.y,0.0,1.0),0.65),max(0.5,choppy)); }
mat2 waterRot(float deg){ float a=radians(deg); float c=cos(a); float s=sin(a); return mat2(c,-s,s,c); }
float waterHeightAt(vec2 xz,float speedMul,float scaleMul){
  float freq=max(0.0001,uWaveScale*max(0.05,scaleMul));
  float amp=uWaveHeight;
  float chop=max(0.5,uWaveChoppy);
  float t=uTime*uWaveSpeed*max(0.0,speedMul);
  vec2 uv=waterRot(uWaveRotation)*xz;
  uv.x*=0.75;
  float h=0.0;
  mat2 octaveM=mat2(1.6,1.2,-1.2,1.6);
  for(int i=0;i<3;i++){
    float d=waterOctave((uv+vec2(t,t*0.63))*freq,chop)+waterOctave((uv-vec2(t*0.34,t))*freq,chop);
    h+=(d-1.0)*amp;
    uv=octaveM*uv;
    freq*=1.9;
    amp*=0.22;
    chop=mix(chop,1.0,0.2);
  }
  return h;
}
float waterHeight(vec2 xz){ return waterHeightAt(xz,1.0,1.0); }
vec3 waterWaveNormal(vec2 xz,float speedMul,float scaleMul){
  float eps=max(1.0,0.012/max(0.0001,uWaveScale*max(0.05,scaleMul)));
  float h0=waterHeightAt(xz,speedMul,scaleMul);
  float hx=waterHeightAt(xz+vec2(eps,0.0),speedMul,scaleMul);
  float hz=waterHeightAt(xz+vec2(0.0,eps),speedMul,scaleMul);
  return normalize(vec3(-(hx-h0)/eps,1.0,-(hz-h0)/eps));
}
`;

      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
${waterCommon}
varying vec2 vWXZ;
varying vec3 vWPos;
varying float vWave;
`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
  vec4 waterPreWorld = modelMatrix * vec4(transformed, 1.0);
  float waterWaveGate = step(2.5, uStage);
  float waterWave = waterHeight(waterPreWorld.xz) * waterWaveGate;
  transformed.z += waterWave;
  vec4 waterWorld = modelMatrix * vec4(transformed, 1.0);
  vWXZ = waterWorld.xz;
  vWPos = waterWorld.xyz;
  vWave = waterWave;
`);

      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
${waterCommon}
varying vec2 vWXZ;
varying vec3 vWPos;
varying float vWave;
uniform vec3 uHorizon;
uniform float uF0;
uniform float uF1;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform float uGlint;
uniform float uGlintSpread;
uniform float uSurfaceSpecular;
uniform vec3 uCamPos;
uniform sampler2D uWaterData;
uniform float uWaterWorldSize;
uniform float uSurfaceAlpha;
uniform float uDepthTint;
uniform float uDetailMix;
uniform float uNormalStrength;
uniform float uRefractionStrength;
uniform float uLagoonTint;
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
`)
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
  float waterNormalGate = step(3.5, uStage);
  vec3 waterWorldNormal = waterWaveNormal(vWXZ, max(0.0, uGlintSpeed), max(0.05, uGlintScale));
  vec3 waterViewNormal = normalize((viewMatrix * vec4(waterWorldNormal, 0.0)).xyz);
  normal = normalize(mix(normal, waterViewNormal, waterNormalGate * clamp(uNormalStrength, 0.0, 2.0)));
`)
        .replace('#include <color_fragment>', `#include <color_fragment>
  vec2 rawWaterUv = vWXZ / max(1.0, uWaterWorldSize) + 0.5;
  float detailGate = step(3.5, uStage);
  float distortGate = step(4.5, uStage);
  mat2 basis = waterRot(uWaveRotation);
  vec2 detailXZ = basis * vWXZ;
  vec2 dirA = normalize(basis * vec2(1.0, 0.33));
  vec2 dirB = normalize(waterRot(uWaveRotation + 71.0) * vec2(-0.25, 1.0));
  float t = uTime * uWaveSpeed;
  float broad = waterNoise(detailXZ * max(0.0001, uWaveScale) * 2.1 + dirA * t * 0.72);
  float fine = waterNoise(detailXZ * max(0.0001, uWaveScale) * 8.5 - dirB * t * 0.48);
  vec2 distort = (vec2(broad, fine) - 0.5) * uRefractionStrength * distortGate;
  vec4 waterData = waterSample(rawWaterUv + distort);
  float depth = waterData.r;
  float channel = waterData.g;
  float land = waterData.b;
  float waterMask = mix(1.0, 1.0 - smoothstep(0.14, 0.82, land), clamp(uLandMask, 0.0, 1.0));
  float clear = smoothstep(0.0, 0.2, depth);
  vec3 surfaceColor = vec3(0.10, 0.58, 0.66);
  vec3 shallowColor = vec3(0.08, 0.86, 0.93);
  vec3 midColor = vec3(0.02, 0.36, 0.45);
  vec3 deepColor = vec3(0.004, 0.055, 0.10);
  vec3 lagoonColor = vec3(0.13, 0.92, 0.84);
  vec3 depthColor = mix(shallowColor, midColor, smoothstep(0.02, 0.45, depth));
  depthColor = mix(depthColor, deepColor, smoothstep(0.36, 1.0, depth));
  depthColor = mix(depthColor, lagoonColor, clamp(channel * uLagoonTint, 0.0, 1.0));
  vec3 waterColor = mix(surfaceColor, depthColor, clamp(0.22 + uDepthTint * 0.62, 0.0, 0.95));
  float waveVis = clamp(vWave / max(0.001, uWaveHeight * 2.4), 0.0, 1.0);
  float detail = mix(broad, fine, clamp(uDetailMix, 0.0, 1.0));
  float crest = smoothstep(0.56, 0.95, max(waveVis, detail * 0.8));
  waterColor += vec3(0.08, 0.16, 0.15) * crest * detailGate * clear;
  float alpha = clamp(mix(0.16, uSurfaceAlpha, smoothstep(0.04, 0.9, depth)), 0.03, 1.0) * waterMask;
  vec3 dbgNormal = waterWaveNormal(vWXZ, max(0.0, uGlintSpeed), max(0.05, uGlintScale));
  if (uDebugView > 0.5) {
    float mode = floor(uDebugView + 0.5);
    if (mode == 1.0) waterColor = vec3(depth);
    if (mode == 2.0) waterColor = vec3(0.0, channel, channel);
    if (mode == 3.0) waterColor = vec3(waveVis, detail, crest);
    if (mode == 4.0) waterColor = dbgNormal * 0.5 + 0.5;
    if (mode == 5.0) waterColor = vec3(land, 0.0, 1.0 - land);
    alpha = mix(0.18, 0.9, max(max(waterColor.r, waterColor.g), waterColor.b)) * waterMask;
  }
  diffuseColor.rgb = waterColor;
  diffuseColor.a = alpha;
`)
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
  vec3 waterView = normalize(uCamPos - vWPos);
  vec3 waterGlintNormal = normalize(mix(vec3(0.0, 1.0, 0.0), waterWaveNormal(vWXZ, max(0.0, uGlintSpeed), max(0.05, uGlintScale)), step(3.5, uStage) * clamp(uNormalStrength, 0.0, 2.0)));
  float waterSpec = max(dot(reflect(-uSunDir, waterGlintNormal), waterView), 0.0);
  float waterSpread = clamp(uGlintSpread * 0.25, 0.0, 1.0);
  float waterCore = pow(waterSpec, mix(900.0, 70.0, waterSpread));
  float waterStreak = pow(waterSpec, mix(140.0, 14.0, waterSpread)) * 0.35;
  float waterGlint = (waterCore + waterStreak) * uGlint * uSurfaceSpecular * smoothstep(-0.02, 0.14, uSunDir.y);
  gl_FragColor.rgb += uSunCol * waterGlint;
  float waterFade = smoothstep(uF0, uF1, length(vWXZ));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uHorizon, waterFade);
  gl_FragColor.a = mix(gl_FragColor.a, 0.0, waterFade * waterFade);
`);
    };
    this.surface = new THREE.Mesh(new THREE.PlaneGeometry(R * 2, R * 2, 320, 320), this.surfaceMat);
    this.surface.rotation.x = -Math.PI / 2;
    this.surface.renderOrder = 4;
    this.group.add(this.surface);

    this.setLevel(params.seaLevel);
    this.setStyle(params);
    this.setEnabled(this._enabled);
  }

  setLevel(y) {
    this._seaLevel = y;
    this.surface.position.y = y + this._surfaceLift;
  }
  setEnabled(on) {
    this._enabled = on !== false;
    this.group.visible = this._enabled;
  }
  setCaustic() {}
  setStyle(params = {}) {
    if (params.surfaceLift !== undefined) {
      this._surfaceLift = THREE.MathUtils.clamp(params.surfaceLift, -1, 2);
      this.setLevel(this._seaLevel);
    }
    if (!this._surfUniforms) return;
    this._surfUniforms.uStage.value = THREE.MathUtils.clamp(params.surfaceStage ?? 5, 3, 5);
    this._surfUniforms.uSurfaceAlpha.value = THREE.MathUtils.clamp(params.surfaceOpacity ?? 0.55, 0.02, 1);
    this._surfUniforms.uSurfaceSpecular.value = 1;
    this._surfUniforms.uDebugView.value = THREE.MathUtils.clamp(params.debugView ?? 0, 0, 5);
    this._surfUniforms.uLandMask.value = THREE.MathUtils.clamp(params.landMask ?? 1, 0, 1);
    this._surfUniforms.uDepthTint.value = THREE.MathUtils.clamp(params.depthTint ?? 0.78, 0, 1.5);
    this._surfUniforms.uWaveHeight.value = Math.max(0, params.waveHeight ?? 1.92);
    this._surfUniforms.uWaveScale.value = Math.max(0.0001, params.waveScale ?? 0.0275);
    this._surfUniforms.uWaveRotation.value = params.waveRotation ?? 143;
    this._surfUniforms.uDetailMix.value = THREE.MathUtils.clamp(params.detailMix ?? 0.42, 0, 1);
    this._surfUniforms.uWaveSpeed.value = Math.max(0, params.waveSpeed ?? 2.7);
    this._surfUniforms.uGlintSpeed.value = Math.max(0, params.glintSpeed ?? 3.5);
    this._surfUniforms.uGlintScale.value = Math.max(0.05, params.glintScale ?? 1.34);
    this._surfUniforms.uWaveChoppy.value = Math.max(0.5, params.waveChoppy ?? 5.95);
    this._surfUniforms.uNormalStrength.value = THREE.MathUtils.clamp(params.normalStrength ?? 0.4, 0, 2);
    this._surfUniforms.uRefractionStrength.value = THREE.MathUtils.clamp(params.refractionStrength ?? 0.18, 0, 0.7);
    this._surfUniforms.uLagoonTint.value = Math.max(0, params.lagoonTint ?? 0.18);
  }
  // Drive the sea's outer-ring fade colour from the live sky horizon (same
  // value the fog samples from the LUT) so the ocean meshes into the actual
  // sunset — bright or dark — instead of a fixed mismatched tint.
  setHorizon(color) {
    this._horizon.copy(color);
    if (this.floor) this.floor.material.color.copy(color).lerp(new THREE.Color('#0b4f68'), 0.6);
  }
  setSun(dir, color) {
    this._sunDir.copy(dir).normalize();
    this._sunCol.copy(color);
  }
  setGlint(intensity, spread) {
    if (!this._surfUniforms) return;
    this._surfUniforms.uGlint.value = Math.max(0, intensity);
    this._surfUniforms.uGlintSpread.value = Math.max(0.2, spread);
  }

  update(elapsed, camPos) {
    if (camPos && this._surfUniforms) this._surfUniforms.uCamPos.value.copy(camPos);
    if (this._surfUniforms) this._surfUniforms.uTime.value = elapsed;
  }
}
