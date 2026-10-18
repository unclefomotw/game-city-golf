// CAM-3, ADR-022: when no orbit angle can see the ball, building fragments inside a
// cylinder from the camera to the ball are thinned out with an ordered dither
// (screen-door transparency), so the ball and the way ahead show through.
//
// Buildings keep their plain materials while the cutaway is off; the dithered
// copies are swapped in only while it is fading in or shown, because `discard`
// can cost mobile GPUs their early depth test even when nothing is discarded.

import * as THREE from 'three';
import type { Config } from '../config';

export type CutawayOptions = Config['cutaway'];

/** Moves `current` toward `target` (0 or 1) at `rate` per second, exponentially. */
export function stepCutawayStrength(current: number, active: boolean, dt: number, rate: number): number {
  const target = active ? 1 : 0;
  const next = current + (target - current) * (1 - Math.exp(-rate * dt));
  // Snap the tail so the plain materials come back instead of fading forever.
  return Math.abs(next - target) < 0.01 ? target : next;
}

export class Cutaway {
  /** 0 = off (plain materials), 1 = fully thinned. */
  strength = 0;
  private readonly uniforms = {
    cutStart: { value: new THREE.Vector3() },
    cutEnd: { value: new THREE.Vector3() },
    cutRadius: { value: 1 },
    /** Fraction of fragments removed in the middle of the cylinder. */
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
            vec3 seg = cutEnd - cutStart;
            float h = dot(vCutWorld - cutStart, seg) / max(dot(seg, seg), 1e-4);
            // Only between the camera and the ball; what lies past the ball stays solid.
            if (h > 0.0 && h < 1.0) {
              float d = length(vCutWorld - cutStart - seg * h);
              float amount = cutAmount * smoothstep(cutRadius, cutRadius * 0.7, d);
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
    u.cutAmount.value = this.strength * opts.amount;
    return this.strength > 0;
  }
}
