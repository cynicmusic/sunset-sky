// Shared post-FX plumbing — built ONCE so bloom (main · lighting), aerial
// haze (main · lighting) and god rays (normal god-ray section) hang off a
// single offscreen pass. Mobile budget (MacBook / iPhone):
// when EVERY effect is off this bypasses entirely and renders straight to
// screen — byte-identical golden path, zero extra targets/passes. LDR
// screen-space fakes, no MRT.
//
// God rays — downsample → march → upsample (the lab "mission"): the radial
// light-shaft march (GPU Gems 3 ch.13 / Crytek) no longer runs in the
// full-res composite. It runs ONCE into a low-res `godRT` (resScale of the
// drawing buffer), then the composite UPSAMPLES it. Cheaper, and — kept
// deliberately RAW (no blur) — it makes the cheap screen-space scatter
// legible: drop `resScale`/`samples` and the banding/echo structure shows so
// it can actually be tuned. `sharp` snaps the upsample to the low-res texel
// grid to expose the raw blocks. `source` blends the old raw-scene scatter
// with a depth-derived sky/occluder mask, so the lab can make actual shafts
// instead of scattering a post-tonemap wash. The "ground mask" still fades ray
// *sources* below the sun so the bright water sun-glint doesn't seed a halo.

import * as THREE from 'three';

const QUAD = new THREE.PlaneGeometry(2, 2);
const ORTHO = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

// Shared god-ray march snippet (used by the low-res god pass). vUv is full-
// screen [0,1]; it reads the FULL-res scene colour but is invoked once per
// low-res god pixel — that is the "downsample".
const GOD_MARCH = `
  float godInUv(vec2 uv) {
    return step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  }

  float godLum(vec3 c) {
    return max(max(c.r, c.g), c.b);
  }

  float godSky(vec2 uv) {
    return smoothstep(0.999, 1.0, texture2D(tDepth, uv).x) * godInUv(uv);
  }

  float godForeground(vec2 uv) {
    float inUv = godInUv(uv);
    float depth = texture2D(tDepth, uv).x;
    float sky = smoothstep(0.999, 1.0, depth);
    float nearGeom = 1.0 - smoothstep(0.992, 0.9995, depth);
    return (1.0 - sky) * nearGeom * inUv;
  }

  float godEdgeBase(vec2 uv) {
    float sky = godSky(uv);
    vec2 px = uGodTexel * max(0.35, uGodEdgeWidth);
    float fg = 0.0;
    fg = max(fg, godForeground(uv + vec2( px.x, 0.0)));
    fg = max(fg, godForeground(uv + vec2(-px.x, 0.0)));
    fg = max(fg, godForeground(uv + vec2(0.0,  px.y)));
    fg = max(fg, godForeground(uv + vec2(0.0, -px.y)));
    return sky * fg;
  }

  float godEdge(vec2 uv) {
    vec2 px = uGodTexel * max(0.35, uGodEdgeWidth);
    float e = godEdgeBase(uv);
    // A perfectly long horizontal horizon line is also a depth edge, but it
    // transports into an ugly slab. Suppress laterally continuous edges and
    // keep jagged/curved mountain silhouette fragments.
    float lateral = 0.5 * (
      godEdgeBase(uv + vec2(px.x * 6.0, 0.0)) +
      godEdgeBase(uv - vec2(px.x * 6.0, 0.0))
    );
    float lineReject = 1.0 - smoothstep(0.35, 0.95, lateral);
    return e * lineReject * uGodEdgeGain;
  }

  void godSourceFields(vec2 uv, vec2 rayUV, out vec3 src, out float baseScalar, out float edgeScalar) {
    float inUv = godInUv(uv);
    vec3 s = texture2D(tScene, uv).rgb;
    float lum = godLum(s);
    float rawSrc = max(0.0, lum - uGodThr) * inUv;
    float sky = godSky(uv);
    float nearSun = exp(-dot(uv - rayUV, uv - rayUV) * 5.5);
    float cleanSrc = sky * nearSun * smoothstep(max(0.0, uGodThr - 0.28), 1.0, lum) * inUv;
    vec3 baseSrc = mix(s * rawSrc, vec3(cleanSrc), uGodSource);
    baseScalar = max(max(baseSrc.r, baseSrc.g), baseSrc.b);
    edgeScalar = 0.0;
    if (uGodEdgeSource > 0.001 || (uGodDebug > 1.5 && uGodDebug < 2.5)) {
      edgeScalar = godEdge(uv) * nearSun;
    }
    src = mix(baseSrc, vec3(edgeScalar), uGodEdgeSource);
  }

  vec3 godMarch(vec2 vUv) {
    if ((uGod < 0.001 && uGodDebug < 0.5) || uSunVis <= 0.001) return vec3(0.0);
    vec2 rayUV = clamp(uSunUV, vec2(0.0), vec2(1.0));
    vec3 debugSrc; float debugBase; float debugEdge;
    godSourceFields(vUv, rayUV, debugSrc, debugBase, debugEdge);
    if (uGodDebug > 0.5 && uGodDebug < 1.5) return vec3(debugBase) * uGodDebugGain;
    if (uGodDebug > 1.5 && uGodDebug < 2.5) return vec3(debugEdge) * uGodDebugGain;

    vec2 delta = (rayUV - vUv) / float(uGodN) * uGodDensity;
    vec2 uv = vUv; float decay = 1.0; vec3 acc = vec3(0.0);
    for (int i = 0; i < 48; i++) {
      if (i >= uGodN) break;
      uv += delta;
      vec3 src; float baseScalar; float edgeScalar;
      godSourceFields(uv, rayUV, src, baseScalar, edgeScalar);
      float gm = mix(1.0, smoothstep(rayUV.y - 0.30, rayUV.y + 0.04, uv.y), uGodHorizon);
      acc += src * gm * decay * uGodW;
      decay *= uGodDecay;
    }
    acc /= float(uGodN);
    float radial = smoothstep(uGodRadius, 0.0, distance(vUv, rayUV));
    vec3 tint = mix(uHazeColor, uSunCol, uGodTint);
    float a = (acc.r + acc.g + acc.b) * 0.3333;
    return tint * a * uGodExp * max(uGod, step(2.5, uGodDebug)) * radial * uSunVis;
  }`;

const GOD_UNIFORMS = () => ({
  tScene: { value: null },
  tDepth: { value: null },
  uSunUV: { value: new THREE.Vector2(0.5, 0.7) }, uSunVis: { value: 0 },
  uHazeColor: { value: new THREE.Color('#bcd4d6') },
  uSunCol: { value: new THREE.Color('#ffd9a0') },
  uGod: { value: 0 },
  uGodN: { value: 16 },
  uGodDensity: { value: 0.6 },
  uGodDecay: { value: 0.93 },
  uGodW: { value: 0.6 },
  uGodExp: { value: 0.9 },
  uGodThr: { value: 0.62 },
  uGodHorizon: { value: 0.5 },
  uGodRadius: { value: 1.1 },
  uGodTint: { value: 0.5 },
  uGodSource: { value: 0.0 },
  uGodEdgeSource: { value: 0.0 },
  uGodEdgeWidth: { value: 1.2 },
  uGodEdgeGain: { value: 1.0 },
  uGodTexel: { value: new THREE.Vector2(1 / 256, 1 / 144) },
  uGodDebug: { value: 0 },
  uGodDebugGain: { value: 1 },
});

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    const dpr = renderer.getPixelRatio();
    const w = Math.max(2, (window.innerWidth * dpr) | 0);
    const h = Math.max(2, (window.innerHeight * dpr) | 0);

    this.sceneRT = new THREE.WebGLRenderTarget(w, h, {
      depthBuffer: true, stencilBuffer: false, type: THREE.HalfFloatType,
      magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter,
    });
    this.sceneRT.depthTexture = new THREE.DepthTexture(w, h);
    this.sceneRT.depthTexture.format = THREE.DepthFormat;
    this.sceneRT.depthTexture.type = THREE.UnsignedIntType;
    // Render targets hold linear scene radiance. The final composite applies
    // the renderer's tone mapping/output transform exactly once.
    this.sceneRT.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.bloomRT = new THREE.WebGLRenderTarget((w / 4) | 0, (h / 4) | 0, {
      depthBuffer: false, stencilBuffer: false, type: THREE.HalfFloatType,
      magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter,
    });
    this.bloomRT.texture.colorSpace = THREE.LinearSRGBColorSpace;
    // Low-res god-ray target. LinearFilter ⇒ a free bilinear upsample; the
    // `sharp` knob in the composite can snap back to the raw texel grid.
    this._godScale = 0.25;
    this.godRT = new THREE.WebGLRenderTarget(
      Math.max(1, (w * this._godScale) | 0), Math.max(1, (h * this._godScale) | 0), {
        depthBuffer: false, stencilBuffer: false, type: THREE.HalfFloatType,
        magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter,
      });
    this.godRT.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.godBlurA = this.godRT.clone();
    this.godBlurB = this.godRT.clone();
    this.godBlurA.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.godBlurB.texture.colorSpace = THREE.LinearSRGBColorSpace;

    this.brightMat = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: null }, uTexel: { value: new THREE.Vector2() }, uThresh: { value: 0.72 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
      fragmentShader: `
        varying vec2 vUv; uniform sampler2D tScene; uniform vec2 uTexel; uniform float uThresh;
        vec3 bp(vec2 o){ vec3 c=texture2D(tScene,vUv+o).rgb; float l=max(max(c.r,c.g),c.b);
          return c*smoothstep(uThresh,1.0,l); }
        void main(){
          vec3 s = bp(vec2(0.0));
          s += bp(vec2( uTexel.x,0.0))+bp(vec2(-uTexel.x,0.0));
          s += bp(vec2(0.0, uTexel.y))+bp(vec2(0.0,-uTexel.y));
          s += bp(uTexel)+bp(-uTexel)+bp(vec2(uTexel.x,-uTexel.y))+bp(vec2(-uTexel.x,uTexel.y));
          gl_FragColor = vec4(s/9.0, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });

    // ---- god-ray pass (low res) — march only, written to godRT ----------
    this.godMat = new THREE.ShaderMaterial({
      uniforms: GOD_UNIFORMS(),
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
      fragmentShader: `
        varying vec2 vUv;
        uniform sampler2D tScene, tDepth;
        uniform vec2 uSunUV, uGodTexel; uniform float uSunVis;
        uniform vec3 uHazeColor, uSunCol;
        uniform float uGod, uGodDensity, uGodDecay, uGodW, uGodExp, uGodThr, uGodHorizon, uGodRadius, uGodTint, uGodSource;
        uniform float uGodEdgeSource, uGodEdgeWidth, uGodEdgeGain, uGodDebug, uGodDebugGain;
        uniform int uGodN;
        ${GOD_MARCH}
        void main(){ gl_FragColor = vec4(godMarch(vUv), 1.0); }`,
      depthTest: false, depthWrite: false,
    });

    this.godBlurMat = new THREE.ShaderMaterial({
      uniforms: {
        tGod: { value: null },
        uGodTexel: { value: new THREE.Vector2(1 / 256, 1 / 144) },
        uDirection: { value: new THREE.Vector2(1, 0) },
        uRadius: { value: 1 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
      fragmentShader: `
        varying vec2 vUv;
        uniform sampler2D tGod;
        uniform vec2 uGodTexel, uDirection;
        uniform float uRadius;
        void main(){
          vec2 o = uDirection * uGodTexel * max(0.0, uRadius);
          vec3 c = texture2D(tGod, vUv).rgb * 0.34;
          c += texture2D(tGod, vUv + o).rgb * 0.23;
          c += texture2D(tGod, vUv - o).rgb * 0.23;
          c += texture2D(tGod, vUv + o * 2.0).rgb * 0.10;
          c += texture2D(tGod, vUv - o * 2.0).rgb * 0.10;
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    // Additive ray-only overlay. This is the lab/debug path for god rays when
    // no other post effect is active: render the real scene directly, then
    // add only the ray buffer. No base-color pass-through, no hidden retone.
    this.overlayMat = new THREE.ShaderMaterial({
      uniforms: {
        tGod: { value: null },
        tGodBlur: { value: null },
        uGodBlur: { value: 0 },
        uGodSharp: { value: 0 },
        uGodTexel: { value: new THREE.Vector2() },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
      fragmentShader: `
        varying vec2 vUv;
        uniform sampler2D tGod, tGodBlur;
        uniform float uGodSharp, uGodBlur;
        uniform vec2 uGodTexel;
        void main(){
          vec2 g = (floor(vUv / uGodTexel) + 0.5) * uGodTexel;
          vec2 guv = mix(vUv, g, uGodSharp);
          vec3 raw = texture2D(tGod, guv).rgb;
          vec3 soft = texture2D(tGodBlur, guv).rgb;
          gl_FragColor = vec4(mix(raw, soft, uGodBlur), 1.0);
        }`,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    // Fullscreen god-buffer inspector for the lab workshop. It displays the
    // low-res source/edge/ray target directly, so the source math can be tuned
    // without the final scene hiding it.
    this.debugMat = new THREE.ShaderMaterial({
      uniforms: {
        tGod: { value: null },
        tGodBlur: { value: null },
        uGodBlur: { value: 0 },
        uGodSharp: { value: 0 },
        uGodTexel: { value: new THREE.Vector2() },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
      fragmentShader: `
        varying vec2 vUv;
        uniform sampler2D tGod, tGodBlur;
        uniform float uGodSharp, uGodBlur;
        uniform vec2 uGodTexel;
        void main(){
          vec2 g = (floor(vUv / uGodTexel) + 0.5) * uGodTexel;
          vec2 guv = mix(vUv, g, uGodSharp);
          vec3 raw = texture2D(tGod, guv).rgb;
          vec3 soft = texture2D(tGodBlur, guv).rgb;
          gl_FragColor = vec4(mix(raw, soft, uGodBlur), 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    // ---- composite — scene + upsampled god rays + haze + bloom ----------
    this.compMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null }, tBloom: { value: null }, tGod: { value: null }, tGodBlur: { value: null },
        uBloom: { value: 0 }, uHaze: { value: 0 },
        uHazeColor: { value: new THREE.Color('#bcd4d6') },
        uSunCol: { value: new THREE.Color('#ffd9a0') },
        uSunUV: { value: new THREE.Vector2(0.5, 0.7) }, uSunVis: { value: 0 },
        uGod: { value: 0 },
        uGodCompare: { value: 0 },
        uGodBlur: { value: 0 },
        uGodSharp: { value: 0 },        // 0 = bilinear upsample · 1 = raw blocks
        uGodTexel: { value: new THREE.Vector2() },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
      fragmentShader: `
        varying vec2 vUv;
        uniform sampler2D tScene, tBloom, tGod, tGodBlur;
        uniform float uBloom, uHaze, uSunVis, uGod, uGodCompare, uGodBlur, uGodSharp;
        uniform vec3 uHazeColor, uSunCol; uniform vec2 uSunUV, uGodTexel;
        void main(){
          vec3 col = texture2D(tScene, vUv).rgb;

          // God rays — UPSAMPLE the low-res march. uGodSharp snaps the
          // sample to the godRT texel grid so the raw downsampled blocks
          // are visible (a deliberate tuning aid, not a defect).
          if (uGod > 0.001 && uSunVis > 0.001 && (uGodCompare < 0.5 || vUv.x >= 0.5)) {
            vec2 g = (floor(vUv / uGodTexel) + 0.5) * uGodTexel;
            vec2 guv = mix(vUv, g, uGodSharp);
            vec3 raw = texture2D(tGod, guv).rgb;
            vec3 soft = texture2D(tGodBlur, guv).rgb;
            col += mix(raw, soft, uGodBlur);
          }

          // Aerial haze — sky-coloured veil, thicker toward the horizon and a
          // SOFT broad forward-scatter near the sun (no hard ring). Screen-
          // space approx (no depth pass — the expensive path we skip on
          // mobile); independent of the Render-panel Horizon-Haze safety net.
          if (uHaze > 0.001) {
            float horiz = smoothstep(0.62, 0.18, vUv.y);
            float d = distance(vUv, uSunUV);
            float sunGlow = exp(-d * d * 2.2) * 0.30 * uSunVis;
            col = mix(col, uHazeColor, clamp(uHaze * (0.35 * horiz + sunGlow), 0.0, 0.9));
          }

          if (uBloom > 0.001) col += texture2D(tBloom, vUv).rgb * uBloom;

          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false,
    });

    this._brightQuad = new THREE.Mesh(QUAD, this.brightMat);
    this._godQuad = new THREE.Mesh(QUAD, this.godMat);
    this._godBlurQuad = new THREE.Mesh(QUAD, this.godBlurMat);
    this._overlayQuad = new THREE.Mesh(QUAD, this.overlayMat);
    this._debugQuad = new THREE.Mesh(QUAD, this.debugMat);
    this._compQuad = new THREE.Mesh(QUAD, this.compMat);
    this._brightScene = new THREE.Scene().add(this._brightQuad);
    this._godScene = new THREE.Scene().add(this._godQuad);
    this._godBlurScene = new THREE.Scene().add(this._godBlurQuad);
    this._overlayScene = new THREE.Scene().add(this._overlayQuad);
    this._debugScene = new THREE.Scene().add(this._debugQuad);
    this._compScene = new THREE.Scene().add(this._compQuad);
  }

  setSize() {
    const dpr = this.renderer.getPixelRatio();
    const w = Math.max(2, (window.innerWidth * dpr) | 0);
    const h = Math.max(2, (window.innerHeight * dpr) | 0);
    this.sceneRT.setSize(w, h);
    this.bloomRT.setSize((w / 4) | 0, (h / 4) | 0);
    this._sizeGod(w, h);
  }

  _sizeGod(w, h) {
    const gw = Math.max(1, (w * this._godScale) | 0);
    const gh = Math.max(1, (h * this._godScale) | 0);
    if (this.godRT.width !== gw || this.godRT.height !== gh) this.godRT.setSize(gw, gh);
    if (this.godBlurA.width !== gw || this.godBlurA.height !== gh) this.godBlurA.setSize(gw, gh);
    if (this.godBlurB.width !== gw || this.godBlurB.height !== gh) this.godBlurB.setSize(gw, gh);
    this.compMat.uniforms.uGodTexel.value.set(1 / gw, 1 / gh);
    this.godMat.uniforms.uGodTexel.value.set(1 / gw, 1 / gh);
    this.godBlurMat.uniforms.uGodTexel.value.set(1 / gw, 1 / gh);
  }

  // p: { bloom, haze, hazeColor, sunCol, sunUV, sunVisible, god:{intensity,
  //      samples, density, decay, weight, exposure, threshold, horizon,
  //      radius, tint, resScale, sharp, source, compare, blurAmount} }
  render(scene, camera, p) {
    const bloom = p.bloom || 0, haze = p.haze || 0;
    const g = p.god || {};
    const sunFade = p.sunFade ?? (p.sunVisible ? 1 : 0);
    const gDebug = Math.max(0, Math.min(3, g.debugView ?? 0));
    const gOn = ((g.intensity || 0) > 0 || gDebug > 0) && sunFade > 0.001;
    const r = this.renderer;
    const rayOnly = gOn && bloom <= 0 && haze <= 0;
    if (bloom <= 0 && haze <= 0 && !gOn) {     // golden bypass — no RT, no pass
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    // Keep the offscreen target locked to the live drawing buffer. A stale
    // size (after a DPR/resize/visibility change) makes the composite sample
    // an offset region — phantom halo until something forces a resize.
    const db = r.getDrawingBufferSize(new THREE.Vector2());
    if (this.sceneRT.width !== db.x || this.sceneRT.height !== db.y) {
      this.sceneRT.setSize(db.x, db.y);
      this.bloomRT.setSize(Math.max(1, (db.x / 4) | 0), Math.max(1, (db.y / 4) | 0));
    }
    if (gOn) {
      const sc = Math.max(0.04, Math.min(1, g.resScale ?? 0.25));
      if (sc !== this._godScale) this._godScale = sc;
      this._sizeGod(db.x, db.y);
    }
    r.setRenderTarget(this.sceneRT);
    r.render(scene, camera);

    if (bloom > 0) {
      this.brightMat.uniforms.tScene.value = this.sceneRT.texture;
      this.brightMat.uniforms.uTexel.value.set(1 / this.bloomRT.width, 1 / this.bloomRT.height);
      r.setRenderTarget(this.bloomRT);
      r.render(this._brightScene, ORTHO);
    }

    if (gOn) {
      const u = this.godMat.uniforms;
      u.tScene.value = this.sceneRT.texture;
      u.tDepth.value = this.sceneRT.depthTexture;
      if (p.hazeColor) u.uHazeColor.value.copy(p.hazeColor);
      if (p.sunCol) u.uSunCol.value.copy(p.sunCol);
      if (p.sunUV) u.uSunUV.value.set(p.sunUV.x, p.sunUV.y);
      u.uSunVis.value = sunFade;
      u.uGod.value = g.intensity || 0;
      u.uGodN.value = Math.max(6, Math.min(48, (g.samples || 16) | 0));
      u.uGodDensity.value = g.density ?? 0.6;
      u.uGodDecay.value = g.decay ?? 0.93;
      u.uGodW.value = g.weight ?? 0.6;
      u.uGodExp.value = g.exposure ?? 0.9;
      u.uGodThr.value = g.threshold ?? 0.62;
      u.uGodHorizon.value = g.horizon ?? 0.5;
      u.uGodRadius.value = g.radius ?? 1.1;
      u.uGodTint.value = g.tint ?? 0.5;
      u.uGodSource.value = Math.max(0, Math.min(1, g.source ?? 0));
      u.uGodEdgeSource.value = Math.max(0, Math.min(1, g.edgeSource ?? 0));
      u.uGodEdgeWidth.value = Math.max(0.35, Math.min(8, g.edgeWidth ?? 1.2));
      u.uGodEdgeGain.value = Math.max(0, Math.min(12, g.edgeGain ?? 1));
      u.uGodDebug.value = gDebug;
      u.uGodDebugGain.value = Math.max(0.1, Math.min(20, g.debugGain ?? 1));
      r.setRenderTarget(this.godRT);
      r.render(this._godScene, ORTHO);
    }
    const blurAmount = gOn && g.blurEnable ? Math.max(0, Math.min(1, g.blurAmount ?? 0.18)) : 0;
    let godBlurTexture = this.godRT.texture;
    if (blurAmount > 0.001) {
      const bu = this.godBlurMat.uniforms;
      bu.uRadius.value = Math.max(0.05, Math.min(8, g.blurRadius ?? 1.5));
      const passes = Math.max(1, Math.min(4, (g.blurPasses ?? 1) | 0));
      for (let i = 0; i < passes; i++) {
        bu.tGod.value = godBlurTexture;
        bu.uDirection.value.set(1, 0);
        r.setRenderTarget(this.godBlurA);
        r.render(this._godBlurScene, ORTHO);

        bu.tGod.value = this.godBlurA.texture;
        bu.uDirection.value.set(0, 1);
        r.setRenderTarget(this.godBlurB);
        r.render(this._godBlurScene, ORTHO);
        godBlurTexture = this.godBlurB.texture;
      }
    }

    if (gDebug > 0) {
      const d = this.debugMat.uniforms;
      d.tGod.value = this.godRT.texture;
      d.tGodBlur.value = godBlurTexture;
      d.uGodBlur.value = blurAmount;
      d.uGodSharp.value = Math.max(0, Math.min(1, g.sharp ?? 0));
      d.uGodTexel.value.copy(this.compMat.uniforms.uGodTexel.value);
      r.setRenderTarget(null);
      r.render(this._debugScene, ORTHO);
      return;
    }

    if (rayOnly) {
      const oldAutoClear = r.autoClear;
      r.setRenderTarget(null);
      r.autoClear = true;
      r.setScissorTest(false);
      r.render(scene, camera);

      const o = this.overlayMat.uniforms;
      o.tGod.value = this.godRT.texture;
      o.tGodBlur.value = godBlurTexture;
      o.uGodBlur.value = blurAmount;
      o.uGodSharp.value = Math.max(0, Math.min(1, g.sharp ?? 0));
      o.uGodTexel.value.copy(this.compMat.uniforms.uGodTexel.value);

      r.autoClear = false;
      if (g.compare) {
        const screen = r.getSize(new THREE.Vector2());
        const split = Math.floor(screen.x * 0.5);
        r.setScissorTest(true);
        r.setScissor(split, 0, screen.x - split, screen.y);
      }
      r.render(this._overlayScene, ORTHO);
      r.setScissorTest(false);
      r.autoClear = oldAutoClear;
      return;
    }

    const c = this.compMat.uniforms;
    c.tScene.value = this.sceneRT.texture;
    c.tBloom.value = this.bloomRT.texture;
    c.tGod.value = this.godRT.texture;
    c.tGodBlur.value = godBlurTexture;
    c.uBloom.value = bloom;
    c.uHaze.value = haze;
    if (p.hazeColor) c.uHazeColor.value.copy(p.hazeColor);
    if (p.sunCol) c.uSunCol.value.copy(p.sunCol);
    if (p.sunUV) c.uSunUV.value.set(p.sunUV.x, p.sunUV.y);
    c.uSunVis.value = sunFade;
    c.uGod.value = gOn ? 1 : 0;
    c.uGodCompare.value = g.compare ? 1 : 0;
    c.uGodBlur.value = blurAmount;
    c.uGodSharp.value = Math.max(0, Math.min(1, g.sharp ?? 0));

    r.setRenderTarget(null);
    r.render(this._compScene, ORTHO);
  }

  dispose() {
    this.sceneRT.dispose(); this.bloomRT.dispose(); this.godRT.dispose();
    this.godBlurA.dispose(); this.godBlurB.dispose();
    this.brightMat.dispose(); this.godMat.dispose(); this.godBlurMat.dispose(); this.overlayMat.dispose(); this.debugMat.dispose(); this.compMat.dispose();
  }
}
