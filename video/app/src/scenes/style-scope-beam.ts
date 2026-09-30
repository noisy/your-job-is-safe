// Oscilloscope style: the electron beam. Everything on the tube is emitted as beam segments into one
// additive LineBatch, in phosphor px (1920x1080, y down). 3D paths are projected through the inner
// camera. The afterglow is a sum of the whole display evaluated at a few past times (the scene calls
// `sample(k, weight)` before each evaluation), so it stays a pure function of t.
import * as THREE from 'three';
import { LineBatch } from '../engine/lines';
import type { StrokeText } from '../engine/stroke';
import { clamp, lerp, type V2 } from '../engine/util';

export type RGB = [number, number, number];
export interface P3 { x: number; y: number; z: number }
export const p3 = (x: number, y: number, z: number): P3 => ({ x, y, z });

// P3-like amber phosphor, linear RGB. Faint traces read deep orange, strong ones amber, overdriven ones white-hot.
const DEEP: RGB = [0.5, 0.085, 0.01];
const AMBER: RGB = [1.0, 0.46, 0.07];
const HOT: RGB = [1.0, 0.82, 0.55];
export function phosphor(e: number): RGB {
  if (e < 0.5) { const u = e / 0.5; return [lerp(DEEP[0], AMBER[0], u), lerp(DEEP[1], AMBER[1], u), lerp(DEEP[2], AMBER[2], u)]; }
  const u = clamp((e - 0.5) / 0.9);
  return [lerp(AMBER[0], HOT[0], u), lerp(AMBER[1], HOT[1], u), lerp(AMBER[2], HOT[2], u)];
}

const CORE_W = 1.7;
const HALO_W = 7;
const GHOST_W = 2.8;
/** Vectors are drawn in constant time, so long ones are dimmer (px of a "normal" short vector). */
const REF_VECTOR = 14;

export class Beam {
  lines = new LineBatch(260000, { blend: 'add' });
  cam = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 200);
  /** Current persistence sample: 0 = now (core + halo), >0 = afterglow ghost with this weight. */
  private k = 0;
  private w = 1;
  /** Global intensity (refresh flicker, fades). */
  gain = 1;
  /** Channel A deflection gain around the screen centre (the wind-up squash). */
  defl = { sx: 1, sy: 1, cx: 960, cy: 540, on: false };
  private m = new Float64Array(16);

  begin() { this.lines.clear(); }
  sample(k: number, weight: number) { this.k = k; this.w = weight; }

  /** Freeze the inner camera's view-projection for the 3D calls that follow. */
  useCamera() {
    const c = this.cam;
    c.updateMatrixWorld(true);
    c.updateProjectionMatrix();
    const vp = new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
    this.m.set(vp.elements);
  }

  /** Project a world point to phosphor px; null behind the camera. `out.z` gets the view depth. */
  project(p: P3, out: { x: number; y: number; z: number }): boolean {
    const m = this.m;
    const w = m[3]! * p.x + m[7]! * p.y + m[11]! * p.z + m[15]!;
    if (w < 0.15) return false;
    const x = (m[0]! * p.x + m[4]! * p.y + m[8]! * p.z + m[12]!) / w;
    const y = (m[1]! * p.x + m[5]! * p.y + m[9]! * p.z + m[13]!) / w;
    out.x = (x * 0.5 + 0.5) * 1920;
    out.y = (0.5 - y * 0.5) * 1080;
    out.z = w;
    return true;
  }

  private defX(x: number) { return this.defl.on ? this.defl.cx + (x - this.defl.cx) * this.defl.sx : x; }
  private defY(y: number) { return this.defl.on ? this.defl.cy + (y - this.defl.cy) * this.defl.sy : y; }

  /** One beam vector in phosphor px at intensity I. */
  seg(ax: number, ay: number, bx: number, by: number, I: number, wMul = 1) {
    ax = this.defX(ax); bx = this.defX(bx); ay = this.defY(ay); by = this.defY(by);
    const L = Math.hypot(bx - ax, by - ay);
    const e = I * this.gain * clamp(Math.pow(REF_VECTOR / Math.max(L, 1), 0.28), 0.5, 1.12);
    if (e <= 0.002) return;
    const ln = this.lines;
    if (this.k === 0) {
      const c = phosphor(e), h = phosphor(e * 0.6);
      ln.seg(ax, ay, 0, bx, by, 0, CORE_W * wMul, c[0] * e * 1.5, c[1] * e * 1.5, c[2] * e * 1.5, 1);
      ln.seg(ax, ay, 0, bx, by, 0, HALO_W * wMul, h[0] * e * 0.09, h[1] * e * 0.09, h[2] * e * 0.09, 1);
    } else {
      const g = phosphor(e * 0.45), s = e * this.w * 0.2;
      ln.seg(ax, ay, 0, bx, by, 0, GHOST_W * wMul, g[0] * s, g[1] * s, g[2] * s, 1);
    }
  }
  /** A dwell point: the beam parks, the phosphor saturates. */
  dot(x: number, y: number, I: number, r = 1.4) { this.seg(x - 0.2, y, x + 0.2, y, I * 1.8, r / 1.4 * 1.9); }

  path2(pts: V2[], I: number, closed = false) {
    for (let i = 1; i < pts.length; i++) this.seg(pts[i - 1]!.x, pts[i - 1]!.y, pts[i]!.x, pts[i]!.y, I);
    if (closed && pts.length > 2) this.seg(pts[pts.length - 1]!.x, pts[pts.length - 1]!.y, pts[0]!.x, pts[0]!.y, I);
  }

  private pa = { x: 0, y: 0, z: 0 };
  private pb = { x: 0, y: 0, z: 0 };
  /** A 3D polyline; `shade(p)` optionally scales intensity per point (hidden-line dimming). */
  path3(pts: P3[], I: number, closed = false, shade?: (p: P3) => number) {
    const n = pts.length;
    if (n < 2) return;
    const a = this.pa, b = this.pb;
    let okA = this.project(pts[0]!, a), sA = shade ? shade(pts[0]!) : 1;
    for (let i = 1; i <= (closed ? n : n - 1); i++) {
      const q = pts[i % n]!;
      const okB = this.project(q, b), sB = shade ? shade(q) : 1;
      if (okA && okB) this.seg(a.x, a.y, b.x, b.y, I * 0.5 * (sA + sB));
      a.x = b.x; a.y = b.y; a.z = b.z; okA = okB; sA = sB;
    }
  }
  dot3(p: P3, I: number, r = 1.4) { if (this.project(p, this.pa)) this.dot(this.pa.x, this.pa.y, I, r); }
}

// ------------------------------------------------------------------ geometry helpers

/** A plane in the inner world: origin (text baseline-left), right and up axes, world units per px. */
export interface Plane { o: P3; u: P3; v: P3; s: number }
export function onPlane(pl: Plane, x: number, y: number): P3 {
  // stroke text is y-down px: up on the plane is -y
  return p3(pl.o.x + (pl.u.x * x - pl.v.x * y) * pl.s, pl.o.y + (pl.u.y * x - pl.v.y * y) * pl.s, pl.o.z + (pl.u.z * x - pl.v.z * y) * pl.s);
}
export function yawPlane(o: P3, yaw: number, pitch: number, s: number): Plane {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return { o, u: p3(cy, 0, -sy), v: p3(sy * sp, cp, cy * sp), s };
}

export function circle3(c: P3, r: number, n: number, plane: 'xy' | 'xz' = 'xy', a0 = 0, a1 = Math.PI * 2): P3[] {
  const out: P3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push(plane === 'xy' ? p3(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, c.z) : p3(c.x + Math.cos(a) * r, c.y, c.z + Math.sin(a) * r));
  }
  return out;
}

export function rrect2(x0: number, y0: number, x1: number, y1: number, r: number, n = 5): V2[] {
  const out: V2[] = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= n; i++) { const a = a0 + (Math.PI / 2) * (i / n); out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }); }
  };
  corner(x1 - r, y0 + r, -Math.PI / 2);
  corner(x1 - r, y1 - r, 0);
  corner(x0 + r, y1 - r, Math.PI / 2);
  corner(x0 + r, y0 + r, Math.PI);
  out.push(out[0]!);
  return out;
}

/** Subdivide a polyline so no vector is longer than `step` (keeps the constant-time dimming honest). */
export function subdiv<T extends V2>(pts: T[], step: number, mk: (a: T, b: T, u: number) => T): T[] {
  const out: T[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    if (i > 0) {
      const q = pts[i - 1]!, n = Math.ceil(Math.hypot(p.x - q.x, p.y - q.y) / step);
      for (let j = 1; j < n; j++) out.push(mk(q, p, j / n));
    }
    out.push(p);
  }
  return out;
}
export const mix2 = (a: V2, b: V2, u: number): V2 => ({ x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) });

/** The part of each stroke written by pen length `len` (like drawStrokeText, but as polylines). */
export function writtenStrokes(st: StrokeText, len: number): { pts: V2[]; ci: number; si: number; done: boolean }[] {
  const out: { pts: V2[]; ci: number; si: number; done: boolean }[] = [];
  for (let i = 0; i < st.strokes.length; i++) {
    const s0 = st.startLen[i]!;
    if (s0 >= len) break;
    const pts = st.strokes[i]!, L = st.lens[i]!, remain = len - s0;
    const part: V2[] = [pts[0]!];
    let j = 1;
    for (; j < pts.length && L[j]! <= remain; j++) part.push(pts[j]!);
    let done = true;
    if (j < pts.length) {
      const a = pts[j - 1]!, b = pts[j]!;
      part.push(mix2(a, b, (remain - L[j - 1]!) / Math.max(1e-6, L[j]! - L[j - 1]!)));
      done = false;
    }
    out.push({ pts: part, ci: st.charOf[i]!, si: i, done });
  }
  return out;
}
