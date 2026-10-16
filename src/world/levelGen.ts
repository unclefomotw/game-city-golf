// Procedural city generation (LVL-1 ~ LVL-3).

import { createRng, type Rng } from '../core/rng';
import { VoxelGrid } from './voxelGrid';

export const GROUND_ROAD = 1;
export const GROUND_BLOCK = 0;
export const GROUND_PLAZA = 2;

export type Building = { id: number; color: number };

export type Level = {
  seed: number;
  grid: VoxelGrid;
  buildings: Building[];
  /** Ground type per (x, z) column, index x + z * sizeX. */
  ground: Uint8Array;
  /** Ball center at the tee. */
  start: { x: number; y: number; z: number };
  /** FLD-2: the goal is a circular region on the ground. */
  goal: { x: number; z: number; radius: number };
};

export type LevelOptions = {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  ballRadius: number;
};

export const DEFAULT_LEVEL_OPTIONS: LevelOptions = { sizeX: 72, sizeY: 40, sizeZ: 72, ballRadius: 0.3 };

const BUILDING_COLORS = [
  0xd9826b, 0xe0b46c, 0x8fb3c9, 0xa3c48f, 0xc9a0c9, 0xe8e2d0, 0x9aa3b5, 0xd6c27a, 0x7fb8a8, 0xcf8f8f,
];

type Rect = { x0: number; z0: number; x1: number; z1: number }; // half-open [x0, x1)

/** Splits [lo, hi) into alternating block spans separated by roads. */
function splitAxis(rng: Rng, lo: number, hi: number): [number, number][] {
  const spans: [number, number][] = [];
  let p = lo;
  while (p < hi) {
    const size = rng.int(9, 14);
    const end = Math.min(p + size, hi);
    if (end - p >= 5) spans.push([p, end]);
    p = end + rng.int(3, 4);
  }
  return spans;
}

export function generateLevel(seed: number, opts: LevelOptions = DEFAULT_LEVEL_OPTIONS): Level {
  const rng = createRng(seed);
  // LVL-3: retry within the same RNG stream so the seed stays reproducible.
  for (let attempt = 0; attempt < 20; attempt++) {
    const level = tryGenerate(seed, rng, opts);
    if (level && isSolvable(level)) return level;
  }
  throw new Error(`Could not generate a solvable level for seed ${seed}`);
}

function tryGenerate(seed: number, rng: Rng, opts: LevelOptions): Level | null {
  const { sizeX, sizeY, sizeZ, ballRadius } = opts;
  const grid = new VoxelGrid(sizeX, sizeY, sizeZ);
  const ground = new Uint8Array(sizeX * sizeZ).fill(GROUND_ROAD);
  const margin = 3;

  const xs = splitAxis(rng, margin, sizeX - margin);
  const zs = splitAxis(rng, margin, sizeZ - margin);
  const blocks: Rect[] = [];
  for (const [x0, x1] of xs) for (const [z0, z1] of zs) blocks.push({ x0, z0, x1, z1 });
  if (blocks.length < 4) return null;

  // Tee near a random corner; goal in a block far from it.
  const corner = { x: rng.chance(0.5) ? 1.5 : sizeX - 1.5, z: rng.chance(0.5) ? 1.5 : sizeZ - 1.5 };
  const center = (b: Rect) => ({ x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 });
  const dist = (b: Rect) => Math.hypot(center(b).x - corner.x, center(b).z - corner.z);
  const maxDist = Math.max(...blocks.map(dist));
  const farBlocks = blocks.filter((b) => dist(b) >= maxDist * 0.75);
  const goalBlock = rng.pick(farBlocks);

  const buildings: Building[] = [];
  for (const block of blocks) {
    for (let x = block.x0; x < block.x1; x++)
      for (let z = block.z0; z < block.z1; z++)
        ground[x + z * sizeX] = block === goalBlock ? GROUND_PLAZA : GROUND_BLOCK;
    if (block === goalBlock) continue;
    if (rng.chance(0.08)) continue; // occasional empty lot / park
    for (const lot of subdivide(rng, block, 2)) {
      const inset = rng.int(0, 1);
      const r = { x0: lot.x0 + inset, z0: lot.z0 + inset, x1: lot.x1 - inset, z1: lot.z1 - inset };
      if (r.x1 - r.x0 < 2 || r.z1 - r.z0 < 2) continue;
      const tall = rng.chance(0.2);
      const height = Math.min(sizeY - 8, tall ? rng.int(18, 30) : rng.int(4, 14));
      const id = buildings.length;
      buildings.push({ id, color: rng.pick(BUILDING_COLORS) });
      for (let x = r.x0; x < r.x1; x++)
        for (let z = r.z0; z < r.z1; z++) for (let y = 0; y < height; y++) grid.set(x, y, z, id + 1);
    }
  }

  const gc = center(goalBlock);
  const goalRadius = Math.max(2, Math.min(goalBlock.x1 - goalBlock.x0, goalBlock.z1 - goalBlock.z0) / 2 - 2.5);
  return {
    seed,
    grid,
    buildings,
    ground,
    start: { x: corner.x, y: ballRadius, z: corner.z },
    goal: { x: gc.x, z: gc.z, radius: Math.min(goalRadius, 3) },
  };
}

/** Recursively splits a block into building lots. */
function subdivide(rng: Rng, r: Rect, depth: number): Rect[] {
  const w = r.x1 - r.x0;
  const d = r.z1 - r.z0;
  if (depth === 0 || Math.max(w, d) < 8 || rng.chance(0.3)) return [r];
  if (w >= d) {
    const cut = r.x0 + rng.int(Math.floor(w * 0.35), Math.ceil(w * 0.65));
    return [...subdivide(rng, { ...r, x1: cut }, depth - 1), ...subdivide(rng, { ...r, x0: cut }, depth - 1)];
  }
  const cut = r.z0 + rng.int(Math.floor(d * 0.35), Math.ceil(d * 0.65));
  return [...subdivide(rng, { ...r, z1: cut }, depth - 1), ...subdivide(rng, { ...r, z0: cut }, depth - 1)];
}

/**
 * LVL-3: the goal must be reachable. Shots can also fly over buildings, so
 * a ground-level path of open columns from tee to goal is a sufficient check.
 */
export function isSolvable(level: Level): boolean {
  const { grid, start, goal } = level;
  const { sizeX, sizeZ } = grid;
  const open = (x: number, z: number) => x >= 0 && z >= 0 && x < sizeX && z < sizeZ && !grid.isSolid(x, 0, z);
  const sx = Math.floor(start.x);
  const sz = Math.floor(start.z);
  const gx = Math.floor(goal.x);
  const gz = Math.floor(goal.z);
  if (!open(sx, sz) || !open(gx, gz)) return false;
  const seen = new Uint8Array(sizeX * sizeZ);
  const queue = [sx + sz * sizeX];
  seen[queue[0]] = 1;
  while (queue.length) {
    const i = queue.pop()!;
    const x = i % sizeX;
    const z = (i - x) / sizeX;
    if (x === gx && z === gz) return true;
    for (const [nx, nz] of [
      [x + 1, z],
      [x - 1, z],
      [x, z + 1],
      [x, z - 1],
    ]) {
      if (open(nx, nz) && !seen[nx + nz * sizeX]) {
        seen[nx + nz * sizeX] = 1;
        queue.push(nx + nz * sizeX);
      }
    }
  }
  return false;
}
