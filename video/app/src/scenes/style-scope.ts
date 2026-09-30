// Phase-1 style "scope": an oscilloscope vector display. Everything is drawn by one electron beam on a
// P3-amber tube that sits in 3D (curved glass, etched graticule, bezel, knobs). The displayed world is
// wireframe 3D projected through its own moving camera; the phosphor afterglow is the display summed at
// a few past times (pure function of t). Lyrics are pen-written by the beam, word-synced.
import * as THREE from 'three';
import { Scene, type Frame } from '../engine/scene';
import { FSPass, makeRT, clearRT, W, H } from '../engine/gl';
import { F, font } from '../engine/type';
import { strokeText, type StrokeText } from '../engine/stroke';
import type { Line } from '../engine/lyrics';
import { clamp, ease, frameIdx, hash, keys, lerp, pulse, smoothstep, springStep, type V2 } from '../engine/util';
import type { StyleNote } from '../styles/registry';
import { Beam, circle3, onPlane, p3, rrect2, subdiv, mix2, yawPlane, type P3, type Plane } from './style-scope-beam';
import { Written } from './style-scope-text';

export const TITLE = 'Oscilloscope vector display';
export const NOTE: StyleNote = {
  technique:
    'One electron beam draws everything: wireframe 3D (a lathe-turned glass, a strawberry mesh, extruded single-stroke letters) projected through an inner camera into additive GPU beam vectors; the afterglow is the display re-evaluated at 6 past times over 0.2 s, and long vectors dim like a constant-time vector generator. The tube itself is a small analytic ray-traced object (curved face, etched graticule with parallax, bezel, knobs) seen by an outer camera.',
  palette:
    'P3-style amber phosphor on warm black: faint traces fall to deep orange, strong ones saturate to white-hot. Amber rather than green or cyan: it belongs to the video’s warm ink / signal-red / mustard family, reads as 1980s instrument rather than “hacker”, and its orange afterglow gives the wine a colour without a second gun.',
  typography:
    'Single-stroke plotter fonts: EMS Allure script for the narrator (the lyrics), EMS Tech for the chatbot and the UI, Hershey Sans capitals for the hero word; the panel print is condensed Bricolage.',
  lyrics:
    'Pen-written: the beam head writes each word while it is sung (stroke length synced to the word timings); held notes finish early, then the last stroke trembles and the beam keeps tracing the note as a waveform out of the word.',
  cost: 'perf mode (1 sub-frame, incl. post + readback; the smoke scene alone is 8.9 ms): 9.7–11 ms avg, p95 14–18 ms (6 afterglow evaluations, ~30k beam vectors). Full song with motion blur at ~24 sub-frames/frame: about 50 min.',
  risks:
    'Wireframe clutter when objects overlap (hidden lines are dimmed, not removed); the thin script needs size to stay readable; a whole video of amber lines could get monotonous without the tube/knob shots to break it up.',
};

// ------------------------------------------------------------------ layout constants
const SCR = { hw: 0.8, hh: 0.45 }; // phosphor area on the tube face (world half-size), 16:9
const PHOS_PER_WORLD = 1080 / (2 * SCR.hh);
const FILL_DIST = 1.63; // outer camera distance at which the phosphor fills the frame
const PERSIST_N = 6; // afterglow samples
const PERSIST_DT = 0.016; // s between them
const PERSIST_TAU = 0.045; // phosphor decay

const R_IDX = [2, 7, 8]; // the R's in STRAWBERRY
const TAU = Math.PI * 2;

interface Times {
  start: number; end: number;
  d1: number; dR: number; d3: number; dG: number; d5: number;
  kicks: number[]; counts: number[]; snareC: number; snareD: number;
  L0: Line; L1: Line; L2: Line; L3: Line;
}

interface Glyphs3 { st: StrokeText; s: number; x0: number; boxes: { x0: number; x1: number; y0: number; y1: number }[]; rungs: number[][] }

export default class ScopeScene extends Scene {
  private beam = new Beam();
  private phos = makeRT(W, H, { depthBuffer: false });
  private outer = new THREE.PerspectiveCamera(30, 16 / 9, 0.01, 50);
  private T!: Times;
  private tube!: FSPass;
  private panelTex!: THREE.CanvasTexture;

  // text
  private wL0!: Written; private wL1!: Written; private wL2!: Written; private wL3!: Written;
  private wQ!: Written; private wYou!: Written; private wBot!: Written; private wBotD!: Written;
  private wReplyA!: Written; private wReply2!: Written; private wReplyB!: Written;
  private wTokA!: Written; private wTokB!: Written; private wPrompt!: Written; private wYouC!: Written;
  private wClaim1!: Written; private wClaim2!: Written; private wBrim!: Written; private wWine!: Written; private wGap!: Written;
  private nums: StrokeText[] = [];
  private hero!: Glyphs3;

  // geometry (local)
  private fruitRings: P3[][] = []; private fruitMer: P3[][] = []; private seeds: P3[] = []; private calyx: P3[][] = [];
  private glassProf: { r: number; y: number }[] = [];
  private bowl = { y0: 1.35, h: 1.85 };

  override init() {
    const { lyrics: ly, audio: au } = this.ctx;
    const start = this.ctx.start, end = this.ctx.end;
    const L0 = ly.get('Watch it try'), L1 = ly.get("It can't count the R", 0), L2 = ly.get("It can't fill a glass of wine", 0), L3 = ly.get('Every clock says', 0);
    const db = au.downbeats;
    const near = (x: number) => db.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
    const after = (x: number) => db.find((d) => d > x + 0.05) ?? x + 1.39;
    const before = (x: number) => [...db].reverse().find((d) => d < x - 0.05) ?? x - 1.39;
    const dR = near(L1.words[4]!.start), dG = near(L2.words[4]!.start);
    const d1 = before(dR), d3 = after(dR), d5 = after(dG);
    const kicks = au.events('kick', d1 + 0.1, dR - 0.05).map((e) => e[0]).slice(-3);
    const bR = Math.round(au.beatAt(dR));
    const counts = [1, 2, 3].map((i) => au.timeOfBeat(bR + i));
    const snareC = au.events('snare', d3 + 0.05, dG)[0]?.[0] ?? d3 + 0.35;
    const snareD = au.events('snare', dG + 0.7, d5)[0]?.[0] ?? dG + 1.05;
    this.T = { start, end, d1, dR, d3, dG, d5, kicks, counts, snareC, snareD, L0, L1, L2, L3 };

    // lyrics (the narrator writes in script)
    this.wL0 = Written.sung(L0.words, 'hscript', 112);
    this.wL1 = Written.sung(L1.words, 'hscript', 132);
    this.wL2 = Written.sung(L2.words, 'hscript', 92);
    this.wL3 = Written.sung(L3.words, 'hscript', 92);

    // shot A: the question typed into the chatbot
    this.wQ = Written.typed('how many r’s in “strawberry”?', 'tech', 56, start - 0.55, d1 - 0.3, 3);
    this.wYou = Written.typed('you', 'tech', 26, start - 0.6, start - 0.5);
    this.wBot = Written.typed('chatbot', 'tech', 34, start - 2, start - 1.8);
    this.wBotD = Written.typed('chatbot', 'tech', 30, dG + 0.12, dG + 0.3);
    // shot C: the confident reply, the tokens, the next prompt
    const r0 = d3 + 0.03;
    this.wReplyA = Written.typed('There are ', 'tech', 70, r0, r0 + 0.16, 5);
    this.wReply2 = Written.typed('2', 'tech', 150, r0 + 0.17, r0 + 0.24, 6);
    this.wReplyB = Written.typed(' R’s in “strawberry”.', 'tech', 70, r0 + 0.25, r0 + 0.5, 7);
    this.wTokA = Written.typed('“straw”', 'tech', 44, d3 + 0.25, d3 + 0.4, 8);
    this.wTokB = Written.typed('“berry”', 'tech', 44, d3 + 0.3, d3 + 0.45, 9);
    const l2w = L2.words;
    this.wPrompt = Written.typed('a wine glass filled to the brim', 'tech', 56, l2w[0]!.start - 0.1, l2w[3]!.end - 0.02, 11);
    this.wYouC = Written.typed('you', 'tech', 30, l2w[0]!.start - 0.25, l2w[0]!.start - 0.12);
    // shot D: the cheerful claim and the measurement
    this.wClaim1 = Written.typed('Here’s a wine glass', 'tech', 60, dG + 0.2, dG + 0.55, 12);
    this.wClaim2 = Written.typed('filled to the brim!', 'tech', 60, dG + 0.56, dG + 0.9, 13);
    const tBrim = l2w[5]!.start - 0.05; // on "of"
    this.wBrim = Written.typed('BRIM', 'tech', 50, tBrim, tBrim + 0.14, 14);
    this.wWine = Written.typed('WINE', 'tech', 50, tBrim + 0.12, tBrim + 0.26, 15);
    this.wGap = Written.typed('GAP', 'tech', 58, snareD - 0.12, snareD, 16);
    this.nums = ['1', '2', '3'].map((n) => strokeText(n, 'tech', 100));

    this.hero = this.buildHero();
    this.buildFruit();
    this.buildGlass();
    this.buildTube();
  }

  // ------------------------------------------------------------------ geometry
  private buildHero(): Glyphs3 {
    const st = strokeText('STRAWBERRY', 'sans', 100, 6);
    const s = 8.6 / st.width, x0 = -4.3;
    const boxes = Array.from('STRAWBERRY').map(() => ({ x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }));
    st.strokes.forEach((pts, si) => {
      const b = boxes[st.charOf[si]!]!;
      for (const p of pts) { b.x0 = Math.min(b.x0, p.x); b.x1 = Math.max(b.x1, p.x); b.y0 = Math.min(b.y0, -p.y); b.y1 = Math.max(b.y1, -p.y); }
    });
    // rungs between the front and back faces where the stroke turns (and at its ends)
    const rungs = st.strokes.map((pts) => {
      const r: number[] = [0];
      for (let i = 1; i < pts.length - 1; i++) {
        const a = pts[i - 1]!, b = pts[i]!, c = pts[i + 1]!;
        const t1 = Math.atan2(b.y - a.y, b.x - a.x), t2 = Math.atan2(c.y - b.y, c.x - b.x);
        let d = Math.abs(t2 - t1); if (d > Math.PI) d = TAU - d;
        if (d > 0.5 || i % 3 === 0) r.push(i);
      }
      r.push(pts.length - 1);
      return r;
    });
    return { st, s, x0, boxes, rungs };
  }

  private buildFruit() {
    const prof = (s: number) => 0.5 * Math.pow(Math.sin(Math.min(1, s * 1.22) * Math.PI / 2), 0.85) * (1 - 0.5 * smoothstep(0.8, 1, s));
    const pt = (s: number, a: number, out = 1) => {
      const r = prof(s) * (1 + 0.045 * Math.cos(3 * a + s * 2)) * out;
      return p3(Math.cos(a) * r, s, Math.sin(a) * r);
    };
    for (const s of [0.07, 0.17, 0.29, 0.41, 0.53, 0.65, 0.76, 0.86, 0.94]) this.fruitRings.push(Array.from({ length: 49 }, (_, i) => pt(s, (i / 48) * TAU)));
    for (let m = 0; m < 14; m++) this.fruitMer.push(Array.from({ length: 27 }, (_, i) => pt(0.005 + (i / 26) * 0.99, (m / 14) * TAU)));
    for (let row = 0; row < 13; row++) {
      const s = 0.1 + row * 0.066, n = Math.max(5, Math.round((TAU * prof(s)) / 0.11));
      for (let i = 0; i < n; i++) this.seeds.push(pt(s, ((i + (row % 2) * 0.5) / n) * TAU + row * 0.3, 1.03));
    }
    // calyx: six pointed leaves drooping over the shoulders, and the stem
    for (let k = 0; k < 6; k++) {
      const a0 = (k / 6) * TAU + 0.2, leaf: P3[] = [];
      for (let side = -1; side <= 1; side += 2) {
        const half: P3[] = [];
        for (let i = 0; i <= 10; i++) {
          const u = i / 10, r = 0.06 + 0.4 * u, w = 0.13 * Math.sin(Math.PI * Math.pow(u, 0.8)) * side, a = a0 + w / Math.max(r, 0.05);
          half.push(p3(Math.cos(a) * r, 1.0 + 0.05 - 0.2 * u * u, Math.sin(a) * r));
        }
        if (side < 0) leaf.push(...half); else leaf.push(...half.reverse());
      }
      this.calyx.push(leaf);
    }
    this.calyx.push([p3(0, 1.02, 0), p3(0.01, 1.12, 0), p3(0.04, 1.24, 0.01)]);
  }

  private buildGlass() {
    const P: { r: number; y: number }[] = [
      { r: 0.8, y: 0 }, { r: 0.79, y: 0.03 }, { r: 0.55, y: 0.06 }, { r: 0.28, y: 0.1 }, { r: 0.1, y: 0.17 }, { r: 0.055, y: 0.28 },
      { r: 0.05, y: 0.8 }, { r: 0.055, y: 1.28 },
    ];
    const { y0, h } = this.bowl;
    for (let i = 0; i <= 22; i++) { const u = i / 22; P.push({ r: this.bowlR(u), y: y0 + h * u }); }
    this.glassProf = P;
  }
  private bowlR(u: number) { return 0.06 + 0.97 * Math.pow(Math.sin(Math.min(1, u * 1.12) * Math.PI / 2), 0.72) - 0.1 * smoothstep(0.72, 1, u); }

  // ------------------------------------------------------------------ the tube (analytic ray trace)
  private buildTube() {
    const cv = document.createElement('canvas');
    cv.width = 2600; cv.height = 2000;
    const c = cv.getContext('2d')!;
    const P = { x0: -1.3, y0: -1.22, w: 2.6, h: 2.0 };
    const X = (x: number) => ((x - P.x0) / P.w) * cv.width, Y = (y: number) => (1 - (y - P.y0) / P.h) * cv.height;
    c.fillStyle = '#fff'; c.strokeStyle = '#fff';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = font(F.display(75, 600), 44);
    ['INTENSITY', 'FOCUS', 'X GAIN', 'Y GAIN', 'TIME/DIV'].forEach((s, i) => c.fillText(s, X(-0.96 + i * 0.48), Y(-1.0)));
    c.lineWidth = 4;
    for (let i = 0; i < 5; i++) {
      const cx = X(-0.96 + i * 0.48), cy = Y(-0.83);
      for (let k = 0; k <= 10; k++) {
        const a = Math.PI * (0.75 + 1.5 * (k / 10));
        c.beginPath(); c.moveTo(cx + Math.cos(a) * 118, cy + Math.sin(a) * 118); c.lineTo(cx + Math.cos(a) * (k % 5 ? 132 : 142), cy + Math.sin(a) * (k % 5 ? 132 : 142)); c.stroke();
      }
    }
    c.textAlign = 'left'; c.font = font(F.display(75, 800), 50);
    c.fillText('VX-2  VECTOR MONITOR', X(-1.18), Y(0.62));
    c.font = font(F.display(75, 400), 40);
    c.textAlign = 'right';
    c.fillText('CH A  chatbot      CH B  narrator      P3 AMBER', X(1.18), Y(0.62));
    this.panelTex = new THREE.CanvasTexture(cv);
    this.panelTex.anisotropy = 4;

    this.tube = new FSPass(TUBE_FRAG, {
      phos: { value: this.phos.texture }, panelTex: { value: this.panelTex },
      camPos: { value: new THREE.Vector3() }, camRot: { value: new THREE.Matrix3() }, tanF: { value: Math.tan((15 * Math.PI) / 180) },
      knob: { value: [0, 0, 0, 0, 0] }, spill: { value: 0.5 }, tt: { value: 0 }, flick: { value: 1 },
    });
  }

  // ------------------------------------------------------------------ render
  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const { renderer } = this.ctx;
    const t = f.t, T = this.T, B = this.beam;
    B.begin();
    for (let k = 0; k < PERSIST_N; k++) {
      const tk = t - k * PERSIST_DT;
      B.sample(k, Math.exp((-k * PERSIST_DT) / PERSIST_TAU));
      // refresh flicker, and the beam overdrives for a moment on the snap and the cuts
      B.gain = (1 + 0.025 * (hash(frameIdx(tk), 7) - 0.5)) * (1 + 0.9 * pulse(tk, T.dR, 0.08) + 0.4 * Math.max(pulse(tk, T.d3, 0.06), pulse(tk, T.dG, 0.06), pulse(tk, T.d5, 0.06)));
      this.display(tk);
    }
    clearRT(renderer, this.phos, [0, 0, 0]);
    B.lines.render(renderer, this.phos);

    // the outer camera looks at the instrument
    const oc = this.outerCam(t);
    const cam = this.outer;
    cam.position.copy(oc.pos); cam.up.set(0, 1, 0); cam.lookAt(oc.target); cam.rotateZ(oc.roll);
    cam.updateMatrixWorld(true);
    const u = this.tube.u;
    (u.camPos!.value as THREE.Vector3).copy(cam.position);
    (u.camRot!.value as THREE.Matrix3).setFromMatrix4(cam.matrixWorld);
    u.knob!.value = this.knobs(t);
    u.tt!.value = t;
    u.flick!.value = 1 + 0.03 * (hash(frameIdx(t), 3) - 0.5);
    this.tube.render(renderer, out);

    const snap = pulse(t, T.dR, 0.09);
    const sh = snap * 9 + f.a.kick * 1.2;
    return {
      bloom: 0.95, bloomThreshold: 0.55, bloomKnee: 0.6, bloomRadius: 0.8, halation: 0.3, ca: 0.7, grain: 0.045, vignette: 0.42,
      shake: [sh * (hash(frameIdx(t), 1) - 0.5), sh * (hash(frameIdx(t), 2) - 0.5)] as [number, number],
    };
  }

  /** The outer camera: close on the chat, a push on the bar, three pull-backs on the fill, then the dive. */
  private outerCam(t: number) {
    const T = this.T;
    const [k1, k2, k3] = [T.kicks[0] ?? T.dR - 1, T.kicks[1] ?? T.dR - 0.85, T.kicks[2] ?? T.dR - 0.7];
    const st = (a: number, d = 0.14) => ease.outExpo(clamp((t - a) / d));
    // open: a crane-in onto the tube on the first downbeat, then a slow creep
    const o = ease.outExpo(clamp((t - T.start) / 0.7)), creep = ease.inOutQuad(clamp((t - T.start - 0.5) / (T.d1 - T.start - 0.5)));
    let dist = lerp(2.9, 2.05, o) - 0.12 * creep;
    let yaw = lerp(-0.42, -0.16, o) + 0.05 * creep;
    let pitch = lerp(0.2, 0.05, o), roll = lerp(0.03, 0.015, clamp((t - T.start) / (T.d1 - T.start)));
    let tx = 0.02, ty = -0.03;
    // the push on the bar line
    const pb = springStep(t - T.d1, 2.6, 0.55);
    dist = lerp(dist, 1.62, pb); yaw = lerp(yaw, 0.08, pb); tx = lerp(tx, 0.0, pb); ty = lerp(ty, 0.01, pb); roll = lerp(roll, -0.02, pb);
    // wind-up: three pull-backs on the kicks, then hold the breath
    dist = lerp(dist, 1.8, st(k1)); dist = lerp(dist, 2.15, st(k2)); dist = lerp(dist, 2.55, st(k3));
    yaw = lerp(yaw, 0.02, st(k1)); pitch = lerp(pitch, 0.1, st(k2)); ty = lerp(ty, -0.2, st(k2)); tx = lerp(tx, 0, st(k1));
    roll = lerp(roll, 0.0, st(k1));
    const hold = clamp((t - k3) / Math.max(0.1, T.dR - k3));
    dist += 0.16 * ease.outQuad(hold) * (t > k3 ? 1 : 0);
    roll -= 0.03 * ease.inQuad(hold) * (t > k3 ? 1 : 0);
    // the dive through the glass on the "R's" downbeat, and the calm after
    const dv = ease.outExpo(clamp((t - T.dR) / 0.11));
    if (t >= T.dR) {
      const breathe = Math.sin((t - T.dR) * 0.9) * 0.012;
      dist = lerp(dist, FILL_DIST - 0.02, dv); yaw = lerp(yaw, breathe, dv); pitch = lerp(pitch, 0.012, dv); roll = lerp(roll, 0, dv);
      tx = lerp(tx, 0, dv); ty = lerp(ty, 0, dv);
    }
    const target = new THREE.Vector3(tx, ty, -0.03);
    const pos = new THREE.Vector3(tx + Math.sin(yaw) * Math.cos(pitch) * dist, ty + Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist);
    return { pos, target, roll };
  }

  private knobs(t: number) {
    const T = this.T;
    let yg = 0.4;
    T.kicks.forEach((k) => (yg -= 0.62 * springStep(t - k, 5, 0.5)));
    yg += 1.86 * ease.outExpo(clamp((t - T.dR) / 0.25));
    return [0.9 + 0.05 * Math.sin(t * 0.7), -0.3, 0.2, yg, -0.8];
  }

  // ------------------------------------------------------------------ the display list
  private display(t: number) {
    const T = this.T;
    if (t < T.dR) this.shotChat(t);
    else if (t < T.dG) this.shotStrawberry(t);
    else if (t < T.d5) this.shotGlass(t);
    else this.shotClock(t);
  }

  /** Shot A: channel A = the chat (squashed by the Y gain on the fill), channel B = the narrator. */
  private shotChat(t: number) {
    const T = this.T, B = this.beam;
    // channel A deflection: the wind-up squash (Y collapses, X stretches) in three steps, then trembles
    let sy = 1, sx = 1;
    T.kicks.forEach((k, i) => {
      const s = springStep(t - k, 6, 0.45);
      sy -= [0.22, 0.18, 0.16][i]! * s; sx += [0.04, 0.04, 0.05][i]! * s;
    });
    const k3 = T.kicks[2] ?? T.dR;
    if (t > k3) { const h = clamp((t - k3) / (T.dR - k3)); sy -= 0.06 * h; sy += 0.012 * Math.sin(t * TAU * 21) * h; }
    B.defl = { sx, sy, cx: 960, cy: 380, on: true };

    // window
    B.path2(subdiv(rrect2(290, 96, 1630, 666, 26), 60, mix2), 0.42);
    B.path2(subdiv([{ x: 310, y: 176 }, { x: 1610, y: 176 }], 60, mix2), 0.3);
    this.write2(this.wBot, t, 336, 150, 0.9);
    for (let i = 0; i < 3; i++) B.path2(circle2(1535 + i * 30, 138, 7, 10), 0.5);
    // the user's question, typed
    const qw = this.wQ.width, bx1 = 1580, bx0 = bx1 - qw - 70;
    const bubbleOn = smoothstep(T.start - 0.7, T.start - 0.55, t);
    if (bubbleOn > 0) {
      B.path2(subdiv(bubble2(bx0, 214, bx1, 318, 22, 'right'), 60, mix2), 0.55 * bubbleOn);
      this.write2(this.wYou, t, bx1 - 40, 204, 0.6);
    }
    this.write2(this.wQ, t, bx0 + 35, 285, 1.05);
    const typing = t < T.d1 - 0.25;
    if (typing && Math.floor(t * 5) % 2 === 0) {
      const x = bx0 + 35 + this.wQ.st.width * (this.wQ.lengthAt(t) / Math.max(1, this.wQ.st.total)) + 8;
      B.seg(x, 240, x, 292, 0.8);
    }
    // the bot is "thinking"
    if (t > T.d1 + 0.04) {
      const on = ease.outExpo(clamp((t - T.d1 - 0.04) / 0.2));
      B.path2(subdiv(bubble2(330, 370, 330 + 280 * on, 470, 22, 'left'), 60, mix2), 0.55);
      this.write2Static('chatbot', t, 340, 360);
      const beat = this.ctx.audio.beatAt(t);
      for (let i = 0; i < 3; i++) {
        const ph = (beat * 2 - i * 0.33) % 1;
        B.dot(400 + i * 60, 420, (0.5 + 1.8 * Math.pow(1 - ph, 3)) * on, 3);
      }
    }
    B.defl.on = false;

    // channel B: the narrator's line, pen-written (fades on the fill so the next line can start)
    const fade0 = 1 - smoothstep(T.L0.end - 0.05, T.L0.end + 0.1, t);
    if (fade0 > 0) this.write2(this.wL0, t, 960 - this.wL0.width / 2 - 110, 850, 1.05 * fade0, this.vib(t));
    if (t > T.L1.start - 0.05) this.write2(this.wL1, t, 960 - this.wL1.lengthX(3) / 2, 850, 1.05, this.vib(t));
  }

  /** Shots B and C: the hero word in 3D, the count, then the confident reply and the tokens. */
  private shotStrawberry(t: number) {
    const T = this.T, B = this.beam;
    const cam = B.cam;
    // camera: B = snap in from close on the R, pull back, slow orbit; C = swing up to the reply, push on the 2, ease down
    const u = t - T.dR;
    let dist = keys(u, [[0, 6.5], [0.5, 9.8, ease.outExpo], [T.d3 - T.dR, 9.1, ease.inOutQuad]]);
    let yaw = keys(u, [[0, 0.55], [0.5, 0.12, ease.outExpo], [T.d3 - T.dR, -0.1, ease.inOutQuad]]);
    let pitch = keys(u, [[0, -0.12], [0.5, 0.08, ease.outExpo], [T.d3 - T.dR, 0.12]]);
    let tx = keys(u, [[0, 1.6], [0.5, 0.3, ease.outExpo]]), ty = keys(u, [[0, 0.45], [0.5, 0.35, ease.outExpo]]), tz = 0;
    for (const c of T.counts) dist -= 0.45 * pulse(t, c, 0.12);
    const inC = t >= T.d3;
    const two = this.twoPos();
    if (inC) {
      const a = ease.outExpo(clamp((t - T.d3) / 0.32));
      dist = lerp(dist, 13.4, a); yaw = lerp(yaw, 0.14, a); pitch = lerp(pitch, 0.15, a); tx = lerp(tx, 0.25, a); ty = lerp(ty, 0.55, a);
      const b = ease.outBack(clamp((t - T.snareC) / 0.3), 1.3);
      dist = lerp(dist, 12.0, b); tx = lerp(tx, two.x * 0.5, b); ty = lerp(ty, 0.95, b); yaw = lerp(yaw, 0.02, b);
      const c0 = T.L2.words[0]!.start - 0.2, c = ease.inOutQuad(clamp((t - c0) / 0.55));
      dist = lerp(dist, 10.6, c); tx = lerp(tx, 0.4, c); ty = lerp(ty, -1.9, c); pitch = lerp(pitch, 0.03, c); yaw = lerp(yaw, -0.12, c);
    }
    orbit(cam, p3(tx, ty, tz), dist, yaw, pitch, 36);
    B.useCamera();
    const eye = cam.position;
    const sp = (x: number, z: number, cx: number, cz: number) => (x - cx) * (eye.x - x) + (z - cz) * (eye.z - z) > 0 ? 1 : 0.25;

    // the fruit, above and behind, turning
    if (!inC) {
      const fo = 1;
      const S = 2.3 * lerp(0.5, 1, springStep(u - 0.05, 2.2, 0.5)), rot = t * 0.9, c = p3(-3.9, 1.35, -3.4);
      const tr = (p: P3) => { const cr = Math.cos(rot), sr = Math.sin(rot); return p3(c.x + (p.x * cr - p.z * sr) * S, c.y + p.y * S, c.z + (p.x * sr + p.z * cr) * S); };
      const shade = (p: P3) => sp(p.x, p.z, c.x, c.z);
      for (const r of this.fruitRings) B.path3(r.map(tr), 0.34 * fo, false, shade);
      for (const m of this.fruitMer) B.path3(m.map(tr), 0.3 * fo, false, shade);
      for (const s of this.seeds) { const q = tr(s); B.dot3(q, 0.9 * fo * shade(q), 1.6); }
      for (const l of this.calyx) B.path3(l.map(tr), 0.75 * fo);
    }

    // the hero word: extruded single-stroke capitals, snapping in letter by letter
    const H = this.hero, st = H.st, s = H.s;
    const split = inC ? 0.42 * springStep(t - T.d3 - 0.12, 2.6, 0.5) : 0;
    const rsSung = T.L1.words[4]!.start;
    for (let si = 0; si < st.strokes.length; si++) {
      const ci = st.charOf[si]!, bx = H.boxes[ci]!;
      // on the snap the letters fly in out of the tube's depth, overdriven, and settle
      const fly = ease.outExpo(clamp((u - 0.008 * ci) / 0.2)), sc = 1;
      const fz = -9 * (1 - fly);
      const cx = (bx.x0 + bx.x1) / 2, cy = (bx.y0 + bx.y1) / 2;
      const dx = ci < 5 ? -split : split;
      const isR = R_IDX.includes(ci), rIdx = R_IDX.indexOf(ci);
      let I = 0.85 + 2.2 * (1 - fly) * (u >= 0 ? 1 : 0) + 0.8 * pulse(t, T.dR, 0.12);
      if (isR) {
        I += 1.6 * pulse(t, rsSung, 0.25) + (inC ? 0 : 1.4 * pulse(t, T.counts[rIdx]!, 0.2)) + (t >= T.counts[rIdx]! && !inC ? 0.35 : 0);
        if (inC && ci === 2) I += 0.5 + 0.6 * (Math.floor((t - T.d3) * 6) % 2);
      }
      const P = (p: V2, z: number) => p3(H.x0 + (cx + (p.x - cx) * sc) * s + dx, (cy + (-p.y - cy) * sc) * s, z * sc + fz);
      const pts = st.strokes[si]!;
      const front = pts.map((p) => P(p, 0.24)), back = pts.map((p) => P(p, -0.24));
      B.path3(front, I);
      B.path3(back, I * 0.45);
      for (const r of H.rungs[si]!) B.path3([front[r]!, back[r]!], I * 0.5);
    }
    const capH = (H.boxes[0]!.y1 - H.boxes[0]!.y0) * s;

    if (!inC) {
      // the count: a ring around each R and its number, on the beats after the hit
      T.counts.forEach((c, i) => {
        if (t < c - 0.02) return;
        const bx = H.boxes[R_IDX[i]!]!, cx = H.x0 + ((bx.x0 + bx.x1) / 2) * s, cy = ((bx.y0 + bx.y1) / 2) * s;
        const g = ease.outExpo(clamp((t - c + 0.02) / 0.14));
        B.path3(circle3(p3(cx, cy, 0.3), 1, 40, 'xy', Math.PI / 2, Math.PI / 2 + TAU * g).map((q) => p3(cx + (q.x - cx) * capH * 0.5, cy + (q.y - cy) * capH * 0.68, q.z)), 1.1 + 1.4 * pulse(t, c, 0.15));
        const n = this.nums[i]!, ns = (capH * 0.62) / n.capHeight;
        const pl: Plane = { o: p3(cx - (n.width * ns) / 2, capH + 0.35 + 0.25 * (1 - springStep(t - c, 4, 0.4)), 0.3), u: p3(1, 0, 0), v: p3(0, 1, 0), s: ns };
        for (const stroke of n.strokes) B.path3(stroke.map((p) => onPlane(pl, p.x, p.y)), 1.3 + 1.5 * pulse(t, c, 0.15));
      });
    } else {
      // the chatbot's reply panel, above the word
      const pr = ease.outExpo(clamp((t - T.d3) / 0.18));
      const pz = -0.9, px0 = -4.9, px1 = 5.1, py0 = 1.75, py1 = 4.35;
      B.path3(rrect3(lerp(-0.1, px0, pr), py0, lerp(0.1, px1, pr), py1, pz, 0.3), 0.5);
      const lbl = (w: Written, x: number, y: number, z: number, I: number, sz: number) => this.write3(w, t, { o: p3(x, y, z), u: p3(1, 0, 0), v: p3(0, 1, 0), s: sz }, I);
      const sR = this.replyS();
      lbl(this.wBotD, px0 + 0.35, py1 - 0.45, pz, 0.8, sR);
      const y = py0 + 0.55;
      const wA = this.wReplyA.width * sR, w2 = this.wReply2.width * sR, wB = this.wReplyB.width * sR;
      const x0 = (px0 + px1) / 2 - (wA + w2 + wB) / 2;
      lbl(this.wReplyA, x0, y, pz, 1.05, sR);
      const twoI = 1.35 + 2.2 * pulse(t, T.snareC, 0.25);
      lbl(this.wReply2, x0 + wA, y, pz, twoI, sR);
      lbl(this.wReplyB, x0 + wA + w2, y, pz, 1.05, sR);
      // tokens: the word the model actually sees
      if (split > 0.01) {
        const bA = H.boxes[0]!, bE = H.boxes[4]!, cA = H.boxes[5]!, cE = H.boxes[9]!;
        const on = ease.outExpo(clamp((t - T.d3 - 0.15) / 0.2));
        const ax0 = H.x0 + bA.x0 * s - split - 0.18, ax1 = H.x0 + bE.x1 * s - split + 0.18;
        const bx0 = H.x0 + cA.x0 * s + split - 0.18, bx1 = H.x0 + cE.x1 * s + split + 0.18;
        B.path3(rrect3(ax0, -0.32, lerp(ax0, ax1, on), capH + 0.3, 0.32, 0.12), 0.75);
        B.path3(rrect3(bx0, -0.32, lerp(bx0, bx1, on), capH + 0.3, 0.32, 0.12), 0.75);
        const sT = 0.0125;
        lbl(this.wTokA, (ax0 + ax1) / 2 - (this.wTokA.width * sT) / 2, -0.95, 0.32, 0.95, sT);
        lbl(this.wTokB, (bx0 + bx1) / 2 - (this.wTokB.width * sT) / 2, -0.95, 0.32, 0.95, sT);
        // the model's own count: "1", "2" under the two R's it can see in "berry"; the third R goes missing
        if (t > T.snareC - 0.02) {
          [7, 8].forEach((ci, i) => {
            const bx = H.boxes[ci]!, cx = H.x0 + ((bx.x0 + bx.x1) / 2) * s + split;
            const n = this.nums[i]!, ns = (capH * 0.36) / n.capHeight;
            const pl: Plane = { o: p3(cx - (n.width * ns) / 2, capH + 0.5, 0.32), u: p3(1, 0, 0), v: p3(0, 1, 0), s: ns };
            for (const stroke of n.strokes) B.path3(stroke.map((p) => onPlane(pl, p.x, p.y)), 1.1);
          });
          // the narrator's circle around the R it missed (a hand-drawn loop, blinking)
          const bx = H.boxes[2]!, cx = H.x0 + ((bx.x0 + bx.x1) / 2) * s - split, cy = ((bx.y0 + bx.y1) / 2) * s;
          const g = ease.outCubic(clamp((t - T.snareC - 0.08) / 0.22));
          const loop: P3[] = [];
          for (let i = 0; i <= 60 * g; i++) {
            const a = Math.PI * 0.6 + (i / 60) * TAU * 1.12, rr = capH * (0.8 + 0.07 * Math.sin(a * 3 + 1));
            loop.push(p3(cx + Math.cos(a) * rr * 1.05, cy + Math.sin(a) * rr, 0.36));
          }
          B.path3(loop, 1.6 + 0.8 * (Math.floor(t * 8) % 2));
        }
      }
      // the next prompt, typed while "It can't fill a" is sung
      const tp = this.wYouC.times[0]![0];
      if (t > tp) {
        const on = ease.outExpo(clamp((t - tp) / 0.18));
        const sP = 0.0135, w = Math.max(this.wPrompt.width * sP + 0.7, 6.4);
        const fx1 = 0.4 + w / 2, fx0 = fx1 - w * on;
        B.path3(rrect3(fx0, -3.95, fx1, -3.0, 0.2, 0.25), 0.6);
        lbl(this.wYouC, fx1 - 0.55, -2.8, 0.2, 0.7, sP);
        lbl(this.wPrompt, fx0 + 0.35, -3.62, 0.2, 1.1, sP);
      }
    }

    // the narrator's line, on a plane in front of the word
    const sL = this.lyricS();
    const f1 = 1 - smoothstep(T.L1.end + 0.05, T.L1.end + 0.25, t);
    if (f1 > 0) this.write3(this.wL1, t, yawPlane(p3(0.3 - this.wL1.width * sL * 0.5, -2.0, 1.2), 0.06, -0.08, sL), 1.05 * f1, this.vib(t));
    if (t > T.L2.start - 0.05) this.write3(this.wL2, t, yawPlane(p3(0.3 - this.wL1.width * sL * 0.5, -2.0, 1.2), 0.06, -0.08, sL), 1.05, this.vib(t));
  }

  /** "glass" = the reveal: a lathe-turned glass, the wine stops at half, the claim, the cursors. */
  private shotGlass(t: number) {
    const T = this.T, B = this.beam, cam = B.cam;
    const u = t - T.dG, dur = T.d5 - T.dG;
    let dist = keys(u, [[0, 3.1], [0.5, 13.4, ease.outExpo], [dur, 12.4, ease.inOutQuad]]);
    dist -= 0.9 * springStep(t - T.snareD, 2.5, 0.6) * (t > T.snareD ? 1 : 0);
    const yaw = keys(u, [[0, -0.35], [0.5, 0.3, ease.outExpo], [dur, -0.1, ease.inOutQuad]]);
    const pitch = keys(u, [[0, -0.22], [0.5, 0.12, ease.outExpo], [dur, 0.2, ease.inOutQuad]]);
    const tx = keys(u, [[0, 0.1], [0.5, 0.9, ease.outExpo]]), ty = keys(u, [[0, -1.0], [0.5, -0.25, ease.outExpo], [dur, -0.05]]);
    orbit(cam, p3(tx, ty, 0), dist, yaw, pitch, 36);
    B.useCamera();
    this.drawGlass(t, u);

    // the claim, next to the glass
    const on = ease.outExpo(clamp((u - 0.12) / 0.2));
    const pl = yawPlane(p3(1.45, 0.95, 0.4), -0.18, 0, 1);
    const Bx = (x: number, y: number) => onPlane(pl, x, -y);
    const sC = 0.0092, bw = Math.max(this.wClaim1.width, this.wClaim2.width) * sC + 0.7, bh = 1.75;
    const shape = bubble2(0, 0, bw * on, bh, 0.28, 'left').map((p) => Bx(p.x, bh - p.y));
    if (on > 0) B.path3(subdiv3(shape, 0.3), 0.55);
    const tpl = (dy: number): Plane => ({ ...pl, o: Bx(0.3, dy), s: sC });
    this.write3(this.wBotD, t, { ...tpl(bh + 0.25), s: 0.012 }, 0.75);
    this.write3(this.wClaim1, t, tpl(1.02), 1.05);
    this.write3(this.wClaim2, t, tpl(0.35), 1.05);

    // cursors: BRIM at the rim, WINE at the surface, and the gap between them
    const rimY = -1.7 + this.bowl.y0 + this.bowl.h, wineY = this.wineY();
    const tB = this.wBrim.times[0]![0];
    if (t > tB) {
      const g = ease.outExpo(clamp((t - tB) / 0.22)), g2 = ease.outExpo(clamp((t - tB - 0.12) / 0.22));
      dashed3(B, p3(-2.9, rimY, 0), p3(lerp(-2.9, 1.45, g), rimY, 0), 0.9, 0.12);
      dashed3(B, p3(-2.9, wineY, 0), p3(lerp(-2.9, 1.3, g2), wineY, 0), 0.75, 0.12);
      const sL = 0.011;
      this.write3(this.wBrim, t, { o: p3(-4.5, rimY - 0.2, 0), u: p3(1, 0, 0), v: p3(0, 1, 0), s: sL }, 1.2);
      this.write3(this.wWine, t, { o: p3(-4.5, wineY - 0.2, 0), u: p3(1, 0, 0), v: p3(0, 1, 0), s: sL }, 1.0);
      const tg = this.wGap.times[0]![0];
      if (t > tg - 0.1) {
        const a = ease.outExpo(clamp((t - tg + 0.1) / 0.2)), x = -2.45, m = (rimY + wineY) / 2, hh = ((rimY - wineY) / 2) * a;
        const I = 1.2 + 1.3 * pulse(t, T.snareD, 0.2);
        B.path3([p3(x, m - hh, 0.02), p3(x, m + hh, 0.02)], I);
        for (const sgn of [-1, 1]) B.path3([p3(x - 0.12, m + sgn * hh - sgn * 0.16, 0.02), p3(x, m + sgn * hh, 0.02), p3(x + 0.12, m + sgn * hh - sgn * 0.16, 0.02)], I);
        this.write3(this.wGap, t, { o: p3(-2.22, m - 0.18, 0.02), u: p3(1, 0, 0), v: p3(0, 1, 0), s: 0.0105 }, I);
      }
    }
    // the narrator's line on a plane at the foot of the glass
    const sL = this.lyricS() * 1.3;
    this.write3(this.wL2, t, yawPlane(p3(0.7 - this.wL2.width * sL * 0.5, -3.0, 1.5), 0.1, -0.1, sL), 1.05, this.vib(t));
  }

  /** Out: straight down into the glass. The rim's circle becomes a clock face that says 10:10. */
  private shotClock(t: number) {
    const T = this.T, B = this.beam, cam = B.cam;
    const u = t - T.d5, rimY = -1.7 + this.bowl.y0 + this.bowl.h;
    const h = keys(u, [[0, 13.5], [0.6, 8.9, ease.outExpo], [T.end - T.d5, 8.3, ease.inOutQuad]]);
    const roll = keys(u, [[0, -0.8], [0.8, 0, ease.outExpo]]) + 0.03 * Math.sin(u * 1.3);
    cam.position.set(0.05, rimY + h, 0.05);
    cam.up.set(Math.sin(roll), 0, -Math.cos(roll));
    cam.fov = 36;
    cam.lookAt(0, rimY, 0);
    B.useCamera();
    this.drawGlass(t, 10);

    // the clock: twelve ticks around the rim, then the hands at ten past ten
    const tc = T.L3.words[0]!.start - 0.35;
    const R = 1.22;
    for (let i = 0; i < 12; i++) {
      const ti = tc + i * 0.025;
      if (t < ti) break;
      const a = (i / 12) * TAU, len = i % 3 === 0 ? 0.26 : 0.14, g = ease.outExpo(clamp((t - ti) / 0.1));
      const dir = { x: Math.sin(a), z: -Math.cos(a) };
      B.path3([p3(dir.x * R, rimY, dir.z * R), p3(dir.x * (R + len * g), rimY, dir.z * (R + len * g))], 1.3);
    }
    const th = T.L3.words[1]!.start;
    const hand = (ang: number, len: number, t0: number, I: number) => {
      if (t < t0) return;
      const g = ease.outBack(clamp((t - t0) / 0.18), 1.4);
      const d = { x: Math.sin(ang), z: -Math.cos(ang) };
      B.path3(subdiv3([p3(-d.x * 0.12, rimY + 0.02, -d.z * 0.12), p3(d.x * len * g, rimY + 0.02, d.z * len * g)], 0.12), I);
    };
    hand((10 / 60) * TAU, 1.02, th, 1.5);
    hand(((10 + 10 / 60) / 12) * TAU, 0.66, th + 0.1, 1.6);
    if (t > th) B.dot3(p3(0, rimY + 0.02, 0), 2.2, 3);

    // lyrics on the table plane: "wine," still ringing below, "Every clock" above
    const sL = this.lyricS();
    const flat = (x: number, z: number): Plane => ({ o: p3(x, rimY, z), u: p3(1, 0, 0), v: p3(0, 0, -1), s: sL });
    const f2 = 1 - smoothstep(T.L2.end + 0.1, T.L2.end + 0.35, t);
    if (f2 > 0) this.write3(this.wL2, t, flat(-this.wL2.width * sL * 0.5, 2.45), 1.05 * f2, this.vib(t));
    if (t > T.L3.start - 0.05) this.write3(this.wL3, t, flat(-this.wL3.lengthX(1) * sL * 0.5, -1.95), 1.1, this.vib(t));
  }

  private wineY() { return -1.7 + this.bowl.y0 + this.bowl.h * 0.5; }

  /** The glass (turning meridians, rings, a doubled rim) and the half-full wine as a scan fill. */
  private drawGlass(t: number, u: number) {
    const B = this.beam, eye = B.cam.position, base = -1.7;
    const draw = ease.outExpo(clamp(u / 0.35)); // the beam turns the profile in, foot to rim
    const P = this.glassProf, n = Math.max(2, Math.ceil(P.length * draw));
    const rot = t * 0.55;
    const shade = (p: P3) => (p.x * (eye.x - p.x) + p.z * (eye.z - p.z) > 0 ? 1 : 0.3);
    const M = 16;
    for (let m = 0; m < M; m++) {
      const a = rot + (m / M) * TAU, c = Math.cos(a), s = Math.sin(a);
      B.path3(P.slice(0, n).map((q) => p3(q.r * c, base + q.y, q.r * s)), 0.42, false, shade);
    }
    const ring = (r: number, y: number, I: number, seg = 56) => B.path3(circle3(p3(0, y, 0), r, seg, 'xz'), I, false, shade);
    const rimY = base + this.bowl.y0 + this.bowl.h;
    ring(0.8, base, 0.6);
    ring(0.3, base + 0.1, 0.4, 28);
    ring(0.055, base + 1.28, 0.5, 12);
    for (const k of [0.3, 0.55, 0.8]) if (draw > k) ring(this.bowlR(k) * 1.0, base + this.bowl.y0 + this.bowl.h * k, 0.28);
    if (draw > 0.98) { ring(this.bowlR(1), rimY, 1.05, 72); ring(this.bowlR(1) - 0.03, rimY - 0.02, 0.6, 72); }

    // the wine pours up and stops at half (dense low-intensity rings read deep orange)
    const lvl = ease.outCubic(clamp((u - 0.18) / 0.55)) * 0.5;
    if (lvl > 0.01) {
      const nR = 16;
      for (let i = 0; i < nR; i++) {
        const k = 0.03 + (lvl - 0.03) * (i / (nR - 1));
        if (k <= 0.03) continue;
        B.path3(circle3(p3(0, base + this.bowl.y0 + this.bowl.h * k, 0), this.bowlR(k) * 0.96, 44, 'xz'), 0.26);
      }
      const r = this.bowlR(lvl) * 0.96, y = base + this.bowl.y0 + this.bowl.h * lvl;
      const slosh = 0.035 * Math.sin(t * 7.5) * Math.exp(-Math.max(0, u - 0.7) * 2.5) * (u < 5 ? 1 : 0);
      B.path3(circle3(p3(0, y, 0), r, 64, 'xz').map((p) => p3(p.x, p.y + slosh * p.x, p.z)), 1.25);
      for (let i = 1; i < 10; i++) {
        const z = -r + (2 * r * i) / 10, hw = Math.sqrt(Math.max(0, r * r - z * z));
        B.path3([p3(-hw, y + slosh * -hw, z), p3(hw, y + slosh * hw, z)], 0.36);
      }
    }
  }

  // ------------------------------------------------------------------ writing helpers
  private vib(t: number) { return clamp(this.ctx.audio.env('vocal', t) * 1.4); }

  /** Pen-written text on the tube face (phosphor px, baseline-left at x, y). */
  private write2(w: Written, t: number, x: number, y: number, I: number, vib = 1) {
    if (I <= 0) return;
    const B = this.beam, fr = w.at(t, vib);
    for (const s of fr.strokes) B.path2(s.pts.map((p) => ({ x: x + p.x, y: y + p.y })), I * (1 + 1.4 * s.fresh));
    if (fr.sustain) B.path2(fr.sustain.pts.map((p) => ({ x: x + p.x, y: y + p.y })), I * 1.1 * fr.sustain.I);
    if (fr.head) B.dot(x + fr.head.x, y + fr.head.y, I * 2.2, 2);
  }
  private statics = new Map<string, StrokeText>();
  private write2Static(s: string, _t: number, x: number, y: number) {
    let st = this.statics.get(s);
    if (!st) { st = strokeText(s, 'tech', 26); this.statics.set(s, st); }
    for (const p of st.strokes) this.beam.path2(p.map((q) => ({ x: x + q.x, y: y + q.y })), 0.6);
  }
  /** Pen-written text on a plane in the displayed 3D world. */
  private write3(w: Written, t: number, pl: Plane, I: number, vib = 1) {
    if (I <= 0) return;
    const B = this.beam, fr = w.at(t, vib);
    for (const s of fr.strokes) B.path3(s.pts.map((p) => onPlane(pl, p.x, p.y)), I * (1 + 1.4 * s.fresh));
    if (fr.sustain) B.path3(fr.sustain.pts.map((p) => onPlane(pl, p.x, p.y)), I * 1.1 * fr.sustain.I);
    if (fr.head) B.dot3(onPlane(pl, fr.head.x, fr.head.y), I * 2.2, 2);
  }
  /** World units per px: lyrics are set so line 1 spans 7.2 units; the reply spans 8.6. */
  private lyricS() { return 8.6 / this.wL1.width; }
  private replyS() { return 8.6 / (this.wReplyA.width + this.wReply2.width + this.wReplyB.width); }
  /** Where the big "2" of the reply sits (for the push-in). */
  private twoPos() {
    const sR = this.replyS(), wA = (this.wReplyA?.width ?? 0) * sR, w2 = (this.wReply2?.width ?? 0) * sR, wB = (this.wReplyB?.width ?? 0) * sR;
    const x0 = 0.1 - (wA + w2 + wB) / 2;
    return { x: x0 + wA + w2 / 2, y: 1.75 + 0.55 + 0.6 };
  }
}

// ------------------------------------------------------------------ small geometry
function orbit(cam: THREE.PerspectiveCamera, target: P3, dist: number, yaw: number, pitch: number, fov: number) {
  cam.fov = fov;
  cam.up.set(0, 1, 0);
  cam.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
  cam.lookAt(target.x, target.y, target.z);
}
function circle2(cx: number, cy: number, r: number, n: number): V2[] {
  return Array.from({ length: n + 1 }, (_, i) => ({ x: cx + Math.cos((i / n) * TAU) * r, y: cy + Math.sin((i / n) * TAU) * r }));
}
/** A speech bubble (rounded rect with a tail at the bottom left or right), y down. */
function bubble2(x0: number, y0: number, x1: number, y1: number, r: number, tail: 'left' | 'right'): V2[] {
  const rr = rrect2(x0, y0, Math.max(x1, x0 + 2 * r + 1), y1, r);
  const h = y1 - y0, tx = tail === 'left' ? x0 + r * 1.5 : Math.max(x1, x0 + 2 * r + 1) - r * 1.5;
  // splice a tail into the bottom edge
  const out: V2[] = [];
  for (let i = 0; i < rr.length; i++) {
    out.push(rr[i]!);
    const a = rr[i]!, b = rr[i + 1];
    if (b && Math.abs(a.y - y1) < 1e-6 && Math.abs(b.y - y1) < 1e-6 && ((a.x > tx && b.x < tx) || (a.x < tx && b.x > tx))) {
      const dir = tail === 'left' ? -1 : 1;
      out.push({ x: tx + 0.25 * h * 0.35 * -dir, y: y1 }, { x: tx + dir * h * 0.28, y: y1 + h * 0.32 }, { x: tx + 0.25 * h * 0.35 * dir, y: y1 });
    }
  }
  return out;
}
function rrect3(x0: number, y0: number, x1: number, y1: number, z: number, r: number): P3[] {
  return subdiv3(rrect2(x0, y0, x1, y1, r).map((p) => p3(p.x, p.y, z)), 0.3);
}
function subdiv3(pts: P3[], step: number): P3[] {
  const out: P3[] = [];
  pts.forEach((p, i) => {
    if (i > 0) {
      const q = pts[i - 1]!, n = Math.ceil(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) / step);
      for (let j = 1; j < n; j++) out.push(p3(lerp(q.x, p.x, j / n), lerp(q.y, p.y, j / n), lerp(q.z, p.z, j / n)));
    }
    out.push(p);
  });
  return out;
}
function dashed3(B: Beam, a: P3, b: P3, I: number, dash: number) {
  const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), n = Math.floor(L / dash);
  for (let i = 0; i < n; i += 2) {
    const u0 = i / (L / dash), u1 = Math.min(1, (i + 1) / (L / dash));
    B.path3([p3(lerp(a.x, b.x, u0), lerp(a.y, b.y, u0), lerp(a.z, b.z, u0)), p3(lerp(a.x, b.x, u1), lerp(a.y, b.y, u1), lerp(a.z, b.z, u1))], I);
  }
}

// ------------------------------------------------------------------ tube shader
const TUBE_FRAG = /* glsl */ `
uniform sampler2D phos; uniform sampler2D panelTex;
uniform vec3 camPos; uniform mat3 camRot; uniform float tanF;
uniform float knob[5]; uniform float spill; uniform float tt; uniform float flick;

const vec2 SCR = vec2(${SCR.hw.toFixed(3)}, ${SCR.hh.toFixed(3)});
const vec2 OPEN = vec2(0.865, 0.515); const float OPEN_R = 0.075;
const vec2 PANEL_C = vec2(0.0, -0.22); const vec2 PANEL = vec2(1.3, 1.0); const float PANEL_R = 0.1;
const vec3 AMB = vec3(1.0, 0.46, 0.07);

float sdRR(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float faceZ(vec2 p) { vec2 q = p / vec2(1.05, 0.66); return -0.058 + 0.034 * max(0.0, 1.0 - dot(q, q)); }
vec3 faceN(vec2 p) { float e = 0.002; return normalize(vec3(-(faceZ(p + vec2(e, 0)) - faceZ(p - vec2(e, 0))) / (2.0 * e), -(faceZ(p + vec2(0, e)) - faceZ(p - vec2(0, e))) / (2.0 * e), 1.0)); }

vec3 softbox(vec3 r) {
  // a large warm softbox up-left and a dim cool one right: the studio seen in the glass
  float a = smoothstep(0.86, 0.97, dot(r, normalize(vec3(-0.55, 0.6, 0.6))));
  float b = smoothstep(0.9, 0.99, dot(r, normalize(vec3(0.7, 0.2, 0.7))));
  return vec3(1.0, 0.92, 0.82) * a * 0.9 + vec3(0.6, 0.7, 0.85) * b * 0.25;
}

vec3 background(vec3 ro, vec3 rd) {
  // dark room; the tube's amber light pools on the wall behind
  float tz = (-1.2 - ro.z) / min(rd.z, -1e-3);
  vec3 p = ro + rd * tz;
  float g = exp(-dot(p.xy - vec2(0.0, -0.1), p.xy - vec2(0.0, -0.1)) * 0.35);
  return vec3(0.006, 0.005, 0.0045) + AMB * 0.012 * g * spill;
}

vec3 shadePanel(vec3 p, vec3 rd, float dOpen, float dPanel) {
  // raised bezel lip around the opening and a rounded outer edge (normals bent by the distance fields)
  float e = 0.003;
  vec2 gO = vec2(sdRR(p.xy + vec2(e, 0), OPEN, OPEN_R) - sdRR(p.xy - vec2(e, 0), OPEN, OPEN_R), sdRR(p.xy + vec2(0, e), OPEN, OPEN_R) - sdRR(p.xy - vec2(0, e), OPEN, OPEN_R)) / (2.0 * e);
  vec2 q = p.xy - PANEL_C;
  vec2 gP = vec2(sdRR(q + vec2(e, 0), PANEL, PANEL_R) - sdRR(q - vec2(e, 0), PANEL, PANEL_R), sdRR(q + vec2(0, e), PANEL, PANEL_R) - sdRR(q - vec2(0, e), PANEL, PANEL_R)) / (2.0 * e);
  float lip = dOpen < 0.07 ? cos(dOpen / 0.07 * 3.14159) : -1.0; // -1..1 slope across the lip
  vec3 n = vec3(0, 0, 1);
  if (dOpen < 0.07) n = normalize(vec3(gO * lip * 0.9, 1.0));
  if (dPanel > -0.05) n = normalize(vec3(gP * smoothstep(-0.05, 0.0, dPanel) * 2.2, 1.0));
  vec3 L = normalize(vec3(-0.5, 0.65, 0.6));
  float dif = max(dot(n, L), 0.0) * 0.8 + 0.2 * (0.5 + 0.5 * n.y);
  vec3 h = normalize(L - rd);
  float spec = pow(max(dot(n, h), 0.0), 40.0) * 0.18;
  // crackle-finish paint
  float grain = 0.85 + 0.3 * snoise(p.xy * 140.0) * 0.5 + 0.1 * snoise(p.xy * 22.0);
  vec3 alb = vec3(0.034, 0.031, 0.028) * grain;
  if (dOpen < 0.07) alb = vec3(0.018, 0.016, 0.015);
  vec2 uvP = (p.xy - vec2(-1.3, -1.22)) / vec2(2.6, 2.0);
  float print = texture(panelTex, uvP).a;
  alb = mix(alb, vec3(0.42, 0.38, 0.32), print * 0.85);
  float near = 1.0 / (1.0 + 18.0 * max(dOpen, 0.0));
  vec3 col = alb * (dif * 1.4 + 0.05) + vec3(spec) * 0.7 + AMB * 0.05 * near * spill * max(n.z, 0.0);
  return col;
}

// knobs: capped cylinders on the panel
float knobHit(vec3 ro, vec3 rd, vec2 c, float r, float h, out vec3 n, out vec3 hp) {
  float best = 1e9;
  float tc = (h - ro.z) / rd.z;
  vec3 p = ro + rd * tc;
  if (tc > 0.0 && length(p.xy - c) < r) { best = tc; n = vec3(0, 0, 1); hp = p; }
  vec2 o = ro.xy - c; vec2 d = rd.xy;
  float A = dot(d, d), Bq = dot(o, d), C = dot(o, o) - r * r, disc = Bq * Bq - A * C;
  if (disc > 0.0) {
    float ts = (-Bq - sqrt(disc)) / A;
    vec3 ps = ro + rd * ts;
    if (ts > 0.0 && ts < best && ps.z > 0.0 && ps.z < h) { best = ts; n = normalize(vec3(ps.xy - c, 0.0)); hp = ps; }
  }
  return best;
}

vec3 shadeKnob(vec3 p, vec3 n, vec3 rd, vec2 c, float ang) {
  vec3 L = normalize(vec3(-0.5, 0.65, 0.6));
  float dif = max(dot(n, L), 0.0) * 0.9 + 0.12;
  vec3 h = normalize(L - rd);
  float spec = pow(max(dot(n, h), 0.0), 60.0) * 0.35;
  vec3 alb = vec3(0.02, 0.018, 0.017);
  if (n.z < 0.5) alb *= 0.75 + 0.25 * step(0.5, fract(atan(n.y, n.x) * 6.366)); // knurl
  else {
    vec2 q = p.xy - c; vec2 dir = vec2(sin(ang), cos(ang));
    float along = dot(q, dir), across = abs(dot(q, vec2(dir.y, -dir.x)));
    float mark = step(0.0, along) * step(along, 0.06) * (1.0 - smoothstep(0.004, 0.007, across));
    alb = mix(alb, vec3(0.5, 0.46, 0.4), mark);
  }
  return alb * dif * 1.5 + vec3(spec);
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rd = normalize(camRot * vec3(ndc.x * (16.0 / 9.0) * tanF, ndc.y * tanF, -1.0));
  vec3 ro = camPos;
  vec3 col = background(ro, rd);
  if (rd.z < 0.0) {
    float tp = -ro.z / rd.z;
    vec3 p = ro + rd * tp;
    float dOpen = sdRR(p.xy, OPEN, OPEN_R);
    float dPanel = sdRR(p.xy - PANEL_C, PANEL, PANEL_R);
    if (dOpen < 0.0) {
      // into the tube: the etched faceplate (graticule) in front of the curved phosphor face
      float tg = (-0.014 - ro.z) / rd.z; vec3 pg = ro + rd * tg;
      float tf = tg;
      for (int i = 0; i < 4; i++) { vec3 q = ro + rd * tf; tf = (faceZ(q.xy) - ro.z) / rd.z; }
      vec3 pf = ro + rd * tf;
      if (sdRR(pf.xy, OPEN - 0.012, OPEN_R) > 0.0) {
        col = vec3(0.004, 0.0035, 0.003) + AMB * 0.01 * spill; // recess wall
      } else {
        vec2 uv = pf.xy / SCR * 0.5 + 0.5;
        vec3 em = vec3(0.0);
        if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) em = texture(phos, uv).rgb;
        float edge = smoothstep(0.0, 0.012, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)) * 1.6);
        em *= edge * flick;
        // the unlit phosphor coat and its faint grain
        vec3 base = vec3(0.0065, 0.0058, 0.005) * (0.9 + 0.2 * hash12(floor(pf.xy * 900.0)));
        vec3 n = faceN(pf.xy);
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
        vec3 refl = softbox(reflect(rd, n)) * (0.012 + fres * 0.25);
        // graticule: 16 x 9 divisions of 0.1, minor ticks on the axes; the etch blocks and edge-lights
        vec2 g = pg.xy / 0.1;
        vec2 fw = fwidth(g);
        vec2 dl = abs(fract(g + 0.5) - 0.5) / max(fw, 1e-4);
        float grid = max(1.0 - smoothstep(0.35, 1.2, dl.x), 1.0 - smoothstep(0.35, 1.2, dl.y));
        vec2 gm = pg.xy / 0.02, fm = fwidth(gm);
        vec2 dm = abs(fract(gm + 0.5) - 0.5) / max(fm, 1e-4);
        float ticks = max((1.0 - smoothstep(0.35, 1.2, dm.x)) * step(abs(pg.y), 0.012), (1.0 - smoothstep(0.35, 1.2, dm.y)) * step(abs(pg.x), 0.012));
        float inG = step(abs(pg.x), SCR.x + 0.001) * step(abs(pg.y), SCR.y + 0.001);
        float etch = max(grid, ticks) * inG;
        vec3 glow = 0.25 * (texture(phos, uv + vec2(0.004, 0.0)).rgb + texture(phos, uv - vec2(0.004, 0.0)).rgb + texture(phos, uv + vec2(0.0, 0.007)).rgb + texture(phos, uv - vec2(0.0, 0.007)).rgb);
        col = base + em * (1.0 - 0.55 * etch) + etch * (AMB * 0.02 + glow * 0.35) + refl;
      }
    } else if (dPanel < 0.0) {
      col = shadePanel(p, rd, dOpen, dPanel);
    }
    // knobs sit in front of the panel
    float tb = (dPanel < 0.0 && dOpen >= 0.0) ? tp : 1e9;
    for (int i = 0; i < 5; i++) {
      vec2 c = vec2(-0.96 + float(i) * 0.48, -0.83);
      vec3 n, hp;
      float tk = knobHit(ro, rd, c, 0.085, 0.07, n, hp);
      if (tk < tb) { tb = tk; col = shadeKnob(hp, n, rd, c, knob[i]); }
    }
  }
  fragColor = vec4(col, 1.0);
}`;
