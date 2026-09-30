// Pencil animatic: the pencil. Every mark is a polyline in "virtual px" (a 1920x1080 drawing) that the
// pen maps to the screen (identity when the drawing fills the frame, or through a storyboard panel's
// projection when it is seen on the sheet), then draws as several slightly different passes with
// pressure tapering and a boil that is re-drawn on twos (12 drawings a second). Channels: graphite,
// non-photo blue, red pencil (max-blended); the paper pass turns their coverage into pencil on paper.
import { LineBatch } from '../engine/lines';
import { strokeText, type StrokeFontName } from '../engine/stroke';
import { type V2, clamp, noise1, lerp } from '../engine/util';

export const GRAPHITE = 0, BLUE = 1, RED = 2;
export type Channel = 0 | 1 | 2;

export interface StrokeOpts {
  /** Width in virtual px. */
  w?: number;
  /** Graphite laid down per pass (additive). */
  dark?: number;
  ch?: Channel;
  passes?: number;
  /** Boil amplitude in virtual px (0: printed, never moves). */
  jit?: number;
  seed?: number;
  /** Pencil flick past the ends (virtual px). */
  over?: number;
  /** Draw only the first `len` virtual px of the stroke (writing it). */
  len?: number;
  /** Pressure taper length at the ends (virtual px). */
  taper?: number;
}

/** Maps virtual px to screen px (null: behind the camera). */
export type Mapper = (x: number, y: number) => [number, number] | null;

export class Pen {
  batch: LineBatch;
  /** Drawing index: the boil changes when it changes. */
  di = 0;
  map: Mapper | null = null;
  /** Screen px per virtual px (widths and jitter follow it). */
  scale = 1;
  /** Clip rectangle in virtual px. */
  clip: [number, number, number, number] = [0, 0, 1920, 1080];

  constructor(capacity = 160000) {
    // max, not add: a stroke's own overlapping segment ends would print as dots at every joint
    this.batch = new LineBatch(capacity, { screen2D: true, blend: 'max' });
  }

  begin(di: number) { this.batch.clear(); this.di = di; this.direct(); }
  /** Draw straight onto the frame. */
  direct() { this.map = null; this.scale = 1; this.clip = [-200, -200, 2120, 1280]; }
  /** Draw into a panel: `map` takes virtual px to screen px, `scale` its local zoom. */
  through(map: Mapper, scale: number) { this.map = map; this.scale = scale; this.clip = [0, 0, 1920, 1080]; }

  /** One pencil stroke. */
  line(pts: V2[], o: StrokeOpts = {}) {
    if (pts.length < 2) return;
    const ch = o.ch ?? GRAPHITE;
    // construction in non-photo blue is ruled fast: always doubled, always overshooting
    const blue = ch === BLUE;
    const w = (o.w ?? 2.2) * 1.3, dark = Math.min(1.3, (o.dark ?? 0.55) * (blue ? 2.0 : 1.45)), passes = blue ? Math.max(2, o.passes ?? 2) : o.passes ?? 2;
    const jit = (o.jit ?? 1.6) * 1.7, seed = o.seed ?? 0, over = blue ? Math.max(16, o.over ?? 0) : o.over ?? 0, taper = o.taper ?? 14;
    // resample so the boil bends long straight strokes instead of just shifting them
    const P: V2[] = [];
    const S: number[] = [];
    let acc = 0;
    const step = 22;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      if (i > 0) {
        const q = pts[i - 1]!;
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        const n = Math.min(24, Math.max(1, Math.ceil(d / step)));
        for (let k = 1; k <= n; k++) { P.push({ x: lerp(q.x, p.x, k / n), y: lerp(q.y, p.y, k / n) }); S.push(acc + (d * k) / n); }
        acc += d;
      } else { P.push({ x: p.x, y: p.y }); S.push(0); }
    }
    const total = acc;
    if (total < 0.5) return;
    const len = Math.min(total, o.len ?? total);
    if (len <= 0) return;
    // the flick: extend the ends along their direction
    if (over > 0 && len >= total) {
      const a = P[0]!, b = P[1]!, y = P[P.length - 1]!, z = P[P.length - 2]!;
      const da = Math.hypot(a.x - b.x, a.y - b.y) || 1, dz = Math.hypot(y.x - z.x, y.y - z.y) || 1;
      P[0] = { x: a.x + ((a.x - b.x) / da) * over * 0.6, y: a.y + ((a.y - b.y) / da) * over * 0.6 };
      P[P.length - 1] = { x: y.x + ((y.x - z.x) / dz) * over, y: y.y + ((y.y - z.y) / dz) * over };
    }
    const r = ch === GRAPHITE ? 1 : 0, g = ch === BLUE ? 1 : 0, b = ch === RED ? 1 : 0;
    const di = this.di;
    for (let k = 0; k < passes; k++) {
      const sk = seed * 7.13 + k * 3.31 + di * 1.73;
      // each pass lands a little off the last one: the doubled line of a quick sketch
      const ox = jit > 0 ? noise1(sk, 1) * jit * 1.3 : 0, oy = jit > 0 ? noise1(sk, 2) * jit * 1.3 : 0;
      let prev: V2 | null = null, prevS = 0;
      for (let i = 0; i < P.length; i++) {
        const s = S[i]!;
        const p = P[i]!;
        let x = p.x + ox, y = p.y + oy;
        if (jit > 0) { x += noise1(s / 70 + sk, 3) * jit; y += noise1(s / 70 + sk, 4) * jit; }
        let cur: V2 = { x, y };
        if (s > len && prev) {
          const u = (len - prevS) / Math.max(1e-6, s - prevS);
          cur = { x: lerp(prev.x, x, u), y: lerp(prev.y, y, u) };
        }
        if (prev) {
          const sm = (prevS + Math.min(s, len)) / 2;
          const press = clamp(Math.min(sm, total - sm) / taper, 0.25, 1) * (0.62 + 0.38 * noise1(sm / 90 + sk, 5));
          this.seg(prev.x, prev.y, cur.x, cur.y, w * (0.75 + 0.35 * press), dark * press, r, g, b);
        }
        if (s >= len) break;
        prev = cur; prevS = s;
      }
    }
  }

  /** A graphite smudge: the side of the hand dragged along a path (wide, faint, streaky). */
  smudge(pts: V2[], width: number, dark: number, seed = 0) {
    for (let k = 0; k < 6; k++) {
      const off = (k - 2.5) * width * 0.14;
      const q = pts.map((p, i) => ({ x: p.x + off * 0.3, y: p.y + off + noise1(i * 0.7 + seed + k, 8) * width * 0.08 }));
      this.line(q, { w: width * 0.32, dark: dark * (0.5 + 0.5 * noise1(seed + k * 1.9, 9) ** 2), passes: 1, jit: 0, seed: seed + k, taper: width * 1.5 });
    }
  }

  /** Several strokes, e.g. a stroke-font text. */
  lines(polys: V2[][], o: StrokeOpts = {}) { polys.forEach((p, i) => this.line(p, { ...o, seed: (o.seed ?? 0) + i * 1.37 })); }

  /** A clipped, mapped segment in virtual px. */
  private seg(ax: number, ay: number, bx: number, by: number, w: number, d: number, r: number, g: number, b: number) {
    const c = clipSeg(ax, ay, bx, by, this.clip);
    if (!c) return;
    let [x0, y0, x1, y1] = c;
    if (this.map) {
      const A = this.map(x0, y0), B = this.map(x1, y1);
      if (!A || !B) return;
      [x0, y0] = A; [x1, y1] = B;
    }
    const s = this.scale;
    this.batch.seg(x0, y0, 0, x1, y1, 0, Math.max(0.5, w * s), r * d, g * d, b * d, 1);
  }
}

/** Liang–Barsky clip of a segment to a rectangle. */
export function clipSeg(ax: number, ay: number, bx: number, by: number, r: [number, number, number, number]): [number, number, number, number] | null {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  const p = [-dx, dx, -dy, dy], q = [ax - r[0], r[2] - ax, ay - r[1], r[3] - ay];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i]! < 0) return null; continue; }
    const u = q[i]! / p[i]!;
    if (p[i]! < 0) { if (u > t1) return null; if (u > t0) t0 = u; }
    else { if (u < t0) return null; if (u < t1) t1 = u; }
  }
  return [ax + dx * t0, ay + dy * t0, ax + dx * t1, ay + dy * t1];
}

/** Hatch a polygon (virtual px) with parallel strokes `spacing` apart at `angle`: the segments inside it. */
export function hatchPoly(poly: V2[] | V2[][], spacing: number, angle: number, phase = 0): [V2, V2][] {
  // several polygons fill by the even-odd rule (a letter with its counters)
  const polys = (Array.isArray(poly[0]) ? poly : [poly]) as V2[][];
  const c = Math.cos(angle), s = Math.sin(angle);
  // rotate so hatch lines are horizontal: v = -x s + y c
  const Rs = polys.filter((p) => p.length >= 3).map((pl) => pl.map((p) => ({ u: p.x * c + p.y * s, v: -p.x * s + p.y * c })));
  if (!Rs.length) return [];
  let v0 = Infinity, v1 = -Infinity;
  for (const R of Rs) for (const p of R) { v0 = Math.min(v0, p.v); v1 = Math.max(v1, p.v); }
  const out: [V2, V2][] = [];
  const start = Math.ceil((v0 - phase) / spacing) * spacing + phase;
  for (let v = start; v <= v1; v += spacing) {
    const xs: number[] = [];
    for (const R of Rs) for (let i = 0; i < R.length; i++) {
      const a = R[i]!, b = R[(i + 1) % R.length]!;
      if ((a.v <= v && b.v > v) || (b.v <= v && a.v > v)) xs.push(a.u + ((v - a.v) / (b.v - a.v)) * (b.u - a.u));
    }
    xs.sort((x, y) => x - y);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const u0 = xs[i]!, u1 = xs[i + 1]!;
      out.push([{ x: u0 * c - v * s, y: u0 * s + v * c }, { x: u1 * c - v * s, y: u1 * s + v * c }]);
    }
  }
  return out;
}

/** A hand-lettered string as polylines in its own px (origin left baseline, y down), with char ranges for syncing. */
export function lettering(text: string, font: StrokeFontName, size: number) {
  return strokeText(text, font, size);
}

/** The pencil itself (a small drawing of it), its tip at (x, y) in virtual px. */
export function pencilTip(pen: Pen, x: number, y: number, size: number, seed: number) {
  const a = -Math.PI / 3.1; // leaning up-right
  const dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
  const L = size * 7, cone = size * 1.3, hw = size * 0.42;
  const P = (u: number, v: number): V2 => ({ x: x + dx * u + nx * v, y: y + dy * u + ny * v });
  const o = { w: 1.8, dark: 0.5, passes: 1, jit: 0.8, seed };
  pen.line([P(cone, -hw), P(0, 0), P(cone, hw)], { ...o, dark: 0.7 });
  pen.line([P(cone * 0.35, -hw * 0.35), P(cone * 0.35, hw * 0.35)], o);
  pen.line([P(cone, -hw), P(L, -hw)], o);
  pen.line([P(cone, hw), P(L, hw)], o);
  pen.line([P(cone, 0), P(L, 0)], { ...o, dark: 0.25 });
  pen.line([P(L, -hw), P(L, hw)], o);
  pen.line([P(L - size * 0.9, -hw), P(L - size * 0.9, hw)], o);
  // the graphite point
  pen.line([P(0, 0), P(cone * 0.35, 0)], { ...o, w: 3, dark: 1 });
  // shade the underside
  for (let u = cone + size * 0.3; u < L - size; u += size * 0.55) pen.line([P(u, hw * 0.2), P(u + size * 0.35, hw * 0.95)], { ...o, dark: 0.3, w: 1.2 });
}
