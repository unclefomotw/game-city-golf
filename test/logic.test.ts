import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { createRng } from '../src/core/rng';
import { Game } from '../src/game/game';
import { clampElevation, stepAim, stickResponse } from '../src/input/aimStick';
import { inputKindFromPointer } from '../src/input/inputKind';
import { launch, previewPath, type ShotInput, step } from '../src/physics/ballSim';
import { CameraRig, orbitBallScreenY } from '../src/render/cameraRig';
import {
  COVERAGE,
  DEFAULT_LEVEL_OPTIONS,
  generateLevel,
  isSolvable,
  MAX_OPEN_RUN,
  TEE,
  TEE_CLEARANCE,
} from '../src/world/levelGen';
import { findTestScene, TEST_SCENES } from '../src/world/testScenes';
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

  it('LVL-1: tee is in the fixed corner with no building voxel within the clearance', () => {
    for (let seed = 0; seed < 40; seed++) {
      const { grid, start } = generateLevel(seed);
      expect([start.x, start.z]).toEqual([TEE.x, TEE.z]);
      for (let x = 0; x < grid.sizeX; x++)
        for (let z = 0; z < grid.sizeZ; z++) {
          // Gap from the tee center to the nearest face of column (x, z), per axis.
          const gap = Math.max(x - start.x, start.x - (x + 1), z - start.z, start.z - (z + 1));
          if (gap < TEE_CLEARANCE) for (let y = 0; y < grid.sizeY; y++) expect(grid.isSolid(x, y, z)).toBe(false);
        }
    }
  });

  it('LVL-1: no straight open line runs from one boundary to the other', () => {
    expect(MAX_OPEN_RUN).toBeLessThan(DEFAULT_LEVEL_OPTIONS.sizeX);
    for (let seed = 0; seed < 40; seed++) {
      const { grid } = generateLevel(seed);
      for (let a = 0; a < grid.sizeX; a++) {
        let row = 0;
        let col = 0;
        for (let b = 0; b < grid.sizeX; b++) {
          row = grid.isSolid(b, 0, a) ? 0 : row + 1;
          col = grid.isSolid(a, 0, b) ? 0 : col + 1;
          expect(Math.max(row, col)).toBeLessThanOrEqual(MAX_OPEN_RUN);
        }
      }
    }
  });

  it('LVL-1: open ground stays plentiful', () => {
    for (let seed = 0; seed < 40; seed++) {
      const { grid } = generateLevel(seed);
      let solid = 0;
      for (let x = 0; x < grid.sizeX; x++) for (let z = 0; z < grid.sizeZ; z++) if (grid.isSolid(x, 0, z)) solid++;
      const share = solid / (grid.sizeX * grid.sizeZ);
      expect(share).toBeGreaterThanOrEqual(COVERAGE);
      expect(share).toBeLessThan(COVERAGE + 0.2);
    }
  });

  it('LVL-1: buildings reach the field boundary instead of leaving an empty border', () => {
    let touching = 0;
    for (let seed = 0; seed < 40; seed++) {
      const { grid } = generateLevel(seed);
      const last = grid.sizeX - 1;
      for (let i = 0; i < grid.sizeX; i++)
        if (grid.isSolid(last, 0, i) || grid.isSolid(i, 0, last) || grid.isSolid(0, 0, i) || grid.isSolid(i, 0, 0)) {
          touching++;
          break;
        }
    }
    expect(touching).toBe(40);
  });
});

describe('test scenes (ADR-010)', () => {
  it('every scene is solvable with tee and goal inside the field', () => {
    for (const scene of TEST_SCENES) {
      const level = scene.build(DEFAULT_LEVEL_OPTIONS);
      expect(isSolvable(level)).toBe(true);
      expect(findTestScene(scene.id)).toBe(scene);
    }
  });

  it('the empty scene has no buildings', () => {
    const level = findTestScene('empty')!.build(DEFAULT_LEVEL_OPTIONS);
    expect(level.grid.countSolid()).toBe(0);
    expect(level.buildings).toEqual([]);
  });

  it('unknown ids find nothing', () => {
    expect(findTestScene('nope')).toBeNull();
    expect(findTestScene(null)).toBeNull();
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

describe('free camera (CAM-1, ADR-011)', () => {
  const still = { forward: 0, right: 0, up: 0, fast: false };
  function freeRig(lookDownPx: number) {
    const cam = new PerspectiveCamera();
    cam.position.set(50, 20, 50);
    cam.lookAt(50, 20, 0);
    const rig = new CameraRig(cam, config, new Vector3(100, 40, 100), () => false);
    rig.enterFree();
    rig.rotate(0, lookDownPx);
    rig.update(0, new Vector3(), still);
    return { cam, rig };
  }

  it('moving forward follows the view pitch', () => {
    const { cam, rig } = freeRig(300);
    rig.update(0.5, new Vector3(), { ...still, forward: 1 });
    expect(cam.position.y).toBeLessThan(20);
    expect(cam.position.z).toBeLessThan(50);
  });

  it('strafing and up/down keep the other axes', () => {
    const { cam, rig } = freeRig(300);
    rig.update(0.5, new Vector3(), { ...still, right: 1 });
    expect(cam.position.y).toBeCloseTo(20);
    rig.update(0.5, new Vector3(), { ...still, up: 1 });
    expect(cam.position.y).toBeGreaterThan(20);
    expect(cam.position.z).toBeCloseTo(50);
  });
});

describe('orbit camera framing (ADR-017)', () => {
  const still = { forward: 0, right: 0, up: 0, fast: false };
  function ballScreenY(pitchPx: number) {
    const cam = new PerspectiveCamera(config.camera.fov, 1, 0.1, 400);
    const rig = new CameraRig(cam, config, new Vector3(100, 40, 100), () => false);
    const ball = new Vector3(50, 0.3, 50);
    rig.lookAlong(ball, 0);
    rig.rotate(0, pitchPx);
    // Large dt so the smoothed target and pitch settle.
    for (let i = 0; i < 5; i++) rig.update(10, ball, still);
    cam.updateMatrixWorld();
    return ball.clone().project(cam).y;
  }

  it('puts the ball below center when looking level', () => {
    expect(ballScreenY(-70)).toBeCloseTo(-config.camera.levelBallScreenOffset, 2);
  });

  it('centers the ball when looking straight down', () => {
    expect(Math.abs(ballScreenY(1000))).toBeLessThan(0.05);
  });

  it('moves the ball toward center as the camera tilts down', () => {
    const level = config.camera.levelBallScreenOffset;
    expect(orbitBallScreenY(-0.2, level)).toBeCloseTo(-level);
    expect(orbitBallScreenY(0.3, level)).toBeLessThan(orbitBallScreenY(0.8, level));
    expect(orbitBallScreenY(Math.PI / 2, level)).toBeCloseTo(0);
  });
});

describe('input kind for hints (PLT-3, ADR-012)', () => {
  it('follows the pointer type of the last input', () => {
    expect(inputKindFromPointer('mouse', 'touch')).toBe('mouse');
    expect(inputKindFromPointer('touch', 'mouse')).toBe('touch');
    expect(inputKindFromPointer('pen', 'mouse')).toBe('touch');
  });

  it('keeps the current kind for unknown pointer types', () => {
    expect(inputKindFromPointer('', 'touch')).toBe('touch');
    expect(inputKindFromPointer('', 'mouse')).toBe('mouse');
  });
});

describe('direction joystick (SHOT-1, ADR-013)', () => {
  const DEG = Math.PI / 180;
  const cfg = {
    azimuthRateDeg: 90,
    elevationRateDeg: 60,
    stickDeadZone: 0.1,
    stickExponent: 2,
    minElevationDeg: -45,
    maxElevationDeg: 89,
  };
  const aim = (azimuthDeg = 0, elevationDeg = 30) => ({ azimuth: azimuthDeg * DEG, elevation: elevationDeg * DEG });

  it('ignores the dead zone and reaches full rate at full deflection', () => {
    expect(stickResponse(0.05, 0.1, 2)).toBe(0);
    expect(stickResponse(-0.1, 0.1, 2)).toBe(0);
    expect(stickResponse(1, 0.1, 2)).toBe(1);
    expect(stickResponse(-1, 0.1, 2)).toBe(-1);
    expect(stickResponse(1.5, 0.1, 2)).toBe(1);
  });

  it('pushing further turns faster, with finer control near the centre', () => {
    const half = stickResponse(0.55, 0.1, 2);
    expect(half).toBeGreaterThan(stickResponse(0.3, 0.1, 2));
    expect(half).toBeLessThan(stickResponse(0.8, 0.1, 2));
    // Exponent > 1: half way out turns slower than half speed.
    expect(half).toBeCloseTo(0.25);
    expect(stickResponse(0.55, 0.1, 1)).toBeCloseTo(0.5);
  });

  it('right turns the azimuth up (to the right), up raises the elevation', () => {
    const a = aim();
    stepAim(a, { right: 1, up: 1 }, 0.5, cfg);
    expect(a.azimuth / DEG).toBeCloseTo(45);
    expect(a.elevation / DEG).toBeCloseTo(60);
    stepAim(a, { right: -1, up: -1 }, 0.5, cfg);
    expect(a.azimuth / DEG).toBeCloseTo(0);
    expect(a.elevation / DEG).toBeCloseTo(30);
  });

  it('a centred stick keeps the aim where it is', () => {
    const a = aim(12, 34);
    stepAim(a, { right: 0, up: 0.05 }, 1, cfg);
    expect(a).toEqual(aim(12, 34));
  });

  it('elevation stays within its limits', () => {
    const a = aim(0, 80);
    stepAim(a, { right: 0, up: 1 }, 5, cfg);
    expect(a.elevation / DEG).toBeCloseTo(89);
    stepAim(a, { right: 0, up: -1 }, 10, cfg);
    expect(a.elevation / DEG).toBeCloseTo(-45);
    expect(clampElevation(0.2, cfg)).toBe(0.2);
  });
});
