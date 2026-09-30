// pre: pixel-art textures and models (feed post cards, slop images, the brass plaque, the SLOP MACHINE).
import * as THREE from 'three';
import { pixText, textW, psMat, rng, shade } from '../ps1/gfx';
import { P } from '../ps1/palette';

export const CARD_W = 128, CARD_H = 64;

/** A tiny pixel heart at (x, y), 7x6. */
export function heart(c: CanvasRenderingContext2D, x: number, y: number, col: string) {
  c.fillStyle = col;
  for (const [a, b, w] of [[1, 0, 2], [4, 0, 2], [0, 1, 7], [0, 2, 7], [1, 3, 5], [2, 4, 3], [3, 5, 1]] as const) c.fillRect(x + a, y + b, w, 1);
}
function avatar(c: CanvasRenderingContext2D, x: number, y: number, seed: number) {
  const R = rng(seed);
  c.fillStyle = shade(['#5B8CFF', '#FF7A45', '#9A6BFF', '#3FB58A'][seed % 4]!, 1); c.fillRect(x, y, 10, 10);
  c.fillStyle = P.skin; c.fillRect(x + 3, y + 2, 4, 4); c.fillRect(x + 2, y + 7, 6, 3);
  if (R() > 0.5) { c.fillStyle = P.hair; c.fillRect(x + 3, y + 1, 4, 2); }
}

/** A post card with one big word (the lyric idiom: each word is its own post). style 'post' (pre 1) or 'video' (pre 2). */
export function drawWordCard(c: CanvasRenderingContext2D, word: string, i: number, style: 'post' | 'video', hot: boolean) {
  const R = rng(100 + i);
  const handles = ['@hypebro', '@10x_guy', '@agi_soon', '@prompt.lord', '@vc_mike', '@growth.hax'];
  const likes = `${(1 + R() * 98).toFixed(1)}K`;
  if (style === 'post') {
    c.fillStyle = '#F4F1EA'; c.fillRect(0, 0, CARD_W, CARD_H);
    c.fillStyle = '#D9D3C4'; c.fillRect(0, CARD_H - 1, CARD_W, 1); c.fillRect(CARD_W - 1, 0, 1, CARD_H);
    avatar(c, 4, 4, i);
    pixText(c, handles[i % handles.length]!, 18, 6, '#5A6078');
    if (hot) { c.fillStyle = P.title; c.fillRect(6, 19, textW(word, 3) + 6, 27); }
    pixText(c, word, 9, 22, P.ink, 3);
    heart(c, 5, 53, P.fail); pixText(c, likes, 15, 53, '#5A6078');
    pixText(c, '>> share', CARD_W - 4 - textW('>> share'), 53, '#8C93B8');
  } else {
    c.fillStyle = '#0B0E18'; c.fillRect(0, 0, CARD_W, CARD_H);
    c.fillStyle = shade(['#2A1E4A', '#3A1420', '#12304A'][i % 3]!, 1); c.fillRect(2, 2, CARD_W - 4, CARD_H - 12);
    pixText(c, word, 64 - textW(word, 3) / 2, 18, hot ? P.title : P.uiLine, 3, { shadow: P.uiEdge });
    c.fillStyle = P.uiLine; for (let k = 0; k < 5; k++) c.fillRect(6 + k, 5 + Math.abs(2 - k), 1, 5 - 2 * Math.abs(2 - k)); // play
    pixText(c, '#trend', 15, 5, P.uiDim);
    c.fillStyle = '#3A3F55'; c.fillRect(4, CARD_H - 7, CARD_W - 8, 2);
    c.fillStyle = P.fail; c.fillRect(4, CARD_H - 7, Math.floor((CARD_W - 8) * (0.2 + R() * 0.7)), 2);
    heart(c, CARD_W - 40, CARD_H - 9, P.fail); pixText(c, likes, CARD_W - 30, CARD_H - 9, P.uiDim);
  }
}

/** Decorative feed posts: slop images and hype (not lyrics). */
export function drawDecorCard(c: CanvasRenderingContext2D, kind: number, style: 'post' | 'video') {
  const dark = style === 'video';
  c.fillStyle = dark ? '#0B0E18' : '#F4F1EA'; c.fillRect(0, 0, CARD_W, 72);
  const ink = dark ? P.uiLine : P.ink, dim = dark ? P.uiDim : '#5A6078';
  avatar(c, 4, 4, kind + 7);
  const k = kind % 4;
  const handle = ['@aiart_daily', '@foodgen', '@hypebro', '@agi_soon'][k]!;
  pixText(c, handle, 18, 6, dim);
  const img = (bg: string) => { c.fillStyle = bg; c.fillRect(4, 18, 120, 42); };
  if (k === 0) {
    // the six-fingered selfie
    img('#6FA8DC');
    c.fillStyle = '#F2D08A'; c.fillRect(4, 50, 120, 10);
    c.fillStyle = P.skin; c.fillRect(30, 30, 14, 14); c.fillRect(27, 44, 20, 16);
    c.fillStyle = P.hair; c.fillRect(30, 28, 14, 4);
    c.fillStyle = P.skin; c.fillRect(70, 38, 16, 12);
    for (let f = 0; f < 6; f++) c.fillRect(70 + f * 3, 26 + (f % 2), 2, 12);
    pixText(c, '6', 92, 26, P.fail, 2);
    pixText(c, 'beach day!', 4, 63, ink);
  } else if (k === 1) {
    // a melting burger
    img('#3A2A2A');
    c.fillStyle = '#C98A3A'; c.fillRect(40, 26, 48, 10);
    c.fillStyle = '#6B3A1E'; c.fillRect(38, 36, 52, 6);
    c.fillStyle = '#E8C23A'; for (let x = 36; x < 92; x += 5) c.fillRect(x, 42, 3, 4 + ((x * 7) % 9));
    c.fillStyle = '#C98A3A'; c.fillRect(42, 46, 44, 6);
    c.fillStyle = '#6B3A1E'; for (let x = 44; x < 86; x += 7) c.fillRect(x, 52, 2, 6);
    pixText(c, 'dinner??', 4, 63, ink);
  } else if (k === 2) {
    pixText(c, '10X ENGINEER', 6, 24, ink, 2);
    pixText(c, 'IN 1 PROMPT', 6, 42, P.fail, 2);
    pixText(c, 'thread 1/47', 4, 63, dim);
  } else {
    img(dark ? '#141B2E' : '#E6E9F2');
    c.fillStyle = P.fix; let y = 54;
    for (let x = 10; x < 118; x += 2) { y -= (x > 70 ? 1.2 : 0.2); c.fillRect(x, Math.round(y), 2, 2); }
    pixText(c, 'AGI BY FRIDAY', 12, 22, ink);
    pixText(c, 'not financial advice', 4, 63, dim);
  }
  heart(c, CARD_W - 40, 63, P.fail); pixText(c, `${(k + 2) * 3}.${k}M`, CARD_W - 30, 63, dim);
}

/** The first card: the previous line's held tail, as a post (rows of words, each shown once sung). */
export function drawTailCard(c: CanvasRenderingContext2D, rows: { w: string; on: boolean }[][], style: 'post' | 'video') {
  const dark = style === 'video';
  c.fillStyle = dark ? '#0B0E18' : '#F4F1EA'; c.fillRect(0, 0, 160, 96);
  c.fillStyle = P.uiNavy; c.fillRect(0, 0, 160, 14);
  pixText(c, '@dev_irl', 4, 4, P.uiLine);
  if (!dark) { c.fillStyle = P.fail; c.fillRect(120, 3, 36, 9); pixText(c, 'LIVE', 126, 4, P.uiLine); }
  rows.forEach((r, ri) => {
    let x = 6;
    for (const w of r) {
      if (w.on) pixText(c, w.w, x, 22 + ri * 20, dark ? P.uiLine : P.ink, 2);
      x += (w.w.length + 1) * 12;
    }
  });
  heart(c, 6, 84, P.fail); pixText(c, '888K', 16, 84, dark ? P.uiDim : '#5A6078');
}

/** The brass plaque's frame (the text is typed on top by typeWords). */
export function drawPlaque(c: CanvasRenderingContext2D, w: number, h: number) {
  c.fillStyle = '#6B4A12'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#C9A23A'; c.fillRect(2, 2, w - 4, h - 4);
  c.fillStyle = '#E8C766'; c.fillRect(3, 3, w - 6, 1); c.fillRect(3, 3, 1, h - 6);
  c.fillStyle = '#8A6A1E'; c.fillRect(3, h - 4, w - 6, 1); c.fillRect(w - 4, 3, 1, h - 6);
  for (const [x, y] of [[5, 5], [w - 7, 5], [5, h - 7], [w - 7, h - 7]] as const) { c.fillStyle = '#6B4A12'; c.fillRect(x, y, 2, 2); }
}

/** The SLOP MACHINE: a chunky contraption (the chatbot head is added on its front by the scene). Faces +x; nozzle at `nozzle`. */
export function makeSlopMachine(goo: string) {
  const g = new THREE.Group();
  const metal = psMat({ color: '#8A93A8' }), dark = psMat({ color: '#4A5068' }), rust = psMat({ color: '#9A5A3A' }), gooM = psMat({ color: goo, emit: shade(goo, 0.25) });
  const b = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mesh.position.set(x, y, z); g.add(mesh); return mesh;
  };
  b(1.1, 1.2, 1.0, metal, 0, 0.6, 0);
  b(1.16, 0.1, 1.06, dark, 0, 1.22, 0);
  b(0.2, 0.9, 0.2, dark, -0.45, 0.45, 0.42); b(0.2, 0.9, 0.2, dark, -0.45, 0.45, -0.42);
  // the hopper, overflowing with goo
  const hop = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.25, 0.5, 6, 1, true), psMat({ color: '#6A7288', side: THREE.DoubleSide }));
  hop.position.set(-0.1, 1.52, 0); g.add(hop);
  const gooTop = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 6), gooM); gooTop.position.set(-0.1, 1.72, 0); g.add(gooTop);
  // gauges, a crank, pipes
  b(0.05, 0.3, 0.3, rust, 0.56, 0.35, -0.3);
  const crank = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 8), dark); crank.rotation.x = Math.PI / 2; crank.position.set(0.1, 0.5, 0.52); g.add(crank);
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 5), rust); pipe.position.set(-0.62, 1.1, 0.3); g.add(pipe);
  // the nozzle (points +x)
  const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.28, 0.4, 6), dark); noz.rotation.z = -Math.PI / 2; noz.position.set(0.75, 0.62, 0); g.add(noz);
  const drip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.1), gooM); drip.position.set(0.9, 0.46, 0.05); g.add(drip);
  return { root: g, crank, drip, nozzle: new THREE.Vector3(0.95, 0.62, 0) };
}
