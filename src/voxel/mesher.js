// Faceted heightfield mesher. PLAN.md: hard voxel silhouettes, flat-shaded
// faces, vertex-colour gradients down terrace bands + baked micro-grain
// ("faceted + gradient + micro-grain", colour-led not texture-led).
//
// Top faces are greedy-merged along +X runs of identical material+height
// (terraces are flat plateaus → big merges, few triangles). Vertical side
// quads are emitted only across height discontinuities, which is what gives
// the blocky cliff/terrace look. Geometry is non-indexed with explicit
// per-face normals → genuinely faceted.

import * as THREE from 'three';
import { hash2 } from '../gen/noise.js';
import { MAT, terrainColor, seafloorColor, grassTint, mixRgb, CHANNEL_WATER } from '../gen/palette.js';

export function buildIslandMesh(vol, seed) {
  const { res, cellSize, vstep, half } = vol;
  const { seaLevel, maxHeight, floorDepth } = vol.meta;
  const baseY = seaLevel - floorDepth - 6;          // solid base — no floating island

  const pos = [];
  const nrm = [];
  const col = [];

  const topY = (i, j) => vol.heightVox[vol.idx(i, j)] * vstep;

  // Per-cell flat colour: material gradient + per-cell value-noise grain.
  function cellColor(i, j) {
    const idx = vol.idx(i, j);
    const m = vol.material[idx];
    const y = vol.heightVox[idx] * vstep;
    const g = (hash2(i, j, seed) - 0.5) * 0.09;     // micro-grain ±4.5%
    let c;
    if (m === MAT.SEAFLOOR) {
      const depthFrac = (seaLevel - y) / Math.max(1, floorDepth);
      c = seafloorColor(depthFrac + g * 0.4);
      // SCAFFOLD: flooded gully/valley/delta → shimmery cyan vs deep ocean.
      if (vol.channel && vol.channel[idx]) c = mixRgb(c, CHANNEL_WATER, 0.55 + g);
    } else if (m === MAT.SAND || m === MAT.WHITE_SAND) {
      const wet = Math.max(0, Math.min(1, (y - seaLevel) / 6)); // wet (dark) → dry (light)
      c = terrainColor(m, 0.25 + wet * 0.6 + g);
    } else if (m === MAT.GRASS) {
      // Season is a SOFT tint on grass only — green still meets sand directly.
      const alt = Math.max(0, Math.min(1, (y - seaLevel) / Math.max(1, maxHeight)));
      c = grassTint(vol.season[idx], 0.34 + alt * 0.5 + g);
    } else {
      const alt = Math.max(0, Math.min(1, (y - seaLevel) / Math.max(1, maxHeight)));
      c = terrainColor(m, 0.32 + alt * 0.55 + g);
    }
    // Concavity AO baked into vertex colour: a cell below its neighbours
    // (valley / base of a terrace riser) darkens, a ridge lightens. This is
    // what makes relief read even with the sun behind the camera (PLAN §15).
    let na = 0, nc = 0;
    if (i > 0) { na += vol.heightVox[idx - 1]; nc++; }
    if (i < res - 1) { na += vol.heightVox[idx + 1]; nc++; }
    if (j > 0) { na += vol.heightVox[idx - res]; nc++; }
    if (j < res - 1) { na += vol.heightVox[idx + res]; nc++; }
    if (nc) {
      const d = vol.heightVox[idx] - na / nc;          // in vstep units
      const ao = Math.max(0.66, Math.min(1.14, 1 + d * 0.11));
      c = [c[0] * ao, c[1] * ao, c[2] * ao];
    }
    return c;
  }

  function pushQuad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, r, g, b) {
    // two triangles a-b-c, a-c-d
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = dx - ax, vy = dy - ay, vz = dz - az;
    // Callers pass corners a,b,c,d; emit them CCW-as-seen-from-OUTSIDE so
    // FrontSide culling + shadow maps are correct (the old code wound CW,
    // which is why tops were only visible from underneath — DoubleSide was
    // masking a real winding bug and wrecked the shadow map).
    let nx = -(uy * vz - uz * vy);
    let ny = -(uz * vx - ux * vz);
    let nz = -(ux * vy - uy * vx);
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const P = [ax, ay, az, cx, cy, cz, bx, by, bz, ax, ay, az, dx, dy, dz, cx, cy, cz];
    for (let k = 0; k < 6; k++) {
      pos.push(P[k * 3], P[k * 3 + 1], P[k * 3 + 2]);
      nrm.push(nx, ny, nz);
      col.push(r, g, b);
    }
  }

  // ---- Top faces (greedy-merged along i) ----
  for (let j = 0; j < res; j++) {
    let i = 0;
    while (i < res) {
      const idx = vol.idx(i, j);
      const m = vol.material[idx];
      const hv = vol.heightVox[idx];
      let i1 = i;
      while (i1 + 1 < res) {
        const n = vol.idx(i1 + 1, j);
        if (vol.material[n] !== m || vol.heightVox[n] !== hv) break;
        i1++;
      }
      const y = hv * vstep;
      const x0 = i * cellSize - half;
      const x1 = (i1 + 1) * cellSize - half;
      const z0 = j * cellSize - half;
      const z1 = (j + 1) * cellSize - half;
      const [r, g, b] = cellColor(i, j);
      pushQuad(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1, r, g, b);
      i = i1 + 1;
    }
  }

  // ---- Vertical side quads across height discontinuities ----
  const SIDE_SHADE = 0.80;                            // baked AO/strata darkening
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const yT = topY(i, j);
      const [r, g, b] = cellColor(i, j);
      const sr = r * SIDE_SHADE, sg = g * SIDE_SHADE, sb = b * SIDE_SHADE;
      const x0 = i * cellSize - half;
      const x1 = (i + 1) * cellSize - half;
      const z0 = j * cellSize - half;
      const z1 = (j + 1) * cellSize - half;

      // four neighbours; world-edge neighbours treated as the solid base.
      const neigh = [
        [i - 1, j, x0, z0, x0, z1], // -X face
        [i + 1, j, x1, z1, x1, z0], // +X face
        [i, j - 1, x1, z0, x0, z0], // -Z face
        [i, j + 1, x0, z1, x1, z1], // +Z face
      ];
      for (const [ni, nj, ex0, ez0, ex1, ez1] of neigh) {
        let yN;
        if (vol.inBounds(ni, nj)) {
          yN = topY(ni, nj);
        } else {
          // World edge: only skirt LAND down to the base. Skirting seafloor
          // would drop a giant gray wall around the ocean — the sea plane +
          // fog dissolve the bounded edge instead (PLAN §9).
          if (yT <= seaLevel + 0.5) continue;
          yN = baseY;
        }
        if (yT - yN <= 0.001) continue;
        pushQuad(ex0, yT, ez0, ex1, yT, ez1, ex1, yN, ez1, ex0, yN, ez0, sr, sg, sb);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,          // faceted; winding now correct so FrontSide
    side: THREE.FrontSide,      // is right → clean shadow maps, no acne
    roughness: 0.95,
    metalness: 0.0,
    transparent: true,          // for the radial seafloor-edge dissolve
  });
  // The meshed seabed is a REQUIREMENT — keep it, but dissolve its square
  // outer edge with a circular radial alpha fade so it blends into the
  // (circular, sky-blended) deep ocean. Land sits well inside rFade0, so
  // only the outer seafloor band fades.
  // 0 < rFade0 < rFade1 (land is ~0.6·radius, so fade starts well beyond it
  // and ends inside the volume edge). Inverting these collapses the whole
  // island's alpha — keep the ordering invariant.
  const rFade0 = vol.meta.radius * 1.05;
  const rFade1 = Math.min(vol.meta.radius * 1.10, vol.worldSize * 0.5 * 0.98);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRFade0 = { value: rFade0 };
    sh.uniforms.uRFade1 = { value: rFade1 };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWorldXZ;')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvWorldXZ = (modelMatrix * vec4(transformed,1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>',
        '#include <common>\nvarying vec2 vWorldXZ;\nuniform float uRFade0;\nuniform float uRFade1;')
      .replace('#include <dithering_fragment>',
        '#include <dithering_fragment>\n  float _r = length(vWorldXZ);\n  gl_FragColor.a *= 1.0 - smoothstep(uRFade0, uRFade1, _r);');
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'IslandVoxels';
  mesh.userData.quadVerts = pos.length / 3;
  return mesh;
}
