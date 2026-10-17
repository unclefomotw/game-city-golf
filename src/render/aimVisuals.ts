// SHOT-2/SHOT-5: shows where the ball will go before it is hit.
// - a 3D arrow along the launch direction (length = power)
// - its shadow on the ground (horizontal direction)
// - an arc between the two (elevation)
// - a short dotted preview of the real trajectory, fading with camera distance

import * as THREE from 'three';
import type { Config } from '../config';
import { horizontalDir, launchDirection, type ShotInput } from '../physics/ballSim';

const MAX_DOTS = 160;
const UP = new THREE.Vector3(0, 1, 0);

function powerColor(power: number, out: THREE.Color): THREE.Color {
  return out.setHSL(0.33 * (1 - power), 0.9, 0.5);
}

export class AimVisuals {
  readonly group = new THREE.Group();
  private readonly arrow = new THREE.Group();
  private readonly shaft: THREE.Mesh;
  private readonly head: THREE.Mesh;
  private readonly arrowMat = new THREE.MeshBasicMaterial({ color: 0x44ff44 });
  private readonly groundLine: THREE.Mesh;
  private readonly arc: THREE.Line;
  private readonly dots: THREE.InstancedMesh;
  private readonly dotOpacity = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DOTS), 1);

  constructor() {
    this.shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1, 8), this.arrowMat);
    this.head = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 12), this.arrowMat);
    this.arrow.add(this.shaft, this.head);

    this.groundLine = new THREE.Mesh(
      new THREE.PlaneGeometry(0.12, 1),
      new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.55, depthWrite: false }),
    );

    this.arc = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff }));

    const dotGeometry = new THREE.SphereGeometry(0.1, 8, 6);
    dotGeometry.setAttribute('instanceOpacity', this.dotOpacity);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
    // Per-dot opacity, so farther dots read lighter and the line gains depth.
    dotMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float instanceOpacity;\nvarying float vInstanceOpacity;',
        )
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInstanceOpacity = instanceOpacity;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vInstanceOpacity;')
        .replace('vec4( diffuse, opacity )', 'vec4( diffuse, opacity * vInstanceOpacity )');
    };
    this.dots = new THREE.InstancedMesh(dotGeometry, dotMat, MAX_DOTS);
    this.dots.frustumCulled = false;

    this.group.add(this.arrow, this.groundLine, this.arc, this.dots);
    // Aim feedback must stay readable even when buildings are in the way.
    this.group.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (mat) mat.depthTest = false;
      o.renderOrder = 11;
    });
  }

  update(
    ball: THREE.Vector3,
    shot: ShotInput,
    preview: THREE.Vector3[],
    cameraPos: THREE.Vector3,
    opts: Config['preview'],
  ): void {
    const dir = launchDirection(shot.azimuth, shot.elevation);
    const flat = horizontalDir(shot.azimuth);
    const len = 1 + shot.power * 5;

    // Arrow: a +Y cylinder rotated onto the launch direction.
    powerColor(shot.power, this.arrowMat.color);
    this.arrow.position.copy(ball);
    this.arrow.quaternion.setFromUnitVectors(UP, dir);
    this.shaft.scale.set(1, len, 1);
    this.shaft.position.set(0, len / 2, 0);
    this.head.position.set(0, len + 0.3, 0);

    // Ground shadow of the arrow, just above whatever the ball rests on.
    const horizontalLen = Math.max(0.3, len * Math.cos(shot.elevation));
    this.groundLine.scale.set(1, horizontalLen, 1);
    this.groundLine.position.copy(ball).addScaledVector(flat, horizontalLen / 2);
    this.groundLine.position.y = Math.max(0.02, ball.y - 0.28);
    // Lay the plane flat and point its length along the horizontal direction.
    // (YXZ: lay flat first, then turn about world Y.)
    this.groundLine.rotation.set(-Math.PI / 2, -shot.azimuth, 0, 'YXZ');

    // Elevation arc from the ground direction up to the launch direction.
    const r = 1.6;
    const pts: THREE.Vector3[] = [];
    const steps = 16;
    for (let i = 0; i <= steps; i++) {
      const e = (shot.elevation * i) / steps;
      pts.push(ball.clone().add(launchDirection(shot.azimuth, e).multiplyScalar(r)));
    }
    this.arc.geometry.setFromPoints(pts);

    // Preview dots, thinned out so spacing reads as speed.
    const m = new THREE.Matrix4();
    const dist: number[] = [];
    for (let i = 3; i < preview.length && dist.length < MAX_DOTS; i += 3) {
      m.makeTranslation(preview[i].x, preview[i].y, preview[i].z);
      this.dots.setMatrixAt(dist.length, m);
      dist.push(preview[i].distanceTo(cameraPos));
    }
    // Nearest dot is opaque, farther ones fade toward farOpacity. The span has
    // a floor so a line seen side-on (all dots about equally far) stays even.
    const near = Math.min(...dist);
    const span = Math.max(opts.depthFadeSpan, Math.max(...dist) - near);
    dist.forEach((d, i) => {
      this.dotOpacity.setX(i, THREE.MathUtils.lerp(1, opts.farOpacity, (d - near) / span));
    });
    this.dots.count = dist.length;
    this.dots.instanceMatrix.needsUpdate = true;
    this.dotOpacity.needsUpdate = true;
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }
}
