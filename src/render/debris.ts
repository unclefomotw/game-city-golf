// DES-5/DES-6: destroyed cells burst into visual-only debris.
// Fake gravity, spin and shrink; never touches the ball physics.

import * as THREE from 'three';
import type { Config } from '../config';
import type { Building } from '../world/levelGen';
import type { RemovedCell } from '../world/voxelGrid';

type Particle = {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  axis: THREE.Vector3;
  angle: number;
  spinRate: number;
  age: number;
  size: number;
};

export class Debris {
  readonly mesh: THREE.InstancedMesh;
  private particles: (Particle | null)[];
  private cursor = 0;

  constructor(private readonly cfg: Config) {
    const cap = cfg.debris.maxParticles;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), cap);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.particles = new Array(cap).fill(null);
  }

  spawn(cells: RemovedCell[], impact: THREE.Vector3, speed: number, buildings: Building[]): void {
    const d = this.cfg.debris;
    const color = new THREE.Color();
    for (const cell of cells) {
      // Each destroyed cell breaks into a couple of chunks.
      for (let k = 0; k < 2; k++) {
        const pos = new THREE.Vector3(cell.x + Math.random(), cell.y + Math.random(), cell.z + Math.random());
        const out = pos.clone().sub(impact).normalize();
        const vel = out
          .multiplyScalar(d.speed * (0.5 + Math.random()) * Math.min(2, speed / 20 + 0.5))
          .add(new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 6, (Math.random() - 0.5) * 4));
        const slot = this.cursor;
        this.cursor = (this.cursor + 1) % this.particles.length;
        this.particles[slot] = {
          pos,
          vel,
          axis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
          angle: 0,
          spinRate: (Math.random() - 0.5) * 16,
          age: 0,
          size: 0.35 + Math.random() * 0.35,
        };
        color.set(buildings[cell.id - 1]?.color ?? 0xcccccc).offsetHSL(0, 0, (Math.random() - 0.5) * 0.1);
        this.mesh.setColorAt(slot, color);
      }
    }
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(dt: number): void {
    const d = this.cfg.debris;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    let maxSlot = 0;
    this.particles.forEach((p, i) => {
      if (!p) {
        this.mesh.setMatrixAt(i, zero);
        return;
      }
      p.age += dt;
      if (p.age >= d.lifetime) {
        this.particles[i] = null;
        this.mesh.setMatrixAt(i, zero);
        return;
      }
      p.vel.y -= d.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < p.size / 2) {
        p.pos.y = p.size / 2;
        p.vel.y *= -0.3;
        p.vel.x *= 0.7;
        p.vel.z *= 0.7;
      }
      p.angle += p.spinRate * dt;
      const shrink = p.size * (1 - (p.age / d.lifetime) ** 2);
      q.setFromAxisAngle(p.axis, p.angle);
      m.compose(p.pos, q, s.setScalar(shrink));
      this.mesh.setMatrixAt(i, m);
      maxSlot = i + 1;
    });
    this.mesh.count = Math.max(maxSlot, 0);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
