// Every tunable "feel" parameter lives here (AGENTS.md rule 8, ADR-006).
// The ?debug tuning panel edits this object live.

import type { MaterialKind } from './world/materials';

export const config = {
  physics: {
    /** Fixed simulation timestep in seconds (PLAY-3: deterministic). */
    dt: 1 / 120,
    gravity: 18,
    /** Linear air drag coefficient: a = -airDrag * v. */
    airDrag: 0.12,
    /** Magnus-like coefficient: a = magnusK * (spin x v). */
    magnusK: 0.06,
    /** Spin decay rate per second while airborne. */
    spinDecay: 0.3,
    /** Spin magnitude (rad/s-ish) at full spin input. */
    maxSpin: 6,
    ballRadius: 0.3,
    /** Launch speed at full power. */
    maxLaunchSpeed: 42,
    /** Restitution (bounciness) per non-building surface; buildings use `materials`. */
    restitution: { ground: 0.45, boundary: 0.6 },
    /** Fraction of tangential speed kept on each bounce. */
    bounceFriction: { ground: 0.82, boundary: 0.85 },
    /** How strongly spin converts into tangential speed on contact. */
    contactSpinK: 2,
    /** Fraction of spin kept after a contact. */
    contactSpinRetain: 0.5,
    /** Rolling deceleration while resting on a surface. */
    rollingFriction: 9,
    /** Normal speed below which a contact counts as rolling instead of bouncing. */
    rollThreshold: 2.0,
    stopSpeed: 0.35,
    /** The ball must stay below stopSpeed this long to count as stopped. */
    stopTime: 0.4,
    /** Hard cap on one shot's simulated time. */
    maxShotTime: 30,
  },
  destruction: {
    /** Dig radius (in cells) per unit of impact speed, capped at maxRadius, then times the material's radiusScale. */
    radiusPerSpeed: 0.075,
    maxRadius: 3.2,
  },
  /**
   * DES-8: bounciness and fragility per building material (ADR-019).
   * - restitution / bounceFriction: as in physics, for bounces off this material.
   * - minSpeed: impact speed below which this material is not damaged.
   * - radiusScale: multiplies the dig radius (after the maxRadius cap) for cells of this material.
   * - speedKeptPerCell: speed kept per destroyed cell of this material when punching through.
   */
  materials: {
    glass: { restitution: 0.15, bounceFriction: 0.75, minSpeed: 2, radiusScale: 1.6, speedKeptPerCell: 0.998 },
    wood: { restitution: 0.2, bounceFriction: 0.6, minSpeed: 3, radiusScale: 1.25, speedKeptPerCell: 0.99 },
    brick: { restitution: 0.35, bounceFriction: 0.7, minSpeed: 5, radiusScale: 1, speedKeptPerCell: 0.985 },
    stone: { restitution: 0.5, bounceFriction: 0.75, minSpeed: 12, radiusScale: 0.75, speedKeptPerCell: 0.97 },
    metal: { restitution: 0.7, bounceFriction: 0.85, minSpeed: 25, radiusScale: 0.5, speedKeptPerCell: 0.95 },
  },
  preview: {
    /** SHOT-5: only a short stretch of the trajectory is previewed. */
    seconds: 0.6,
    /** Opacity of the preview dot farthest from the camera (the nearest is opaque). */
    farOpacity: 0.2,
    /** Camera-distance spread that maps to the full near-to-far fade, at minimum. */
    depthFadeSpan: 6,
  },
  camera: {
    fov: 55,
    orbitDistance: 14,
    minDistance: 3,
    maxDistance: 80,
    freeSpeed: 14,
    freeFastMultiplier: 2.5,
    lookSensitivity: 0.005,
    /**
     * Orbit mode: how far below center the ball sits when the camera looks level,
     * as a fraction of the half view height. Fades to center at top-down (ADR-017).
     */
    levelBallScreenOffset: 0.45,
  },
  debris: {
    maxParticles: 700,
    lifetime: 1.4,
    gravity: 22,
    speed: 9,
  },
  aim: {
    // ADR-013: the direction joystick rate-controls the angles (SHOT-1).
    /** Horizontal turn rate at full stick deflection, deg/s. */
    azimuthRateDeg: 90,
    /** Elevation change rate at full stick deflection, deg/s. */
    elevationRateDeg: 60,
    /** Stick deflection (0..1) ignored around the centre. */
    stickDeadZone: 0.08,
    /** Response curve exponent: 1 = linear, larger = finer control near the centre. */
    stickExponent: 2,
    /** Deflection that an arrow key counts as (desktop). */
    keyboardDeflection: 0.6,
    minElevationDeg: -45,
    maxElevationDeg: 89,
    defaultElevationDeg: 30,
  },
};

export type Config = typeof config;
/** Ground and field boundary, or the material of the building that was hit. */
export type SurfaceKind = keyof Config['physics']['restitution'] | MaterialKind;
