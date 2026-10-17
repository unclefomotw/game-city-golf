// Simplified, deterministic ball physics (ADR-002, ADR-006).
// Pure logic: no rendering, no DOM. The aim preview runs this same code
// (SHOT-5), so the preview always matches the real shot.

import { Vector3 } from 'three';
import type { Config, SurfaceKind } from '../config';
import { DEFAULT_MATERIAL, type MaterialOf } from '../world/materials';
import type { CellCoord, RemovedCell, SolidQuery } from '../world/voxelGrid';

const UP = new Vector3(0, 1, 0);

/** What the player chose for one stroke (PLAY-2, SHOT-1, SHOT-3). */
export type ShotInput = {
  /** Horizontal direction in radians; 0 = -Z, positive turns toward +X. */
  azimuth: number;
  /** Radians above the horizon (negative = downward). */
  elevation: number;
  /** 0..1 */
  power: number;
  /** -1..1, positive curves the ball to the right. */
  sideSpin: number;
  /** -1..1, positive = topspin (dives, runs on landing), negative = backspin. */
  topSpin: number;
};

export type BallState = {
  pos: Vector3;
  vel: Vector3;
  spin: Vector3;
  time: number;
  /** How long the ball has been slower than stopSpeed while on the ground. */
  stillTime: number;
  stopped: boolean;
};

export type SimEvent =
  | { type: 'destroy'; cells: RemovedCell[]; impact: Vector3; speed: number }
  | { type: 'bounce'; surface: SurfaceKind; speed: number };

export type World = {
  solids: SolidQuery;
  /** DES-8: material of each building cell; every cell counts as DEFAULT_MATERIAL when omitted. */
  materialOf?: MaterialOf;
};

const defaultMaterialOf: MaterialOf = () => DEFAULT_MATERIAL;

export function horizontalDir(azimuth: number): Vector3 {
  return new Vector3(Math.sin(azimuth), 0, -Math.cos(azimuth));
}

export function launchDirection(azimuth: number, elevation: number): Vector3 {
  const c = Math.cos(elevation);
  return new Vector3(c * Math.sin(azimuth), Math.sin(elevation), -c * Math.cos(azimuth));
}

/** Turns a shot into the ball's initial state. */
export function launch(start: Vector3, shot: ShotInput, cfg: Config): BallState {
  const p = cfg.physics;
  const vel = launchDirection(shot.azimuth, shot.elevation).multiplyScalar(shot.power * p.maxLaunchSpeed);
  // Side spin spins around the vertical axis, top/back spin around the
  // horizontal axis perpendicular to the shot. Signs are chosen so that
  // spin x velocity curves right for sideSpin > 0 and lifts for backspin.
  const right = horizontalDir(shot.azimuth).cross(UP).normalize();
  const spin = new Vector3()
    .addScaledVector(UP, -shot.sideSpin * p.maxSpin)
    .addScaledVector(right, -shot.topSpin * p.maxSpin);
  return { pos: start.clone(), vel, spin, time: 0, stillTime: 0, stopped: false };
}

type Contact = { normal: Vector3; depth: number; surface: SurfaceKind };
/** A building contact also names the most deeply touched cell, whose material it uses. */
type BuildingContact = Contact & { cell: CellCoord };

const tmp = new Vector3();
const tmp2 = new Vector3();

/** Contacts with the ground plane and the indestructible field box (FLD-1). */
function boundaryContacts(pos: Vector3, r: number, solids: SolidQuery, out: Contact[]): void {
  if (pos.y < r) out.push({ normal: new Vector3(0, 1, 0), depth: r - pos.y, surface: 'ground' });
  if (pos.y > solids.sizeY - r)
    out.push({ normal: new Vector3(0, -1, 0), depth: pos.y - (solids.sizeY - r), surface: 'boundary' });
  if (pos.x < r) out.push({ normal: new Vector3(1, 0, 0), depth: r - pos.x, surface: 'boundary' });
  if (pos.x > solids.sizeX - r)
    out.push({ normal: new Vector3(-1, 0, 0), depth: pos.x - (solids.sizeX - r), surface: 'boundary' });
  if (pos.z < r) out.push({ normal: new Vector3(0, 0, 1), depth: r - pos.z, surface: 'boundary' });
  if (pos.z > solids.sizeZ - r)
    out.push({ normal: new Vector3(0, 0, -1), depth: pos.z - (solids.sizeZ - r), surface: 'boundary' });
}

/** Merges all overlapping building cells into one contact (or null). */
function buildingContact(pos: Vector3, r: number, world: World): BuildingContact | null {
  const { solids } = world;
  const normal = new Vector3();
  let maxDepth = 0;
  const deepest = { x: 0, y: 0, z: 0 };
  const x0 = Math.floor(pos.x - r),
    x1 = Math.floor(pos.x + r);
  const y0 = Math.floor(pos.y - r),
    y1 = Math.floor(pos.y + r);
  const z0 = Math.floor(pos.z - r),
    z1 = Math.floor(pos.z + r);
  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        if (!solids.isSolid(x, y, z)) continue;
        // Closest point on the cell box to the ball center.
        tmp.set(
          Math.max(x, Math.min(pos.x, x + 1)),
          Math.max(y, Math.min(pos.y, y + 1)),
          Math.max(z, Math.min(pos.z, z + 1)),
        );
        tmp2.subVectors(pos, tmp);
        const dist = tmp2.length();
        if (dist >= r) continue;
        let n: Vector3;
        let depth: number;
        if (dist > 1e-6) {
          n = tmp2.divideScalar(dist);
          depth = r - dist;
        } else {
          // Center is inside the cell: push out along the shallowest axis.
          const options: [number, Vector3][] = [
            [pos.x - x, new Vector3(-1, 0, 0)],
            [x + 1 - pos.x, new Vector3(1, 0, 0)],
            [pos.y - y, new Vector3(0, -1, 0)],
            [y + 1 - pos.y, new Vector3(0, 1, 0)],
            [pos.z - z, new Vector3(0, 0, -1)],
            [z + 1 - pos.z, new Vector3(0, 0, 1)],
          ];
          options.sort((a, b) => a[0] - b[0]);
          n = options[0][1];
          depth = options[0][0] + r;
        }
        normal.addScaledVector(n, depth);
        if (depth > maxDepth) {
          maxDepth = depth;
          Object.assign(deepest, { x, y, z });
        }
      }
  if (maxDepth === 0 || normal.lengthSq() < 1e-12) return null;
  const materialOf = world.materialOf ?? defaultMaterialOf;
  const surface = materialOf(solids.get(deepest.x, deepest.y, deepest.z));
  return { normal: normal.normalize(), depth: maxDepth, surface, cell: deepest };
}

/**
 * DES-2/DES-3/DES-8: digs a roughly spherical hole around the impact point.
 * Each cell's material sets its own damage threshold and hole radius, so one
 * hit can shatter glass yet stop at a metal wall. The touched cell always
 * breaks once the impact beats its material's threshold.
 */
function dig(world: World, cfg: Config, impact: Vector3, speed: number, touched: CellCoord): RemovedCell[] {
  const { solids } = world;
  const materialOf = world.materialOf ?? defaultMaterialOf;
  const d = cfg.destruction;
  const removed: RemovedCell[] = [];
  const reach = Math.ceil(d.maxRadius * Math.max(...Object.values(cfg.materials).map((m) => m.radiusScale)));
  const cx = Math.floor(impact.x),
    cy = Math.floor(impact.y),
    cz = Math.floor(impact.z);
  for (let y = cy - reach; y <= cy + reach; y++)
    for (let z = cz - reach; z <= cz + reach; z++)
      for (let x = cx - reach; x <= cx + reach; x++) {
        const id = solids.get(x, y, z);
        if (!id) continue;
        const material = materialOf(id);
        const m = cfg.materials[material];
        if (speed <= m.minSpeed) continue;
        const radius = Math.min(d.maxRadius, speed * d.radiusPerSpeed) * m.radiusScale;
        const isTouched = x === touched.x && y === touched.y && z === touched.z;
        if (!isTouched && Math.hypot(x + 0.5 - impact.x, y + 0.5 - impact.y, z + 0.5 - impact.z) > radius) continue;
        solids.remove(x, y, z);
        removed.push({ x, y, z, id, material });
      }
  return removed;
}

function surfaceParams(surface: SurfaceKind, cfg: Config): { restitution: number; bounceFriction: number } {
  if (surface === 'ground' || surface === 'boundary')
    return { restitution: cfg.physics.restitution[surface], bounceFriction: cfg.physics.bounceFriction[surface] };
  return cfg.materials[surface];
}

function resolveContact(s: BallState, c: Contact, cfg: Config, h: number, events?: SimEvent[]): boolean {
  const p = cfg.physics;
  s.pos.addScaledVector(c.normal, c.depth);
  const vn = s.vel.dot(c.normal);
  if (vn >= 0) return false;
  const vN = c.normal.clone().multiplyScalar(vn);
  const vT = s.vel.clone().sub(vN);
  const spinTangent = s.spin.clone().cross(c.normal); // topspin -> forward, backspin -> backward
  if (-vn > p.rollThreshold) {
    // Bounce.
    const { restitution, bounceFriction } = surfaceParams(c.surface, cfg);
    vN.multiplyScalar(-restitution);
    vT.multiplyScalar(bounceFriction).addScaledVector(spinTangent, p.contactSpinK);
    s.spin.multiplyScalar(p.contactSpinRetain);
    events?.push({ type: 'bounce', surface: c.surface, speed: -vn });
    s.vel.addVectors(vN, vT);
    return false;
  }
  // Resting / rolling contact: kill the normal component and let spin bleed into rolling.
  const k = 1 - Math.exp(-5 * h);
  vT.addScaledVector(spinTangent, p.contactSpinK * k);
  s.spin.multiplyScalar(1 - k);
  s.vel.copy(vT);
  return c.normal.y > 0.5;
}

/** Below the weakest material's threshold nothing can break, so digging is skipped (e.g. while rolling). */
const minDamageSpeed = (cfg: Config) => Math.min(...Object.values(cfg.materials).map((m) => m.minSpeed));

/** Advances the ball by one fixed timestep. */
export function step(s: BallState, world: World, cfg: Config, events?: SimEvent[]): void {
  if (s.stopped) return;
  const p = cfg.physics;
  const r = p.ballRadius;
  // Sub-step so the ball never moves more than half its radius per iteration.
  const n = Math.max(1, Math.ceil((s.vel.length() * p.dt) / (r * 0.5)));
  const h = p.dt / n;
  let grounded = false;

  for (let i = 0; i < n; i++) {
    // Forces (SHOT-4).
    const acc = new Vector3(0, -p.gravity, 0);
    acc.addScaledVector(s.vel, -p.airDrag);
    if (!grounded) acc.add(tmp.crossVectors(s.spin, s.vel).multiplyScalar(p.magnusK));
    s.vel.addScaledVector(acc, h);
    s.pos.addScaledVector(s.vel, h);
    s.spin.multiplyScalar(Math.exp(-p.spinDecay * h));

    grounded = false;
    const contacts: Contact[] = [];
    boundaryContacts(s.pos, r, world.solids, contacts);
    let bc = buildingContact(s.pos, r, world);
    if (bc) {
      const impactSpeed = -s.vel.dot(bc.normal);
      if (impactSpeed > minDamageSpeed(cfg)) {
        const impact = s.pos.clone().addScaledVector(bc.normal, -r);
        const cells = dig(world, cfg, impact, impactSpeed, bc.cell);
        if (cells.length) {
          events?.push({ type: 'destroy', cells, impact, speed: impactSpeed });
          bc = buildingContact(s.pos, r, world);
          // Punched through: the ball keeps going, slowed by what it smashed.
          if (!bc) for (const c of cells) s.vel.multiplyScalar(cfg.materials[c.material].speedKeptPerCell);
        }
      }
      if (bc) contacts.push(bc);
    }
    for (const c of contacts) if (resolveContact(s, c, cfg, h, events)) grounded = true;

    if (grounded) {
      // Rolling friction on horizontal-ish surfaces.
      const speed = s.vel.length();
      const drop = p.rollingFriction * h;
      s.vel.multiplyScalar(speed > drop ? (speed - drop) / speed : 0);
    }
  }

  s.time += p.dt;
  if (grounded && s.vel.length() < p.stopSpeed) {
    s.stillTime += p.dt;
    if (s.stillTime >= p.stopTime) s.stopped = true;
  } else {
    s.stillTime = 0;
  }
  if (s.time >= p.maxShotTime) s.stopped = true;
  if (s.stopped) s.vel.set(0, 0, 0);
}

/**
 * SHOT-5: positions over the first `seconds` of a shot, simulated on a scratch overlay.
 * The path ends at the first impact (bounce or destruction), so the preview
 * never reveals how the ball will rebound.
 */
export function previewPath(start: Vector3, shot: ShotInput, world: World, cfg: Config, seconds: number): Vector3[] {
  const s = launch(start, shot, cfg);
  const points = [s.pos.clone()];
  const steps = Math.round(seconds / cfg.physics.dt);
  const events: SimEvent[] = [];
  for (let i = 0; i < steps && !s.stopped; i++) {
    step(s, world, cfg, events);
    if (events.length) break;
    points.push(s.pos.clone());
  }
  return points;
}
