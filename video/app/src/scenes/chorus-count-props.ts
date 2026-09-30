// Props for chorus-count: the giant low-poly strawberry and the wine glass whose fill level can be set
// (the chorus's half-full glass, and the final chorus's glass filling to the brim and overflowing).
import * as THREE from 'three';
import { psMat, canvasTex, rng, shade } from '../ps1/gfx';
import { P } from '../ps1/palette';
import { lerp, clamp, hash } from '../engine/util';

export function makeStrawberry() {
  const root = new THREE.Group();
  const R = rng(3);
  const skinT = canvasTex(32, 32, (c) => {
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { c.fillStyle = shade('#D8283C', 0.9 + R() * 0.14); c.fillRect(x, y, 1, 1); }
    for (let y = 2; y < 32; y += 6) for (let x = (y / 6) % 2 ? 1 : 4; x < 32; x += 6) { c.fillStyle = '#F4D35E'; c.fillRect(x, y, 2, 2); c.fillStyle = '#8E1A2A'; c.fillRect(x, y + 2, 2, 1); }
  }, true).tex;
  const g = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
  const p = g.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const u = (y + 1) / 2;
    const r = u > 0.66 ? lerp(1, 0.62, (u - 0.66) / 0.34) : lerp(0.12, 1, Math.pow(u / 0.66, 0.75));
    p.setXYZ(i, x * r, y * 1.12, z * r);
  }
  const uvA = g.attributes.uv!; for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i) * 3, uvA.getY(i) * 3);
  g.computeVertexNormals();
  root.add(new THREE.Mesh(g, psMat({ map: skinT })));
  const leafM = psMat({ color: '#3E8E41', side: THREE.DoubleSide });
  for (let i = 0; i < 6; i++) {
    const piv = new THREE.Object3D(); piv.position.set(0, 1.02, 0); piv.rotation.y = (i / 6) * Math.PI * 2;
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.8, 3), leafM);
    leaf.scale.set(1, 1, 0.3); leaf.rotation.x = Math.PI / 2 - 0.25; leaf.position.set(0, 0.02, 0.36);
    piv.add(leaf); root.add(piv);
  }
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.4, 5), leafM); stem.position.set(0, 1.2, 0); stem.rotation.z = 0.3;
  root.add(stem);
  return root;
}

/** Glass profile (radius, height) before scaling by S. */
const PROF: [number, number][] = [[0.34, 0.0], [0.34, 0.03], [0.06, 0.05], [0.04, 0.12], [0.04, 0.42], [0.08, 0.5], [0.24, 0.58], [0.33, 0.72], [0.34, 0.88], [0.31, 1.05], [0.29, 1.14]];
const bowlR = (y: number) => {
  for (let i = 5; i < PROF.length - 1; i++) {
    const [r0, y0] = PROF[i]!, [r1, y1] = PROF[i + 1]!;
    if (y <= y1) return lerp(r0, r1, clamp((y - y0) / (y1 - y0)));
  }
  return PROF[PROF.length - 1]![0];
};
export const GLASS_S = 1.5;
export const WINE_BOTTOM = 0.5, RIM = 1.14;

export interface WineGlass {
  root: THREE.Group;
  /** Set the wine level (object-space height before scaling: 0.5 = empty, 1.14 = the brim) and the overflow (0..1) at time t. */
  fill(level: number, overflow: number, t: number, slosh?: number): void;
  brim: THREE.Group; bracket: THREE.Group; pedestal: THREE.Mesh;
  /** World-space-ready local heights (scaled) of the rim and of a level. */
  rimY: number; levelY(level: number): number;
}

/** The chorus wine glass on its pedestal, with the BRIM ring and the GAP bracket (hidden by default). */
export function makeWineGlass(): WineGlass {
  const S = GLASS_S;
  const root = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.LatheGeometry(PROF.map(([r, y]) => new THREE.Vector2(r * S, y * S)), 10), psMat({ color: '#9FB8E8', opacity: 0.32, side: THREE.DoubleSide, emit: '#10182A' }));
  shell.renderOrder = 3;
  // wine bodies for 28 levels (the level picks one; the top disc sits on it)
  const wineM = psMat({ color: '#9E1B32', side: THREE.DoubleSide });
  const LV = 28;
  const wines: THREE.Mesh[] = [];
  for (let k = 0; k < LV; k++) {
    const top = lerp(0.56, RIM, k / (LV - 1));
    const pts: THREE.Vector2[] = [new THREE.Vector2(0, WINE_BOTTOM * S)];
    const n = 6;
    for (let j = 0; j <= n; j++) { const y = lerp(0.51, top, j / n); pts.push(new THREE.Vector2((bowlR(y) - 0.012) * S, y * S)); }
    const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 10), wineM);
    m.visible = false; wines.push(m); root.add(m);
  }
  const wineTop = new THREE.Mesh(new THREE.CircleGeometry(1, 10), psMat({ color: '#C8283F', emit: '#300008', side: THREE.DoubleSide }));
  wineTop.rotation.x = -Math.PI / 2;
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 0.6, 8), psMat({ color: '#5A6488' }));
  pedestal.position.y = -0.3;
  const brim = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.29 * S + 0.06, 0.035, 4, 16), psMat({ color: P.title, emit: '#6A5010' }));
  ring.rotation.x = Math.PI / 2; ring.position.y = RIM * S;
  brim.add(ring);
  const brM = psMat({ color: P.fail, emit: '#400010' });
  const gx = 0.29 * S + 0.22, y0 = 0.8 * S, y1 = RIM * S;
  const bracket = new THREE.Group();
  const vbar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1, 0.04), brM);
  const t0 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.04), brM);
  const t1 = t0.clone();
  bracket.add(vbar, t0, t1);
  bracket.userData = { gx, vbar, t0, t1 };
  bracket.visible = false;
  // overflow: streams running down the outside of the bowl, and drops falling from the base
  const streamM = psMat({ color: '#B0203A', emit: '#200006' });
  const streams: THREE.Mesh[] = [];
  for (let i = 0; i < 7; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1, 0.07), streamM); s.visible = false; streams.push(s); root.add(s); }
  root.add(wineTop, pedestal, shell, brim, bracket);
  const levelY = (lv: number) => lv * S;
  return {
    root, brim, bracket, pedestal, rimY: RIM * S, levelY,
    fill(level, overflow, t, slosh = 0) {
      const lv = clamp(level, 0.56, RIM);
      const k = Math.round(((lv - 0.56) / (RIM - 0.56)) * (LV - 1));
      wines.forEach((m, i) => (m.visible = i === k));
      const top = lerp(0.56, RIM, k / (LV - 1));
      wineTop.position.y = top * S + (overflow > 0 ? 0.03 * overflow : 0);
      wineTop.scale.setScalar(bowlR(top) * S * (overflow > 0 ? 1 + 0.12 * overflow : 1));
      wineTop.rotation.set(-Math.PI / 2 + slosh, 0, slosh * 0.5);
      // the GAP bracket spans the level to the rim
      const d = bracket.userData as { gx: number; vbar: THREE.Mesh; t0: THREE.Mesh; t1: THREE.Mesh };
      d.vbar.position.set(d.gx, (top * S + y1) / 2, 0); d.vbar.scale.y = Math.max(0.01, y1 - top * S);
      d.t0.position.set(d.gx - 0.05, top * S, 0); d.t1.position.set(d.gx - 0.05, y1, 0);
      // overflow streams: each runs down from the rim along the outside of the bowl, growing with `overflow`
      streams.forEach((s, i) => {
        const on = overflow > (i / streams.length) * 0.6;
        s.visible = on;
        if (!on) return;
        const a = (i / streams.length) * Math.PI * 2 + 0.4;
        const len = clamp((overflow - (i / streams.length) * 0.6) * 2.2, 0, 1) * (0.85 * S);
        const wob = 0.02 * Math.sin(t * 9 + i * 2.1) * (hash(i, 3) + 0.5);
        const r = (bowlR(0.98) + 0.03) * S;
        s.position.set(Math.cos(a) * r, RIM * S - len / 2, Math.sin(a) * r);
        s.scale.set(1 + wob * 8, Math.max(0.01, len), 1);
      });
      void y0;
    },
  };
}
