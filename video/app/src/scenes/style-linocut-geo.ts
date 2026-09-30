// Geometry shared by the linocut and ascii styles: extruded glyphs (from the fonts' outlines),
// a strawberry, a wine glass with its wine, and a speech-bubble outline. All in world units, y up.
import * as THREE from 'three';
import { layout, ot } from '../engine/type';

type Contour = { path: THREE.Path; pts: THREE.Vector2[]; area: number };

const signedArea = (p: THREE.Vector2[]) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[i]!, r = p[(i + 1) % p.length]!; a += q.x * r.y - r.x * q.y; }
  return a / 2;
};
const inside = (pt: THREE.Vector2, poly: THREE.Vector2[]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
};

/** Outline of one character as THREE shapes (holes resolved), in em units (1 = font size), y up, origin at the pen. */
export function glyphShapes(ch: string, family: string): THREE.Shape[] {
  const cmds = ot(family).charToGlyph(ch).getPath(0, 0, 1).commands;
  const contours: Contour[] = [];
  let cur: THREE.Path | null = null;
  const flush = () => {
    if (!cur) return;
    const pts = cur.getPoints(4);
    if (pts.length > 2) contours.push({ path: cur, pts, area: signedArea(pts) });
    cur = null;
  };
  for (const c of cmds) {
    if (c.type === 'M') { flush(); cur = new THREE.Path(); cur.moveTo(c.x, -c.y); }
    else if (c.type === 'L') cur?.lineTo(c.x, -c.y);
    else if (c.type === 'Q') cur?.quadraticCurveTo(c.x1, -c.y1, c.x, -c.y);
    else if (c.type === 'C') cur?.bezierCurveTo(c.x1, -c.y1, c.x2, -c.y2, c.x, -c.y);
    else if (c.type === 'Z') { cur?.closePath(); flush(); }
  }
  flush();
  if (!contours.length) return [];
  // the largest contour is an outer one: contours wound the same way are outers, the others holes
  const big = contours.reduce((a, b) => (Math.abs(b.area) > Math.abs(a.area) ? b : a));
  const sign = Math.sign(big.area);
  const outers = contours.filter((c) => Math.sign(c.area) === sign);
  const holes = contours.filter((c) => Math.sign(c.area) !== sign);
  const shapes = outers.map((o) => { const s = new THREE.Shape(); s.curves = o.path.curves; s.currentPoint = o.path.currentPoint; return { s, o }; });
  for (const h of holes) {
    const owner = shapes.filter(({ o }) => inside(h.pts[0]!, o.pts)).sort((a, b) => Math.abs(a.o.area) - Math.abs(b.o.area))[0];
    if (owner) owner.s.holes.push(h.path);
  }
  return shapes.map(({ s }) => s);
}

export interface GlyphMesh { ch: string; geo: THREE.ExtrudeGeometry; x: number; w: number }

/**
 * A word as one extruded geometry per glyph (kerned layout), in world units: `size` = em height,
 * `depth` = extrusion toward -z from the face at z = 0. Glyph x positions are relative to the word's
 * centre; the baseline sits at y = 0.
 */
export function extrudeWord(text: string, family: string, size: number, depth: number, opts: { tracking?: number; bevel?: number; curveSegments?: number } = {}): GlyphMesh[] {
  const lay = layout(text, family, 100, (opts.tracking ?? 0) * 100);
  const k = size / 100, total = lay.width * k;
  const out: GlyphMesh[] = [];
  for (const g of lay.glyphs) {
    if (g.ch === ' ') continue;
    const shapes = glyphShapes(g.ch, family);
    const bevel = opts.bevel ?? 0.02;
    const geo = new THREE.ExtrudeGeometry(shapes, { depth: depth / size, bevelEnabled: bevel > 0, bevelThickness: bevel / size, bevelSize: bevel / size, bevelSegments: 2, curveSegments: opts.curveSegments ?? 6 });
    geo.scale(size, size, size);
    geo.translate(0, 0, -depth);
    geo.computeVertexNormals();
    out.push({ ch: g.ch, geo, x: g.x * k - total / 2, w: g.w * k });
  }
  return out;
}

/** Strawberry body (lathe) of height ~1 with its tip at y = 0, max radius ~0.42. */
export function strawberryBody(seg = 64): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const u = i / N; // 0 tip .. 1 top
    // a rounded cone: blunt tip, full shoulders, dimpled top where the calyx sits
    const r = 0.44 * Math.pow(Math.sin(Math.PI * 0.5 * Math.min(1, u * 1.08)), 0.75) * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, u * 0.95 + 0.05))) * (u > 0.9 ? Math.cos((u - 0.9) * 13) * 0.5 + 0.5 : 1);
    const y = u - (u > 0.92 ? (u - 0.92) * 0.9 : 0);
    pts.push(new THREE.Vector2(Math.max(r, 1e-3), y));
  }
  pts[pts.length - 1]!.x = 1e-3;
  const g = new THREE.LatheGeometry(pts, seg);
  g.computeVertexNormals();
  return g;
}

/** The calyx: `n` pointed sepals radiating from the top of the berry, drooping slightly, plus a stem. */
export function strawberryCalyx(n = 7): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const s = new THREE.Shape();
    const L = 0.36 + 0.05 * Math.sin(i * 2.3), Wd = 0.09;
    s.moveTo(0, -Wd * 0.4);
    s.quadraticCurveTo(L * 0.5, -Wd, L, 0);
    s.quadraticCurveTo(L * 0.5, Wd, 0, Wd * 0.4);
    s.lineTo(0, -Wd * 0.4);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false, curveSegments: 6 });
    g.rotateX(-Math.PI / 2);
    // droop: bend the tip down
    const p = g.attributes.position!;
    for (let j = 0; j < p.count; j++) { const x = p.getX(j); p.setY(j, p.getY(j) - 0.35 * x * x); }
    g.rotateY((i / n) * Math.PI * 2 + 0.3);
    g.translate(0, 0.985, 0);
    parts.push(g);
  }
  const stem = new THREE.CylinderGeometry(0.022, 0.03, 0.22, 8);
  stem.rotateZ(0.25);
  stem.translate(0.02, 1.08, 0);
  parts.push(stem);
  const merged = mergeGeometries(parts);
  merged.computeVertexNormals();
  return merged;
}

/** Wine glass profile (outer surface, y up, foot at y = 0): height ~1, rim radius ~0.3 at y = 1. */
export const GLASS = { rim: 1.0, rimR: 0.29, bowlBottom: 0.47, stemR: 0.022, footR: 0.26 };
/** Radius of the bowl's inside at height y (for the wine surface), y in [bowlBottom, rim]. */
export function bowlRadius(y: number) {
  const u = Math.max(0, Math.min(1, (y - GLASS.bowlBottom) / (GLASS.rim - GLASS.bowlBottom)));
  // tulip: widens quickly, fullest at ~60 %, closes in a little toward the rim
  return 0.012 + 0.33 * Math.pow(Math.sin(Math.PI * 0.5 * Math.min(1, u * 1.55)), 0.62) - 0.06 * Math.max(0, u - 0.6) / 0.4;
}
export function wineGlassGeometry(seg = 72): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  pts.push(new THREE.Vector2(0.001, 0));
  pts.push(new THREE.Vector2(GLASS.footR, 0.0));
  pts.push(new THREE.Vector2(GLASS.footR, 0.012));
  pts.push(new THREE.Vector2(0.1, 0.03));
  pts.push(new THREE.Vector2(GLASS.stemR * 1.6, 0.06));
  pts.push(new THREE.Vector2(GLASS.stemR, 0.12));
  pts.push(new THREE.Vector2(GLASS.stemR, GLASS.bowlBottom - 0.05));
  pts.push(new THREE.Vector2(GLASS.stemR * 1.8, GLASS.bowlBottom - 0.01));
  for (let i = 0; i <= 28; i++) {
    const y = GLASS.bowlBottom + (GLASS.rim - GLASS.bowlBottom) * (i / 28);
    pts.push(new THREE.Vector2(bowlRadius(y) + 0.008, y));
  }
  const g = new THREE.LatheGeometry(pts, seg);
  g.computeVertexNormals();
  return g;
}
/** Wine inside the bowl up to height `level` (a solid of revolution with a flat top). */
export function wineGeometry(level: number, seg = 72): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  const y0 = GLASS.bowlBottom + 0.012;
  pts.push(new THREE.Vector2(0.001, y0));
  for (let i = 0; i <= 20; i++) {
    const y = y0 + (level - y0) * (i / 20);
    pts.push(new THREE.Vector2(Math.max(0.002, bowlRadius(y) - 0.004), y));
  }
  pts.push(new THREE.Vector2(0.001, level));
  const g = new THREE.LatheGeometry(pts, seg);
  g.computeVertexNormals();
  return g;
}

/** Rounded-rectangle speech bubble (centred at 0, w x h) with a tail at the bottom-left or bottom-right. */
export function bubbleShape(w: number, h: number, r: number, tail: 'left' | 'right' = 'left'): THREE.Shape {
  const s = new THREE.Shape();
  const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2;
  const tx = tail === 'left' ? x0 + w * 0.16 : x1 - w * 0.16, tw = Math.min(w * 0.12, h * 0.35), td = h * 0.42;
  s.moveTo(x0 + r, y0);
  if (tail === 'left') { s.lineTo(tx - tw * 0.2, y0); s.lineTo(tx - tw * 0.9, y0 - td); s.lineTo(tx + tw, y0); }
  if (tail === 'right') { s.lineTo(tx - tw, y0); s.lineTo(tx + tw * 0.9, y0 - td); s.lineTo(tx + tw * 0.2, y0); }
  s.lineTo(x1 - r, y0);
  s.quadraticCurveTo(x1, y0, x1, y0 + r);
  s.lineTo(x1, y1 - r);
  s.quadraticCurveTo(x1, y1, x1 - r, y1);
  s.lineTo(x0 + r, y1);
  s.quadraticCurveTo(x0, y1, x0, y1 - r);
  s.lineTo(x0, y0 + r);
  s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}

/** Merge non-indexed/indexed geometries with position + normal (+ uv when all have it). */
export function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const n = flat.reduce((a, g) => a + g.attributes.position!.count, 0);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of flat) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position!.array as Float32Array, o * 3);
    nor.set(g.attributes.normal!.array as Float32Array, o * 3);
    o += g.attributes.position!.count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return m;
}
