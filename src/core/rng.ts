// Seeded PRNG so a map code always regenerates the same map (LVL-2).

export type Rng = {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Float in [min, max). */
  range(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
};

/** mulberry32: tiny, fast, good enough for level generation. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    range: (min, max) => min + next() * (max - min),
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (p) => next() < p,
  };
}

/** Map codes are shown to the player, so keep them short and readable. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

export function parseSeed(text: string | null | undefined): number | null {
  if (!text) return null;
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
