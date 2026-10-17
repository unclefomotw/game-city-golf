// DES-7: destruction score. Each destroyed cell scores by its material:
// the harder to break, the more it is worth (ADR-019). Fixed weights for now,
// not derived from the physics parameters; kept standalone so the rule can be swapped after playtests.

import type { SimEvent } from '../physics/ballSim';
import type { MaterialKind } from '../world/materials';

export const MATERIAL_SCORE: Record<MaterialKind, number> = { glass: 1, wood: 2, brick: 3, stone: 5, metal: 8 };

export function scoreForDestruction(event: Extract<SimEvent, { type: 'destroy' }>): number {
  let score = 0;
  for (const cell of event.cells) score += MATERIAL_SCORE[cell.material];
  return score;
}
