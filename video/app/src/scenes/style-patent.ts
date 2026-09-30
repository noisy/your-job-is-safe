// Phase-1 style "patent": a US-patent drawing come alive in 3D. Black ink line art on white sheets lying on
// a drafting desk: the solids are drawn by their silhouettes and creases (recomputed per frame, depth-tested
// capsule lines) and shaded with contour hatching and stipple; exploded views, reference numerals with
// curved leaders, FIG. labels, a sheet header. The sung words are lettered stroke by stroke with a
// technical pen (single-stroke engineering font) as figure titles; the chatbot's text is typed onto
// speech-bubble tiles; the examiner's red pencil marks the fails.
import * as THREE from 'three';
import { Scene, type Frame } from '../engine/scene';
import { makeRT, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { strokeText, writtenLength, type StrokeText, type StrokeFontName } from '../engine/stroke';
import { F } from '../engine/type';
import type { Line } from '../engine/lyrics';
import type { StyleNote } from '../styles/registry';
import { clamp, ease, hexToLinear, keys, lerp, prog, springStep, type Key } from '../engine/util';
import {
  InkMesh, inkMaterial, MODE, V, line, poly, dashed, DASH, CENTER, arcPts, bezPts, arrow, letter, charsLen,
  flatPlane, WorldPen, fitSafe, envelope, type RGB, type TextPlane,
} from './style-patent-ink';
import { glyphSolids, bubbleTile, glassProfile, sectionFace, penGeometry, botHeadGeometry, type GlassProfile } from './style-patent-geo';

export const TITLE = 'Patent drawing';
export const NOTE: StyleNote = {
  technique:
    'Real 3D solids drawn as a US-patent sheet: per-frame silhouette + crease extraction on the meshes, inked as depth-tested GPU capsule lines over hatch/stipple-shaded paper surfaces; exploded views, a quarter-cutaway section, dimension and centre lines, reference numerals with curved leaders, all in 3D on sheets lying on a drafting desk.',
  palette: 'Warm white paper, near-black technical-pen ink, a grey desk, and one accent: the examiner’s red pencil (circles, tallies, the BRIM dimension, strikes).',
  typography:
    'Single-stroke engineering lettering (EMS Tech) for the sung words, figure labels, numerals and claims; a clean single-line sans for the chatbot’s typed text; Hershey script for the red-pencil notes; Bricolage 800 extruded for the STRAWBERRY solid.',
  lyrics:
    'Each word is lettered stroke by stroke by a 3D technical pen on the sheet, synced to its sung span (writtenLength); held notes are written early and then a dimension-style underline keeps growing under the word until the note ends.',
  cost: 'perf (42–47 s, 1 sample, incl. readback) on a quiet GPU: avg 15.5 ms, p95 18 ms per frame, of which ~8.5 ms is the engine’s post + readback (the empty smoke scene); the scene itself is ~0.6 ms CPU (silhouette extraction, lettering, title-safe fit) + ~6–7 ms GPU. Measured again while other renders shared the GPU: 16–26 ms (smoke 8–11 ms). Full 204 s song with adaptive motion blur (~12k frames × ~20 sub-frames × ~7 ms) ≈ 30–40 min.',
  risks:
    'Line art lives or dies by line weight and clutter: every new element needs a clear spot on the sheet. Silhouette extraction needs closed, welded meshes; thin parts can show z-fighting ticks. The look is monochrome, so colour-driven story beats must use the red pencil sparingly.',
};

// ------------------------------------------------------------------ palette (linear)
const PAPER = hexToLinear('#f7f5ee');
const INK = hexToLinear('#141417');
const GREYINK: RGB = hexToLinear('#8b8880');
const RED = hexToLinear('#d0301f');
const DESK = hexToLinear('#b3ad9f');

// ------------------------------------------------------------------ layout (world units, y up, sheet 2 at the origin)
const S3X = 34; // sheet 3 offset along x
const LAY = {
  sheet2: { x: 0, z: 0, w: 31, h: 22.5 },
  sheet3: { x: S3X, z: 0.4, w: 26, h: 22 },
  query: { x: -7.4, z: -7.2, w: 8.2, h: 1.35 }, // FIG. 1 user tile
  bot1: { x: -1.6, z: -7.5 },
  lead: { x: -12.6, z: -4.6 }, // "Watch it try to do / the simplest thing!"
  word: { x: 0.6, z: 0.6 }, // STRAWBERRY assembly: centre of the front face foot
  l1: { x: -7.2, z: 3.5 },
  reply: { x: 5.4, z: 8.1, w: 9.6, h: 1.35 }, // FIG. 4 bot tile
  bot2: { x: -0.9, z: 7.8 },
  claim: { x: -14.2, z: 7.4 },
  prompt: { x: 9.9, z: 3.1, w: 9.0, h: 1.35 }, // wine prompt tile (sheet 2, right)
  l2a: { x: 7.0, z: 5.1 },
  glass: { x: S3X - 3.6, z: -1.2 },
  reply2: { x: S3X - 3.6 + Math.cos(0.8) * 5.6 - Math.sin(0.8) * 0.9, z: -1.2 - Math.sin(0.8) * 5.6 - Math.cos(0.8) * 0.9, w: 9.2, h: 1.35, rot: 0.8 },
  bot3: { x: S3X - 3.6 + Math.cos(0.8) * 1.7 - Math.sin(0.8) * 2.6, z: -1.2 - Math.sin(0.8) * 1.7 - Math.cos(0.8) * 2.6 },
  l2b: { x: S3X - 10.6, z: 4.3 },
};

const TILE_T = 0.22;
const LYRIC_CAP = 0.62;

interface CamState { tx: number; ty: number; tz: number; az: number; el: number; dist: number; fov: number; roll: number }

/** A lyric line lettered on the sheet in rows by the pen. */
class Lettering {
  rows: { st: StrokeText; times: [number, number][]; pl: TextPlane; hold?: { t0: number; t1: number; x0: number; x1: number; ext: number } }[] = [];
  constructor(public line: Line, rowsWords: number[][], x: number, y: number, z: number, cap: number, rowGap: number, font: StrokeFontName = 'tech', rotY = 0) {
    rowsWords.forEach((idx, r) => {
      const words = idx.map((i) => line.words[i]!);
      const text = words.map((w) => w.w).join(' ');
      const st = strokeText(text, font, 100, 4);
      const times: [number, number][] = [];
      let hold: Lettering['rows'][number]['hold'];
      words.forEach((w, k) => {
        const dur = w.end - w.start;
        const held = dur > 0.75;
        const wd = held ? 0.5 : dur;
        const n = Array.from(w.w).length;
        for (let c = 0; c < n; c++) times.push([w.start + (c / n) * wd, w.start + ((c + 1) / n) * wd]);
        if (k < words.length - 1) times.push([w.end, w.end]);
        if (held) {
          const pre = words.slice(0, k).map((q) => q.w + ' ').join('');
          const x0 = pre ? strokeText(pre, font, 100, 4).width : 0;
          hold = { t0: w.start + wd, t1: w.end, x0, x1: st.width, ext: 1.2 + dur * 1.6 };
        }
      });
      const pl = flatPlane(x + Math.sin(rotY) * r * rowGap, y, z + Math.cos(rotY) * r * rowGap, cap, st, rotY);
      this.rows.push({ st, times, pl, hold });
    });
  }
  /** Corners of every row as lettered (with the held-note extension), world space. */
  extent(): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    for (const row of this.rows) {
      const k = row.pl.k, wd = row.st.width * k + (row.hold ? row.hold.ext + 0.3 : 0), cap = row.st.capHeight * k;
      for (const [x, y] of [[0, 0.3], [wd, 0.3], [0, -1.05], [wd, -1.05]] as const) out.push(row.pl.o.clone().addScaledVector(row.pl.r, x).addScaledVector(row.pl.d, y * cap));
    }
    return out;
  }
  get t0() { return this.line.words[0]!.start; }
  get t1() { return this.line.words[this.line.words.length - 1]!.end; }
  /** Draw; returns the pen head (world) while writing. */
  draw(b: LineBatch, t: number, w: number): THREE.Vector3 | null {
    let head: THREE.Vector3 | null = null;
    for (const row of this.rows) {
      const len = writtenLength(row.st, row.times, t);
      if (len <= 0) continue;
      const h = letter(b, row.st, len, row.pl, w, INK);
      if (len < row.st.total - 1e-3 && h) head = h;
      const hd = row.hold;
      if (hd && t > hd.t0) {
        const p = prog(t, hd.t0, hd.t1, ease.outCubic);
        const k = row.pl.k;
        const y = 22; // below the baseline, in text px
        const a = row.pl.o.clone().addScaledVector(row.pl.r, hd.x0 * k).addScaledVector(row.pl.d, y * k);
        const endX = hd.x1 * k + hd.ext * p;
        const c = row.pl.o.clone().addScaledVector(row.pl.r, lerp(hd.x0 * k, endX, Math.min(1, p * 3))).addScaledVector(row.pl.d, y * k);
        line(b, a, c, w * 0.8, INK);
        if (p > 0.05) arrow(b, c, row.pl.r, row.pl.d, 0.28, w * 0.5, INK);
        // tick at the start (a dimension line's extension mark)
        line(b, a.clone().addScaledVector(row.pl.d, -0.18), a.clone().addScaledVector(row.pl.d, 0.18), w * 0.6, INK);
        if (t < hd.t1) head = c;
      }
    }
    return head;
  }
}

/** Typed text (the chatbot's voice): characters appear at a steady rate from t0. */
class Typed {
  st: StrokeText;
  n: number;
  pre: number[];
  constructor(public text: string, public pl: TextPlane, public t0: number, public cps: number, font: StrokeFontName = 'readable') {
    this.st = strokeText(text, font, 100, 2);
    this.n = Array.from(text).length;
    this.pre = [];
    for (let i = 0; i <= this.n; i++) this.pre.push(i === 0 ? 0 : strokeText(Array.from(text).slice(0, i).join(''), font, 100, 2).width);
  }
  count(t: number) { return clamp(Math.floor((t - this.t0) * this.cps), 0, this.n); }
  get t1() { return this.t0 + this.n / this.cps; }
  draw(b: LineBatch, t: number, w: number, rgb: RGB = INK, cursor = true) {
    if (t < this.t0 - 0.6) return;
    const n = this.count(t);
    if (n > 0) letter(b, this.st, charsLen(this.st, n), this.pl, w, rgb);
    if (cursor && (n < this.n || t < this.t1 + 0.5)) {
      const on = n < this.n || Math.floor((t - this.t1) * 5) % 2 === 0;
      if (on) {
        const k = this.pl.k, x = this.pre[n]! * k + (n ? 0.1 : 0);
        const a = this.pl.o.clone().addScaledVector(this.pl.r, x).addScaledVector(this.pl.d, 12 * k);
        line(b, a, a.clone().addScaledVector(this.pl.r, 0.3), w * 1.3, rgb);
      }
    }
  }
  /** World position of char i's left edge on the baseline. */
  at(i: number, dy = 0) { return this.pl.o.clone().addScaledVector(this.pl.r, this.pre[i]! * this.pl.k).addScaledVector(this.pl.d, dy * this.pl.k); }
}

interface Glyph3 { ink: InkMesh; ch: string; x: number; w: number; tok: number; idx: number }

export default class PatentScene extends Scene {
  private rt = makeRT(W, H, { samples: 4 });
  private world = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(30, W / H, 1.2, 160);
  private inkPx = new LineBatch(120000, { screen2D: false, blend: 'normal', depthTest: true });
  private inkW = new WorldPen(120000, { screen2D: false, blend: 'normal', depthTest: true });
  private red = new WorldPen(40000, { screen2D: false, blend: 'normal', depthTest: true });
  private inks: InkMesh[] = [];
  private glyphs: Glyph3[] = [];
  private wordGroup = new THREE.Group();
  private capH = 1;
  private depth = 0.5;
  private pen!: InkMesh;
  private bot1!: InkMesh; private bot2!: InkMesh; private bot3!: InkMesh;
  private glass = new THREE.Group();
  private quarter = new THREE.Group();
  private gp!: GlassProfile;
  private wineSec: THREE.ShaderMaterial[] = [];
  private wineTop!: InkMesh;
  private T!: ReturnType<PatentScene['timing']>;
  private lead!: Lettering; private l1!: Lettering; private l2a!: Lettering; private l2b!: Lettering; private l3!: Lettering;
  private query!: Typed; private reply!: Typed; private prompt!: Typed; private reply2!: Typed;
  private sts = new Map<string, StrokeText>();
  private debugCam: string | null = null;
  private frustum = new THREE.Frustum();
  private pm = new THREE.Matrix4();

  private timing() {
    const { lyrics: ly, audio: au } = this.ctx;
    const L0 = ly.get('Watch it try', 0);
    const L1 = ly.get("It can't count the R", 0);
    const L2 = ly.get("It can't fill a glass of wine", 0);
    const L3 = ly.lines[L2.i + 1]!;
    const db = au.downbeats;
    const near = (t: number) => db.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a));
    const snap = near(L1.words[4]!.start), iS = db.indexOf(snap);
    const glass = near(L2.words[4]!.start), iG = db.indexOf(glass);
    const lead = db[iS - 1]!, two = db[iS + 1]!, out = db[iG + 1]!;
    let kicks = au.events('kick', lead + 0.2, snap - 0.03).map((k) => k[0]);
    if (kicks.length < 3) kicks = [snap - 0.36, snap - 0.2, snap - 0.07];
    kicks = kicks.slice(-3);
    const snares = au.events('snare', snap, this.ctx.end + 0.01).map((s) => s[0]);
    const snareAfter = (t: number) => snares.find((s) => s > t) ?? t + 0.35;
    return { L0, L1, L2, L3, start: this.ctx.start, end: this.ctx.end, lead, snap, two, glass, out, kicks, snares, snareAfter };
  }

  private st(text: string, font: StrokeFontName = 'tech') {
    const k = `${font}|${text}`;
    let s = this.sts.get(k);
    if (!s) { s = strokeText(text, font, 100, 3); this.sts.set(k, s); }
    return s;
  }

  private addInk(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, crease = 32) {
    const m = new InkMesh(geo, mat, crease);
    parent.add(m.mesh);
    this.inks.push(m);
    return m;
  }

  override init() {
    this.T = this.timing();
    const T = this.T;
    try { this.debugCam = new URLSearchParams(location.search).get('pcam'); } catch { /* no location */ }

    // desk and sheets
    const deskMat = inkMaterial({ mode: MODE.paper, paper: DESK, ink: INK });
    const desk = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), deskMat);
    desk.position.set(15, -0.03, 0);
    this.world.add(desk);
    const paperMat = inkMaterial({ mode: MODE.paper, paper: PAPER, ink: INK });
    for (const [s, y, rot] of [[LAY.sheet2, 0, 0.0], [LAY.sheet3, 0.004, -0.035]] as const) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h).rotateX(-Math.PI / 2), paperMat);
      m.position.set(s.x, y, s.z); m.rotation.y = rot;
      this.world.add(m);
    }

    // STRAWBERRY: one solid per glyph
    const fam = F.display(100, 800);
    const size = 1.95;
    const solids = glyphSolids('STRAWBERRY', fam, size, this.depth, 7);
    const width = solids[solids.length - 1]!.x + solids[solids.length - 1]!.w;
    const bb = new THREE.Box3();
    solids.forEach((s) => { s.geo.computeBoundingBox(); bb.union(s.geo.boundingBox!); });
    this.capH = bb.max.y;
    const letterMat = inkMaterial({ mode: MODE.extrude, density: 14, paper: PAPER, ink: INK, capStip: bb.max.y });
    this.wordGroup.position.set(LAY.word.x - width / 2, 0, LAY.word.z);
    this.world.add(this.wordGroup);
    solids.forEach((s, i) => {
      const ink = this.addInk(s.geo, letterMat, this.wordGroup, 30);
      ink.weight = 1.3;
      ink.mesh.position.x = s.x;
      this.glyphs.push({ ink, ch: s.ch, x: s.x, w: s.w, tok: i < 5 ? 0 : 1, idx: i });
    });

    // tiles
    const tileMat = inkMaterial({ mode: MODE.extrude, density: 14, paper: PAPER, ink: INK, capAxis: [0, 1, 0] });
    const tile = (o: { x: number; z: number; w: number; h: number; rot?: number }, tailLeft: boolean) => {
      const g = new THREE.Group(); g.position.set(o.x, 0, o.z); g.rotation.y = o.rot ?? 0; this.world.add(g);
      this.addInk(bubbleTile(o.w, o.h, TILE_T, tailLeft), tileMat, g, 40);
      return g;
    };
    tile(LAY.query, false);
    tile(LAY.reply, true);
    tile(LAY.prompt, false);
    tile(LAY.reply2, true);

    // chatbot heads
    const botMat = inkMaterial({ mode: MODE.stipple, density: 26, paper: PAPER, ink: INK });
    const bot = (o: { x: number; z: number }, ry: number) => {
      const g = new THREE.Group(); g.position.set(o.x, 0, o.z); g.rotation.y = ry; this.world.add(g);
      return this.addInk(botHeadGeometry(), botMat, g, 38);
    };
    this.bot1 = bot(LAY.bot1, -0.35);
    this.bot2 = bot(LAY.bot2, 0.3);
    this.bot3 = bot(LAY.bot3, 0.8);

    // the pen
    const penMat = inkMaterial({ mode: MODE.meridian, density: 34, paper: PAPER, ink: INK });
    const penG = new THREE.Group(); this.world.add(penG);
    this.pen = this.addInk(penGeometry(), penMat, penG, 35);
    this.pen.weight = 0.8;

    // the wine glass: 3/4 shell + the cut-away quarter, section faces, lip, liquid
    const gp = (this.gp = glassProfile());
    this.glass.position.set(LAY.glass.x, 0, LAY.glass.z);
    this.world.add(this.glass);
    const shellMat = inkMaterial({ mode: MODE.meridian, density: 70, dark: -0.1, paper: PAPER, ink: INK });
    const innerMat = inkMaterial({ mode: MODE.meridian, density: 44, dark: -0.36, paper: PAPER, ink: INK });
    const secMat = inkMaterial({ mode: MODE.section, density: 9, dark: 0.34, angle: 0.785, paper: PAPER, ink: INK });
    const lipMat = inkMaterial({ mode: MODE.plain, paper: PAPER, ink: INK });
    const ph0 = Math.PI / 2, phL = Math.PI * 1.5;
    const lathe = (pts: THREE.Vector2[], a: number, l: number, n: number) => new THREE.LatheGeometry(pts, n, a, l);
    const inner = [...gp.inner].reverse();
    this.addInk(lathe(gp.outer, ph0, phL, 72), shellMat, this.glass, 40);
    this.addInk(lathe(inner, ph0, phL, 72), innerMat, this.glass, 40);
    this.addInk(ringFan(gp.rim - 0.06, gp.rim, gp.rimY, ph0, phL, 72), lipMat, this.glass, 40);
    this.addInk(sectionFace(gp.section, ph0), secMat, this.glass, 20);
    this.addInk(sectionFace([...gp.section].reverse(), 0.0), secMat, this.glass, 20);
    // the quarter that is cut away and exploded out
    this.glass.add(this.quarter);
    this.addInk(lathe(gp.outer, 0, ph0, 24), shellMat, this.quarter, 40);
    this.addInk(lathe(inner, 0, ph0, 24), innerMat, this.quarter, 40);
    this.addInk(ringFan(gp.rim - 0.06, gp.rim, gp.rimY, 0, ph0, 24), lipMat, this.quarter, 40);
    this.addInk(sectionFace([...gp.section].reverse(), ph0), secMat, this.quarter, 20);
    this.addInk(sectionFace(gp.section, 0.0), secMat, this.quarter, 20);
    // liquid: section faces clipped at the fill level, top surface as a 3/4 disc
    const wineIn = [new THREE.Vector2(0, gp.bottomY), ...[...gp.inner].reverse().filter((p) => p.y > gp.bottomY + 1e-3), new THREE.Vector2(0, gp.rimY)];
    for (const [pts, phi] of [[wineIn, ph0], [[...wineIn].reverse(), 0]] as const) {
      const m = inkMaterial({ mode: MODE.level, density: 17, dark: 0.66, paper: PAPER, ink: INK, clipY: gp.bottomY });
      this.wineSec.push(m);
      const mesh = new THREE.Mesh(sectionFace(pts as THREE.Vector2[], phi), m);
      mesh.position.set(0.0, 0, 0);
      this.glass.add(mesh);
    }
    const topMat = inkMaterial({ mode: MODE.level, density: 6, dark: 0.08, paper: PAPER, ink: INK });
    this.wineTop = this.addInk(ringFan(0, 1, 0, ph0, phL, 48), topMat, this.glass, 40);

    // lettering
    const L0 = T.L0, L1 = T.L1, L2 = T.L2, L3 = T.L3;
    this.lead = new Lettering(L0, [[0, 1, 2, 3, 4], [5, 6, 7]], LAY.lead.x, 0.002, LAY.lead.z, LYRIC_CAP, 1.25);
    this.l1 = new Lettering(L1, [[0, 1, 2, 3, 4], [5, 6]], LAY.l1.x, 0.002, LAY.l1.z, LYRIC_CAP, 1.25);
    this.l2a = new Lettering(L2, [[0, 1, 2, 3], [4, 5, 6]], LAY.l2a.x, 0.002, LAY.l2a.z, LYRIC_CAP, 1.25);
    {
      // facing the glass shot's camera (az ~0.8): in front of the glass, reading along the camera's right
      const az = 0.8, fx = Math.sin(az), fz = Math.cos(az), rx = Math.cos(az), rz = -Math.sin(az);
      // the line carries on after the cut: "glass of wine," lettered in front of the glass
      const ox = LAY.glass.x + fx * 1.7 - rx * 2.6, oz = LAY.glass.z + fz * 1.7 - rz * 2.6;
      this.l2b = new Lettering(L2, [[4, 5, 6]], ox, 0.006, oz, LYRIC_CAP * 1.0, 1.3, 'tech', az);
    }
    this.l3 = new Lettering(L3, [[0, 1, 2], [3, 4, 5]], LAY.glass.x - 5.6, 0.006, LAY.glass.z - 2.2, 0.46, 0.85);

    const onTile = (o: { x: number; z: number; w: number; h: number; rot?: number }, text: string, t0: number, cps: number, cap = 0.36) => {
      const st = strokeText(text, 'readable', 100, 2);
      cap = Math.min(cap, ((o.w - 1.0) * st.capHeight) / st.width); // the text fits its tile
      const ro = o.rot ?? 0, dx = -o.w / 2 + 0.5, dz = cap * 0.5;
      const pl = flatPlane(o.x + dx * Math.cos(ro) + dz * Math.sin(ro), TILE_T + 0.003, o.z - dx * Math.sin(ro) + dz * Math.cos(ro), cap, st, ro);
      return new Typed(text, pl, t0, cps);
    };
    this.query = onTile(LAY.query, 'how many r\'s in "strawberry"?', T.start + 0.12, 23);
    this.reply = onTile(LAY.reply, 'There are 2 R\'s in "strawberry".', T.two + 0.02, 55);
    this.prompt = onTile(LAY.prompt, 'a wine glass filled to the brim', T.L2.words[0]!.start - 0.25, 44);
    this.reply2 = onTile(LAY.reply2, 'Here\'s a wine glass filled to the brim!', T.glass + 0.18, 60);
  }

  // ------------------------------------------------------------------ camera

  private shotCam(t: number): CamState {
    const T = this.T;
    const c: CamState = { tx: 0, ty: 0, tz: 0, az: 0, el: 0.8, dist: 12, fov: 30, roll: 0 };
    const k = (ks: Key[]) => keys(t, ks);
    const set = (o: Partial<CamState>) => Object.assign(c, o);
    if (this.debugCam === 'overview') return { tx: 14, ty: 0, tz: 1, az: 0, el: 1.25, dist: 70, fov: 40, roll: 0 };
    if (t < T.lead) {
      // FIG. 1: a big orbit across the tile on the bar's beats while the question is typed
      const a = T.start, b = T.lead, q = LAY.query, m = (a + b) / 2;
      set({
        tx: k([[a, q.x - 1.6], [m, q.x - 0.2, ease.inOutCubic], [b, q.x + 0.8]]), ty: 0, tz: k([[a, q.z + 1.6], [b, q.z + 2.4]]),
        az: k([[a, -0.8], [m, 0.3, ease.inOutCubic], [b, 0.5, ease.outCubic]]), el: k([[a, 0.5], [m, 0.82, ease.inOutCubic], [b, 0.9]]),
        dist: k([[a, 9.5], [m, 11.0], [b, 12.0]]), roll: k([[a, 0.06], [m, -0.03, ease.inOutCubic], [b, -0.04]]),
      });
    } else if (t < T.snap) {
      // wind-up: wide, and every kick of the fill jerks the camera back
      const [k1, k2, k3] = T.kicks as [number, number, number];
      const back = [k1, k2, k3].reduce((s, kt, i) => s + (t > kt ? springStep(t - kt, 5, 0.5) * [1.6, 2.0, 2.6][i]! : 0), 0);
      set({
        tx: k([[T.lead, -4.2], [k1, -3.4], [T.snap, -1.2, ease.inCubic]]), ty: 0.3, tz: k([[T.lead, -1.6], [T.snap, 0.4]]),
        az: k([[T.lead, 0.4], [k1, 0.3], [T.snap, 0.12, ease.inCubic]]), el: k([[T.lead, 0.86], [T.snap, 0.98]]),
        dist: k([[T.lead, 14.5], [k1, 14.0]]) + back, roll: -0.02 * back,
      });
    } else if (t < T.two) {
      // FIG. 3: crash zoom into the exploded STRAWBERRY, then orbit across it
      const a = T.snap, b = T.two;
      const cz = prog(t, a, a + 0.42, ease.outExpo);
      set({
        tx: k([[a, 0.0], [b, 1.2]]), ty: 1.0, tz: k([[a, 2.1], [b, 2.3]]),
        az: k([[a, -0.46], [a + 0.5, -0.34, ease.outCubic], [b, 0.26, ease.inOutCubic]]),
        el: k([[a, 0.62], [b, 0.5]]), dist: lerp(24, 15.6, cz) - prog(t, a + 0.4, b) * 1.4, fov: lerp(34, 30, cz),
        roll: k([[a, 0.06], [a + 0.5, 0.0, ease.outCubic], [b, -0.03]]),
      });
    } else if (t < T.glass) {
      // FIG. 4: the confident "2"; then track right to the next prompt, easing into the downbeat
      const a = T.two, m = T.L2.words[0]!.start - 0.25, b = T.glass, r = LAY.reply, p = LAY.prompt;
      set({
        tx: k([[a, r.x - 0.3], [m, r.x + 0.6], [b, p.x - 1.2, ease.inOutCubic]]), ty: 0.2, tz: k([[a, r.z - 0.9], [m, r.z - 1.0], [b, p.z + 1.5, ease.inOutCubic]]),
        az: k([[a, -0.24], [m, -0.06], [b, 0.26, ease.inOutCubic]]), el: k([[a, 0.95], [m, 0.9], [b, 0.84]]),
        dist: k([[a, 10.8], [a + 0.35, 12.8, ease.outCubic], [m, 13.2], [b, 11.8]]), roll: k([[a, -0.05], [b, 0.02]]),
      });
    } else if (t < T.out) {
      // FIG. 5: whip onto the glass; the cutaway explodes on the downbeat; orbit into the cut
      const a = T.glass, b = T.out;
      const wh = prog(t, a, a + 0.32, ease.outExpo);
      const o = prog(t, a + 0.32, b, ease.inOutQuad);
      set({
        tx: LAY.glass.x + lerp(0.9, 0.5, o), ty: 2.3, tz: LAY.glass.z + lerp(0.6, 0.2, o),
        az: lerp(1.45, 1.0, wh) - o * 0.3, el: lerp(0.28, 0.46, wh) + o * 0.05,
        dist: lerp(8, 11.8, wh) - o * 1.6, roll: lerp(-0.14, 0, wh),
      });
    } else {
      // out: high over the cut (the gap between the wine and the BRIM mark), then crane up to a top-down circle
      const a = T.out, b = T.end, up0 = a + 0.62, up1 = b - 0.22;
      const u = prog(t, up0, up1, ease.inOutCubic);
      const gx = LAY.glass.x, gz = LAY.glass.z, gy = this.gp.rimY;
      set({
        tx: lerp(k([[a, gx + 1.2], [up0, gx + 1.0]]), gx, u), ty: lerp(k([[a, 3.0], [up0, 3.2]]), gy, u), tz: lerp(k([[a, gz + 1.6], [up0, gz + 1.3]]), gz, u),
        az: lerp(k([[a, 0.98], [up0, 0.78]]), 0.0, u), el: lerp(k([[a, 0.62], [up0, 0.72]]), 1.5, u),
        dist: lerp(k([[a, 7.8], [up0, 8.4]]), 7.2, u), roll: 0, fov: 30,
      });
    }
    return c;
  }

  private applyCam(c: CamState) {
    const cam = this.cam;
    const ce = Math.cos(c.el), se = Math.sin(c.el);
    cam.position.set(c.tx + c.dist * ce * Math.sin(c.az), c.ty + c.dist * se, c.tz + c.dist * ce * Math.cos(c.az));
    cam.up.set(-Math.sin(c.az) * se, ce, -Math.cos(c.az) * se);
    cam.lookAt(c.tx, c.ty, c.tz);
    cam.rotateZ(c.roll);
    cam.fov = c.fov;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  // ------------------------------------------------------------------ animation

  private animateWord(t: number) {
    const T = this.T;
    const [k1, k2, k3] = T.kicks as [number, number, number];
    // wind-up squash on each kick, then the explode spring on the "R's" downbeat
    const sq = [k1, k2, k3].reduce((s, kt, i) => s + (t > kt ? springStep(t - kt, 6, 0.45) * [0.05, 0.06, 0.08][i]! : 0), 0);
    const ex = t > T.snap ? springStep(t - T.snap, 2.6, 0.42) : 0;
    const tokGap = 1.25 * ex, letGap = 0.2 * ex;
    this.wordGroup.scale.set(1 - sq * (t < T.snap ? 1 : 0) * 1.0, 1 + sq * 0.6 * (t < T.snap ? 1 : 0), 1);
    const rTimes = this.rTimes();
    for (const g of this.glyphs) {
      const inTok = g.tok === 0 ? g.idx - 2 : g.idx - 7;
      let x = g.x + (g.tok === 0 ? -tokGap : tokGap) + inTok * letGap;
      let y = 0, z = 0;
      if (t < T.snap) { y = Math.max(0, Math.sin((t - T.lead) * 30 + g.idx)) * sq * 0.6; }
      const ri = rTimes.findIndex((r) => r.idx === g.idx);
      if (ri >= 0) {
        const p = t > rTimes[ri]!.t ? springStep(t - rTimes[ri]!.t, 3.2, 0.4) : 0;
        z += p * 0.75; y += p * 0.12;
      }
      g.ink.mesh.position.set(x, y, z);
      g.ink.mesh.rotation.y = t > T.snap ? (1 - ex) * 0.4 * (g.tok ? 1 : -1) : 0;
    }
  }

  /** When each R is circled by the red pencil (and pops forward). */
  private rTimes() {
    const T = this.T, w = T.L1.words[4]!;
    const s1 = T.snareAfter(w.start);
    return [{ idx: 2, t: w.start + 0.0 }, { idx: 7, t: w.start + 0.14 }, { idx: 8, t: Math.max(w.start + 0.28, s1 - 0.02) }];
  }

  private animateGlass(t: number) {
    const T = this.T, gp = this.gp;
    const ex = t > T.glass ? springStep(t - T.glass, 2.4, 0.45) : 0;
        // the cut-away quarter is flung out of the drawing on the downbeat (towards the whip's camera)
    const fly = t > T.glass ? prog(t, T.glass + 0.04, T.glass + 0.46, ease.inQuad) : 0;
    this.quarter.position.set(0.5 * ex + fly * 11, 0.4 * ex + fly * 9, 0.5 * ex - fly * 14);
    this.quarter.rotation.set(fly * 1.2, -fly * 0.8, -fly * 0.9);
    this.quarter.visible = fly < 1;
    // the pour: fills from the bottom, stops at half, sloshes
    const half = lerp(gp.bottomY, gp.rimY, 0.46);
    const pour = prog(t, T.glass + 0.05, T.glass + 0.55, ease.outCubic);
    const slosh = t > T.glass + 0.55 ? Math.exp(-(t - T.glass - 0.55) * 2.2) * Math.sin((t - T.glass) * 13) * 0.05 : 0;
    const snareKick = this.T.snares.reduce((s, sn) => s + (t > sn ? Math.exp(-(t - sn) * 7) * Math.sin((t - sn) * 30) * 0.02 : 0), 0);
    const yF = lerp(gp.bottomY + 0.01, half, pour) + slosh + snareKick;
    for (const m of this.wineSec) m.uniforms.uClipY!.value = t > T.glass ? yF : -1;
    const r = gp.rAt(yF);
    const top = this.wineTop.mesh;
    top.visible = t > T.glass + 0.03;
    top.position.set(0, yF, 0);
    top.scale.set(Math.max(0.01, r - 0.005), 1, Math.max(0.01, r - 0.005));
    top.rotation.set(slosh * 0.8, 0, -slosh * 0.6);
    return { yF, r, half };
  }

  // ------------------------------------------------------------------ render

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const { renderer, comp } = this.ctx;
    const t = f.t, T = this.T;
    this.animateWord(t);
    const wine = this.animateGlass(t);
    this.world.updateMatrixWorld(true);
    this.applyCam(this.shotCam(t));
    this.keepLyricSafe(t);
    const camPos = this.cam.position;
    this.inkW.prepare(this.cam, H); this.red.prepare(this.cam, H);

    // the pen follows whichever lyric is being lettered
    this.inkW.clear(); this.inkPx.clear(); this.red.clear();
    const LW = 0.052;
    let head: THREE.Vector3 | null = null;
    const letterings: [Lettering, number, number][] = [
      [this.lead, -1, Infinity],
      [this.l1, -1, Infinity],
      [this.l2a, -1, T.glass],
      [this.l2b, T.glass, Infinity],
      [this.l3, -1, Infinity],
    ];
    for (const [L, a, b] of letterings) {
      if (t < a || t >= b) continue;
      const h = L.draw(this.inkW, t, LW);
      if (h) head = h;
    }
    this.placePen(t, head);

    this.world.updateMatrixWorld(true);
    this.frustum.setFromProjectionMatrix(this.pm.multiplyMatrices(this.cam.projectionMatrix, this.cam.matrixWorldInverse));
    for (const m of this.inks) m.emit(this.inkPx, camPos, 3.0, 1.6, INK, 1, this.frustum);

    this.drawSheets(t);
    this.drawFig1(t);
    this.drawFig3(t);
    this.drawFig4(t);
    this.drawGlass(t, wine);

    // render: surfaces, then ink, then red pencil (all depth-tested)
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(new THREE.Color().setRGB(DESK[0], DESK[1], DESK[2], THREE.LinearSRGBColorSpace), 1);
    renderer.clear(true, true, true);
    renderer.render(this.world, this.cam);
    this.inkPx.render(renderer, this.rt, this.cam);
    this.inkW.render(renderer, this.rt, this.cam);
    this.red.render(renderer, this.rt, this.cam);
    comp.draw(renderer, this.rt.texture, out, { mode: 'replace' });

    const snare = f.a.snare;
    return {
      bloom: 0.0, halation: 0.0, ca: 0.25, grain: 0.035, vignette: 0.22, exposure: 1.0,
      shake: [Math.sin(t * 91) * snare * 1.5, Math.cos(t * 77) * snare * 1.5] as [number, number],
      zoom: 1 + 0.012 * f.a.kick,
    };
  }

  /** The line being sung stays inside title-safe, whatever the designed move does. */
  private keepLyricSafe(t: number) {
    const T = this.T;
    const lines: [Lettering, number, number][] = [
      [this.lead, this.lead.t0, this.lead.t1],
      [this.l1, this.l1.t0, this.l1.t1],
      [this.l2a, this.l2a.t0, T.glass - 0.001],
      [this.l2b, T.glass, this.l2b.t1],
      [this.l3, this.l3.t0, this.l3.t1 + 2],
    ];
    let best: [Lettering, number] | null = null;
    for (const [L, a, b] of lines) {
      const w = a >= T.glass - 0.01 && L === this.l2b ? (t >= T.glass ? prog(t, T.glass + 0.05, T.glass + 0.4, ease.inOutCubic) * envelope(t, a, b, 0.001, 0.3) : 0) : L === this.l2a ? (t < T.glass ? envelope(t, a, b, 0.3, 0.001) : 0) : envelope(t, a, b);
      if (w > (best?.[1] ?? 0)) best = [L, w];
    }
    if (!best) return;
    const pts = best[0].extent();
    // the hero stays whole too: the exploded word while it is counted, the glass while it is revealed
    const sub = t >= T.snap && t < T.two ? this.wordGroup : t >= T.glass && t < T.out ? this.glass : null;
    const tileBox = (o: { x: number; z: number; w: number; h: number }) => {
      for (const x of [o.x - o.w / 2, o.x + o.w / 2]) for (const z of [o.z - o.h / 2, o.z + o.h / 2 + 0.5]) pts.push(new THREE.Vector3(x, TILE_T, z));
    };
    if (t >= T.two && t < T.L2.words[0]!.start - 0.25) tileBox(LAY.reply);
    else if (t >= T.two && t < T.glass) tileBox(LAY.prompt);
    if (sub) {
      const bx = new THREE.Box3().setFromObject(sub === this.glass ? this.glass.children[0]! : sub);
      for (const x of [bx.min.x, bx.max.x]) for (const y of [bx.min.y, bx.max.y]) for (const z of [bx.min.z, bx.max.z]) pts.push(new THREE.Vector3(x, y, z));
    }
    fitSafe(this.cam, pts, best[1]);
  }

  private placePen(t: number, head: THREE.Vector3 | null) {
    const g = this.pen.mesh.parent!;
    g.visible = !!head;
    if (!head) return;
    g.position.copy(head);
    g.position.y += 0.01;
    g.rotation.set(-0.38, 0.0, -0.52 + Math.sin(t * 9) * 0.03);
  }

  // ------------------------------------------------------------------ figure furniture

  /** Text lettered flat on the sheet at (x, z), `n` chars (default: all). */
  private flat(text: string, x: number, z: number, cap: number, w: number, font: StrokeFontName = 'tech', upto = 1, b: LineBatch = this.inkW, rgb: RGB = INK, y = 0.002, rotY = 0) {
    const st = this.st(text, font);
    return letter(b, st, st.total * upto + 1e-3, flatPlane(x, y, z, cap, st, rotY), w, rgb);
  }

  private flatWidth(text: string, cap: number, font: StrokeFontName = 'tech') { const st = this.st(text, font); return st.width * (cap / st.capHeight); }

  /** A reference numeral lettered on the sheet with a curved leader up to a 3D point. */
  private numeral(n: string, x: number, z: number, target: THREE.Vector3, p: number, bend = 1, y = 0.002) {
    if (p <= 0) return;
    const cap = 0.36;
    const w = this.flatWidth(n, cap);
    this.flat(n, x - w / 2, z + cap / 2, cap, 0.036, 'tech', clamp(p * 3), this.inkW, INK, y);
    const a = V(x, y + 0.001, z - cap * 0.75);
    const mid = a.clone().lerp(target, 0.5);
    const c1 = V(a.x, a.y + 0.2, a.z - 0.9 * bend), c2 = V(mid.x + 0.4 * bend, mid.y + 0.5, mid.z);
    poly(this.inkW, bezPts(a, c1, c2, target, 22), 0.022, INK, prog(p, 0.15, 1));
  }

  private drawSheets(t: number) {
    const b = this.inkW;
    for (const [s, y, rot, sheetNo] of [[LAY.sheet2, 0.002, 0, 2], [LAY.sheet3, 0.006, -0.035, 3]] as const) {
      const cr = Math.cos(rot), sr = Math.sin(rot);
      const P = (u: number, v: number) => V(s.x + u * cr + v * sr, y, s.z - u * sr + v * cr);
      const m = 0.9, hw = s.w / 2 - m, hh = s.h / 2 - m;
      poly(b, [P(-hw, -hh), P(hw, -hh), P(hw, hh), P(-hw, hh), P(-hw, -hh)], 0.02, INK);
      // header along the top margin
      const cap = 0.3;
      const items = ['U.S. Patent', 'Sep. 30, 2026', `Sheet ${sheetNo} of 5`, 'US 12,345,678 B2'];
      const xs = [-hw + 0.2, -hw * 0.38, hw * 0.18, hw - this.flatWidth(items[3]!, cap) - 0.2];
      items.forEach((txt, i) => {
        const o = P(xs[i]!, -hh - 0.25);
        this.flat(txt, o.x, o.z, cap, 0.028, 'tech', 1, b, INK, y, rot);
      });
    }
    void t;
  }

  private drawFig1(t: number) {
    const T = this.T, q = LAY.query;
    this.query.draw(this.inkW, t, 0.034);
    // FIG. 1 label and numerals
    this.flat('FIG. 1', q.x - q.w / 2, q.z - 1.35, 0.5, 0.062, 'tech');
    this.numeral('32', q.x + q.w / 2 + 0.9, q.z - 1.5, V(q.x + q.w / 2 - 0.5, TILE_T, q.z - q.h / 2 + 0.15), 1, 0.6);
    const b1 = LAY.bot1;
    this.numeral('30', b1.x + 1.6, b1.z + 1.5, V(b1.x + 0.35, 0.55, b1.z + 0.3), 1, 0.8);
    this.botFace(this.bot1, t, false);
    // the bot "thinks" while the question is typed and the fill winds up
    const dots = t > this.query.t1 - 0.2;
    if (dots && t < T.snap + 0.1) {
      for (let i = 0; i < 3; i++) {
        const ph = (t * 4 - i * 0.33) % 1;
        const r = 0.07 + 0.05 * Math.max(0, Math.sin(ph * Math.PI));
        const c = V(b1.x + 0.9 + i * 0.32, 1.35 + i * 0.12, b1.z);
        poly(this.inkW, arcPts(c, V(1, 0, 0), V(0, 1, 0), r, 0, Math.PI * 2, 16), 0.022, INK);
      }
    }
  }

  /** Eyes and mouth on a bot head's front face (group local: face at z = 0.4). */
  private botFace(bot: InkMesh, t: number, smug: boolean) {
    const g = bot.mesh.parent!;
    if (!g.visible) return;
    const M = g.matrixWorld;
    const P = (x: number, y: number, z = 0.405) => V(x, y, z).applyMatrix4(M);
    const blink = (Math.floor(t * 1.3) % 5 === 3) && ((t * 1.3) % 1 < 0.12);
    for (const ex of [-0.22, 0.22]) {
      if (blink) line(this.inkW, P(ex - 0.08, 0.5), P(ex + 0.08, 0.5), 0.03, INK);
      else {
        const pts = arcPts(P(ex, 0.5), V(1, 0, 0).transformDirection(M), V(0, 1, 0).transformDirection(M), 0.075, 0, Math.PI * 2, 16);
        poly(this.inkW, pts, 0.03, INK);
        line(this.inkW, P(ex, 0.5), P(ex, 0.5), 0.09, INK);
      }
    }
    const mouth = arcPts(P(0, 0.34), V(1, 0, 0).transformDirection(M), V(0, 1, 0).transformDirection(M), 0.2, Math.PI * 1.15, Math.PI * (smug ? 1.95 : 1.85), 14);
    poly(this.inkW, mouth, 0.03, INK);
  }

  private drawFig3(t: number) {
    const T = this.T, b = this.inkW;
    const wg = this.wordGroup;
    const M = wg.matrixWorld;
    const W3 = (x: number, y: number, z: number) => V(x, y, z).applyMatrix4(M);
    const front = 0.004, mid = -this.depth / 2, cap = this.capH;
    const gl = this.glyphs;
    const ex = t > T.snap ? springStep(t - T.snap, 2.6, 0.42) : 0;
    const x0 = gl[0]!.ink.mesh.position.x, x1 = gl[9]!.ink.mesh.position.x + gl[9]!.w;
    // label
    const lab = t < T.snap ? 'FIG. 2' : 'FIG. 3';
    const fl = W3(x0, 0, 0);
    this.flat(lab, fl.x - 3.4, fl.z + 0.3, 0.5, 0.062, 'tech');
    if (ex > 0.02) {
      // centre line through the assembly and dashed assembly lines across the token gap
      dashed(b, W3(x0 - 1.4, cap * 0.5, mid), W3(x1 + 1.4, cap * 0.5, mid), CENTER, 0.018, INK, t * 0.0, ex);
      const w4 = gl[4]!.ink.mesh.position.x + gl[4]!.w, b5 = gl[5]!.ink.mesh.position.x;
      for (const yy of [0.12, cap - 0.12]) dashed(b, W3(w4 + 0.05, yy, front), W3(b5 - 0.05, yy, front), DASH, 0.016, INK, 0, 1);
      // token brackets with numerals and token labels
      const tok = (i0: number, i1: number, num: string, word: string, pp: number) => {
        const a = gl[i0]!.ink.mesh.position.x + 0.05, c = gl[i1]!.ink.mesh.position.x + gl[i1]!.w - 0.05, m = (a + c) / 2;
        const z0 = 0.35, dz = 0.3;
        const pts = [W3(a, 0.003, z0), ...bezPts(W3(a, 0.003, z0), W3(a, 0.003, z0 + dz), W3(m - 0.3, 0.003, z0 + dz * 0.6), W3(m, 0.003, z0 + dz * 1.8), 8),
          ...bezPts(W3(m, 0.003, z0 + dz * 1.8), W3(m + 0.3, 0.003, z0 + dz * 0.6), W3(c, 0.003, z0 + dz), W3(c, 0.003, z0), 8)];
        poly(b, pts, 0.024, INK, pp);
        const lp = W3(m, 0, z0 + dz * 1.8 + 0.62);
        const s = `${num}  “${word}”`;
        const wv = this.flatWidth(s, 0.36);
        this.flat(s, lp.x - wv / 2, lp.z, 0.36, 0.034, 'tech', clamp(pp * 1.4));
      };
      tok(0, 4, '12', 'straw', prog(t, T.snap + 0.05, T.snap + 0.4));
      tok(5, 9, '14', 'berry', prog(t, T.snap + 0.15, T.snap + 0.5));
      // numeral 10 for the whole assembly
      this.numeral('10', W3(x1 + 1.3, 0, 0).x, wg.position.z - 1.6, W3(x1 - 0.2, cap * 0.85, -this.depth), prog(t, T.snap + 0.3, T.snap + 0.7), -0.7);
    }
    // red pencil: circle each R, tally it, and flag the third
    const rs = this.rTimes();
    rs.forEach((r, i) => {
      const g = gl[r.idx]!.ink.mesh;
      const p = prog(t, r.t, r.t + 0.2, ease.outQuad);
      if (p <= 0) return;
      const c = V(g.position.x + gl[r.idx]!.w * 0.5, g.position.y + cap * 0.5, g.position.z + 0.06).applyMatrix4(M);
      const ux = V(1, 0, 0).transformDirection(M), uy = V(0, 1, 0).transformDirection(M);
      const turns = i === 2 ? 2.1 : 1.12;
      const pts = arcPts(c, ux, uy, cap * 0.78, 2.2, 2.2 + Math.PI * 2 * turns, 70, { amp: 0.06, seed: i + 1 });
      poly(this.red, pts, 0.05, RED, p);
      // tally numeral above
      const tp = prog(t, r.t + 0.12, r.t + 0.3);
      if (tp > 0) {
        const st = this.st(String(i + 1), 'script');
        const o = c.clone().addScaledVector(uy, cap * 0.95).addScaledVector(ux, -0.12);
        letter(this.red, st, st.total * tp + 1e-3, { o, r: ux, d: uy.clone().negate(), k: 0.5 / st.capHeight }, 0.05, RED, 0.6, i);
      }
    });
    // examiner's note at the third R once all three are counted
    const r3 = rs[2]!;
    const np = prog(t, r3.t + 0.3, r3.t + 0.85);
    if (np > 0) {
      const g = gl[9]!.ink.mesh;
      const ux = V(1, 0, 0).transformDirection(M), uy = V(0, 1, 0).transformDirection(M);
      const o = V(g.position.x + gl[9]!.w + 0.35, cap * 1.25, g.position.z + 0.3).applyMatrix4(M);
      const st = this.st('3 R’s!', 'script');
      letter(this.red, st, st.total * np + 1e-3, { o, r: ux, d: uy.clone().negate(), k: 0.62 / st.capHeight }, 0.06, RED, 0.8, 7);
      // underline
      poly(this.red, [o.clone().addScaledVector(uy, -0.2), o.clone().addScaledVector(uy, -0.24).addScaledVector(ux, 2.3)], 0.05, RED, prog(np, 0.6, 1));
    }
  }

  private drawFig4(t: number) {
    const T = this.T, r = LAY.reply;
    this.reply.draw(this.inkW, t, 0.034);
    this.flat('FIG. 4', r.x - r.w / 2, r.z - 1.35, 0.5, 0.062, 'tech');
    this.botFace(this.bot2, t, true);
    this.numeral('36', r.x + r.w / 2 - 0.6, r.z + 2.0, V(r.x + r.w / 2 - 1.2, TILE_T, r.z + r.h / 2 - 0.1), 1, -0.5);
    this.numeral('30', LAY.bot2.x - 1.6, LAY.bot2.z + 1.7, V(LAY.bot2.x - 0.4, 0.5, LAY.bot2.z + 0.3), 1, 0.6);
    // what the bot sees: two tokens
    const tz = r.z + 1.55, tx = r.x - r.w / 2 + 0.5;
    const seen = prog(t, T.two + 0.55, T.two + 0.8);
    if (seen > 0) {
      this.flat('tokens seen:', tx, tz, 0.26, 0.024, 'readable', seen);
      let x = tx + this.flatWidth('tokens seen:', 0.26, 'readable') + 0.35;
      for (const [w, n] of [['straw', '12'], ['berry', '14']] as const) {
        const wd = this.flatWidth(w, 0.3, 'readable') + 0.4;
        const box = [V(x, 0.003, tz - 0.5), V(x + wd, 0.003, tz - 0.5), V(x + wd, 0.003, tz + 0.2), V(x, 0.003, tz + 0.2), V(x, 0.003, tz - 0.5)];
        poly(this.inkW, box, 0.024, INK, seen);
        this.flat(w, x + 0.2, tz, 0.3, 0.028, 'readable', seen);
        this.flat(n, x + wd / 2 - 0.15, tz + 0.65, 0.22, 0.022, 'tech', seen);
        x += wd + 0.12;
      }
    }
    // red pencil: circle the "2", write the 3
    const s2 = T.snareAfter(T.two + 0.25);
    const two = this.reply.at(10, -40);
    const cp = prog(t, s2 - 0.06, s2 + 0.16, ease.outQuad);
    if (cp > 0 && this.reply.count(t) > 10) {
      const c = two.clone().add(V(0.14, 0.004, 0));
      poly(this.red, arcPts(c, V(1, 0, 0), V(0, 0, 1), 0.36, 2.4, 2.4 + Math.PI * 2.25, 60, { amp: 0.07, seed: 3 }), 0.045, RED, cp);
      const wp = prog(t, s2 + 0.12, s2 + 0.4);
      if (wp > 0) {
        const st = this.st('3', 'script');
        letter(this.red, st, st.total * wp + 1e-3, { o: c.clone().add(V(-0.2, 0.004, -0.62)), r: V(1, 0, 0), d: V(0, 0, 1), k: 0.62 / st.capHeight }, 0.055, RED, 0.5, 2);
      }
    }
    // the claim (pre-printed), its "two" struck and corrected
    const cl = LAY.claim;
    const claim = ['1. An apparatus for counting the R’s in “strawberry”, comprising:', 'a first token (12) “straw”; a second token (14) “berry”;', 'wherein the R’s total two.'];
    claim.forEach((s, i) => this.flat(s, cl.x + (i ? 0.6 : 0), cl.z + i * 0.55, 0.24, 0.022, 'tech'));
    const kp = prog(t, s2 + 0.35, s2 + 0.55);
    if (kp > 0) {
      const pre = this.flatWidth('wherein the R’s total ', 0.24), wd = this.flatWidth('two', 0.24);
      const y0 = V(cl.x + 0.6 + pre - 0.05, 0.004, cl.z + 1.1 - 0.12);
      poly(this.red, [y0, y0.clone().add(V(wd + 0.12, 0, -0.04))], 0.035, RED, kp);
      const st = this.st('three', 'hscript');
      letter(this.red, st, st.total * prog(t, s2 + 0.5, s2 + 0.8) + 1e-3, { o: y0.clone().add(V(0.1, 0, -0.34)), r: V(1, 0, 0), d: V(0, 0, 1), k: 0.3 / st.capHeight }, 0.035, RED, 0.5, 5);
    }
    // FIG. 5 prompt tile on the way out
    this.prompt.draw(this.inkW, t, 0.034);
    const p = LAY.prompt;
    this.numeral('38', p.x + p.w / 2 - 0.8, p.z - 1.6, V(p.x + p.w / 2 - 1.3, TILE_T, p.z - p.h / 2 + 0.1), 1, 0.5);
  }

  private drawGlass(t: number, wine: { yF: number; r: number; half: number }) {
    const T = this.T, gp = this.gp, b = this.inkW;
    const G = this.glass.matrixWorld;
    const L = (x: number, y: number, z: number) => V(x, y, z).applyMatrix4(G);
    const on = t > T.glass - 0.02;
    // wine section outlines on both cut planes (clipped at the fill level)
    if (on && wine.yF > gp.bottomY + 0.02) {
      for (const phi of [Math.PI / 2, 0]) {
        const s = Math.sin(phi), c = Math.cos(phi);
        const pts = [L(0, wine.yF, 0), L(0, gp.bottomY, 0)];
        for (const q of [...gp.inner].reverse()) if (q.y < wine.yF && q.y > gp.bottomY) pts.push(L(q.x * s, q.y, q.x * c));
        pts.push(L(wine.r * s, wine.yF, wine.r * c));
        poly(this.inkPx, pts, 1.6, INK);
      }
    }
    // axis centre line
    dashed(b, L(0, -0.2, 0), L(0, gp.rimY + 1.0, 0), CENTER, 0.018, INK);
    this.flat('FIG. 5', LAY.glass.x - 5.4, LAY.glass.z + 0.4, 0.5, 0.062, 'tech', 1, b, INK, 0.006);
    // numerals: glass 40, brim 42, fill level 44
    const np = prog(t, T.glass + 0.2, T.glass + 0.6);
    this.numeral('40', LAY.glass.x - 2.5, LAY.glass.z + 1.7, L(-0.9, 2.9, 0.1), np, 0.8, 0.006);
    // brim: a dashed ring at the lip, numeral 42
    const bp = prog(t, T.snareAfter(T.glass + 0.1) - 0.05, T.snareAfter(T.glass + 0.1) + 0.3);
    if (bp > 0) {
      const ring = arcPts(L(0, gp.rimY + 0.02, 0), V(1, 0, 0), V(0, 0, 1), gp.rim + 0.08, 0, Math.PI * 2 * bp, 80);
      for (let i = 1; i < ring.length; i += 2) line(b, ring[i - 1]!, ring[i]!, 0.018, INK);
      this.numeral('42', LAY.glass.x + 2.9, LAY.glass.z - 2.3, L(gp.rim * 0.75, gp.rimY + 0.02, -gp.rim * 0.66), bp, -0.9, 0.006);
      this.numeral('44', LAY.glass.x + 3.1, LAY.glass.z + 1.3, L(wine.r * 0.9, wine.yF, 0.05), bp, -0.6, 0.006);
    }
    // bot 3 + the confident reply
    this.botFace(this.bot3, t, true);
    this.reply2.draw(this.inkW, t, 0.034);
    const r2 = LAY.reply2, ro = r2.rot, fx = -r2.w / 2 + 1.4, fz = -1.35;
    this.flat('FIG. 6', r2.x + fx * Math.cos(ro) + fz * Math.sin(ro), r2.z - fx * Math.sin(ro) + fz * Math.cos(ro), 0.5, 0.062, 'tech', 1, b, INK, 0.006, ro);

    // red pencil: the BRIM dimension (lip to the actual fill), and the verdict
    const s1 = T.snareAfter(T.glass + 0.5);
    const dp = prog(t, s1 - 0.05, s1 + 0.35, ease.outQuad);
    if (dp > 0) {
      const ux = V(0.7071, 0, -0.7071).transformDirection(G); // to the right of the view into the cut
      const dx = 1.95;
      const top = L(0, gp.rimY, 0).addScaledVector(ux, dx), bot = L(0, wine.yF, 0).addScaledVector(ux, dx);
      // extension lines from the lip and from the wine level
      poly(this.red, [L(0, gp.rimY, 0).addScaledVector(ux, gp.rim + 0.12), top.clone().addScaledVector(ux, 0.3)], 0.03, RED, dp);
      poly(this.red, [L(0, wine.yF, 0).addScaledVector(ux, wine.r + 0.2), bot.clone().addScaledVector(ux, 0.3)], 0.03, RED, dp);
      const dm = prog(dp, 0.3, 1);
      if (dm > 0) {
        const mid = top.clone().lerp(bot, 0.5);
        poly(this.red, [mid, top.clone().lerp(mid, 1 - dm)], 0.035, RED);
        poly(this.red, [mid, bot.clone().lerp(mid, 1 - dm)], 0.035, RED);
        if (dm > 0.95) {
          arrow(this.red, top, V(0, 1, 0), ux, 0.2, 0.02, RED);
          arrow(this.red, bot, V(0, -1, 0), ux, 0.2, 0.02, RED);
        }
      }
      const bt = this.st('BRIM', 'hscript');
      const tp = prog(t, s1 + 0.2, s1 + 0.55);
      if (tp > 0) letter(this.red, bt, bt.total * tp + 1e-3, { o: top.clone().add(V(0, 0.16, 0)).addScaledVector(ux, 0.3), r: ux, d: V(0, -1, 0), k: 0.3 / bt.capHeight }, 0.036, RED, 0.5, 11);
      const nt = this.st('half full!', 'hscript');
      const hp = prog(t, T.out + 0.1, T.out + 0.55);
      if (hp > 0) letter(this.red, nt, nt.total * hp + 1e-3, { o: top.clone().lerp(bot, 0.62).addScaledVector(ux, 0.28), r: ux, d: V(0, -1, 0), k: 0.24 / nt.capHeight }, 0.03, RED, 0.5, 13);
    }
    // the hook: red-pencil clock hands at ten past ten inside the rim, and the dial's ticks
    const hk = prog(t, T.end - 0.62, T.end - 0.2, ease.outCubic);
    if (hk > 0) {
      const c = L(0, gp.rimY + 0.03, 0);
      const up = V(0, 0, -1), right = V(1, 0, 0); // top-down: screen up is -z at az = 0
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        if (i / 12 > hk * 1.2) break;
        const d = up.clone().multiplyScalar(Math.cos(a)).addScaledVector(right, Math.sin(a));
        line(this.red, c.clone().addScaledVector(d, gp.rim * 0.8), c.clone().addScaledVector(d, gp.rim * (i % 3 === 0 ? 0.62 : 0.7)), 0.035, RED);
      }
      const hand = (ang: number, len: number, p: number) => {
        const d = up.clone().multiplyScalar(Math.cos(ang)).addScaledVector(right, Math.sin(ang));
        poly(this.red, [c, c.clone().addScaledVector(d, len)], 0.05, RED, p);
      };
      hand(((10 + 10 / 60) / 12) * Math.PI * 2, gp.rim * 0.42, prog(hk, 0.2, 0.7));
      hand((10 / 60) * Math.PI * 2, gp.rim * 0.62, prog(hk, 0.45, 1));
    }
  }
}

/** Flat annulus sector at height y (r0 = 0 gives a disc sector), angles as in LatheGeometry. */
function ringFan(r0: number, r1: number, y: number, phi0: number, phiL: number, n: number) {
  const pos: number[] = [], uv: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = phi0 + (phiL * i) / n, b = phi0 + (phiL * (i + 1)) / n;
    const p = (r: number, ph: number) => [r * Math.sin(ph), y, r * Math.cos(ph)];
    const A0 = p(r0, a), A1 = p(r1, a), B0 = p(r0, b), B1 = p(r1, b);
    if (r0 > 1e-6) pos.push(...A0, ...B1, ...A1, ...A0, ...B0, ...B1);
    else pos.push(...A0, ...B1, ...A1);
  }
  for (let i = 0; i < pos.length; i += 3) uv.push(pos[i]!, pos[i + 2]!);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
