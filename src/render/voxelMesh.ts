// Renders the building grid as one InstancedMesh (ADR-003).
// Only cells with at least one empty neighbour are drawn; the mesh is
// rebuilt whenever the grid's version changes (DES-2: destruction persists).

import * as THREE from 'three';
import type { Building } from '../world/levelGen';
import type { VoxelGrid } from '../world/voxelGrid';

const NEIGHBOURS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;

export class VoxelMesh {
  readonly mesh: THREE.InstancedMesh;
  private builtVersion = -1;
  private readonly colors: THREE.Color[];

  constructor(
    private readonly grid: VoxelGrid,
    buildings: Building[],
  ) {
    this.colors = buildings.map((b) => new THREE.Color(b.color));
    const capacity = Math.max(1, grid.countSolid());
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), capacity);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.update();
  }

  /** Cheap integer hash for per-cell colour variation. */
  private static hash(x: number, y: number, z: number): number {
    let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  update(): void {
    if (this.grid.version === this.builtVersion) return;
    this.builtVersion = this.grid.version;
    const { grid } = this;
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const window = new THREE.Color(0x4a6680);
    let n = 0;
    for (let y = 0; y < grid.sizeY; y++)
      for (let z = 0; z < grid.sizeZ; z++)
        for (let x = 0; x < grid.sizeX; x++) {
          const id = grid.get(x, y, z);
          if (id === 0) continue;
          let exposed = false;
          for (const [dx, dy, dz] of NEIGHBOURS) {
            if (y + dy < 0) continue; // the ground hides the bottom face
            if (!grid.isSolid(x + dx, y + dy, z + dz)) {
              exposed = true;
              break;
            }
          }
          if (!exposed) continue;
          m.makeTranslation(x + 0.5, y + 0.5, z + 0.5);
          this.mesh.setMatrixAt(n, m);
          c.copy(this.colors[id - 1]);
          // Rough "window" pattern plus per-cell shade jitter (VIS-1).
          if (y % 2 === 1 && (x + z) % 2 === 0) c.lerp(window, 0.45);
          c.offsetHSL(0, 0, (VoxelMesh.hash(x, y, z) - 0.5) * 0.06);
          this.mesh.setColorAt(n, c);
          n++;
        }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    this.mesh.computeBoundingSphere();
  }
}
