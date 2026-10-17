// VIS-3: pixel-art textures for the building materials (ADR-019, ADR-020).
// Each is a 16x16 tile drawn on a canvas at startup (no image assets) and
// covers one face of one voxel. Tiles are near-greyscale: they carry only the
// material's structure, and each building's paint colour is multiplied on top.
// So the patterns must read on their own, even in greyscale.

import * as THREE from 'three';
import { createRng, type Rng } from '../core/rng';
import { MATERIALS, type MaterialKind } from '../world/materials';

const SIZE = 16;

type Painter = { px(x: number, y: number, grey: number): void; rng: Rng };

function fill(p: Painter, x0: number, y0: number, w: number, h: number, grey: number, noise: number): void {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) p.px(x, y, grey + (p.rng.next() - 0.5) * 2 * noise);
}

function frame(p: Painter, grey: number): void {
  fill(p, 0, 0, SIZE, 1, grey, 0.01);
  fill(p, 0, SIZE - 1, SIZE, 1, grey, 0.01);
  fill(p, 0, 0, 1, SIZE, grey, 0.01);
  fill(p, SIZE - 1, 0, 1, SIZE, grey, 0.01);
}

const PAINTERS: Record<MaterialKind, (p: Painter) => void> = {
  // Running bond: 4px courses (3 brick + 1 dark mortar), oblong 7x3 bricks, odd courses offset by half.
  // Bricks vary strongly in shade so the stagger stays visible.
  brick(p) {
    fill(p, 0, 0, SIZE, SIZE, 0.55, 0.02);
    for (let row = 0; row < 4; row++) {
      const offset = row % 2 ? 4 : 0;
      for (let b = -1; b < 2; b++) {
        const base = 0.85 + (p.rng.next() - 0.5) * 0.3;
        for (let y = row * 4; y < row * 4 + 3; y++)
          for (let x = b * 8 + offset; x < b * 8 + offset + 7; x++) if (x >= 0 && x < SIZE) p.px(x, y, base);
      }
    }
  },
  // Rubble wall: stones of mixed size from a weighted Voronoi layout that wraps
  // at the tile edges (so it tiles seamlessly), dark joints, heavy speckle.
  stone(p) {
    // [x, y, weight]: a larger weight grows a larger stone.
    const seeds: [number, number, number][] = [
      [3, 3, 1.6],
      [10, 2, 0.4],
      [14.5, 8, 0.9],
      [6, 10, 2.2],
      [1, 13.5, -0.3],
      [11.5, 13, 0.8],
      [8.5, 5.5, -0.6],
      [13, 0.5, -0.8],
    ];
    const wrap = (d: number) => Math.min(Math.abs(d), SIZE - Math.abs(d));
    const owner: number[] = [];
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        let best = Number.POSITIVE_INFINITY;
        seeds.forEach(([sx, sy, w], i) => {
          const d = Math.hypot(wrap(x + 0.5 - sx), wrap(y + 0.5 - sy)) - w;
          if (d < best) {
            best = d;
            owner[y * SIZE + x] = i;
          }
        });
      }
    const shade = seeds.map(() => 0.92 + (p.rng.next() - 0.5) * 0.14);
    const at = (x: number, y: number) => owner[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const o = at(x, y);
        const joint = o !== at(x + 1, y) || o !== at(x, y + 1);
        if (joint) p.px(x, y, 0.45 + (p.rng.next() - 0.5) * 0.04);
        else p.px(x, y, shade[o] + (p.rng.next() - 0.5) * 0.16);
      }
  },
  // Upright planks of uneven width (like standing posts): dark seam on the left,
  // vertical grain streaks, nail dots at both ends. Wider and irregular, unlike metal's even ribs.
  wood(p) {
    const cuts = [0, 5, 11, 16];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const x0 = cuts[i];
      const w = cuts[i + 1] - x0;
      const base = 0.96 + (p.rng.next() - 0.5) * 0.08;
      fill(p, x0, 0, 1, SIZE, 0.38, 0.02);
      fill(p, x0 + 1, 0, w - 1, SIZE, base, 0.02);
      for (let k = 0; k < 2; k++) {
        const gx = x0 + 1 + p.rng.int(0, w - 2);
        const gy = p.rng.int(0, SIZE - 7);
        for (let y = gy; y < gy + p.rng.int(4, 7); y++) p.px(gx, y, 0.74);
      }
      const mid = x0 + Math.floor(w / 2);
      p.px(mid, 1, 0.3);
      p.px(mid, 14, 0.3);
    }
  },
  // A plain flat plate with a thin dark rim and a 2x2 rivet in each corner: lit head, shadow below and to the right.
  metal(p) {
    fill(p, 0, 0, SIZE, SIZE, 0.82, 0.005);
    frame(p, 0.5);
    for (const [x, y] of [
      [2, 2],
      [12, 2],
      [2, 12],
      [12, 12],
    ]) {
      p.px(x, y, 1);
      p.px(x + 1, y, 0.97);
      p.px(x, y + 1, 0.97);
      p.px(x + 1, y + 1, 0.9);
      for (const [dx, dy] of [
        [2, 0],
        [2, 1],
        [0, 2],
        [1, 2],
        [2, 2],
      ])
        p.px(x + dx, y + dy, 0.45);
    }
  },
  // One large pane per face: bright at the top, a little darker below, a bright glint and a dark frame.
  glass(p) {
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) p.px(x, y, 1 - (0.25 * y) / (SIZE - 1));
    for (let i = 2; i < 10; i++) {
      p.px(i, 11 - i, 1);
      p.px(i + 1, 11 - i, 1);
      p.px(i + 4, 14 - i, 0.95);
    }
    frame(p, 0.22);
  },
};

function makeTexture(kind: MaterialKind, seed: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  PAINTERS[kind]({
    rng: createRng(seed),
    px(x, y, grey) {
      const v = Math.round(Math.max(0, Math.min(1, grey)) * 255);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
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

/** One render material per building material. Glass and metal get a cheap specular glint, glass the stronger one. */
export function createMaterialMeshMaterials(): Record<MaterialKind, THREE.Material> {
  const out = {} as Record<MaterialKind, THREE.Material>;
  MATERIALS.forEach((kind, i) => {
    const map = makeTexture(kind, 101 + i);
    out[kind] =
      kind === 'glass'
        ? new THREE.MeshPhongMaterial({ map, specular: 0xaaaaaa, shininess: 90 })
        : kind === 'metal'
          ? new THREE.MeshPhongMaterial({ map, specular: 0x666666, shininess: 30 })
          : new THREE.MeshLambertMaterial({ map });
  });
  return out;
}
