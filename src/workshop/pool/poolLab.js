import * as THREE from 'three';
import '../../styles.css';
import './poolLab.css';
import { FlyCameraDirector } from '../../camera/FlyCameraDirector.js';

const container = document.getElementById('canvas-container');
const uiRoot = document.getElementById('ui-root');

const BLOCK_COLORS = {
  sphereBlue: '#2929ff',
  boxYellow: '#ffff24',
  cylinderRed: '#ff1717',
  baseTint: '#70f8ff',
  deepTint: '#00574a',
};

const STAGE_NAMES = [
  '0 surface only',
  '1 depth grayscale',
  '2 underwater fog / see-through color',
  '3 vertex waves',
  '4 fragment detail / normals',
  '5 refraction distortion',
  '6 Beer-Lambert-ish absorption',
  '7 PBR lighting proxy',
  '8 foam mask',
];

const state = {
  stage: 6,
  debug: 0,
  opacity: 0.55,
  maxDepth: 4.2,
  fadeStart: 0.35,
  waveHeight: 0.34,
  waveFreq: 1.45,
  waveSpeed: 0.45,
  waveRotation: 22,
  choppy: 3.8,
  detail: 0.42,
  normalStrength: 0.85,
  refraction: 0.18,
  absorption: 0.55,
  roughness: 0.16,
  metalness: 0.0,
  specular: 1.25,
  foam: 0.25,
  foamWidth: 0.55,
};

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#071018');
scene.fog = new THREE.FogExp2('#071018', 0.018);

const camera = new THREE.PerspectiveCamera(52, 1, 0.05, 220);
camera.position.set(4.9, 4.3, 7.4);
camera.lookAt(0.1, -0.45, 0.1);
const humanCamera = new FlyCameraDirector(camera, renderer.domElement);

const hemi = new THREE.HemisphereLight('#9eeaff', '#091322', 1.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff5e8', 2.8);
sun.position.set(-3.5, 6.5, 4.2);
scene.add(sun);

const grid = new THREE.GridHelper(16, 16, '#4b6570', '#25323a');
grid.position.y = -2.72;
scene.add(grid);

const pool = new THREE.Group();
scene.add(pool);

const floor = new THREE.Mesh(
  new THREE.BoxGeometry(12.4, 0.18, 8.4),
  new THREE.MeshStandardMaterial({ color: '#073a45', roughness: 0.86, metalness: 0 }),
);
floor.position.y = -2.86;
floor.receiveShadow = true;
pool.add(floor);

const wallMat = new THREE.MeshStandardMaterial({ color: '#0b2630', roughness: 0.7, metalness: 0 });
for (const [x, z, sx, sz] of [
  [0, -4.25, 12.7, 0.22],
  [0, 4.25, 12.7, 0.22],
  [-6.25, 0, 0.22, 8.7],
  [6.25, 0, 0.22, 8.7],
]) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(sx, 2.8, sz), wallMat);
  wall.position.set(x, -1.55, z);
  pool.add(wall);
}

const sphere = new THREE.Mesh(
  new THREE.SphereGeometry(1.45, 48, 24),
  new THREE.MeshStandardMaterial({ color: BLOCK_COLORS.sphereBlue, roughness: 0.42, metalness: 0 }),
);
sphere.position.set(-2.55, -1.34, 0.72);
pool.add(sphere);

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(0.9, 3.0, 0.9),
  new THREE.MeshStandardMaterial({ color: BLOCK_COLORS.boxYellow, roughness: 0.45, metalness: 0 }),
);
cube.position.set(0.56, -1.05, -0.15);
pool.add(cube);

const cylinder = new THREE.Mesh(
  new THREE.CylinderGeometry(0.78, 0.78, 3.5, 48),
  new THREE.MeshStandardMaterial({ color: BLOCK_COLORS.cylinderRed, roughness: 0.36, metalness: 0 }),
);
cylinder.position.set(2.72, -1.25, 0.58);
pool.add(cylinder);
const redCap = new THREE.Mesh(
  new THREE.CylinderGeometry(0.79, 0.79, 0.04, 48),
  new THREE.MeshStandardMaterial({ color: BLOCK_COLORS.cylinderRed, roughness: 0.25, metalness: 0 }),
);
redCap.position.set(2.72, 0.52, 0.58);
pool.add(redCap);

const smallCube = new THREE.Mesh(
  new THREE.BoxGeometry(0.45, 0.45, 0.45),
  new THREE.MeshStandardMaterial({ color: '#70dcff', roughness: 0.4, metalness: 0 }),
);
smallCube.position.set(1.0, -2.25, -1.55);
pool.add(smallCube);

const water = makePoolWater();
scene.add(water);
applyState();

const panel = buildPanel();
uiRoot.appendChild(panel);
const handle = document.createElement('button');
handle.className = 'pool-handle';
handle.textContent = '≈';
handle.title = 'open pool controls (h)';
document.body.appendChild(handle);
const hints = document.createElement('div');
hints.className = 'pool-hints';
hints.innerHTML = '<kbd>WASD</kbd> fly&nbsp;&nbsp; <kbd>drag</kbd> look&nbsp;&nbsp; <kbd>H</kbd> panel&nbsp;&nbsp; <kbd>P</kbd> camera pose';
document.body.appendChild(hints);

let collapsed = false;
function togglePanel() {
  collapsed = !collapsed;
  panel.classList.toggle('collapsed', collapsed);
  handle.classList.toggle('visible', collapsed);
}
handle.addEventListener('click', togglePanel);

const poses = [
  { p: [4.9, 4.3, 7.4], t: [0.1, -0.45, 0.1] },
  { p: [0.1, 7.6, 4.8], t: [0.0, -1.0, 0.0] },
  { p: [-2.2, 1.15, 4.4], t: [0.1, -0.65, 0.15] },
];
let poseIndex = 0;
function applyPose(next = poseIndex) {
  poseIndex = next % poses.length;
  const pose = poses[poseIndex];
  camera.position.fromArray(pose.p);
  camera.lookAt(new THREE.Vector3().fromArray(pose.t));
  humanCamera.markHumanInput();
}

window.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
  const target = event.target;
  const isTextEntry = target && (target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && target.type !== 'range'));
  if (isTextEntry) return;
  const key = event.key.toLowerCase();
  if (target && target.tagName === 'INPUT' && target.type === 'range' && /^[wasdqe]$/.test(key)) target.blur();
  if (key === 'h' || key === 'b') {
    event.preventDefault();
    togglePanel();
  } else if (key === 'p') {
    event.preventDefault();
    applyPose(poseIndex + 1);
  } else if (key >= '0' && key <= '8') {
    event.preventDefault();
    state.stage = Number(key);
    applyState();
    syncPanel();
  }
});

window.addEventListener('resize', resize);
resize();

let last = performance.now();
function animate(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;
  humanCamera.update(dt);
  water.material.uniforms.uTime.value = now / 1000;
  water.material.uniforms.uCamPos.value.copy(camera.position);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

function resize() {
  const w = container.clientWidth || window.innerWidth;
  const h = container.clientHeight || window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

function buildPanel() {
  const root = document.createElement('div');
  root.className = 'pool-card';
  root.innerHTML = `
    <div class="pool-head">
      <div class="pool-title">POOL</div>
      <div class="pool-sub">tutorial reconstruction bench · no island · no presets · no sticky writes</div>
    </div>
    <div class="pool-body">
      <div class="pool-stage-row"></div>
      <div class="pool-swatches" aria-hidden="true">
        <i class="pool-swatch" style="background:${BLOCK_COLORS.sphereBlue}"></i>
        <i class="pool-swatch" style="background:${BLOCK_COLORS.boxYellow}"></i>
        <i class="pool-swatch" style="background:${BLOCK_COLORS.cylinderRed}"></i>
        <i class="pool-swatch" style="background:${BLOCK_COLORS.baseTint}"></i>
        <i class="pool-swatch" style="background:${BLOCK_COLORS.deepTint}"></i>
      </div>
    </div>
  `;
  const stageRow = root.querySelector('.pool-stage-row');
  for (let i = 0; i <= 8; i++) {
    const button = document.createElement('button');
    button.className = 'pool-stage';
    button.dataset.stage = String(i);
    button.textContent = String(i);
    button.title = STAGE_NAMES[i];
    button.addEventListener('click', () => {
      state.stage = i;
      applyState();
      syncPanel();
    });
    stageRow.appendChild(button);
  }
  const body = root.querySelector('.pool-body');
  enumField(body, 'debug', 'Debug view', [
    ['0', 'final'],
    ['1', 'depth grayscale'],
    ['2', 'object masks'],
    ['3', 'wave field'],
    ['4', 'normal'],
    ['5', 'foam mask'],
  ], 'raw shader channels before art layering');
  sliderField(body, 'opacity', 'Opacity', 0.02, 1, 0.01, 2, 'full opacity is blue water, not a black sheet');
  sliderField(body, 'maxDepth', 'Max depth', 0.5, 8, 0.05, 2, 'normalizes the tutorial depth/thickness value');
  sliderField(body, 'fadeStart', 'Fog start', 0, 3, 0.02, 2, 'depth before underwater fog begins');
  sliderField(body, 'waveFreq', 'Wave frequency', 0.02, 5, 0.001, 3, 'tutorial sea_freq, local pool scale');
  sliderField(body, 'waveRotation', 'Wave rotation', -180, 180, 1, 0, 'rotates the wave basis so motion is not locked to one incoming axis');
  sliderField(body, 'waveSpeed', 'Wave speed', 0, 2.5, 0.01, 2, 'phase speed');
  sliderField(body, 'waveHeight', 'Wave height', 0, 1.4, 0.01, 2, 'vertex displacement');
  sliderField(body, 'choppy', 'Wave chop', 0.5, 8, 0.05, 2, 'sea_octave sharpness');
  sliderField(body, 'detail', 'Detail mix', 0, 1, 0.01, 2, 'fragment detail over geometry');
  sliderField(body, 'normalStrength', 'Normal strength', 0, 2, 0.01, 2, 'normal perturbation visible under PBR');
  sliderField(body, 'refraction', 'Refraction', 0, 0.7, 0.005, 3, 'depth/mask distortion, not true screen refraction yet');
  sliderField(body, 'absorption', 'Absorption', 0, 2, 0.01, 2, 'Beer-Lambert-ish deepening');
  sliderField(body, 'roughness', 'Roughness', 0.02, 1, 0.01, 2, 'specular spread');
  sliderField(body, 'metalness', 'Metalness', 0, 1, 0.01, 2, 'stylized PBR scalar, water usually stays zero');
  sliderField(body, 'specular', 'Specular', 0, 3, 0.01, 2, 'highlight gain');
  sliderField(body, 'foam', 'Foam', 0, 2, 0.01, 2, 'shore + crest mask gain');
  sliderField(body, 'foamWidth', 'Foam width', 0.05, 2, 0.01, 2, 'depth band for edge foam');
  syncPanel(root);
  return root;
}

function sliderField(parent, key, label, min, max, step, precision, hint) {
  const row = document.createElement('label');
  row.className = 'pool-field';
  row.dataset.key = key;
  row.innerHTML = `
    <span class="pool-label">${label}</span>
    <span class="pool-value"></span>
    <span class="pool-hint">${hint}</span>
    <span class="pool-slider"><input type="range" min="${min}" max="${max}" step="${step}"></span>
  `;
  const input = row.querySelector('input');
  input.addEventListener('input', () => {
    state[key] = Number(input.value);
    applyState();
    syncField(row, precision);
  });
  input.addEventListener('pointerup', () => input.blur());
  input.addEventListener('change', () => input.blur());
  parent.appendChild(row);
}

function enumField(parent, key, label, options, hint) {
  const row = document.createElement('label');
  row.className = 'pool-field';
  row.dataset.key = key;
  const select = document.createElement('select');
  select.className = 'pool-select';
  for (const [value, text] of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    select.appendChild(option);
  }
  row.innerHTML = `
    <span class="pool-label">${label}</span>
    <span class="pool-value"></span>
    <span class="pool-hint">${hint}</span>
  `;
  row.appendChild(select);
  select.addEventListener('change', () => {
    state[key] = Number(select.value);
    applyState();
    syncPanel();
  });
  parent.appendChild(row);
}

function syncPanel(root = panel) {
  if (!root) return;
  root.querySelectorAll('.pool-stage').forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.stage) === state.stage);
  });
  root.querySelectorAll('.pool-field').forEach((row) => syncField(row));
}

function syncField(row, forcedPrecision) {
  const key = row.dataset.key;
  const input = row.querySelector('input');
  const select = row.querySelector('select');
  const value = state[key];
  if (input) {
    input.value = String(value);
    const min = Number(input.min);
    const max = Number(input.max);
    input.style.setProperty('--pct', `${THREE.MathUtils.clamp((value - min) / (max - min), 0, 1) * 100}%`);
  }
  if (select) select.value = String(value);
  const precision = forcedPrecision ?? (Math.abs(value) < 10 ? 2 : 1);
  row.querySelector('.pool-value').textContent = Number(value).toFixed(precision);
}

function applyState() {
  const u = water.material.uniforms;
  u.uStage.value = state.stage;
  u.uDebug.value = state.debug;
  u.uOpacity.value = state.opacity;
  u.uMaxDepth.value = state.maxDepth;
  u.uFadeStart.value = state.fadeStart;
  u.uWaveHeight.value = state.waveHeight;
  u.uWaveFreq.value = state.waveFreq;
  u.uWaveSpeed.value = state.waveSpeed;
  u.uWaveRotation.value = state.waveRotation;
  u.uChoppy.value = state.choppy;
  u.uDetail.value = state.detail;
  u.uNormalStrength.value = state.normalStrength;
  u.uRefraction.value = state.refraction;
  u.uAbsorption.value = state.absorption;
  u.uRoughness.value = state.roughness;
  u.uMetalness.value = state.metalness;
  u.uSpecular.value = state.specular;
  u.uFoam.value = state.foam;
  u.uFoamWidth.value = state.foamWidth;
}

function makePoolWater() {
  const geometry = new THREE.PlaneGeometry(12.0, 8.0, 220, 160);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    extensions: { derivatives: true },
    uniforms: {
      uTime: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
      uStage: { value: state.stage },
      uDebug: { value: state.debug },
      uOpacity: { value: state.opacity },
      uMaxDepth: { value: state.maxDepth },
      uFadeStart: { value: state.fadeStart },
      uWaveHeight: { value: state.waveHeight },
      uWaveFreq: { value: state.waveFreq },
      uWaveSpeed: { value: state.waveSpeed },
      uWaveRotation: { value: state.waveRotation },
      uChoppy: { value: state.choppy },
      uDetail: { value: state.detail },
      uNormalStrength: { value: state.normalStrength },
      uRefraction: { value: state.refraction },
      uAbsorption: { value: state.absorption },
      uRoughness: { value: state.roughness },
      uMetalness: { value: state.metalness },
      uSpecular: { value: state.specular },
      uFoam: { value: state.foam },
      uFoamWidth: { value: state.foamWidth },
    },
    vertexShader: /* glsl */`
      uniform float uTime;
      uniform float uStage;
      uniform float uWaveHeight;
      uniform float uWaveFreq;
      uniform float uWaveSpeed;
      uniform float uWaveRotation;
      uniform float uChoppy;
      varying vec3 vWorld;
      varying vec2 vPool;
      varying float vWave;

      mat2 rot(float a) {
        float c = cos(a), s = sin(a);
        return mat2(c, -s, s, c);
      }
      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
                   mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float seaOctave(vec2 uv, float choppy) {
        uv += noise(uv);
        vec2 wv = 1.0 - abs(sin(uv));
        vec2 swv = abs(cos(uv));
        wv = mix(wv, swv, wv);
        return pow(1.0 - pow(clamp(wv.x * wv.y, 0.0, 1.0), 0.65), max(0.5, choppy));
      }
      float waveHeight(vec2 xz) {
        if (uStage < 3.0) return 0.0;
        float freq = max(0.001, uWaveFreq);
        float amp = uWaveHeight;
        float chop = max(0.5, uChoppy);
        float t = uTime * uWaveSpeed;
        vec2 uv = rot(radians(uWaveRotation)) * xz;
        uv.x *= 0.75;
        float h = 0.0;
        mat2 octaveM = mat2(1.6, 1.2, -1.2, 1.6);
        for (int i = 0; i < 3; i++) {
          float d = seaOctave((uv + vec2(t, t * 0.63)) * freq, chop);
          d += seaOctave((uv - vec2(t * 0.34, t)) * freq, chop);
          h += (d - 1.0) * amp;
          uv = octaveM * uv;
          freq *= 1.9;
          amp *= 0.22;
          chop = mix(chop, 1.0, 0.2);
        }
        return h;
      }
      void main() {
        vec3 transformed = position;
        vec4 preWorld = modelMatrix * vec4(transformed, 1.0);
        float h = waveHeight(preWorld.xz);
        transformed.z += h;
        vec4 world = modelMatrix * vec4(transformed, 1.0);
        vWorld = world.xyz;
        vPool = preWorld.xz;
        vWave = h;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3 uCamPos;
      uniform float uStage;
      uniform float uDebug;
      uniform float uOpacity;
      uniform float uMaxDepth;
      uniform float uFadeStart;
      uniform float uWaveHeight;
      uniform float uWaveFreq;
      uniform float uWaveSpeed;
      uniform float uWaveRotation;
      uniform float uChoppy;
      uniform float uDetail;
      uniform float uNormalStrength;
      uniform float uRefraction;
      uniform float uAbsorption;
      uniform float uRoughness;
      uniform float uMetalness;
      uniform float uSpecular;
      uniform float uFoam;
      uniform float uFoamWidth;
      varying vec3 vWorld;
      varying vec2 vPool;
      varying float vWave;

      mat2 rot(float a) {
        float c = cos(a), s = sin(a);
        return mat2(c, -s, s, c);
      }
      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
                   mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float capsuleMask(vec2 p, vec2 a, vec2 b, float r) {
        vec2 pa = p - a, ba = b - a;
        float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        return 1.0 - smoothstep(r, r + 0.08, length(pa - ba * h));
      }
      float circleMask(vec2 p, vec2 c, float r) {
        return 1.0 - smoothstep(r, r + 0.08, length(p - c));
      }
      float boxMask(vec2 p, vec2 c, vec2 b) {
        vec2 d = abs(p - c) - b;
        return 1.0 - smoothstep(0.0, 0.08, length(max(d, 0.0)) + min(max(d.x, d.y), 0.0));
      }
      vec4 poolDepth(vec2 p) {
        float basin = mix(1.15, uMaxDepth, smoothstep(0.0, 6.0, length(p * vec2(0.72, 1.0))));
        basin += 0.35 * smoothstep(-3.5, 3.8, p.y);
        float sphere = circleMask(p, vec2(-2.55, 0.72), 1.45);
        float column = circleMask(p, vec2(2.72, 0.58), 0.78);
        float cube = boxMask(p, vec2(0.56, -0.15), vec2(0.47, 0.47));
        float small = boxMask(p, vec2(1.0, -1.55), vec2(0.26, 0.26));
        float objectMask = clamp(max(max(sphere, column), max(cube, small)), 0.0, 1.0);
        float objectDepth = mix(0.25, 0.08, max(column, cube));
        float d = mix(basin, objectDepth, objectMask);
        float edge = 1.0 - smoothstep(5.65, 6.0, abs(p.x)) * smoothstep(3.65, 4.0, abs(p.y));
        return vec4(clamp(d / max(0.001, uMaxDepth), 0.0, 1.0), objectMask, edge, d);
      }
      vec3 waveNormal() {
        vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
        if (n.y < 0.0) n = -n;
        return normalize(mix(vec3(0.0, 1.0, 0.0), n, clamp(uNormalStrength, 0.0, 2.0)));
      }
      void main() {
        vec3 n = waveNormal();
        float detailGate = step(4.0, uStage);
        vec2 basis = rot(radians(uWaveRotation)) * vPool;
        vec2 dirA = normalize(rot(radians(uWaveRotation)) * vec2(1.0, 0.33));
        vec2 dirB = normalize(rot(radians(uWaveRotation + 71.0)) * vec2(-0.25, 1.0));
        float t = uTime * uWaveSpeed;
        float broad = noise(basis * max(0.001, uWaveFreq) * 2.1 + dirA * t * 0.72);
        float fine = noise(basis * max(0.001, uWaveFreq) * 8.5 - dirB * t * 0.48);
        float detail = mix(broad, fine, clamp(uDetail, 0.0, 1.0));
        vec2 refractOffset = n.xz * uRefraction * step(5.0, uStage) + (detail - 0.5) * 0.08 * step(5.0, uStage);
        vec4 sampleData = poolDepth(vPool + refractOffset);
        float depth01 = sampleData.r;
        float objectMask = sampleData.g;
        float poolMask = sampleData.b;

        vec3 baseTint = vec3(0.439, 0.973, 1.0);
        vec3 deepTint = vec3(0.0, 0.341, 0.29);
        vec3 fogTint = vec3(0.0, 0.05, 0.1);
        float fogRatio = clamp((sampleData.a - uFadeStart) / max(0.001, uMaxDepth - uFadeStart), 0.0, 1.0);
        vec3 waterColor = baseTint;
        if (uStage >= 1.0) waterColor = vec3(depth01);
        if (uStage >= 2.0) waterColor = mix(baseTint, fogTint, fogRatio);
        if (uStage >= 6.0) {
          vec3 absorbed = mix(baseTint, deepTint, 1.0 - exp(-sampleData.a * max(0.0, uAbsorption) * 0.35));
          waterColor = mix(waterColor, absorbed, 0.85);
        }
        waterColor += detailGate * (detail - 0.5) * vec3(0.035, 0.08, 0.09);

        vec3 L = normalize(vec3(-0.36, 0.78, 0.50));
        vec3 V = normalize(uCamPos - vWorld);
        vec3 H = normalize(L + V);
        float ndl = max(dot(n, L), 0.0);
        float fresnel = pow(1.0 - max(dot(n, V), 0.0), 5.0);
        float gloss = mix(96.0, 7.0, clamp(uRoughness, 0.02, 1.0));
        float spec = pow(max(dot(n, H), 0.0), gloss) * uSpecular * step(7.0, uStage);
        vec3 sunCol = vec3(1.0, 0.93, 0.82);
        waterColor = mix(waterColor, waterColor * (0.33 + 0.67 * ndl), step(7.0, uStage));
        waterColor = mix(waterColor, vec3(dot(waterColor, vec3(0.299, 0.587, 0.114))), clamp(uMetalness, 0.0, 1.0) * step(7.0, uStage));
        waterColor += sunCol * (spec + fresnel * 0.18 * step(7.0, uStage));

        float shore = 1.0 - smoothstep(0.0, max(0.001, uFoamWidth), sampleData.a);
        float crest = smoothstep(0.18, 0.52, abs(vWave)) * (0.45 + 0.55 * detail);
        float foam = clamp((shore * (1.0 - objectMask) + crest * 0.55) * uFoam * step(8.0, uStage), 0.0, 1.0);
        waterColor = mix(waterColor, vec3(0.92, 1.0, 0.98), foam);

        if (uDebug > 0.5) {
          float m = floor(uDebug + 0.5);
          if (m == 1.0) waterColor = vec3(depth01);
          if (m == 2.0) waterColor = vec3(objectMask, shore, poolMask);
          if (m == 3.0) waterColor = vec3(fract(vWave * 3.0 + 0.5), detail, crest);
          if (m == 4.0) waterColor = n * 0.5 + 0.5;
          if (m == 5.0) waterColor = vec3(foam);
        }
        float alpha = clamp(uOpacity, 0.02, 1.0);
        alpha = mix(alpha * 0.64, alpha, smoothstep(0.04, 0.9, depth01));
        if (uStage <= 1.0) alpha = 0.76;
        gl_FragColor = vec4(waterColor, alpha);
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'PoolLabWater';
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0;
  mesh.renderOrder = 10;
  return mesh;
}

window.poolLab = { scene, camera, renderer, water, state, applyState, applyPose };
window.isometric = window.poolLab;
