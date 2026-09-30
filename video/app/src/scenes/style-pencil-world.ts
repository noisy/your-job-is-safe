// Pencil animatic: the drawn 3D world. Objects are real 3D (extruded block letters, a revolved wine
// glass, boxes) and are drawn the way a storyboard artist would: silhouettes and contours from the
// camera's point of view, hidden sides left out, hatching by how much a face turns from the light.
import * as THREE from 'three';
import { textPathCommands } from '../engine/type';
import { strokeText, type StrokeFontName, type StrokeText } from '../engine/stroke';
import { type V2, clamp, lerp } from '../engine/util';
import { type Pen, type StrokeOpts, hatchPoly, GRAPHITE, BLUE } from './style-pencil-pen';

const V = THREE.Vector3;
const tmp = new V();

/** Project a world point to virtual px (1920x1080, y down); null behind the camera. */
export function proj(cam: THREE.Camera, p: THREE.Vector3): V2 | null {
  tmp.copy(p).applyMatrix4(cam.matrixWorldInverse);
  if (tmp.z > -0.05) return null;
  tmp.applyMatrix4((cam as THREE.PerspectiveCamera).projectionMatrix);
  return { x: (tmp.x * 0.5 + 0.5) * 1920, y: (0.5 - tmp.y * 0.5) * 1080 };
}
export function projAll(cam: THREE.Camera, pts: THREE.Vector3[]): V2[] | null {
  const out: V2[] = [];
  for (const p of pts) { const q = proj(cam, p); if (!q) return null; out.push(q); }
  return out;
}
/** Draw a 3D polyline (skips it if any point is behind the camera). */
export function line3(pen: Pen, cam: THREE.Camera, pts: THREE.Vector3[], o: StrokeOpts) {
  const q = projAll(cam, pts);
  if (q) pen.line(q, o);
}
/** A circle in 3D (centre, radius, plane normal) as a polyline. */
export function circle3(c: THREE.Vector3, r: number, n: THREE.Vector3, seg = 48, a0 = 0, a1 = Math.PI * 2): THREE.Vector3[] {
  const u = new V().crossVectors(n, Math.abs(n.y) < 0.9 ? new V(0, 1, 0) : new V(1, 0, 0)).normalize();
  const w = new V().crossVectors(n, u).normalize();
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = lerp(a0, a1, i / seg);
    out.push(new V().copy(c).addScaledVector(u, Math.cos(a) * r).addScaledVector(w, Math.sin(a) * r));
  }
  return out;
}

// ---------------------------------------------------------------- text on a plane

export interface PlaneText { st: StrokeText; o: THREE.Vector3; right: THREE.Vector3; down: THREE.Vector3; k: number }
/** A stroke-font string laid on a 3D plane: `size` world units per em, origin = left baseline. */
export function planeText(text: string, font: StrokeFontName, size: number, o: THREE.Vector3, right: THREE.Vector3, down: THREE.Vector3): PlaneText {
  const st = strokeText(text, font, 100);
  return { st, o, right: right.clone().normalize(), down: down.clone().normalize(), k: size / 100 };
}
export function planePoint(pt: PlaneText, x: number, y: number) {
  return new V().copy(pt.o).addScaledVector(pt.right, x * pt.k).addScaledVector(pt.down, y * pt.k);
}
/** Draw the first `len` (stroke-font px) of a plane text. Returns the pen head in virtual px. */
export function drawPlaneText(pen: Pen, cam: THREE.Camera, pt: PlaneText, len: number, o: StrokeOpts): V2 | null {
  let head: V2 | null = null;
  const st = pt.st;
  for (let i = 0; i < st.strokes.length; i++) {
    const s0 = st.startLen[i]!;
    if (s0 >= len) break;
    const pts = st.strokes[i]!, L = st.lens[i]!;
    const remain = len - s0;
    const q: V2[] = [];
    for (let j = 0; j < pts.length; j++) {
      let p = pts[j]!;
      if (L[j]! > remain) {
        const a = pts[j - 1]!, u = (remain - L[j - 1]!) / Math.max(1e-6, L[j]! - L[j - 1]!);
        p = { x: lerp(a.x, p.x, u), y: lerp(a.y, p.y, u) };
        const v = proj(cam, planePoint(pt, p.x, p.y));
        if (v) q.push(v);
        break;
      }
      const v = proj(cam, planePoint(pt, p.x, p.y));
      if (v) q.push(v);
    }
    if (q.length === 1) q.push({ x: q[0]!.x + 0.5, y: q[0]!.y });
    pen.line(q, { ...o, seed: (o.seed ?? 0) + i * 0.71, taper: 4 });
    head = q[q.length - 1] ?? head;
  }
  return head;
}

// ---------------------------------------------------------------- block letters

interface Contour { pts: V2[]; hole: boolean; ccw: boolean }
export interface Block {
  contours: Contour[];
  /** Local frame: letter front at z = 0, back at z = -depth; x right, y up. */
  depth: number;
  x0: number; x1: number; y0: number; y1: number;
}

function flatten(cmds: ReturnType<typeof textPathCommands>, k: number): V2[][] {
  const out: V2[][] = [];
  let cur: V2[] = [];
  let px = 0, py = 0;
  const push = (x: number, y: number) => { cur.push({ x: x * k, y: -y * k }); px = x; py = y; };
  for (const c of cmds) {
    if (c.type === 'M') { if (cur.length > 2) out.push(cur); cur = []; push(c.x, c.y); }
    else if (c.type === 'L') push(c.x, c.y);
    else if (c.type === 'Q') { const x0 = px, y0 = py; for (let i = 1; i <= 6; i++) { const t = i / 6, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, d = t * t; push(a * x0 + b * c.x1 + d * c.x, a * y0 + b * c.y1 + d * c.y); } }
    else if (c.type === 'C') { const x0 = px, y0 = py; for (let i = 1; i <= 8; i++) { const t = i / 8, a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, d = 3 * (1 - t) * t * t, e = t ** 3; push(a * x0 + b * c.x1 + d * c.x2 + e * c.x, a * y0 + b * c.y1 + d * c.y2 + e * c.y); } }
    else if (c.type === 'Z') { if (cur.length > 2) out.push(cur); cur = []; }
  }
  if (cur.length > 2) out.push(cur);
  // drop the closing duplicate
  for (const p of out) { const a = p[0]!, b = p[p.length - 1]!; if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) p.pop(); }
  return out;
}
const area = (p: V2[]) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i]!, b = p[(i + 1) % p.length]!; s += a.x * b.y - b.x * a.y; } return s / 2; };
function inside(pt: V2, poly: V2[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** A glyph of a font as an extruded block, `h` world units tall (cap height ~ h). */
export function blockGlyph(ch: string, family: string, h: number, depth: number): Block {
  const size = 100;
  const raw = flatten(textPathCommands(ch, family, size, 0, 0), 1);
  let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity;
  for (const c of raw) for (const p of c) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const k = h / Math.max(1e-3, y1 - Math.max(0, y0) || 1);
  const cs = raw.map((pts) => pts.map((p) => ({ x: (p.x - x0) * k, y: p.y * k })));
  const contours: Contour[] = cs.map((pts, i) => {
    let depthN = 0;
    for (let j = 0; j < cs.length; j++) if (j !== i && inside(pts[0]!, cs[j]!)) depthN++;
    return { pts, hole: depthN % 2 === 1, ccw: area(pts) > 0 };
  });
  return { contours, depth, x0: 0, x1: (x1 - x0) * k, y0: y0 * k, y1: y1 * k };
}

export interface BlockDraw {
  /** Local-to-world matrix of the letter. */
  m: THREE.Matrix4;
  cam: THREE.PerspectiveCamera;
  /** 0..1: how much of the letter is drawn (front outline, then the extrusion and the shading). */
  prog: number;
  light: THREE.Vector3;
  weight: number;
  seed: number;
  /** Blue construction box before (and under) the drawing. */
  construct: number;
}

/** Draw an extruded letter: front face outline, visible sides, back edges, silhouette corners, side hatching. */
export function drawBlock(pen: Pen, b: Block, d: BlockDraw) {
  const { m, cam } = d;
  const camLocal = cam.position.clone().applyMatrix4(new THREE.Matrix4().copy(m).invert());
  const W = (x: number, y: number, z: number) => new V(x, y, z).applyMatrix4(m);
  // the construction box (blue): the letter's bounding block in perspective
  if (d.construct > 0) {
    const c = [W(b.x0, b.y0, 0), W(b.x1, b.y0, 0), W(b.x1, b.y1, 0), W(b.x0, b.y1, 0), W(b.x0, b.y0, -b.depth), W(b.x1, b.y0, -b.depth), W(b.x1, b.y1, -b.depth), W(b.x0, b.y1, -b.depth)];
    const o = { ch: BLUE as 0 | 1 | 2, w: 1.8, dark: 0.45 * d.construct, passes: 2, over: 14, seed: d.seed };
    const E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    E.forEach(([i, j], n) => line3(pen, cam, [c[i]!, c[j]!], { ...o, seed: d.seed + n }));
  }
  if (d.prog <= 0) return;
  const pFront = clamp(d.prog / 0.55), pSide = clamp((d.prog - 0.35) / 0.65);
  const front = camLocal.z > 0;
  const wt = d.weight;
  // a light tone over the front faces (counters left open)
  if (front && pFront > 0.8) {
    const polys = b.contours.map((c) => projAll(cam, c.pts.map((p) => W(p.x, p.y, 0)))).filter((q): q is V2[] => !!q);
    const segs = hatchPoly(polys, 6.5, 1.05);
    segs.forEach(([a, q], i) => pen.line([a, q], { w: 1.2, dark: 0.16 * wt * clamp((pFront - 0.8) * 5), passes: 1, jit: 0.7, taper: 3, seed: d.seed + i * 0.3 }));
  }
  let si = 0;
  for (const c of b.contours) {
    const n = c.pts.length;
    // outward normal of each side face
    const out = c.ccw !== c.hole ? 1 : -1;
    const vis: boolean[] = [];
    const nrm: V2[] = [];
    for (let i = 0; i < n; i++) {
      const a = c.pts[i]!, q = c.pts[(i + 1) % n]!;
      const dx = q.x - a.x, dy = q.y - a.y, l = Math.hypot(dx, dy) || 1;
      const nx = (dy / l) * out, ny = (-dx / l) * out;
      nrm.push({ x: nx, y: ny });
      const mx = (a.x + q.x) / 2, my = (a.y + q.y) / 2;
      vis.push(nx * (camLocal.x - mx) + ny * (camLocal.y - my) > 0);
    }
    // front outline, written around the contour
    if (front) {
      const pts = [...c.pts, c.pts[0]!].map((p) => W(p.x, p.y, 0));
      const q = projAll(cam, pts);
      if (q) {
        let L = 0; for (let i = 1; i < q.length; i++) L += Math.hypot(q[i]!.x - q[i - 1]!.x, q[i]!.y - q[i - 1]!.y);
        pen.line(q, { w: 2.8 * wt, dark: 0.75 * wt, passes: 2, jit: 1.4, seed: d.seed + si * 3.1, len: L * pFront, over: 6 });
      }
    }
    if (pSide > 0) {
      const light = d.light;
      // back outline: only where the side face in front of it is seen
      for (let i = 0; i < n; i++) {
        if (!vis[i]) continue;
        const a = c.pts[i]!, q = c.pts[(i + 1) % n]!;
        if ((i + 0.5) / n > pSide) continue;
        line3(pen, cam, [W(a.x, a.y, -b.depth), W(q.x, q.y, -b.depth)], { w: 1.9 * wt, dark: 0.42 * wt, passes: 1, jit: 1.2, seed: d.seed + i * 0.37 + si });
      }
      // depth edges at corners and at the silhouette
      for (let i = 0; i < n; i++) {
        const prev = (i + n - 1) % n;
        const a = nrm[prev]!, q = nrm[i]!;
        const turn = a.x * q.x + a.y * q.y;
        const silh = vis[prev] !== vis[i];
        if (!(silh || (turn < 0.8 && (vis[prev] || vis[i])))) continue;
        if (i / n > pSide) continue;
        const p = c.pts[i]!;
        line3(pen, cam, [W(p.x, p.y, 0), W(p.x, p.y, -b.depth)], { w: (silh ? 2.2 : 1.7) * wt, dark: (silh ? 0.55 : 0.38) * wt, passes: 1, jit: 1.1, seed: d.seed + i * 0.91 + si, over: 3 });
      }
      // hatch the visible sides by how far they turn from the light
      let acc = 0;
      const spacingBase = 0.11 * (b.y1 - b.y0);
      for (let i = 0; i < n; i++) {
        const a = c.pts[i]!, q = c.pts[(i + 1) % n]!;
        const l = Math.hypot(q.x - a.x, q.y - a.y);
        if (!vis[i] || (i + 0.5) / n > pSide) { acc += l; continue; }
        const nn = nrm[i]!;
        const shade = clamp(0.65 - (nn.x * light.x + nn.y * light.y) * 0.7);
        if (shade < 0.2) { acc += l; continue; }
        const sp = spacingBase * lerp(1.1, 0.3, shade);
        let s = Math.ceil(acc / sp) * sp - acc;
        for (; s < l; s += sp) {
          const u = s / l, x = lerp(a.x, q.x, u), y = lerp(a.y, q.y, u);
          line3(pen, cam, [W(x, y, -0.02), W(x, y, -b.depth + 0.02)], { w: 1.5, dark: 0.6 * shade * wt, passes: 1, jit: 0.8, seed: d.seed + s * 13 + i });
        }
        acc += l;
      }
    }
    si++;
  }
}

// ---------------------------------------------------------------- the wine glass

export interface Glass {
  /** Bowl radius as a function of height (0 = bottom of bowl, 1 = rim), in world units. */
  r: (u: number) => number;
  bowlY0: number; bowlY1: number; stemY0: number; footR: number;
  wineU: number;
}
export function makeGlass(): Glass {
  const R = 0.62;
  // a tulip bowl: round at the bottom, widest a little above the middle, closing in towards the rim
  const r = (u: number) => R * Math.pow(Math.sin((Math.PI / 2) * clamp(u / 0.6)), 0.55) * (1 - 0.16 * Math.pow(clamp((u - 0.6) / 0.4), 1.4));
  return { r, bowlY0: 1.05, bowlY1: 2.35, stemY0: 0.06, footR: 0.55, wineU: 0.48 };
}
/** Silhouette of a surface of revolution (y axis at `c`) seen from `camPos`: left and right curves. */
export function revolveSilhouette(g: Glass, c: THREE.Vector3, camPos: THREE.Vector3, u0: number, u1: number, N = 28): [THREE.Vector3[], THREE.Vector3[]] {
  const L: THREE.Vector3[] = [], Rr: THREE.Vector3[] = [];
  const Cx = camPos.x - c.x, Cz = camPos.z - c.z;
  const rho = Math.hypot(Cx, Cz), phi = Math.atan2(Cz, Cx);
  const H = g.bowlY1 - g.bowlY0;
  for (let i = 0; i <= N; i++) {
    const u = lerp(u0, u1, i / N);
    const y = g.bowlY0 + u * H;
    const r = g.r(u), du = 1e-3;
    const dr = (g.r(Math.min(1, u + du)) - g.r(Math.max(0, u - du))) / ((Math.min(1, u + du) - Math.max(0, u - du)) * H);
    const k = clamp((r - (y + c.y - camPos.y) * dr) / Math.max(1e-4, rho), -1, 1);
    const a = Math.acos(k);
    const t1 = phi + a, t2 = phi - a;
    L.push(new V(c.x + Math.cos(t1) * r, c.y + y, c.z + Math.sin(t1) * r));
    Rr.push(new V(c.x + Math.cos(t2) * r, c.y + y, c.z + Math.sin(t2) * r));
  }
  return [L, Rr];
}

/** Hatch a region given as a projected polygon. */
export function hatchRegion(pen: Pen, poly: V2[] | null, spacing: number, angle: number, o: StrokeOpts) {
  if (!poly) return;
  const segs = hatchPoly(poly, spacing, angle);
  segs.forEach(([a, b], i) => pen.line([a, b], { passes: 1, jit: 0.9, taper: 4, ...o, seed: (o.seed ?? 0) + i * 0.53 }));
}

// ---------------------------------------------------------------- boxes

/** Visible edges of an oriented box (centre, half sizes, local-to-world rotation). */
export function drawBox(pen: Pen, cam: THREE.PerspectiveCamera, m: THREE.Matrix4, hs: THREE.Vector3, o: StrokeOpts, hidden?: StrokeOpts) {
  const inv = new THREE.Matrix4().copy(m).invert();
  const cl = cam.position.clone().applyMatrix4(inv);
  const P = (sx: number, sy: number, sz: number) => new V(sx * hs.x, sy * hs.y, sz * hs.z).applyMatrix4(m);
  const faces: [THREE.Vector3, number[][]][] = [
    [new V(1, 0, 0), [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]], [new V(-1, 0, 0), [[-1, -1, -1], [-1, 1, -1], [-1, 1, 1], [-1, -1, 1]]],
    [new V(0, 1, 0), [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]]], [new V(0, -1, 0), [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
    [new V(0, 0, 1), [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]], [new V(0, 0, -1), [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]]],
  ];
  const edgeVis = new Map<string, boolean>();
  for (const [nrm, cs] of faces) {
    const fc = new V(nrm.x * hs.x, nrm.y * hs.y, nrm.z * hs.z);
    const visible = nrm.dot(new V().subVectors(cl, fc)) > 0;
    for (let i = 0; i < 4; i++) {
      const a = cs[i]!, b = cs[(i + 1) % 4]!;
      const key = [a.join(','), b.join(',')].sort().join('|');
      edgeVis.set(key, (edgeVis.get(key) ?? false) || visible);
    }
  }
  let n = 0;
  for (const [key, vis] of edgeVis) {
    const [a, b] = key.split('|').map((s) => s.split(',').map(Number));
    if (!vis && !hidden) continue;
    line3(pen, cam, [P(a![0]!, a![1]!, a![2]!), P(b![0]!, b![1]!, b![2]!)], { ...(vis ? o : hidden!), seed: (o.seed ?? 0) + n++ * 1.9 });
  }
}

export { GRAPHITE };
