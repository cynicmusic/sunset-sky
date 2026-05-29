// Client side of the preset system. Talks to the Vite middleware in
// vite.config.mjs. A preset is a full island snapshot: every parameter plus
// the camera pose. 8 banks (A-H) x 8 slots are keyed "A1".."H8".
// Legacy numeric keys "1".."8" migrate into bank A.

function migrate(map) {
  if (!map || typeof map !== 'object') return {};
  const out = {};
  for (const k of Object.keys(map)) {
    const m = /^([1-8])$/.exec(k);
    out[m ? 'A' + m[1] : k] = map[k];
  }
  return out;
}

const STATIC_PRESETS_KEY = 'sunset-sky.presets.v1';

function readLocalPresets() {
  try {
    const raw = window.localStorage?.getItem(STATIC_PRESETS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeLocalPreset(slot, preset) {
  try {
    const map = readLocalPresets();
    map[String(slot)] = preset;
    window.localStorage?.setItem(STATIC_PRESETS_KEY, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}

export async function loadPresets() {
  // Dev: the Vite middleware (only exists under the dev server). Always
  // answers, so a dev server never falls through to the baked snapshot. In a
  // static build skip it — it would 404 and spam the console.
  if (import.meta.env.DEV) {
    try {
      const r = await fetch('/__sunset-sky-presets');
      if (r.ok) {
        const { presets } = await r.json();
        return migrate(presets || {});
      }
    } catch { /* fall through to baked snapshot */ }
  }
  // Static build (e.g. GitHub Pages): a baked snapshot shipped in the bundle
  // next to index.html. Resolve against document.baseURI so it works under
  // the Pages project subpath regardless of Vite's BASE_URL.
  try {
    const url = new URL('presets.json', document.baseURI).href;
    const r = await fetch(url, { cache: 'no-cache' });
    if (r.ok) {
      const j = await r.json();
      const baked = j && typeof j === 'object' ? (j.presets || j) : {};
      return migrate({ ...baked, ...readLocalPresets() });
    }
  } catch { /* no baked snapshot */ }
  return migrate(readLocalPresets());
}

export async function savePresetToDisk(slot, preset) {
  if (!import.meta.env.DEV) {
    writeLocalPreset(slot, preset);
    return;
  }
  try {
    await fetch('/__sunset-sky-presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot, preset }),
    });
  } catch { /* dev-only convenience; ignore offline */ }
}

// A slot's "composition representation": a tiny vertical postcard of the
// preset — sky band → land band → water band — each colour derived from the
// ACTUAL params (sun elevation/exposure, season drift, water), so a sunset
// preset and a noon preset look obviously different at a glance.
// Accepts "#rrggbb" OR "rgb(r,g,b)" so mixes can be nested.
function _rgb(c) {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(c);
  if (m) return [+m[1], +m[2], +m[3]];
  const h = c.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function _mix(a, b, t) {
  const A = _rgb(a), B = _rgb(b);
  const k = Math.max(0, Math.min(1, t));
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function presetGradient(preset) {
  const P = preset && preset.params;
  if (!P) return null;
  const el = P.sun?.elevationDeg ?? 26;
  const day = Math.max(0, Math.min(1, (el + 4) / 26));   // 0 dusk → 1 noon
  const warm = 1 - day;                                  // sunset warmth
  const exp = P.render?.exposure ?? 1.05;
  const lift = Math.max(0.8, Math.min(1.25, exp));        // exposure → brightness nudge

  // SKY: deep top → warm/pale horizon, driven by sun elevation.
  const skyTop = _mix('#1c2742', '#6fa9da', day);
  const skyHorizon = _mix('#ff7a3c', '#d5e8f1', day);

  // LAND: season-drift hue (summer green / autumn ochre / conifer / winter),
  // a touch lighter at altitude.
  const seasonHues = ['#4f9e34', '#caa033', '#2f7a44', '#acd7de'];
  const sweep = P.seasons?.sweepDeg ?? 0;
  const land = seasonHues[Math.abs(Math.round(sweep / 90)) % 4];
  const landHi = _mix(land, '#e7d59a', 0.28 * lift);
  const landLo = _mix(land, '#10331f', 0.5);

  // WATER: brighter aqua by day, darker + warmer at sunset.
  const wTop = _mix(_mix('#0e4f63', '#36b9c0', day), '#1f6f6a', warm * 0.5);
  const wDeep = _mix('#06283a', '#0e5566', day);

  return `linear-gradient(180deg, ${skyTop} 0%, ${skyHorizon} 32%, ${landHi} 36%, ${land} 50%, ${landLo} 63%, ${wTop} 66%, ${wDeep} 100%)`;
}
