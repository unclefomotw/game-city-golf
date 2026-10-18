// CAM-3, ADR-022: in orbit mode, building fragments inside a
// cone with its tip at the ball and its base at the camera are thinned out with an ordered dither
// (screen-door transparency), so the ball and the way ahead show through.
// Only fragments horizontally nearer to the camera than the ball are cut, so
// nothing beside or past the ball (the way the shot goes) is ever thinned.
//
// Buildings keep their plain materials unless a building actually reaches into
// the cone; the dithered copies are swapped in only while it is fading in or
// shown, because `discard` can cost mobile GPUs their early depth test even when
// nothing is discarded.

import * as THREE from 'three';
import type { Config } from '../config';

export type CutawayOptions = Config['cutaway'];

/** Moves `current` toward `target` (0 or 1) at `rate` per second, exponentially. */
export function stepCutawayStrength(current: number, active: boolean, dt: number, rate: number): number {
  const target = active ? 1 : 0;
  const next = THREE.MathUtils.clamp(current + (target - current) * (1 - Math.exp(-rate * Math.max(dt, 0))), 0, 1);
  // Snap the tail so the plain materials come back instead of fading forever.
  return Math.abs(next - target) < 0.01 ? target : next;
}

/**
 * How strongly a world point is thinned, 0..1 before `amount` and strength.
 * Mirrors the fragment shader so the geometry can be tested.
 */
export function cutawayWeight(
  p: THREE.Vector3,
  camera: THREE.Vector3,
  ball: THREE.Vector3,
  radius: number,
  margin: number,
): number {
  const seg = ball.clone().sub(camera);
  const h = p.clone().sub(camera).dot(seg) / Math.max(seg.lengthSq(), 1e-4);
  const flatLen = Math.max(Math.hypot(seg.x, seg.z), 1e-4);
  const pastBall = ((p.x - ball.x) * seg.x + (p.z - ball.z) * seg.z) / flatLen;
  if (h <= 0 || pastBall >= -margin) return 0;
  const d = p.clone().sub(camera).sub(seg.multiplyScalar(h)).length();
  const r = radius * Math.max(1 - h, 0);
  return THREE.MathUtils.smoothstep(-d, -r, -r * 0.7);
}

const _seg = new THREE.Vector3();
const _u = new THREE.Vector3();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const SIDE = new THREE.Vector3(1, 0, 0);

/**
 * Whether any solid cell reaches into the cutaway cone, so the dithered materials
 * are only needed then (ADR-022). Samples discs across the cone every half cell
 * along the axis, with rings and points about one cell apart; allocation free.
 */
export function coneHitsSolid(
  camera: THREE.Vector3,
  ball: THREE.Vector3,
  radius: number,
  margin: number,
  isSolid: (p: THREE.Vector3) => boolean,
): boolean {
  const seg = _seg.copy(ball).sub(camera);
  const len = seg.length();
  if (len < 1e-4) return false;
  const flatLen = Math.hypot(seg.x, seg.z);
  _u.crossVectors(seg, Math.abs(seg.y) < 0.99 * len ? UP : SIDE).normalize();
  _v.crossVectors(_u, seg).normalize();
  const steps = Math.ceil(len / 0.5);
  for (let i = 0; i < steps; i++) {
    const h = (i + 0.5) / steps;
    const r = radius * (1 - h);
    const rings = Math.ceil(r);
    for (let ring = 0; ring <= rings; ring++) {
      // Just inside the surface, where the shader's fade still thins a little.
      const rr = rings === 0 ? 0 : (0.95 * r * ring) / rings;
      const count = ring === 0 ? 1 : Math.ceil(2 * Math.PI * rr);
      for (let k = 0; k < count; k++) {
        const a = (2 * Math.PI * k) / count;
        _p.copy(camera)
          .addScaledVector(seg, h)
          .addScaledVector(_u, Math.cos(a) * rr)
          .addScaledVector(_v, Math.sin(a) * rr);
        if (flatLen > 1e-4) {
          const pastBall = ((_p.x - ball.x) * seg.x + (_p.z - ball.z) * seg.z) / flatLen;
          if (pastBall >= -margin) continue;
        }
        if (isSolid(_p)) return true;
      }
    }
  }
  return false;
}

export class Cutaway {
  /** 0 = off (plain materials), 1 = fully thinned. */
  strength = 0;
  private readonly uniforms = {
    cutStart: { value: new THREE.Vector3() },
    cutEnd: { value: new THREE.Vector3() },
    /** Cone radius at the camera; it narrows to 0 at the ball. */
    cutRadius: { value: 1 },
    /** How much horizontally nearer to the camera than the ball a fragment must be. */
    cutMargin: { value: 0 },
    /** Fraction of fragments removed along the middle of the cone. */
    cutAmount: { value: 0 },
  };

  /** A dithered copy of `material` that shares this cutaway's uniforms. */
  patch(material: THREE.Material): THREE.Material {
    const m = material.clone();
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCutWorld;')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vec4 cutWorld = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            cutWorld = instanceMatrix * cutWorld;
          #endif
          vCutWorld = (modelMatrix * cutWorld).xyz;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vCutWorld;
          uniform vec3 cutStart;
          uniform vec3 cutEnd;
          uniform float cutRadius;
          uniform float cutMargin;
          uniform float cutAmount;
          float cutBayer4(vec2 p) {
            int i = int(mod(p.x, 4.0)) + int(mod(p.y, 4.0)) * 4;
            int b[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
            return (float(b[i]) + 0.5) / 16.0;
          }`,
        )
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
          {
            // Keep in sync with cutawayWeight() below.
            vec3 seg = cutEnd - cutStart;
            float h = dot(vCutWorld - cutStart, seg) / max(dot(seg, seg), 1e-4);
            vec2 cutFlat = seg.xz / max(length(seg.xz), 1e-4);
            float pastBall = dot(vCutWorld.xz - cutEnd.xz, cutFlat);
            if (h > 0.0 && pastBall < -cutMargin) {
              float d = length(vCutWorld - cutStart - seg * h);
              float r = cutRadius * max(1.0 - h, 0.0);
              float amount = cutAmount * smoothstep(r, r * 0.7, d);
              if (cutBayer4(gl_FragCoord.xy) < amount) discard;
            }
          }`,
        );
    };
    // Keep the dithered program apart from the plain one in three's program cache.
    m.customProgramCacheKey = () => 'cutaway';
    return m;
  }

  /** Call once per frame; returns whether the dithered materials should be in use. */
  update(dt: number, active: boolean, camera: THREE.Vector3, ball: THREE.Vector3, opts: CutawayOptions): boolean {
    this.strength = stepCutawayStrength(this.strength, active, dt, opts.fadeRate);
    const u = this.uniforms;
    u.cutStart.value.copy(camera);
    u.cutEnd.value.copy(ball);
    u.cutRadius.value = opts.radius;
    u.cutMargin.value = opts.margin;
    u.cutAmount.value = this.strength * opts.amount;
    return this.strength > 0;
  }
}
