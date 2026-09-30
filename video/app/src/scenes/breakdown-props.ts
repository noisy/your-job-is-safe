// breakdown: the kanban board, the sticky notes, the coffee machine, and the PR / prompt / bubble drawings.
import * as THREE from 'three';
import { pixText, textW, psMat, rng, shade } from '../ps1/gfx';
import { P } from '../ps1/palette';
import { uiBox, uiTab } from '../ps1/stage';

export const BOARD_W = 256, BOARD_H = 128;

/** The whiteboard: TODO / DOING / DONE columns, a few old notes in DONE (the lyric notes are separate meshes). */
export function drawBoard(c: CanvasRenderingContext2D) {
  const R = rng(9);
  c.fillStyle = '#E9EDF0'; c.fillRect(0, 0, BOARD_W, BOARD_H);
  for (let i = 0; i < 40; i++) { c.fillStyle = shade('#E9EDF0', 0.94); c.fillRect(Math.floor(R() * 250), Math.floor(R() * 120), 6, 1); }
  c.fillStyle = '#8A93A8'; c.fillRect(0, 0, BOARD_W, 2); c.fillRect(0, BOARD_H - 2, BOARD_W, 2); c.fillRect(0, 0, 2, BOARD_H); c.fillRect(BOARD_W - 2, 0, 2, BOARD_H);
  const cols = ['TODO', 'DOING', 'DONE'];
  cols.forEach((h, i) => {
    const x0 = Math.round((i * BOARD_W) / 3);
    if (i > 0) { c.fillStyle = '#5A6488'; c.fillRect(x0, 4, 1, BOARD_H - 8); }
    pixText(c, h, x0 + Math.round(BOARD_W / 6) - textW(h, 2) / 2, 5, '#2E4A8C', 2);
  });
  c.fillStyle = '#5A6488'; c.fillRect(4, 21, BOARD_W - 8, 1);
  // old, finished work in DONE (all of it DEV's, all of it slow)
  const done = ['fix css', 'standup', 'refactor', 'code review', 'coffee'];
  done.forEach((s, i) => {
    const x = 176 + (i % 2) * 38, y = 28 + Math.floor(i / 2) * 22;
    c.fillStyle = ['#BFE3A8', '#F7E08A', '#F4B6C2'][i % 3]!; c.fillRect(x, y, 34, 18);
    pixText(c, s.slice(0, 5), x + 2, y + 3, P.ink); if (s.length > 5) pixText(c, s.slice(5, 10).trim(), x + 2, y + 10, P.ink);
  });
}

/** A sticky note with one word, 2x, hand-set (each glyph nudged a pixel, like a marker). */
export function drawNote(c: CanvasRenderingContext2D, w: number, h: number, word: string, col: string, seed: number) {
  const R = rng(seed);
  c.fillStyle = col; c.fillRect(0, 0, w, h);
  c.fillStyle = shade(col, 0.85); c.fillRect(0, 0, w, 3); c.fillRect(w - 1, 0, 1, h); c.fillRect(0, h - 1, w, 1);
  pixText(c, word, 6, 10, '#1B2A55', 2, { each: () => [0, Math.round((R() - 0.5) * 2)] });
}
export const noteW = (word: string) => textW(word, 2) + 12;

/** The coffee machine on its little table, ~1 tall, facing +z. */
export function makeCoffee() {
  const g = new THREE.Group();
  const b = (w: number, h: number, d: number, col: string, x: number, y: number, z: number, emit?: string) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), psMat({ color: col, emit })); m.position.set(x, y, z); g.add(m); return m;
  };
  b(0.8, 0.06, 0.6, P.wood, 0, 0.72, 0);
  for (const [x, z] of [[-0.35, -0.25], [0.35, -0.25], [-0.35, 0.25], [0.35, 0.25]] as const) b(0.05, 0.72, 0.05, shade(P.wood, 0.8), x, 0.36, z);
  b(0.36, 0.5, 0.36, '#2A2E3E', 0, 1.0, -0.05);
  b(0.36, 0.08, 0.3, '#3A3F55', 0, 1.29, 0.02);
  b(0.2, 0.05, 0.04, P.fix, 0.05, 1.12, 0.14, '#104020');
  const mug = b(0.1, 0.12, 0.1, '#F3ECDF', 0, 0.81, 0.06);
  const stream = b(0.02, 0.12, 0.02, '#4A2A1A', 0, 0.94, 0.06);
  return { root: g, mug, stream };
}

/** The chatbot's prompt box (240x64): DEV types the ticket in. `text` is drawn by the caller (typeWords). */
export function drawPrompt(c: CanvasRenderingContext2D, W: number, H: number) {
  uiBox(c, 0, 4, W, H - 4, P.uiBg);
  uiTab(c, 8, 0, 'PROMPT  >  chatbot v5.0', P.uiNavy);
}

/** The pull request (224x168) the chatbot opened while DEV got coffee; the description (the lyric) is typed by the caller at y 24..74. */
export function drawPR(c: CanvasRenderingContext2D, W: number, H: number, o: { tests: number; merged: boolean; lines: number; t: number }) {
  c.fillStyle = '#F4F6FA'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#1B2A55'; c.fillRect(0, 0, W, 14);
  pixText(c, 'PULL REQUEST #4211', 4, 4, P.uiLine);
  pixText(c, 'by chatbot v5.0', W - 4 - textW('by chatbot v5.0'), 4, P.bot);
  c.fillStyle = '#D0D6E2'; c.fillRect(4, 78, W - 8, 1); c.fillRect(112, 82, 1, H - 86);
  // tests (left) and the diff scrolling past (right)
  const tests = ['unit (412)', 'e2e (37)', 'lint', 'types', 'perf'];
  tests.forEach((s, i) => {
    const y = 84 + i * 11;
    const ok = i < o.tests;
    pixText(c, ok ? '✓' : '·', 6, y, ok ? '#2E9E4E' : '#8C93B8', 1);
    pixText(c, s, 16, y, ok ? P.ink : '#8C93B8');
  });
  for (let i = 0; i < o.lines; i++) {
    const y = 84 + (i % 8) * 6;
    c.fillStyle = i % 3 === 2 ? '#F4B6C2' : '#BFE3A8'; c.fillRect(118, y, 100, 5);
    c.fillStyle = shade(i % 3 === 2 ? '#F4B6C2' : '#BFE3A8', 0.7); c.fillRect(120, y + 1, 10 + ((i * 17) % 70), 3);
  }
  pixText(c, '+2,431  -12', 118, 136, '#3E8E41');
  if (o.merged) {
    c.fillStyle = '#2E9E4E'; c.fillRect(118, 146, 100, 18);
    pixText(c, 'MERGED', 168 - textW('MERGED', 2) / 2, 148, '#FFFFFF', 2);
  } else {
    pixText(c, 'checks running' + '...'.slice(0, 1 + (Math.floor(o.t * 4) % 3)), 6, 150, '#8C93B8');
  }
}

/** The speech bubble: a grawlix, then autocorrected to "duck!". */
export function drawBubble(c: CanvasRenderingContext2D, W: number, H: number, o: { grawlix: number; duck: number }) {
  c.fillStyle = P.uiEdge; c.fillRect(2, 0, W - 4, H - 10); c.fillRect(0, 2, W, H - 14);
  c.fillStyle = '#FFFFFF'; c.fillRect(3, 1, W - 6, H - 12); c.fillRect(1, 3, W - 2, H - 16);
  c.fillStyle = P.uiEdge; for (let i = 0; i < 8; i++) c.fillRect(22 + i, H - 10 + i, 10 - i, 1);
  c.fillStyle = '#FFFFFF'; for (let i = 0; i < 7; i++) c.fillRect(23 + i, H - 11 + i, 8 - i, 1);
  const g = '@#$%&!';
  if (o.duck <= 0) pixText(c, g.slice(0, o.grawlix), W / 2 - textW(g, 3) / 2, 10, P.fail, 3);
  else {
    const s = 'duck!';
    pixText(c, s, W / 2 - textW(s, 3) / 2, 10, P.ink, 3);
    c.fillStyle = '#3F7FE0'; c.fillRect(W / 2 - textW(s, 3) / 2, 33, Math.round(textW(s, 3) * Math.min(1, o.duck)), 2);
    pixText(c, 'autocorrected', W - 4 - textW('autocorrected'), 38, '#3F7FE0');
  }
}
