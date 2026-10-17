// Plays sound recipes with the Web Audio API (ADR-021). Everything is synthesized: no audio files.
// Mixing runs on the browser's audio thread; the main thread only creates a few short-lived nodes per cue.

import type { Config } from '../config';
import { type Layer, layersDuration, recipe } from './recipes';
import type { SoundCue } from './soundCues';

const MUTE_KEY = 'city-golf.muted';

/** AUD-6: the mute choice survives reloads; storage may be blocked (private mode), so never throw. */
function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // Not remembered this time; the button still works.
  }
}

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

export class SoundPlayer {
  muted = loadMuted();
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  /** End times (ctx seconds) of the cues still sounding, for the voice cap (AUD-8). */
  private voiceEnds: number[] = [];

  constructor(private readonly cfg: Config) {}

  /**
   * Browsers only start audio from a user gesture, so call this from input handlers.
   * Safe to call repeatedly: it also resumes a context the system suspended (e.g. a phone call).
   */
  unlock(): void {
    if (!this.ctx) {
      // AUD-9: an 'ambient' session follows the phone's silent switch (Safari 16.4+;
      // older iOS already mutes Web Audio in silent mode).
      const session = (navigator as AudioSessionNavigator).audioSession;
      if (session) session.type = 'ambient';
      const ctx = new AudioContext();
      // A limiter so overlapping cues don't clip.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.ratio.value = 12;
      limiter.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.connect(limiter);
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.ctx = ctx;
      this.applyVolume();
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  /** AUD-5, AUD-6 */
  setMuted(muted: boolean): void {
    this.muted = muted;
    saveMuted(muted);
    this.applyVolume();
  }

  private applyVolume(): void {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.cfg.audio.masterVolume;
  }

  /** `gain` is the cue's final 0..1 volume (see cueGain). */
  play(cue: SoundCue, gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted || ctx.state !== 'running' || gain <= 0.001) return;
    this.applyVolume(); // picks up ?debug panel changes
    const now = ctx.currentTime;
    // AUD-8: drop new cues while too many are still sounding.
    this.voiceEnds = this.voiceEnds.filter((t) => t > now);
    if (this.voiceEnds.length >= this.cfg.audio.maxVoices) return;
    const layers = recipe(cue);
    const out = ctx.createGain();
    out.gain.value = gain;
    out.connect(this.master);
    for (const layer of layers) this.playLayer(ctx, layer, out, now);
    this.voiceEnds.push(now + layersDuration(layers));
  }

  private playLayer(ctx: AudioContext, l: Layer, out: AudioNode, now: number): void {
    const start = now + (l.delay ?? 0);
    const end = start + l.decay;
    // Click in fast, fade out exponentially: a percussive hit.
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(l.gain, start + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    env.connect(out);

    let src: AudioScheduledSourceNode;
    if (l.type === 'tone') {
      const osc = ctx.createOscillator();
      osc.type = l.wave;
      osc.frequency.setValueAtTime(l.freq, start);
      if (l.endFreq) osc.frequency.exponentialRampToValueAtTime(l.endFreq, end);
      osc.connect(env);
      src = osc;
    } else {
      const buf = ctx.createBufferSource();
      buf.buffer = this.noise;
      buf.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = l.filter;
      filter.frequency.value = l.freq;
      if (l.q) filter.Q.value = l.q;
      buf.connect(filter).connect(env);
      src = buf;
    }
    // Nodes are garbage-collected once the source stops.
    if (src instanceof AudioBufferSourceNode) src.start(start, Math.random());
    else src.start(start);
    src.stop(end + 0.02);
  }
}
