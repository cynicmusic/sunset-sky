// "VDB-like" volume. Phase 1 is a dense column grid with named channels
// (height / material / season) — VDB *semantics* (independently authorable
// channels sampled to drive meshing) without the sparse B+tree, which is a
// Phase 2 optimization per PLAN.md §4 (no production WASM OpenVDB exists).
// The API is channel-oriented so it can become chunked-sparse later without
// touching terrain.js or mesher.js.

export class SparseVolume {
  constructor({ resolution, worldSize, vstep }) {
    this.res = resolution;        // cells per axis
    this.worldSize = worldSize;   // metres across (island + sea buffer)
    this.cellSize = worldSize / resolution;
    this.vstep = vstep;           // metres per vertical voxel step (terrace/cube height)
    this.half = worldSize / 2;

    const n = resolution * resolution;
    this.heightVox = new Int16Array(n);   // surface height in vstep units
    this.material = new Uint8Array(n);    // MAT.* enum
    this.season = new Uint8Array(n);      // 0 summer 1 autumn 2 conifer 3 winter
    this.land = new Uint8Array(n);        // 1 if surface is above sea level
    this.channel = new Uint8Array(n);     // 0 none · 1 gully/valley/delta core
    this.lagoon = new Uint8Array(n);      // 0 none · 1 water · 2 apron
  }

  idx(i, j) { return j * this.res + i; }
  inBounds(i, j) { return i >= 0 && j >= 0 && i < this.res && j < this.res; }

  // Cell centre → world XZ.
  cellToWorld(i, j) {
    return [
      (i + 0.5) * this.cellSize - this.half,
      (j + 0.5) * this.cellSize - this.half,
    ];
  }
  worldToCell(x, z) {
    return [
      Math.floor((x + this.half) / this.cellSize),
      Math.floor((z + this.half) / this.cellSize),
    ];
  }

  heightMetresAt(i, j) {
    if (!this.inBounds(i, j)) return -9999;
    return this.heightVox[this.idx(i, j)] * this.vstep;
  }

  // Bilinear-ish surface height at an arbitrary world XZ (for tree planting).
  surfaceHeightWorld(x, z) {
    const [i, j] = this.worldToCell(x, z);
    if (!this.inBounds(i, j)) return -9999;
    return this.heightVox[this.idx(i, j)] * this.vstep;
  }
}
