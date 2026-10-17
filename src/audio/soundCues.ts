// Turns game events into sound cues (AUD-1 ~ AUD-4, AUD-8, ADR-021). Pure logic: no Web Audio.

import type { Config } from '../config';
import type { SimEvent } from '../physics/ballSim';
import type { MaterialKind } from '../world/materials';

/** Everything that can make a sound: physics events plus the shot and the finished hole (AUD-1). */
export type SoundEvent = SimEvent | { type: 'shot'; power: number } | { type: 'goal' };

export type CueKind = 'shot' | 'ground' | 'boundary' | 'impact' | 'destroy' | 'goal';

export type SoundCue = {
  kind: CueKind;
  /** AUD-2: the building material, for 'impact' and 'destroy'. */
  material?: MaterialKind;
  /** 0..1: how hard the hit was (AUD-3). */
  intensity: number;
  /** 0..1: how much was smashed, for 'destroy' (AUD-3). */
  size: number;
};

type AudioConfig = Config['audio'];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function toCue(e: SoundEvent, a: AudioConfig): SoundCue | null {
  switch (e.type) {
    case 'shot':
      return { kind: 'shot', intensity: clamp01(e.power), size: 0 };
    case 'goal':
      return { kind: 'goal', intensity: 1, size: 0 };
    case 'destroy':
      return {
        kind: 'destroy',
        material: e.cells[0]?.material,
        intensity: clamp01(e.speed / a.fullImpactSpeed),
        size: clamp01(e.cells.length / a.fullDestroyCells),
      };
    case 'bounce': {
      // AUD-8: faint taps (e.g. the last little hops before the ball stops) stay silent.
      if (e.speed < a.minImpactSpeed) return null;
      const intensity = clamp01((e.speed - a.minImpactSpeed) / (a.fullImpactSpeed - a.minImpactSpeed));
      if (e.surface === 'ground' || e.surface === 'boundary') return { kind: e.surface, intensity, size: 0 };
      return { kind: 'impact', material: e.surface, intensity, size: 0 };
    }
  }
}

const cueKey = (c: SoundCue) => (c.material ? `${c.kind}:${c.material}` : c.kind);

/**
 * AUD-8: keeps bursts of events from piling up into noise.
 * - one cue per sound per frame (several smashes of the same material merge into a bigger one)
 * - a smash swallows the building hit that came with it
 * - the same sound does not repeat within `cooldown` seconds
 */
export class SoundDirector {
  private readonly lastPlayed = new Map<string, number>();

  constructor(private readonly cfg: Config) {}

  cues(events: readonly SoundEvent[], now: number): SoundCue[] {
    const a = this.cfg.audio;
    const smashed = events.some((e) => e.type === 'destroy');
    const byKey = new Map<string, SoundCue>();
    for (const e of events) {
      const cue = toCue(e, a);
      if (!cue || (smashed && cue.kind === 'impact')) continue;
      const key = cueKey(cue);
      const prev = byKey.get(key);
      if (prev) {
        prev.intensity = Math.max(prev.intensity, cue.intensity);
        prev.size = clamp01(prev.size + cue.size);
      } else {
        byKey.set(key, cue);
      }
    }
    const out: SoundCue[] = [];
    for (const [key, cue] of byKey) {
      const last = this.lastPlayed.get(key);
      if (last !== undefined && now - last < a.cooldown) continue;
      this.lastPlayed.set(key, now);
      out.push(cue);
    }
    return out;
  }
}

/** AUD-4: full volume up to refDistance, then fades with the camera-to-ball distance. */
export function distanceGain(distance: number, a: AudioConfig): number {
  return a.refDistance / (a.refDistance + a.rolloff * Math.max(0, distance - a.refDistance));
}

/** Final 0..1 volume of a cue: per-sound volume x hit strength (AUD-3) x distance (AUD-4). */
export function cueGain(cue: SoundCue, distance: number, a: AudioConfig): number {
  let g = a.volume[cue.kind] * (a.minLoudness + (1 - a.minLoudness) * cue.intensity);
  if (cue.kind === 'destroy') g *= 0.6 + 0.4 * cue.size;
  return g * distanceGain(distance, a);
}
