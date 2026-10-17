// Renders the building grid as one InstancedMesh per material (ADR-003, ADR-019).
// Only cells with at least one empty neighbour are drawn; the meshes are
// rebuilt whenever the grid's version changes (DES-2: destruction persists).

import * as THREE from 'three';
import type { Building } from '../world/levelGen';
import { MATERIALS, type MaterialKind, type MaterialOf, materialLookup } from '../world/materials';
import type { VoxelGrid } from '../world/voxelGrid';
import { createMaterialMeshMaterials } from './materialTextures';

const NEIGHBOURS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;

export class VoxelMesh {
  readonly group = new THREE.Group();
  private readonly meshes = {} as Record<MaterialKind, THREE.InstancedMesh>;
  private readonly materialOf: MaterialOf;
  private builtVersion = -1;

  constructor(
    private readonly grid: VoxelGrid,
    buildings: Building[],
  ) {
    this.materialOf = materialLookup(buildings);
    // A material can never show more cells than it has solid ones.
    const capacity = Object.fromEntries(MATERIALS.map((m) => [m, 0])) as Record<MaterialKind, number>;
    for (const c of grid.cells) if (c !== 0) capacity[this.materialOf(c)]++;
    const materials = createMaterialMeshMaterials();
    const box = new THREE.BoxGeometry(1, 1, 1);
    for (const kind of MATERIALS) {
      const cap = Math.max(1, capacity[kind]);
      const mesh = new THREE.InstancedMesh(box, materials[kind], cap);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      this.meshes[kind] = mesh;
      this.group.add(mesh);
    }
    this.update();
  }

  /** Cheap integer hash for per-cell shade variation. */
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
    const count = Object.fromEntries(MATERIALS.map((k) => [k, 0])) as Record<MaterialKind, number>;
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
          const kind = this.materialOf(id);
          const mesh = this.meshes[kind];
          const n = count[kind]++;
          m.makeTranslation(x + 0.5, y + 0.5, z + 0.5);
          mesh.setMatrixAt(n, m);
          // The texture carries the colour; tint only shades buildings and cells apart (VIS-1).
          const shade = 1 + (VoxelMesh.hash(id, 0, 0) - 0.5) * 0.12 + (VoxelMesh.hash(x, y, z) - 0.5) * 0.06;
          mesh.setColorAt(n, c.setScalar(shade));
        }
    for (const kind of MATERIALS) {
      const mesh = this.meshes[kind];
      mesh.count = count[kind];
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }
}
