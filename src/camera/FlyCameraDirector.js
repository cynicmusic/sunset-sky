import * as THREE from 'three';

// WASD fly camera. Ported from aquarium-sky/src/core/Scene.js
// (_setupKeyboardCamera / _updateKeyboardCamera / _setupPointerControl) —
// the accel-ramp constants and movement maths are verbatim. The cinematic
// auto-director hand-back logic is stripped (no auto director in Phase 1).
//
//   W/S      forward / back (planar)
//   A/D      strafe left / right
//   Q/E      down / up      (also ArrowDown / ArrowUp)
//   ←/→      yaw
//   drag     look (yaw + pitch), 4px dead-zone
//   wheel    dolly along view

// Speeds scaled up ~7× from the aquarium-sky tank values — this island is
// ~1 km across, not a fish tank, so the ramp tops out fast enough to cross
// it in a few seconds.
const KEYBOARD_CAMERA = {
  accelSeconds: 1.5,
  maxFrameSeconds: 1 / 30,
  minMoveSpeed: 55,
  maxMoveSpeed: 260,
  minAltitudeSpeed: 40,
  maxAltitudeSpeed: 170,
  minYawSpeed: 0.9,
  maxYawSpeed: 2.6,
};

export class FlyCameraDirector {
	  constructor(camera, domElement) {
	    this.camera = camera;
	    this.dom = domElement;
	    this._keys = new Map();
	    this._pointers = new Map();
	    this._cameraEuler = new THREE.Euler(0, 0, 0, 'YXZ');
	    this._lastHumanInput = performance.now();
	    this._pointerDown = false;
	    this._dragging = false;
	    this._pinchDistance = 0;
	    this._pinchCentroid = null;
	    this._setupKeyboard();
	    this._setupPointer();
	  }

  markHumanInput() {
    this._lastHumanInput = performance.now();
  }

  clearInput() {
    this._keys.clear();
    this._pointers.clear();
    this._pointerDown = false;
    this._dragging = false;
    this._pinchDistance = 0;
    this._pinchCentroid = null;
    this.dom.style.cursor = 'crosshair';
    this.markHumanInput();
  }

  getIdleSeconds(now = performance.now()) {
    return Math.max(0, (now - this._lastHumanInput) / 1000);
  }

	  hasActiveInput() {
	    return this._keys.size > 0 || this._pointers.size > 0 || this._pointerDown || this._dragging;
	  }

  _ignore(e) {
    const t = e.target;
    return t && (
      t.tagName === 'INPUT' ||
      t.tagName === 'SELECT' ||
      t.tagName === 'TEXTAREA' ||
      t.isContentEditable
    );
  }

  _setupKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (this._ignore(e)) return;
      // CMD/CTRL/ALT held: macOS (and some Linux WMs) swallow the keyup for the
      // non-modifier key, leaving it "stuck" in our Map → camera spins forever
      // ("Cmd+← spins forever" bug). Bail AND drop any pending state so a stale
      // arrow can't survive being modified-down then released.
      if (e.metaKey || e.ctrlKey || e.altKey) { this._keys.clear(); return; }
      const key = e.key.toLowerCase();
      // Vertical up is Q-pair via ArrowUp; down stays Q / ArrowDown.
      if (['w', 'a', 's', 'd', 'q', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        e.preventDefault();
        this.markHumanInput();
        if (!this._keys.has(key)) this._keys.set(key, performance.now());
      }
    });
    window.addEventListener('keyup', (e) => {
      this._keys.delete(e.key.toLowerCase());
      this.markHumanInput();
    });
    // Any time we lose focus (cmd-tab, alt-tab, browser switch) clear all
    // held keys — same reason: we may never see their keyup.
    window.addEventListener('blur', () => this._keys.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this._keys.clear(); });
  }

	  _setupPointer() {
	    let startX = 0, startY = 0, lastX = 0, lastY = 0;
	    this.dom.style.touchAction = 'none';
	    this.dom.addEventListener('pointerdown', (e) => {
	      if (e.target.closest && e.target.closest('#ui-root')) return;
	      e.preventDefault();
	      this.dom.setPointerCapture?.(e.pointerId);
	      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType || 'mouse' });
	      this._pointerDown = true;
	      this._dragging = false;
	      this._pinchDistance = 0;
	      this._pinchCentroid = null;
	      this.markHumanInput();
	      startX = e.clientX; startY = e.clientY;
	      lastX = e.clientX; lastY = e.clientY;
	    }, { passive: false });
	    const endPointer = (e) => {
	      this._pointers.delete(e.pointerId);
	      this._pinchDistance = 0;
	      this._pinchCentroid = null;
	      if (this._pointers.size) {
	        const p = this._pointers.values().next().value;
	        startX = p.x; startY = p.y;
	        lastX = p.x; lastY = p.y;
	        this._pointerDown = true;
	        this._dragging = false;
	        this.markHumanInput();
	      } else if (this._pointerDown || this._dragging) {
	        this._pointerDown = false;
	        this.dom.style.cursor = 'crosshair';
	        this._dragging = false;
	        this.markHumanInput();
	      }
	    };
	    window.addEventListener('pointerup', endPointer);
	    window.addEventListener('pointercancel', endPointer);
	    window.addEventListener('pointermove', (e) => {
	      if (!this._pointerDown && !this._dragging) return;
	      if (this._pointers.has(e.pointerId)) {
	        e.preventDefault();
	        const p = this._pointers.get(e.pointerId);
	        p.x = e.clientX;
	        p.y = e.clientY;
	      }
	      const touches = [...this._pointers.values()].filter((p) => p.type === 'touch');
	      if (touches.length >= 2) {
	        this._handleTouchPanZoom(touches);
	        return;
	      }
	      const isTouch = e.pointerType === 'touch';
	      const radiansPerPixel = isTouch ? 0.0045 : 0.0008;
	      const dx = THREE.MathUtils.clamp(e.clientX - lastX, -80, 80);
	      const dy = THREE.MathUtils.clamp(e.clientY - lastY, -80, 80);
	      const moved = Math.hypot(e.clientX - startX, e.clientY - startY);
	      lastX = e.clientX; lastY = e.clientY;
	      if (!this._dragging) {
	        if (moved < (isTouch ? 2 : 4)) return;
	        this._dragging = true;
	        this.dom.style.cursor = 'none';
	      }
	      this.markHumanInput();
	      this._cameraEuler.setFromQuaternion(this.camera.quaternion);
	      this._cameraEuler.y -= dx * radiansPerPixel;
	      this._cameraEuler.x = Math.max(-1.25, Math.min(1.15, this._cameraEuler.x - dy * radiansPerPixel));
	      this.camera.quaternion.setFromEuler(this._cameraEuler);
	    }, { passive: false });
	    this.dom.addEventListener('wheel', (e) => {
	      if (e.target.closest && e.target.closest('#ui-root')) return;
      e.preventDefault();
      this.markHumanInput();
      const wheel = THREE.MathUtils.clamp(e.deltaY, -180, 180);
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      this.camera.position.addScaledVector(dir, -wheel * 0.6);
	    }, { passive: false });
	  }

	  _handleTouchPanZoom(touches) {
	    const a = touches[0];
	    const b = touches[1];
	    const cx = (a.x + b.x) * 0.5;
	    const cy = (a.y + b.y) * 0.5;
	    const distance = Math.hypot(a.x - b.x, a.y - b.y);
	    if (!this._pinchCentroid || !this._pinchDistance) {
	      this._pinchCentroid = { x: cx, y: cy };
	      this._pinchDistance = distance;
	      this.markHumanInput();
	      return;
	    }

	    const dx = THREE.MathUtils.clamp(cx - this._pinchCentroid.x, -80, 80);
	    const dy = THREE.MathUtils.clamp(cy - this._pinchCentroid.y, -80, 80);
	    const pinch = THREE.MathUtils.clamp(distance - this._pinchDistance, -80, 80);
	    this._pinchCentroid.x = cx;
	    this._pinchCentroid.y = cy;
	    this._pinchDistance = distance;
	    this.markHumanInput();

	    const altitudeScale = Math.max(0.8, Math.min(8, this.camera.position.y * 0.004));
	    const zoomScale = Math.max(1.5, Math.min(18, this.camera.position.y * 0.008));
	    const forward = new THREE.Vector3();
	    const right = new THREE.Vector3();
	    const up = new THREE.Vector3();
	    this.camera.getWorldDirection(forward);
	    right.crossVectors(forward, this.camera.up).normalize();
	    up.set(0, 1, 0);
	    this.camera.position
	      .addScaledVector(right, -dx * altitudeScale)
	      .addScaledVector(up, dy * altitudeScale)
	      .addScaledVector(forward, pinch * zoomScale);
	  }

  update(dt) {
    if (!this._keys.size) return;
    this.markHumanInput();
    const frameDt = Math.min(dt, KEYBOARD_CAMERA.maxFrameSeconds);
    const now = performance.now();
    let heldSeconds = 0;
    for (const startedAt of this._keys.values()) {
      heldSeconds = Math.max(heldSeconds, (now - startedAt) / 1000);
    }
    const t = THREE.MathUtils.clamp(heldSeconds / KEYBOARD_CAMERA.accelSeconds, 0, 1);
    const ramp = t * t * (3 - 2 * t);
    const moveSpeed = THREE.MathUtils.lerp(KEYBOARD_CAMERA.minMoveSpeed, KEYBOARD_CAMERA.maxMoveSpeed, ramp) * frameDt;
    const altitudeSpeed = THREE.MathUtils.lerp(KEYBOARD_CAMERA.minAltitudeSpeed, KEYBOARD_CAMERA.maxAltitudeSpeed, ramp) * frameDt;
    const yawStep = THREE.MathUtils.lerp(KEYBOARD_CAMERA.minYawSpeed, KEYBOARD_CAMERA.maxYawSpeed, ramp) * frameDt;

    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 0.0001) forward.set(0, 0, -1);
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();

    const move = new THREE.Vector3();
    if (this._keys.has('w')) move.add(forward);
    if (this._keys.has('s')) move.sub(forward);
    if (this._keys.has('d')) move.add(right);
    if (this._keys.has('a')) move.sub(right);
    if (this._keys.has('arrowup')) move.y += 1;
    if (this._keys.has('q') || this._keys.has('arrowdown')) move.y -= 1;

    if (move.lengthSq() > 0) {
      const horizontal = new THREE.Vector3(move.x, 0, move.z);
      if (horizontal.lengthSq() > 0) {
        horizontal.normalize().multiplyScalar(moveSpeed);
        horizontal.clampLength(0, KEYBOARD_CAMERA.maxMoveSpeed * frameDt);
      }
      const vertical = Math.sign(move.y) * altitudeSpeed;
      this.camera.position.add(new THREE.Vector3(horizontal.x, vertical, horizontal.z));
    }

    let yawDelta = 0;
    if (this._keys.has('arrowleft')) yawDelta += yawStep;
    if (this._keys.has('arrowright')) yawDelta -= yawStep;
    if (yawDelta) {
      this._cameraEuler.setFromQuaternion(this.camera.quaternion);
      this._cameraEuler.y += yawDelta;
      this.camera.quaternion.setFromEuler(this._cameraEuler);
    }
  }
}
