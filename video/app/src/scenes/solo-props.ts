// solo: the patch-note items: a pixel icon for the list and a low-poly model for the pedestal, each with
// a broken state (the fail) and a fixed state (set by `fix(k)`, k 0..1).
import * as THREE from 'three';
import { makeClock } from '../ps1/cast';
import { pixText, psMat, canvasTex } from '../ps1/gfx';
import { P } from '../ps1/palette';

export interface Item { name: string; model: THREE.Group; fix(k: number, t: number): void; icon(c: CanvasRenderingContext2D, x: number, y: number): void }

const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); return b;
};
const px = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(x, y, w, h); };

export function makeItems(): Item[] {
  const items: Item[] = [];
  // 1. strawberry: the third R lights up
  {
    const g = new THREE.Group();
    const geo = new THREE.IcosahedronGeometry(0.34, 1);
    const p = geo.attributes.position!;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i), k = y < 0 ? 1 + y * 0.9 : 1; p.setXYZ(i, p.getX(i) * k, y * 1.15, p.getZ(i) * k); }
    geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, psMat({ color: '#D8283C' })));
    const leaf = psMat({ color: '#3E8E41' });
    for (let i = 0; i < 5; i++) { const l = box(0.12, 0.03, 0.28, leaf); l.position.set(Math.sin(i * 1.26) * 0.12, 0.36, Math.cos(i * 1.26) * 0.12); l.rotation.y = i * 1.26; g.add(l); }
    const rs = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const t = canvasTex(8, 10, (c) => pixText(c, 'R', 1, 1, '#FFFFFF'));
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.2), psMat({ map: t.tex, unlit: true, color: i === 2 ? P.fail : P.uiLine }));
      m.position.set(-0.22 + i * 0.22, 0.62, 0.1); rs.add(m);
    }
    g.add(rs);
    items.push({
      name: "COUNT R'S", model: g,
      fix(k) { const m = rs.children[2] as THREE.Mesh; ((m.material as THREE.RawShaderMaterial).uniforms.uColor!.value as THREE.Color).set(k > 0.5 ? P.fix : P.fail); m.scale.setScalar(1 + 0.4 * k); },
      icon(c, x, y) { px(c, x + 2, y + 3, 8, 7, '#D8283C'); px(c, x + 3, y + 10, 6, 1, '#D8283C'); px(c, x + 5, y + 11, 2, 1, '#D8283C'); px(c, x + 3, y + 1, 6, 2, '#3E8E41'); px(c, x + 4, y + 5, 1, 1, P.title); px(c, x + 7, y + 7, 1, 1, P.title); },
    });
  }
  // 2. the wine glass: half full → to the brim
  {
    const g = new THREE.Group();
    const prof = [[0.2, 0], [0.2, 0.02], [0.03, 0.04], [0.025, 0.3], [0.05, 0.34], [0.17, 0.4], [0.22, 0.52], [0.22, 0.64], [0.2, 0.74]].map(([r, y]) => new THREE.Vector2(r!, y!));
    const shell = new THREE.Mesh(new THREE.LatheGeometry(prof, 10), psMat({ color: '#9FB8E8', opacity: 0.35, side: THREE.DoubleSide, emit: '#10182A' }));
    shell.renderOrder = 3;
    const wine = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.15, 1, 10), psMat({ color: '#9E1B32', emit: '#200006' }));
    g.add(wine, shell);
    g.position.y = -0.35;
    items.push({
      name: 'FULL GLASS', model: g,
      fix(k) { const top = 0.52 + 0.21 * k, bot = 0.36; wine.scale.y = top - bot; wine.position.y = (top + bot) / 2; },
      icon(c, x, y) { px(c, x + 2, y + 1, 8, 1, '#9FB8E8'); px(c, x + 2, y + 2, 1, 4, '#9FB8E8'); px(c, x + 9, y + 2, 1, 4, '#9FB8E8'); px(c, x + 3, y + 4, 6, 3, '#9E1B32'); px(c, x + 5, y + 7, 2, 3, '#9FB8E8'); px(c, x + 3, y + 10, 6, 1, '#9FB8E8'); },
    });
  }
  // 3. the clock: stuck at 10:10 → ticking
  {
    const g = new THREE.Group();
    const clk = makeClock(0.36);
    g.add(clk.root);
    items.push({
      name: 'READ CLOCK', model: g,
      fix(k, t) { if (k > 0.5) { clk.minute.rotation.z = -t * 3; clk.hour.rotation.z = -t * 0.25; clk.second.rotation.z = -t * 12; } else { clk.hour.rotation.z = -((10 + 10 / 60) / 12) * Math.PI * 2; clk.minute.rotation.z = -(10 / 60) * Math.PI * 2; clk.second.rotation.z = -Math.PI; } },
      icon(c, x, y) { px(c, x + 2, y + 1, 8, 10, P.title); px(c, x + 3, y + 2, 6, 8, '#F3ECDF'); px(c, x + 5, y + 3, 1, 3, P.ink); px(c, x + 3, y + 4, 2, 1, P.ink); px(c, x + 6, y + 4, 2, 1, P.ink); },
    });
  }
  // 4. the hand: six fingers → five
  {
    const g = new THREE.Group();
    const skin = psMat({ color: P.skin });
    g.add(box(0.42, 0.4, 0.12, skin, 0, -0.05, 0));
    const fingers: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) { const f = box(0.06, 0.26, 0.08, skin, -0.18 + i * 0.072, 0.26, 0); fingers.push(f); g.add(f); }
    g.add(box(0.1, 0.2, 0.08, skin, -0.28, 0.0, 0));
    items.push({
      name: 'FIVE FINGERS', model: g,
      fix(k) { fingers[5]!.visible = k < 0.5; for (let i = 0; i < 5; i++) fingers[i]!.position.x = -0.18 + i * (k > 0.5 ? 0.09 : 0.072); },
      icon(c, x, y) { px(c, x + 2, y + 5, 8, 6, P.skin); for (let i = 0; i < 6; i++) px(c, x + 1 + i * 2 - (i > 2 ? 0 : 0), y + 1, 1, 4, P.skin); px(c, x + 11, y + 1, 1, 4, P.fail); },
    });
  }
  // 5. grandma's book of keys: open → patched shut
  {
    const g = new THREE.Group();
    const cover = psMat({ color: '#6B2E4A' });
    const pagesT = canvasTex(32, 24, (c) => { px(c, 0, 0, 32, 24, '#F3ECDF'); for (let r = 0; r < 4; r++) pixText(c, 'XXXX', 3, 2 + r * 6, P.ink); });
    const left = new THREE.Group(), right = new THREE.Group();
    left.add(box(0.36, 0.03, 0.46, cover, -0.18, 0, 0)); right.add(box(0.36, 0.03, 0.46, cover, 0.18, 0, 0));
    const pg = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.42), psMat({ map: pagesT.tex }));
    pg.rotation.x = -Math.PI / 2; pg.position.y = 0.02;
    g.add(left, right, pg);
    g.rotation.x = 0.9;
    items.push({
      name: 'GRANDMA HACK', model: g,
      fix(k) { right.rotation.z = Math.PI * 0.98 * k; pg.visible = k < 0.5; },
      icon(c, x, y) { px(c, x + 1, y + 3, 10, 7, '#6B2E4A'); px(c, x + 2, y + 4, 8, 5, '#F3ECDF'); px(c, x + 6, y + 3, 1, 7, '#6B2E4A'); px(c, x + 3, y + 5, 2, 1, P.ink); px(c, x + 8, y + 6, 1, 1, P.ink); },
    });
  }
  // 6. the calendar stuck at 2021 → today
  {
    const g = new THREE.Group();
    const leaf = (yr: string) => canvasTex(32, 36, (c) => { px(c, 0, 0, 32, 36, '#F3ECDF'); px(c, 0, 0, 32, 10, P.fail); pixText(c, yr, 4, 2, P.uiLine); pixText(c, yr.slice(2), 10, 16, P.ink, 2); }).tex;
    const mat = psMat({ map: leaf('2021') });
    const fixed = leaf('2026');
    g.add(box(0.5, 0.58, 0.05, psMat({ color: '#5A3A24' }), 0, 0, -0.03));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.5), mat); m.position.z = 0.01; g.add(m);
    const old = mat.uniforms.uMap!.value;
    items.push({
      name: '2021 CUTOFF', model: g,
      fix(k) { mat.uniforms.uMap!.value = k > 0.5 ? fixed : old; },
      icon(c, x, y) { px(c, x + 1, y + 1, 10, 10, '#F3ECDF'); px(c, x + 1, y + 1, 10, 3, P.fail); px(c, x + 3, y + 6, 6, 1, P.ink); px(c, x + 3, y + 8, 4, 1, P.ink); },
    });
  }
  // 7. the drive-thru: nuggets pouring → one order
  {
    const g = new THREE.Group();
    g.add(box(0.36, 0.42, 0.26, psMat({ color: '#B5412F' }), 0, 0, 0));
    g.add(box(0.26, 0.1, 0.02, psMat({ color: P.title, unlit: true }), 0, 0.05, 0.14));
    const nug = psMat({ color: '#D9A04A' });
    const nuggets: THREE.Mesh[] = [];
    for (let i = 0; i < 10; i++) { const n = box(0.09, 0.06, 0.07, nug); nuggets.push(n); g.add(n); }
    items.push({
      name: 'DRIVE-THRU', model: g,
      fix(k, t) {
        nuggets.forEach((n, i) => {
          n.visible = k < 0.5 || i === 0;
          const u = (t * 1.2 + i * 0.13) % 1;
          if (k < 0.5) n.position.set(Math.sin(i * 2.4) * 0.3, 0.9 - u * 1.4, Math.cos(i * 1.7) * 0.2 + 0.1);
          else n.position.set(0, 0.28, 0);
        });
      },
      icon(c, x, y) { px(c, x + 2, y + 4, 8, 7, '#B5412F'); px(c, x + 3, y + 6, 6, 1, P.title); px(c, x + 3, y + 1, 2, 2, '#D9A04A'); px(c, x + 7, y + 2, 2, 2, '#D9A04A'); },
    });
  }
  // 8. the robotaxi: circling → driving straight
  {
    const g = new THREE.Group();
    const car = new THREE.Group();
    const white = psMat({ color: '#E8E4D8' }), glass = psMat({ color: '#2A3350' });
    car.add(box(0.5, 0.14, 0.26, white, 0, 0.1, 0), box(0.28, 0.12, 0.24, glass, -0.02, 0.22, 0), box(0.08, 0.06, 0.08, psMat({ color: '#5A6488' }), -0.02, 0.31, 0));
    for (const [x, z] of [[-0.16, 0.13], [0.16, 0.13], [-0.16, -0.13], [0.16, -0.13]] as const) car.add(box(0.1, 0.1, 0.04, psMat({ color: P.ink }), x, 0.04, z));
    g.add(car);
    items.push({
      name: 'ROBOTAXI', model: g,
      fix(k, t) {
        if (k < 0.5) { const a = t * 5; car.position.set(Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22); car.rotation.y = -a - Math.PI / 2; }
        else { car.position.set(((t * 1.5) % 1.2) - 0.6, 0, 0); car.rotation.y = 0; }
      },
      icon(c, x, y) { px(c, x + 1, y + 5, 10, 4, '#E8E4D8'); px(c, x + 3, y + 3, 5, 2, '#2A3350'); px(c, x + 5, y + 2, 1, 1, '#5A6488'); px(c, x + 2, y + 9, 2, 2, P.ink); px(c, x + 8, y + 9, 2, 2, P.ink); },
    });
  }
  return items;
}
