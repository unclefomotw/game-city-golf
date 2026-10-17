// Building materials (VIS-3, DES-8, ADR-019). Pure data: no rendering.
// Each building has one material; physics, scoring and rendering look it up per cell.

/** Ordered from most fragile to hardest. */
export const MATERIALS = ['glass', 'wood', 'brick', 'stone', 'metal'] as const;
export type MaterialKind = (typeof MATERIALS)[number];

/** Used for cells whose building is unknown (e.g. hand-built test grids): the pre-material feel. */
export const DEFAULT_MATERIAL: MaterialKind = 'brick';

export const MATERIAL_LABELS: Record<MaterialKind, string> = {
  glass: '玻璃',
  wood: '木頭',
  brick: '磚頭',
  stone: '石頭',
  metal: '鐵',
};

/** Maps a grid cell value (building id + 1) to its material. */
export type MaterialOf = (cell: number) => MaterialKind;

export function materialLookup(buildings: readonly { material: MaterialKind }[]): MaterialOf {
  return (cell) => buildings[cell - 1]?.material ?? DEFAULT_MATERIAL;
}
