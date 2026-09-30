// Phase-1 style "pencil": a pencil animatic / storyboard. A storyboard sheet lies in 3D; each panel is
// a window into its own drawn 3D world (block letters, a laptop, a chat card, a revolved wine glass),
// rendered as pencil lines: silhouettes and contours from that panel's camera, hatching by shade, blue
// construction, red director's notes. The camera moves over the sheet and through a panel's frame
// into its drawing (the panel's projection is exactly the full-frame drawing, so the move is seamless),
// and back out. Everything is re-drawn on twos (12 drawings a second) with a seeded boil.
import * as THREE from 'three';
import { Scene, type Frame } from '../engine/scene';
import { makeRT, W, H, clearRT } from '../engine/gl';
void H;
import { F } from '../engine/type';
import { writtenLength, strokeText, type StrokeFontName } from '../engine/stroke';
import type { Line, Word } from '../engine/lyrics';
import { clamp, lerp, ease, keys, frameIdx, pulse, noise1, prog, type V2 } from '../engine/util';
import type { StyleNote } from '../styles/registry';
import { Pen, pencilTip, GRAPHITE, BLUE, RED, type StrokeOpts, type Mapper } from './style-pencil-pen';
import {
  proj, projAll, line3, circle3, planeText, drawPlaneText, blockGlyph, drawBlock, makeGlass, revolveSilhouette,
  hatchRegion, drawBox, type PlaneText, type Block,
} from './style-pencil-world';
import { makePaper } from './style-pencil-paper';

export const TITLE = 'Pencil animatic';
export const NOTE: StyleNote = {
  technique: 'Storyboard sheet in 3D whose panels are windows into their own 3D worlds, all drawn as pencil lines on the CPU (contours and silhouettes from each camera, visible sides only, hatching by shade) into a float coverage buffer, then laid onto re-seeded paper tooth in one pass. Line boil on twos (12 fps).',
  palette: 'Warm drawing paper, graphite (light pressure catches only the tooth, heavy fills it with sheen), non-photo-blue construction, red pencil for the director’s notes and the fails.',
  typography: 'Single-stroke hand fonts only: the lyrics hand-lettered in Hershey Script, notes and screen text in EMS Readability, shot numbers in the technical hand, the director’s camera moves in red.',
  lyrics: 'Each word is written as sung with the pencil tip in shot (writtenLength against the word timings), blue guidelines ruled up to 0.4 s before; held notes are re-traced heavier; the hit word R’s gets its own big line after a CRASH IN (zoom lines, blocked-in hero boxes); STRAWBERRY is the lyric drawn as 3D block letters, one letter after another; the caption boxes under the panels are written as sung too.',
  cost: 'Measured on a shared, loaded machine: 11-14 ms/frame at 1 sample (perf) and 4.6 ms per sub-frame at 12 samples: all CPU line generation (projection, silhouettes, hatching) into one LineBatch plus one paper pass; sheet views with four panels peak near 25 ms. Full song with motion blur: roughly 20 min.',
  risks: 'Line counts climb when several panels are on the sheet at once (each panel re-draws its whole world); stroke-font text at small panel size needs framing care; a full song needs many drawn worlds, but they are cheap to author (polylines, no assets).',
};

// ---------------------------------------------------------------- local types and constants

interface Pose { tx: number; ty: number; tz: number; dist: number; yaw: number; pitch: number; roll: number; fov: number }
interface Written { word: Word; pt: PlaneText; charTimes: [number, number][]; writeEnd: number; guide: [V2, V2]; size: number }
interface Panel { id: string; label: string; cx: number; cy: number; hw: number; hh: number }

const PANEL_W = 16, PANEL_H = 9;
const SCRIPT: StrokeFontName = 'hscript';
const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export default class Pencil extends Scene {
  pen = new Pen(200000);
  lineRT = makeRT(W, H, { depthBuffer: false });
  paper = makePaper();
  main = new THREE.PerspectiveCamera(40, W / H, 0.1, 500);
  cams: Record<string, THREE.PerspectiveCamera> = {};
  panels: Panel[] = [];
  T: Record<string, number> = {};
  snares: number[] = [];
  kicks: number[] = [];
  // the drawn worlds
  wall11: Written[] = [];
  row12: Written[] = [];
  wall13: Written[] = [];
  /** The dialogue lines pencilled into the caption boxes under the panels (written as sung, too). */
  caps: Written[] = [];
  hero: { b: Block; x: number; t0: number; t1: number }[] = [];
  heroW = 0;
  question!: PlaneText;
  qTimes: [number, number][] = [];
  reply!: PlaneText;
  rTimes: [number, number][] = [];
  two!: PlaneText;
  glass = makeGlass();

  override async init() {
    const { lyrics, audio } = this.ctx;
    const L0 = lyrics.get('Watch it try', 0), L1 = lyrics.get("It can't count the R", 0), L2 = lyrics.get("It can't fill a glass of wine", 0);
    const s = this.ctx.start, e = this.ctx.end;
    const db = audio.downbeats.filter((d) => d > s - 0.05 && d < e + 0.05);
    const T = this.T;
    T.d0 = s; T.d1 = db[1] ?? s + 1.39; T.d2 = db[2] ?? s + 2.78; T.d3 = db[3] ?? s + 4.17; T.d4 = db[4] ?? s + 5.56; T.d5 = db[5] ?? s + 6.95; T.d6 = e;
    this.kicks = audio.events('kick', s - 0.05, e + 0.05).map((k) => k[0]);
    this.snares = audio.events('snare', s - 0.05, e + 0.05).map((k) => k[0]);
    const fill = audio.events('kick', T.d1 + 0.12, T.d2 - 0.1).map((k) => k[0]);
    T.k1 = fill[0] ?? T.d1 + 0.36; T.k2 = fill[1] ?? T.d1 + 0.52; T.k3 = fill[fill.length - 1] ?? T.d1 + 0.7;
    T.l1 = L1.words[0]!.start; T.rs = L1.words[4]!.start; T.straw = L1.words[6]!.start; T.strawEnd = L1.words[6]!.end;
    T.l2 = L2.words[0]!.start; T.glass = L2.words[4]!.start; T.wine = L2.words[6]!.start; T.wineEnd = L2.words[6]!.end;
    T.thing = L0.words[7]!.start; T.thingEnd = L0.words[7]!.end;

    for (const id of ['11', '12A', '12B', '13']) this.cams[id] = new THREE.PerspectiveCamera(38, W / H, 0.05, 200);
    this.panels = [
      { id: '11', label: 'SH 11', cx: -9.3, cy: 5.6, hw: PANEL_W / 2, hh: PANEL_H / 2 },
      { id: '12A', label: 'SH 12A', cx: 9.3, cy: 5.6, hw: PANEL_W / 2, hh: PANEL_H / 2 },
      { id: '12B', label: 'SH 12B', cx: -9.3, cy: -9.2, hw: PANEL_W / 2, hh: PANEL_H / 2 },
      { id: '13', label: 'SH 13', cx: 9.3, cy: -9.2, hw: PANEL_W / 2, hh: PANEL_H / 2 },
    ];

    // S11: the pre-chorus on the wall behind the laptop
    this.wall11 = this.wallRows([L0.words.slice(0, 5), L0.words.slice(5)], V3(-2.6, 3.05, -1.6), 0.62, 0.78);
    this.question = planeText('how many r\'s in "strawberry"?', 'readable', 0.16, V3(-1.28, 1.36, -0.93), V3(1, 0, 0), V3(0, -Math.cos(0.26), -Math.sin(0.26)));
    this.qTimes = this.typeTimes(this.question, T.d0 + 0.1, T.d1 + 0.25);

    // S12A: "It can't count the R's in" above the hero blocks; STRAWBERRY as extruded letters
    // "It can't count the" small, then the hit word "R's" (and "in") big on its own line
    this.row12 = [...this.wallRows([L1.words.slice(0, 4)], V3(-0.1, 3.05, 0), 0.55, 0), ...this.wallRows([L1.words.slice(4, 6)], V3(0.1, 1.75, 0), 1.05, 0)];
    const hs = L1.words[6]!;
    let x = 0;
    const glyphs = Array.from('STRAWBERRY,');
    glyphs.forEach((ch, i) => {
      const b = blockGlyph(ch, F.anton(), ch === ',' ? 0.3 : 1.25, 0.34);
      const t0 = hs.start + i * 0.035, t1 = t0 + 0.2;
      this.hero.push({ b, x: ch === ',' ? x - 0.02 : x, t0, t1 });
      x += b.x1 + 0.06;
    });
    this.heroW = x;

    // S12B: the confident answer
    this.reply = planeText('There are 2 R\'s in "strawberry".', 'readable', 0.2, V3(-1.62, 0.12, 0.07), V3(1, 0, 0), V3(0, -1, 0));
    this.rTimes = this.typeTimes(this.reply, T.d3 + 0.05, T.d3 + 0.42);
    this.two = planeText('2', 'sans', 2.3, V3(-3.55, -0.45, 0.4), V3(1, 0, 0), V3(0, -1, 0));

    // S13: line 2 on the wall left of the glass
    this.wall13 = this.wallRows([L2.words.slice(0, 4), L2.words.slice(4)], V3(-4.5, 3.05, -0.8), 0.6, 0.78);
    const capAt = (p: Panel) => V3(p.cx - p.hw + 0.35, p.cy - p.hh - 1.85, 0);
    this.caps = [
      ...this.wallRows([L0.words.slice(5)], capAt(this.panels[0]!), 0.75, 0),
      ...this.wallRows([L1.words.slice(0, 6)], capAt(this.panels[1]!), 0.75, 0),
      ...this.wallRows([L2.words], capAt(this.panels[3]!), 0.75, 0),
    ];
  }

  /** Lay words out in rows on a wall plane (x right, y up) and time their writing. */
  private wallRows(rows: Word[][], o: THREE.Vector3, size: number, lead: number): Written[] {
    const out: Written[] = [];
    rows.forEach((ws, r) => {
      let x = 0;
      const y = o.y - r * lead * 1.25;
      for (const w of ws) {
        const st0 = strokeText(w.w, SCRIPT, 100);
        const k = size / 100;
        const pt = planeText(w.w, SCRIPT, size, V3(o.x + x, y, o.z), V3(1, 0, 0), V3(0, -1, 0));
        const n = st0.charRange.length;
        const writeDur = Math.min(w.end - w.start, 0.1 + 0.05 * n);
        const charTimes: [number, number][] = [];
        for (let i = 0; i < n; i++) charTimes.push([w.start + (writeDur * i) / n, w.start + (writeDur * (i + 1)) / n]);
        const g0 = { x: o.x + x - 0.08, y }, g1 = { x: o.x + x + st0.width * k + 0.08, y };
        out.push({ word: w, pt, charTimes, writeEnd: w.start + writeDur, guide: [g0, g1], size });
        x += st0.width * k + size * 0.32;
      }
    });
    return out;
  }
  private typeTimes(pt: PlaneText, t0: number, t1: number): [number, number][] {
    const n = pt.st.charRange.length;
    return Array.from({ length: n }, (_, i) => [t0 + ((t1 - t0) * i) / n, t0 + ((t1 - t0) * (i + 0.6)) / n] as [number, number]);
  }

  // ================================================================= cameras

  private setCam(cam: THREE.PerspectiveCamera, p: Pose) {
    const cp = Math.cos(p.pitch);
    cam.position.set(p.tx + Math.sin(p.yaw) * cp * p.dist, p.ty + Math.sin(p.pitch) * p.dist, p.tz + Math.cos(p.yaw) * cp * p.dist);
    cam.up.set(0, 1, 0);
    cam.lookAt(p.tx, p.ty, p.tz);
    cam.rotateZ(p.roll);
    cam.fov = p.fov;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }
  private P(tx: number, ty: number, tz: number, dist: number, yaw: number, pitch: number, roll = 0, fov = 38): Pose { return { tx, ty, tz, dist, yaw, pitch, roll, fov }; }
  private mixP(a: Pose, b: Pose, u: number): Pose {
    return { tx: lerp(a.tx, b.tx, u), ty: lerp(a.ty, b.ty, u), tz: lerp(a.tz, b.tz, u), dist: lerp(a.dist, b.dist, u), yaw: lerp(a.yaw, b.yaw, u), pitch: lerp(a.pitch, b.pitch, u), roll: lerp(a.roll, b.roll, u), fov: lerp(a.fov, b.fov, u) };
  }
  /** A hand-held drift so no drawing ever sits still. */
  private drift(p: Pose, t: number, amt = 1): Pose {
    return { ...p, yaw: p.yaw + noise1(t * 0.6, 11) * 0.02 * amt, pitch: p.pitch + noise1(t * 0.5, 12) * 0.015 * amt, roll: p.roll + noise1(t * 0.4, 13) * 0.01 * amt };
  }

  private cam11(t: number) {
    const T = this.T, P = this.P.bind(this);
    // a slow push, then a punch-in on the downbeat as the question is sent
    const a = P(-0.5, 1.75, -0.5, 7.4, -0.3, 0.18, 0.02), a1 = P(-0.4, 1.72, -0.55, 6.6, -0.2, 0.16, 0.0);
    const b = P(-0.2, 1.7, -0.8, 5.0, -0.06, 0.1, -0.03);
    let p = this.mixP(a, a1, prog(t, T.d0, T.d1, ease.inOutQuad));
    p = this.mixP(p, b, prog(t, T.d1, T.d1 + 0.25, ease.outExpo));
    this.setCam(this.cams['11']!, this.drift(p, t));
  }
  private cam12A(t: number) {
    const T = this.T, P = this.P.bind(this), hw = this.heroW;
    // the snap: crash in on the row of words, then the hero is drawn and the camera swings low round it
    const a = P(hw / 2 - 1.2, 1.55, 0, 5.0, -0.14, 0.08, -0.09, 36);
    const a2 = P(hw / 2 - 1.0, 1.6, 0, 6.6, -0.24, 0.12, -0.03, 38);
    const b = P(hw / 2 - 0.3, 1.15, 0, 7.4, -0.5, 0.18, 0.03, 38);
    const c = P(hw / 2 + 0.2, 1.05, 0, 7.0, 0.42, 0.14, -0.03, 38);
    let p = this.mixP(a, a2, prog(t, T.d2, T.d2 + 0.22, ease.outExpo));
    p = this.mixP(p, b, prog(t, T.straw - 0.1, T.straw + 0.25, ease.outExpo));
    p = this.mixP(p, c, prog(t, T.straw + 0.25, T.d3, ease.inOutCubic));
    // before the snap (seen on the sheet): a calm front view with the row being written
    if (t < T.d2) p = this.mixP(P(hw / 2, 1.35, 0, 7.6, -0.18, 0.14, 0, 38), P(hw / 2 - 0.4, 1.45, 0, 6.6, -0.2, 0.14, 0, 38), prog(t, T.k3, T.d2));
    this.setCam(this.cams['12A']!, this.drift(p, t));
  }
  private cam12B(t: number) {
    const T = this.T, P = this.P.bind(this);
    const a = P(-2.4, 0.5, 0.4, 2.4, 0.18, 0.05, 0.08, 36);
    const a2 = P(-2.2, 0.45, 0.4, 3.2, 0.14, 0.06, 0.03, 38);
    const b = P(-0.6, -0.35, 0, 6.6, 0.12, 0.08, 0, 38);
    const c = P(-0.3, -0.5, 0, 6.1, -0.08, 0.1, -0.02, 38);
    let p = this.mixP(a, a2, prog(t, T.d3, T.d3 + 0.2, ease.outExpo));
    p = this.mixP(p, b, prog(t, T.d3 + 0.22, T.d3 + 0.45, ease.inOutCubic));
    p = this.mixP(p, c, prog(t, T.d3 + 0.45, T.d4, ease.linear));
    if (t < T.d3) p = P(-0.5, -0.3, 0, 7, 0.1, 0.08);
    this.setCam(this.cams['12B']!, this.drift(p, t));
  }
  private cam13(t: number) {
    const T = this.T, P = this.P.bind(this);
    const g = this.glass;
    const rimY = g.bowlY1, wineY = g.bowlY0 + g.wineU * (g.bowlY1 - g.bowlY0);
    const pre = P(-1.2, 1.9, 0, 8.4, -0.12, 0.12, 0, 38);
    const a = P(-0.9, 1.75, 0, 6.2, -0.2, 0.14, -0.05, 40);
    const a2 = P(-1.1, 1.7, 0, 7.6, -0.12, 0.15, -0.01, 38);
    const b = P(0.35, (rimY + wineY) / 2 + 0.05, 0, 3.0, 0.35, 0.22, 0.04, 36);
    const c = P(0.0, rimY, 0, 3.6, 0.6, 1.5, 0, 36);
    let p = t < T.d4 ? pre : this.mixP(a, a2, prog(t, T.d4, T.d4 + 0.3, ease.outExpo));
    if (t >= T.d4) p = this.mixP(p, P(-0.9, 1.72, 0, 7.0, 0.05, 0.16, 0.0, 38), prog(t, T.d4 + 0.3, T.d5, ease.inOutQuad));
    p = this.mixP(p, b, prog(t, T.d5, T.d5 + 0.28, ease.outExpo));
    p = this.mixP(p, c, prog(t, T.wineEnd - 0.2, T.d6 + 0.02, ease.inOutCubic));
    this.setCam(this.cams['13']!, this.drift(p, t, t > T.wineEnd ? 0.3 : 1));
  }

  /** Camera over the sheet that frames panel `p` exactly (it fills the frame). */
  private framed(p: Panel): Pose {
    const d = p.hh / Math.tan(THREE.MathUtils.degToRad(20));
    return { tx: p.cx, ty: p.cy, tz: 0, dist: d, yaw: 0, pitch: Math.PI / 2 - 1e-4, roll: 0, fov: 40 };
  }
  /** Sheet camera looking down at (tx, ty) from `dist`, tilted by `tilt` from straight down. */
  private over(tx: number, ty: number, dist: number, tilt: number, yaw: number, roll: number, fov = 40): Pose {
    return { tx, ty, tz: 0, dist, yaw, pitch: Math.PI / 2 - tilt, roll, fov };
  }
  private setMain(p: Pose) {
    const c = this.main;
    // the sheet lies in z = 0; "pitch" is the angle above it, yaw turns the camera round the sheet's normal
    const cp = Math.cos(p.pitch);
    c.position.set(p.tx + Math.sin(p.yaw) * cp * p.dist, p.ty - Math.cos(p.yaw) * cp * p.dist, p.tz + Math.sin(p.pitch) * p.dist);
    c.up.set(-Math.sin(p.yaw), Math.cos(p.yaw), 0);
    c.lookAt(p.tx, p.ty, p.tz);
    c.rotateZ(p.roll);
    c.fov = p.fov;
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
  }

  /** Which view the frame shows: a panel's drawing full frame, or the sheet. */
  private shot(t: number): { mode: 'direct'; id: string } | { mode: 'sheet'; pose: Pose } {
    const T = this.T;
    const pan = (id: string) => this.panels.find((p) => p.id === id)!;
    if (t < T.k1) return { mode: 'direct', id: '11' };
    if (t < T.d2) {
      // the wind-up: three kicks, three jolts back out of the drawing; then hold the breath towards 12A
      const f = this.framed(pan('11'));
      const s1 = this.over(-8.6, 5.0, f.dist * 1.35, 0.1, -0.03, 0.02);
      const s2 = this.over(0, 4.2, 31, 0.22, -0.05, -0.02);
      const s3 = this.over(1.5, -0.5, 44, 0.32, -0.08, -0.04);
      const k = keys(t, [[T.k1, 0], [T.k1 + 0.1, 1, ease.outExpo], [T.k2, 1.04, ease.linear], [T.k2 + 0.1, 2, ease.outExpo], [T.k3, 2.04, ease.linear], [T.k3 + 0.12, 3, ease.outExpo]]);
      let p = k < 1 ? this.mixP(f, s1, k) : k < 2 ? this.mixP(s1, s2, k - 1) : this.mixP(s2, s3, k - 2);
      const hold = prog(t, T.k3 + 0.12, T.d2, ease.inQuad);
      const breath = this.over(9.0, 4.6, 19.5, 0.14, 0.05, 0.03);
      p = this.mixP(p, breath, hold);
      return { mode: 'sheet', pose: p };
    }
    if (t < T.d3) return { mode: 'direct', id: '12A' };
    if (t < T.l2 - 0.12) return { mode: 'direct', id: '12B' };
    if (t < T.d4) {
      // out of 12B onto the sheet, 13 being roughed in beside it; then the whip into 13
      const f = this.framed(pan('12B'));
      const wide = this.over(3.5, -9.8, 24, 0.33, 0.08, 0.03);
      const whipStart = T.d4 - 0.22;
      let p = this.mixP(f, wide, prog(t, T.l2 - 0.12, T.l2 + 0.25, ease.outExpo));
      p = this.mixP(p, this.over(3, -9.6, 26, 0.3, 0.02, 0.0), prog(t, T.l2 + 0.25, whipStart, ease.inOutQuad));
      p = this.mixP(p, this.framed(pan('13')), prog(t, whipStart, T.d4, ease.inQuart));
      return { mode: 'sheet', pose: p };
    }
    return { mode: 'direct', id: '13' };
  }

  // ================================================================= the drawn worlds

  private drawScene(id: string, t: number) {
    if (id === '11') this.scene11(t);
    else if (id === '12A') this.scene12A(t);
    else if (id === '12B') this.scene12B(t);
    else this.scene13(t);
  }

  /** Write a set of lyric words on their plane: guides, the writing, the pencil tip, re-trace on held notes. */
  private writeWords(ws: Written[], cam: THREE.PerspectiveCamera, t: number, o: { w?: number; dark?: number; noTip?: boolean } = {}) {
    const pen = this.pen;
    let tip: V2 | null = null, tipW: Written | null = null;
    for (const wr of ws) {
      const w = wr.word;
      // the guideline, ruled in blue just before the word
      const gp = prog(t, w.start - 0.4, w.start - 0.25, ease.outQuad);
      if (gp > 0) {
        const a = V3(wr.guide[0].x, wr.guide[0].y, wr.pt.o.z), b = V3(lerp(wr.guide[0].x, wr.guide[1].x, gp), wr.guide[1].y, wr.pt.o.z);
        const xh = wr.size * 0.38;
        line3(pen, cam, [a, b], { ch: BLUE, w: 1.2, dark: 0.3, passes: 1, over: 18, seed: w.gi });
        line3(pen, cam, [V3(a.x, a.y + xh, a.z), V3(b.x, b.y + xh, b.z)], { ch: BLUE, w: 1, dark: 0.18, passes: 1, over: 10, seed: w.gi + 0.5 });
      }
      if (t < w.start) continue;
      const len = writtenLength(wr.pt.st, wr.charTimes, t);
      const head = drawPlaneText(pen, cam, wr.pt, len, { w: 2.5 * (o.w ?? 1), dark: 0.55 * (o.dark ?? 1), passes: 2, jit: 1.1, seed: w.gi * 3 });
      if (t < wr.writeEnd + 0.08) { tip = head; tipW = wr; }
      // held notes: the pencil goes over the word again, heavier
      const hold = w.end - wr.writeEnd;
      if (hold > 0.3 && t > wr.writeEnd + 0.05) {
        const u = prog(t, wr.writeEnd + 0.05, w.end, ease.inOutQuad);
        const h2 = drawPlaneText(pen, cam, wr.pt, wr.pt.st.total * u, { w: 3.6 * (o.w ?? 1), dark: 0.6 * (o.dark ?? 1), passes: 1, jit: 1.6, seed: w.gi * 3 + 9 });
        if (u < 1) { tip = h2; tipW = wr; }
      }
    }
    if (tip && tipW && !o.noTip) {
      const o = tipW.pt.o, s0 = proj(cam, o), s1 = proj(cam, V3(o.x, o.y + tipW.size, o.z));
      const px = s0 && s1 ? Math.abs(s1.y - s0.y) : 60;
      pencilTip(pen, tip.x, tip.y, clamp(px * 0.13, 5, 18), frameIdx(t));
    }
  }

  private scene11(t: number) {
    const cam = this.cams['11']!;
    this.cam11(t);
    const pen = this.pen, T = this.T;
    // construction: the desk's edge and the wall's corner, and a horizon
    line3(pen, cam, [V3(-6, 0, 1.4), V3(6, 0, 1.4)], { ch: BLUE, w: 1.2, dark: 0.3, passes: 1, over: 30 });
    line3(pen, cam, [V3(-6, 0, -1.6), V3(6, 0, -1.6)], { w: 1.8, dark: 0.35, passes: 1, over: 20, seed: 2 });
    line3(pen, cam, [V3(-6, 0, 1.4), V3(6, 0, 1.4)], { w: 2.2, dark: 0.5, passes: 2, over: 20, seed: 3 });
    // the laptop: base and lid (an opened lid leans back 15 degrees)
    const base = new THREE.Matrix4().makeTranslation(0, 0.06, -0.35);
    drawBox(pen, cam, base, V3(1.35, 0.06, 0.62), { w: 2.4, dark: 0.55, passes: 2, over: 5 });
    const lid = new THREE.Matrix4().makeTranslation(0, 0.12, -0.97).multiply(new THREE.Matrix4().makeRotationX(-0.26)).multiply(new THREE.Matrix4().makeTranslation(0, 0.86, 0));
    drawBox(pen, cam, lid, V3(1.35, 0.86, 0.035), { w: 2.4, dark: 0.55, passes: 2, over: 5, seed: 7 });
    // keyboard: a hatched field of keys
    for (let r = 0; r < 4; r++) {
      const z = -0.72 + r * 0.17;
      line3(pen, cam, [V3(-1.15, 0.125, z), V3(1.15, 0.125, z)], { w: 1.2, dark: 0.25, passes: 1, seed: r });
      for (let i = 0; i <= 12; i++) { const x = -1.15 + (i * 2.3) / 12 + (r % 2) * 0.08; if (x < 1.16) line3(pen, cam, [V3(x, 0.125, z), V3(x, 0.125, z + 0.13)], { w: 1, dark: 0.2, passes: 1, seed: r * 20 + i }); }
    }
    line3(pen, cam, [V3(-0.35, 0.125, -0.02), V3(0.35, 0.125, -0.02), V3(0.35, 0.125, 0.18), V3(-0.35, 0.125, 0.18), V3(-0.35, 0.125, -0.02)], { w: 1.2, dark: 0.3, passes: 1, seed: 40 });
    // shadow under the laptop, hatched
    const sh = projAll(cam, [V3(-1.45, 0, 0.35), V3(1.6, 0, 0.35), V3(1.9, 0, -0.9), V3(-1.2, 0, -0.9)]);
    hatchRegion(pen, sh, 9, 0.9, { w: 1.2, dark: 0.18 });
    const lsm = projAll(cam, [V3(-1.5, 0.01, 0.45), V3(0.2, 0.01, 0.5), V3(1.8, 0.01, 0.4)]);
    if (lsm) pen.smudge(lsm, 36, 0.1, 3);
    // the screen: a chat window with the question typed into it
    const scr = (x: number, y: number) => new THREE.Vector3(x, y, 0.04).applyMatrix4(lid);
    const rect = (x0: number, y0: number, x1: number, y1: number) => [scr(x0, y0), scr(x1, y0), scr(x1, y1), scr(x0, y1), scr(x0, y0)];
    line3(pen, cam, rect(-1.22, -0.74, 1.22, 0.74), { w: 1.6, dark: 0.4, passes: 1, seed: 50 });
    line3(pen, cam, rect(-1.22, 0.52, 1.22, 0.74), { w: 1.4, dark: 0.3, passes: 1, seed: 51 });
    const hdr = projAll(cam, rect(-1.22, 0.52, 1.22, 0.74).slice(0, 4));
    hatchRegion(pen, hdr, 5, -0.6, { w: 1.1, dark: 0.3 });
    const label = planeText('chatbot', 'readable', 0.13, scr(-1.05, 0.58), new THREE.Vector3(1, 0, 0), scr(0, -1).sub(scr(0, 0)));
    drawPlaneText(pen, cam, label, 1e9, { w: 1.6, dark: 0.7, passes: 1, jit: 0.6 });
    const lidN = new THREE.Vector3(0, 0, 1).applyMatrix3(new THREE.Matrix3().setFromMatrix4(lid)).normalize();
    line3(pen, cam, circle3(scr(-1.13, 0.63), 0.05, lidN, 12), { w: 1.4, dark: 0.5, passes: 1 });
    // the message bubble and the typed question
    line3(pen, cam, rect(-1.3 + 0.12, -0.05, 1.1, 0.34), { w: 1.4, dark: 0.35, passes: 1, seed: 52 });
    const qlen = writtenLength(this.question.st, this.qTimes, t);
    const qo = new THREE.Vector3().copy(scr(-1.1, 0.1));
    this.question.o.copy(qo);
    this.question.down.copy(scr(0, -1).sub(scr(0, 0)).normalize());
    this.question.right.copy(scr(1, 0).sub(scr(0, 0)).normalize());
    const head = drawPlaneText(pen, cam, this.question, qlen, { w: 1.9, dark: 0.7, passes: 1, jit: 0.6 });
    // the cursor blinks on twos
    if (head && Math.floor(frameIdx(t) / 10) % 2 === 0) pen.line([{ x: head.x + 6, y: head.y - 22 }, { x: head.x + 6, y: head.y + 2 }], { w: 2, dark: 0.7, passes: 1, jit: 0.3 });
    // props: a mug with steam, a sticky note, the wall's shade behind the desk
    const up = V3(0, 1, 0), mc = V3(2.05, 0, -0.3), mr = 0.26, mh = 0.52;
    line3(pen, cam, circle3(V3(mc.x, mh, mc.z), mr, up, 32), { w: 2.2, dark: 0.55, passes: 2, seed: 81 });
    line3(pen, cam, circle3(V3(mc.x, mh - 0.06, mc.z), mr * 0.86, up, 28, 0.3, Math.PI - 0.3), { w: 1.3, dark: 0.3, passes: 1, seed: 82 });
    {
      const d = new THREE.Vector3().subVectors(cam.position, mc).setY(0).normalize();
      const side = V3(-d.z, 0, d.x);
      for (const sg of [-1, 1]) line3(pen, cam, [V3(mc.x + side.x * mr * sg, 0, mc.z + side.z * mr * sg), V3(mc.x + side.x * mr * sg, mh, mc.z + side.z * mr * sg)], { w: 2.2, dark: 0.55, passes: 2, seed: 83 + sg });
      line3(pen, cam, circle3(mc, mr, up, 32, Math.atan2(d.z, d.x) - Math.PI / 2, Math.atan2(d.z, d.x) + Math.PI / 2), { w: 2.2, dark: 0.55, passes: 2, seed: 85 });
      const hx = mc.x + side.x * mr * 1.0, hz = mc.z + side.z * mr;
      line3(pen, cam, [V3(hx, mh * 0.78, hz), V3(hx + side.x * 0.16, mh * 0.72, hz + side.z * 0.16), V3(hx + side.x * 0.18, mh * 0.4, hz + side.z * 0.18), V3(hx, mh * 0.3, hz)], { w: 2.4, dark: 0.55, passes: 2, seed: 86 });
      const shade = projAll(cam, [V3(mc.x + side.x * mr * 0.2, 0.02, mc.z + side.z * mr * 0.2), V3(mc.x + side.x * mr, 0.02, mc.z + side.z * mr), V3(mc.x + side.x * mr, mh, mc.z + side.z * mr), V3(mc.x + side.x * mr * 0.2, mh, mc.z + side.z * mr * 0.2)]);
      hatchRegion(pen, shade, 5, 0.3, { w: 1.2, dark: 0.3, seed: 87 });
      for (let k = 0; k < 3; k++) {
        const st: THREE.Vector3[] = [];
        for (let i = 0; i <= 10; i++) { const y = mh + 0.08 + i * 0.06; st.push(V3(mc.x - 0.1 + k * 0.1 + Math.sin(i * 0.9 + k + frameIdx(t) / 10) * 0.05, y, mc.z)); }
        line3(pen, cam, st, { w: 1.3, dark: 0.22, passes: 1, seed: 88 + k });
      }
    }
    const nz = -1.59, nx0 = 2.35, ny0 = 1.05;
    line3(pen, cam, [V3(nx0, ny0, nz), V3(nx0 + 0.95, ny0 - 0.03, nz), V3(nx0 + 0.97, ny0 + 0.9, nz), V3(nx0 + 0.02, ny0 + 0.92, nz), V3(nx0, ny0, nz)], { w: 1.8, dark: 0.45, passes: 1, over: 4, seed: 90 });
    const stick = planeText('TABS', 'readable', 0.22, V3(nx0 + 0.12, ny0 + 0.62, nz), V3(1, 0, 0), V3(0, -1, 0));
    drawPlaneText(pen, cam, stick, 1e9, { w: 2, dark: 0.6, passes: 1 });
    const stick2 = planeText('> spaces', 'readable', 0.16, V3(nx0 + 0.1, ny0 + 0.3, nz), V3(1, 0, 0), V3(0, -1, 0));
    drawPlaneText(pen, cam, stick2, 1e9, { w: 1.6, dark: 0.5, passes: 1 });
    hatchRegion(pen, projAll(cam, [V3(-6, 0, -1.6), V3(6, 0, -1.6), V3(6, 0.55, -1.6), V3(-6, 0.35, -1.6)]), 8, -0.5, { w: 1.2, dark: 0.16, seed: 91 });
    // the lyric on the wall
    this.writeWords(this.wall11, cam, t);
    // "thing!" is held: the three kicks of the fill underline it
    const thing = this.wall11[this.wall11.length - 1]!;
    [T.k1, T.k2, T.k3].forEach((k, i) => {
      if (t < k!) return;
      const u = prog(t, k!, k! + 0.06);
      const x0 = thing.guide[0].x, x1 = thing.guide[1].x, y = thing.guide[0].y - 0.12 - i * 0.07;
      line3(pen, cam, [V3(x0, y, -1.6), V3(lerp(x0, x1, u), y + 0.02, -1.6)], { w: 2.6, dark: 0.6, passes: 1, over: 12, seed: 70 + i });
    });
  }

  private scene12A(t: number) {
    const cam = this.cams['12A']!;
    this.cam12A(t);
    const pen = this.pen, T = this.T, hw = this.heroW;
    // blue construction: the ground plane in perspective and a horizon
    for (let i = -2; i <= 6; i++) line3(pen, cam, [V3(-3, 0, i * 0.6 - 1.6), V3(hw + 3, 0, i * 0.6 - 1.6)], { ch: BLUE, w: 1, dark: 0.16, passes: 1, over: 20, seed: i });
    for (let i = -4; i <= 14; i++) line3(pen, cam, [V3(i * 0.7 - 1, 0, -3), V3(i * 0.7 - 1, 0, 2)], { ch: BLUE, w: 1, dark: 0.13, passes: 1, over: 10, seed: 30 + i });
    line3(pen, cam, [V3(-4, 0, 0.02), V3(hw + 4, 0, 0.02)], { w: 2, dark: 0.4, passes: 1, over: 30, seed: 5 });
    // the row of words above
    this.writeWords(this.row12, cam, t, { w: 1.05 });
    // STRAWBERRY: construction boxes 0.4 s ahead, then each block drawn as the word is sung
    const light = new THREE.Vector3(-0.6, 0.8, 0).normalize();
    this.hero.forEach((h, i) => {
      // (the crash on the downbeat slams the hero's blocking in: empty boxes, no letters yet)
      const cons = prog(t, T.d2 + i * 0.012, T.d2 + 0.1 + i * 0.012, ease.outExpo);
      const p = prog(t, h.t0, h.t1, ease.outQuad);
      const m = new THREE.Matrix4().makeTranslation(h.x, 0, 0);
      drawBlock(pen, h.b, { m, cam, prog: p, light, weight: 1 + 0.35 * prog(t, T.strawEnd - 0.5, T.strawEnd), seed: i * 11, construct: cons * (1 - 0.6 * p) });
      if (p > 0.6) {
        // cast shadow on the ground, hatched
        const b = h.b;
        const sh = projAll(cam, [V3(h.x + b.x0, 0, 0), V3(h.x + b.x1, 0, 0), V3(h.x + b.x1 + 0.35, 0, -0.55), V3(h.x + b.x0 + 0.35, 0, -0.55)]);
        hatchRegion(pen, sh, 7, 1.1, { w: 1.1, dark: 0.22 * prog(p, 0.6, 1), seed: i });
      }
    });
    // the side of the hand has dragged through the graphite under the letters
    const smq = projAll(cam, [V3(-0.2, 0.02, -0.2), V3(hw * 0.5, 0.02, -0.3), V3(hw + 0.2, 0.02, -0.25)]);
    if (smq) pen.smudge(smq, 40, 0.12 * prog(t, T.straw + 0.3, T.straw + 0.8), 9);
    // count the R's: red rings and numbers on the beats inside the held note
    const beats = this.ctx.audio.beats.filter((b) => b > T.straw + 0.25 && b < T.strawEnd + 0.2);
    const rIdx = [2, 7, 8];
    const w1 = this.snares.find((sn) => sn > T.straw + 0.3 && sn < T.strawEnd) ?? beats[0] ?? T.straw + 0.45;
    const when = [T.straw + 0.26, w1, Math.min(w1 + (this.ctx.audio.timeOfBeat(1) - this.ctx.audio.timeOfBeat(0)) * 0.5, T.d3 - 0.26)];
    rIdx.forEach((ri, k) => {
      const h = this.hero[ri]!;
      const t0 = Math.max(when[k]!, h.t1);
      if (t < t0) return;
      const c = V3(h.x + h.b.x1 / 2, 0.62, 0.05);
      const rx = h.b.x1 * 0.62 + 0.06, ry = 0.78;
      const pts = circle3(c, 1, V3(0, 0, 1), 40, -2.4 + k, -2.4 + k + Math.PI * 2.25).map((p) => V3(c.x + (p.x - c.x) * rx, c.y + (p.y - c.y) * ry, c.z));
      const q = projAll(cam, pts);
      if (q) {
        let L = 0; for (let i = 1; i < q.length; i++) L += Math.hypot(q[i]!.x - q[i - 1]!.x, q[i]!.y - q[i - 1]!.y);
        pen.line(q, { ch: RED, w: 3.2, dark: 0.8, passes: 2, jit: 1.5, seed: 90 + k, len: L * prog(t, t0, t0 + 0.1, ease.outQuad) });
      }
      const num = planeText(String(k + 1), 'readable', 0.45, V3(c.x - 0.12, -0.62, 0.05), V3(1, 0, 0), V3(0, -1, 0));
      drawPlaneText(pen, cam, num, num.st.total * prog(t, t0 + 0.08, t0 + 0.2), { ch: RED, w: 3, dark: 0.85, passes: 2, jit: 1 });
    });
    // the tally
    const tt = Math.min(T.strawEnd - 0.15, T.d3 - 0.2);
    if (t > tt) {
      const note = planeText('= 3 R’s!', 'readable', 0.55, V3(hw * 0.5 + 0.9, 2.05, 0.3), V3(1, 0, 0), V3(0, -1, 0));
      drawPlaneText(pen, cam, note, note.st.total * prog(t, tt, tt + 0.15), { ch: RED, w: 3.2, dark: 0.85, passes: 2 });
    }
  }

  private scene12B(t: number) {
    const cam = this.cams['12B']!;
    this.cam12B(t);
    const pen = this.pen, T = this.T;
    // the chat card: a floating slab with a tail, header strip, the bot's face
    const card = new THREE.Matrix4().makeTranslation(0, 0.3, 0);
    drawBox(pen, cam, card, V3(1.9, 0.62, 0.07), { w: 2.4, dark: 0.55, passes: 2, over: 5, seed: 3 }, { w: 1, dark: 0.12, passes: 1 });
    const f = (x: number, y: number) => V3(x, y + 0.3, 0.075);
    line3(pen, cam, [f(-1.9, 0.36), f(1.9, 0.36)], { w: 1.6, dark: 0.4, passes: 1, seed: 4 });
    hatchRegion(pen, projAll(cam, [f(-1.9, 0.36), f(1.9, 0.36), f(1.9, 0.62), f(-1.9, 0.62)]), 5, -0.7, { w: 1.1, dark: 0.3 });
    line3(pen, cam, [f(-1.3, -0.62), f(-1.55, -0.95), f(-1.0, -0.62)], { w: 2.2, dark: 0.5, passes: 2, seed: 6 });
    const face = [f(-1.8, 0.4), f(-1.56, 0.4), f(-1.56, 0.58), f(-1.8, 0.58), f(-1.8, 0.4)];
    line3(pen, cam, face, { w: 1.5, dark: 0.6, passes: 1, seed: 8 });
    const lbl = planeText('chatbot', 'readable', 0.17, f(-1.48, 0.43), V3(1, 0, 0), V3(0, -1, 0));
    drawPlaneText(pen, cam, lbl, 1e9, { w: 1.8, dark: 0.75, passes: 1, jit: 0.6 });
    // the answer, typed
    const len = writtenLength(this.reply.st, this.rTimes, t);
    drawPlaneText(pen, cam, this.reply, len, { w: 2.1, dark: 0.7, passes: 1, jit: 0.7, seed: 12 });
    // the big "2", drawn heavy on the downbeat of the cut
    const p2 = prog(t, T.d3, T.d3 + 0.12, ease.outQuad);
    drawPlaneText(pen, cam, this.two, this.two.st.total * p2, { w: 15, dark: 0.75, passes: 3, jit: 2.2, seed: 20 });
    const c2 = V3(-2.95, 0.5, 0.4);
    const ring = projAll(cam, circle3(c2, 1.05, V3(0, 0, 1), 44, -2.2, -2.2 + Math.PI * 2.2));
    if (ring && t > T.d3 + 0.15) {
      let L = 0; for (let i = 1; i < ring.length; i++) L += Math.hypot(ring[i]!.x - ring[i - 1]!.x, ring[i]!.y - ring[i - 1]!.y);
      pen.line(ring, { ch: RED, w: 4, dark: 0.85, passes: 2, jit: 1.6, seed: 30, len: L * prog(t, T.d3 + 0.15, T.d3 + 0.27, ease.outQuad) });
    }
    const slashT = Math.max(T.d3 + 0.34, this.snares.find((s) => s > T.d3 + 0.2) ?? T.d3 + 0.35);
    if (t > slashT) {
      const u = prog(t, slashT, slashT + 0.06);
      line3(pen, cam, [V3(-3.9, -0.6, 0.45), V3(lerp(-3.9, -2.0, u), lerp(-0.6, 1.6, u), 0.45)], { ch: RED, w: 4.5, dark: 0.9, passes: 2, over: 10, seed: 31 });
    }
    if (t > T.d3 + 0.38) {
      const n3 = planeText('3!', 'readable', 0.75, V3(-4.35, -0.75, 0.4), V3(1, 0, 0), V3(0, -1, 0));
      drawPlaneText(pen, cam, n3, n3.st.total * prog(t, T.d3 + 0.38, T.d3 + 0.48), { ch: RED, w: 4, dark: 0.9, passes: 2 });
    }
    // what the model sees: two tokens, boxed in blue, and the red note
    const tokY = -1.25;
    const tA = planeText('straw', 'readable', 0.34, V3(-0.95, tokY, 0), V3(1, 0, 0), V3(0, -1, 0));
    const tB = planeText('berry', 'readable', 0.34, V3(0.55, tokY, 0), V3(1, 0, 0), V3(0, -1, 0));
    const tp = prog(t, T.d3 + 0.26, T.d3 + 0.36);
    if (tp > 0) {
      drawPlaneText(pen, cam, tA, tA.st.total * tp, { w: 2.4, dark: 0.65, passes: 1 });
      drawPlaneText(pen, cam, tB, tB.st.total * prog(t, T.d3 + 0.32, T.d3 + 0.42), { w: 2.4, dark: 0.65, passes: 1 });
      const bx = (x0: number, x1: number, s: number) => line3(pen, cam, [V3(x0, tokY - 0.12, 0), V3(x1, tokY - 0.12, 0), V3(x1, tokY + 0.36, 0), V3(x0, tokY + 0.36, 0), V3(x0, tokY - 0.12, 0)], { ch: BLUE, w: 2, dark: 0.55, passes: 1, over: 8, seed: s, len: 2000 * prog(t, T.d3 + 0.4, T.d3 + 0.5) });
      bx(-1.05, 0.42, 40); bx(0.47, 1.95, 41);
      const lab = (s: string, x: number, sd: number) => { const p = planeText(s, 'tech', 0.16, V3(x, tokY - 0.34, 0), V3(1, 0, 0), V3(0, -1, 0)); drawPlaneText(pen, cam, p, p.st.total * prog(t, T.d3 + 0.45, T.d3 + 0.55), { ch: BLUE, w: 1.6, dark: 0.6, passes: 1, seed: sd }); };
      lab('token 1', -1.0, 1); lab('token 2', 0.52, 2);
      const note = planeText('it sees tokens, not letters', 'readable', 0.2, V3(-1.05, tokY - 0.75, 0), V3(1, 0, 0), V3(0, -1, 0));
      drawPlaneText(pen, cam, note, note.st.total * prog(t, T.d3 + 0.48, T.d3 + 0.6), { ch: RED, w: 2.4, dark: 0.85, passes: 1 });
    }
  }

  private scene13(t: number) {
    const cam = this.cams['13']!;
    this.cam13(t);
    const pen = this.pen, T = this.T, g = this.glass;
    const H = g.bowlY1 - g.bowlY0;
    const rimY = g.bowlY1, wineY = g.bowlY0 + g.wineU * H;
    const C = V3(0, 0, 0);
    const up = V3(0, 1, 0);
    // table and wall
    line3(pen, cam, [V3(-6, 0, 1.2), V3(6, 0, 1.2)], { w: 2.2, dark: 0.45, passes: 2, over: 20, seed: 1 });
    line3(pen, cam, [V3(-6, 0, -0.8), V3(6, 0, -0.8)], { w: 1.6, dark: 0.3, passes: 1, over: 20, seed: 2 });
    // blue construction: centre line, the ellipses of rim, wine and foot (the rough, drawn first)
    const cons = prog(t, T.l2 + 0.1, T.l2 + 0.5);
    if (cons > 0) {
      line3(pen, cam, [V3(0, -0.2, 0), V3(0, lerp(-0.2, rimY + 0.5, cons), 0)], { ch: BLUE, w: 1.2, dark: 0.35, passes: 1, over: 10 });
      for (const [y, r] of [[rimY, g.r(1)], [wineY, g.r(g.wineU)], [0.02, g.footR], [g.bowlY0 + H * 0.62, g.r(0.62)]] as [number, number][]) {
        const q = projAll(cam, circle3(V3(0, y, 0), r, up, 36));
        if (q) pen.line(q, { ch: BLUE, w: 1.1, dark: 0.3, passes: 1, len: 3000 * cons, seed: y * 10 });
      }
    }
    // the glass, drawn as "glass" is sung
    const gp = prog(t, T.glass - 0.02, T.glass + 0.34, ease.outQuad);
    if (gp > 0) {
      const [Ls, Rs] = revolveSilhouette(g, C, cam.position, 0, 1, 30);
      const dl = (pts: THREE.Vector3[], o: StrokeOpts, u: number) => {
        const q = projAll(cam, pts);
        if (!q) return;
        let L = 0; for (let i = 1; i < q.length; i++) L += Math.hypot(q[i]!.x - q[i - 1]!.x, q[i]!.y - q[i - 1]!.y);
        pen.line(q, { ...o, len: L * u });
      };
      const heavy = { w: 2.6, dark: 0.6, passes: 2, jit: 1.3 };
      dl([...Ls].reverse(), { ...heavy, seed: 1 }, clamp(gp * 1.6));
      dl([...Rs].reverse(), { ...heavy, seed: 2 }, clamp(gp * 1.6));
      dl(circle3(V3(0, rimY, 0), g.r(1), up, 48), { ...heavy, seed: 3 }, clamp(gp * 2 - 0.2));
      dl([V3(-0.03, g.bowlY0, 0), V3(-0.03, g.stemY0 + 0.05, 0)], { ...heavy, seed: 4 }, clamp(gp * 2 - 0.5));
      dl([V3(0.03, g.bowlY0, 0), V3(0.03, g.stemY0 + 0.05, 0)], { ...heavy, seed: 5 }, clamp(gp * 2 - 0.5));
      dl(circle3(V3(0, 0.03, 0), g.footR, up, 44), { ...heavy, seed: 6 }, clamp(gp * 2 - 0.8));
      dl(circle3(V3(0, 0.07, 0), g.footR * 0.92, up, 44, Math.PI * 0.05, Math.PI * 0.95), { w: 1.5, dark: 0.35, passes: 1, seed: 7 }, clamp(gp * 2 - 0.9));
      // the wine: its surface ellipse and dense hatching below it
      const wp = prog(t, T.glass + 0.3, T.wine + 0.25);
      if (wp > 0) {
        const [wl, wr] = revolveSilhouette(g, C, cam.position, 0.02, g.wineU, 18);
        const surf = circle3(V3(0, wineY, 0), g.r(g.wineU), up, 40);
        dl(surf, { w: 2.2, dark: 0.55, passes: 2, seed: 8 }, clamp(wp * 2));
        const polyW = projAll(cam, [...wl, ...[...wr].reverse()]);
        hatchRegion(pen, polyW, 5.5, 0.75, { w: 1.6, dark: 0.5 * wp, seed: 1 });
        hatchRegion(pen, polyW, 7, -0.7, { w: 1.4, dark: 0.35 * clamp(wp * 2 - 1), seed: 2 });
        const surfQ = projAll(cam, surf);
        hatchRegion(pen, surfQ, 9, 0.2, { w: 1.1, dark: 0.18 * wp, seed: 3 });
      }
      // the bowl's shaded side, hatched along the glass, and a smudge where it stands
      if (gp > 0.5) {
        const [bl, br] = revolveSilhouette(g, C, cam.position, 0.06, 0.97, 16);
        const R = projAll(cam, br), Lq = projAll(cam, bl);
        if (R && Lq) {
          const inner = R.map((p, i) => ({ x: lerp(p.x, Lq[i]!.x, 0.28), y: lerp(p.y, Lq[i]!.y, 0.28) }));
          hatchRegion(pen, [...R, ...inner.reverse()], 6, 1.25, { w: 1.4, dark: 0.3 * clamp(gp * 2 - 1), seed: 12 });
        }
        const sm = projAll(cam, [V3(-0.4, 0, 0.25), V3(0.5, 0, 0.1), V3(1.5, 0, -0.35)]);
        if (sm) pen.smudge(sm, 34, 0.14 * gp, 5);
      }
      // highlights: a few strokes left of centre on the bowl, and the table shadow
      dl(revolveSilhouette(g, C, V3(cam.position.x * 0.6 - 1.2, cam.position.y, cam.position.z * 0.6), 0.55, 0.92, 8)[0], { w: 1.3, dark: 0.3, passes: 1, seed: 9 }, clamp(gp * 2 - 1));
      const shq = projAll(cam, [V3(-0.5, 0, 0.1), V3(0.6, 0, 0.3), V3(1.9, 0, -0.5), V3(1.2, 0, -0.75)]);
      hatchRegion(pen, shq, 8, 1.2, { w: 1.1, dark: 0.18 * gp, seed: 4 });
    }
    // an erased first try: the wine drawn to the brim, rubbed out
    if (t > T.glass + 0.2) {
      const ghost = projAll(cam, circle3(V3(0, rimY - 0.08, 0), g.r(0.94), up, 36));
      if (ghost) pen.line(ghost, { w: 2, dark: 0.08, passes: 1, jit: 0.4, seed: 60 });
      if (ghost) pen.line(ghost, { w: 16, dark: -0.1, passes: 2, jit: 3, seed: 61 });
    }
    // the lyric on the wall
    this.writeWords(this.wall13, cam, t);
    // the prompt and the cheerful claim
    const pr = planeText('prompt: a wine glass filled to the brim', 'readable', 0.15, V3(-4.45, 1.45, -0.8), V3(1, 0, 0), V3(0, -1, 0));
    drawPlaneText(pen, cam, pr, pr.st.total * prog(t, T.l2 + 0.2, T.d4 + 0.2), { w: 1.8, dark: 0.6, passes: 1, jit: 0.6 });
    const cl = planeText('“Here’s a wine glass', 'readable', 0.17, V3(0.6, 3.2, -0.3), V3(1, 0, 0), V3(0, -1, 0));
    const cl2 = planeText('filled to the brim!”', 'readable', 0.17, V3(0.68, 2.93, -0.3), V3(1, 0, 0), V3(0, -1, 0));
    const clp = prog(t, T.d4 + 0.35, T.d4 + 0.95);
    if (clp > 0) {
      drawPlaneText(pen, cam, cl, cl.st.total * clp * 2, { w: 1.9, dark: 0.7, passes: 1, jit: 0.6 });
      drawPlaneText(pen, cam, cl2, cl2.st.total * (clp * 2 - 1), { w: 1.9, dark: 0.7, passes: 1, jit: 0.6 });
      const bb = [V3(0.45, 3.45, -0.3), V3(2.75, 3.45, -0.3), V3(2.75, 2.75, -0.3), V3(0.95, 2.75, -0.3), V3(0.62, 2.42, -0.3), V3(0.75, 2.75, -0.3), V3(0.45, 2.75, -0.3), V3(0.45, 3.45, -0.3)];
      const q = projAll(cam, bb);
      if (q) pen.line(q, { w: 1.8, dark: 0.45, passes: 1, over: 5, len: 4000 * clp, seed: 70 });
      const who = planeText('chatbot:', 'tech', 0.13, V3(0.5, 3.6, -0.3), V3(1, 0, 0), V3(0, -1, 0));
      drawPlaneText(pen, cam, who, 1e9 * clp, { w: 1.5, dark: 0.55, passes: 1 });
    }
    // BRIM: the red line at the rim, the gap measured, the ring at the end
    const tb = T.d4 + 0.55;
    const rub = 1 - prog(t, T.wineEnd - 0.1, T.wineEnd + 0.3);
    if (t > tb && rub > 0) {
      const R1 = g.r(1);
      const u = prog(t, tb, tb + 0.1);
      line3(pen, cam, [V3(-R1 - 0.3, rimY, 0.2), V3(lerp(-R1 - 0.3, R1 + 0.9, u), rimY, 0.2)], { ch: RED, w: 3, dark: 0.85 * rub, passes: 2, over: 8, seed: 80 });
      const lb = planeText('BRIM', 'readable', 0.26, V3(R1 + 0.95, rimY - 0.1, 0.2), V3(1, 0, 0), V3(0, -1, 0));
      drawPlaneText(pen, cam, lb, lb.st.total * prog(t, tb + 0.08, tb + 0.25), { ch: RED, w: 3, dark: 0.9 * rub, passes: 2 });
    }
    const tg = T.d5 + 0.04;
    if (t > tg && rub > 0) {
      const R1 = g.r(1), x = R1 + 0.45;
      const u = prog(t, tg, tg + 0.14);
      line3(pen, cam, [V3(x, rimY, 0.2), V3(x, lerp(rimY, wineY, u), 0.2)], { ch: RED, w: 2.6, dark: 0.85 * rub, passes: 2, seed: 81 });
      line3(pen, cam, [V3(x - 0.08, rimY - 0.12, 0.2), V3(x, rimY, 0.2), V3(x + 0.08, rimY - 0.12, 0.2)], { ch: RED, w: 2.4, dark: 0.85 * rub, passes: 1, seed: 82 });
      if (u >= 1) line3(pen, cam, [V3(x - 0.08, wineY + 0.12, 0.2), V3(x, wineY, 0.2), V3(x + 0.08, wineY + 0.12, 0.2)], { ch: RED, w: 2.4, dark: 0.85 * rub, passes: 1, seed: 83 });
      line3(pen, cam, [V3(0.1, wineY, 0.2), V3(x + 0.12, wineY, 0.2)], { ch: RED, w: 1.8, dark: 0.6 * rub, passes: 1, seed: 84, len: 3000 * u });
      const gl = planeText('GAP?!', 'readable', 0.3, V3(x + 0.18, (rimY + wineY) / 2 - 0.1, 0.2), V3(1, 0, 0), V3(0, -1, 0));
      drawPlaneText(pen, cam, gl, gl.st.total * prog(t, tg + 0.12, tg + 0.32), { ch: RED, w: 3.2, dark: 0.9 * rub, passes: 2 });
      // the empty band, hatched lightly in red
      const [bl, br] = revolveSilhouette(g, C, cam.position, g.wineU, 1, 10);
      hatchRegion(pen, projAll(cam, [...bl, ...[...br].reverse()]), 12, -0.8, { ch: RED, w: 1.6, dark: 0.35 * rub * prog(t, tg + 0.1, tg + 0.35) });
    }
    // the out: the rim re-traced in red, a ring to hand off on
    const to = T.wineEnd - 0.05;
    if (t > to) {
      const q = projAll(cam, circle3(V3(0, rimY + 0.01, 0), g.r(1) * 1.04, up, 60, 1.2, 1.2 + Math.PI * 2.1));
      if (q) {
        let L = 0; for (let i = 1; i < q.length; i++) L += Math.hypot(q[i]!.x - q[i - 1]!.x, q[i]!.y - q[i - 1]!.y);
        pen.line(q, { ch: RED, w: 4, dark: 0.8, passes: 2, jit: 1.2, seed: 90, len: L * prog(t, to, to + 0.45, ease.inOutQuad) });
      }
    }
  }

  // ================================================================= the sheet

  private drawSheet(t: number) {
    const pen = this.pen, cam = this.main, T = this.T;
    pen.direct();
    const S = (x: number, y: number) => V3(x, y, 0);
    // printed template: header rule and each panel's caption box (static ink, no boil)
    const printed = { w: 1.1, dark: 0.22, passes: 1, jit: 0, taper: 1 };
    line3(pen, cam, [S(-18.5, 11.4), S(18.5, 11.4)], printed);
    for (const p of this.panels) {
      const x0 = p.cx - p.hw, x1 = p.cx + p.hw, y0 = p.cy - p.hh;
      line3(pen, cam, [S(x0, y0 - 0.5), S(x1, y0 - 0.5), S(x1, y0 - 2.3), S(x0, y0 - 2.3), S(x0, y0 - 0.5)], printed);
      const lab = planeText('ACTION / DIALOGUE', 'tech', 0.32, S(x0 + 0.2, y0 - 0.9), V3(1, 0, 0), V3(0, -1, 0));
      drawPlaneText(pen, cam, lab, 1e9, printed);
    }
    const head = planeText('YOUR JOB IS SAFE!   sc. 7  chorus 1', 'readable', 0.9, S(-18.3, 12.2), V3(1, 0, 0), V3(0, -1, 0));
    drawPlaneText(pen, cam, head, 1e9, { w: 2.4, dark: 0.55, passes: 2, jit: 1.2 });
    // the panel frames, drawn heavy with overshooting corners, and their shot numbers in red
    this.panels.forEach((p, i) => {
      const x0 = p.cx - p.hw, x1 = p.cx + p.hw, y0 = p.cy - p.hh, y1 = p.cy + p.hh;
      const o = { w: 3, dark: 0.6, passes: 2, jit: 1.4, over: 22 };
      line3(pen, cam, [S(x0, y1), S(x1, y1)], { ...o, seed: i * 4 });
      line3(pen, cam, [S(x1, y1), S(x1, y0)], { ...o, seed: i * 4 + 1 });
      line3(pen, cam, [S(x1, y0), S(x0, y0)], { ...o, seed: i * 4 + 2 });
      line3(pen, cam, [S(x0, y0), S(x0, y1)], { ...o, seed: i * 4 + 3 });
      const sl = planeText(p.label, 'tech', 0.62, S(x0 + 0.1, y1 + 0.35), V3(1, 0, 0), V3(0, -1, 0));
      drawPlaneText(pen, cam, sl, 1e9, { ch: RED, w: 2.6, dark: 0.8, passes: 2 });
    });
    // the director's camera notes, scribbled between the panels
    const note = (s: string, x: number, y: number, size: number, t0: number, rot = 0) => {
      const c = Math.cos(rot), sn = Math.sin(rot);
      const pt = planeText(s, 'readable', size, S(x, y), V3(c, sn, 0), V3(sn, -c, 0));
      drawPlaneText(pen, cam, pt, pt.st.total * prog(t, t0, t0 + 0.25), { ch: RED, w: 2.8, dark: 0.85, passes: 2 });
    };
    const arrow = (a: V2, b: V2, t0: number, seed: number) => {
      const u = prog(t, t0, t0 + 0.15, ease.outQuad);
      if (u <= 0) return;
      const e = { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) };
      line3(pen, cam, [S(a.x, a.y), S((a.x + e.x) / 2, (a.y + e.y) / 2 + 0.4), S(e.x, e.y)], { ch: RED, w: 3, dark: 0.85, passes: 2, seed, over: 6 });
      if (u >= 1) {
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const h = (da: number) => S(b.x - Math.cos(ang + da) * 0.7, b.y - Math.sin(ang + da) * 0.7);
        line3(pen, cam, [h(0.5), S(b.x, b.y), h(-0.5)], { ch: RED, w: 3, dark: 0.85, passes: 2, seed: seed + 1 });
      }
    };
    note('PUSH IN', -16.5, 0.35, 0.55, -Infinity);
    arrow({ x: -1.6, y: 7.5 }, { x: 1.4, y: 7.5 }, T.k2, 10);
    note('CRASH IN!', -1.3, 8.9, 0.55, T.k2 + 0.05, 0.05);
    note('ORBIT', 1.5, -0.1, 0.55, -Infinity);
    note('HOLD ON THE 2', -16.5, -14.2, 0.55, -Infinity);
    arrow({ x: -1.5, y: -7.4 }, { x: 1.4, y: -7.4 }, T.l2 + 0.15, 20);
    note('WHIP →', -1.4, -5.9, 0.6, T.l2 + 0.2, -0.04);
    note('CRANE UP', 12.5, -14.2, 0.55, -Infinity);
    // captions: the lyrics as dialogue lines, pencilled into each panel's box
    // (the lyric is also written inside each drawing; the captions only abbreviate)
    this.writeWords(this.caps, cam, t, { w: 0.85, dark: 0.85, noTip: true });
    const p12b = this.panels[2]!;
    const bot = planeText('bot: “There are 2 R’s”', SCRIPT, 0.75, S(p12b.cx - p12b.hw + 0.35, p12b.cy - p12b.hh - 1.85), V3(1, 0, 0), V3(0, -1, 0));
    drawPlaneText(pen, cam, bot, bot.st.total * prog(t, T.d3, T.d3 + 0.5), { w: 2.2, dark: 0.5, passes: 1 });
    // graphite smudges where the hand rests
    for (let i = 0; i < 3; i++) {
      const x = [-3, 17.5, -17][i]!, y = [-1.8, -1.5, -16][i]!;
      for (let k = 0; k < 7; k++) line3(pen, cam, [S(x + k * 0.1, y + k * 0.18), S(x + 2.6 + k * 0.1, y + 0.4 + k * 0.18)], { w: 14, dark: 0.025, passes: 1, jit: 2, seed: i * 10 + k });
    }
  }

  /** Mapper from a panel's virtual px to screen px through the sheet camera. */
  private panelMapper(p: Panel): { map: Mapper; scale: number } {
    const cam = this.main;
    const map: Mapper = (x, y) => {
      const w = V3(p.cx + (x / 1920 - 0.5) * 2 * p.hw, p.cy + (0.5 - y / 1080) * 2 * p.hh, 0);
      const q = proj(cam, w);
      return q ? [q.x, q.y] : null;
    };
    const a = map(960, 0), b = map(960, 1080);
    const scale = a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) / 1080 : 0;
    return { map, scale };
  }

  /** The animatic's own marks over a full-frame drawing: the shot number and the camera move. */
  private overlay(id: string, t: number) {
    const pen = this.pen, T = this.T;
    pen.direct();
    const txt = (s: string, x: number, y: number, size: number, t0: number, font: StrokeFontName = 'tech') => {
      const st = strokeText(s, font, size);
      const len = st.total * prog(t, t0, t0 + (size > 60 ? 0.1 : 0.2));
      const polys = st.strokes.map((pl) => pl.map((p) => ({ x: x + p.x, y: y + p.y })));
      let acc = 0;
      polys.forEach((pl, i) => { const L = st.lens[i]!; const total = L[L.length - 1] ?? 0; if (acc < len) pen.line(pl, { ch: RED, w: size > 60 ? 6 : 3, dark: 0.85, passes: 2, jit: 0.5, len: len - acc, seed: i, taper: 4 }); acc += total; });
    };
    const label = this.panels.find((p) => p.id === id)!.label;
    txt(label, 48, 86, 44, -Infinity);
    if (id === '11') txt('PUSH IN', 1580, 1010, 40, T.d0 + 0.1, 'readable');
    if (id === '12A') {
      // the hit: zoom lines rushing in from the frame edge and a big CRASH IN! scrawled across it
      const sp = 1 - prog(t, T.d2 + 0.12, T.d2 + 0.45);
      if (t >= T.d2 && sp > 0) {
        for (let i = 0; i < 72; i++) {
          const a = (i / 72) * Math.PI * 2 + noise1(i, 3) * 0.05;
          const r0 = 1150 - 60 * noise1(i, 4), r1 = lerp(r0, 380 + 220 * Math.abs(noise1(i, 5)), prog(t, T.d2, T.d2 + 0.06, ease.outExpo));
          pen.line([{ x: 960 + Math.cos(a) * r0, y: 540 + Math.sin(a) * r0 * 0.62 }, { x: 960 + Math.cos(a) * r1, y: 540 + Math.sin(a) * r1 * 0.62 }], { w: i % 3 ? 2.4 : 4.2, dark: 0.85 * sp, passes: 1, jit: 1, seed: i * 3.7, taper: 60 });
        }
      }
      if (t < T.straw) txt('CRASH IN!', 90, 1010, 150, T.d2, 'readable');
      else txt('CRASH IN!', 1520, 1010, 40, T.straw, 'readable');
      txt('ORBIT', 1600, 120, 40, T.straw + 0.1, 'readable');
    }
    if (id === '12B') txt('HOLD ON THE 2', 1400, 1010, 40, T.d3 + 0.05, 'readable');
    if (id === '13') { txt('WHIP IN', 1560, 1010, 40, T.d4, 'readable'); txt('CRANE UP', 1540, 120, 40, T.d5 + 0.1, 'readable'); }
  }

  // ================================================================= frame

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, { renderer } = this.ctx;
    const di = Math.floor(frameIdx(t) / 5);
    const pen = this.pen;
    pen.begin(di);
    const sh = this.shot(t);
    if (sh.mode === 'direct') {
      pen.direct();
      this.drawScene(sh.id, t);
      this.overlay(sh.id, t);
    } else {
      this.setMain(this.drift(sh.pose, t, 0.5));
      this.drawSheet(t);
      for (const p of this.panels) {
        const { map, scale } = this.panelMapper(p);
        if (scale < 0.05) continue;
        pen.through(map, scale);
        this.drawScene(p.id, t);
      }
    }
    clearRT(renderer, this.lineRT, [0, 0, 0], 0);
    pen.batch.render(renderer, this.lineRT);
    this.paper.u.lines!.value = this.lineRT.texture;
    this.paper.u.draw!.value = di;
    this.paper.render(renderer, out);
    const kick = this.kicks.reduce((v, k) => Math.max(v, pulse(t, k, 0.06)), 0) + 3 * pulse(t, this.T.d2, 0.07);
    return {
      bloom: 0, halation: 0, ca: 0, grain: 0.025, vignette: 0.22,
      shake: [noise1(t * 30, 1) * kick * 3, noise1(t * 30, 2) * kick * 3] as [number, number],
    };
  }
}

