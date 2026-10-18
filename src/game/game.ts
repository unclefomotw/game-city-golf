// Round/stroke state machine (PLAY-1, PLAY-4 ~ PLAY-6) and the destruction-score wallet (DES-7, CAM-4). Pure logic.

import { Vector3 } from 'three';
import type { Config } from '../config';
import { type BallState, launch, type ShotInput, type SimEvent, step, type World } from '../physics/ballSim';
import type { Level } from '../world/levelGen';
import { materialLookup } from '../world/materials';
import { scoreForDestruction } from './scoring';

export type Phase = 'aiming' | 'flying' | 'finished';

export class Game {
  phase: Phase = 'aiming';
  strokes = 0;
  /** DES-7/CAM-4: earned by destruction, spent on free camera; never negative. */
  destructionScore = 0;
  /** CAM-4: how many times the player has entered free camera this round. */
  soulUses = 0;
  ball: BallState;
  /** Where the current/last stroke was played from (PLAY-5). */
  private lastShotPos: Vector3;
  private accumulator = 0;
  private readonly world: World;

  constructor(
    readonly level: Level,
    private readonly cfg: Config,
  ) {
    this.world = { solids: level.grid, materialOf: materialLookup(level.buildings) };
    const s = level.start;
    this.lastShotPos = new Vector3(s.x, s.y, s.z);
    this.ball = this.restingBall(this.lastShotPos);
  }

  private restingBall(pos: Vector3): BallState {
    return { pos: pos.clone(), vel: new Vector3(), spin: new Vector3(), time: 0, stillTime: 0, stopped: true };
  }

  fire(shot: ShotInput): void {
    if (this.phase !== 'aiming') return;
    this.strokes++;
    this.lastShotPos = this.ball.pos.clone();
    this.ball = launch(this.lastShotPos, shot, this.cfg);
    this.phase = 'flying';
    this.accumulator = 0;
  }

  /** PLAY-5/PLAY-6: +1 stroke, ball back to the last shot position; destruction stays. */
  penalty(): void {
    if (this.phase === 'finished') return;
    this.strokes++;
    this.ball = this.restingBall(this.lastShotPos);
    this.phase = 'aiming';
  }

  /** CAM-4: the first use is free, then 50, 100, 150, ... */
  get soulCost(): number {
    return this.soulUses * this.cfg.soul.costPerUse;
  }

  canAffordSoul(): boolean {
    return this.destructionScore >= this.soulCost;
  }

  /** CAM-4: pays for one free-camera use; returns false (and charges nothing) if the score is short. */
  spendSoul(): boolean {
    if (!this.canAffordSoul()) return false;
    this.destructionScore -= this.soulCost;
    this.soulUses++;
    return true;
  }

  /** Advances the simulation by real elapsed time using fixed steps. */
  update(elapsed: number): SimEvent[] {
    const events: SimEvent[] = [];
    if (this.phase !== 'flying') return events;
    const dt = this.cfg.physics.dt;
    this.accumulator += Math.min(elapsed, 0.1);
    while (this.accumulator >= dt && !this.ball.stopped) {
      step(this.ball, this.world, this.cfg, events);
      this.accumulator -= dt;
    }
    for (const e of events) if (e.type === 'destroy') this.destructionScore += scoreForDestruction(e);
    if (this.ball.stopped) this.phase = this.isInGoal() ? 'finished' : 'aiming';
    return events;
  }

  /** PLAY-4: the ball must come to rest inside the goal region. */
  isInGoal(): boolean {
    const { goal } = this.level;
    const p = this.ball.pos;
    return this.ball.stopped && p.y < 1 && Math.hypot(p.x - goal.x, p.z - goal.z) <= goal.radius;
  }
}
