// Claymation style: a signed-distance atlas of every string the set needs. Each item is rasterized
// with Canvas2D, turned into a signed distance field (exact Euclidean transform, Felzenszwalb &
// Huttenlocher), and packed into one R8 texture. The raymarcher extrudes items into rounded
// "rolled clay" letters or raised type on the clay slabs.
import * as THREE from 'three';
import { font, layout } from '../engine/type';

export const ATLAS_W = 2048;
export const ATLAS_H = 2048;
/** Distances are stored in +-SPREAD px (0.5 = on the outline). */
export const SPREAD = 20;

export interface AtlasItem {
  key: string;
  text: string;
  /** Rect in atlas px (y down). */
  x: number; y: number; w: number; h: number;
  /** Baseline, px from the rect's top; the text starts SPREAD px from the rect's left. */
  base: number;
  size: number;
  /** Left and right edge (px from the rect's left) of every char, for typing reveals and per-letter motion. */
  cx0: number[]; cx1: number[];
}

export interface AtlasReq { key: string; text: string; family: string; size: number }

export class ClayAtlas {
  items = new Map<string, AtlasItem>();
  tex: THREE.DataTexture;

  constructor(reqs: AtlasReq[]) {
    const cv = document.createElement('canvas');
    cv.width = ATLAS_W; cv.height = ATLAS_H;
    const c = cv.getContext('2d', { willReadFrequently: true })!;
    c.fillStyle = '#000'; c.fillRect(0, 0, ATLAS_W, ATLAS_H);
    c.fillStyle = '#fff';
    c.textBaseline = 'alphabetic';
    // shelf packing
    let x = 0, y = 0, shelf = 0;
    for (const r of reqs) {
      const lay = layout(r.text, r.family, r.size);
      const w = Math.ceil(lay.width + 2 * SPREAD + 4), h = Math.ceil(r.size * 1.25 + 2 * SPREAD);
      if (x + w > ATLAS_W) { x = 0; y += shelf; shelf = 0; }
      if (y + h > ATLAS_H) throw new Error('clay atlas overflow');
      const base = Math.round(SPREAD + r.size * 0.95);
      c.font = font(r.family, r.size);
      c.fillText(r.text, x + SPREAD, y + base);
      const cx0 = lay.glyphs.map((g) => SPREAD + g.x), cx1 = lay.glyphs.map((g) => SPREAD + g.x + g.w);
      this.items.set(r.key, { key: r.key, text: r.text, x, y, w, h, base, size: r.size, cx0, cx1 });
      x += w; shelf = Math.max(shelf, h);
    }
    const img = c.getImageData(0, 0, ATLAS_W, ATLAS_H).data;
    const n = ATLAS_W * ATLAS_H;
    const inside = new Uint8Array(n);
    for (let i = 0; i < n; i++) inside[i] = img[i * 4]! > 127 ? 1 : 0;
    const dOut = edt(inside, ATLAS_W, ATLAS_H, 1), dIn = edt(inside, ATLAS_W, ATLAS_H, 0);
    const data = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      // half a pixel either side of the outline
      const d = inside[i] ? -(Math.sqrt(dIn[i]!) - 0.5) : Math.sqrt(dOut[i]!) - 0.5;
      data[i] = Math.max(0, Math.min(255, Math.round(127.5 + (d / SPREAD) * 127.5)));
    }
    this.tex = new THREE.DataTexture(data, ATLAS_W, ATLAS_H, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;
  }

  get(key: string) {
    const it = this.items.get(key);
    if (!it) throw new Error(`clay atlas: no item ${key}`);
    return it;
  }
}

/** Squared distance to the nearest pixel whose `inside` equals `target`. */
function edt(inside: Uint8Array, w: number, h: number, target: number): Float64Array {
  const INF = 1e10;
  const g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = inside[i] === target ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const pass = (len: number) => {
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      while (s <= z[k]!) { k--; s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1]! < q) k++;
      d[q] = (q - v[k]!) * (q - v[k]!) + f[v[k]!]!;
    }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x]!;
    pass(h);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y]!;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x]!;
    pass(w);
    for (let x = 0; x < w; x++) g[y * w + x] = d[x]!;
  }
  return g;
}
