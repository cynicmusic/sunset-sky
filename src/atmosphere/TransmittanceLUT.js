// Transmittance LUT (Hillaire §5.2). Ported verbatim from sunset.
// 256×64, 40 steps. Built once per atmosphere-param change.

import * as THREE from 'three';
import { PLANET, BETAS } from './constants.js';
import { COMMON_GLSL, FULLSCREEN_VERT } from './shaderHelpers.js';

const FRAG = /* glsl */ `
varying vec2 vUv;

uniform float uPlanetRadius;
uniform float uAtmosphereRadius;
uniform float uRayleighSH;
uniform vec3  uRayleighBeta;
uniform float uMieSH;
uniform float uMieBetaExt;
uniform bool  uMieOn;
uniform float uOzoneCenter;
uniform float uOzoneWidth;
uniform vec3  uOzoneBetaAbs;
uniform bool  uOzoneOn;

const int TRANSMITTANCE_STEPS = 40;

${COMMON_GLSL}

void main() {
  float mu = mix(-1.0, 1.0, vUv.x);
  float radius = mix(uPlanetRadius, uAtmosphereRadius, vUv.y);

  vec3 rayOrigin = vec3(0.0, radius, 0.0);
  float sinTheta = sqrt(max(1.0 - mu * mu, 0.0));
  vec3 rayDir = normalize(vec3(sinTheta, mu, 0.0));

  vec2 atmoHit = raySphereIntersect(rayOrigin, rayDir, uAtmosphereRadius);
  vec2 groundHit = raySphereIntersect(rayOrigin, rayDir, uPlanetRadius);
  float rayLen = atmoHit.y;
  if (rayLen <= 0.0) { gl_FragColor = vec4(1.0); return; }
  if (groundHit.x > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  float dt = rayLen / float(TRANSMITTANCE_STEPS);
  float odR = 0.0, odM = 0.0, odO = 0.0;
  for (int i = 0; i < TRANSMITTANCE_STEPS; i++) {
    float t = (float(i) + 0.5) * dt;
    vec3 p = rayOrigin + rayDir * t;
    vec3 d = sampleMediumDensity(p, uPlanetRadius, uRayleighSH, uMieSH,
                                  uOzoneCenter, uOzoneWidth, uMieOn, uOzoneOn);
    odR += d.x * dt;
    odM += d.y * dt;
    odO += d.z * dt;
  }
  vec3 tau = uRayleighBeta * odR + uMieBetaExt * odM + uOzoneBetaAbs * odO;
  gl_FragColor = vec4(exp(-tau), 1.0);
}
`;

export class TransmittanceLUT {
  constructor({ width = 256, height = 64 } = {}) {
    this.width = width;
    this.height = height;
    this.target = new THREE.WebGLRenderTarget(width, height, {
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      colorSpace: THREE.NoColorSpace,
    });
    this.target.texture.name = 'TransmittanceLUT';

    this.uniforms = {
      uPlanetRadius:     { value: PLANET.groundRadius },
      uAtmosphereRadius: { value: PLANET.atmosphereRadius },
      uRayleighSH:       { value: PLANET.rayleighScaleHeight },
      uRayleighBeta:     { value: BETAS.rayleigh.clone() },
      uMieSH:            { value: PLANET.mieScaleHeight },
      uMieBetaExt:       { value: BETAS.mie * BETAS.mieExtRatio },
      uMieOn:            { value: true },
      uOzoneCenter:      { value: PLANET.ozoneCenter },
      uOzoneWidth:       { value: PLANET.ozoneWidth },
      uOzoneBetaAbs:     { value: BETAS.ozoneAbs.clone() },
      uOzoneOn:          { value: true },
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

    this.dirty = true;
  }

  get texture() { return this.target.texture; }

  setAtmosphere({ rayleighMul, mieBeta, mieEnabled, ozoneMul, ozoneEnabled }) {
    if (rayleighMul != null) {
      this.uniforms.uRayleighBeta.value.copy(BETAS.rayleigh).multiplyScalar(rayleighMul);
    }
    if (mieBeta != null) {
      this.uniforms.uMieBetaExt.value = mieBeta * BETAS.mieExtRatio;
    }
    if (mieEnabled != null) this.uniforms.uMieOn.value = mieEnabled;
    if (ozoneMul != null) {
      this.uniforms.uOzoneBetaAbs.value.copy(BETAS.ozoneAbs).multiplyScalar(ozoneMul);
    }
    if (ozoneEnabled != null) this.uniforms.uOzoneOn.value = ozoneEnabled;
    this.dirty = true;
  }

  render(renderer) {
    if (!this.dirty) return;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(this._scene, this._camera);
    renderer.setRenderTarget(prev);
    this.dirty = false;
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this._quad.geometry.dispose();
  }
}
