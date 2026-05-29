import * as THREE from 'three';
import { TransmittanceLUT } from '../atmosphere/TransmittanceLUT.js';
import { SkyViewLUT } from '../atmosphere/SkyViewLUT.js';
import { SkyBackdrop } from '../atmosphere/SkyBackdrop.js';
import { PLANET } from '../atmosphere/constants.js';
import { FlyCameraDirector } from '../camera/FlyCameraDirector.js';
import { CameraDirector } from '../camera/CameraDirector.js';
import { OrbitSweepController } from '../automation/OrbitSweepController.js';
import { generateIsland } from '../gen/terrain.js';
import { buildIslandMesh } from '../voxel/mesher.js';
import { Sea } from '../water/Sea.js';
import { chooseTreeSlot, makeTreeBankTree } from '../flora/treeBank.js';
import { fbm2, mulberry32 } from '../gen/noise.js';
import { SEASON } from '../gen/seasons.js';
import { MAT } from '../gen/palette.js';
import { PostFX } from '../fx/PostFX.js';

// Atmosphere lives in km on a 6371 km planet; the island lives in metres at
// ~1 km scale. We feed the sky a FIXED observer just above the surface (the
// island is negligible against a 100 km shell) and the camera's rotation for
// ray direction. Fog blends the bounded sea edge into the horizon (PLAN §9).
const OBSERVER = new THREE.Vector3(0, PLANET.groundRadius + 0.35, 0);
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const SHADOW_FILTER_TYPES = [THREE.BasicShadowMap, THREE.PCFShadowMap, THREE.PCFSoftShadowMap];
const LAB_CLEAR = new THREE.Color('#081018');
const DIAG_MAGENTA = new THREE.Color('#ff00ff');
const MOBILE_PROFILE = detectMobileRenderProfile();

export class Scene {
  constructor(container, store, options = {}) {
    this.container = container;
    this.store = store;
    this.loader = options.loader || null;
    this.elapsed = 0;
    this.treeCount = 0;
    this._terrainDirty = false;
    this._regenTimer = null;
    this._regenToken = 0;
    this._hasGenerated = false;
    this.asyncRegenerate = !!options.asyncRegenerate;
    this.SeaClass = options.SeaClass || Sea;
    this.afterGenerate = options.afterGenerate || null;

    this.mobileProfile = MOBILE_PROFILE;
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.mobileProfile.mobile,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.mobileProfile.pixelRatioCap));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = store.get('render.exposure');
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    const fov = store.get('render.fov');
    this.camera = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 0.5, 32000);
    this.camera.position.set(420, 230, 480);
    this.camera.lookAt(0, store.get('water.seaLevel') + 30, 0);

    // Atmosphere.
    this.transmittanceLUT = new TransmittanceLUT();
    this.skyViewLUT = new SkyViewLUT();
    this.skyViewLUT.setTransmittanceLUT(this.transmittanceLUT.texture);
    this.skyViewLUT.setObserverPosition(OBSERVER);
    this.backdrop = new SkyBackdrop();
    this.backdrop.setObserver(OBSERVER);
    this.backdrop.setLUTs(this.skyViewLUT.texture, this.transmittanceLUT.texture);
    this.scene.add(this.backdrop.mesh);

    // Lights — directional sun + hemisphere fill (the §15 faceted-voxel
    // mitigation: flat normals stay readable under analytic sky light).
    this.sun = this._makeSunLight('SunPrimary');
    this.shadowSun = this._makeSunLight('SunCoarse');
    this.sunLayers = [this.sun, this.shadowSun];
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.scene.add(this.shadowSun);
    this.scene.add(this.shadowSun.target);
    this.hemi = new THREE.HemisphereLight(0xbfe3ff, 0x5a4630, 0.34);
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.05);
    this.scene.add(this.ambient);

    this.scene.fog = new THREE.FogExp2(0xbcd4d6, store.get('render.fogDensity'));

    this.islandGroup = new THREE.Group();
    this.treeGroup = new THREE.Group();
    this.scene.add(this.islandGroup);
    this.scene.add(this.treeGroup);
    this.sea = null;

    this.camDirector = new FlyCameraDirector(this.camera, this.renderer.domElement);
    this.autoCameraDirector = new CameraDirector(this.camera, this.camDirector, store);
    this.orbitSweep = new OrbitSweepController(store, this);

    // Planet-R used to be an experimental hook; it is now a normal atmosphere
    // slider, with setExperimental kept as a compatibility shim for scripts.
    this.postfx = new PostFX(this.renderer);
    this.takramRig = null;

    this._applyShadowSettings();
    this._applyAll();
    if (options.autoGenerate !== false) this.regenerate();

    store.subscribe((evt) => this._onParam(evt));
    window.addEventListener('resize', () => this._onResize());
    this.clock = new THREE.Clock();
  }

  _makeSunLight(name) {
    const light = new THREE.DirectionalLight(0xfff2dc, 0);
    light.name = name;
    light.castShadow = true;
    light.shadow.bias = -0.0006;
    light.shadow.normalBias = 2.2;          // chunky flat-shaded voxels
    light.shadow.radius = 1;
    return light;
  }

  // ---- generation ----
  regenerate() {
    // An explicit regen supersedes any debounced one — prevents a second,
    // late rebuild (the "delayed fade redraw" / double island).
    if (this._regenTimer) { clearTimeout(this._regenTimer); this._regenTimer = null; }
    this._regenToken++;
    this.loader?.start('island asset build', 8, { mode: this._hasGenerated ? 'transition' : 'boot' });
    const s = this.store;
    const opts = this._buildGenOptions(s);
    this.loader?.step('params', `seed=${opts.seed} res=${opts.resolution}`);

    const vol = generateIsland(opts);
    this.vol = vol;
    this.loader?.step('terrain', `${vol.res}x${vol.res}`);

    this._applyShadowBounds(opts);
    this.loader?.step('shadow bounds');

    // Island mesh.
    this.islandGroup.clear();
    if (this._islandMesh) this._islandMesh.geometry.dispose();
    this.loader?.step('clear meshes');
    this._islandMesh = buildIslandMesh(vol, opts.seed);
    this.islandGroup.add(this._islandMesh);
    this.loader?.step('island mesh', `${this._islandMesh.geometry.getAttribute('position')?.count || 0} verts`);

    // Sea (rebuilt sized to the new world).
    if (this.sea) this.scene.remove(this.sea.group);
    this.sea = new this.SeaClass(this._seaParams(vol, opts, s));
    this.scene.add(this.sea.group);
    this._applyWaterLighting();          // fresh sea gets current sun + glint
    this.loader?.step('sea');

    const planted = this._plantTrees(vol, opts);
    this.treeCount = planted.treeCount;
    this.treeCounts = planted.treeCounts;
    this.loader?.step('trees', `${this.treeCount}`);
    this.loader?.done('ready');
    this._hasGenerated = true;
    this.afterGenerate?.(this);
    this._applySkyDiagnosis();
  }

  async regenerateAsync(label = 'scene rebuild') {
    if (this._regenTimer) { clearTimeout(this._regenTimer); this._regenTimer = null; }
    const token = ++this._regenToken;
    const mode = this._hasGenerated ? 'transition' : 'boot';
    const stale = () => token !== this._regenToken;
    const yieldStep = async (name, detail = '') => {
      this.loader?.step(name, detail);
      await nextFrame();
      return stale();
    };

    this.loader?.start(label, 9, { mode });
    await nextFrame();
    if (stale()) return false;

    const opts = this._buildGenOptions(this.store);
    if (await yieldStep('params', `seed=${opts.seed} res=${opts.resolution}`)) return false;

    const vol = generateIsland(opts);
    if (await yieldStep('terrain', `${vol.res}x${vol.res}`)) return false;

    const nextSea = new this.SeaClass(this._seaParams(vol, opts, this.store));
    if (await yieldStep('sea')) return false;

    const nextIslandMesh = buildIslandMesh(vol, opts.seed);
    const verts = nextIslandMesh.geometry.getAttribute('position')?.count || 0;
    if (await yieldStep('island mesh', `${verts} verts`)) {
      nextIslandMesh.geometry.dispose();
      return false;
    }

    const nextTreeGroup = new THREE.Group();
    nextTreeGroup.name = 'Trees';
    const planted = this._plantTrees(vol, opts, nextTreeGroup);
    if (await yieldStep('trees', `${planted.treeCount}`)) return false;

    this._applyShadowBounds(opts);
    if (await yieldStep('shadow bounds')) return false;

    this._swapGeneratedAssets(vol, nextIslandMesh, nextSea, nextTreeGroup, planted);
    this.loader?.step('swap');
    this.loader?.done('ready');
    this._hasGenerated = true;
    this.afterGenerate?.(this);
    this._applySkyDiagnosis();
    return true;
  }

  _buildGenOptions(s) {
    const opts = {
      seed: s.get('voxel.seed') | 0,
      radius: s.get('island.radius'),
      shape: s.get('island.shape') | 0,
      resolution: s.get('voxel.resolution') | 0,
      lowland: s.get('island.lowland'),
      massif: s.get('island.massif'),
      massifSharpness: s.get('island.massifSharpness'),
      massifOffsetX: s.get('island.massifOffsetX'),
      massifOffsetZ: s.get('island.massifOffsetZ'),
      terraceStep: s.get('voxel.terraceStep'),
      warp: s.get('island.warp'),
      ridge: s.get('island.ridge'),
      beachWidth: s.get('island.beachWidth'),
      valleyDepth: s.get('island.valleyDepth'),
      valleyWidth: s.get('island.valleyWidth'),
      lagoon: {
        enable: s.get('lagoon.enable') !== false,
        x: s.get('lagoon.x'),
        z: s.get('lagoon.z'),
        radiusX: s.get('lagoon.radiusX'),
        radiusZ: s.get('lagoon.radiusZ'),
        rotation: s.get('lagoon.rotation'),
        depth: s.get('lagoon.depth'),
        lowlandCap: s.get('lagoon.lowlandCap'),
        inlet: s.get('lagoon.inlet'),
        apronWidth: s.get('lagoon.apronWidth'),
        whiteSand: s.get('lagoon.whiteSand'),
        treeAttraction: s.get('lagoon.treeAttraction'),
      },
      seaLevel: s.get('water.seaLevel'),
      floorDepth: s.get('water.floorDepth'),
      floorShape: s.get('water.floorShape'),
      floorRoughness: s.get('water.floorRoughness'),
      deltaFloor: s.get('water.deltaFloor'),
      seasons: {
        sweepDeg: s.get('seasons.sweepDeg'),
        summerEnd: s.get('seasons.summerEnd'),
        autumnEnd: s.get('seasons.autumnEnd'),
        coniferEnd: s.get('seasons.coniferEnd'),
        borderWarp: s.get('seasons.borderWarp'),
        craggy: s.get('seasons.craggy'),
        fairway: s.get('seasons.fairway'),
        fairwayBand: s.get('seasons.fairwayBand'),
        bunkerDensity: s.get('seasons.bunkerDensity'),
        bunkerSize: s.get('seasons.bunkerSize'),
      },
      treeEnable: s.get('tree.enable') !== false,
      treeTotalCount: s.get('tree.totalCount') | 0,
      treeGlobalScale: s.get('tree.globalScale'),
      treeSpacing: s.get('tree.spacing'),
      treeClusterBias: s.get('tree.clusterBias'),
      treeAutumnWeight: s.get('tree.autumnWeight'),
      treeSummerWeight: s.get('tree.summerWeight'),
      treeSpruceWeight: s.get('tree.spruceWeight'),
      treePalmWeight: s.get('tree.palmWeight'),
      treePalmTarget: s.get('tree.palmTarget') | 0,
      treePeakSparse: s.get('tree.peakSparse'),
      treeOpenCuts: s.get('tree.openCuts'),
      treeAutumnScale: s.get('tree.autumnScale'),
      treeSpruceScale: s.get('tree.spruceScale'),
      treePalmScale: s.get('tree.palmScale'),
    };
    opts.maxHeight = opts.lowland + opts.massif;
    return opts;
  }

  _seaParams(vol, opts, s = this.store) {
    return {
      ...(s.get('water') || {}),
      ...(s.get('waves') || {}),
      worldSize: vol.worldSize,
      volume: vol,
      radius: opts.radius,
      seaLevel: opts.seaLevel,
      floorDepth: opts.floorDepth,
    };
  }

  _applyShadowBounds(opts) {
    this._lastShadowOpts = opts;
    this._applyShadowBoundsFor(this.sun, opts, this.store.get('shadows.primaryCoverage') ?? 1);
    this._applyShadowBoundsFor(this.shadowSun, opts, this.store.get('shadows.secondaryCoverage') ?? 1);
  }

  _applyShadowBoundsFor(light, opts, coverage = 1) {
    if (!light?.shadow?.camera || !opts) return;
    const cover = THREE.MathUtils.clamp(Number(coverage) || 1, 0.25, 2);
    const r = opts.radius * 1.4 * cover;
    const sc = light.shadow.camera;
    sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r;
    sc.near = Math.max(50, 6000 - r - opts.maxHeight - 600);
    sc.far = 6000 + r + 600;
    sc.updateProjectionMatrix();
    light.shadow.needsUpdate = true;
  }

  _swapGeneratedAssets(vol, islandMesh, sea, treeGroup, planted) {
    this.vol = vol;
    this.islandGroup.clear();
    if (this._islandMesh) this._islandMesh.geometry.dispose();
    this._islandMesh = islandMesh;
    this.islandGroup.add(this._islandMesh);

    if (this.sea) this.scene.remove(this.sea.group);
    this.sea = sea;
    this.scene.add(this.sea.group);
    this._applyWaterLighting();

    this.scene.remove(this.treeGroup);
    this.treeGroup = treeGroup;
    this.scene.add(this.treeGroup);
    this.treeCount = planted.treeCount;
    this.treeCounts = planted.treeCounts;
  }

  _plantTrees(vol, opts, targetGroup = this.treeGroup) {
    targetGroup.clear();
    const rand = mulberry32((opts.seed * 2654435761) >>> 0);
    const counts = {
      palmFringe: 0,
      summerCanopy: 0,
      autumnCanopy: 0,
      spruceMix: 0,
      peakSparse: 0,
      accentTrees: 0,
    };
    if (!opts.treeEnable) return { treeCount: 0, treeCounts: counts };

    const clamp01 = (v) => THREE.MathUtils.clamp(Number(v) || 0, 0, 1);
    const smooth01 = (e0, e1, x) => {
      const t = clamp01((x - e0) / (e1 - e0 || 1));
      return t * t * (3 - 2 * t);
    };
    const slopeAt = (i, j, idx) => {
      const h = vol.heightVox[idx] * vol.vstep;
      let maxD = 0;
      const ns = [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]];
      for (const [ni, nj] of ns) {
        if (!vol.inBounds(ni, nj)) continue;
        maxD = Math.max(maxD, Math.abs(h - vol.heightVox[vol.idx(ni, nj)] * vol.vstep));
      }
      return maxD / Math.max(1, vol.cellSize);
    };
    const lagoonInfluence = (x, z) => {
      const l = opts.lagoon || {};
      if (l.enable === false) return 0;
      const cx = (l.x ?? 0) * opts.radius;
      const cz = (l.z ?? 0) * opts.radius;
      const a = THREE.MathUtils.degToRad(l.rotation ?? 0);
      const ca = Math.cos(a), sa = Math.sin(a);
      const dx = x - cx, dz = z - cz;
      const lx = dx * ca + dz * sa;
      const lz = -dx * sa + dz * ca;
      const rx = Math.max(1, l.radiusX ?? 230);
      const rz = Math.max(1, l.radiusZ ?? 135);
      const d = Math.hypot(lx / rx, lz / rz);
      const apron = (l.apronWidth ?? 42) / Math.max(rx, rz);
      return 1 - clamp01((d - 0.86) / Math.max(0.08, apron + 0.12));
    };
    const inBand = (idx, m) => {
      if (!vol.land[idx]) return false;
      if (m === MAT.ROCK || m === MAT.SEAFLOOR) return false;
      const y = vol.heightVox[idx] * vol.vstep;
      return y >= opts.seaLevel + 0.4 && y <= opts.seaLevel + opts.maxHeight * 0.82;
    };
    const layerScale = (slot) => {
      if (slot.layer === 'palmFringe') return opts.treePalmScale ?? 0.92;
      if (slot.layer === 'autumnCanopy') return opts.treeAutumnScale ?? 1.08;
      if (slot.layer === 'spruceMix' || slot.layer === 'peakSparse') return opts.treeSpruceScale ?? 1.08;
      return 1;
    };
    const place = (layer, i, j, idx, scaleMul = 1) => {
      const slot = chooseTreeSlot(layer, rand);
      const tree = makeTreeBankTree(slot, ((rand() * 1e9) | 0) ^ idx);
      if (!tree) return false;
      const y = vol.heightVox[idx] * vol.vstep;
      const [wx, wz] = vol.cellToWorld(i, j);
      tree.position.set(wx, y - 0.5, wz);
      const slotScale = slot.scale ?? 1;
      const globalScale = opts.treeGlobalScale ?? 1.08;
      const heightJitter = layer === 'palmFringe'
        ? 0.78 + rand() * 0.38
        : layer === 'peakSparse'
          ? 0.58 + rand() * 0.64
          : 0.64 + Math.pow(rand(), 0.72) * 0.98;
      tree.scale.setScalar(heightJitter * globalScale * slotScale * layerScale(slot) * scaleMul);
      tree.rotation.y = rand() * Math.PI * 2;
      targetGroup.add(tree);
      counts[layer] = (counts[layer] || 0) + 1;
      return true;
    };

    const target = Math.max(0, Math.min(2600, opts.treeTotalCount ?? 1300));
    const spacing = Math.max(4, opts.treeSpacing ?? 9);
    const clusterBias = clamp01(opts.treeClusterBias ?? 1);
    const openCuts = clamp01(opts.treeOpenCuts ?? 0.6);
    const occupied = new Set();
    const candidates = [];
    const stride = Math.max(4, Math.floor(vol.res / 150));
    for (let j = 2; j < vol.res - 2; j += stride) {
      for (let i = 2; i < vol.res - 2; i += stride) {
        const idx = vol.idx(i, j);
        const m = vol.material[idx];
        if (!inBand(idx, m) || m === MAT.SAND || m === MAT.WHITE_SAND) continue;
        const y = vol.heightVox[idx] * vol.vstep;
        const alt = clamp01((y - opts.seaLevel) / Math.max(1, opts.maxHeight));
        const slope = slopeAt(i, j, idx);
        if (slope > 0.68 || alt < 0.16 || alt > 0.70) continue;
        const [x, z] = vol.cellToWorld(i, j);
        const season = vol.season[idx];
        const autumn = season === SEASON.AUTUMN ? 1 : 0;
        const conifer = season === SEASON.CONIFER ? 1 : 0;
        const dirt = m === MAT.DIRT ? 1 : 0;
        const fairway = m === MAT.FAIRWAY ? 1 : 0;
        const midSlope = smooth01(0.16, 0.34, alt) * (1 - smooth01(0.58, 0.78, alt));
        const broad = fbm2(x * 0.00125 + 11.3, z * 0.00125 - 6.7, { seed: opts.seed + 913, octaves: 3, gain: 0.58, warp: 0.72 });
        const grove = fbm2(x * 0.0048 - 13.4, z * 0.0048 + 9.6, { seed: opts.seed + 1409, octaves: 4, gain: 0.54, warp: 0.42 });
        const open = fbm2(x * 0.0012 - 23.1, z * 0.0012 + 19.4, { seed: opts.seed + 1777, octaves: 3, gain: 0.52, warp: 0.8 });
        const score = (0.25 + broad * 0.55 + grove * 0.35)
          * (0.45 + midSlope * 1.3 + autumn * 0.62 + dirt * 0.55 + conifer * 0.25 + (season === SEASON.SUMMER ? 0.38 : 0))
          * smooth01(openCuts * 0.44, openCuts * 1.05 + 0.18, open)
          * (fairway ? 0.76 : 1);
        if (score > 0.08) {
          candidates.push({
            x, z, score, season, alt,
            radius: THREE.MathUtils.lerp(45, 135, clamp01(score * 0.55)),
          });
        }
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const groveCenters = [];
    const maxCenters = 24;
    const canAddCenter = (c, distanceMul = 0.58) => {
      for (const g of groveCenters) {
        if (Math.hypot(c.x - g.x, c.z - g.z) < Math.max(72, (c.radius + g.radius) * distanceMul)) return false;
      }
      return true;
    };
    const sectors = Array.from({ length: 10 }, () => []);
    for (const c of candidates) {
      const a = Math.atan2(c.z, c.x);
      const sector = Math.floor(((a + Math.PI) / (Math.PI * 2)) * sectors.length) % sectors.length;
      sectors[sector].push(c);
    }
    for (let pass = 0; pass < 2; pass++) {
      for (const bucket of sectors) {
        const c = bucket.find((candidate) => canAddCenter(candidate, pass === 0 ? 0.66 : 0.52));
        if (!c) continue;
        groveCenters.push(c);
        if (groveCenters.length >= maxCenters) break;
      }
      if (groveCenters.length >= maxCenters) break;
    }
    for (const c of candidates) {
      if (!canAddCenter(c, 0.50)) continue;
      groveCenters.push(c);
      if (groveCenters.length >= maxCenters) break;
    }
    if (!groveCenters.length) groveCenters.push({ x: 0, z: 0, score: 0.5, season: SEASON.SUMMER, alt: 0.35, radius: 120 });

    let planted = 0;
    let guard = 0;
    const cap = target * 130 + 2000;
    while (planted < target && guard < cap) {
      guard++;
      const center = groveCenters[(rand() * groveCenters.length) | 0];
      const angle = rand() * Math.PI * 2;
      const dist = Math.sqrt(rand()) * center.radius * (0.40 + rand() * 0.78);
      const [i, j] = vol.worldToCell(center.x + Math.cos(angle) * dist, center.z + Math.sin(angle) * dist);
      if (!vol.inBounds(i, j)) continue;
      const idx = vol.idx(i, j);
      const m = vol.material[idx];
      if (!inBand(idx, m)) continue;
      const y = vol.heightVox[idx] * vol.vstep;
      const alt = clamp01((y - opts.seaLevel) / Math.max(1, opts.maxHeight));
      const slope = slopeAt(i, j, idx);
      const [wx, wz] = vol.cellToWorld(i, j);
      const centerFalloff = 1 - clamp01(Math.hypot(wx - center.x, wz - center.z) / Math.max(1, center.radius));
      if (centerFalloff <= 0) continue;

      const broadGrove = fbm2(wx * 0.00145 + 11.3, wz * 0.00145 - 6.7, {
        seed: opts.seed + 913,
        octaves: 3,
        gain: 0.58,
        warp: 0.72,
      });
      const grove = fbm2(wx * 0.0062 - 13.4, wz * 0.0062 + 9.6, {
        seed: opts.seed + 1409,
        octaves: 4,
        gain: 0.54,
        warp: 0.42,
      });
      const open = fbm2(wx * 0.0014 - 23.1, wz * 0.0014 + 19.4, {
        seed: opts.seed + 1777,
        octaves: 3,
        gain: 0.52,
        warp: 0.8,
      });
      const lagoonPull = lagoonInfluence(wx, wz) * (opts.lagoon?.treeAttraction ?? 1.1);
      const fairway = m === MAT.FAIRWAY;
      const sand = m === MAT.SAND || m === MAT.WHITE_SAND;
      const snowy = m === MAT.SNOW || m === MAT.GRASSY_SNOW;
      const dirt = m === MAT.DIRT;
      const season = vol.season[idx];
      const midSlope = smooth01(0.13, 0.30, alt) * (1 - smooth01(0.58, 0.78, alt));
      const mountainForest = midSlope * (1 - smooth01(0.52, 0.86, slope));
      const autumnPull = (season === SEASON.AUTUMN ? 0.18 : 0) + (dirt ? 0.12 : 0);
      const coastFade = smooth01(0.10, 0.22, alt);
      const broadCore = smooth01(0.54 - clusterBias * 0.12, 0.80 - clusterBias * 0.08, broadGrove);
      const groveCore = smooth01(0.48 - clusterBias * 0.10, 0.78 - clusterBias * 0.08, grove);
      const openMask = smooth01(openCuts * 0.52, openCuts * 1.12 + 0.12, open);
      const centerMask = smooth01(0.02, 0.85, centerFalloff) * (0.55 + center.score * 0.35);
      const forestMask = clamp01((centerMask + broadCore * 0.18 + groveCore * 0.14 + mountainForest * 0.22 + autumnPull + lagoonPull * 0.06) * openMask * coastFade);
      const palmGroveMask = sand ? broadCore * groveCore * openMask * 0.48 : 0;
      const fringeMask = clamp01(Math.max(forestMask, lagoonPull * 0.42, palmGroveMask));
      if (fringeMask < 0.18) continue;
      if (rand() > Math.pow(THREE.MathUtils.lerp(0.22, 0.99, fringeMask), 0.85)) continue;

      const localSpacing = spacing * THREE.MathUtils.lerp(1.7, 0.58, forestMask);
      const occKey = `${Math.round(wx / localSpacing)},${Math.round(wz / localSpacing)}`;
      if (occupied.has(occKey)) continue;

      const weights = {
        palmFringe: ((opts.treePalmWeight ?? 0.25) * (sand ? 0.75 : fairway ? 0.04 : 0.008) * Math.pow(1 - alt, 1.7) + lagoonPull * 0.22) * fringeMask,
        summerCanopy: (opts.treeSummerWeight ?? 0.95) * (season === SEASON.SUMMER ? 1.0 : 0.16) * (0.4 + (1 - alt)) * forestMask,
        autumnCanopy: (opts.treeAutumnWeight ?? 1.55) * (season === SEASON.AUTUMN ? 1.25 : 0.12) * (0.44 + alt * 1.15) * (1 + mountainForest * 1.85) * forestMask,
        spruceMix: (opts.treeSpruceWeight ?? 0.75) * (season === SEASON.CONIFER ? 1.1 : 0.08) * (0.22 + alt * alt * 1.4) * forestMask,
        peakSparse: (opts.treePeakSparse ?? 0.08) * (season === SEASON.WINTER ? 1.2 : 0.08) * (alt * alt * 1.25) * forestMask,
      };

      if (fairway) {
        weights.summerCanopy *= 0.30;
        weights.autumnCanopy *= 0.22;
        weights.spruceMix *= 0.04;
        weights.peakSparse = 0;
      }
      if (sand) {
        weights.summerCanopy *= 0.08;
        weights.autumnCanopy *= 0.04;
        weights.spruceMix = 0;
        weights.peakSparse = 0;
      }
      if (snowy || alt > 0.72) {
        weights.palmFringe = 0;
        weights.summerCanopy *= 0.02;
        weights.autumnCanopy *= 0.08;
        weights.spruceMix *= 0.38;
        weights.peakSparse *= 1.35;
      }
      if (dirt) {
        weights.palmFringe *= 0.08;
        weights.autumnCanopy *= 1.55;
        weights.spruceMix *= 0.9;
      }
      if (slope > 0.72) {
        weights.palmFringe = 0;
        weights.summerCanopy *= 0.03;
        weights.autumnCanopy *= 0.16;
        weights.spruceMix *= 0.35;
        weights.peakSparse *= 0.7;
      }

      const totalWeight = Object.values(weights).reduce((sum, v) => sum + Math.max(0, v), 0);
      if (totalWeight <= 0.0001) continue;
      let roll = rand() * totalWeight;
      let layer = 'summerCanopy';
      for (const [key, value] of Object.entries(weights)) {
        roll -= Math.max(0, value);
        if (roll <= 0) { layer = key; break; }
      }
      const scaleMul = layer === 'peakSparse'
        ? 0.68
        : layer === 'palmFringe'
          ? 0.88
          : 1.08 + forestMask * 0.34 + grove * 0.10;
      if (!place(layer, i, j, idx, scaleMul)) continue;
      occupied.add(occKey);
      planted++;
    }

    // Palms are allowed to pepper coast / lagoon / fairway fringe separately
    // from grove centers. The grove allocator intentionally prefers inland
    // forest cores, which otherwise starves the classic palm look.
    const palmTarget = Math.max(0, Math.min(900, opts.treePalmTarget ?? 400));
    let palmGuard = 0;
    while (counts.palmFringe < palmTarget && palmGuard < palmTarget * 260 + 800) {
      palmGuard++;
      const a = rand() * Math.PI * 2;
      const r = Math.pow(0.42 + rand() * 0.56, 0.82) * opts.radius;
      const [i, j] = vol.worldToCell(Math.cos(a) * r, Math.sin(a) * r);
      if (!vol.inBounds(i, j)) continue;
      const idx = vol.idx(i, j);
      const m = vol.material[idx];
      if (!inBand(idx, m)) continue;
      const y = vol.heightVox[idx] * vol.vstep;
      const alt = clamp01((y - opts.seaLevel) / Math.max(1, opts.maxHeight));
      const slope = slopeAt(i, j, idx);
      const [wx, wz] = vol.cellToWorld(i, j);
      const lagoonPull = lagoonInfluence(wx, wz);
      const palmCell = (
        (m === MAT.SAND || m === MAT.WHITE_SAND || m === MAT.FAIRWAY) ||
        (m === MAT.GRASS && alt < 0.28) ||
        lagoonPull > 0.18
      );
      if (!palmCell || slope > 0.55 || alt > 0.42) continue;
      const localSpacing = spacing * THREE.MathUtils.lerp(1.1, 2.4, rand());
      const occKey = `${Math.round(wx / localSpacing)},${Math.round(wz / localSpacing)}`;
      if (occupied.has(occKey)) continue;
      if (!place('palmFringe', i, j, idx, 0.76 + rand() * 0.24)) continue;
      occupied.add(occKey);
      planted++;
    }

    return { treeCount: planted, treeCounts: counts };
  }

  // ---- params ----
  _effectiveSun() {
    const s = this._sunOverride || {};
    return {
      elevationDeg: s.elevationDeg ?? this.store.get('sun.elevationDeg'),
      azimuthDeg: s.azimuthDeg ?? this.store.get('sun.azimuthDeg'),
      intensity: s.intensity ?? this.store.get('sun.intensity'),
    };
  }

  _sunDir(sun = this._effectiveSun()) {
    const el = THREE.MathUtils.degToRad(sun.elevationDeg);
    const az = THREE.MathUtils.degToRad(sun.azimuthDeg);
    const ce = Math.cos(el);
    return new THREE.Vector3(ce * Math.cos(az), Math.sin(el), ce * Math.sin(az)).normalize();
  }

  getSunDirection() {
    return this._sunDir();
  }

  _shadowLayerWeights() {
    const s = this.store;
    const primaryOn = !!s.get('shadows.primaryEnable');
    const secondaryOn = !!s.get('shadows.secondaryEnable');
    const mix = THREE.MathUtils.clamp(s.get('shadows.secondaryMix') ?? 0.22, 0, 1);
    const addEnergy = THREE.MathUtils.clamp(s.get('lighting.secondaryEnergy') ?? 0.55, 0, 1.5);
    const mode = s.get('shadows.blendMode') | 0;
    if (mode === 1) return { primary: primaryOn ? 1 : 0, secondary: secondaryOn ? mix * addEnergy : 0 };
    if (primaryOn && secondaryOn) return { primary: 1 - mix, secondary: mix };
    return { primary: primaryOn ? 1 : 0, secondary: secondaryOn ? 1 : 0 };
  }

  _applyAll() {
    const s = this.store;
    this._applySunLighting();

    this.transmittanceLUT.setAtmosphere({
      rayleighMul: s.get('atmosphere.rayleighMul'),
      mieBeta: s.get('atmosphere.mieBeta'),
      ozoneMul: s.get('atmosphere.ozoneMul'),
    });
    this.skyViewLUT.setAtmosphere({
      rayleighMul: s.get('atmosphere.rayleighMul'),
      mieBeta: s.get('atmosphere.mieBeta'),
      ozoneMul: s.get('atmosphere.ozoneMul'),
    });
    this.skyViewLUT.setMieG(s.get('atmosphere.mieG'));
    this._applyPlanetR();

    const diag = s.get('skyDiagnosis') || {};
    const hw = diag.disableHorizonWarp ? false : s.get('render.horizonWarp');
    this.skyViewLUT.setHorizonWarp(hw);
    this.backdrop.setHorizonWarp(hw);

    this.renderer.toneMappingExposure = s.get('render.exposure');
    this.camera.fov = s.get('render.fov');
    this.camera.updateProjectionMatrix();
    this.scene.fog.density = s.get('render.fogDensity');
    this._applyTakramSettings();
    this._applySkyDiagnosis();
  }

  _applySunLighting() {
    const s = this.store;
    const sun = this._effectiveSun();
    const dir = this._sunDir(sun);
    const intensity = sun.intensity;
    this.skyViewLUT.setSunDir(dir);
    this.skyViewLUT.setSunIntensity(intensity);
    this.backdrop.setSun({ direction: dir, intensity });
    // ---- island lighting driven by the sun (NOT the atmosphere code) ----
    // The voxel island relights with the sky: warm + low-key at sunset,
    // bright + neutral at noon, warm-dark fill on the shaded side (never the
    // dead pale-blue wash). Drag the existing sun slider → island follows.
    const elDeg = sun.elevationDeg;
    const day = THREE.MathUtils.clamp((elDeg + 6) / 28, 0, 1);   // dusk→noon
    const day2 = day * day * (3 - 2 * day);
    const elevationGain = THREE.MathUtils.clamp(s.get('lighting.sunElevationGain') ?? 0.45, 0, 1);
    const sunFloor = THREE.MathUtils.clamp(s.get('lighting.sunFloor') ?? 0.8, 0, 4);
    const sunCeiling = Math.max(sunFloor + 0.01, THREE.MathUtils.clamp(s.get('lighting.sunCeiling') ?? 2.0, 0, 5));
    const slider = Math.pow(THREE.MathUtils.clamp(intensity / 22, 0.15, 3), 0.55);
    const gainDay = THREE.MathUtils.lerp(0.5, day2, elevationGain);

    const sunColor = new THREE.Color('#ff7a36').lerp(new THREE.Color('#fff3df'), day2);
    const directIntensity = THREE.MathUtils.lerp(sunFloor, sunCeiling, gainDay) * slider;
    const shadowWeights = this._shadowLayerWeights();
    for (const light of this.sunLayers) {
      light.position.copy(dir).multiplyScalar(6000);
      light.target.position.set(0, 0, 0);
      light.color.copy(sunColor);
    }
    this.sun.intensity = directIntensity * shadowWeights.primary;
    this.shadowSun.intensity = directIntensity * shadowWeights.secondary;
    const shadowsEnabled = s.get('shadows.enable') !== false;
    this.sun.castShadow = shadowsEnabled && shadowWeights.primary > 0 && !!s.get('shadows.primaryEnable');
    this.shadowSun.castShadow = shadowsEnabled && shadowWeights.secondary > 0 && !!s.get('shadows.secondaryEnable');

    // ---- faked GI: sky-tinted hemisphere bounce (free, no extra pass) ----
    // Defaults reproduce the previous look; the new bit is the hemi colour
    // being pulled toward the LIVE sampled sky colour in _syncHorizonFog.
    const giB = s.get('lighting.skyBounce');
    const giG = s.get('lighting.groundBounce');
    this._gi = { tint: s.get('lighting.bounceTint') };
    this._hemiBase = new THREE.Color('#e8a86a').lerp(new THREE.Color('#a9c8e6'), day2);
    this.hemi.color.copy(this._hemiBase);
    this.hemi.groundColor.set('#3a2a1c').lerp(new THREE.Color('#60503a'), gainDay);
    this.hemi.intensity = THREE.MathUtils.lerp(0.36, 0.56, gainDay) * (giB / 0.55);
    this.ambient.intensity = THREE.MathUtils.lerp(0.04, 0.075, gainDay) * (0.70 + giG);

    // Analytic fallback fog colour; the real one is sampled from the actual
    // sky-view LUT horizon each time the sky changes (see _syncHorizonFog) so
    // the bounded sea dissolves EXACTLY into the sunset — no mismatched band.
    this.scene.fog.color.set('#d99250').lerp(new THREE.Color('#acc6cf'), day2);
    this._skyDirty = true;

    this._applyWaterLighting();
    this._applySkyDiagnosis();
  }

  // Push sun + glint params to the sea (guarded — sea is rebuilt on regen).
  _applyWaterLighting() {
    if (!this.sea) return;
    const s = this.store;
    this.sea.setSun(this._sunDir(), this.sun.color);
    this.sea.setGlint(s.get('lighting.sunGlint'), s.get('lighting.glintSpread'));
  }

  _onParam(evt) {
    const p = evt.path;
    if (p === '*' || p.startsWith('sun.') || p.startsWith('atmosphere.') ||
        p.startsWith('render.') || p.startsWith('lighting.') || p.startsWith('skyDiagnosis.') ||
        p.startsWith('takram.') || p.startsWith('cloudsRender.') ||
        p.startsWith('takramAtmosphere.') || p.startsWith('cloudWeather.') ||
        p.startsWith('cloudLayer0.') || p.startsWith('cloudLighting.') ||
        p.startsWith('cloudShadows.') || p.startsWith('cloudDebug.') ||
        p.startsWith('cloudFinishing.')) {
      this._applyAll();
    }
    if (p === '*' || p.startsWith('island.') || p.startsWith('voxel.') || p.startsWith('seasons.') ||
        p.startsWith('tree.') || p.startsWith('lagoon.') ||
        p === 'water.seaLevel' || p === 'water.floorDepth' || p === 'water.floorShape' ||
        p === 'water.floorRoughness' || p === 'water.deltaFloor') {
      this._scheduleRegen();
    }
    if (p === '*' || p.startsWith('shadows.')) {
      this._applyShadowSettings();
      this._applySunLighting();
    }
    if (this.sea) {
      if (p === '*' || p === 'water.enable') {
        this.sea.setEnabled(this.store.get('water.enable'));
        this._applySkyDiagnosis();
      }
      if (p === '*' || p.startsWith('water.') || p.startsWith('waves.')) {
        this.sea.setStyle?.({
          ...(this.store.get('water') || {}),
          ...(this.store.get('waves') || {}),
        });
        this._applySkyDiagnosis();
      }
    }
  }

  _applySkyDiagnosis() {
    const diag = this.store.get('skyDiagnosis') || {};
    const takramSkyOn = !!this.takramRig?.skyEnabled;
    const skyOnly = !!diag.skyOnly;
    const seaOnly = !!diag.seaOnlyStub;
    const floorOnly = !!diag.floorOnlyStub;
    const isolate = skyOnly || seaOnly || floorOnly;
    const isolateSea = seaOnly || floorOnly;
    const hideIsland = !!diag.hideIsland;
    const waterOn = this.store.get('water.enable') !== false;

    this.renderer.setClearColor(diag.magentaClear ? DIAG_MAGENTA : LAB_CLEAR, 1);
    this.backdrop.mesh.visible = !takramSkyOn && !isolateSea;
    this.takramRig?.setSkyVisible(!isolateSea);
    this.backdrop.setDiagnostics({
      forceBelowHorizonFog: !!diag.forceBelowHorizonFog,
      belowHorizonFog: this.scene.fog.color,
    });

    this.islandGroup.visible = !hideIsland && !isolate;
    this.treeGroup.visible = !hideIsland && !isolate;

    if (!this.sea) return;
    this.sea.group.visible = (waterOn && !skyOnly) || isolateSea;
    if (this.sea.floor) this.sea.floor.visible = !skyOnly && (floorOnly || seaOnly || waterOn);
    if (this.sea.surface) this.sea.surface.visible = seaOnly || (!skyOnly && !floorOnly && waterOn && !(this.sea._lodEnabled && this.sea._lodSolo));
    if (this.sea.lodSurface) this.sea.lodSurface.visible = !skyOnly && !floorOnly && waterOn && !!this.sea._lodEnabled;
  }

  setTakramRig(rig) {
    this.takramRig = rig || null;
    this._applyTakramSettings();
    this._applySkyDiagnosis();
  }

  _applyTakramSettings() {
    if (!this.takramRig) return;
    const legacy = this.store.get('takram') || {};
    const render = this.store.get('cloudsRender') || {};
    const takramSky = !!(render.atmosphere ?? legacy.atmosphere);
    const clouds = !!(render.clouds ?? legacy.clouds);
    const aerialPerspective = !!(render.aerialPerspective ?? takramSky);
    const legacySkyClouds = clouds && !takramSky && !aerialPerspective;
    this.takramRig.setEnabled(takramSky || clouds || aerialPerspective);
    this.takramRig.setSkyEnabled(takramSky);
    this.takramRig.setParams({
      render: {
        clouds,
        aerialPerspective,
        exposure: legacySkyClouds
          ? this.store.get('render.exposure')
          : (render.exposure ?? legacy.exposure ?? 10),
        quality: this.mobileProfile.mobile
          ? Math.min(render.quality ?? legacy.quality ?? 2, this.mobileProfile.cloudQualityMax)
          : (render.quality ?? legacy.quality ?? 2),
        resolutionScale: this.mobileProfile.mobile
          ? Math.min(render.resolutionScale ?? legacy.resolutionScale ?? 0.75, this.mobileProfile.cloudResolutionMax)
          : (render.resolutionScale ?? legacy.resolutionScale ?? 0.75),
        temporalUpscale: this.mobileProfile.mobile ? false : (render.temporalUpscale ?? true),
      },
      atmosphere: this.store.get('takramAtmosphere') || {},
      weather: {
        ...(this.store.get('cloudWeather') || {}),
        coverage: this.store.get('cloudWeather.coverage') ?? legacy.coverage ?? 0.68,
      },
      layer: this.store.get('cloudLayer0') || {},
      lighting: this.store.get('cloudLighting') || {},
      shadows: this.mobileProfile.mobile
        ? {
          ...(this.store.get('cloudShadows') || {}),
          layerShadow: false,
          lightShafts: false,
          cascadeCount: 1,
          mapSize: 0,
        }
        : (this.store.get('cloudShadows') || {}),
      debug: this.store.get('cloudDebug') || {},
      finishing: this.store.get('cloudFinishing') || {},
    });
  }

  setSunOverride(values) {
    this._sunOverride = values || null;
    this._applySunLighting();
  }

  _scheduleRegen() {
    if (this.store.get('skyDiagnosis.fastSkyBoot') && !this.vol) return;
    if (this._regenTimer) clearTimeout(this._regenTimer);
    this._regenTimer = setTimeout(() => {
      this._regenTimer = null;
      if (this.asyncRegenerate) this.regenerateAsync('scene rebuild');
      else this.regenerate();
    }, 260);
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.postfx?.setSize();
    this.takramRig?.setSize(window.innerWidth, window.innerHeight);
  }

  _applyShadowSettings() {
    const s = this.store;
    const nextType = SHADOW_FILTER_TYPES[THREE.MathUtils.clamp(s.get('shadows.filterMode') | 0, 0, 2)] || THREE.PCFSoftShadowMap;
    const typeChanged = this.renderer.shadowMap.type !== nextType;
    this.renderer.shadowMap.type = nextType;

    this._applyShadowLightSettings(this.sun, s.get('shadows.primarySize') ?? 2048, typeChanged);
    this._applyShadowLightSettings(this.shadowSun, s.get('shadows.secondarySize') ?? 512, typeChanged);
    this._applyShadowBounds(this._lastShadowOpts || this._buildGenOptions(s));
  }

  _applyShadowLightSettings(light, rawSize, forceMapReset = false) {
    if (!light?.shadow) return;
    const maxSize = Math.min(this.renderer.capabilities.maxTextureSize || 8192, this.mobileProfile.shadowMapMax);
    const size = THREE.MathUtils.clamp(Math.round((rawSize || 2048) / 512) * 512, 512, maxSize);
    const shadow = light.shadow;
    const sizeChanged = shadow.mapSize.x !== size || shadow.mapSize.y !== size;
    shadow.mapSize.set(size, size);
    shadow.bias = this.store.get('shadows.bias') ?? -0.0006;
    shadow.normalBias = this.store.get('shadows.normalBias') ?? 2.2;
    shadow.radius = this.store.get('shadows.softness') ?? 1;
    if (sizeChanged || forceMapReset) this._disposeShadowMap(shadow);
    shadow.needsUpdate = true;
  }

  _disposeShadowMap(shadow) {
    if (shadow.map) {
      shadow.map.dispose();
      shadow.map = null;
    }
  }

  // Compatibility shim for older smoke scripts. The UI owns this now via the
  // atmosphere.planetRadiusKm slider.
  setExperimental(st) {
    const radius = st?.planetR ? Math.max(150, st.planetRadiusKm || 1200) : PLANET.groundRadius;
    this.store.set('atmosphere.planetRadiusKm', radius);
  }

  // Planet-R restore — sunset's artistic tiny-planet curvature, now a tunable
  // radius. Public LUT setters only (atmosphere code untouched); reversible.
  // OFF restores exact Earth values == the golden look.
  _applyPlanetR(raw = this.store.get('atmosphere.planetRadiusKm')) {
    const R = THREE.MathUtils.clamp(raw || PLANET.groundRadius, 150, PLANET.groundRadius);
    if (this._planetRadiusApplied === R) return;
    this._planetRadiusApplied = R;
    const thick = PLANET.atmosphereRadius - PLANET.groundRadius;     // keep 100 km shell
    this.skyViewLUT.setGeometry({ planetRadiusKm: R, atmosphereThicknessKm: thick });
    this.backdrop.setGeometry({ planetRadiusKm: R, atmosphereThicknessKm: thick });
    const obs = new THREE.Vector3(0, R + 0.35, 0);
    this.skyViewLUT.setObserverPosition(obs);
    this.backdrop.setObserver(obs);
    this._skyDirty = true;
  }

  // Per-frame post-FX inputs. bloom/haze/godrays are live store params.
  // sunUV stays useful even off-screen: the god-ray workshop wants the pass
  // alive through full 360 camera rotation, with the source clamped at the
  // screen edge rather than hard-bypassed.
  _fxParams() {
    const s = this.store;
    const sd = this._sunDir();
    // The sun is directional, so its screen UV is the same at ANY positive
    // distance — but it must be projected from INSIDE the far plane. The old
    // code pushed it 100000 units out while camera.far is 32000, so project()
    // returned z>1 and the `wp.z<1` gate failed forever: god rays were
    // bypassed unconditionally. Keep the point at a safe distance; when it is
    // off-screen or behind the camera, the god pass clamps the ray origin to
    // the nearest screen edge instead of disabling itself.
    const wp = (this._fxv ||= new THREE.Vector3());
    wp.copy(this.camera.position).addScaledVector(sd, 2000).project(this.camera);
    let sunUV = { x: wp.x * 0.5 + 0.5, y: wp.y * 0.5 + 0.5 };
    if (!Number.isFinite(sunUV.x) || !Number.isFinite(sunUV.y)) {
      const right = (this._fxRight ||= new THREE.Vector3()).setFromMatrixColumn(this.camera.matrixWorld, 0);
      const up = (this._fxUp ||= new THREE.Vector3()).setFromMatrixColumn(this.camera.matrixWorld, 1);
      const sx = sd.dot(right);
      const sy = sd.dot(up);
      const edge = 2 / Math.max(0.001, Math.abs(sx), Math.abs(sy));
      sunUV = { x: 0.5 + sx * edge, y: 0.5 + sy * edge };
    }
    // Camera visibility is deliberately NOT a gate. Only fade when the light
    // direction is effectively below the horizon, where the scene itself has
    // no useful bright source to scatter.
    const heightFade = THREE.MathUtils.smoothstep(sd.y, -0.02, 0.04);
    const sunFade = heightFade;
    const sunVisible = sunFade > 0.001;
    const gr = s.get('godrays') || {};
    const god = gr.enable ? {
      intensity: gr.intensity ?? 0.85, samples: gr.samples ?? 16,
      density: gr.density ?? 0.32, decay: gr.decay ?? 0.915,
      weight: gr.weight ?? 2, exposure: gr.exposure ?? 0.7,
      threshold: gr.threshold ?? 0.62, horizon: gr.groundMask ?? 0.5,
      radius: gr.reach ?? 1.45, tint: gr.warmth ?? 0.5,
      resScale: gr.resScale ?? 0.25, sharp: gr.sharp ?? 0.25,
      source: gr.source ?? 1, compare: !!gr.compare,
      edgeSource: gr.edgeSource ?? 0,
      edgeWidth: gr.edgeWidth ?? 1.2,
      edgeGain: gr.edgeGain ?? 1,
      blurEnable: !!gr.blurEnable,
      blurAmount: gr.blurAmount ?? 0.18,
      blurRadius: gr.blurRadius ?? 1.5,
      blurPasses: gr.blurPasses ?? 1,
      debugView: gr.debugView ?? 0,
      debugGain: gr.debugGain ?? 1,
    } : { intensity: 0 };
    return {
      bloom: s.get('lighting.bloom') || 0,
      haze: s.get('lighting.aerialHaze') || 0,
      hazeColor: this.scene.fog.color,
      sunCol: this.sun.color,
      sunUV, sunVisible, sunFade, god,
    };
  }

  getDebugInfo() {
    const c = this.camera.position;
    return {
      name: 'Isometric Island',
      camera: [c.x.toFixed(1), c.y.toFixed(1), c.z.toFixed(1)],
      triangles: this.renderer.info.render.triangles,
      drawCalls: this.renderer.info.render.calls,
      trees: this.treeCount,
      worldSize: this.vol?.worldSize,
      seaLevel: this.store.get('water.seaLevel'),
      sunElevationDeg: this.store.get('sun.elevationDeg'),
      seed: this.store.get('voxel.seed'),
    };
  }

  getHorizonDiagnosticSnapshot() {
    const lut = this.skyViewLUT;
    const w = lut.width;
    const h = lut.height;
    const rows = [
      0,
      Math.floor(h * 0.25),
      Math.max(0, Math.floor(h * 0.5) - 3),
      Math.max(0, Math.floor(h * 0.5) - 1),
      Math.floor(h * 0.5),
      Math.min(h - 1, Math.floor(h * 0.5) + 1),
      Math.min(h - 1, Math.floor(h * 0.75)),
      h - 1,
    ];
    const buf = new Uint16Array(w * 4);
    const hf = THREE.DataUtils.fromHalfFloat;
    const stats = [];
    for (const row of rows) {
      this.renderer.readRenderTargetPixels(lut.target, 0, row, w, 1, buf);
      let r = 0, g = 0, b = 0;
      let minLum = Infinity;
      let maxLum = -Infinity;
      let darkCount = 0;
      for (let i = 0; i < w; i++) {
        const rr = hf(buf[i * 4]);
        const gg = hf(buf[i * 4 + 1]);
        const bb = hf(buf[i * 4 + 2]);
        r += rr; g += gg; b += bb;
        const lum = rr * 0.2126 + gg * 0.7152 + bb * 0.0722;
        minLum = Math.min(minLum, lum);
        maxLum = Math.max(maxLum, lum);
        if (lum < 1e-5) darkCount++;
      }
      stats.push({
        row,
        v: Number((row / Math.max(1, h - 1)).toFixed(4)),
        avg: [r / w, g / w, b / w].map((x) => Number(x.toPrecision(5))),
        minLum: Number(minLum.toPrecision(5)),
        maxLum: Number(maxLum.toPrecision(5)),
        darkPct: Number((darkCount / w).toFixed(4)),
      });
    }
    const c = this.camera.position;
    return {
      camera: [c.x, c.y, c.z].map((x) => Number(x.toFixed(2))),
      horizonWarp: this.backdrop.uniforms.uHorizonWarp.value,
      forceBelowHorizonFog: this.backdrop.uniforms.uForceBelowHorizonFog.value,
      diagnosis: structuredClone(this.store.get('skyDiagnosis') || {}),
      fog: [this.scene.fog.color.r, this.scene.fog.color.g, this.scene.fog.color.b].map((x) => Number(x.toPrecision(5))),
      rows: stats,
      renderer: {
        triangles: this.renderer.info.render.triangles,
        calls: this.renderer.info.render.calls,
      },
    };
  }

  // Sample the ACTUAL sky-view LUT horizon row and drive the fog colour from
  // it, so the distant sea fogs into the exact sunset colour the user sees —
  // resolving "main square vs horizon". Reads the LUT's OUTPUT only; the
  // atmosphere code is never modified. Throttled to sky changes.
  _syncHorizonFog() {
    try {
      const lut = this.skyViewLUT;
      const w = lut.width, h = lut.height;
      const row = Math.max(0, Math.floor(h * 0.5) - 1);   // v≈0.5 = horizon
      // The LUT target is HalfFloatType → must read into a Uint16Array and
      // decode the halves to float.
      if (!this._fogBuf || this._fogBuf.length !== w * 4) this._fogBuf = new Uint16Array(w * 4);
      this.renderer.readRenderTargetPixels(lut.target, 0, row, w, 1, this._fogBuf);
      const hf = THREE.DataUtils.fromHalfFloat;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < w; i++) { r += hf(this._fogBuf[i * 4]); g += hf(this._fogBuf[i * 4 + 1]); b += hf(this._fogBuf[i * 4 + 2]); }
      r /= w; g /= w; b /= w;
      if (!(r >= 0) || !(g >= 0) || !(b >= 0)) return;     // bail if readback gave garbage

      const exp = this.renderer.toneMappingExposure;
      const aces = (x) => {
        x = Math.max(0, x * exp);
        return Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));
      };
      this.scene.fog.color.setRGB(aces(r), aces(g), aces(b), THREE.SRGBColorSpace);
      this.sea?.setHorizon(this.scene.fog.color);     // ocean rim → live sunset
      // faked GI: pull the hemisphere fill toward the live sky colour
      if (this._hemiBase) this.hemi.color.copy(this._hemiBase).lerp(this.scene.fog.color, this._gi?.tint ?? 0.7);
    } catch {
      /* HalfFloat readback unsupported on this driver — analytic fog stands */
    }
  }

  // ---- loop ----
  start() {
    const tick = () => {
      this._raf = requestAnimationFrame(tick);
      const rawDt = Math.min(this.clock.getDelta(), 0.5);
      const dt = Math.min(rawDt, 1 / 20);
      this.elapsed += dt;
      this.renderer.info.reset();

      this.camDirector.update(dt);
      this.autoCameraDirector.update(dt);
      this.orbitSweep.update(rawDt);
      this.sea?.update(this.elapsed, this.camera.position);

      this.camera.updateMatrixWorld();
      this.backdrop.updateCamera(this.camera);

      this.transmittanceLUT.render(this.renderer);
      this.skyViewLUT.render(this.renderer);
      if (this._skyDirty) { this._syncHorizonFog(); this._skyDirty = false; }
      this._applySkyDiagnosis();

      if (this.takramRig?.enabled) {
        this.takramRig.syncFromScene(this);
        this.takramRig.render(dt);
      } else {
        this.postfx.render(this.scene, this.camera, this._fxParams());
      }
    };
    tick();
  }

}

function detectMobileRenderProfile() {
  if (typeof window === 'undefined') {
    return {
      mobile: false,
      pixelRatioCap: 2,
      shadowMapMax: 8192,
      cloudQualityMax: 3,
      cloudResolutionMax: 1,
    };
  }
  const ua = navigator.userAgent || '';
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
  const iOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const mobile = coarse || iOS || /Android|Mobile/.test(ua);
  return {
    mobile,
    pixelRatioCap: mobile ? 1 : 2,
    shadowMapMax: mobile ? 1024 : 8192,
    cloudQualityMax: mobile ? 0 : 3,
    cloudResolutionMax: mobile ? 0.35 : 1,
  };
}
