// Procedural city generation (LVL-1 ~ LVL-3).

import { createRng, type Rng } from '../core/rng';
import type { MaterialKind } from './materials';
import { VoxelGrid } from './voxelGrid';

export const GROUND_ROAD = 1;
export const GROUND_BLOCK = 0;
export const GROUND_PLAZA = 2;
/** Distance markings in developer test scenes (ADR-010). */
export const GROUND_MARK = 3;

/** VIS-3: one material per building (one footprint rectangle); `color` is paint only and has no effect on play. */
export type Building = { id: number; material: MaterialKind; color: number };

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

/** The tee is always in the low corner, on the ground. */
export const TEE = { x: 1.5, z: 1.5 };
/** No building voxel may come closer than this to the tee center (horizontal, per axis). */
export const TEE_CLEARANCE = 5;
/** Share of the ground covered by the scattered footprints; breaking long lines adds roughly 10 points more. */
export const COVERAGE = 0.3;
/** Longest straight line of open ground along x or z, in cells (must stay below the field size). */
export const MAX_OPEN_RUN = 36;
/** Building footprint side length range, in cells. */
const RECT_MIN = 3;
const RECT_MAX = 12;
const REPAIR_RECT_MAX = 5;
const GOAL_RADIUS = 3;
/** The goal center is at least this share of the farthest possible goal distance from the tee. */
const GOAL_MIN_DIST = 0.75;

/**
 * VIS-3: relative odds of each material, for low buildings and for towers.
 * Towers lean to glass, metal and stone; low buildings to wood and brick.
 */
const MATERIAL_WEIGHTS: Record<'low' | 'tall', Record<MaterialKind, number>> = {
  low: { glass: 1, wood: 3, brick: 3, stone: 2, metal: 1 },
  tall: { glass: 3, wood: 0, brick: 1, stone: 2, metal: 2 },
};

/**
 * Paint colours per material (ADR-020). The texture shows the material and the
 * paint keeps the city colourful, so each material gets a cheerful range of its own.
 */
export const MATERIAL_PALETTES: Record<MaterialKind, readonly number[]> = {
  glass: [0xb0f0f6, 0xbcf2cc, 0xfbe8ae, 0xd8caf6, 0xc4e0fb],
  wood: [0xb07a48, 0xa3d4a0, 0xf0d070, 0xe8a0b0, 0xc8945c],
  brick: [0xd9826b, 0xe0a060, 0xe8d08a, 0xf0ece4, 0xcf8f8f],
  stone: [0xe0cc9e, 0xd8a8a0, 0xf2f0ea, 0xb8c0b0],
  metal: [0xa86662, 0x647a9a, 0x688a6e, 0xb08e62, 0x969ca2],
};

/** Weighted pick using a single draw, so the rest of the generation sequence is unchanged. */
function pickMaterial(rng: Rng, weights: Record<MaterialKind, number>): MaterialKind {
  const entries = Object.entries(weights) as [MaterialKind, number][];
  let t = rng.next() * entries.reduce((sum, [, w]) => sum + w, 0);
  for (const [m, w] of entries) {
    t -= w;
    if (t < 0) return m;
  }
  return entries[entries.length - 1][0];
}

type Rect = { x0: number; z0: number; x1: number; z1: number }; // half-open [x0, x1)

const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;

/** Shrinks a footprint so it stays out of `zone`, keeping the largest remaining piece. */
function clipOutOf(r: Rect, zone: Rect): Rect {
  if (!overlaps(r, zone)) return r;
  const pieces: Rect[] = [
    { ...r, x1: Math.min(r.x1, zone.x0) },
    { ...r, x0: Math.max(r.x0, zone.x1) },
    { ...r, z1: Math.min(r.z1, zone.z0) },
    { ...r, z0: Math.max(r.z0, zone.z1) },
  ];
  const area = (p: Rect) => Math.max(0, p.x1 - p.x0) * Math.max(0, p.z1 - p.z0);
  return pieces.reduce((best, p) => (area(p) > area(best) ? p : best));
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

/**
 * Scatters building footprints (they may overlap) until COVERAGE is reached,
 * then adds more wherever a row or column still has a long open stretch, so
 * no straight street runs from one boundary to the other.
 */
function tryGenerate(seed: number, rng: Rng, opts: LevelOptions): Level | null {
  const { sizeX, sizeY, sizeZ, ballRadius } = opts;

  const tee: Rect = {
    x0: Math.floor(TEE.x - TEE_CLEARANCE),
    z0: Math.floor(TEE.z - TEE_CLEARANCE),
    x1: Math.ceil(TEE.x + TEE_CLEARANCE),
    z1: Math.ceil(TEE.z + TEE_CLEARANCE),
  };

  // Goal: a random spot far from the tee with an open plaza around it.
  const m = GOAL_RADIUS + 1;
  const spots: { x: number; z: number; d: number }[] = [];
  for (let x = m; x <= sizeX - m; x++)
    for (let z = m; z <= sizeZ - m; z++) spots.push({ x, z, d: Math.hypot(x - TEE.x, z - TEE.z) });
  const maxDist = Math.max(...spots.map((p) => p.d));
  const goal = rng.pick(spots.filter((p) => p.d >= maxDist * GOAL_MIN_DIST));
  const plaza: Rect = { x0: goal.x - m, z0: goal.z - m, x1: goal.x + m, z1: goal.z + m };

  const footprints: Rect[] = [];
  const covered = new Uint8Array(sizeX * sizeZ);
  let coveredCount = 0;
  /** Adds a footprint clipped clear of the tee and plaza; `cover` is a cell it must still contain. */
  const place = (r: Rect, cover?: [number, number]) => {
    const c = clipOutOf(clipOutOf(r, tee), plaza);
    const x0 = Math.max(0, c.x0);
    const z0 = Math.max(0, c.z0);
    const x1 = Math.min(sizeX, c.x1);
    const z1 = Math.min(sizeZ, c.z1);
    if (x1 - x0 < 2 || z1 - z0 < 2) return false;
    if (cover && !(cover[0] >= x0 && cover[0] < x1 && cover[1] >= z0 && cover[1] < z1)) return false;
    footprints.push({ x0, z0, x1, z1 });
    for (let x = x0; x < x1; x++)
      for (let z = z0; z < z1; z++)
        if (!covered[x + z * sizeX]) {
          covered[x + z * sizeX] = 1;
          coveredCount++;
        }
    return true;
  };
  // Footprints may hang over the boundary, so edge cells are as likely covered as inner ones.
  const randomRect = (cx: number, cz: number, max = RECT_MAX): Rect => {
    const w = rng.int(RECT_MIN, max);
    const d = rng.int(RECT_MIN, max);
    const x0 = cx - rng.int(0, w - 1);
    const z0 = cz - rng.int(0, d - 1);
    return { x0, z0, x1: x0 + w, z1: z0 + d };
  };

  const target = COVERAGE * sizeX * sizeZ;
  for (let tries = 0; coveredCount < target && tries < 10000; tries++)
    place(randomRect(rng.int(0, sizeX - 1), rng.int(0, sizeZ - 1)));

  // Break every straight open line longer than MAX_OPEN_RUN with another footprint near its middle.
  const isOpen = (x: number, z: number) => !covered[x + z * sizeX];
  const reserved = (x: number, z: number) => {
    const cell = { x0: x, z0: z, x1: x + 1, z1: z + 1 };
    return overlaps(cell, tee) || overlaps(cell, plaza);
  };
  const overlongRuns = () => {
    const picks: [number, number][] = [];
    const scan = (n: number, cell: (i: number) => [number, number]) => {
      let start = 0;
      for (let i = 0; i <= n; i++) {
        if (i < n && isOpen(...cell(i))) continue;
        const len = i - start;
        if (len > MAX_OPEN_RUN) {
          const middle = [];
          for (let k = start + Math.floor(len / 3); k < start + Math.ceil((2 * len) / 3); k++)
            if (!reserved(...cell(k))) middle.push(cell(k));
          if (middle.length) picks.push(rng.pick(middle));
        }
        start = i + 1;
      }
    };
    for (let z = 0; z < sizeZ; z++) scan(sizeX, (x) => [x, z]);
    for (let x = 0; x < sizeX; x++) scan(sizeZ, (z) => [x, z]);
    return picks;
  };
  // Small footprints here, so breaking lines adds little coverage.
  for (let pass = 0; ; pass++) {
    const picks = overlongRuns();
    if (!picks.length) break;
    if (pass === 20) return null;
    for (const [x, z] of picks) for (let n = 0; n < 8 && !place(randomRect(x, z, REPAIR_RECT_MAX), [x, z]); n++);
  }

  const grid = new VoxelGrid(sizeX, sizeY, sizeZ);
  const buildings: Building[] = [];
  // Paint draws from its own stream so colours never shift the shape of the city.
  const paintRng = createRng((seed ^ 0x5bd1e995) >>> 0);
  for (const r of footprints) {
    const tall = rng.chance(0.2);
    const height = Math.min(sizeY - 8, tall ? rng.int(18, 30) : rng.int(4, 14));
    const id = buildings.length;
    const material = pickMaterial(rng, MATERIAL_WEIGHTS[tall ? 'tall' : 'low']);
    buildings.push({ id, material, color: paintRng.pick(MATERIAL_PALETTES[material]) });
    for (let x = r.x0; x < r.x1; x++)
      for (let z = r.z0; z < r.z1; z++) for (let y = 0; y < height; y++) grid.set(x, y, z, id + 1);
  }

  const ground = new Uint8Array(sizeX * sizeZ);
  for (let x = 0; x < sizeX; x++)
    for (let z = 0; z < sizeZ; z++) {
      const cell = { x0: x, z0: z, x1: x + 1, z1: z + 1 };
      ground[x + z * sizeX] = overlaps(cell, plaza)
        ? GROUND_PLAZA
        : covered[x + z * sizeX]
          ? GROUND_BLOCK
          : GROUND_ROAD;
    }

  return {
    seed,
    grid,
    buildings,
    ground,
    start: { x: TEE.x, y: ballRadius, z: TEE.z },
    goal: { x: goal.x, z: goal.z, radius: GOAL_RADIUS },
  };
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
