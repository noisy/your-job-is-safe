// Props for `chorus-sleep`: DEV's bed, the dream bubble, the dream table with the wind-up toy chatbot, the
// wooden alphabet blocks, the brass plaque (engraved / rewritten), the mallet, the MINE trophy and the stage
// that DEV's room turns out to stand on. Floor y = 0.
import * as THREE from 'three';
import { psMat, canvasTex, pixText, textW, rng, shade, ADV } from '../ps1/gfx';
import { makeBotHead } from '../ps1/cast';
import { P } from '../ps1/palette';

const box = (w: number, h: number, d: number, m: THREE.Material | THREE.Material[]) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

export function makeBed() {
  const root = new THREE.Group();
  const wood = psMat({ color: '#5A3620' }), sheet = psMat({ color: '#E3DCCB' });
  const R = rng(3);
  const quilt = psMat({ map: canvasTex(16, 16, (c) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { c.fillStyle = shade(((x >> 2) + (y >> 2)) & 1 ? '#3B5C9A' : '#2E4A8C', 0.92 + R() * 0.1); c.fillRect(x, y, 1, 1); }
  }).tex });
  const frame = box(1.2, 0.3, 2.1, wood); frame.position.y = 0.25;
  const head = box(1.3, 1.0, 0.1, wood); head.position.set(0, 0.5, -1.05);
  const foot = box(1.3, 0.55, 0.1, wood); foot.position.set(0, 0.28, 1.05);
  const mattress = box(1.1, 0.18, 2.0, sheet); mattress.position.y = 0.47;
  const pillow = box(0.7, 0.12, 0.35, sheet); pillow.position.set(0, 0.62, -0.78);
  const blanket = box(1.16, 0.2, 1.3, quilt); blanket.position.set(0, 0.64, 0.32);
  root.add(frame, head, foot, mattress, pillow, blanket);
  return { root, blanket };
}

/** A dream cloud: overlapping unlit blobs (DoubleSide, so the camera can dive through it). */
export function makeCloud(r = 1.4, col = '#EEF2FA', opacity = 0.96) {
  const root = new THREE.Group();
  const m = psMat({ color: col, unlit: true, opacity, side: THREE.DoubleSide, fog: 0.2 });
  const blobs: [number, number, number, number][] = [[0, 0, 0, 1], [-0.62, -0.12, 0.05, 0.72], [0.66, -0.08, 0, 0.78], [-0.28, 0.34, -0.05, 0.7], [0.34, 0.36, 0, 0.66], [0, -0.3, 0.1, 0.7]];
  for (const [x, y, z, s] of blobs) {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r * s * 0.62, 1), m);
    b.position.set(x * r, y * r * 0.8, z * r); b.scale.set(1, 0.78, 0.7);
    root.add(b);
  }
  return { root, mat: m };
}

/** One bitmap character as a small quad texture (dream letters). */
const charCache = new Map<string, THREE.Texture>();
export function charTex(ch: string, fg: string, shadowCol: string) {
  const k = ch + fg + shadowCol;
  let t = charCache.get(k);
  if (!t) { t = canvasTex(8, 10, (c) => pixText(c, ch, 1, 1, fg, 1, shadowCol ? { shadow: shadowCol } : {})).tex; charCache.set(k, t); }
  return t;
}

// ---------------------------------------------------------------- the dream table and its toy
export function makeDreamSet() {
  const root = new THREE.Group();
  const R = rng(13);
  // a starry dome
  const sky = canvasTex(256, 128, (c) => {
    c.fillStyle = '#16204A'; c.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 260; i++) { c.fillStyle = R() > 0.7 ? P.title : '#E8E4D8'; c.fillRect(Math.floor(R() * 256), Math.floor(R() * 128), 1, 1); }
  }, true).tex;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(14, 12, 8), psMat({ map: sky, unlit: true, side: THREE.BackSide, fog: 0 }));
  root.add(dome);
  const woodT = canvasTex(32, 32, (c) => { for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { c.fillStyle = shade('#8A5A34', 0.85 + 0.15 * Math.abs(Math.sin(x * 0.7 + Math.sin(y * 0.2) * 3)) + R() * 0.05); c.fillRect(x, y, 1, 1); } }).tex;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.7, 0.14, 16), psMat({ map: woodT }));
  top.position.y = 0.9; root.add(top);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 0.9, 8), psMat({ color: '#5A3620' })); leg.position.y = 0.45; root.add(leg);
  // a spotlight pool
  const pool = new THREE.Mesh(new THREE.CircleGeometry(2.2, 16), psMat({ color: '#FFE9B8', unlit: true, opacity: 0.18, depthWrite: false }));
  pool.rotation.x = -Math.PI / 2; pool.position.y = 0.975; root.add(pool);
  return { root, tableY: 0.97 };
}

/** The wind-up toy chatbot: the CRT head on a tin body with a key and tiny feet, three juggling balls. */
export function makeToyBot(version: string) {
  const root = new THREE.Group();
  const tin = psMat({ color: '#C84A3A' }), dark = psMat({ color: '#6E2A22' }), metal = psMat({ color: '#B8B8C8' });
  const body = box(0.44, 0.4, 0.34, tin); body.position.y = 0.3;
  const band = box(0.46, 0.06, 0.36, psMat({ color: P.title })); band.position.y = 0.36;
  const feet = [-0.12, 0.12].map((x) => { const f = box(0.14, 0.1, 0.22, dark); f.position.set(x, 0.05, 0.04); root.add(f); return f; });
  const keyPiv = new THREE.Object3D(); keyPiv.position.set(0, 0.32, -0.2);
  const shaft = box(0.04, 0.04, 0.14, metal); shaft.position.z = -0.06;
  const bow = box(0.26, 0.12, 0.03, metal); bow.position.z = -0.14;
  keyPiv.add(shaft, bow);
  const head = makeBotHead(version);
  head.root.scale.setScalar(0.62); head.root.position.y = 0.5;
  const arms = [-1, 1].map((s) => {
    const piv = new THREE.Object3D(); piv.position.set(s * 0.26, 0.44, 0);
    const a = box(0.08, 0.26, 0.08, tin); a.position.y = -0.12; piv.add(a);
    const h = box(0.1, 0.08, 0.1, metal); h.position.y = -0.27; piv.add(h);
    root.add(piv); return piv;
  });
  root.add(body, band, keyPiv, head.root);
  const balls = [P.title, P.bot, P.fix].map((c) => { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), psMat({ color: c })); root.add(b); return b; });
  return { root, head, key: keyPiv, arms, feet, balls };
}

/** Wooden alphabet block faces: a coloured face, bone border, the letter in ink at 2x. */
const blockCache = new Map<string, THREE.Material>();
const BLOCK_COLS = ['#D9482B', '#2E6FB8', '#3F9A5A', '#E0A82E'];
export function blockMat(ch: string, colIdx: number) {
  const col = BLOCK_COLS[colIdx % BLOCK_COLS.length]!;
  const k = ch + col;
  let m = blockCache.get(k);
  if (!m) {
    const t = canvasTex(16, 16, (c) => {
      c.fillStyle = '#EAD9B0'; c.fillRect(0, 0, 16, 16);
      c.fillStyle = col; c.fillRect(1, 1, 14, 14);
      c.fillStyle = shade(col, 0.7); c.fillRect(1, 14, 14, 1); c.fillRect(14, 1, 1, 14);
      pixText(c, ch, 3, 1, P.uiLine, 2, { shadow: P.ink });
    }).tex;
    m = psMat({ map: t });
    blockCache.set(k, m);
  }
  return m;
}

// ---------------------------------------------------------------- the plaque, mallet, trophy, name plate
export const PLAQ_W = 172, PLAQ_H = 66;
/** The brass plaque texture: rows of engraved words; `scratched` word boxes are gouged out first. */
export function drawPlaque(c: CanvasRenderingContext2D, rows: { text: string; x: number; y: number; scratched?: boolean; fresh?: boolean }[], title = 'SENIOR SOFTWARE DEVELOPER') {
  c.fillStyle = '#3A2A12'; c.fillRect(0, 0, PLAQ_W, PLAQ_H);
  c.fillStyle = '#C9A24A'; c.fillRect(2, 2, PLAQ_W - 4, PLAQ_H - 4);
  c.fillStyle = '#E8CC7A'; c.fillRect(2, 2, PLAQ_W - 4, 1); c.fillRect(2, 2, 1, PLAQ_H - 4);
  c.fillStyle = '#8A6A2A'; c.fillRect(2, PLAQ_H - 3, PLAQ_W - 4, 1); c.fillRect(PLAQ_W - 3, 2, 1, PLAQ_H - 4);
  for (const [x, y] of [[5, 5], [PLAQ_W - 7, 5], [5, PLAQ_H - 7], [PLAQ_W - 7, PLAQ_H - 7]]) { c.fillStyle = '#6E5220'; c.fillRect(x!, y!, 2, 2); }
  pixText(c, title, Math.floor((PLAQ_W - textW(title)) / 2), 6, '#6E5220');
  for (const r of rows) {
    if (r.scratched) {
      const w = textW(r.text, 2) + 4;
      c.fillStyle = '#9A7A34'; c.fillRect(r.x - 2, r.y - 1, w, 17);
      c.fillStyle = '#6E5220';
      for (let i = 0; i < w; i += 3) { c.fillRect(r.x - 2 + i, r.y - 1 + ((i * 7) % 13), 3, 1); c.fillRect(r.x - 2 + ((i * 5) % w), r.y + 6 + ((i * 3) % 7), 2, 1); }
      continue;
    }
    // engraved: a dark cut with a bright lower-right edge
    pixText(c, r.text, r.x + 1, r.y + 1, '#F2DA92', 2);
    pixText(c, r.text, r.x, r.y, r.fresh ? P.fail : '#3A2A12', 2);
  }
}

export function makeMallet() {
  const root = new THREE.Group(); // pivot at the grip end
  const handle = box(0.03, 0.03, 0.34, psMat({ color: '#7A5230' })); handle.position.z = -0.17;
  const head = box(0.09, 0.09, 0.16, psMat({ color: '#9A8E78' })); head.position.set(0, 0, -0.36); head.rotation.y = Math.PI / 2;
  root.add(handle, head);
  return root;
}

/** A gold cup on a base with a MINE plate; `sticker` is a hidden NOT sticker slapped on it. */
export function makeTrophy() {
  const root = new THREE.Group();
  const gold = psMat({ color: '#E8B83A', emit: '#302000' }), base = psMat({ color: '#3A2A1E' });
  const b = box(0.2, 0.08, 0.16, base); b.position.y = 0.04;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.04, 0.12, 6), gold); stem.position.y = 0.14;
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.04, 0.16, 8), gold); cup.position.y = 0.28;
  const hL = box(0.03, 0.08, 0.02, gold); hL.position.set(-0.11, 0.29, 0);
  const hR = hL.clone(); hR.position.x = 0.11;
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.05), psMat({ map: canvasTex(34, 10, (c) => { c.fillStyle = '#C9A24A'; c.fillRect(0, 0, 34, 10); pixText(c, 'MINE', 6, 2, '#3A2A12'); }).tex, unlit: true, fog: 0.4 }));
  plate.position.set(0, 0.045, 0.081);
  const sticker = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.06), psMat({ map: canvasTex(26, 12, (c) => { c.fillStyle = P.fail; c.fillRect(0, 0, 26, 12); c.fillStyle = '#FFFFFF'; c.fillRect(0, 0, 26, 1); pixText(c, 'NOT', 5, 3, '#FFFFFF'); }).tex, unlit: true, fog: 0.3 }));
  sticker.position.set(0, 0.29, 0.1); sticker.rotation.z = 0.18;
  root.add(b, stem, cup, hL, hR, plate, sticker);
  return { root, sticker };
}

export function makeNamePlate() {
  const root = new THREE.Group();
  const t = canvasTex(40, 10, (c) => { c.fillStyle = '#1B1B2A'; c.fillRect(0, 0, 40, 10); pixText(c, 'DEV', 11, 2, P.title); });
  const wedge = box(0.26, 0.07, 0.07, psMat({ color: '#1B1B2A' })); wedge.position.y = 0.035; wedge.rotation.x = -0.3;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.06), psMat({ map: t.tex, unlit: true, fog: 0.4 }));
  face.position.set(0, 0.045, 0.04); face.rotation.x = -0.3;
  root.add(wedge, face);
  return root;
}

// ---------------------------------------------------------------- the stage DEV's room stands on
export function makeStage() {
  const root = new THREE.Group();
  const R = rng(19);
  const velvet = (w: number, h: number, dark = 1) => canvasTex(32, 32, (c) => {
    for (let x = 0; x < 32; x++) { const f = 0.7 + 0.3 * Math.abs(Math.sin(x * 0.55)); for (let y = 0; y < 32; y++) { c.fillStyle = shade('#A3202A', f * dark * (0.95 + R() * 0.08)); c.fillRect(x, y, 1, 1); } }
    c.fillStyle = P.title; if (h < w) c.fillRect(0, 28, 32, 2);
  }, true).tex;
  const apron = box(12.5, 0.9, 1.2, psMat({ color: '#3A2616' })); apron.position.set(0, -0.45, 4.1); root.add(apron);
  const lip = box(12.5, 0.06, 0.1, psMat({ color: P.title })); lip.position.set(0, 0.0, 4.7); root.add(lip);
  for (let i = 0; i < 14; i++) { const f = box(0.22, 0.08, 0.12, psMat({ color: '#FFE9A0', unlit: true })); f.position.set(-5.85 + i * 0.9, 0.05, 4.55); root.add(f); }
  const sideT = velvet(1, 6);
  for (const s of [-1, 1]) { const f = new THREE.Mesh(new THREE.BoxGeometry(1.5, 7.2, 0.3), psMat({ map: sideT })); f.position.set(s * 5.8, 3.4, 4.3); root.add(f); }
  const val = new THREE.Mesh(new THREE.BoxGeometry(13, 1.4, 0.3), psMat({ map: velvet(13, 1.4) })); val.position.set(0, 6.3, 4.35); root.add(val);
  const cg = new THREE.PlaneGeometry(10.6, 6.6, 1, 1);
  const cuv = cg.attributes.uv!; for (let i = 0; i < cuv.count; i++) cuv.setXY(i, cuv.getX(i) * 4, cuv.getY(i));
  const curtain = new THREE.Mesh(cg, psMat({ map: velvet(10, 6.6, 0.95), side: THREE.DoubleSide }));
  curtain.position.set(0, 9.6, 4.2); root.add(curtain);
  const pit = new THREE.Mesh(new THREE.PlaneGeometry(30, 12), psMat({ color: '#0A0C16' })); pit.rotation.x = -Math.PI / 2; pit.position.set(0, -0.9, 10.6); root.add(pit);
  return { root, curtain };
}

/** Width in texels of a bitmap string at scale s (re-exported for layout). */
export const texW = (s: string, scale: number) => textW(s, scale);
export { ADV };
