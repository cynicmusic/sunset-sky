// Sky-View LUT (Hillaire §5.3). Ported verbatim from sunset.
// Lat/long texture aligned to the camera-local up vector; latitude is
// non-linearly warped so texels concentrate at the horizon.

import * as THREE from 'three';
import { PLANET, BETAS } from './constants.js';
import { COMMON_GLSL, HORIZON_WARP_GLSL, FULLSCREEN_VERT } from './shaderHelpers.js';

const FRAG = /* glsl */ `
varying vec2 vUv;

uniform vec3  uCameraPos;
uniform vec3  uSunDir;
uniform bool  uHorizonWarp;

uniform float uPlanetRadius;
uniform float uAtmosphereRadius;
uniform float uRayleighSH;
uniform vec3  uRayleighBeta;
uniform float uMieSH;
uniform float uMieBeta;
uniform float uMieBetaExt;
uniform float uMieG;
uniform bool  uMieOn;
uniform float uOzoneCenter;
uniform float uOzoneWidth;
uniform vec3  uOzoneBetaAbs;
uniform bool  uOzoneOn;
uniform float uSunIntensity;

uniform sampler2D uTransmittanceLUT;
uniform int  uMarchSteps;

${COMMON_GLSL}
${HORIZON_WARP_GLSL}

vec3 sampleTransmittance(vec3 p, vec3 lightDir) {
  vec2 uv = getTransmittanceLUTUv(p, lightDir, uPlanetRadius, uAtmosphereRadius);
  return texture2D(uTransmittanceLUT, uv).rgb;
}

vec3 getSkyViewForward(vec3 up) {
  vec3 projectedSun = uSunDir - up * dot(uSunDir, up);
  float lenSq = dot(projectedSun, projectedSun);
  if (lenSq < 1e-5) {
    vec3 axis = abs(up.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    projectedSun = cross(axis, up);
  }
  return normalize(projectedSun);
}

vec3 getRayDir(vec2 uv, vec3 up) {
  vec3 forward = getSkyViewForward(up);
  vec3 right = normalize(cross(forward, up));
  float azimuth = (uv.x - 0.5) * 2.0 * PI;
  float elevation = decodeLatitude(uv.y, uHorizonWarp);
  float ce = cos(elevation);
  vec3 horizontal = cos(azimuth) * forward + sin(azimuth) * right;
  return normalize(horizontal * ce + up * sin(elevation));
}

void main() {
  vec3 rayOrigin = uCameraPos;
  vec3 up = normalize(rayOrigin);
  vec3 rayDir = getRayDir(vUv, up);

  vec2 atmoHit = raySphereIntersect(rayOrigin, rayDir, uAtmosphereRadius);
  vec2 planetHit = raySphereIntersect(rayOrigin, rayDir, uPlanetRadius);

  if (atmoHit.y <= 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  float tNear = max(atmoHit.x, 0.0);
  float tFar = atmoHit.y;
  if (planetHit.x > tNear) tFar = min(tFar, planetHit.x);

  float segLen = tFar - tNear;
  if (segLen <= 1e-4) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  int steps = clamp(uMarchSteps, 4, 96);
  float dt = segLen / float(steps);
  float odR = 0.0, odM = 0.0, odO = 0.0;
  vec3 totalR = vec3(0.0);
  vec3 totalM = vec3(0.0);

  float mu = dot(rayDir, uSunDir);
  float phaseR = rayleighPhase(mu);
  float phaseM = miePhase(mu, uMieG);

  for (int i = 0; i < 96; i++) {
    if (i >= steps) break;
    float t = tNear + (float(i) + 0.5) * dt;
    vec3 p = rayOrigin + rayDir * t;
    vec3 d = sampleMediumDensity(p, uPlanetRadius, uRayleighSH, uMieSH,
                                  uOzoneCenter, uOzoneWidth, uMieOn, uOzoneOn);
    odR += d.x * dt;
    odM += d.y * dt;
    odO += d.z * dt;
    vec3 sunT = sampleTransmittance(p, uSunDir);
    vec3 viewTau = uRayleighBeta * odR + uMieBetaExt * odM + uOzoneBetaAbs * odO;
    vec3 inscatTrans = sunT * exp(-viewTau);
    totalR += d.x * inscatTrans * dt;
    if (uMieOn) totalM += d.y * inscatTrans * dt;
  }

  vec3 scattered = uSunIntensity * (
    phaseR * uRayleighBeta * totalR +
    (uMieOn ? phaseM * uMieBeta * totalM : vec3(0.0))
  );
  gl_FragColor = vec4(scattered, 1.0);
}
`;

export class SkyViewLUT {
  constructor({ width = 256, height = 128, marchSteps = 40 } = {}) {
    this.width = width;
    this.height = height;
    this.lastRenderUs = 0;

    this._makeTarget(width, height);

    this.uniforms = {
      uCameraPos:       { value: new THREE.Vector3(0, PLANET.groundRadius + 0.0016, 0) },
      uSunDir:          { value: new THREE.Vector3(0, 1, 0) },
      uHorizonWarp:     { value: true },

      uPlanetRadius:     { value: PLANET.groundRadius },
      uAtmosphereRadius: { value: PLANET.atmosphereRadius },
      uRayleighSH:       { value: PLANET.rayleighScaleHeight },
      uRayleighBeta:     { value: BETAS.rayleigh.clone() },
      uMieSH:            { value: PLANET.mieScaleHeight },
      uMieBeta:          { value: BETAS.mie },
      uMieBetaExt:       { value: BETAS.mie * BETAS.mieExtRatio },
      uMieG:             { value: 0.758 },
      uMieOn:            { value: true },
      uOzoneCenter:      { value: PLANET.ozoneCenter },
      uOzoneWidth:       { value: PLANET.ozoneWidth },
      uOzoneBetaAbs:     { value: BETAS.ozoneAbs.clone() },
      uOzoneOn:          { value: true },
      uSunIntensity:     { value: 22.0 },

      uTransmittanceLUT: { value: null },
      uMarchSteps:       { value: marchSteps },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });

    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this._quad.frustumCulled = false;
    this._scene.add(this._quad);
  }

  get texture() { return this.target.texture; }

  _makeTarget(width, height) {
    if (this.target) this.target.dispose();
    this.target = new THREE.WebGLRenderTarget(width, height, {
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      colorSpace: THREE.NoColorSpace,
    });
    this.target.texture.name = 'SkyViewLUT';
  }

  resize(width, height) {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this._makeTarget(width, height);
  }

  setMarchSteps(n) { this.uniforms.uMarchSteps.value = n; }
  setHorizonWarp(on) { this.uniforms.uHorizonWarp.value = !!on; }
  setSunDir(v) { this.uniforms.uSunDir.value.copy(v); }
  setSunIntensity(x) { this.uniforms.uSunIntensity.value = x; }
  setMieG(g) { this.uniforms.uMieG.value = g; }
  setObserverPosition(v) { this.uniforms.uCameraPos.value.copy(v); }
  setTransmittanceLUT(tex) { this.uniforms.uTransmittanceLUT.value = tex; }

  setAtmosphere({ rayleighMul, mieBeta, ozoneMul }) {
    if (rayleighMul != null) {
      this.uniforms.uRayleighBeta.value.copy(BETAS.rayleigh).multiplyScalar(rayleighMul);
    }
    if (mieBeta != null) {
      this.uniforms.uMieBeta.value = mieBeta;
      this.uniforms.uMieBetaExt.value = mieBeta * BETAS.mieExtRatio;
    }
    if (ozoneMul != null) {
      this.uniforms.uOzoneBetaAbs.value.copy(BETAS.ozoneAbs).multiplyScalar(ozoneMul);
    }
  }

  setGeometry({ planetRadiusKm, atmosphereThicknessKm }) {
    if (planetRadiusKm != null) this.uniforms.uPlanetRadius.value = planetRadiusKm;
    if (atmosphereThicknessKm != null) {
      const R = this.uniforms.uPlanetRadius.value;
      this.uniforms.uAtmosphereRadius.value = R + atmosphereThicknessKm;
    }
  }

  render(renderer) {
    const t0 = performance.now();
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(this._scene, this._camera);
    renderer.setRenderTarget(prev);
    this.lastRenderUs = (performance.now() - t0) * 1000;
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this._quad.geometry.dispose();
  }
}
