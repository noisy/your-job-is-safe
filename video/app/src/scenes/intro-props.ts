// intro: the props (front pages, calendar leaves, the thumbs-up, the rotating title-screen sunburst).
import * as THREE from 'three';
import { pixText, textW, psMat, rng, shade } from '../ps1/gfx';
import { P } from '../ps1/palette';

/** The three headlines, paraphrased, each with its speaker and date as plain text (docs/STORY.md). */
export const introQuotes = [
  { quote: '"Don\'t learn to code."', who: '- Nvidia CEO, Feb 2024', date: 'FEB 2024' },
  { quote: '"An AI mid-level engineer this year."', who: '- Meta CEO, Jan 2025', date: 'JAN 2025' },
  { quote: '"90% of code written by AI in 3-6 months."', who: '- Anthropic CEO, Mar 2025', date: 'MAR 2025' },
];

const PAPER = '#E8E0CC', INK = P.ink;

/** Word-wrap for the bitmap font. */
function wrap(s: string, maxChars: number) {
  const out: string[] = [];
  let line = '';
  for (const w of s.split(' ')) {
    if (line && (line + ' ' + w).length > maxChars) { out.push(line); line = w; } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
}

/** A 300x230 front page: masthead, date, an empty 3-row headline band (y 42..130: the block-letter ink lands there), the quote, a photo, columns. */
export const PAGE_TW = 300, PAGE_TH = 230;
export function drawFrontPage(c: CanvasRenderingContext2D, q: (typeof introQuotes)[number], i: number) {
  const W = PAGE_TW, H = PAGE_TH;
  const R = rng(40 + i);
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) { c.fillStyle = shade(PAPER, 0.95 + R() * 0.07); c.fillRect(x, y, 2, 2); }
  c.fillStyle = shade(PAPER, 0.8); c.fillRect(0, 0, W, 1); c.fillRect(0, H - 1, W, 1); c.fillRect(0, 0, 1, H); c.fillRect(W - 1, 0, 1, H);
  const mast = 'THE DAILY BYTE';
  pixText(c, mast, W / 2 - textW(mast, 2) / 2, 6, INK, 2);
  c.fillStyle = INK; c.fillRect(8, 23, W - 16, 2); c.fillRect(8, 27, W - 16, 1);
  pixText(c, q.date, 10, 31, INK);
  pixText(c, 'EXTRA!', W - 10 - textW('EXTRA!'), 31, P.fail);
  c.fillStyle = INK; c.fillRect(8, 40, W - 16, 1); c.fillRect(8, 131, W - 16, 1);
  // the quote under the headline band
  const lines = wrap(q.quote, 23);
  lines.forEach((l, k) => pixText(c, l, W / 2 - textW(l, 2) / 2, 136 + k * 17, INK, 2));
  const ay = 136 + lines.length * 17 + 1;
  pixText(c, q.who, W / 2 - textW(q.who) / 2, ay, shade(INK, 1.6));
  c.fillStyle = INK; c.fillRect(8, ay + 10, W - 16, 1);
  // a photo (a speaker at a podium, deliberately a silhouette) and columns of body text
  const py = ay + 14, ph = H - 4 - py;
  if (ph > 10) {
    c.fillStyle = '#5A5E70'; c.fillRect(10, py, 64, ph);
    c.fillStyle = '#2A2C38'; c.fillRect(36, py + 3, 12, 8); c.fillRect(32, py + 11, 20, ph - 11); c.fillStyle = '#8A8FA8'; c.fillRect(28, py + ph - 8, 28, 8);
    c.fillStyle = shade(PAPER, 0.62);
    for (let col = 0; col < 3; col++) for (let y = py + 1; y < H - 4; y += 4) c.fillRect(82 + col * 70, y, 60 + Math.floor(R() * 8), 2);
  }
}

/** A 64x76 tear-off calendar leaf: red header with the year, the word, a NEXT YEAR stamp. */
export function drawLeaf(c: CanvasRenderingContext2D, year: number, word: string) {
  const R = rng(year);
  for (let y = 0; y < 76; y++) for (let x = 0; x < 64; x++) { c.fillStyle = shade('#F3ECDF', 0.95 + R() * 0.06); c.fillRect(x, y, 1, 1); }
  c.fillStyle = P.fail; c.fillRect(0, 0, 64, 19);
  c.fillStyle = P.failSide; c.fillRect(0, 18, 64, 1);
  // perforation holes along the top
  c.fillStyle = '#5A3A24'; for (let x = 6; x < 64; x += 10) c.fillRect(x, 1, 3, 2);
  const ys = String(year);
  pixText(c, ys, 32 - textW(ys, 2) / 2, 4, P.uiLine, 2, { shadow: P.failSide });
  if (word) pixText(c, word, 32 - textW(word, 2) / 2, 29, INK, 2);
  const sx = 4, sy = 54;
  c.fillStyle = P.fail;
  c.fillRect(sx, sy, 56, 1); c.fillRect(sx, sy + 13, 56, 1); c.fillRect(sx, sy, 1, 14); c.fillRect(sx + 55, sy, 1, 14);
  pixText(c, 'NEXT YEAR', 32 - textW('NEXT YEAR') / 2, sy + 4, P.fail);
}

/** DEV's thumbs-up (skin fist, thumb, hoodie cuff), ~1 unit tall, centred on its origin. */
export function makeThumbsUp() {
  const g = new THREE.Group();
  const skin = psMat({ color: P.skin }), skinAlt = psMat({ color: shade(P.skin, 0.94) }), knuckle = psMat({ color: shade(P.skin, 0.8) }), cloth = psMat({ color: P.hoodie });
  const b = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mesh.position.set(x, y, z); g.add(mesh); return mesh;
  };
  // the fist: four curled fingers as stacked rolls across the whole front (so it reads as a fist, not a finger)
  b(0.5, 0.48, 0.4, skin, 0, 0, 0);
  for (let i = 0; i < 4; i++) {
    b(0.52, 0.1, 0.14, i % 2 ? skin : skinAlt, 0.02, 0.18 - i * 0.12, 0.2);
    b(0.5, 0.015, 0.02, knuckle, 0.02, 0.125 - i * 0.12, 0.275); // the crease between two fingers
  }
  // the thumb: thick, up from the fist's back edge, leaning out a little, with a nail
  const th = new THREE.Group(); th.position.set(-0.16, 0.22, -0.06); th.rotation.z = 0.18; g.add(th);
  const tb = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.36, 0.2), skin); tb.position.y = 0.18; th.add(tb);
  const nail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.03), psMat({ color: '#F2D4BC' })); nail.position.set(0, 0.3, 0.1); th.add(nail);
  b(0.58, 0.26, 0.5, cloth, 0, -0.34, 0);
  g.scale.setScalar(1.15);
  return g;
}

/** A radial sunburst of `n` alternating wedges (two meshes), radius r, facing +z. */
export function makeSunburst(n: number, a: string, b: string, r: number) {
  const g = new THREE.Group();
  const mk = (odd: number, col: string) => {
    const pos: number[] = [];
    for (let i = odd; i < n; i += 2) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      pos.push(0, 0, 0, Math.cos(a0) * r, Math.sin(a0) * r, 0, Math.cos(a1) * r, Math.sin(a1) * r, 0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, k) => (k % 3 === 2 ? 1 : 0)), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
    const m = new THREE.Mesh(geo, psMat({ color: col, unlit: true, fog: 0, side: THREE.DoubleSide }));
    m.renderOrder = -1;
    g.add(m);
  };
  mk(0, a); mk(1, b);
  return g;
}
