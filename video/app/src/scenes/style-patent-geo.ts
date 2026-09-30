// Patent-drawing geometry: extruded glyphs from the font outlines, speech-bubble tiles, the wine glass
// (a quarter-cutaway section with its liquid), the technical pen and the chatbot's head.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { layout, ot } from '../engine/type';

export interface GlyphGeo { ch: string; x: number; w: number; geo: THREE.ExtrudeGeometry }

/** Each glyph of `text` as an extruded solid (face at z = 0, extruded towards -z), in world units (em = size). */
export function glyphSolids(text: string, family: string, size: number, depth: number, curveSegments = 6): GlyphGeo[] {
  const f = ot(family);
  const lay = layout(text, family, 100);
  const k = size / 100;
  const out: GlyphGeo[] = [];
  for (const g of lay.glyphs) {
    const cmds = f.charToGlyph(g.ch).getPath(0, 0, size).commands;
    const sp = new THREE.ShapePath();
    for (const c of cmds as any[]) {
      if (c.type === 'M') sp.moveTo(c.x, -c.y);
      else if (c.type === 'L') sp.lineTo(c.x, -c.y);
      else if (c.type === 'Q') sp.quadraticCurveTo(c.x1, -c.y1, c.x, -c.y);
      else if (c.type === 'C') sp.bezierCurveTo(c.x1, -c.y1, c.x2, -c.y2, c.x, -c.y);
    }
    const shapes = sp.toShapes();
    const geo = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false, curveSegments });
    geo.translate(0, 0, -depth);
    out.push({ ch: g.ch, x: g.x * k, w: g.w * k, geo });
  }
  return out;
}

/** Rounded-rectangle speech bubble with a tail at the lower left (`tailLeft`) or lower right, centred on its body. */
export function bubbleShape(w: number, h: number, r: number, tailLeft: boolean, tail = 0.5) {
  const s = new THREE.Shape();
  const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2, tw = tail * 1.1;
  s.moveTo(tailLeft ? x0 + r + tw : x0 + r, y0);
  if (!tailLeft) {
    s.lineTo(x1 - r - tw, y0);
    s.lineTo(x1 - r * 0.2, y0 - tail);
    s.lineTo(x1 - r, y0);
  } else s.lineTo(x1 - r, y0);
  s.quadraticCurveTo(x1, y0, x1, y0 + r);
  s.lineTo(x1, y1 - r);
  s.quadraticCurveTo(x1, y1, x1 - r, y1);
  s.lineTo(x0 + r, y1);
  s.quadraticCurveTo(x0, y1, x0, y1 - r);
  s.lineTo(x0, y0 + r);
  s.quadraticCurveTo(x0, y0, x0 + r, y0);
  if (tailLeft) { s.lineTo(x0 + r * 0.2, y0 - tail); s.lineTo(x0 + r + tw, y0); }
  return s;
}

/** A bubble tile lying on the sheet: top face at y = thick, reading along +x, its "down" towards +z. */
export function bubbleTile(w: number, h: number, thick: number, tailLeft: boolean) {
  const geo = new THREE.ExtrudeGeometry(bubbleShape(w, h, Math.min(w, h) * 0.22, tailLeft, h * 0.32), { depth: thick, bevelEnabled: false, curveSegments: 8 });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

// ------------------------------------------------------------------ the wine glass

export interface GlassProfile {
  /** Outer surface (r, y) from the foot's rim up to the lip. */
  outer: THREE.Vector2[];
  /** Inner surface of the bowl from the lip down to the bowl's bottom on the axis. */
  inner: THREE.Vector2[];
  /** Closed half cross-section (r >= 0), for the cut faces. */
  section: THREE.Vector2[];
  rim: number; rimY: number; bottomY: number;
  /** Inner radius at height y (y within the bowl). */
  rAt: (y: number) => number;
}

export function glassProfile(): GlassProfile {
  const V2 = (x: number, y: number) => new THREE.Vector2(x, y);
  const bowl: THREE.Vector2[] = [];
  // bowl outer: from the stem's top (0.1, 1.95) out to the belly (1.18, 3.05) and in to the lip (1.02, 4.35)
  const N = 22;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const y = 1.95 + t * 2.4;
    const belly = Math.sin(Math.min(1, t * 1.35) * Math.PI * 0.5);
    const r = 0.1 + 1.08 * Math.pow(belly, 0.75) - 0.16 * Math.pow(Math.max(0, t - 0.55) / 0.45, 1.6);
    bowl.push(V2(r, y));
  }
  const outer = [V2(1.12, 0), V2(1.12, 0.05), V2(0.5, 0.1), V2(0.14, 0.2), V2(0.085, 0.4), V2(0.08, 1.2), V2(0.085, 1.7), ...bowl];
  const th = 0.06;
  const inner: THREE.Vector2[] = [];
  for (let i = N; i >= 3; i--) inner.push(V2(Math.max(0, bowl[i]!.x - th), bowl[i]!.y));
  const bottomY = 2.18;
  inner.push(V2(0.18, bottomY + 0.03), V2(0, bottomY));
  const section = [V2(0, 0), ...outer, ...inner];
  const rimY = bowl[N]!.y, rim = bowl[N]!.x;
  const rAt = (y: number) => {
    for (let i = 0; i < inner.length - 1; i++) {
      const a = inner[i]!, b = inner[i + 1]!;
      if ((y <= a.y && y >= b.y)) { const u = (y - b.y) / Math.max(1e-6, a.y - b.y); return b.x + (a.x - b.x) * u; }
    }
    return 0;
  };
  return { outer, inner, section, rim, rimY, bottomY, rAt };
}

/** Planar polygon (r, y) placed on the half-plane at azimuth phi around the y axis; uv = (r, y). */
export function sectionFace(pts: THREE.Vector2[], phi: number) {
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts), 1);
  const P = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = new Float32Array(P.count * 2);
  const s = Math.sin(phi), c = Math.cos(phi);
  for (let i = 0; i < P.count; i++) {
    const r = P.getX(i), y = P.getY(i);
    uv[i * 2] = r; uv[i * 2 + 1] = y;
    P.setXYZ(i, r * s, y, r * c);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ props

/** Technical pen: tip at the origin, body along +y. */
export function penGeometry() {
  const parts = [
    new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8, 1).translate(0, 0.08, 0),
    new THREE.CylinderGeometry(0.05, 0.02, 0.22, 16, 1).translate(0, 0.27, 0),
    new THREE.CylinderGeometry(0.075, 0.07, 0.35, 20, 1).translate(0, 0.555, 0),
    new THREE.CylinderGeometry(0.09, 0.09, 1.25, 20, 1).translate(0, 1.355, 0),
    new THREE.CylinderGeometry(0.095, 0.095, 0.06, 20, 1).translate(0, 2.0, 0),
  ].map((g) => g.toNonIndexed());
  return mergeGeometries(parts)!;
}

/** The chatbot: a rounded box head with an antenna (eyes and mouth are inked separately). */
export function botHeadGeometry() {
  const head = new RoundedBoxGeometry(1.0, 0.8, 0.8, 3, 0.16).translate(0, 0.4, 0).toNonIndexed();
  const neck = new THREE.CylinderGeometry(0.03, 0.03, 0.28, 8, 1).translate(0, 0.94, 0).toNonIndexed();
  const ball = new THREE.SphereGeometry(0.08, 14, 8).translate(0, 1.1, 0).toNonIndexed();
  const g = mergeGeometries([head, neck, ball].map((x) => { x.deleteAttribute('uv'); return x; }))!;
  return g;
}
