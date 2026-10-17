// VIS-3: pixel-art textures for the building materials (ADR-019).
// Each is a 16x16 tile drawn on a canvas at startup (no image assets) and
// covers one face of one voxel. Colours carry the material, so buildings are
// told apart by base colour as well as by pattern, even from far away.

import * as THREE from 'three';
import { createRng, type Rng } from '../core/rng';
import { MATERIALS, type MaterialKind } from '../world/materials';

const SIZE = 16;

/** Representative colour of each material, used where a texture would not read (debris). */
export const MATERIAL_COLORS: Record<MaterialKind, number> = {
  glass: 0x5b8fb8,
  wood: 0x9a6a3c,
  brick: 0xa8503a,
  stone: 0xb0a48a,
  metal: 0x7a8fa2,
};

type Painter = { px(x: number, y: number, color: THREE.Color): void; rng: Rng };

/** Returns `hex` with its lightness shifted by up to ±amount. */
function jitter(hex: number, rng: Rng, amount: number): THREE.Color {
  return new THREE.Color(hex).offsetHSL(0, 0, (rng.next() - 0.5) * 2 * amount);
}

function fill(p: Painter, x0: number, y0: number, w: number, h: number, base: number, noise: number): void {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) p.px(x, y, jitter(base, p.rng, noise));
}

const PAINTERS: Record<MaterialKind, (p: Painter) => void> = {
  // Running bond: 4px courses (3 brick + 1 mortar), bricks 8px wide, odd courses offset by half.
  brick(p) {
    fill(p, 0, 0, SIZE, SIZE, 0xb9ad9c, 0.03);
    for (let row = 0; row < 4; row++) {
      const offset = row % 2 ? 4 : 0;
      for (let b = -1; b < 2; b++) {
        const base = jitter(0xa8503a, p.rng, 0.06).getHex();
        for (let y = row * 4; y < row * 4 + 3; y++)
          for (let x = b * 8 + offset; x < b * 8 + offset + 7; x++)
            if (x >= 0 && x < SIZE) p.px(x, y, jitter(base, p.rng, 0.03));
      }
    }
  },
  // Irregular ashlar blocks with dark joints and speckle.
  stone(p) {
    fill(p, 0, 0, SIZE, SIZE, 0x7a705e, 0.03);
    const rows: [number, number, number[]][] = [
      [0, 7, [0, 6, 16]],
      [8, 7, [0, 3, 11, 16]],
    ];
    for (const [y0, h, cuts] of rows)
      for (let i = 0; i + 1 < cuts.length; i++) {
        const base = jitter(0xb0a48a, p.rng, 0.05).getHex();
        fill(p, cuts[i], y0, cuts[i + 1] - cuts[i] - 1, h, base, 0.06);
      }
  },
  // Horizontal planks with a dark seam on top, grain streaks and nail dots.
  wood(p) {
    for (let plank = 0; plank < 4; plank++) {
      const base = jitter(0x9a6a3c, p.rng, 0.06).getHex();
      fill(p, 0, plank * 4, SIZE, 1, 0x5e3d20, 0.03);
      fill(p, 0, plank * 4 + 1, SIZE, 3, base, 0.025);
      for (let k = 0; k < 2; k++) {
        const gy = plank * 4 + 1 + p.rng.int(0, 2);
        const gx = p.rng.int(0, SIZE - 5);
        for (let x = gx; x < gx + p.rng.int(3, 5); x++) p.px(x, gy, jitter(0x7a5230, p.rng, 0.03));
      }
      const nail = new THREE.Color(0x4a3420);
      p.px(1, plank * 4 + 2, nail);
      p.px(14, plank * 4 + 2, nail);
    }
  },
  // One corrugated panel per face: darker rim, lit top/left edge, corner rivets.
  metal(p) {
    for (let x = 0; x < SIZE; x++) fill(p, x, 0, 1, SIZE, x % 4 < 2 ? 0x7f95a8 : 0x72879a, 0.015);
    fill(p, 0, 0, SIZE, 1, 0x485a6a, 0.02);
    fill(p, 0, SIZE - 1, SIZE, 1, 0x485a6a, 0.02);
    fill(p, 0, 0, 1, SIZE, 0x485a6a, 0.02);
    fill(p, SIZE - 1, 0, 1, SIZE, 0x485a6a, 0.02);
    fill(p, 1, 1, SIZE - 2, 1, 0xa9bccc, 0.02);
    fill(p, 1, 1, 1, SIZE - 2, 0xa9bccc, 0.02);
    const rivet = new THREE.Color(0xd0d6db);
    for (const [x, y] of [
      [2, 2],
      [13, 2],
      [2, 13],
      [13, 13],
    ])
      p.px(x, y, rivet);
  },
  // A framed pane, lighter at the top, with a diagonal glint.
  glass(p) {
    const top = new THREE.Color(0x7fb2d6);
    const bottom = new THREE.Color(0x2f5f86);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) p.px(x, y, top.clone().lerp(bottom, y / (SIZE - 1)));
    for (let i = 3; i < 9; i++) {
      p.px(i, 11 - i, new THREE.Color(0xd8ecf8));
      p.px(i + 3, 14 - i, new THREE.Color(0xb4d4ea));
    }
    fill(p, 0, 0, SIZE, 1, 0x3c4a56, 0.02);
    fill(p, 0, SIZE - 1, SIZE, 1, 0x3c4a56, 0.02);
    fill(p, 0, 0, 1, SIZE, 0x3c4a56, 0.02);
    fill(p, SIZE - 1, 0, 1, SIZE, 0x3c4a56, 0.02);
  },
};

function makeTexture(kind: MaterialKind, seed: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  PAINTERS[kind]({
    rng: createRng(seed),
    px(x, y, color) {
      ctx.fillStyle = `#${color.getHexString()}`;
      ctx.fillRect(x, y, 1, 1);
    },
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Crisp pixels up close; mipmaps keep distant walls from shimmering.
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

/** One render material per building material. Glass and metal get a cheap specular glint. */
export function createMaterialMeshMaterials(): Record<MaterialKind, THREE.Material> {
  const out = {} as Record<MaterialKind, THREE.Material>;
  MATERIALS.forEach((kind, i) => {
    const map = makeTexture(kind, 101 + i);
    out[kind] =
      kind === 'glass'
        ? new THREE.MeshPhongMaterial({ map, specular: 0x8899aa, shininess: 80 })
        : kind === 'metal'
          ? new THREE.MeshPhongMaterial({ map, specular: 0x555555, shininess: 40 })
          : new THREE.MeshLambertMaterial({ map });
  });
  return out;
}
