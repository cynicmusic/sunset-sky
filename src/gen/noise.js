// Ported from succulent/src/noise.js (the canvas texture helper is dropped —
// the generator is DOM-free). Value noise → fbm2 with per-octave domain warp,
// ridgedFbm2, cellular2. This is the primitive layer; terrain.js composes it
// into the island per PLAN.md §5 (island mask + domain-warp + ridged
// multifractal), the "layering philosophy" from succulent without its mesh.

export function mulberry32(seed) {
  let t = seed >>> 0;
  return function rand() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1));
  return t * t * (3 - 2 * t);
}

export function hash2(x, y, seed = 1) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

export function valueNoise2(x, y, seed = 1) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const xf = x - x0;
  const yf = y - y0;
  const u = smooth(xf);
  const v = smooth(yf);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

export function fbm2(x, y, {
  seed = 1,
  octaves = 5,
  lacunarity = 2,
  gain = 0.5,
  warp = 0,
} = {}) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  let px = x;
  let py = y;

  for (let i = 0; i < octaves; i++) {
    if (warp > 0) {
      px += (valueNoise2(px * 0.7, py * 0.7, seed + 31 + i) - 0.5) * warp;
      py += (valueNoise2(px * 0.7 + 9.2, py * 0.7, seed + 67 + i) - 0.5) * warp;
    }
    sum += valueNoise2(px * freq, py * freq, seed + i * 101) * amp;
    norm += amp;
    freq *= lacunarity;
    amp *= gain;
  }

  return sum / Math.max(norm, 0.0001);
}

export function ridgedFbm2(x, y, opts = {}) {
  const n = fbm2(x, y, opts);
  return 1 - Math.abs(n * 2 - 1);
}

export function cellular2(x, y, seed = 1) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let nearest = 9;
  let second = 9;

  for (let yy = -1; yy <= 1; yy++) {
    for (let xx = -1; xx <= 1; xx++) {
      const cx = ix + xx;
      const cy = iy + yy;
      const px = cx + hash2(cx, cy, seed);
      const py = cy + hash2(cx, cy, seed + 97);
      const d = (x - px) ** 2 + (y - py) ** 2;
      if (d < nearest) {
        second = nearest;
        nearest = d;
      } else if (d < second) {
        second = d;
      }
    }
  }

  return {
    nearest: Math.sqrt(nearest),
    edge: Math.max(0, Math.min(1, Math.sqrt(second) - Math.sqrt(nearest))),
  };
}

export function mixColor(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function threeStopColor(dark, base, accent, value) {
  const t = clamp(value);
  if (t < 0.5) return mixColor(dark, base, t * 2);
  return mixColor(base, accent, (t - 0.5) * 2);
}
