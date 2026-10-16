// DES-7: destruction score. POC rule: one point per destroyed cell.
// Kept as a standalone function so the scoring rule can be swapped after playtests.

import type { SimEvent } from '../physics/ballSim';

export function scoreForDestruction(event: Extract<SimEvent, { type: 'destroy' }>): number {
  return event.cells.length;
}
