// Two camera modes (ADR-007, CAM-1, CAM-2):
// - orbit: circles the ball; used for aiming and following the shot
// - free ("靈魂出竅"): fly anywhere in the field

import * as THREE from 'three';
import type { Config } from '../config';

export type CameraMode = 'orbit' | 'free';

/** Movement intent in camera space, each axis -1..1. */
export type MoveInput = { forward: number; right: number; up: number; fast: boolean };

export class CameraRig {
  mode: CameraMode = 'orbit';
  private readonly target = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0.35;
  private distance: number;
  private readonly freePos = new THREE.Vector3();
  private freeYaw = 0;
  private freePitch = 0;
  private shakeAmount = 0;
  /** Pitch actually used, raised above `pitch` when buildings block the view. */
  private viewPitch = 0.35;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly cfg: Config,
    private readonly bounds: THREE.Vector3,
    /** True if a world position is inside a building cell. */
    private readonly isBlocked: (p: THREE.Vector3) => boolean,
  ) {
    this.distance = cfg.camera.orbitDistance;
  }

  /** Puts the orbit camera behind the ball, looking along `azimuth`. */
  lookAlong(ball: THREE.Vector3, azimuth: number): void {
    this.target.copy(ball);
    this.yaw = -azimuth;
  }

  /** Horizontal direction the camera faces, in the shot azimuth convention. */
  facingAzimuth(): number {
    const d = this.camera.getWorldDirection(new THREE.Vector3());
    return Math.atan2(d.x, -d.z);
  }

  rotate(dxPx: number, dyPx: number): void {
    const s = this.cfg.camera.lookSensitivity;
    if (this.mode === 'orbit') {
      this.yaw -= dxPx * s;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dyPx * s, -0.2, 1.5);
    } else {
      this.freeYaw -= dxPx * s;
      this.freePitch = THREE.MathUtils.clamp(this.freePitch - dyPx * s, -1.5, 1.5);
    }
  }

  /** factor > 1 moves closer (orbit) or forward (free). */
  zoom(factor: number): void {
    if (this.mode === 'orbit') {
      const c = this.cfg.camera;
      this.distance = THREE.MathUtils.clamp(this.distance / factor, c.minDistance, c.maxDistance);
    } else {
      const forward = new THREE.Vector3();
      this.camera.getWorldDirection(forward);
      this.freePos.addScaledVector(forward, Math.log(factor) * 12);
    }
  }

  enterFree(): void {
    this.mode = 'free';
    this.freePos.copy(this.camera.position);
    const d = this.camera.getWorldDirection(new THREE.Vector3());
    this.freeYaw = Math.atan2(-d.x, -d.z);
    this.freePitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
  }

  /** CAM-2: back to the ball. */
  returnToBall(): void {
    this.mode = 'orbit';
  }

  shake(amount: number): void {
    this.shakeAmount = Math.min(1.2, this.shakeAmount + amount);
  }

  private orbitDir(pitch: number): THREE.Vector3 {
    const cp = Math.cos(pitch);
    return new THREE.Vector3(Math.sin(this.yaw) * cp, Math.sin(pitch), Math.cos(this.yaw) * cp);
  }

  /** How far the camera can sit from the target at this pitch before hitting a building. */
  private clearDistance(pitch: number): number {
    const dir = this.orbitDir(pitch);
    const probe = new THREE.Vector3();
    for (let t = 0.5; t <= this.distance; t += 0.25) {
      if (this.isBlocked(probe.copy(this.target).addScaledVector(dir, t))) return Math.max(0.6, t - 0.5);
    }
    return this.distance;
  }

  update(dt: number, ball: THREE.Vector3, move: MoveInput): void {
    const cam = this.camera;
    if (this.mode === 'orbit') {
      this.target.lerp(ball, 1 - Math.exp(-8 * dt));
      // If a building blocks the view, tilt up until the ball is visible
      // over the rooftops instead of zooming in onto the ball.
      // If no angle is clear (e.g. the ball is in a tunnel), stay at the normal
      // distance and rely on the X-ray ball and aim visuals.
      const enough = Math.min(this.distance, 6);
      let wantPitch: number | null = null;
      for (let p = this.pitch; p <= 1.45 && wantPitch === null; p += 0.08) {
        if (this.clearDistance(p) >= enough) wantPitch = p;
      }
      this.viewPitch += ((wantPitch ?? this.pitch) - this.viewPitch) * (1 - Math.exp(-6 * dt));
      const clear = this.clearDistance(this.viewPitch);
      const dist = wantPitch === null ? this.distance : clear;
      cam.position.copy(this.target).addScaledVector(this.orbitDir(this.viewPitch), dist);
      cam.position.y = Math.max(0.4, cam.position.y);
      cam.lookAt(this.target);
    } else {
      const c = this.cfg.camera;
      const speed = c.freeSpeed * (move.fast ? c.freeFastMultiplier : 1) * dt;
      const forward = new THREE.Vector3(-Math.sin(this.freeYaw), 0, -Math.cos(this.freeYaw));
      const right = new THREE.Vector3(Math.cos(this.freeYaw), 0, -Math.sin(this.freeYaw));
      this.freePos
        .addScaledVector(forward, move.forward * speed)
        .addScaledVector(right, move.right * speed)
        .addScaledVector(new THREE.Vector3(0, 1, 0), move.up * speed);
      // Stay inside (slightly beyond) the field box so the player never gets lost.
      const m = 10;
      this.freePos.x = THREE.MathUtils.clamp(this.freePos.x, -m, this.bounds.x + m);
      this.freePos.y = THREE.MathUtils.clamp(this.freePos.y, 0.5, this.bounds.y + m);
      this.freePos.z = THREE.MathUtils.clamp(this.freePos.z, -m, this.bounds.z + m);
      cam.position.copy(this.freePos);
      cam.rotation.set(this.freePitch, this.freeYaw, 0, 'YXZ');
    }
    if (this.shakeAmount > 0.001) {
      const a = this.shakeAmount * 0.4;
      cam.position.add(
        new THREE.Vector3((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a),
      );
      this.shakeAmount *= Math.exp(-6 * dt);
    }
  }
}
