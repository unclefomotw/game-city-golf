// Predefined developer test scenes (ADR-010). Not part of the player game:
// main.ts only exposes them in dev builds, so players never get one.

import { GROUND_MARK, GROUND_PLAZA, GROUND_ROAD, type Level, type LevelOptions } from './levelGen';
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

export const TEST_SCENES: readonly TestScene[] = [{ id: 'empty', label: '空地（測距離）', build: buildEmpty }];

export function findTestScene(id: string | null | undefined): TestScene | null {
  return TEST_SCENES.find((s) => s.id === id) ?? null;
}
