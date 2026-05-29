import * as THREE from 'three';

const SUN_PERIOD_SECONDS = 600;
const FADE_IN_SECONDS = 3.0;
const FADE_OUT_SECONDS = 0.85;
const EPS = 1e-5;

export class OrbitSweepController {
  constructor(store, scene) {
    this.store = store;
    this.scene = scene;
    this.enabled = false;
    this.fade = 0;
    this.time = 0;
    this.sunBase = this._readSun();
    this.elevationPhase = 0;
    this.elevationOffsetDeg = 0;
    this.azimuthPhase = 0;
    this.azimuthBaseDeg = this.sunBase.azimuthDeg ?? 0;
    this._lastSunApplied = null;
    this._manualOverride = false;
    this._publishing = false;
    this._suppressEnableChange = false;

    store.subscribe((evt) => this._onStoreChange(evt));
    this.enabled = !!store.get('orbitSweep.enable');
    this._alignSweepToSun(this.sunBase);
    this._publishSun(this.sunBase, true);
  }

  _readSun() {
    return {
      elevationDeg: this.store.get('sun.elevationDeg'),
      azimuthDeg: this.store.get('sun.azimuthDeg'),
      intensity: this.store.get('sun.intensity'),
    };
  }

  _onStoreChange(evt) {
    if (this._publishing) return;
    const path = evt.path;
    if (path === '*') {
      this.enabled = !!this.store.get('orbitSweep.enable');
      this._manualOverride = false;
      this._resetBase();
      if (!this.enabled) {
        this.fade = 0;
      }
      return;
    }
    if (path === 'orbitSweep.enable') {
      this.enabled = !!evt.value;
      if (this._suppressEnableChange) return;
      if (this.enabled) this._startFromOrbitValue();
      else this._freezeAtCurrentSun();
      return;
    }
    if (path === 'orbitSweep.elevationRange') {
      this._alignSweepToSun(this._readOrbitSun(), { elevation: true, azimuth: false });
      return;
    }
    if (path === 'orbitSweep.elevationDeg' || path === 'orbitSweep.azimuthDeg') {
      this._manualOverride = !this.enabled;
      this.fade = 1;
      const sun = this._readOrbitSun();
      this._alignSweepToSun(sun, {
        elevation: path === 'orbitSweep.elevationDeg',
        azimuth: path === 'orbitSweep.azimuthDeg',
      });
      this.scene.setSunOverride(sun);
      this._lastSunApplied = sun;
      return;
    }
    if (path && path.startsWith('sun.')) {
      this._manualOverride = false;
      this._lastSunApplied = null;
      this.sunBase = this._readSun();
      this._alignSweepToSun(this.sunBase);
      this._publishSun(this.sunBase, true);
      if (this.enabled) {
        this.enabled = false;
        try {
          this._suppressEnableChange = true;
          this.store.set('orbitSweep.enable', false);
        } finally {
          this._suppressEnableChange = false;
        }
      }
      this.scene.setSunOverride(null);
    }
  }

  _resetBase() {
    this._manualOverride = false;
    this.sunBase = this._readSun();
    this._alignSweepToSun(this.sunBase);
    this._lastSunApplied = null;
    this.scene.setSunOverride(null);
    this._publishSun(this.sunBase, true);
  }

  _startFromOrbitValue() {
    this._manualOverride = false;
    this.sunBase = this._readSun();
    const sun = this._readOrbitSun();
    this._alignSweepToSun(sun);
    this._lastSunApplied = null;
    this.fade = 1;
  }

  _freezeAtCurrentSun() {
    const sun = this._lastSunApplied || this._readOrbitSun();
    this._manualOverride = true;
    this.fade = 1;
    this._alignSweepToSun(sun);
    this.scene.setSunOverride(sun);
    this._lastSunApplied = sun;
    this._publishSun(sun, true);
  }

  _alignSweepToSun(sun, axes = { elevation: true, azimuth: true }) {
    if (axes.elevation) {
      const range = this._elevationRange();
      const clampedElevation = THREE.MathUtils.clamp(sun.elevationDeg, range[0], range[1]);
      this.elevationPhase = nearestElevationPhase(this.elevationPhase, clampedElevation, range);
      this.elevationOffsetDeg = sun.elevationDeg - clampedElevation;
    }
    if (axes.azimuth) this.azimuthBaseDeg = normalizeAzimuth(sun.azimuthDeg - THREE.MathUtils.radToDeg(this.azimuthPhase));
  }

  _elevationRange() {
    const raw = this.store.get('orbitSweep.elevationRange');
    const a = Array.isArray(raw) ? Number(raw[0]) : 2;
    const b = Array.isArray(raw) ? Number(raw[1]) : 50;
    const lo = THREE.MathUtils.clamp(Math.min(a, b), -10, 90);
    const hi = THREE.MathUtils.clamp(Math.max(a, b), -10, 90);
    return hi - lo < 0.5 ? [lo, lo + 0.5] : [lo, hi];
  }

  _speed() {
    return THREE.MathUtils.clamp(this.store.get('orbitSweep.speed') ?? 0.5, 0, 4);
  }

  _axisSpeed(path, fallback, max) {
    return THREE.MathUtils.clamp(this.store.get(path) ?? fallback, 0, max);
  }

  _readOrbitSun() {
    const live = this._readSun();
    return {
      elevationDeg: THREE.MathUtils.clamp(Number(this.store.get('orbitSweep.elevationDeg') ?? live.elevationDeg), -10, 90),
      azimuthDeg: normalizeAzimuth(Number(this.store.get('orbitSweep.azimuthDeg') ?? live.azimuthDeg)),
      intensity: live.intensity,
    };
  }

  _publishSun(sun, force = false) {
    const elevationDeg = THREE.MathUtils.clamp(Number(sun.elevationDeg), -10, 90);
    const azimuthDeg = normalizeAzimuth(Number(sun.azimuthDeg));
    const oldElevation = this.store.get('orbitSweep.elevationDeg');
    const oldAzimuth = this.store.get('orbitSweep.azimuthDeg');
    const elevationChanged = force || Math.abs(elevationDeg - oldElevation) > EPS;
    const azimuthChanged = force || Math.abs(shortestAngleDeg(azimuthDeg, oldAzimuth)) > EPS;
    if (!elevationChanged && !azimuthChanged) return;
    try {
      this._publishing = true;
      if (elevationChanged) this.store.set('orbitSweep.elevationDeg', elevationDeg);
      if (azimuthChanged) this.store.set('orbitSweep.azimuthDeg', azimuthDeg);
    } finally {
      this._publishing = false;
    }
  }

  _sunSweep() {
    const [lo, hi] = this._elevationRange();
    const mid = (lo + hi) * 0.5;
    const amp = (hi - lo) * 0.5;
    const elevationDeg = mid + Math.sin(this.elevationPhase) * amp + this.elevationOffsetDeg;
    const azimuthDeg = normalizeAzimuth(this.azimuthBaseDeg + THREE.MathUtils.radToDeg(this.azimuthPhase));
    return {
      elevationDeg: THREE.MathUtils.clamp(elevationDeg, -10, 90),
      azimuthDeg,
      intensity: this.sunBase.intensity,
    };
  }

  update(dt) {
    this.time += dt;
    const globalSpeed = this._speed();
    const phaseStep = (dt / SUN_PERIOD_SECONDS) * Math.PI * 2 * globalSpeed;
    if (this.enabled) {
      const elevationStep = phaseStep * this._axisSpeed('orbitSweep.elevationSpeed', 4, 24);
      this.elevationPhase += elevationStep;
      this.azimuthPhase += phaseStep * this._axisSpeed('orbitSweep.azimuthSpeed', 0.5, 8);
      this._relaxElevationOffset(elevationStep);
    }

    if (this._manualOverride && !this.enabled) {
      const sun = this._readOrbitSun();
      const sunChanged = !this._lastSunApplied ||
        Math.abs(sun.elevationDeg - this._lastSunApplied.elevationDeg) > EPS ||
        Math.abs(shortestAngleDeg(sun.azimuthDeg, this._lastSunApplied.azimuthDeg)) > EPS;
      if (sunChanged) {
        this.scene.setSunOverride(sun);
        this._lastSunApplied = sun;
      }
      this._publishSun(sun);
      return;
    }

    const targetFade = this.enabled ? 1 : 0;
    const fadeSeconds = this.enabled ? FADE_IN_SECONDS : FADE_OUT_SECONDS;
    const step = dt / fadeSeconds;
    if (this.fade < targetFade) this.fade = Math.min(targetFade, this.fade + step);
    else if (this.fade > targetFade) this.fade = Math.max(targetFade, this.fade - step);

    if (this.fade <= 0 && !this.enabled) {
      if (this._lastSunApplied) {
        this.scene.setSunOverride(null);
        this._lastSunApplied = null;
      }
      this._publishSun(this._readSun());
      return;
    }

    const liveSun = this._readSun();
    const sweepSun = this._sunSweep();
    const sunOut = {
      elevationDeg: THREE.MathUtils.lerp(liveSun.elevationDeg, sweepSun.elevationDeg, this.fade),
      azimuthDeg: normalizeAzimuth(lerpAngleDeg(liveSun.azimuthDeg, sweepSun.azimuthDeg, this.fade)),
      intensity: liveSun.intensity,
    };
    const sunChanged = !this._lastSunApplied ||
      Math.abs(sunOut.elevationDeg - this._lastSunApplied.elevationDeg) > EPS ||
      Math.abs(shortestAngleDeg(sunOut.azimuthDeg, this._lastSunApplied.azimuthDeg)) > EPS;
    if (sunChanged) {
      this.scene.setSunOverride(sunOut);
      this._lastSunApplied = sunOut;
    }
    this._publishSun(sunOut);
  }

  _relaxElevationOffset(phaseStep) {
    if (Math.abs(this.elevationOffsetDeg) <= EPS) {
      this.elevationOffsetDeg = 0;
      return;
    }
    const [lo, hi] = this._elevationRange();
    const amp = Math.max(0.001, (hi - lo) * 0.5);
    const step = Math.abs(phaseStep) * amp;
    if (step <= EPS) return;
    this.elevationOffsetDeg = moveToward(this.elevationOffsetDeg, 0, step);
  }
}

function normalizeAzimuth(deg) {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

function shortestAngleDeg(a, b) {
  return normalizeAzimuth(a - b);
}

function lerpAngleDeg(a, b, t) {
  return a + shortestAngleDeg(b, a) * THREE.MathUtils.clamp(t, 0, 1);
}

function nearestElevationPhase(current, elevationDeg, range) {
  const [lo, hi] = range;
  const mid = (lo + hi) * 0.5;
  const amp = Math.max(0.001, (hi - lo) * 0.5);
  const n = THREE.MathUtils.clamp((elevationDeg - mid) / amp, -1, 1);
  const a = Math.asin(n);
  const b = Math.PI - a;
  const candidates = [];
  const baseTurn = Math.round(current / (Math.PI * 2));
  for (let k = baseTurn - 1; k <= baseTurn + 1; k++) {
    const turn = k * Math.PI * 2;
    candidates.push(a + turn, b + turn);
  }
  let best = candidates[0];
  let bestDist = Math.abs(best - current);
  for (const candidate of candidates) {
    const dist = Math.abs(candidate - current);
    if (dist < bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }
  return best;
}

function moveToward(value, target, step) {
  if (value < target) return Math.min(target, value + step);
  if (value > target) return Math.max(target, value - step);
  return target;
}
