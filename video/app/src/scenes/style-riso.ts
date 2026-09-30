// Phase-1 style "riso": a risograph print run in a 3D print room. Every image is a sheet printed in two or
// three drums (Bright Red, Federal Blue, Yellow), overprinted on off-white paper with halftone screens at
// different angles, drum grain, ink starvation and misregistration that jumps on the snares. The sheets
// are physical: they slide out of the duplicator, slap onto the cutting mat, curl and cast shadows, and the
// 3D subjects (a strawberry, a half-full wine glass) are rendered into ink separations and printed on them.
// Lyric idiom: each word is the second drum pass, arriving as a misregistered doubled ghost and snapping
// into registration on its start; held notes keep printing (a second impression darkens and spreads).
import * as THREE from 'three';
import { Scene, type Frame } from '../engine/scene';
import { makeRT, W, H } from '../engine/gl';
import { F, font, glyphX, fitSize, measure, plain } from '../engine/type';
import { Lyrics, type Line, type Word } from '../engine/lyrics';
import { clamp, lerp, ease, keys, springStep, hash, frameIdx, prog, type Key } from '../engine/util';
import type { StyleNote } from '../styles/registry';
import { RisoSheet, sep, inkUniforms, worldMaterial, MAX_SHADOWS } from './style-riso-print';
import { RisoIllus, GLASS } from './style-riso-illus';

export const TITLE = 'Risograph overprint';
export const NOTE: StyleNote = {
  technique: 'A 3D print room in three.js; every sheet is a curled paper mesh whose plates (solid + tint, Canvas2D in separation space) and a live 3D render in ink separations are screened in the paper’s own UV space: per-drum halftone angles, drum grain, starvation streaks, mottled solids, multiply overprint, misregistration that jumps on snares. The table and the duplicator are printed too (world-space screens).',
  palette: 'Riso drum inks Bright Red #F15060, Federal Blue #3D5588 and Yellow #FFE800 on #F3EEE3 paper; red + blue overprint is the “black”, blue + yellow the green. Matte, no bloom.',
  typography: 'Bricolage Grotesque condensed 800 for the poster headlines, JetBrains Mono for the chatbot and the prompt, Caveat for the proofreader’s red-pencil marks.',
  lyrics: 'Each word is printed by the second drum: a faint doubled, offset ghost arrives up to 0.35 s early and snaps into registration exactly on the word’s start; held notes (“thing!”, “strawberry,”, “wine,”) keep printing, so a second impression darkens and spreads the ink.',
  cost: 'Measured (render.ts perf, 42–47 s): 13.3 ms/frame at 1 sample, 24.6 ms at 4 (≈3.8 ms per extra sub-frame; the plates re-upload once per output frame). Full 204 s song with motion blur: ≈17 min at ~20 sub-frames, ≈30 min at 36.',
  risks: 'Plate uploads (one or two 1.5k canvases per frame) dominate; halftone detail can moiré at far framings (screened out below ~3 px cells). Must keep the camera moving so the print look does not become a flat poster.',
};

const TY = 0.1; // output tray top (m)
const ANT = 0.35; // lyric anticipation (s)
const SHEET_W = 0.42, SHEET_H = 0.297; // A3 landscape
const HEAD = F.display(75, 800);
const MONO = F.mono(700);
const MONO_R = F.mono(400);
const HAND = F.hand(700);

type V3 = [number, number, number];
type Placed = { w: Word; x: number; y: number; size: number; fam: string; held: boolean; inks?: [number, number]; amp?: number };

/** Lay a line's words out in rows on a plate (mm): per-word x from the row set as one kerned run. */
function placeRows(line: Line, rows: { words: number[]; size: number; x: number; y: number; fam?: string; align?: 'left' | 'right'; inks?: [number, number] }[]): Placed[] {
  const out: Placed[] = [];
  for (const r of rows) {
    const fam = r.fam ?? HEAD;
    const text = r.words.map((i) => line.words[i]!.w).join(' ');
    const x0 = r.align === 'right' ? r.x - measure(text, fam, r.size) : r.x;
    let ci = 0;
    for (const i of r.words) {
      const w = line.words[i]!;
      out.push({ w, x: x0 + glyphX(text, ci, fam, r.size), y: r.y, size: r.size, fam, held: w.end - w.start > 0.5, inks: r.inks });
      ci += Array.from(w.w).length + 1;
    }
  }
  return out;
}

/** Print one lyric word onto a sheet's plates at time t (the second-drum idiom). */
function printWord(s: CanvasRenderingContext2D, tc: CanvasRenderingContext2D, p: Placed, t: number) {
  const { w, x, y, size, fam } = p;
  if (t < w.start - ANT) return;
  const [ir, ib] = p.inks ?? [1, 1];
  s.font = font(fam, size); tc.font = font(fam, size);
  if (t < w.start) {
    // the ghost: a faint doubled image, the two drums far out of register, closing in
    const a = (t - (w.start - ANT)) / ANT;
    const amp = p.amp ?? 1;
    const d = lerp(size * 0.14, size * 0.05, ease.inQuad(a)) * amp;
    const k = 0.2 + 0.3 * a;
    tc.fillStyle = sep(k * ir, 0, 0); tc.fillText(w.w, x + d, y - d * 0.4);
    tc.fillStyle = sep(0, k * ib, 0); tc.fillText(w.w, x - d, y + d * 0.4);
    return;
  }
  // snapped: registered solid print, with a tiny spring left in the drums
  const r = size * 0.07 * (p.amp ?? 1) * (1 - springStep(t - w.start, 7, 0.42));
  s.fillStyle = sep(ir, 0, 0); s.fillText(w.w, x + r, y - r * 0.4);
  s.fillStyle = sep(0, ib, 0); s.fillText(w.w, x - r, y + r * 0.4);
  if (p.held) {
    // held note: the drum keeps printing, ink spreads and a second impression builds up
    const b = ease.outQuad(Lyrics.wordProgress(w, t));
    s.lineJoin = 'round';
    s.lineWidth = size * 0.022 * b; s.strokeStyle = sep(ir, ib, 0); s.strokeText(w.w, x, y);
    tc.fillStyle = sep(0.75 * b * ir, 0.85 * b * ib, 0); tc.fillText(w.w, x + size * 0.012, y + size * 0.008);
  }
}

/** Registration marks in the corners, in every drum (their doubling shows the misregistration). */
function regMarks(s: CanvasRenderingContext2D, wmm: number, hmm: number, inks: [number, number, number] = [1, 1, 0]) {
  s.lineWidth = 0.35;
  for (const [cx, cy] of [[9, 9], [wmm - 9, 9], [9, hmm - 9], [wmm - 9, hmm - 9]] as [number, number][]) {
    s.strokeStyle = sep(...inks);
    s.beginPath(); s.arc(cx, cy, 3, 0, Math.PI * 2); s.moveTo(cx - 6, cy); s.lineTo(cx + 6, cy); s.moveTo(cx, cy - 6); s.lineTo(cx, cy + 6); s.stroke();
  }
}

/** A proofreader's red-pencil ellipse (a loose double loop), drawn up to fraction `p`. */
function pencilLoop(s: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, p: number, seed: number, lw = 1.1) {
  if (p <= 0) return;
  s.lineWidth = lw; s.lineCap = 'round'; s.strokeStyle = sep(1, 0, 0);
  s.beginPath();
  const n = 48, turns = 1.15;
  const a0 = -2.1 + hash(seed) * 0.6;
  for (let i = 0; i <= n * p; i++) {
    const u = i / n, a = a0 + u * turns * Math.PI * 2;
    const wob = 1 + 0.06 * Math.sin(u * 9 + seed) + 0.05 * u;
    const px = cx + Math.cos(a) * rx * wob, py = cy + Math.sin(a) * ry * wob;
    if (i === 0) s.moveTo(px, py); else s.lineTo(px, py);
  }
  s.stroke();
}

export default class RisoScene extends Scene {
  world = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(32, W / H, 0.01, 30);
  rt = makeRT(W, H, { samples: 4 });
  illus = new RisoIllus();
  sheets!: Record<'A' | 'B' | 'C' | 'D' | 'E', RisoSheet>;
  tableMat = worldMaterial([0.0, 0.97, 0.0], [0.55, 0.1, 0.0], { lines: 1, cell: 0.0024, seed: 5 });
  trayMat = worldMaterial([0.85, 0.05, 0.0], [0.0, 0.6, 0.0], { cell: 0.0018, seed: 9 });
  machine = new THREE.Group();
  tray = new THREE.Group();

  // anchors (from the data)
  L0!: Line; L1!: Line; L2!: Line;
  db: number[] = [];
  kicks: number[] = [];
  snares: number[] = [];
  countT: number[] = [];
  tokenT = 0;
  C3 = new THREE.Vector3(-1.6, 0, 0);
  C5 = new THREE.Vector3(-2.08, 0, 0.03);
  rsMM: [number, number] = [0, 0];
  glassRect: [number, number, number, number] = [262, 16, 146, 246]; // mm on sheet D (x, y, w, h)

  override async init() {
    const { audio: au, lyrics: ly, start, end } = this.ctx;
    this.L0 = ly.get('Watch it try', 0);
    this.L1 = ly.get("It can't count the R", 0);
    this.L2 = ly.get("It can't fill a glass of wine", 0);
    this.db = au.downbeats.filter((d) => d >= start - 0.02 && d <= end + 0.02);
    while (this.db.length < 7) this.db.push((this.db[this.db.length - 1] ?? start) + 1.39);
    const k = au.events('kick', this.db[1]! + 0.1, this.db[2]! - 0.1).map((e) => e[0]);
    this.kicks = k.length >= 3 ? k.slice(-3) : [this.db[2]! - 1.0, this.db[2]! - 0.85, this.db[2]! - 0.7];
    this.snares = au.events('snare', start - 3, end + 1).map((e) => e[0]);
    // the proofreader counts the three R's on the eighth notes of the held "strawberry,"
    const straw = this.L1.words[6]!;
    const b0 = Math.ceil(au.beatAt(straw.start + 0.05));
    this.countT = [0, 0.5, 1].map((x) => au.timeOfBeat(b0 + x));
    this.tokenT = au.timeOfBeat(b0 + 1.5);

    this.buildWorld();
    this.buildSheets();
  }

  // ------------------------------------------------------------------ world
  private buildWorld() {
    const table = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), this.tableMat);
    table.rotation.x = -Math.PI / 2;
    this.world.add(table);
    // output tray: a low cabinet in front of the duplicator's exit slot
    const trayBox = new THREE.Mesh(new THREE.BoxGeometry(0.52, TY, 0.42), this.trayMat);
    trayBox.position.set(-0.02, TY / 2, 0);
    this.tray.add(trayBox);
    const guideMat = worldMaterial([0.9, 0.04, 0.0], [0.0, 0.5, 0.0], { cell: 0.0015 });
    for (const z of [-0.2, 0.2]) {
      const g = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.018, 0.008), guideMat);
      g.position.set(-0.02, TY + 0.009, z);
      this.tray.add(g);
    }
    this.world.add(this.tray);
    // the duplicator: cream body, blue lid, a dark exit slot facing -x, red and yellow buttons
    const bodyMat = worldMaterial([0.12, 0.0, 0.92], [0.1, 0.75, 0.0], { cell: 0.0019, seed: 2 });
    const lidMat = worldMaterial([0.92, 0.04, 0.0], [0.0, 0.55, 0.0], { cell: 0.0019, seed: 4 });
    const darkMat = worldMaterial([0.85, 0.95, 0.0], [0.1, 0.05, 0.0], { cell: 0.0015 });
    const redMat = worldMaterial([0.95, 0.0, 0.0], [0.0, 0.45, 0.0], { cell: 0.0012 });
    const yelMat = worldMaterial([0.0, 0.0, 0.95], [0.3, 0.4, 0.0], { cell: 0.0012 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.3, 0.5), bodyMat);
    body.position.set(0.49, 0.15, 0);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.48), lidMat);
    lid.position.set(0.49, 0.325, 0);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.016, 0.34), darkMat);
    slot.position.set(0.232, TY + 0.004, 0);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.008, 0.36), lidMat);
    lip.position.set(0.22, TY + 0.018, 0);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.012, 0.1), darkMat);
    panel.position.set(0.36, 0.356, 0.15);
    const btnR = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.014, 16), redMat);
    btnR.position.set(0.3, 0.366, 0.15);
    const btnY = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.014, 16), yelMat);
    btnY.position.set(0.35, 0.366, 0.15);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.36, 24), lidMat);
    drum.rotation.x = Math.PI / 2; drum.position.set(0.5, 0.2, 0.0);
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.006), darkMat);
    win.position.set(0.5, 0.19, 0.251);
    // the ink drum bulging out of the front, a paper feed tray with a stack of blank sheets on the right
    drum.rotation.set(0, 0, Math.PI / 2); drum.position.set(0.49, 0.17, 0.2);
    const drumCap = (x: number) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 24), redMat); c.rotation.z = Math.PI / 2; c.position.set(x, 0.17, 0.2); return c; };
    const feed = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.008, 0.34), lidMat);
    feed.position.set(0.86, 0.2, 0); feed.rotation.z = 0.28;
    const stack = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.3), worldMaterial([0.0, 0.02, 0.03], [0.1, 0.35, 0.0], { cell: 0.0012 }));
    stack.position.set(0.86, 0.235, 0); stack.rotation.z = 0.28;
    const vent = (y: number) => { const v = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.006, 0.004), darkMat); v.position.set(0.49, y, 0.251); return v; };
    this.machine.add(body, lid, slot, lip, panel, btnR, btnY, drum, drumCap(0.33), drumCap(0.65), feed, stack, vent(0.06), vent(0.075), vent(0.09));
    void win;
    this.world.add(this.machine);
  }

  // ------------------------------------------------------------------ sheets and their plates
  private buildSheets() {
    const L0 = this.L0, L1 = this.L1, L2 = this.L2;
    const [d0, d1, d2, d3, d4, d5, d6] = this.db as [number, number, number, number, number, number, number];
    const Wmm = SHEET_W * 1000, Hmm = SHEET_H * 1000;
    const dyn = (a: number, b: number) => (t: number) => String(frameIdx(clamp(t, a, b)));
    const tq = (a: number, b: number, t: number) => frameIdx(clamp(t, a, b)) / 60;

    // ---- A: the test. Headline = "Watch it try to do the simplest thing!", the prompt being typed, the strawberry.
    const aWords = placeRows(L0, [
      { words: [0, 1, 2, 3, 4], size: 40, x: 22, y: 70 },
      { words: [5, 6, 7], size: 40, x: 22, y: 116 },
    ]);
    const prompt = plain('how many r’s in "strawberry"?');
    const typeFrom = d0 - 0.55, typeTo = L0.words[6]!.start + 0.1;
    const A = new RisoSheet(SHEET_W, SHEET_H, (s, tc, time) => {
      const t = tq(d0 - 0.6, L0.end + 0.4, time);
      regMarks(s, Wmm, Hmm);
      s.font = font(MONO, 5.2); s.fillStyle = sep(0, 1, 0);
      s.fillText('PROOF No. 07 — CHATBOT TEST', 22, 26);
      s.fillStyle = sep(1, 0, 0); s.fillText('2 DRUMS · RED / BLUE', Wmm - 22 - measure('2 DRUMS · RED / BLUE', MONO, 5.2), 26);
      // a big yellow sun behind the strawberry
      tc.fillStyle = sep(0, 0, 0.55); tc.beginPath(); tc.arc(340, 92, 62, 0, Math.PI * 2); tc.fill();
      tc.fillStyle = sep(0.12, 0, 0); tc.fillRect(22, 150, 250, 3);
      for (const p of aWords) printWord(s, tc, p, t);
      // the prompt box
      const bx = 22, by = 196, bw = Wmm - 44, bh = 64;
      s.lineWidth = 1.2; s.strokeStyle = sep(0, 1, 0); s.strokeRect(bx, by, bw, bh);
      tc.fillStyle = sep(0, 0.14, 0.3); tc.fillRect(bx, by, bw, bh);
      s.fillStyle = sep(1, 0, 0); s.font = font(MONO, 6);
      s.fillText('you → chatbot', bx + 6, by - 4);
      const n = Math.floor(clamp((t - typeFrom) / (typeTo - typeFrom)) * prompt.length);
      s.fillStyle = sep(0, 1, 0); s.font = font(MONO, 13.5);
      const shown = prompt.slice(0, n);
      s.fillText(shown, bx + 9, by + 40);
      const cx = bx + 9 + measure(shown, MONO, 13.5);
      if (n < prompt.length || Math.floor(this.ctx.audio.beatAt(t) * 2) % 2 === 0) { s.fillStyle = sep(1, 0, 0); s.fillRect(cx + 1, by + 28, 7, 14); }
      s.font = font(MONO_R, 5); s.fillStyle = sep(0, 1, 0);
      s.fillText('[ send ↵ ]', bx + bw - 34, by + bh - 7);
    }, dyn(d0 - 0.6, L0.end + 0.4), { seed: 1 });
    A.setIllus(this.illus.rt.texture, this.rectUV([262, 20, 150, 150], Wmm, Hmm));

    // ---- B: "It can't count the R's in / STRAWBERRY," with the proofreader counting 1-2-3 and the token cut.
    const heroFam = F.display(75, 800);
    const heroWord = L1.words[6]!;
    const heroSize = fitSize(heroWord.w, heroFam, Wmm - 44, 140);
    const bWords = [
      ...placeRows(L1, [{ words: [0, 1, 2, 3, 4, 5], size: 30, x: 22, y: 58 }]),
      { w: heroWord, x: 22, y: 170, size: heroSize, fam: heroFam, held: true } as Placed,
    ];
    // "R's" is the chorus's big hit: its drums arrive far out of register and slam together
    const rsP = bWords.find((p) => p.w === L1.words[4])!;
    rsP.amp = 2.6;
    this.rsMM = [rsP.x + measure(rsP.w.w, HEAD, rsP.size) / 2, rsP.y - rsP.size * 0.36];
    const heroGlyphs = Array.from(heroWord.w);
    const rIdx = heroGlyphs.map((c, i) => (c.toLowerCase() === 'r' ? i : -1)).filter((i) => i >= 0);
    const cutIdx = heroGlyphs.join('').toLowerCase().indexOf('berry');
    const B = new RisoSheet(SHEET_W, SHEET_H, (s, tc, time) => {
      const t = tq(L1.start - 0.5, d3 + 0.3, time);
      regMarks(s, Wmm, Hmm);
      s.font = font(MONO, 5.2); s.fillStyle = sep(0, 1, 0);
      s.fillText('PROOF No. 08 — LETTER COUNT', 22, 24);
      tc.fillStyle = sep(0, 0, 0.5); tc.fillRect(0, 76, Wmm, 108);
      for (const p of bWords) {
        if (p.w !== heroWord) { printWord(s, tc, p, t); continue; }
        // the hero word: the R's printed in the red drum only, everything else overprinted
        if (t < p.w.start - ANT) continue;
        const hx = (i: number) => p.x + glyphX(p.w.w, i, heroFam, heroSize);
        for (let i = 0; i < heroGlyphs.length; i++) {
          const isR = rIdx.includes(i);
          printWord(s, tc, { ...p, w: { ...p.w, w: heroGlyphs[i]! }, x: hx(i), inks: isR ? [1, 0] : [1, 1] }, t);
        }
      }
      // the count: red pencil loops around each R, numbered
      rIdx.forEach((gi, n) => {
        const ct = this.countT[n] ?? 1e9;
        const pp = prog(t, ct, ct + 0.14, ease.outCubic);
        if (pp <= 0) return;
        const x0 = 22 + glyphX(heroWord.w, gi, heroFam, heroSize), x1 = 22 + glyphX(heroWord.w, gi + 1, heroFam, heroSize);
        pencilLoop(s, (x0 + x1) / 2, 170 - heroSize * 0.34, (x1 - x0) * 0.72, heroSize * 0.45, pp, gi * 3.1, 1.3);
        s.font = font(HAND, 22); s.fillStyle = sep(1, 0, 0);
        s.globalAlpha = 1;
        if (pp > 0.5) s.fillText(String(n + 1), (x0 + x1) / 2 - 5, 170 - heroSize * 0.86);
      });
      // the token cut: what the model actually sees
      const tp = prog(t, this.tokenT, this.tokenT + 0.2, ease.outCubic);
      if (tp > 0) {
        const cx = 22 + glyphX(heroWord.w, cutIdx, heroFam, heroSize) - 1.5;
        s.strokeStyle = sep(0, 1, 0); s.lineWidth = 0.9; s.setLineDash([3, 2.2]);
        s.beginPath(); s.moveTo(cx, 180 - (180 - 60) * tp); s.lineTo(cx, 186); s.stroke(); s.setLineDash([]);
        s.font = font(MONO_R, 5.5); s.fillStyle = sep(0, 1, 0); s.fillText('✂', cx - 2.4, 192);
        const chip = (label: string, x: number) => {
          const w = measure(label, MONO, 12) + 12;
          tc.fillStyle = sep(0, 0, 0.9); tc.fillRect(x, 214, w, 24);
          s.lineWidth = 0.8; s.strokeStyle = sep(0, 1, 0); s.strokeRect(x, 214, w, 24);
          s.font = font(MONO, 12); s.fillStyle = sep(0, 1, 0); s.fillText(label, x + 6, 231);
          return w;
        };
        s.globalAlpha = 1;
        s.font = font(F.serif(true), 11); s.fillStyle = sep(1, 0, 0);
        s.fillText('what the model sees:', 22, 208);
        const w1 = chip('straw', 22);
        chip('berry', 22 + w1 + 4);
        s.font = font(MONO_R, 5); s.fillStyle = sep(1, 0, 0);
        s.fillText('2 tokens · 0 letters', 22, 250);
      }
    }, dyn(L1.start - 0.5, d3 + 0.3), { seed: 2 });

    // ---- C: the chatbot's slip. "There are 2 R's in "strawberry"."
    const CW = 0.16, CH = 0.24;
    const C = new RisoSheet(CW, CH, (s, tc) => {
      const w = CW * 1000, h = CH * 1000;
      regMarks(s, w, h, [1, 1, 0]);
      tc.fillStyle = sep(0, 0.16, 0); tc.fillRect(0, 0, w, 40);
      // an original chatbot mark: a rounded screen with two dot eyes
      s.lineWidth = 1.2; s.strokeStyle = sep(0, 1, 0);
      s.beginPath(); s.roundRect(14, 14, 18, 14, 3); s.stroke();
      s.fillStyle = sep(0, 1, 0); s.beginPath(); s.arc(20, 21, 1.4, 0, 7); s.arc(26, 21, 1.4, 0, 7); s.fill();
      s.font = font(MONO, 9); s.fillStyle = sep(0, 1, 0); s.fillText('chatbot', 38, 25);
      s.font = font(F.display(100, 800), 128); s.fillStyle = sep(1, 0, 0);
      s.fillText('2', w / 2 - measure('2', F.display(100, 800), 128) / 2, 150);
      tc.fillStyle = sep(0.35, 0, 0); tc.beginPath(); tc.arc(w / 2, 108, 54, 0, 7); tc.fill();
      s.font = font(MONO, 9.6); s.fillStyle = sep(0, 1, 0);
      s.fillText(plain('There are 2 R’s'), 14, 182);
      s.fillText(plain('in "strawberry".'), 14, 196);
      s.font = font(MONO_R, 5.4); s.fillStyle = sep(1, 0, 0);
      s.fillText('confidence: very high', 14, 222);
    }, () => 'static', { seed: 3 });

    // ---- D: "It can't fill a / glass of / wine," + the half-full glass, the BRIM ring and the gap.
    const dWords = placeRows(L2, [
      { words: [0, 1, 2, 3], size: 34, x: 22, y: 62 },
      { words: [4, 5], size: 60, x: 22, y: 128 },
      { words: [6], size: 92, x: 22, y: 216 },
    ]);
    const gr = this.glassRect;
    const D = new RisoSheet(SHEET_W, SHEET_H, (s, tc, time) => {
      const t = tq(L2.start - 0.5, d6, time);
      regMarks(s, Wmm, Hmm);
      s.font = font(MONO, 5.2); s.fillStyle = sep(0, 1, 0);
      s.fillText('PROOF No. 09 — FILL TEST', 22, 24);
      const vis = 1 - prog(t, d6 - 0.95, d6 - 0.7);
      tc.fillStyle = sep(0, 0, 0.45 * vis); tc.beginPath(); tc.ellipse(gr[0] + gr[2] / 2, gr[1] + gr[3] * 0.84, 70, 28, 0, 0, 7); tc.fill();
      for (const p of dWords) printWord(s, tc, p, t);
      // the image slot the chatbot fills: a dashed frame with the prompt inside, until the glass is printed over it
      s.strokeStyle = sep(0, 1, 0); s.lineWidth = 0.6; s.setLineDash([2.5, 2]);
      s.strokeRect(gr[0], gr[1], gr[2], gr[3]); s.setLineDash([]);
      const pr = 'a wine glass filled to the brim';
      if (t < d4) {
        s.font = font(MONO, 5.6); s.fillStyle = sep(1, 0, 0); s.fillText('image prompt:', gr[0] + 8, gr[1] + gr[3] / 2 - 12);
        s.font = font(MONO, 8.4); s.fillStyle = sep(0, 1, 0);
        s.fillText('a wine glass', gr[0] + 8, gr[1] + gr[3] / 2 + 2); s.fillText('filled to the brim', gr[0] + 8, gr[1] + gr[3] / 2 + 13);
      } else {
        s.font = font(MONO, 5.6); s.fillStyle = sep(1, 0, 0); s.fillText('prompt:', gr[0], gr[1] + gr[3] + 11);
        s.font = font(MONO_R, 6.2); s.fillStyle = sep(0, 1, 0); s.fillText(pr, gr[0] + measure('prompt: ', MONO, 5.6), gr[1] + gr[3] + 11);
      }
      // annotations tied to the 3D glass (projected through the illustration camera)
      const on = prog(t, d4 + 0.1, d4 + 0.35, ease.outCubic) * vis;
      if (on > 0) {
        const toMM = (u: number, v: number): [number, number] => [gr[0] + u * gr[2], gr[1] + (1 - v) * gr[3]];
        const [rx, ry] = toMM(...this.illus.projectGlass(-(GLASS.rimR + 0.035), GLASS.rimY, 0));
        const [, wy] = toMM(...this.illus.projectGlass(-GLASS.wineR, GLASS.wineY, 0));
        s.strokeStyle = sep(1, 0, 0); s.lineWidth = 0.8;
        s.beginPath(); s.moveTo(rx - 2, ry); s.lineTo(rx - 2 - 22 * on, ry); s.stroke();
        s.font = font(F.display(100, 800), 11); s.fillStyle = sep(1, 0, 0);
        s.fillText('BRIM', rx - 26 - measure('BRIM', F.display(100, 800), 11), ry + 4);
        const gp = prog(t, d5 + 0.12, d5 + 0.4, ease.outCubic) * vis;
        if (gp > 0) {
          const bx = rx - 8;
          s.lineWidth = 1.2; s.beginPath();
          s.moveTo(bx + 3, ry); s.lineTo(bx, ry); s.lineTo(bx, ry + (wy - ry) * gp); s.lineTo(bx + 3, ry + (wy - ry) * gp); s.stroke();
          s.font = font(HAND, 17); s.fillText('gap!', bx - 30, (ry + wy) / 2 + 6);
          s.font = font(F.serif(true), 8.5); s.fillStyle = sep(0, 1, 0);
          s.fillText('half full', bx - 30, wy + 12);
        }
      }
    }, dyn(L2.start - 0.5, d6), { seed: 4 });
    D.setIllus(this.illus.rt.texture, this.rectUV(gr, Wmm, Hmm));

    // ---- E: the chatbot's claim.
    const EW = 0.17, EH = 0.2;
    const E = new RisoSheet(EW, EH, (s, tc) => {
      const w = EW * 1000, h = EH * 1000;
      regMarks(s, w, h);
      tc.fillStyle = sep(0, 0.16, 0); tc.fillRect(0, 0, w, 40);
      s.lineWidth = 1.2; s.strokeStyle = sep(0, 1, 0);
      s.beginPath(); s.roundRect(14, 14, 18, 14, 3); s.stroke();
      s.fillStyle = sep(0, 1, 0); s.beginPath(); s.arc(20, 21, 1.4, 0, 7); s.arc(26, 21, 1.4, 0, 7); s.fill();
      s.font = font(MONO, 9); s.fillText('chatbot', 38, 25);
      s.font = font(MONO, 11); s.fillStyle = sep(0, 1, 0);
      s.fillText(plain('Here’s a wine glass'), 14, 70);
      s.fillText('filled to the brim!', 14, 86);
      s.font = font(F.display(100, 800), 44); s.fillStyle = sep(1, 0, 0);
      s.fillText('100%', 14, 150);
      tc.fillStyle = sep(0, 0, 0.8); tc.fillRect(12, 112, 118, 46);
      s.font = font(MONO_R, 5.4); s.fillStyle = sep(1, 0, 0);
      s.fillText('filled: 100% · brim: yes', 14, 180);
    }, () => 'static', { seed: 5 });

    this.sheets = { A, B, C, D, E };
    for (const sh of Object.values(this.sheets)) this.world.add(sh.root);
    void d1; void d2;
  }

  private rectUV(r: [number, number, number, number], Wmm: number, Hmm: number): [number, number, number, number] {
    return [r[0] / Wmm, 1 - (r[1] + r[3]) / Hmm, r[2] / Wmm, r[3] / Hmm];
  }

  // ------------------------------------------------------------------ per-frame
  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const { renderer, comp } = this.ctx;
    const t = f.t;
    const [d0, d1, d2, d3, d4, d5, d6] = this.db as [number, number, number, number, number, number, number];
    const shot = t < d1 ? 1 : t < d2 ? 2 : t < d3 ? 3 : t < d4 ? 4 : t < d5 ? 5 : 6;
    const { A, B, C, D, E } = this.sheets;
    const C3 = this.C3, C5 = this.C5;
    for (const s of Object.values(this.sheets)) { s.root.visible = false; s.u.uBow!.value = 0; s.u.uCurl!.value = 0; s.u.uCurlL!.value = 0; s.u.uWave!.value = 0; }
    this.machine.visible = shot <= 2; this.tray.visible = shot <= 2;
    for (const m of (s => s.u.uLocalMis!.value as THREE.Vector2[])(B)) m.set(0, 0);

    // drum misregistration: jumps to a new offset on every snare (springy), everything snaps home on the "R's" downbeat
    const mis = inkUniforms.uMis.value;
    const si = this.snares.filter((s) => s <= t).length - 1;
    const J = (i: number, k: number): [number, number] => (i < 0 ? [0, 0] : [(hash(i, k, 1) - 0.5) * 1.6, (hash(i, k, 2) - 0.5) * 1.6]);
    const snap = t >= d2 ? 1 - Math.exp(-(t - d2) * 3) : 1;
    for (let k = 0; k < 3; k++) {
      const a = J(si - 1, k), b = J(si, k);
      const sp = si >= 0 ? springStep(t - this.snares[si]!, 5, 0.35) : 0;
      mis[k]!.set((lerp(a[0], b[0], sp) + [0.25, -0.2, 0.1][k]!) * snap, (lerp(a[1], b[1], sp) + [-0.15, 0.2, 0.3][k]!) * snap);
    }

    const cam = this.cam;
    let roll = 0, fov = 32;
    const up = new THREE.Vector3(0, 1, 0);
    const P = new THREE.Vector3(), T = new THREE.Vector3();
    const kv = (ks: [number, V3, ((x: number) => number)?][]): V3 => [0, 1, 2].map((i) => keys(t, ks.map(([tt, v, e]) => [tt, v[i]!, e] as Key))) as V3;
    const shadows: { x: number; z: number; hw: number; hh: number; yaw: number; lift: number; s: number }[] = [];
    const trayShadows: typeof shadows = [];

    // the illustration this frame: the glass once sheet D is in play, else the strawberry
    let illusGlass = false;

    if (shot <= 2) {
      // ----- S1: the test sheet in the tray; S2: the duplicator feeds the next sheet out on the kick fill
      A.root.visible = true;
      A.pose(-0.01, TY + 0.0012, 0.0, 0.02);
      A.u.uCurl!.value = 0.004;
      trayShadows.push({ x: -0.01, z: 0, hw: SHEET_W / 2, hh: SHEET_H / 2, yaw: 0.02, lift: 0.0012, s: 0.5 });
      shadows.push({ x: 0.49, z: 0, hw: 0.26, hh: 0.25, yaw: 0, lift: 0.004, s: 0.85 });
      shadows.push({ x: -0.02, z: 0, hw: 0.26, hh: 0.21, yaw: 0, lift: 0.004, s: 0.85 });
      if (shot === 1) {
        P.set(...kv([[d0, [-0.15, TY + 0.1, 0.24]], [d0 + 0.6, [-0.06, TY + 0.3, 0.27], ease.outCubic], [d1, [-0.02, TY + 0.27, 0.15], ease.inOutCubic]]));
        T.set(...kv([[d0, [-0.1, TY, 0.08]], [d0 + 0.6, [-0.03, TY, 0.02], ease.outCubic], [d1, [-0.05, TY, -0.04], ease.inOutCubic]]));
        roll = keys(t, [[d0, -0.1], [d0 + 0.6, 0.0, ease.outCubic], [d1, 0.035]]);
      } else {
        // the feed: three jerks on the three kicks, then the sheet runs out as "It can't count the" prints
        const [k1, k2, k3] = this.kicks as [number, number, number];
        const step = (k: number) => prog(t, k, k + 0.09, ease.outCubic);
        const fed = 0.13 * (step(k1) + step(k2) + step(k3)) + 0.5 * prog(t, L1s(this), d2, ease.inOutQuad);
        B.root.visible = true;
        B.pose(0.232 + SHEET_W / 2 - fed * SHEET_W, TY + 0.004, 0.0, 0.0);
        B.u.uBow!.value = 0.003;
        trayShadows.push({ x: 0.232 + SHEET_W / 2 - fed * SHEET_W, z: 0, hw: SHEET_W / 2, hh: SHEET_H / 2, yaw: 0, lift: 0.004, s: 0.5 });
        // the drums slip further out of register with every kick: the wind-up
        const wind = step(k1) + step(k2) + step(k3);
        const lm = B.u.uLocalMis!.value as THREE.Vector2[];
        lm[0]!.set(0.8 * wind, -0.5 * wind); lm[1]!.set(-0.8 * wind, 0.45 * wind);
        // camera: steps back on each kick (hold the breath), then accelerates into the downbeat
        const back = 1 + 0.12 * (step(k1) + step(k2) + step(k3));
        const T0 = new THREE.Vector3(0.14, TY + 0.02, -0.02), P0 = new THREE.Vector3(-0.42, 0.5, 0.62);
        const Tin = new THREE.Vector3(0.03, TY, -0.085), Pin = new THREE.Vector3(-0.03, 0.33, 0.1);
        const push = prog(t, L1s(this) - 0.1, d2, ease.inOutQuad);
        const drift = prog(t, d1, d1 + 0.35, ease.outCubic);
        T.copy(T0).lerp(Tin, push);
        P.copy(P0).sub(T0).multiplyScalar(back * lerp(0.85, 1, drift)).add(T0).lerp(Pin, push);
        P.x += 0.04 * drift;
        roll = -0.03 - 0.08 * push;
        fov = 32 - 4 * push;
      }
    } else if (shot <= 4) {
      // ----- S3: sheet B slaps onto the cutting mat on the "R's" downbeat; the proofreader counts
      const land = (t0: number, h: number) => {
        const fall = prog(t, t0, t0 + 0.09, ease.inQuad);
        const u = t - t0 - 0.09;
        return { y: lerp(h, 0, fall), bow: u > 0 ? 0.012 * Math.exp(-u * 8) * (0.5 + 0.5 * Math.cos(u * 34)) : 0.012 };
      };
      const lb = land(d2, 0.035);
      B.root.visible = true;
      const bx = C3.x + 0.03 * (1 - prog(t, d2, d2 + 0.3, ease.outExpo));
      B.pose(bx, 0.0012 + lb.y, C3.z, -0.05, 0.05 * (1 - prog(t, d2, d2 + 0.12)));
      B.u.uBow!.value = lb.bow;
      shadows.push({ x: bx, z: C3.z, hw: SHEET_W / 2, hh: SHEET_H / 2, yaw: -0.05, lift: 0.0012 + lb.y, s: 0.6 });
      if (shot === 3) {
        up.set(0, 0, -1);
        const cxs = [-0.13, 0.03, 0.07];
        const trackX = keys(t, [[d2, 0.0], [this.countT[0]!, cxs[0]! * 0.6, ease.inOutCubic], [this.countT[1]!, cxs[1]!, ease.inOutCubic], [this.countT[2]!, cxs[2]!, ease.outCubic], [d3, 0.04]]);
        P.set(...kv([[d2, [0.05, 1.05, 0.16]], [d2 + 0.3, [0.0, 0.58, 0.05], ease.outExpo], [this.countT[0]!, [0.0, 0.5, 0.045], ease.inOutCubic], [d3, [0.0, 0.38, 0.06], ease.inOutCubic]]));
        P.x += trackX; P.add(C3);
        T.set(C3.x + trackX, 0, C3.z - 0.004 + keys(t, [[d2 + 0.3, 0], [d3, -0.012]]));
        // the hit itself: slammed in close on "R's" as its two drums crash into register, then out to the hero word
        const wS = this.L1.words[6]!;
        const rs = new THREE.Vector3(this.rsMM[0] / 1000 - SHEET_W / 2, 0, this.rsMM[1] / 1000 - SHEET_H / 2).applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.05).add(new THREE.Vector3(bx, 0, C3.z));
        const h = keys(t, [[d2, 0.26], [d2 + 0.1, 0.12, ease.outExpo], [wS.start - 0.1, 0.15, ease.linear]]);
        const Pc = rs.clone().add(new THREE.Vector3(-0.01 + 0.03 * prog(t, d2, wS.start), h, 0.035));
        const out = prog(t, wS.start - 0.14, wS.start + 0.26, ease.inOutCubic);
        P.lerpVectors(Pc, P, out);
        T.lerpVectors(rs.clone().add(new THREE.Vector3(0.012 * prog(t, d2, wS.start), 0, 0)), T, out);
        roll = 0.16 * (1 - springStep(t - d2, 2.2, 0.5)) - 0.09 * prog(t, d2 + 0.3, d3, ease.inOutCubic);
      } else {
        // ----- S4: the chatbot's slip lands next to it: "2"; then sheet D is slid in for the next line
        const lc = land(d3, 0.05);
        const cx = C3.x + 0.285, cz = C3.z + 0.03, cyaw = -0.3;
        C.root.visible = true;
        C.pose(cx, 0.0022 + lc.y, cz, cyaw, -0.04 * (1 - prog(t, d3, d3 + 0.09)));
        C.u.uBow!.value = lc.bow * 0.6;
        shadows.push({ x: cx, z: cz, hw: 0.08, hh: 0.12, yaw: cyaw, lift: 0.0022 + lc.y, s: 0.65 });
        const slideT = this.L2.start - 0.2;
        const sl = prog(t, slideT, slideT + 0.28, ease.outExpo);
        if (t > slideT - 0.1) {
          D.root.visible = true;
          const dx = lerp(C5.x - 0.45, C5.x, sl), dyaw = lerp(0.4, 0.03, sl);
          D.pose(dx, 0.0012, C5.z + 0.05 * (1 - sl), dyaw);
          D.u.uWave!.value = 0.004 * (1 - sl); D.u.uWaveP!.value = t * 30;
          D.u.uCurlL!.value = 0.01 * (1 - sl);
          shadows.push({ x: dx, z: C5.z, hw: SHEET_W / 2, hh: SHEET_H / 2, yaw: dyaw, lift: 0.002 + 0.01 * (1 - sl), s: 0.6 });
          illusGlass = true;
        }
        const Cv = new THREE.Vector3(cx, 0, cz);
        const pullT = prog(t, d3, slideT, ease.outCubic);
        const pan = prog(t, slideT - 0.02, slideT + 0.42, ease.inOutCubic);
        const settle = prog(t, slideT + 0.42, d4, ease.inQuad);
        const Tc = Cv.clone().add(new THREE.Vector3(-0.03, 0, -0.03));
        const Tw = C3.clone().add(new THREE.Vector3(0.16, 0, 0.0));
        const Td = C5.clone().add(new THREE.Vector3(-0.07, 0, -0.05));
        T.copy(Tc).lerp(Tw, pullT).lerp(Td, pan);
        const Pc = Cv.clone().add(new THREE.Vector3(0.13, 0.13, 0.12));
        const Pw = C3.clone().add(new THREE.Vector3(0.3, 0.36, 0.3));
        const Pd = C5.clone().add(new THREE.Vector3(0.0, 0.36, 0.2)).lerp(C5.clone().add(new THREE.Vector3(-0.05, 0.3, 0.12)), settle);
        P.copy(Pc).lerp(Pw, pullT).lerp(Pd, pan);
        const punch = 1 - ease.outExpo(prog(t, d3, d3 + 0.35));
        P.lerp(T, -0.3 * punch);
        roll = -0.12 * (1 - pullT) + 0.05 * Math.sin(pan * Math.PI);
      }
    } else {
      // ----- S5: the glass is printed on "glass"; S6: the claim slip, the gap, and the rim becomes a circle
      illusGlass = true;
      D.root.visible = true;
      D.pose(C5.x, 0.0012, C5.z, 0.03);
      shadows.push({ x: C5.x, z: C5.z, hw: SHEET_W / 2, hh: SHEET_H / 2, yaw: 0.03, lift: 0.0012, s: 0.6 });
      B.root.visible = true; B.pose(C3.x, 0.0012, C3.z, -0.05);
      shadows.push({ x: C3.x, z: C3.z, hw: SHEET_W / 2, hh: SHEET_H / 2, yaw: -0.05, lift: 0.0012, s: 0.6 });
      C.root.visible = true; C.pose(C3.x + 0.285, 0.0022, C3.z + 0.03, -0.3);
      const gx = C5.x + (this.glassRect[0] + this.glassRect[2] / 2) / 1000 - SHEET_W / 2 + 0.0;
      const gz = C5.z + (this.glassRect[1] + this.glassRect[3] * 0.42) / 1000 - SHEET_H / 2;
      if (shot === 5) {
        up.set(0, 0, -1);
        const orb = keys(t, [[d4, -0.4], [d5, 0.12, ease.outCubic]]);
        const h = keys(t, [[d4, 0.66], [d4 + 0.28, 0.47, ease.outExpo], [d5, 0.4, ease.inOutCubic]]);
        const cen = new THREE.Vector3(C5.x + 0.015, 0, C5.z - 0.005);
        T.copy(cen);
        P.set(cen.x + Math.sin(orb) * 0.1, h, cen.z + Math.cos(orb) * 0.1);
        up.set(-Math.sin(orb), 0, -Math.cos(orb));
        roll = 0;
      } else {
        const le = this.L2.words[6]!.end;
        const lE = (() => { const fall = prog(t, d5, d5 + 0.09, ease.inQuad); return lerp(0.05, 0, fall); })();
        E.root.visible = true;
        const ex = C5.x - SHEET_W / 2 + 0.39 + 0.3 * ease.inCubic(prog(t, le + 0.2, d6 - 0.2)), ez = C5.z - SHEET_H / 2 + 0.262, eyaw = -0.12;
        E.pose(ex, 0.0022 + lE, ez, eyaw);
        shadows.push({ x: ex, z: ez, hw: 0.085, hh: 0.1, yaw: eyaw, lift: 0.0022 + lE, s: 0.65 });
        // plate mm -> world on sheet D (it lies nearly square to the axes)
        const onD = (x: number, y: number) => new THREE.Vector3(C5.x - SHEET_W / 2 + x / 1000, 0, C5.z - SHEET_H / 2 + y / 1000);
        const top = prog(t, le + 0.05, d6 - 0.12, ease.inOutCubic);
        const drift = prog(t, d5, le + 0.05, ease.outCubic);
        // low across the sheet: "wine," in the foreground, the gap under the BRIM behind it
        const Tg = onD(262, 168).lerp(onD(275, 158), drift);
        const Pg = onD(215, 470).add(new THREE.Vector3(0, 0.34, 0)).lerp(onD(245, 440).add(new THREE.Vector3(0, 0.3, 0)), drift);
        // then straight down the glass: the rim is a circle
        const cen = onD(this.glassRect[0] + this.glassRect[2] / 2, this.glassRect[1] + this.glassRect[3] / 2);
        const Ttop = cen.clone(), Ptop = cen.clone().add(new THREE.Vector3(0, 0.34, 0.0005));
        P.copy(Pg).lerp(Ptop, top);
        T.copy(Tg).lerp(Ttop, top);
        up.set(0, 1, 0).lerp(new THREE.Vector3(0, 0, -1), ease.inQuad(top)).normalize();
        roll = 0.05 * (1 - top) - 0.04 * ease.inOutCubic(top);
        void gx; void gz;
        fov = 32 - 6 * top;
      }
    }

    // illustration pass (3D in ink separations)
    if (illusGlass) {
      const top = shot === 6 ? prog(t, this.L2.words[6]!.end + 0.05, d6 - 0.1, ease.inOutCubic) : 0;
      const slosh = 0.05 * Math.sin(t * 5.3) * Math.exp(-Math.max(0, t - d4) * 0.6) + 0.02 * Math.sin(t * 2.1);
      this.illus.renderGlass(renderer, lerp(0.16, Math.PI / 2, top), slosh * (1 - top), this.glassRect[2] / this.glassRect[3], 1);
      const w = (t0: number) => prog(t, t0, t0 + 0.2, ease.inOutQuad);
      (D.u.uIllusWipe!.value as THREE.Vector3).set(w(d4 - 0.02), w(d4 + 0.07), 1);
    } else {
      this.illus.renderBerry(renderer, t * 1.3, 0.1 * Math.sin(t * 2));
    }

    // plates (only the sheets on screen, only when their content changed)
    for (const s of Object.values(this.sheets)) if (s.root.visible) s.update(t);

    // shadows on the mat and the tray
    this.fillShadows(this.tableMat, shadows);
    this.fillShadows(this.trayMat, trayShadows.map((s) => ({ ...s, lift: s.lift })));

    // camera (snare jolts are the drums slamming)
    const jolt = this.ctx.audio.hit('snare', t, 0.05) * 0.0025;
    cam.fov = fov; cam.updateProjectionMatrix();
    cam.position.copy(P).add(new THREE.Vector3(jolt * (hash(frameIdx(t), 1) - 0.5), 0, jolt * (hash(frameIdx(t), 2) - 0.5)));
    cam.up.copy(up);
    cam.lookAt(T);
    cam.rotateZ(roll);

    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0xe9e3d6, 1);
    renderer.clear(true, true, true);
    renderer.render(this.world, cam);
    comp.draw(renderer, this.rt.texture, out, { mode: 'replace' });
    return { bloom: 0, halation: 0, ca: 0, grain: 0.03, vignette: 0.3 };
  }

  private fillShadows(m: THREE.RawShaderMaterial, list: { x: number; z: number; hw: number; hh: number; yaw: number; lift: number; s: number }[]) {
    const A = m.uniforms.uShA!.value as THREE.Vector4[], B = m.uniforms.uShB!.value as THREE.Vector4[];
    const n = Math.min(list.length, MAX_SHADOWS);
    for (let i = 0; i < n; i++) {
      const s = list[i]!;
      A[i]!.set(s.x, s.z, s.hw, s.hh);
      B[i]!.set(Math.cos(s.yaw), -Math.sin(s.yaw), s.lift, s.s);
    }
    m.uniforms.uShN!.value = n;
  }
}

/** Start of the chorus's first line (the feed accelerates from here into the "R's" downbeat). */
function L1s(s: RisoScene) { return s.L1.start; }
