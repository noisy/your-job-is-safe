// Pipe letters for the plumber scene: a word's single-stroke outline (the engine's plotter font) simplified
// into chunky straight pipe runs with cube joints, merged into one mesh whose `aFlow` attribute runs 0..1
// along the pen path (so the word can assemble itself and then fill with water: psFlowMat).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { strokeText, type StrokeFontName } from '../engine/stroke';
import type { V2 } from '../engine/util';
import { psFlowMat } from '../ps1/gfx';

/** Douglas-Peucker: keep the corners of a polyline, drop points closer than eps to the chord. */
function simplify(pts: V2[], eps: number): V2[] {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0]!, pts[pts.length - 1]!];
  // a closed loop (an o, a 0): split it at the point farthest from its start first
  if (Math.hypot(b.x - a.x, b.y - a.y) < eps) {
    let far = 1, fd = -1;
    pts.forEach((p, i) => { const d = Math.hypot(p.x - a.x, p.y - a.y); if (d > fd) { fd = d; far = i; } });
    if (far > 0 && far < pts.length - 1) return [...simplify(pts.slice(0, far + 1), eps).slice(0, -1), ...simplify(pts.slice(far), eps)];
  }
  let best = -1, bi = 0;
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1e-6;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const d = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / L;
    if (d > best) { best = d; bi = i; }
  }
  if (best < eps) return [a, b];
  return [...simplify(pts.slice(0, bi + 1), eps).slice(0, -1), ...simplify(pts.slice(bi), eps)];
}

export interface PipeWord { mesh: THREE.Mesh; mat: THREE.RawShaderMaterial; width: number; cap: number }

/**
 * Build `text` as pipes, em size `em` world units, pipe radius `r`. The word's left baseline is at the
 * origin, x to the right, y up, pipes in the z = 0 plane.
 */
export function pipeWord(text: string, em: number, r: number, colors: { pipe?: string; water?: string; head?: string } = {}, font: StrokeFontName = 'sans'): PipeWord {
  const st = strokeText(text, font, em, em * 0.08);
  const parts: THREE.BufferGeometry[] = [];
  // flow coordinate = arc length along the pen path, across strokes in drawing order
  const paths = st.strokes.map((s) => simplify(s.map((p) => ({ x: p.x, y: -p.y })), em * 0.035));
  const lens = paths.map((p) => p.slice(1).reduce((a, q, i) => a + Math.hypot(q.x - p[i]!.x, q.y - p[i]!.y), 0));
  const total = lens.reduce((a, b) => a + b, 0) || 1;
  const withFlow = (g: THREE.BufferGeometry, f0: number, f1: number, axisY = true) => {
    const pos = g.attributes.position!;
    const a = new Float32Array(pos.count);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    for (let i = 0; i < pos.count; i++) a[i] = axisY ? f0 + (f1 - f0) * ((pos.getY(i) - lo) / Math.max(1e-6, hi - lo)) : f0;
    g.setAttribute('aFlow', new THREE.BufferAttribute(a, 1));
    g.deleteAttribute('uv');
    return g;
  };
  let acc = 0;
  const up = new THREE.Vector3(0, 1, 0);
  paths.forEach((p, pi) => {
    // a dot (the i's, the !'s): one fitting, so it stays a separate dot instead of a stubby pipe
    const xs = p.map((q) => q.x), ys = p.map((q) => q.y);
    if (Math.max(...xs) - Math.min(...xs) < em * 0.12 && Math.max(...ys) - Math.min(...ys) < em * 0.12) {
      const f0 = acc / total;
      const j = withFlow(new THREE.BoxGeometry(r * 2.9, r * 2.9, r * 2.9), f0, f0, false);
      j.translate((Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2, 0);
      parts.push(j);
      acc += lens[pi]!;
      return;
    }
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i]!, b = p[i + 1]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1e-5) continue;
      const f0 = acc / total, f1 = (acc + len) / total;
      const g = withFlow(new THREE.CylinderGeometry(r, r, len, 6, 1, true), f0, f1);
      const dir = new THREE.Vector3(b.x - a.x, b.y - a.y, 0).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, 0), q, new THREE.Vector3(1, 1, 1)));
      parts.push(g);
      // a joint (fitting) at the start of every run
      const j = withFlow(new THREE.BoxGeometry(r * 2.7, r * 2.7, r * 2.7), f0, f0, false);
      j.translate(a.x, a.y, 0);
      parts.push(j);
      acc += len;
      if (i === p.length - 2) { const e = withFlow(new THREE.BoxGeometry(r * 2.7, r * 2.7, r * 2.7), f1, f1, false); e.translate(b.x, b.y, 0); parts.push(e); }
    }
  });
  const geo = parts.length ? mergeGeometries(parts, false)! : new THREE.BufferGeometry();
  const mat = psFlowMat({ color: colors.pipe ?? '#9AA3B8', fill: colors.water ?? '#3F8CFF', head: colors.head ?? '#E8F6FF' });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, mat, width: st.width, cap: st.capHeight };
}
