// Buildings are a 3D occupancy grid of unit cells (ADR-003).
// Cell (x, y, z) spans [x, x+1) x [y, y+1) x [z, z+1) in world units.
// The ground is the plane y = 0 and is not part of the grid.

import type { MaterialKind } from './materials';

export type CellCoord = { x: number; y: number; z: number };
/** A removed cell, the building it belonged to (id + 1, as stored in the grid) and its material. */
export type RemovedCell = CellCoord & { id: number; material: MaterialKind };

/** Read-only view of which cells are solid. Physics only depends on this. */
export interface SolidQuery {
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  isSolid(x: number, y: number, z: number): boolean;
  /** Cell value: 0 = empty, otherwise building id + 1. */
  get(x: number, y: number, z: number): number;
  /** Removes a cell; returns its previous value, or 0 if it was already empty. */
  remove(x: number, y: number, z: number): number;
}

export class VoxelGrid implements SolidQuery {
  /** 0 = empty, otherwise (building id + 1). */
  readonly cells: Uint16Array;
  /** Bumped on every change so renderers know when to rebuild. */
  version = 0;

  constructor(
    readonly sizeX: number,
    readonly sizeY: number,
    readonly sizeZ: number,
  ) {
    this.cells = new Uint16Array(sizeX * sizeY * sizeZ);
  }

  index(x: number, y: number, z: number): number {
    return (y * this.sizeZ + z) * this.sizeX + x;
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sizeX && y < this.sizeY && z < this.sizeZ;
  }

  get(x: number, y: number, z: number): number {
    return this.inBounds(x, y, z) ? this.cells[this.index(x, y, z)] : 0;
  }

  set(x: number, y: number, z: number, value: number): void {
    if (!this.inBounds(x, y, z)) return;
    this.cells[this.index(x, y, z)] = value;
    this.version++;
  }

  isSolid(x: number, y: number, z: number): boolean {
    return this.get(x, y, z) !== 0;
  }

  remove(x: number, y: number, z: number): number {
    const value = this.get(x, y, z);
    if (value === 0) return 0;
    this.cells[this.index(x, y, z)] = 0;
    this.version++;
    return value;
  }

  countSolid(): number {
    let n = 0;
    for (const c of this.cells) if (c !== 0) n++;
    return n;
  }
}

/**
 * Lets the aim preview simulate destruction (SHOT-5) without touching the
 * real grid: removals are recorded in a scratch set and discarded afterwards.
 */
export class PreviewOverlay implements SolidQuery {
  private readonly removed = new Set<number>();

  constructor(private readonly base: VoxelGrid) {}

  get sizeX() {
    return this.base.sizeX;
  }
  get sizeY() {
    return this.base.sizeY;
  }
  get sizeZ() {
    return this.base.sizeZ;
  }

  isSolid(x: number, y: number, z: number): boolean {
    return this.base.isSolid(x, y, z) && !this.removed.has(this.base.index(x, y, z));
  }

  get(x: number, y: number, z: number): number {
    return this.isSolid(x, y, z) ? this.base.get(x, y, z) : 0;
  }

  remove(x: number, y: number, z: number): number {
    if (!this.isSolid(x, y, z)) return 0;
    this.removed.add(this.base.index(x, y, z));
    return this.base.get(x, y, z);
  }
}
