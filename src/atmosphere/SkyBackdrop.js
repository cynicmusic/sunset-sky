// Sky backdrop pass. Ported verbatim from sunset/src/atmosphere/SkyBackdrop.js.
// Fullscreen quad (renderOrder = -1, depthTest/Write off) that samples the
// Sky-View LUT in the camera-local frame and composites an analytic sun.
//
// Island note: the voxel scene lives in metres at ~1 km scale, but the
// atmosphere lives in km on a 6371 km planet. We feed this a FIXED observer
// position just above the planet surface (the island is negligibly small
// against a 100 km shell) and the REAL camera's rotation for ray direction.
// The quad draws behind everything so the voxel island always composites
// in front — that is how the isometric scene "sits" in the sky.

import * as THREE from 'three';
import { PLANET } from './constants.js';
import { COMMON_GLSL, HORIZON_WARP_GLSL } from './shaderHelpers.js';

const VERT = /* glsl */ `
varying vec3 vViewRay;
uniform mat4 uInvProj;
uniform mat4 uCameraWorld;

void main() {
  gl_Position = vec4(position.xy, 1.0, 1.0);
  vec4 ndc = vec4(position.xy, 1.0, 1.0);
  vec4 viewPos = uInvProj * ndc;
  viewPos /= viewPos.w;
  vec3 viewRay = normalize(viewPos.xyz);
  vViewRay = normalize(mat3(uCameraWorld) * viewRay);
}
`;

const FRAG = /* glsl */ `
varying vec3 vViewRay;

uniform vec3  uObserverPos;
uniform vec3  uSunDir;
uniform bool  uHorizonWarp;

uniform sampler2D uSkyViewLUT;
uniform sampler2D uTransmittanceLUT;
uniform float uPlanetRadius;
uniform float uAtmosphereRadius;

uniform float uSunIntensity;
uniform float uSunDiskAngularRadius;
uniform float uCoronaSoftness;
uniform vec3  uSunTint;
uniform bool  uForceBelowHorizonFog;
uniform vec3  uBelowHorizonFog;

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

vec3 sampleSkyView(vec3 rayDir) {
  vec3 up = normalize(uObserverPos);
  vec3 forward = getSkyViewForward(up);
  vec3 right = normalize(cross(forward, up));
  float vertical = clamp(dot(rayDir, up), -1.0, 1.0);
  float elevation = asin(vertical);
  vec3 horizontal = rayDir - up * vertical;
  float azimuth = atan(dot(horizontal, right), dot(horizontal, forward));
  float v = encodeLatitude(elevation, uHorizonWarp);
  float u = azimuth / (2.0 * PI) + 0.5;
  return texture2D(uSkyViewLUT, vec2(u, v)).rgb;
}

vec3 sampleSun(vec3 rayDir) {
  vec3 up = normalize(uObserverPos);
  float sunUp = dot(uSunDir, up);
  float theta = acos(clamp(dot(rayDir, uSunDir), -1.0, 1.0));
  float r = uSunDiskAngularRadius;
  float disk = smoothstep(r * 1.04, r * 0.96, theta);

  float coronaInner = exp(-theta / max(r * uCoronaSoftness, 1e-5));
  float coronaOuter = exp(-theta / max(r * (uCoronaSoftness * 1.6), 1e-5));

  vec3 radiance = disk * 16.0
    + uSunTint * coronaInner * 2.0
    + vec3(1.0, 0.98, 0.95) * coronaOuter * 0.6;

  float elFade = smoothstep(-0.12, 0.04, sunUp);
  vec3 sunT = sampleTransmittance(uObserverPos, uSunDir);
  return radiance * uSunIntensity * sunT * elFade * 0.01;
}

void main() {
  vec3 rayDir = normalize(vViewRay);
  vec3 sky = sampleSkyView(rayDir);
  vec2 planetHit = raySphereIntersect(uObserverPos, rayDir, uPlanetRadius);
  bool hitsPlanet = planetHit.x >= 0.0;
  if (uForceBelowHorizonFog && hitsPlanet) {
    sky = uBelowHorizonFog;
  } else if (!hitsPlanet) {
    sky += sampleSun(rayDir);
  }
  gl_FragColor = vec4(sky, 1.0);
}
`;

export class SkyBackdrop {
  constructor() {
    this.uniforms = {
      uInvProj:               { value: new THREE.Matrix4() },
      uCameraWorld:           { value: new THREE.Matrix4() },
      uObserverPos:           { value: new THREE.Vector3(0, PLANET.groundRadius + 0.4, 0) },
      uSunDir:                { value: new THREE.Vector3(0, 1, 0) },
      uHorizonWarp:           { value: true },
      uSkyViewLUT:            { value: null },
      uTransmittanceLUT:      { value: null },
      uPlanetRadius:          { value: PLANET.groundRadius },
      uAtmosphereRadius:      { value: PLANET.atmosphereRadius },
      uSunIntensity:          { value: 22.0 },
      uSunDiskAngularRadius:  { value: THREE.MathUtils.degToRad(0.55) },
      uCoronaSoftness:        { value: 5.5 },
      uSunTint:               { value: new THREE.Vector3(1.0, 0.95, 0.86) },
      uForceBelowHorizonFog:  { value: false },
      uBelowHorizonFog:       { value: new THREE.Vector3(0.0, 0.0, 0.0) },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.name = 'SkyBackdrop';
  }

  setLUTs(skyView, transmittance) {
    this.uniforms.uSkyViewLUT.value = skyView;
    this.uniforms.uTransmittanceLUT.value = transmittance;
  }

  setObserver(positionKm) { this.uniforms.uObserverPos.value.copy(positionKm); }
  setSun({ direction, intensity, diskRad, coronaSoftness, tint }) {
    if (direction != null) this.uniforms.uSunDir.value.copy(direction);
    if (intensity != null) this.uniforms.uSunIntensity.value = intensity;
    if (diskRad != null) this.uniforms.uSunDiskAngularRadius.value = diskRad;
    if (coronaSoftness != null) this.uniforms.uCoronaSoftness.value = coronaSoftness;
    if (tint != null) this.uniforms.uSunTint.value.copy(tint);
  }
  setDiagnostics({ forceBelowHorizonFog, belowHorizonFog } = {}) {
    if (forceBelowHorizonFog != null) this.uniforms.uForceBelowHorizonFog.value = !!forceBelowHorizonFog;
    if (belowHorizonFog != null) {
      this.uniforms.uBelowHorizonFog.value.set(belowHorizonFog.r, belowHorizonFog.g, belowHorizonFog.b);
    }
  }
  setHorizonWarp(on) { this.uniforms.uHorizonWarp.value = !!on; }
  setGeometry({ planetRadiusKm, atmosphereThicknessKm }) {
    if (planetRadiusKm != null) this.uniforms.uPlanetRadius.value = planetRadiusKm;
    if (atmosphereThicknessKm != null) {
      const R = this.uniforms.uPlanetRadius.value;
      this.uniforms.uAtmosphereRadius.value = R + atmosphereThicknessKm;
    }
  }

  updateCamera(camera) {
    this.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    this.uniforms.uCameraWorld.value.copy(camera.matrixWorld);
  }

  dispose() {
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
