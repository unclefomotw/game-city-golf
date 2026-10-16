import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { createRng } from '../src/core/rng';
import { Game } from '../src/game/game';
import { launch, previewPath, step, type ShotInput } from '../src/physics/ballSim';
import { generateLevel, isSolvable } from '../src/world/levelGen';
import { PreviewOverlay, VoxelGrid } from '../src/world/voxelGrid';

const flat = (shot: Partial<ShotInput> = {}): ShotInput => ({
  azimuth: 0,
  elevation: (30 * Math.PI) / 180,
  power: 0.6,
  sideSpin: 0,
  topSpin: 0,
  ...shot,
});

/** Simulates a shot on an empty field until it stops. */
function simulate(shot: ShotInput, grid = new VoxelGrid(200, 60, 200), start = new Vector3(100, 0.3, 190)) {
  const s = launch(start, shot, config);
  let maxHeight = 0;
  while (!s.stopped) {
    step(s, { solids: grid }, config);
    maxHeight = Math.max(maxHeight, s.pos.y);
  }
  return { end: s.pos, maxHeight, time: s.time, grid };
}

describe('rng (LVL-2)', () => {
  it('same seed gives the same sequence', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
});

describe('level generation', () => {
  it('LVL-2: same seed regenerates the same map', () => {
    const a = generateLevel(1234);
    const b = generateLevel(1234);
    expect(Array.from(a.grid.cells)).toEqual(Array.from(b.grid.cells));
    expect(a.goal).toEqual(b.goal);
    expect(a.start).toEqual(b.start);
  });

  it('LVL-3: generated levels are solvable, with tee and goal on open ground', () => {
    for (let seed = 0; seed < 40; seed++) {
      const level = generateLevel(seed);
      expect(isSolvable(level)).toBe(true);
      expect(level.grid.countSolid()).toBeGreaterThan(1000);
      const { goal, start } = level;
      expect(Math.hypot(goal.x - start.x, goal.z - start.z)).toBeGreaterThan(30);
    }
  });
});

describe('ball physics', () => {
  it('PLAY-3: the same shot always ends in the same place', () => {
    const a = simulate(flat({ sideSpin: 0.5, topSpin: -0.3 }));
    const b = simulate(flat({ sideSpin: 0.5, topSpin: -0.3 }));
    expect(a.end.toArray()).toEqual(b.end.toArray());
  });

  it('flies forward (-Z at azimuth 0), comes down, and stops', () => {
    const r = simulate(flat());
    expect(r.end.z).toBeLessThan(190 - 20);
    expect(Math.abs(r.end.x - 100)).toBeLessThan(0.01);
    expect(r.maxHeight).toBeGreaterThan(3);
    expect(r.end.y).toBeCloseTo(config.physics.ballRadius, 1);
    expect(r.time).toBeLessThan(config.physics.maxShotTime);
  });

  it('SHOT-3: positive side spin curves right (+X), negative curves left', () => {
    expect(simulate(flat({ sideSpin: 1 })).end.x).toBeGreaterThan(101);
    expect(simulate(flat({ sideSpin: -1 })).end.x).toBeLessThan(99);
  });

  it('SHOT-3: backspin flies higher than topspin', () => {
    expect(simulate(flat({ topSpin: -1 })).maxHeight).toBeGreaterThan(simulate(flat({ topSpin: 1 })).maxHeight);
  });

  it('SHOT-3: on landing, topspin runs on and backspin brakes', () => {
    const rollout = (topSpin: number) => {
      const grid = new VoxelGrid(200, 60, 200);
      const s = launch(new Vector3(100, 0.3, 190), flat({ topSpin }), config);
      let landZ: number | null = null;
      while (!s.stopped) {
        step(s, { solids: grid }, config);
        if (landZ === null && s.time > 0.1 && s.pos.y < config.physics.ballRadius + 0.01) landZ = s.pos.z;
      }
      return landZ! - s.pos.z;
    };
    expect(rollout(1)).toBeGreaterThan(rollout(0));
    expect(rollout(-1)).toBeLessThan(rollout(0));
  });

  it('more power goes farther', () => {
    expect(simulate(flat({ power: 0.9 })).end.z).toBeLessThan(simulate(flat({ power: 0.4 })).end.z);
  });

  it('FLD-1: the ball never leaves the field box', () => {
    const grid = new VoxelGrid(30, 20, 30);
    const s = launch(new Vector3(15, 0.3, 15), flat({ power: 1, elevation: 1.2, sideSpin: 1 }), config);
    for (let i = 0; i < 3000 && !s.stopped; i++) {
      step(s, { solids: grid }, config);
      expect(s.pos.x).toBeGreaterThanOrEqual(0);
      expect(s.pos.x).toBeLessThanOrEqual(30);
      expect(s.pos.z).toBeGreaterThanOrEqual(0);
      expect(s.pos.z).toBeLessThanOrEqual(30);
      expect(s.pos.y).toBeGreaterThanOrEqual(0);
      expect(s.pos.y).toBeLessThanOrEqual(20);
    }
  });
});

describe('destruction', () => {
  /** A wall of cells across the ball's path at z = 170..172. */
  function wallGrid() {
    const grid = new VoxelGrid(200, 60, 200);
    for (let x = 80; x < 120; x++) for (let y = 0; y < 20; y++) for (let z = 170; z < 172; z++) grid.set(x, y, z, 1);
    return grid;
  }

  it('DES-2: a hard hit removes cells and reports them', () => {
    const grid = wallGrid();
    const before = grid.countSolid();
    const events: unknown[] = [];
    const s = launch(new Vector3(100, 2, 185), flat({ elevation: 0.05, power: 1 }), config);
    for (let i = 0; i < 600 && !s.stopped; i++) step(s, { solids: grid }, config, events as never);
    expect(grid.countSolid()).toBeLessThan(before);
    expect(events.some((e) => (e as { type: string }).type === 'destroy')).toBe(true);
  });

  it('DES-4: a strong shot punches through a thin wall', () => {
    const r = simulate(flat({ elevation: 0.05, power: 1 }), wallGrid(), new Vector3(100, 2, 185));
    expect(r.end.z).toBeLessThan(170);
  });

  it('a gentle shot bounces off without damage', () => {
    const grid = wallGrid();
    const before = grid.countSolid();
    const r = simulate(flat({ elevation: 0.05, power: 0.08 }), grid, new Vector3(100, 1, 175));
    expect(grid.countSolid()).toBe(before);
    expect(r.end.z).toBeGreaterThan(172);
  });

  it('SHOT-5: preview matches the real shot and does not modify the grid', () => {
    const grid = wallGrid();
    const before = grid.countSolid();
    const start = new Vector3(100, 2, 185);
    const shot = flat({ elevation: 0.05, power: 1 });
    const preview = previewPath(start, shot, new PreviewOverlay(grid), config, 1);
    expect(grid.countSolid()).toBe(before);
    const s = launch(start, shot, config);
    for (let i = 1; i < preview.length; i++) {
      step(s, { solids: grid }, config);
      expect(s.pos.distanceTo(preview[i])).toBeLessThan(1e-9);
    }
  });
});

describe('game flow', () => {
  it('PLAY-5/PLAY-6: penalty adds a stroke and returns the ball, keeping destruction', () => {
    const game = new Game(generateLevel(7), config);
    const start = game.ball.pos.clone();
    game.fire(flat({ power: 0.5 }));
    for (let i = 0; i < 60; i++) game.update(1 / 60);
    const solidAfterShot = game.level.grid.countSolid();
    game.penalty();
    expect(game.strokes).toBe(2);
    expect(game.ball.pos.toArray()).toEqual(start.toArray());
    expect(game.phase).toBe('aiming');
    expect(game.level.grid.countSolid()).toBe(solidAfterShot);
  });

  it('PLAY-4: finishing requires resting inside the goal', () => {
    const level = generateLevel(7);
    const game = new Game(level, config);
    // Drop the ball onto the goal centre.
    game.fire({ azimuth: 0, elevation: -Math.PI / 2, power: 0, sideSpin: 0, topSpin: 0 });
    game.ball.pos.set(level.goal.x, 3, level.goal.z);
    for (let i = 0; i < 600 && game.phase === 'flying'; i++) game.update(1 / 60);
    expect(game.phase).toBe('finished');
  });
});
