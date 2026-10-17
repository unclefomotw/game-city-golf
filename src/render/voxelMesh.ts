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

const WHITE = new THREE.Color(1, 1, 1);

/**
 * Materials whose tile has no up direction. Each of their cells is turned by a
 * random multiple of 90 degrees per axis, so a big wall doesn't show one
 * repeated tile (ADR-020). A unit cube is unchanged by these turns, so only the
 * texture orientation on each face changes; mirroring is avoided because it
 * flips face winding.
 */
const ROTATED_TILES: ReadonlySet<MaterialKind> = new Set(['stone']);
const QUARTER_TURNS: THREE.Matrix4[] = [];
for (let a = 0; a < 4; a++)
  for (let b = 0; b < 4; b++)
    for (let c = 0; c < 4; c++)
      QUARTER_TURNS.push(
        new THREE.Matrix4().makeRotationFromEuler(
          new THREE.Euler((a * Math.PI) / 2, (b * Math.PI) / 2, (c * Math.PI) / 2),
        ),
      );

export class VoxelMesh {
  readonly group = new THREE.Group();
  private readonly meshes = {} as Record<MaterialKind, THREE.InstancedMesh>;
  private readonly materialOf: MaterialOf;
  private readonly colors: THREE.Color[];
  private builtVersion = -1;

  constructor(
    private readonly grid: VoxelGrid,
    buildings: Building[],
  ) {
    this.materialOf = materialLookup(buildings);
    this.colors = buildings.map((b) => new THREE.Color(b.color));
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
          if (ROTATED_TILES.has(kind)) {
            const turn = Math.floor(VoxelMesh.hash(z, x, y) * QUARTER_TURNS.length);
            m.copy(QUARTER_TURNS[turn]).setPosition(x + 0.5, y + 0.5, z + 0.5);
          } else {
            m.makeTranslation(x + 0.5, y + 0.5, z + 0.5);
          }
          mesh.setMatrixAt(n, m);
          // The texture shows the material; the building's paint is multiplied on top (ADR-020),
          // with a little per-cell shade jitter (VIS-1).
          c.copy(this.colors[id - 1] ?? WHITE).multiplyScalar(1 + (VoxelMesh.hash(x, y, z) - 0.5) * 0.06);
          mesh.setColorAt(n, c);
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
