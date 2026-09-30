// Phase-1 style "zine": a Xerox punk zine. The collage is real 3D: every cut-out scrap is an extruded
// sheet with thickness that casts a shadow onto the spread lying on the copier glass; the camera flies
// across the spread and slams in on the hits. The lit render is then photocopied to death (see
// style-zine-xerox.ts). Lyrics are ransom notes: each word's letters are cut from different sources and
// slapped down at the word's start; held notes get extra tape. The spot colour marks the fails.
import * as THREE from 'three';
import { Scene, type Frame } from '../engine/scene';
import { makeRT, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F } from '../engine/type';
import { strokeText } from '../engine/stroke';
import type { Line, Word } from '../engine/lyrics';
import { clamp, lerp, ease, keys, mulberry32, frameIdx, pulse, noise1, prog, type Key, type V2 } from '../engine/util';
import type { StyleNote } from '../styles/registry';
import {
  type Cut, type Strip, type Rng, letterScrap, typedStrip, chatCard, tapeScrap, clipping, masthead, keyboardPhoto,
  glassPhoto, strawberryPhoto, tex, sheet, PAPER, SPOT_LIN, tornPoly, cutPoly, type LetterStyle,
} from './style-zine-paper';
import { makeXerox } from './style-zine-xerox';

export const TITLE = 'Xerox punk zine';
export const NOTE: StyleNote = {
  technique: 'A real 3D collage (extruded paper scraps, tape and staples with shadow-mapped light on a zine spread) flown through by the camera, then photocopied in a shader: toner threshold with stipple, generation noise on twos, dust and dropouts, a misregistered spot pass, and the copier light bar as a wipe; toner edge darkening and drum streaks are printed on the sheets themselves.',
  palette: 'Copier paper and black toner only, plus one fluorescent spot pink for the fail marks (the circled R’s, the wrong “2”, the BRIM line and the gap).',
  typography: 'Ransom-note letters cut from Anton, Bricolage, Special Elite, Rubik Mono, JetBrains Mono and (only on big letters, whose hairlines survive the toner) Bodoni; chat printouts in JetBrains Mono, typed prompts in Special Elite; marker scrawls in single-stroke brush and print hands.',
  lyrics: 'One slap per word at its start: the word’s letter scraps fall and land in a 0.1 s cascade with small spins (shadows shrink as they land); held notes get extra tape strips slapped on the beat; STRAWBERRY is the hero word and gets its R’s circled and counted.',
  cost: 'Measured on a shared, loaded machine: 22 ms/frame at 1 sample (perf, incl. readback) and 9.7 ms per sub-frame at 12 samples (a 3D pass with a 2048 shadow map and MSAA 4x, one xerox pass, a second 3D pass only during the 0.2 s light-bar sweep). Full 204 s song with motion blur (about 20 sub-frames average): roughly 40 min.',
  risks: 'The threshold look can swallow thin type at a distance (every lyric line is framed large); many small meshes and shadow maps are cheap, but a full-song version needs a layout tool for the collage; the lid edge and stipple must not flicker too much at 60 fps (they boil on twos).',
};

// ---------------------------------------------------------------- scene-local types

interface Piece {
  obj: THREE.Object3D;
  x: number; y: number; z: number; rot: number; tx: number; ty: number;
  /** Landing time (−Infinity: already on the page) and fall duration. */
  tLand: number; fall: number;
  dropH: number; spin: number; dx: number; dy: number;
  /** How much the kicks make it hop. */
  hop: number;
  seed: number;
  /** Lifts with this piece (a strip glued onto a card rides the card's hops). */
  follow?: Piece;
  /** Optional extra motion (hero word's token split etc.). */
  extra?: (t: number, p: Piece) => { x?: number; y?: number; z?: number; rot?: number };
}
interface Typing { mesh: THREE.Mesh; map: THREE.Texture; strip: Strip; times: number[] }
interface Mark { polys: THREE.Vector3[][]; lens: number[][]; total: number; t0: number; t1: number; width: number; rgb: [number, number, number]; fadeOut?: number }
interface Pose { tx: number; ty: number; dist: number; tilt: number; az: number; roll: number; fov: number }

const THICK = 0.035;
const BLACK: [number, number, number] = [0.01, 0.01, 0.012];

export default class Zine extends Scene {
  world = new THREE.Scene();
  camA = new THREE.PerspectiveCamera(38, W / H, 0.5, 400);
  camB = new THREE.PerspectiveCamera(38, W / H, 0.5, 400);
  rtA = makeRT(W, H, { samples: 4 });
  rtB = makeRT(W, H, { samples: 4 });
  xerox = makeXerox();
  marks = new LineBatch(60000, { screen2D: false, worldWidth: true, blend: 'normal', depthTest: true });
  sun = new THREE.DirectionalLight(0xffffff, 2.9);
  pieces: Piece[] = [];
  typings: Typing[] = [];
  markList: Mark[] = [];
  aniso = 8;
  edgeMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(0.8, 0.79, 0.76) });
  T: Record<string, number> = {};
  kicks: number[] = [];
  snares: number[] = [];
  /** Where things are (filled by the layout; the camera frames them). */
  at: Record<string, V2> = {};

  override async init() {
    const { lyrics, audio, renderer } = this.ctx;
    this.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const L0 = lyrics.get('Watch it try', 0), L1 = lyrics.get("It can't count the R", 0), L2 = lyrics.get("It can't fill a glass of wine", 0);
    const s = this.ctx.start, e = this.ctx.end;
    const db = audio.downbeats.filter((d) => d > s - 0.05 && d < e + 0.05);
    const T = this.T;
    T.d0 = s; T.d1 = db[1] ?? s + 1.39; T.d2 = db[2] ?? s + 2.78; T.d3 = db[3] ?? s + 4.17; T.d4 = db[4] ?? s + 5.56; T.d5 = db[5] ?? s + 6.95; T.d6 = e;
    this.kicks = audio.events('kick', s - 0.05, e + 0.05).map((k) => k[0]);
    this.snares = audio.events('snare', s - 0.05, e + 0.05).map((k) => k[0]);
    const fill = audio.events('kick', T.d1 + 0.12, T.d2 - 0.1).map((k) => k[0]);
    T.k1 = fill[0] ?? T.d1 + 0.36; T.k2 = fill[1] ?? T.d1 + 0.52; T.k3 = fill[fill.length - 1] ?? T.d1 + 0.7;
    const rs = L1.words[4]!, straw = L1.words[6]!, glass = L2.words[4]!, wine = L2.words[6]!;
    T.rs = rs.start; T.straw = straw.start; T.strawEnd = straw.end; T.l2 = L2.words[0]!.start; T.glass = glass.start; T.wine = wine.start; T.wineEnd = wine.end;
    T.thing = L0.words[7]!.start; T.thingEnd = L0.words[7]!.end; T.l1 = L1.words[0]!.start;

    this.buildWorld();
    this.layout(L0, L1, L2);
  }

  // ================================================================= world

  private buildWorld() {
    const w = this.world;
    w.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = this.sun;
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    const sc = sun.shadow.camera;
    sc.near = 1; sc.far = 120;
    w.add(sun, sun.target);
    // the copier glass around the spread (reads as the lid's black)
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(600, 400), new THREE.MeshLambertMaterial({ color: new THREE.Color(0.02, 0.02, 0.022) }));
    glass.position.z = -0.3;
    glass.receiveShadow = true;
    w.add(glass);
    // the spread: two pages with a crease
    const rng = mulberry32(77);
    const PW_ = 47, PH_ = 54;
    for (const side of [0, 1]) {
      const s = sheet(PW_, PH_);
      s.c.fillStyle = PAPER;
      s.c.fillRect(0, 0, PW_, PH_);
      // the crease's shade and the page's own faint show-through
      const g = s.c.createLinearGradient(side ? 0 : PW_, 0, side ? 2.5 : PW_ - 2.5, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      s.c.fillStyle = g;
      s.c.fillRect(0, 0, PW_, PH_);
      // the copy's artefacts live on the sheet: toner creeping in from the outer edges (the lid's
      // shadow), a few drum streaks running down the page, a grey smear from a dirty corona wire
      const edge = (x0: number, y0: number, x1: number, y1: number) => {
        const e = s.c.createLinearGradient(x0, y0, x1, y1);
        e.addColorStop(0, 'rgba(0,0,0,0.85)'); e.addColorStop(0.35, 'rgba(0,0,0,0.35)'); e.addColorStop(1, 'rgba(0,0,0,0)');
        s.c.fillStyle = e;
        s.c.fillRect(0, 0, PW_, PH_);
      };
      edge(0, 0, 0, 2.2); edge(0, PH_, 0, PH_ - 2.2);
      if (side) edge(PW_, 0, PW_ - 2.2, 0); else edge(0, 0, 2.2, 0);
      s.c.strokeStyle = 'rgba(0,0,0,0.55)';
      for (let k = 0; k < 4; k++) {
        const x = 3 + rng() * (PW_ - 6);
        s.c.lineWidth = 0.04 + rng() * 0.08;
        s.c.beginPath();
        let y = 0;
        while (y < PH_) { const l = 2 + rng() * 9; s.c.moveTo(x, y); s.c.lineTo(x, y + l); y += l + rng() * 3; }
        s.c.stroke();
      }
      const band = 8 + rng() * 30;
      const sg = s.c.createLinearGradient(0, band - 0.8, 0, band + 0.8);
      sg.addColorStop(0, 'rgba(0,0,0,0)'); sg.addColorStop(0.5, 'rgba(0,0,0,0.22)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
      s.c.fillStyle = sg;
      s.c.fillRect(0, band - 0.8, PW_, 1.6);
      const cut: Cut = { w: PW_, h: PH_, poly: tornPoly(PW_, PH_, rng, 0.05, 1.2, [false, false, false, false]), canvas: s.canvas };
      const m = this.scrapMesh(cut, 0.12);
      m.castShadow = false;
      m.position.set(side ? 14 + PW_ / 2 : 14 - PW_ / 2, -4, -0.12);
      w.add(m);
    }
  }

  private scrapMesh(cut: Cut, thick = THICK, opts: { transparent?: boolean; opacity?: number } = {}) {
    const shape = new THREE.Shape(cut.poly.map((p) => new THREE.Vector2(p.x, p.y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 1, steps: 1 });
    const pos = geo.attributes.position!, uv = geo.attributes.uv!;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + cut.w / 2) / cut.w, (pos.getY(i) + cut.h / 2) / cut.h);
    uv.needsUpdate = true;
    const mat = new THREE.MeshLambertMaterial({ map: tex(cut.canvas, this.aniso), transparent: !!opts.transparent, opacity: opts.opacity ?? 1 });
    const m = new THREE.Mesh(geo, [mat, opts.transparent ? mat : this.edgeMat]);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  /** Add a scrap to the page. */
  private place(cut: Cut, x: number, y: number, o: Partial<Piece> & { layer?: number; thick?: number; transparent?: boolean; opacity?: number } = {}): Piece {
    const mesh = this.scrapMesh(cut, o.thick ?? THICK, { transparent: o.transparent, opacity: o.opacity });
    this.world.add(mesh);
    const seed = this.pieces.length * 7.31 + 3;
    const p: Piece = {
      obj: mesh, x, y, z: 0.02 + (o.layer ?? 0) * 0.05, rot: o.rot ?? 0, tx: o.tx ?? 0, ty: o.ty ?? 0,
      tLand: o.tLand ?? -Infinity, fall: o.fall ?? 0.09, dropH: o.dropH ?? 5, spin: o.spin ?? 0.5, dx: o.dx ?? 0, dy: o.dy ?? 0,
      hop: o.hop ?? 1, seed, extra: o.extra, follow: o.follow,
    };
    this.pieces.push(p);
    return p;
  }

  /**
   * Lay a lyric word out as ransom letters from (x, y) (left, letter centre line) at nominal letter
   * height h. Returns the word's width. The letters land in a quick cascade from the word's start.
   */
  private ransom(word: Word, x: number, y: number, h: number, rng: Rng, o: { upper?: boolean; stagger?: number; drop?: number; fallFrom?: number; dropXY?: number; force?: (i: number, ch: string) => { font?: string; style?: LetterStyle; lower?: boolean } | undefined; layer?: number; extra?: Piece['extra']; collect?: Piece[] } = {}) {
    const chars = Array.from(o.upper === false ? word.w : word.w.toUpperCase());
    const n = chars.filter((c) => c !== ' ').length;
    const stagger = o.stagger ?? Math.min(0.024, 0.1 / Math.max(1, n));
    let cx = x, k = 0;
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i]!;
      const small = /[’',.!?]/.test(ch);
      const cut = letterScrap(ch, small ? h * 0.62 : h, rng, o.force?.(i, ch) ?? {});
      const yOff = small ? (ch === '’' || ch === "'" ? h * 0.28 : ch === '!' ? 0 : -h * 0.3) : (rng() - 0.5) * h * 0.16;
      const px = cx + cut.w / 2;
      const p = this.place(cut, px, y + yOff, {
        layer: (o.layer ?? 1) + rng() * 0.8, rot: (rng() - 0.5) * 0.24, tx: (rng() - 0.5) * 0.05, ty: (rng() - 0.5) * 0.05,
        tLand: word.start + k * stagger, fall: o.fallFrom !== undefined ? word.start + k * stagger - o.fallFrom : 0.085 + rng() * 0.03, dropH: (4 + rng() * 3) * (o.drop ?? 1), spin: (rng() - 0.5) * 1.6,
        dx: (rng() - 0.5) * h * 0.8 * (o.dropXY ?? o.drop ?? 1), dy: ((rng() - 0.5) * h * 0.8 + h * 0.4) * (o.dropXY ?? o.drop ?? 1), extra: o.extra,
      });
      o.collect?.push(p);
      cx += cut.w + h * (rng() * 0.12 - 0.05);
      k++;
    }
    return cx - x;
  }

  /** A row of words; returns each word's [x0, x1]. */
  private ransomRow(words: Word[], x: number, y: number, h: number, rng: Rng, hOf?: (w: Word) => number) {
    const spans: [number, number][] = [];
    let cx = x;
    for (const w of words) {
      const hh = hOf?.(w) ?? h;
      const wd = this.ransom(w, cx, y, hh, rng);
      spans.push([cx, cx + wd]);
      cx += wd + h * 0.55;
    }
    return spans;
  }

  /** A typing plane on a strip: characters appear at `times[i]`. */
  private typing(strip: Strip, piece: Piece, times: number[]) {
    const map = tex(strip.text, this.aniso);
    map.wrapS = THREE.ClampToEdgeWrapping;
    const geo = new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0);
    const mat = new THREE.MeshLambertMaterial({ map, transparent: true, alphaTest: 0.05, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.position.set(strip.tx, strip.ty, THICK + 0.004);
    piece.obj.add(mesh);
    this.typings.push({ mesh, map, strip, times });
  }

  /** Marker polyline(s) in page space, drawn over [t0, t1]. */
  private mark(polys: V2[][], z: number, t0: number, t1: number, width: number, rgb: [number, number, number], fadeOut?: number) {
    const P = polys.map((pl) => pl.map((p) => new THREE.Vector3(p.x, p.y, z)));
    const lens = P.map((pl) => { const L = [0]; for (let i = 1; i < pl.length; i++) L.push(L[i - 1]! + pl[i]!.distanceTo(pl[i - 1]!)); return L; });
    const total = lens.reduce((a, L) => a + L[L.length - 1]!, 0);
    this.markList.push({ polys: P, lens, total, t0, t1, width, rgb, fadeOut });
  }
  /** Hand-lettered marker text (single-stroke brush font) at (x, y) = left baseline. */
  private markText(str: string, x: number, y: number, size: number, rot: number, t0: number, t1: number, width: number, rgb: [number, number, number], font: 'felix' | 'hscript' | 'readable' = 'felix') {
    const st = strokeText(str, font, 100);
    const k = size / 100, c = Math.cos(rot), s = Math.sin(rot);
    const polys = st.strokes.map((pl) => pl.map((p) => { const u = p.x * k, v = -p.y * k; return { x: x + u * c - v * s, y: y + u * s + v * c }; }));
    this.mark(polys, 0.9, t0, t1, width, rgb);
    return st.width * k;
  }
  /** A hand-drawn loop around a point (the marker circle). */
  private loop(cx: number, cy: number, rx: number, ry: number, t0: number, t1: number, width: number, rgb: [number, number, number], seed: number, turns = 1.18) {
    const pts: V2[] = [];
    const N = 64, a0 = -2.2 + seed;
    for (let i = 0; i <= N; i++) {
      const u = i / N, a = a0 + u * turns * Math.PI * 2;
      const wob = 1 + 0.06 * noise1(u * 5 + seed * 3) + 0.05 * u;
      pts.push({ x: cx + Math.cos(a) * rx * wob, y: cy + Math.sin(a) * ry * wob });
    }
    this.mark([pts], 0.95, t0, t1, width, rgb);
  }

  // ================================================================= layout

  private layout(L0: Line, L1: Line, L2: Line) {
    const T = this.T, at = this.at;
    const rng = mulberry32(1234);
    const SP = SPOT_LIN;

    // ---- decor that is already on the spread (the rest of the zine)
    this.place(masthead(22, 4.6, rng, 'YOUR JOB IS SAFE!', 'ISSUE #1 · HAND-TYPED SINCE 2005 · 50¢'), -21, 20.6, { rot: -0.02, layer: 0 });
    const BODY = 'I write my code by hand every semicolon mine twenty years of tabs never spaces by design they said try the robot bro I said show me the proof drew a hand with extra fingers what a goof it is a craft it is an art';
    this.place(clipping(13, 17, rng, 'SLOP MACHINE', BODY), -38, 2, { rot: 0.05, layer: 0 });
    this.place(clipping(15, 9, rng, 'IT’S A TOY', BODY, F.anton()), 66, 8, { rot: -0.04, layer: 0 });
    this.place(keyboardPhoto(12, 7, rng), 5, 17.5, { rot: 0.06, layer: 0 });
    this.place(clipping(12, 14, rng, 'PARTY TRICK', BODY, F.display(75, 800)), 72, -20, { rot: -0.05, layer: 0 });
    this.place(clipping(18, 7, rng, 'NEXT YEAR, THEY SAID', BODY), 45, 19, { rot: 0.03, layer: 0 });
    this.place(clipping(16, 8, rng, 'HAND-TYPED', BODY, F.rubik()), 16, -23, { rot: -0.03, layer: 0 });
    // the fruit itself, cut from a produce catalogue, beside where the word will land
    this.place(strawberryPhoto(9, 10, rng), 3.5, -8.5, { rot: 0.12, layer: 0.3 });

    // ---- A: the pre-chorus tail and the test question
    const rowA1 = this.ransomRow(L0.words.slice(0, 3), -31, 15.6, 2.9, rng);
    this.ransomRow(L0.words.slice(3, 6), -29.5, 11.7, 2.9, rng);
    const rowA3 = this.ransomRow(L0.words.slice(6), -31, 7.2, 2.9, rng, (w) => (w.index === 7 ? 3.9 : 2.9));
    at.a1 = { x: (rowA1[0]![0] + rowA1[rowA1.length - 1]![1]) / 2, y: 11.7 };
    const thing = rowA3[1]!;
    at.thing = { x: (thing[0] + thing[1]) / 2, y: 7.2 };
    // underline "simplest" twice
    const simp = rowA3[0]!;
    this.mark([[{ x: simp[0], y: 5.1 }, { x: simp[1] + 0.4, y: 5.25 }], [{ x: simp[0] + 0.3, y: 4.65 }, { x: simp[1] - 0.2, y: 4.8 }]], 0.9, L0.words[6]!.start + 0.1, L0.words[6]!.end, 0.16, BLACK);
    // "thing!" is held: the three kicks of the fill slap tape across it
    const tapes: [number, number, number][] = [[-0.35, 0.3, 0.5], [0.15, -0.35, -0.3], [0.5, 0.1, 0.12]];
    [T.k1, T.k2, T.k3].forEach((tk, i) => {
      const [dx, dy, r] = tapes[i]!;
      this.place(tapeScrap(5.2, 1.4, rng), at.thing.x + dx * (thing[1] - thing[0]), 7.2 + dy * 2.9, { rot: r, layer: 3 + i, tLand: tk!, fall: 0.07, dropH: 3, spin: 0.4, transparent: true, opacity: 0.8, thick: 0.02 });
    });

    // the question, typed into a chat printout
    const qCard = chatCard(20, 4.2, rng, 'chatbot', 'new chat');
    at.q = { x: -20, y: 1.5 };
    const qp = this.place(qCard, at.q.x, at.q.y, { rot: 0.025, layer: 0.5 });
    const qStrip = typedStrip('you: how many r’s in “strawberry”?'.replace(/[’]/g, "'").replace(/[“”]/g, '"'), F.mono(400), 0.95, rng, { bg: PAPER, padX: 0.4, padY: 0.2 });
    const qsp = this.place({ ...qStrip, poly: cutPoly(qStrip.w, qStrip.h, rng, 0.0) }, at.q.x - 0.5, at.q.y - 0.55, { rot: 0.025, layer: 1.2, follow: qp });
    const nq = qStrip.edges.length;
    const qT0 = T.d0 + 0.08, qT1 = T.d1 + 0.22;
    this.typing(qStrip, qsp, qStrip.edges.map((_, i) => qT0 + ((qT1 - qT0) * (i + 0.3 * Math.sin(i * 2.7))) / nq));
    // staple the printout
    this.staple(at.q.x - 9.4, at.q.y + 1.5, 0.3, 0);

    // ---- B: line 1, the hero word
    const rowB = this.ransomRow(L1.words.slice(0, 4), -30, -4, 2.2, rng);
    at.b1 = { x: (rowB[0]![0] + rowB[3]![1]) / 2, y: -4 };
    // R'S is the hit: its letters are already hurtling down at the camera on the downbeat and land on the word
    const rsW = this.ransom(L1.words[4]!, -29, -9.6, 4.6, rng, { layer: 2, drop: 0.7, dropXY: 0.15, fallFrom: this.T.d2 });
    this.ransom(L1.words[5]!, -29 + rsW + 1.2, -10.3, 2.2, rng);
    at.rs = { x: -29 + rsW / 2, y: -9.6 };
    // STRAWBERRY: big letters, the three R's cut from three very different sources so they count clearly
    const heroFonts = [F.anton(), F.bodoni(800), F.display(100, 800), F.typewriter(), F.rubik(), F.display(75, 800), F.mono(800), F.anton(), F.display(100, 800), F.rubik(), F.anton()];
    const heroStyles: LetterStyle[] = ['paper', 'black', 'paper', 'news', 'paper', 'dots', 'paper', 'black', 'paper', 'box', 'paper'];
    const hero: Piece[] = [];
    const heroH = 4.5, heroX = -31, heroY = -16.8;
    const strawW = this.ransom(L1.words[6]!, heroX, heroY, heroH, rng, {
      layer: 2, stagger: 0.03, collect: hero,
      force: (i) => ({ font: heroFonts[i], style: heroStyles[i], lower: false }),
    });
    at.hero = { x: heroX + strawW / 2, y: heroY };
    at.heroL = { x: heroX, y: heroY };
    at.heroR = { x: heroX + strawW, y: heroY };
    // count the R's: circles and numbers in the spot colour on the beats inside the held note
    const rIdx = [2, 7, 8];
    const beatsIn = this.ctx.audio.beats.filter((b) => b > T.straw + 0.08 && b < T.strawEnd + 0.1);
    const countT = [T.straw + 0.3, beatsIn[0] ?? T.straw + 0.47, beatsIn[1] ?? T.straw + 0.8];
    rIdx.forEach((ri, k) => {
      const p = hero[ri]!;
      const t0 = Math.max(countT[k]!, p.tLand + 0.05);
      const r = ((p.obj as THREE.Mesh).geometry as THREE.BufferGeometry);
      r.computeBoundingBox();
      const bb = r.boundingBox!;
      const rw = (bb.max.x - bb.min.x) * 0.62, rh = (bb.max.y - bb.min.y) * 0.62;
      this.loop(p.x, p.y, rw, rh, t0, t0 + 0.16, 0.26, SP, k * 1.7);
      this.markText(String(k + 1), p.x + rw * 0.75, p.y + rh * 1.02, 2.2, -0.1, t0 + 0.1, t0 + 0.24, 0.24, SP);
    });
    at.r3 = { x: hero[8]!.x, y: heroY };
    this.markText('3 R’s', heroX + strawW - 6, heroY - 5.3, 2.4, 0.04, T.strawEnd - 0.15, T.strawEnd + 0.15, 0.26, SP);
    // tape over the hero's ends at the end of the hold
    this.place(tapeScrap(5, 1.3, rng), heroX + 0.5, heroY + 2.4, { rot: 0.7, layer: 5, tLand: T.strawEnd - 0.05, fall: 0.07, dropH: 3, transparent: true, opacity: 0.8, thick: 0.02 });
    this.place(tapeScrap(5, 1.3, rng), heroX + strawW - 0.6, heroY - 2.3, { rot: 0.6, layer: 5, tLand: T.strawEnd + 0.02, fall: 0.07, dropH: 3, transparent: true, opacity: 0.8, thick: 0.02 });

    // ---- C: the confident answer
    at.c = { x: 39, y: 11.5 };
    const aCard = chatCard(21, 4.6, rng, 'chatbot', 'answer ✓');
    const aPiece = this.place(aCard, at.c.x, at.c.y, { rot: -0.03, layer: 0.5, tLand: T.d3 - 0.001, fall: 0.06, dropH: 3, spin: 0.1 });
    const aStrip = typedStrip('There are 2 R\'s in "strawberry".', F.mono(400), 1.05, rng, { padX: 0.4, padY: 0.2 });
    const asp = this.place({ ...aStrip, poly: cutPoly(aStrip.w, aStrip.h, rng, 0.0) }, at.c.x + 0.2, at.c.y - 0.65, { rot: -0.03, layer: 1.2, tLand: T.d3 - 0.001, fall: 0.06, dropH: 3, spin: 0.1, follow: aPiece });
    const na = aStrip.edges.length, aT0 = T.d3 + 0.04, aT1 = T.d3 + 0.4;
    this.typing(aStrip, asp, aStrip.edges.map((_, i) => aT0 + ((aT1 - aT0) * i) / na));
    // the big "2", slapped on the downbeat of the cut
    const two = letterScrap('2', 8, rng, { font: F.anton(), style: 'paper' });
    at.two = { x: at.c.x - 14.5, y: at.c.y + 1.6 };
    this.place(two, at.two.x, at.two.y, { rot: -0.12, layer: 3, tLand: T.d3 + 0.001, fall: 0.07, dropH: 6, spin: 0.6 });
    this.loop(at.two.x, at.two.y, 3.2, 4.4, T.d3 + 0.2, T.d3 + 0.33, 0.34, SP, 0.4);
    this.mark([[{ x: at.two.x - 3.3, y: at.two.y - 3.8 }, { x: at.two.x + 3.4, y: at.two.y + 3.6 }]], 0.97, Math.max(T.d3 + 0.34, this.snareAfter(T.d3 + 0.2)), Math.max(T.d3 + 0.34, this.snareAfter(T.d3 + 0.2)) + 0.07, 0.38, SP);
    this.markText('3!!', at.two.x + 3.6, at.two.y + 3.2, 3.2, -0.12, T.d3 + 0.44, T.d3 + 0.58, 0.32, SP);
    // what the model actually sees: two tokens, not ten letters
    at.tok = { x: at.c.x - 1, y: at.c.y - 5.4 };
    const tokLabel = typedStrip('what it sees:', F.typewriter(), 0.9, rng, { padX: 0.3, padY: 0.15 });
    this.place({ ...tokLabel, canvas: this.stripFlat(tokLabel) }, at.tok.x - 7.5, at.tok.y + 0.1, { rot: 0.03, layer: 1, tLand: T.d3 + 0.4, fall: 0.07, dropH: 3 });
    const tokA = typedStrip('straw', F.mono(700), 1.5, rng, { bg: PAPER, padX: 0.5, padY: 0.35 });
    const tokB = typedStrip('berry', F.mono(700), 1.5, rng, { bg: PAPER, padX: 0.5, padY: 0.35 });
    const tA = this.place({ ...tokA, canvas: this.stripFlat(tokA) }, at.tok.x - 0.6, at.tok.y, { rot: -0.04, layer: 1.4, tLand: T.d3 + 0.5, fall: 0.07, dropH: 3 });
    const tB = this.place({ ...tokB, canvas: this.stripFlat(tokB) }, at.tok.x + tokA.w + 0.1, at.tok.y, { rot: 0.05, layer: 1.4, tLand: T.d3 + 0.58, fall: 0.07, dropH: 3 });
    void tA; void tB;
    this.markText('tokens, not letters', at.tok.x - 3.5, at.tok.y - 3.4, 1.5, 0.02, T.d3 + 0.62, T.d3 + 0.82, 0.26, SP, 'readable');
    this.mark([[{ x: at.tok.x + tokA.w / 2 - 0.55, y: at.tok.y + 2.0 }, { x: at.tok.x + tokA.w / 2 - 0.4, y: at.tok.y - 2.0 }]], 0.97, T.d3 + 0.6, T.d3 + 0.66, 0.24, SP);

    // ---- D: line 2 and the half-full glass
    const rowL2 = this.ransomRow(L2.words.slice(0, 4), 19, 0.8, 2.2, rng);
    at.l2 = { x: (rowL2[0]![0] + rowL2[3]![1]) / 2, y: 0.8 };
    at.l2x0 = { x: rowL2[0]![0], y: 0.8 }; at.l2x1 = { x: rowL2[3]![1], y: 0.8 };
    at.glass = { x: 49, y: -11.5 };
    const gp = glassPhoto(10, 16, rng);
    const gPiece = this.place(gp, at.glass.x, at.glass.y, { rot: 0.0, layer: 1, tLand: T.d4 + 0.001, fall: 0.08, dropH: 7, spin: 0.25, dy: 2 });
    void gPiece;
    const gW = this.ransom(L2.words[4]!, 24, -7, 3.4, rng, { layer: 2 });
    this.ransom(L2.words[5]!, 24 + gW + 0.9, -7.4, 2.2, rng);
    this.ransom(L2.words[6]!, 26, -13.5, 4.5, rng, { layer: 2 });
    at.words2 = { x: 33, y: -11 };
    // the prompt and the cheerful claim
    const pStrip = typedStrip('prompt: a wine glass filled to the brim', F.typewriter(), 0.95, rng, { padX: 0.5, padY: 0.25, torn: true });
    at.prompt = { x: 45, y: -2.4 };
    const pp = this.place({ ...pStrip, canvas: this.stripFlat(pStrip) }, at.prompt.x, at.prompt.y, { rot: 0.02, layer: 1.5, tLand: T.l2 + 0.25, fall: 0.07, dropH: 3 });
    void pp;
    const rStrip = typedStrip('Here\'s a wine glass filled to the brim!', F.mono(400), 0.95, rng, { padX: 0.45, padY: 0.25 });
    at.reply = { x: 39, y: -20.5 };
    const rp = this.place({ ...rStrip, poly: cutPoly(rStrip.w, rStrip.h, rng, 0.01) }, at.reply.x, at.reply.y, { rot: -0.015, layer: 1.5, tLand: T.d4 + 0.2, fall: 0.07, dropH: 3 });
    const nr = rStrip.edges.length, rT0 = T.d4 + 0.26, rT1 = T.d4 + 0.95;
    this.typing(rStrip, rp, rStrip.edges.map((_, i) => rT0 + ((rT1 - rT0) * i) / nr));
    this.markText('chatbot:', at.reply.x - rStrip.w / 2, at.reply.y + 1.1, 1.1, 0.0, T.d4 + 0.2, T.d4 + 0.3, 0.14, BLACK, 'readable');
    // BRIM line, the gap between it and the wine, "GAP?!" — the fail, in the spot colour
    const gx = at.glass.x + gp.cx, rimY = at.glass.y + gp.rimY, wineY = at.glass.y + gp.wineY;
    at.rim = { x: gx, y: rimY };
    at.gap = { x: gx, y: (rimY + wineY) / 2 };
    const tb = T.d4 + 0.5;
    this.mark([[{ x: gx - gp.rimR - 1.4, y: rimY + 0.05 }, { x: gx + gp.rimR + 1.6, y: rimY - 0.05 }]], 0.97, tb, tb + 0.12, 0.26, SP);
    this.markText('BRIM', gx + gp.rimR + 1.9, rimY - 0.55, 1.7, 0.0, tb + 0.1, tb + 0.3, 0.24, SP);
    // the gap: a dimension bracket from wine to brim, hatched
    const bx = gx + gp.rimR + 1.0;
    const wineT = Math.max(T.wine + 0.3, T.d5 - 0.3);
    this.mark([[{ x: bx - 0.4, y: rimY }, { x: bx, y: rimY }, { x: bx, y: wineY }, { x: bx - 0.4, y: wineY }]], 0.97, wineT, wineT + 0.14, 0.2, SP);
    const hatch: V2[][] = [];
    const hN = 9;
    for (let i = 0; i < hN; i++) {
      const y = lerp(wineY + 0.3, rimY - 0.2, i / (hN - 1));
      const rr = lerp(gp.wineR, gp.rimR, (y - wineY) / (rimY - wineY)) * 0.86;
      hatch.push([{ x: gx - rr, y: y - 0.25 }, { x: gx + rr, y: y + 0.25 }]);
    }
    this.mark(hatch, 0.96, T.d5 + 0.02, T.d5 + 0.3, 0.13, SP);
    this.markText('GAP?!', bx + 0.6, (rimY + wineY) / 2 - 0.6, 1.9, 0.05, T.d5 + 0.2, T.d5 + 0.42, 0.24, SP);
    // held "wine,": tape and staples on the snares inside the hold
    const holdSn = this.snares.filter((sn) => sn > T.wine + 0.2 && sn < T.wineEnd + 0.1);
    holdSn.forEach((sn, i) => {
      this.place(tapeScrap(4.4, 1.2, rng), at.glass.x + (i ? 4.4 : -4.4), at.glass.y + (i ? -7.2 : 4.5), { rot: i ? 0.5 : -0.75, layer: 4, tLand: sn, fall: 0.07, dropH: 3, transparent: true, opacity: 0.8, thick: 0.02 });
    });
    // the out: the marker rings the rim (a round shape to hand off on)
    this.loop(gx, rimY, gp.rimR * 1.25, gp.rimR * 1.25, T.wineEnd - 0.1, T.wineEnd + 0.35, 0.3, SP, 2.0, 1.08);
  }

  /** Strip canvas with its text baked in (for strips that are not typed live). */
  private stripFlat(s: Strip) {
    const c = document.createElement('canvas');
    c.width = s.canvas.width; c.height = s.canvas.height;
    const g = c.getContext('2d')!;
    g.drawImage(s.canvas, 0, 0);
    const k = c.width / s.w;
    g.drawImage(s.text, (s.tx + s.w / 2) * k, (s.h / 2 - (s.ty + s.th)) * k, s.tw * k, s.th * k);
    return c;
  }

  private staple(x: number, y: number, rot: number, tLand: number) {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(0.25, 0.25, 0.27) });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 0.06), mat);
    bar.castShadow = true;
    g.add(bar);
    this.world.add(g);
    this.pieces.push({ obj: g, x, y, z: 0.2, rot, tx: 0, ty: 0, tLand: tLand || -Infinity, fall: 0.06, dropH: 2, spin: 0.2, dx: 0, dy: 0, hop: 0.3, seed: 1 });
  }

  // ================================================================= animation

  private snareAfter(t: number) { return this.snares.find((s) => s >= t) ?? t; }

  private hopAt(t: number) {
    let v = 0;
    for (const k of this.kicks) if (t >= k) v = Math.max(v, pulse(t, k, 0.07));
    return v;
  }

  private posePieces(t: number) {
    const T = this.T;
    const hop = this.hopAt(t);
    // the wind-up: on the three fill kicks everything lifts off the page a little more each time
    const wind = t < T.d2 ? keys(t, [[T.k1 - 0.01, 0], [T.k1 + 0.06, 0.35, ease.outExpo], [T.k2 + 0.06, 0.7, ease.outExpo], [T.k3 + 0.06, 1, ease.outExpo], [T.d2 - 0.03, 1.15, ease.linear]]) : 0;
    for (const p of this.pieces) {
      const o = p.obj;
      if (t < p.tLand - p.fall) { o.visible = false; continue; }
      o.visible = true;
      const u = clamp((t - (p.tLand - p.fall)) / p.fall);
      const f = (1 - u) * (1 - u);
      const since = t - p.tLand;
      const settle = since > 0 && since < 2 ? Math.exp(-since * 16) * Math.sin(since * 60) : 0;
      const ex = p.extra?.(t, p) ?? {};
      const lift = (q: Piece) => hop * 0.18 * q.hop * (0.6 + 0.8 * ((q.seed * 0.37) % 1)) + wind * 0.9 * q.hop * (0.5 + ((q.seed * 0.61) % 1));
      const hz = p.follow ? lift(p.follow) : lift(p);
      o.position.set(p.x + p.dx * f + (ex.x ?? 0), p.y + p.dy * f + (ex.y ?? 0), p.z + p.dropH * f + Math.max(0, settle) * 0.12 + hz + (ex.z ?? 0));
      const ws = (p.follow ?? p).seed;
      o.rotation.set(p.tx + wind * 0.05 * Math.sin(ws), p.ty + wind * 0.05 * Math.cos(ws), p.rot + p.spin * f + settle * 0.03 + (ex.rot ?? 0));
    }
    for (const ty of this.typings) {
      let n = 0;
      while (n < ty.times.length && t >= ty.times[n]!) n++;
      const frac = n === 0 ? 0 : ty.strip.edges[n - 1]!;
      ty.mesh.visible = frac > 0;
      ty.mesh.scale.set(Math.max(1e-3, ty.strip.tw * frac), ty.strip.th, 1);
      ty.map.repeat.set(Math.max(1e-3, frac), 1);
    }
  }

  private buildMarks(t: number) {
    const b = this.marks;
    b.clear();
    for (const m of this.markList) {
      if (t < m.t0) continue;
      const len = m.total * prog(t, m.t0, m.t1, ease.outQuad);
      let acc = 0;
      for (let k = 0; k < m.polys.length; k++) {
        const pl = m.polys[k]!, L = m.lens[k]!;
        for (let i = 1; i < pl.length; i++) {
          const a0 = acc + L[i - 1]!, a1 = acc + L[i]!;
          if (a0 >= len) break;
          const p = pl[i - 1]!, q = pl[i]!;
          const u = a1 <= len ? 1 : (len - a0) / Math.max(1e-6, a1 - a0);
          b.seg(p.x, p.y, p.z, lerp(p.x, q.x, u), lerp(p.y, q.y, u), lerp(p.z, q.z, u), m.width, m.rgb[0], m.rgb[1], m.rgb[2], 1);
        }
        acc += L[L.length - 1]!;
        if (acc >= len) break;
      }
    }
  }

  // ================================================================= camera

  /** The shot list. Hard cuts only on downbeats; moves ease into them. */
  private pose(t: number): Pose {
    const T = this.T, at = this.at;
    const P = (tx: number, ty: number, dist: number, tilt: number, az: number, roll: number, fov = 38): Pose => ({ tx, ty, dist, tilt, az, roll, fov });
    const mix = (a: Pose, b: Pose, u: number): Pose => ({
      tx: lerp(a.tx, b.tx, u), ty: lerp(a.ty, b.ty, u), dist: lerp(a.dist, b.dist, u), tilt: lerp(a.tilt, b.tilt, u),
      az: lerp(a.az, b.az, u), roll: lerp(a.roll, b.roll, u), fov: lerp(a.fov, b.fov, u),
    });
    const kick = this.hopAt(t);
    if (t < T.d1 - 0.12) {
      // 1: the pre-chorus words slapping down, tracked left to right, the question typing below
      const u = prog(t, T.d0, T.d1, ease.inOutQuad);
      return P(lerp(-18, -10, u), lerp(12.5, 9.8, u), lerp(24, 31, u) - kick * 0.4, lerp(0.34, 0.42, u), -Math.PI / 2 - 0.12 + u * 0.16, lerp(-0.05, 0.02, u));
    }
    if (t < T.k1) {
      // 1b: reframe onto the typed question and THING! (eases into the downbeat)
      const a = P(-10, 9.8, 31, 0.42, -Math.PI / 2 + 0.04, 0.02);
      const b = P(-10.5, 4.6, 27, 0.55, -Math.PI / 2 + 0.2, 0.06);
      const u = prog(t, T.d1 - 0.12, T.d1 + 0.05, ease.outCubic);
      const drift = prog(t, T.d1 + 0.05, T.k1, ease.linear);
      const p = mix(a, b, u);
      p.dist -= drift * 0.8;
      return p;
    }
    if (t < T.d2) {
      // 2: the wind-up. Three kicks, three jolts back; hold the breath while "It can't count the" lands
      const k = keys(t, [[T.k1, 0], [T.k1 + 0.1, 1, ease.outExpo], [T.k2, 1.05, ease.linear], [T.k2 + 0.1, 2, ease.outExpo], [T.k3, 2.05, ease.linear], [T.k3 + 0.12, 3, ease.outExpo]]);
      const hold = prog(t, T.k3 + 0.12, T.d2, ease.inQuad);
      const base = P(-10.5, 4.6, 26.2, 0.55, -Math.PI / 2 + 0.2, 0.06);
      const wide = P(-12, -4.5, 42, 0.2, -Math.PI / 2 + 0.05, -0.03, 40);
      const p = mix(base, wide, ease.outQuad(k / 3));
      // the held breath: creep in and roll against the coming snap
      p.dist -= hold * 11;
      p.tx += hold * 1.5; p.ty -= hold * 1.2;
      p.roll += hold * 0.06;
      p.tilt += hold * 0.08;
      return p;
    }
    if (t < T.d3) {
      // 3: SNAP onto R'S, then out along STRAWBERRY while its R's are counted
      const snap = prog(t, T.d2, T.d2 + 0.22, ease.outExpo);
      // (the snap lands on the downbeat, with "the" still held; R'S slams in on its own start)
      const a = P(at.rs.x + 3, at.rs.y + 2.2, 11, 0.62, -Math.PI / 2 - 0.2, -0.16, 34);
      const a2 = P(at.rs.x + 3.2, at.rs.y + 1.4, 13.5, 0.55, -Math.PI / 2 - 0.12, -0.05, 36);
      const b = P(at.hero.x - 3, at.hero.y + 1.5, 33, 0.6, -Math.PI / 2 - 0.25, -0.03, 38);
      const c = P(at.hero.x + 1.5, at.hero.y + 0.5, 30, 0.66, -Math.PI / 2 + 0.25, 0.05, 38);
      let p = mix(a, a2, snap);
      const toHero = prog(t, T.straw - 0.1, T.straw + 0.22, ease.outExpo);
      p = mix(p, b, toHero);
      p = mix(p, c, prog(t, T.straw + 0.22, T.d3, ease.inOutCubic));
      p.dist -= 2.2 * pulse(t, T.rs, 0.07);
      return p;
    }
    if (t < T.d4 - 0.001) {
      // 4: cut to the "2" (slapped on the downbeat); ride the typed answer to the tokens, then track
      // along line 2 as its first words land
      const slam = prog(t, T.d3, T.d3 + 0.2, ease.outExpo);
      const a = P(at.two.x + 1, at.two.y - 0.5, 10, 0.45, -Math.PI / 2 + 0.3, 0.14, 36);
      const a2 = P(at.two.x + 2.5, at.two.y - 0.8, 14, 0.5, -Math.PI / 2 + 0.2, 0.06, 38);
      const b = P(at.c.x - 5, at.c.y - 2.8, 25, 0.45, -Math.PI / 2 + 0.05, 0.0, 38);
      const c = P(at.c.x - 3.5, at.c.y - 3.4, 22.5, 0.5, -Math.PI / 2 - 0.08, -0.03, 38);
      const d0 = P(at.l2x0.x + 6, at.l2.y + 0.3, 15, 0.55, -Math.PI / 2 - 0.25, -0.06, 38);
      const d1 = P(at.l2x1.x - 5, at.l2.y + 0.3, 15.5, 0.6, -Math.PI / 2 - 0.05, 0.02, 38);
      let p = mix(a, a2, slam);
      p = mix(p, b, prog(t, T.d3 + 0.22, T.d3 + 0.45, ease.inOutCubic));
      p = mix(p, c, prog(t, T.d3 + 0.45, T.l2 - 0.1, ease.inOutQuad));
      const dd = mix(d0, d1, prog(t, T.l2, T.d4, ease.inOutQuad));
      p = mix(p, dd, prog(t, T.l2 - 0.1, T.l2 + 0.12, ease.outCubic));
      return p;
    }
    if (t < T.d5) {
      // 5: the glass slams down under the light bar; hold the whole claim, drift in
      const slam = prog(t, T.d4, T.d4 + 0.3, ease.outExpo);
      const a = P(at.glass.x - 11, at.glass.y + 0.5, 26, 0.35, -Math.PI / 2 - 0.1, -0.08, 42);
      const b = P(at.glass.x - 11, at.glass.y - 0.5, 34, 0.42, -Math.PI / 2 - 0.02, -0.02, 40);
      const p = mix(a, b, slam);
      const drift = prog(t, T.d4 + 0.3, T.d5, ease.inOutQuad);
      p.dist -= drift * 3; p.tx += drift * 1.5; p.az += drift * 0.12;
      return p;
    }
    // 6: push in on the gap, then the out: rise over the rim, the marker's ring filling the frame
    const push = prog(t, T.d5, T.d5 + 0.25, ease.outExpo);
    const a = P(at.glass.x - 8, at.glass.y - 0.5, 31, 0.44, -Math.PI / 2 + 0.1, -0.02, 40);
    const b = P(at.gap.x + 3.2, at.gap.y + 0.3, 14.5, 0.5, -Math.PI / 2 + 0.3, 0.06, 38);
    const c = P(at.rim.x, at.rim.y, 15.5, 0.12, -Math.PI / 2 + 0.6, 0.0, 38);
    let p = mix(a, b, push);
    p = mix(p, c, prog(t, T.wineEnd - 0.25, T.d6 + 0.05, ease.inOutCubic));
    return p;
  }

  private applyPose(cam: THREE.PerspectiveCamera, p: Pose, t: number) {
    // a hand-held float on top of every shot so nothing ever sits still
    const hx = noise1(t * 0.9, 3) * 0.25, hy = noise1(t * 0.8, 9) * 0.2;
    const tx = p.tx + hx, ty = p.ty + hy;
    const st = Math.sin(p.tilt), ct = Math.cos(p.tilt);
    cam.position.set(tx + Math.cos(p.az) * st * p.dist, ty + Math.sin(p.az) * st * p.dist, ct * p.dist);
    cam.up.set(-Math.cos(p.az), -Math.sin(p.az), 0);
    cam.lookAt(tx, ty, 0);
    cam.rotateZ(p.roll + noise1(t * 0.7, 5) * 0.01);
    cam.fov = p.fov;
    cam.updateProjectionMatrix();
  }

  /** Aim the shadow camera at what the camera is looking at (texel-snapped, so shadows don't crawl). */
  private aimSun(p: Pose) {
    const sc = this.sun.shadow.camera;
    const ext = Math.max(12, p.dist * 0.9);
    const snap = (ext * 2.8) / 2048;
    const cx = Math.round(p.tx / snap) * snap, cy = Math.round(p.ty / snap) * snap;
    this.sun.position.set(cx - 18, cy + 26, 60);
    this.sun.target.position.set(cx, cy, 0);
    sc.left = -ext * 1.4; sc.right = ext * 1.4; sc.top = ext * 1.4; sc.bottom = -ext * 1.4;
    sc.updateProjectionMatrix();
    this.sun.target.updateMatrixWorld();
  }

  private renderShot(t: number, cam: THREE.PerspectiveCamera, rt: THREE.WebGLRenderTarget, poseT = t) {
    const { renderer } = this.ctx;
    const p = this.pose(poseT);
    this.applyPose(cam, p, t);
    this.aimSun(p);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, true);
    renderer.render(this.world, cam);
    this.marks.render(renderer, rt, cam);
  }

  // ================================================================= frame

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, T = this.T;
    this.posePieces(t);
    this.buildMarks(t);
    // the light bar sweeps across as the glass comes down: the frame behind the bar is the new shot
    const sweep0 = T.d4 - 0.12, sweepDur = 0.18;
    const sweeping = t >= sweep0 - 0.001 && t < sweep0 + sweepDur;
    if (sweeping) {
      this.renderShot(t, this.camA, this.rtA, Math.min(t, T.d4 - 0.002));
      this.renderShot(t, this.camB, this.rtB, Math.max(t, T.d4));
    } else this.renderShot(t, this.camA, this.rtA);

    const x = this.xerox;
    x.u.srcA!.value = this.rtA.texture;
    x.u.srcB!.value = this.rtB.texture;
    x.u.wipe!.value = sweeping ? 1.05 - ease.inOutQuad(clamp((t - sweep0) / sweepDur)) * 1.12 : -1;
    x.u.gen!.value = Math.floor(frameIdx(t) / 5);
    x.u.flip!.value = t >= T.d2 && t < T.d2 + 0.05 ? 1 : 0;
    x.render(this.ctx.renderer, out);

    // hits: slaps shake the copy; the "R's" downbeat flips the toner for two frames
    const kick = this.hopAt(t);
    const sn = this.snares.reduce((v, s) => Math.max(v, pulse(t, s, 0.06)), 0);
    const shakeA = kick * 5 + sn * 3;
    return {
      bloom: 0.25, bloomThreshold: 1.2, halation: 0, ca: 0, grain: 0.035, vignette: 0.15,
      shake: [noise1(t * 40, 1) * shakeA, noise1(t * 40, 2) * shakeA] as [number, number],
      zoom: 1 + sn * 0.012,
    };
  }
}

