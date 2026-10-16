// Every tunable "feel" parameter lives here (AGENTS.md rule 8, ADR-006).
// The ?debug tuning panel edits this object live.

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
    /** Restitution (bounciness) per surface. */
    restitution: { ground: 0.45, building: 0.35, boundary: 0.6 },
    /** Fraction of tangential speed kept on each bounce. */
    bounceFriction: { ground: 0.82, building: 0.7, boundary: 0.85 },
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
    /** Impact speed below which buildings are not damaged. */
    minSpeed: 5,
    /** Dig radius (in cells) per unit of impact speed. */
    radiusPerSpeed: 0.075,
    maxRadius: 3.2,
    /** Speed kept per destroyed cell when the ball punches through. */
    speedKeptPerCell: 0.985,
  },
  preview: {
    /** SHOT-5: only a short stretch of the trajectory is previewed. */
    seconds: 0.6,
  },
  camera: {
    fov: 55,
    orbitDistance: 14,
    minDistance: 3,
    maxDistance: 80,
    freeSpeed: 14,
    freeFastMultiplier: 2.5,
    lookSensitivity: 0.005,
  },
  debris: {
    maxParticles: 700,
    lifetime: 1.4,
    gravity: 22,
    speed: 9,
  },
  aim: {
    /** Screen drag (fraction of view size) that equals full power. */
    fullPowerDrag: 0.4,
    /** Pointer-down within this fraction of view size from the ball starts aiming. */
    grabRadius: 0.12,
    minElevationDeg: -45,
    maxElevationDeg: 89,
    defaultElevationDeg: 30,
  },
};

export type Config = typeof config;
export type SurfaceKind = keyof Config['physics']['restitution'];
