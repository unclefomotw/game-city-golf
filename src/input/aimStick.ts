// Rate-controlled aiming with the direction joystick (SHOT-1, SHOT-2, ADR-013).
// Deflection sets how fast the angles turn, not the angles themselves:
// releasing the stick stops turning and the aim stays where it is.
// Pure logic, no DOM, so it can be unit tested.

const DEG = Math.PI / 180;

export type AimStickConfig = {
  /** Horizontal turn rate at full deflection, deg/s. */
  azimuthRateDeg: number;
  /** Elevation change rate at full deflection, deg/s. */
  elevationRateDeg: number;
  /** Deflection (0..1) below which the stick does nothing. */
  stickDeadZone: number;
  /** Response curve exponent; > 1 gives finer control near the centre. */
  stickExponent: number;
  minElevationDeg: number;
  maxElevationDeg: number;
};

/** Maps one stick axis (-1..1) to a signed rate in -1..1 with a dead zone and a response curve. */
export function stickResponse(deflection: number, deadZone: number, exponent: number): number {
  const mag = Math.min(1, Math.abs(deflection));
  if (mag <= deadZone) return 0;
  const t = (mag - deadZone) / (1 - deadZone);
  return Math.sign(deflection) * t ** exponent;
}

/**
 * Advances the aim by one frame.
 * `right` > 0 turns the shot clockwise seen from above (azimuth grows, i.e. to the right).
 * `up` > 0 raises the elevation (the stick is pushed away from the player, "aim higher").
 */
export function stepAim(
  aim: { azimuth: number; elevation: number },
  stick: { right: number; up: number },
  dt: number,
  cfg: AimStickConfig,
): void {
  const r = (v: number) => stickResponse(v, cfg.stickDeadZone, cfg.stickExponent);
  aim.azimuth += r(stick.right) * cfg.azimuthRateDeg * DEG * dt;
  aim.elevation = clampElevation(aim.elevation + r(stick.up) * cfg.elevationRateDeg * DEG * dt, cfg);
}

export function clampElevation(elevation: number, cfg: Pick<AimStickConfig, 'minElevationDeg' | 'maxElevationDeg'>) {
  return Math.min(cfg.maxElevationDeg * DEG, Math.max(cfg.minElevationDeg * DEG, elevation));
}
