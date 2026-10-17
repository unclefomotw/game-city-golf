// Procedural sound recipes (AUD-2, AUD-3, AUD-7, ADR-021). Pure data: each cue becomes a list of
// short layers (a pitched tone or filtered noise with a click-in / fade-out envelope).
// Rough and punchy on purpose, matching the blocky look; tweak the numbers here after playtests.

import type { MaterialKind } from '../world/materials';
import type { SoundCue } from './soundCues';

type Envelope = {
  /** 0..1 relative to the cue's volume. */
  gain: number;
  /** Seconds to fade out (exponential). */
  decay: number;
  /** Seconds after the cue starts. */
  delay?: number;
};

export type Layer =
  | ({ type: 'tone'; wave: OscillatorType; freq: number; endFreq?: number } & Envelope)
  | ({ type: 'noise'; filter: BiquadFilterType; freq: number; q?: number } & Envelope);

const tone = (
  wave: OscillatorType,
  freq: number,
  gain: number,
  decay: number,
  extra: { endFreq?: number; delay?: number } = {},
): Layer => ({ type: 'tone', wave, freq, gain, decay, ...extra });
const noise = (
  filter: BiquadFilterType,
  freq: number,
  gain: number,
  decay: number,
  extra: { q?: number; delay?: number } = {},
): Layer => ({ type: 'noise', filter, freq, gain, decay, ...extra });

/** Seconds from the cue's start until its last layer has faded. */
export const layersDuration = (layers: readonly Layer[]) => Math.max(...layers.map((l) => (l.delay ?? 0) + l.decay));

/** AUD-2: each material's knock when the ball bounces off it. */
const IMPACT: Record<MaterialKind, (p: number) => Layer[]> = {
  // High, glassy "tink".
  glass: (p) => [
    tone('sine', 2600 * p, 0.5, 0.35),
    tone('sine', 3900 * p, 0.3, 0.2),
    tone('sine', 5200 * p, 0.15, 0.12),
    noise('highpass', 5000, 0.2, 0.02),
  ],
  // Hollow "tok".
  wood: (p) => [
    tone('triangle', 320 * p, 0.7, 0.09, { endFreq: 260 * p }),
    noise('bandpass', 900 * p, 0.6, 0.05, { q: 4 }),
    tone('sine', 160 * p, 0.4, 0.07),
  ],
  // Dull "thock".
  brick: (p) => [noise('lowpass', 900 * p, 0.8, 0.07), tone('sine', 140 * p, 0.7, 0.1, { endFreq: 90 * p })],
  // Hard, bright "clack".
  stone: (p) => [
    noise('bandpass', 1800 * p, 0.7, 0.05, { q: 1.5 }),
    tone('sine', 200 * p, 0.5, 0.08, { endFreq: 150 * p }),
    tone('triangle', 900 * p, 0.15, 0.03),
  ],
  // Ringing "clang" with inharmonic partials.
  metal: (p) => [
    tone('sine', 520 * p, 0.4, 0.7),
    tone('sine', 1340 * p, 0.3, 0.5),
    tone('sine', 2210 * p, 0.2, 0.35),
    tone('square', 260 * p, 0.05, 0.3),
    noise('highpass', 3000, 0.2, 0.02),
  ],
};

type Rng = () => number;
const between = (rng: Rng, lo: number, hi: number) => lo + (hi - lo) * rng();

/**
 * Scattered short bits (shards, splinters, chunks) over `spread` seconds.
 * Bigger smashes get more of them (AUD-3).
 */
function scatter(n: number, spread: number, rng: Rng, make: (rng: Rng) => Layer): Layer[] {
  return Array.from({ length: n }, () => ({ ...make(rng), delay: between(rng, 0, spread) }));
}

/** AUD-2, AUD-3: each material's breaking sound; `len` stretches with the size of the smash. */
const DESTROY: Record<MaterialKind, (len: number, n: number, rng: Rng) => Layer[]> = {
  // Shatter: a hiss plus many tinkling shards.
  glass: (len, n, rng) => [
    noise('highpass', 4000, 0.6, 0.25 * len),
    ...scatter(n, 0.3 * len, rng, (r) => tone('sine', between(r, 2500, 6000), 0.2, between(r, 0.08, 0.2))),
  ],
  // Splinter: a thump, a woody crunch and sharp cracks.
  wood: (len, n, rng) => [
    tone('sine', 120, 0.7, 0.15, { endFreq: 60 }),
    noise('bandpass', 700, 0.7, 0.2 * len, { q: 3 }),
    ...scatter(n, 0.25 * len, rng, (r) => noise('bandpass', between(r, 1500, 3000), 0.4, 0.02, { q: 5 })),
  ],
  // Crumble: a low thud and falling chunks.
  brick: (len, n, rng) => [
    tone('sine', 90, 0.9, 0.25, { endFreq: 45 }),
    noise('lowpass', 1200, 0.8, 0.35 * len),
    ...scatter(n, 0.4 * len, rng, (r) => noise('lowpass', between(r, 600, 1500), 0.3, 0.04)),
  ],
  // Heavy crunch: deeper and longer than brick.
  stone: (len, n, rng) => [
    tone('sine', 70, 1, 0.35, { endFreq: 35 }),
    noise('lowpass', 700, 0.9, 0.45 * len),
    ...scatter(n, 0.5 * len, rng, (r) => noise('bandpass', between(r, 800, 2000), 0.35, 0.05, { q: 2 })),
  ],
  // Tearing metal: the clang, a grinding rasp and rattling bits.
  metal: (len, n, rng) => [
    ...IMPACT.metal(0.8),
    noise('bandpass', 2500, 0.4, 0.3 * len, { q: 3 }),
    tone('sawtooth', 180, 0.1, 0.4 * len, { endFreq: 90 }),
    ...scatter(n, 0.4 * len, rng, (r) => tone('sine', between(r, 800, 3000), 0.12, between(r, 0.1, 0.3))),
  ],
};

/** A short major arpeggio, C5 E5 G5 C6. */
const GOAL_NOTES = [523.25, 659.25, 783.99, 1046.5];

export function recipe(cue: SoundCue, rng: Rng = Math.random): Layer[] {
  // Slight random detune so repeated hits don't sound like a machine gun.
  const jitter = between(rng, 0.94, 1.06);
  // Harder hits sound a little higher and brighter (AUD-3).
  const p = jitter * (0.9 + 0.2 * cue.intensity);
  switch (cue.kind) {
    case 'shot':
      return [
        noise('highpass', 3000, 0.5, 0.03),
        tone('sine', 220 * p, 0.8, 0.09, { endFreq: 90 }),
        tone('triangle', 1200 * p, 0.15, 0.02, { endFreq: 800 }),
      ];
    case 'ground':
      return [tone('sine', 110 * p, 1, 0.14, { endFreq: 45 }), noise('lowpass', 400 * p, 0.4, 0.06)];
    case 'boundary':
      // The invisible field wall: a soft, muffled thump that stays in the background.
      return [tone('sine', 80 * p, 0.8, 0.12, { endFreq: 50 * p }), noise('lowpass', 250, 0.5, 0.08)];
    case 'impact':
      return IMPACT[cue.material ?? 'brick'](p);
    case 'destroy': {
      const len = 0.6 + 0.9 * cue.size;
      const n = 3 + Math.round(10 * cue.size);
      return DESTROY[cue.material ?? 'brick'](len, n, rng);
    }
    case 'goal':
      return GOAL_NOTES.flatMap((f, i) => {
        const last = i === GOAL_NOTES.length - 1;
        return [
          tone('triangle', f, 0.5, last ? 0.7 : 0.25, { delay: i * 0.09 }),
          tone('sine', f * 2, 0.12, last ? 0.5 : 0.15, { delay: i * 0.09 }),
        ];
      });
  }
}
