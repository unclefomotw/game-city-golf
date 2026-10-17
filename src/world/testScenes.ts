// Predefined developer test scenes (ADR-010). Not part of the player game:
// main.ts only exposes them in dev builds, so players never get one.

import { type Building, GROUND_MARK, GROUND_PLAZA, GROUND_ROAD, type Level, type LevelOptions } from './levelGen';
import { MATERIALS } from './materials';
import { VoxelGrid } from './voxelGrid';

export type TestScene = {
  id: string;
  /** Shown in the scene picker. */
  label: string;
  build(opts: LevelOptions): Level;
};

/** Spacing of the distance rings painted around the tee. */
export const DISTANCE_RING_STEP = 10;

/** Empty field with distance rings: for judging aim UX, ball paths and power vs. distance. */
function buildEmpty(opts: LevelOptions): Level {
  const { sizeX, sizeY, sizeZ, ballRadius } = opts;
  const grid = new VoxelGrid(sizeX, sizeY, sizeZ);
  const ground = new Uint8Array(sizeX * sizeZ).fill(GROUND_ROAD);
  // Tee near one corner so the diagonal gives the longest runway.
  const start = { x: 4.5, y: ballRadius, z: 4.5 };
  const goal = { x: sizeX - 4.5, z: sizeZ - 4.5, radius: 3 };

  for (let z = 0; z < sizeZ; z++)
    for (let x = 0; x < sizeX; x++) {
      const d = Math.hypot(x + 0.5 - start.x, z + 0.5 - start.z);
      const nearest = Math.round(d / DISTANCE_RING_STEP) * DISTANCE_RING_STEP;
      if (nearest > 0 && Math.abs(d - nearest) < 0.5) ground[x + z * sizeX] = GROUND_MARK;
      if (Math.hypot(x + 0.5 - goal.x, z + 0.5 - goal.z) < goal.radius + 1) ground[x + z * sizeX] = GROUND_PLAZA;
    }

  return { seed: 0, grid, buildings: [], ground, start, goal };
}

/**
 * One wall per material in a row, glass to metal from left to right (DES-8, ADR-019):
 * for comparing bounce and breakage side by side. The tee faces the middle (brick) wall.
 */
function buildMaterials(opts: LevelOptions): Level {
  const { sizeX, sizeY, sizeZ, ballRadius } = opts;
  const grid = new VoxelGrid(sizeX, sizeY, sizeZ);
  const ground = new Uint8Array(sizeX * sizeZ).fill(GROUND_ROAD);
  const center = Math.floor(sizeX / 2);
  const start = { x: center + 0.5, y: ballRadius, z: 50.5 };
  const goal = { x: center + 0.5, z: 8.5, radius: 3 };
  const buildings: Building[] = MATERIALS.map((material, id) => ({ id, material }));
  const WIDTH = 8;
  const GAP = 4;
  const x0 = center - Math.floor((MATERIALS.length * (WIDTH + GAP) - GAP) / 2);
  buildings.forEach(({ id }) => {
    const left = x0 + id * (WIDTH + GAP);
    for (let x = left; x < left + WIDTH; x++)
      for (let y = 0; y < 12; y++) for (let z = 28; z < 30; z++) grid.set(x, y, z, id + 1);
  });
  for (let z = 0; z < sizeZ; z++)
    for (let x = 0; x < sizeX; x++)
      if (Math.hypot(x + 0.5 - goal.x, z + 0.5 - goal.z) < goal.radius + 1) ground[x + z * sizeX] = GROUND_PLAZA;
  return { seed: 0, grid, buildings, ground, start, goal };
}

export const TEST_SCENES: readonly TestScene[] = [
  { id: 'empty', label: '空地（測距離）', build: buildEmpty },
  { id: 'materials', label: '材質牆', build: buildMaterials },
];

export function findTestScene(id: string | null | undefined): TestScene | null {
  return TEST_SCENES.find((s) => s.id === id) ?? null;
}
