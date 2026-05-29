import * as THREE from 'three';

const TAKEOVER_IDLE_SECONDS = 3.0;
const TAKEOVER_BLEND_SECONDS = 2.5;

export class CameraDirector {
  constructor(camera, humanControls, store) {
    this.camera = camera;
    this.human = humanControls;
    this.store = store;
    this.enabled = false;
    this.blend = 0;
    this.state = 'human';
    this.anchorPosition = new THREE.Vector3();
    this.anchorQuaternion = new THREE.Quaternion();
    this.targetPosition = new THREE.Vector3();
    this.targetQuaternion = new THREE.Quaternion();
    this.syncFromCamera();

    store.subscribe((evt) => {
      if (evt.path === '*' || evt.path === 'camera.director') {
        this.enabled = !!store.get('camera.director');
        if (!this.enabled) this.returnToHuman();
      }
    });
    this.enabled = !!store.get('camera.director');
  }

  syncFromCamera() {
    this.anchorPosition.copy(this.camera.position);
    this.anchorQuaternion.copy(this.camera.quaternion);
    this.targetPosition.copy(this.camera.position);
    this.targetQuaternion.copy(this.camera.quaternion);
  }

  returnToHuman() {
    this.state = 'human';
    this.blend = 0;
    this.syncFromCamera();
  }

  update(dt) {
    if (!this.enabled) {
      this.returnToHuman();
      return;
    }

    const now = performance.now();
    const humanActive = this.human.hasActiveInput();
    const idleSeconds = this.human.getIdleSeconds(now);
    if (humanActive || idleSeconds < TAKEOVER_IDLE_SECONDS) {
      this.returnToHuman();
      return;
    }

    if (this.state !== 'director') {
      this.state = 'director';
      this.syncFromCamera();
    }

    this.blend = Math.min(1, this.blend + dt / TAKEOVER_BLEND_SECONDS);

    // The path/focus math intentionally does not exist yet. The scaffold is
    // quaternion-native so future yaw/pitch/roll/tilt moves can blend from the
    // human camera without fighting WASD or mouse look.
    this.targetPosition.copy(this.anchorPosition);
    this.targetQuaternion.copy(this.anchorQuaternion);
    this.camera.position.lerpVectors(this.anchorPosition, this.targetPosition, this.blend);
    this.camera.quaternion.slerpQuaternions(this.anchorQuaternion, this.targetQuaternion, this.blend);
  }

  getDebugState() {
    return {
      enabled: this.enabled,
      state: this.state,
      blend: this.blend,
      idleSeconds: this.human.getIdleSeconds(),
    };
  }
}
