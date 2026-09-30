// Phase-1 style "ascii": a real 3D world (the word STRAWBERRY, the fruit, the bot's "2", the wine
// glass) rendered to a small luminance/depth buffer, then drawn as JetBrains Mono glyphs, one per
// character cell: a density ramp for the shading and / \ | - _ along the edges. Warm paper-white text
// on warm charcoal, one signal red. The lyric is typed, character by character with the voice, into a
// shell window that floats in that world; the chatbot answers in a second window.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { FSPass, Layer2D, makeRT, clearRT } from '../engine/gl';
import { F, font, plain } from '../engine/type';
import { clamp, lerp, ease, prog, springStep, pulse, hexToLinear, frameIdx } from '../engine/util';
import type { StyleNote } from '../styles/registry';
import { GShared, gMaterial, glyphAtlas, ASCII_FRAG, RAMP, GLYPHS, planeMaterial } from './style-ascii-gl';
import { TERM, REGION, PX_PER_UNIT, drawWindow, typedLine, typedPlain } from './style-ascii-term';
import { extrudeWord, strawberryBody, strawberryCalyx, wineGlassGeometry, wineGeometry, bubbleShape, GLASS } from './style-linocut-geo';

export const TITLE = 'Terminal ASCII-on-3D';
export const NOTE: StyleNote = {
  technique: 'A real three.js world (extruded STRAWBERRY, fruit, a bubble with a red "2", a lathe wine glass) rendered to a 960x540 luminance/signal/depth buffer; a fullscreen pass maps each character cell to a JetBrains Mono glyph atlas: density ramp for shade, / \\ | - _ along depth and light breaks. Cell size pulses on kicks and grows with each kick of the fill (the wind-up), snapping back on the downbeat. Two crisp terminal windows are planes in the same camera.',
  palette: 'Warm charcoal #1B1916, paper-white glyphs #EDE6D6 (brightness from the light), one signal red #E5322D for the R\'s, the "2" and the wine. No green, no rain.',
  typography: 'JetBrains Mono everywhere: the glyph atlas the world is made of, the extruded hero letters and the "2", and the two terminal windows.',
  lyrics: 'Per-character typing: the sung line is typed at the shell prompt in sync with the voice (Lyrics word progress), with a beat-blinking caret; held notes repeat their vowel while they ring (thiiing!, strawberryyy, wiiine). The chatbot\'s replies stream token by token.',
  cost: 'Measured (perf, 1080p, machine shared with other renders): 9–13.5 ms/frame at 1 sample incl. readback, ~3 ms per sub-frame at 12 samples (G-buffer + glyph pass + one 1600x1380 Canvas2D window layer per sub-frame). Full 204 s song with motion blur at ~24 sub-frames/frame: about 15 min.',
  risks: 'ASCII 3D reads only when objects are big on screen (a few cells are noise), so the camera stays close; the cell grid swims under camera motion (it is the look, but motion blur softens it). Two text layers (ASCII world + crisp windows) must not fight: the windows are kept to one side of the hero.',
};

const HEX = { bg: '#1B1916', paper: '#EDE6D6', red: '#E5322D' };
const MONO800 = F.mono(800);
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
type V3 = [number, number, number];
const BASE_CELL = 15; // cell height (logical px) at rest

// ---- world layout (floor y = 0, the flight goes toward -z) ----
const Z = {
  S: { x: 0, z: -32 }, // STRAWBERRY
  T: { x: 20, z: -40 }, // the bot's "2"
  G: { x: 35, z: -49 }, // the glass
};
const GLASS_H = 4.8;
const WINE_LEVEL = GLASS.bowlBottom + 0.5 * (GLASS.rim - GLASS.bowlBottom);

interface Pane { mesh: THREE.Mesh; mat: THREE.RawShaderMaterial; t0: number; t1: number; pop: boolean }
interface Orbit { tgt: THREE.Vector3; az: number; el: number; dist: number; fov: number; roll: number }

export default class Ascii extends Scene {
  private sh = new GShared();
  private world = new THREE.Scene();
  private overlay = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(34, 16 / 9, 0.3, 200);
  private gbuf = makeRT(960, 540, { pxScale: 1 });
  private ascii = new FSPass(ASCII_FRAG, {
    uG: { value: null }, uAtlas: { value: null }, uCell: { value: BASE_CELL }, uNG: { value: GLYPHS.length }, uNR: { value: RAMP.length },
    uEdgeGain: { value: 1 }, uTime: { value: 0 }, uGridOff: { value: new THREE.Vector2() },
    uPaper: { value: V(...hexToLinear(HEX.paper)) }, uBg: { value: V(...hexToLinear(HEX.bg)) }, uRed: { value: V(...hexToLinear(HEX.red)) },
  });
  private term = new Layer2D(1600, 800);
  private labels = new Layer2D(1600, 400);
  private panes: Pane[] = [];
  private letters: { mesh: THREE.Mesh; mat: THREE.RawShaderMaterial; ch: string; i: number; x: number }[] = [];
  private two!: THREE.Group;
  private berry!: THREE.Group;
  private berryA!: THREE.Group;
  private glass!: THREE.Group;
  private brim!: THREE.Mesh;
  private ticks: THREE.Mesh[] = [];
  private hands: THREE.Mesh[] = [];
  private labelMeshes: { mesh: THREE.Mesh; t0: number }[] = [];
  private T!: ReturnType<Ascii['anchors']>;

  private anchors() {
    const { lyrics: ly, audio: au, start, end } = this.ctx;
    const lead = ly.get('Watch it try', 0), l1 = ly.get("It can't count the R", 0), l2 = ly.get("It can't fill a glass of wine", 0);
    const l3 = ly.lines[l2.i + 1]!;
    const D = au.downbeats.filter((d) => d >= start - 0.02 && d <= end + 0.02);
    const beatsOf = (a: number, b: number) => au.beats.filter((x) => x >= a - 0.02 && x < b - 0.02);
    const kicks = au.events('kick', D[1]! + 0.1, D[2]! - 0.05).map((e) => e[0]);
    while (kicks.length < 3) kicks.push(lerp(D[1]!, D[2]!, 0.25 + kicks.length * 0.2));
    const bB = beatsOf(D[2]!, D[3]!);
    const kickMid = au.events('kick', (bB[2] ?? D[2]! + 0.7) + 0.05, (bB[3] ?? D[3]! - 0.35) - 0.05)[0]?.[0] ?? lerp(bB[2]!, bB[3]!, 0.5);
    const bG = beatsOf(D[4]!, D[5]!);
    const snE = au.events('snare', D[5]! + 0.1, end).map((e) => e[0]);
    const kE = au.events('kick', D[5]! + 0.1, end - 0.05).map((e) => e[0]);
    return {
      S: start, E: end, D, lead, l1, l2, l3, kicks: kicks.slice(0, 3),
      counts: [bB[1] ?? D[2]! + 0.35, bB[2] ?? D[2]! + 0.7, kickMid], tokens: bB[3] ?? D[2]! + 1.05,
      brim: bG[1] ?? D[4]! + 0.35, gap: bG[2] ?? D[4]! + 0.7,
      ticks: snE[snE.length - 1] ?? end - 0.35, hands: kE[kE.length - 1] ?? end - 0.15,
    };
  }

  override async init() {
    this.T = this.anchors();
    const T = this.T, D = T.D;
    const G = (o: Parameters<typeof gMaterial>[1]) => gMaterial(this.sh, o);
    this.ascii.u.uAtlas!.value = glyphAtlas();
    this.ascii.u.uG!.value = this.gbuf.texture;

    // the floor grid
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), G({ mode: 2 }));
    floor.position.set(10, 0, -40);
    this.world.add(floor);

    // hero: STRAWBERRY in extruded mono, split into its two tokens; the R's in signal red
    const word = extrudeWord('STRAWBERRY', MONO800, 3.3, 1.1, { bevel: 0.05 });
    const gap = 1.5;
    word.forEach((g, i) => {
      const red = g.ch === 'R';
      const mat = G({ sig: red ? 1 : 0, gain: 1.35 });
      const m = new THREE.Mesh(g.geo, mat);
      m.position.set(Z.S.x + g.x + (i >= 5 ? gap / 2 : -gap / 2), 0, Z.S.z);
      this.world.add(m);
      this.letters.push({ mesh: m, mat, ch: g.ch, i, x: m.position.x + g.w / 2 });
    });
    // the fruit, lying next to the Y
    this.berry = new THREE.Group();
    this.berry.add(new THREE.Mesh(strawberryBody(), G({ mode: 4, sig: 1, gain: 1.1 })), new THREE.Mesh(strawberryCalyx(), G({ gain: 1.0, side: THREE.DoubleSide })));
    this.berry.scale.setScalar(3.6);
    this.berry.position.set(Z.S.x + 14.2, 1.55, Z.S.z - 0.5);
    this.berry.rotation.set(0.3, -0.6, 1.3);
    this.world.add(this.berry);
    this.berryA = new THREE.Group();
    this.berryA.add(new THREE.Mesh(strawberryBody(), G({ mode: 4, sig: 1, gain: 1.15 })), new THREE.Mesh(strawberryCalyx(), G({ gain: 1.1, side: THREE.DoubleSide })));
    this.berryA.scale.setScalar(5.5);
    this.berryA.position.set(0.6, 3.9, -16);
    this.world.add(this.berryA);

    // the bot's answer as an object: a speech bubble with a big confident red "2"
    this.two = new THREE.Group();
    const bub = new THREE.Mesh(new THREE.ExtrudeGeometry(bubbleShape(6.4, 4.6, 0.8, 'left'), { depth: 0.7, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2, curveSegments: 10 }), G({ gain: 0.55 }));
    bub.position.z = -0.7;
    const two = extrudeWord('2', MONO800, 4.6, 0.9, { bevel: 0.06 })[0]!;
    two.geo.translate(-two.w / 2, -1.7, 0.9);
    const twoMesh = new THREE.Mesh(two.geo, G({ sig: 1, gain: 1.1 }));
    this.two.add(bub, twoMesh);
    this.two.position.set(Z.T.x, 3.3, Z.T.z);
    this.two.rotation.y = 0.12;
    this.world.add(this.two);

    // the wine glass, half full; a bright ring marks the brim
    this.glass = new THREE.Group();
    this.glass.add(new THREE.Mesh(wineGeometry(WINE_LEVEL), G({ sig: 1, gain: 0.95 })));
    this.glass.add(new THREE.Mesh(wineGlassGeometry(), G({ mode: 1, gain: 1.1, side: THREE.DoubleSide })));
    this.glass.scale.setScalar(GLASS_H);
    this.glass.position.set(Z.G.x, 0, Z.G.z);
    this.world.add(this.glass);
    this.brim = new THREE.Mesh(new THREE.TorusGeometry(GLASS.rimR * GLASS_H + 0.1, 0.07, 8, 96).rotateX(Math.PI / 2), G({ mode: 3, gain: 1.25 }));
    this.brim.position.set(Z.G.x, GLASS.rim * GLASS_H, Z.G.z);
    this.world.add(this.brim);
    // the clock hook on the floor round the glass: twelve ticks, then two hands at ten past ten
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, long = i % 3 === 0;
      const m = new THREE.Mesh(new THREE.BoxGeometry(long ? 0.6 : 0.4, 0.3, long ? 1.3 : 0.8), G({ mode: 3, gain: 1.0 }));
      m.position.set(Z.G.x + Math.sin(a) * 3.6, 0.15, Z.G.z - Math.cos(a) * 3.6);
      m.rotation.y = -a;
      this.world.add(m);
      this.ticks.push(m);
    }
    for (const [ang, len, wd] of [[(-2 + 10 / 60) / 12, 2.1, 0.5], [2 / 12, 3.0, 0.36]] as const) {
      const a = ang * Math.PI * 2;
      const m = new THREE.Mesh(new THREE.BoxGeometry(wd, 0.16, len).translate(0, 0, -len / 2), G({ mode: 3, sig: 1, gain: 1 }));
      m.position.set(Z.G.x, 0.12, Z.G.z);
      m.rotation.y = -a;
      this.world.add(m);
      this.hands.push(m);
    }

    // ---- the terminal windows (planes in the world, sampling one canvas layer) ----
    const TW = this.term.w, TH = this.term.h;
    const uvOf = (r: { x: number; y: number; w: number; h: number }) => new THREE.Vector4(r.x / TW, 1 - (r.y + r.h) / TH, r.w / TW, r.h / TH);
    const pane = (key: 'L' | 'C', p: V3, ry: number, rx: number, t0: number, t1: number, pop = true, flat = false, sc = 1) => {
      const r = REGION[key];
      const mat = planeMaterial(this.term.texture, uvOf(r));
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry((r.w / PX_PER_UNIT) * sc, (r.h / PX_PER_UNIT) * sc), mat);
      mesh.position.set(...p);
      mesh.rotation.set(flat ? -Math.PI / 2 : rx, ry, 0, 'YXZ');
      if (flat) mesh.rotation.set(-Math.PI / 2, 0, 0);
      this.overlay.add(mesh);
      this.panes.push({ mesh, mat, t0, t1, pop });
    };
    pane('L', [-1.2, 1.7, 2.6], 0.14, -0.08, -1, D[2]! + 0.1, false, false, 0.9);
    pane('C', [4.9, 2.5, -1.6], -0.3, -0.03, -1, D[2]! + 0.1, false, false, 0.72);
    // from the snap on, each shot opens its own windows, placed in the world between the camera and the
    // hero where that shot will see them (bottom: the sung line, big; top right: the chat)
    const anchored = (key: 'L' | 'C', tSee: number, t0: number, t1: number, fx: number, fy: number, frac: number, widthFrac: number, tilt: number) => {
      const o = this.camAt(tSee);
      const cam = new THREE.PerspectiveCamera(o.fov, 16 / 9, 0.1, 100);
      placeCamera(cam, o);
      cam.updateMatrixWorld();
      const d = o.dist * frac;
      const vh = 2 * d * Math.tan((o.fov * Math.PI) / 360), vw = vh * 16 / 9;
      const r = REGION[key];
      const w = vw * widthFrac, h = (w * r.h) / r.w;
      const mat = planeMaterial(this.term.texture, uvOf(r));
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      mesh.position.set(fx * vw * 0.5, fy * vh * 0.5, -d).applyMatrix4(cam.matrixWorld);
      mesh.quaternion.copy(cam.quaternion);
      mesh.rotateY(tilt); mesh.rotateX(-0.12);
      this.overlay.add(mesh);
      this.panes.push({ mesh, mat, t0, t1, pop: true });
    };
    anchored('L', D[2]! + 0.7, D[2]! - 0.02, D[3]!, 0.08, -0.52, 0.55, 0.7, 0.1);
    anchored('C', D[2]! + 0.7, D[2]! + 0.02, D[3]!, 0.5, 0.7, 0.62, 0.36, -0.2);
    anchored('L', D[3]! + 0.8, D[3]!, D[4]!, 0.08, -0.52, 0.5, 0.74, -0.1);
    anchored('C', D[3]! + 0.8, D[3]! + 0.04, D[4]!, 0.44, 0.48, 0.6, 0.4, -0.2);
    anchored('L', D[4]! + 0.7, D[4]! - 0.02, D[5]!, 0.1, -0.52, 0.5, 0.74, -0.1);
    anchored('C', D[4]! + 0.7, D[4]! + 0.02, D[5]!, 0.44, 0.48, 0.6, 0.4, -0.2);
    anchored('L', T.E - 0.3, D[5]! + 0.5, T.E + 1, 0.0, -0.55, 0.5, 0.74, 0.0);

    // ---- static labels (tokens, the count, the brim) ----
    this.drawLabels();
    const LW = this.labels.w, LH = this.labels.h;
    const label = (r: { x: number; y: number; w: number; h: number }, p: V3, ry: number, rx: number, t0: number, scale = 1) => {
      const mat = planeMaterial(this.labels.texture, new THREE.Vector4(r.x / LW, 1 - (r.y + r.h) / LH, r.w / LW, r.h / LH));
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry((r.w / PX_PER_UNIT) * scale, (r.h / PX_PER_UNIT) * scale), mat);
      mesh.position.set(...p);
      mesh.rotation.set(rx, ry, 0, 'YXZ');
      this.overlay.add(mesh);
      this.labelMeshes.push({ mesh, t0 });
    };
    const Lx = (i: number) => this.letters[i]!.x;
    label(LBL.straw, [(Lx(0) + Lx(4)) / 2, 0.1, Z.S.z + 1.9], 0, -1.1, T.tokens, 1.3);
    label(LBL.berry, [(Lx(5) + Lx(9)) / 2, 0.1, Z.S.z + 1.9], 0, -1.1, T.tokens + 0.07, 1.3);
    [2, 7, 8].forEach((li, k) => label(LBL.n[k]!, [Lx(li), 3.25, Z.S.z + 0.4], 0, 0, T.counts[k]!, k === 2 ? 1.5 : 1.1));
    label(LBL.brim, [Z.G.x - 3.1, GLASS.rim * GLASS_H, Z.G.z], 0.2, 0, T.brim, 1.2);
    label(LBL.wine, [Z.G.x - 3.0, WINE_LEVEL * GLASS_H, Z.G.z], 0.2, 0, T.gap, 1.1);
    label(LBL.gap, [Z.G.x - 2.6, (WINE_LEVEL + GLASS.rim) * 0.5 * GLASS_H, Z.G.z + 0.1], 0.2, 0, T.gap + 0.1, 1.1);
  }

  private drawLabels() {
    const c = this.labels.ctx;
    this.labels.clear();
    c.textBaseline = 'middle';
    const box = (r: { x: number; y: number; w: number; h: number }, text: string, col: string, size: number, frame?: string) => {
      if (frame) { c.strokeStyle = frame; c.lineWidth = 5; c.strokeRect(r.x + 6, r.y + 6, r.w - 12, r.h - 12); }
      c.fillStyle = col; c.font = font(F.mono(700), size); c.textAlign = 'center';
      c.fillText(text, r.x + r.w / 2, r.y + r.h / 2 + 2);
    };
    box(LBL.straw, '[straw]', TERM.paper, 70);
    box(LBL.berry, '[berry]', TERM.paper, 70);
    LBL.n.forEach((r, i) => box(r, String(i + 1), TERM.red, 84, TERM.red));
    box(LBL.brim, 'brim →', TERM.paper, 60);
    box(LBL.wine, 'wine →', TERM.red, 56);
    box(LBL.gap, 'gap', TERM.red, 50);
    c.fillStyle = TERM.red;
    c.fillRect(LBL.gap.x + LBL.gap.w - 16, LBL.gap.y + 8, 8, LBL.gap.h - 16);
    c.textAlign = 'left';
    this.labels.upload();
  }

  // ---------------------------------------------------------------- the terminals

  private drawTerminals(t: number, beatOn: boolean) {
    const T = this.T, D = T.D, K = T.kicks;
    const c = this.term.ctx;
    this.term.clear();
    // the narrator's shell: each sung line typed at a prompt
    const lyricLines = [T.lead, T.l1, T.l2, T.l3].filter((l) => l.start <= t + 0.02);
    const rows = lyricLines.map((l, i) => {
      const s = typedLine(l, t);
      const segs: { s: string; col: string }[] = [{ s: '~ $ ', col: TERM.dim }];
      // the R's of the strawberry line in signal red
      const redR = l === T.l1;
      let run = '';
      for (const ch of s) {
        if (redR && (ch === 'r' || ch === 'R')) { if (run) segs.push({ s: run, col: TERM.paper }); run = ''; segs.push({ s: ch, col: TERM.red }); }
        else run += ch;
      }
      if (run) segs.push({ s: run, col: TERM.paper });
      const cur = i === lyricLines.length - 1;
      return { segs, caret: cur, dim: !cur };
    });
    drawWindow(c, REGION.L, 'narrator@desk: ~/tests \u2014 sh', rows.slice(-2), { size: 74, beatOn, indent: 4 });

    // the chatbot session
    const chat: { segs: { s: string; col: string; box?: string }[]; caret?: boolean }[] = [];
    const q = 'how many r\'s in "strawberry"?';
    const q1 = typedPlain(q, t, T.S + 0.1, D[1]! - 0.2, 3);
    chat.push({ segs: [{ s: '> ', col: TERM.dim }, { s: q1, col: TERM.paper }], caret: t < K[0]! });
    if (t >= K[0]! && t < D[2]! + 0.05) {
      const spin = '|/-\\';
      const n = this.ctx.audio.beatAt(t) * 2;
      chat.push({ segs: [{ s: '  thinking ', col: TERM.dim }, { s: spin[Math.floor(n) % 4]!, col: TERM.paper }, { s: ' ' + '.'.repeat(1 + K.filter((k) => t >= k).length), col: TERM.dim }] });
    }
    const stream = (toks: string[], t0: number, t1: number, redTok: string) => {
      const n = Math.floor(clamp((t - t0) / (t1 - t0)) * toks.length + 1e-6);
      return toks.slice(0, n).map((s, i) => { const hot = s.trim() === redTok; return { s, col: hot ? '#FF5A4E' : TERM.paper, box: hot ? 'rgba(229,50,45,0.28)' : i % 2 ? 'rgba(237,230,214,0.08)' : 'rgba(237,230,214,0.17)' }; });
    };
    const r1 = ['There', ' are', ' 2', ' R', "'s", ' in', ' "', 'straw', 'berry', '".'];
    if (t >= D[2]! + 0.05) chat.push({ segs: stream(r1, D[2]! + 0.05, D[2]! + 0.8, '2') });
    if (t >= T.tokens) {
      const u = prog(t, T.tokens, T.tokens + 0.2);
      chat.push({ segs: [{ s: '  sees: ', col: TERM.dim }, { s: 'straw', col: TERM.paper, box: 'rgba(229,50,45,0.35)' }, { s: ' + ', col: TERM.dim }, { s: 'berry', col: TERM.paper, box: 'rgba(229,50,45,0.35)' }].slice(0, u > 0.99 ? 4 : u > 0.5 ? 2 : 1) });
    }
    const p2 = 'a wine glass filled to the brim';
    if (t >= D[3]! + 0.05) chat.push({ segs: [{ s: '> ', col: TERM.dim }, { s: typedPlain(p2, t, D[3]! + 0.05, D[4]! - 0.3, 5), col: TERM.paper }], caret: t < D[4]! - 0.2 });
    const r2 = ['Here', "'s", ' a', ' wine', ' glass', ' filled', ' to', ' the', ' brim', '!'];
    if (t >= D[4]! + 0.05) chat.push({ segs: stream(r2, D[4]! + 0.05, D[4]! + 0.75, '') });
    drawWindow(c, REGION.C, 'chatbot', chat, { size: 56, beatOn, indent: 2 });
    this.term.upload();
  }

  // ---------------------------------------------------------------- animation

  private animate(t: number) {
    const T = this.T, D = T.D;
    // the counted R's light up and hop; the letters jolt on the snap
    for (const l of this.letters) {
      const k = [2, 7, 8].indexOf(l.i);
      const tc = k >= 0 ? T.counts[k]! : 1e9;
      const hop = t < tc ? 0 : Math.exp(-(t - tc) * 7) * Math.sin(Math.min(Math.PI, (t - tc) * 16));
      const snap = t < D[2]! ? 0 : pulse(t, D[2]! + 0.1, 0.1) * (0.5 + 0.5 * Math.sin(l.i * 2.1));
      l.mesh.position.y = hop * 0.7 + snap * 0.5;
      l.mat.uniforms.uFlash!.value = k >= 0 ? 0.5 * pulse(t, tc, 0.12) : 0;
    }
    this.berry.rotation.y = -0.6 + 0.25 * Math.sin(t * 0.9);
    this.berryA.rotation.set(0.25 + 0.1 * Math.sin(t * 0.7), t * 0.8, 0.15);
    this.berryA.visible = t < D[2]! + 0.12; // the crash flies through it
    // the "2" slams up on the cut
    const s2 = t < D[3]! - 0.02 ? 0 : springStep(t - D[3]! + 0.02, 3.4, 0.4);
    this.two.scale.setScalar(Math.max(1e-3, s2));
    this.two.rotation.y = 0.12 + 0.18 * Math.sin((t - D[3]!) * 1.4) * (t > D[3]! ? 1 : 0);
    // the brim ring and the clock
    const rg = t < T.brim ? 0 : springStep(t - T.brim, 4, 0.4);
    this.brim.scale.setScalar(Math.max(1e-3, rg));
    this.brim.visible = rg > 1e-3;
    this.glass.rotation.y = t * 0.3;
    this.ticks.forEach((m, i) => { const s = t < T.ticks + i * 0.012 ? 0 : springStep(t - T.ticks - i * 0.012, 5, 0.45); m.scale.setScalar(Math.max(1e-3, s)); m.visible = s > 1e-3; });
    this.hands.forEach((m) => { const s = t < T.hands ? 0 : springStep(t - T.hands, 5, 0.45); m.scale.set(1, 1, Math.max(1e-3, s)); m.visible = s > 1e-3; });
    // windows open with a pop (a new window on the shot's first beat); labels likewise
    for (const p of this.panes) {
      const on = t >= p.t0 && t < p.t1;
      p.mesh.visible = on;
      const s = !p.pop ? 1 : springStep(t - p.t0, 4.5, 0.5);
      p.mesh.scale.set(Math.max(1e-3, s), Math.max(1e-3, Math.min(1.2, s * 1.1)), 1);
    }
    for (const l of this.labelMeshes) {
      const s = t < l.t0 ? 0 : springStep(t - l.t0, 5, 0.45);
      l.mesh.visible = s > 1e-3;
      l.mesh.scale.setScalar(Math.max(1e-3, s));
    }
  }

  /** Cell height: pulses on kicks; on the fill the cells grow with each kick (the wind-up), snapping back on the downbeat. */
  private cellAt(t: number, kick: number) {
    const T = this.T, D = T.D, K = T.kicks;
    let s = 1 + 0.22 * kick;
    if (t >= K[0]! && t < D[2]!) {
      let w = 0;
      K.forEach((k, i) => { if (t >= k) w = Math.max(w, (i + 1) * 0.26 * springStep(t - k, 5, 0.5)); });
      s += w;
    }
    if (t >= D[2]!) s += 1.0 * Math.exp(-(t - D[2]!) * 14);
    return BASE_CELL * s;
  }

  // ---------------------------------------------------------------- camera

  private camAt(t: number): Orbit {
    const T = this.T, D = T.D, K = T.kicks;
    const nudge = (a: number, b: number) => {
      let n = 0;
      for (const bt of this.ctx.audio.beats) if (bt > a + 0.05 && bt < b - 0.05 && t >= bt) n += 1 - Math.pow(0.5, (t - bt) / 0.07);
      return n;
    };
    if (t < D[1]!) {
      // A1: drift in on the two windows; the text world waits behind them
      const u = ease.inOutCubic(prog(t, D[0]! - 0.3, D[1]!));
      const r = mix(orbit([0.4, 2.6, -0.2], 0.06, 0.1, 11.5, 36, -0.02), orbit([0.0, 2.5, 0.0], -0.1, 0.07, 9.8, 36, 0.01), u);
      r.dist -= 0.4 * nudge(D[0]!, D[1]!);
      return r;
    }
    if (t < D[2]! - 0.03) {
      // A2: on the shell's held "thing!", then three kicks, three steps back
      const steps = [
        orbit([-1.8, 2.2, 0.6], 0.36, 0.06, 7.6, 36, 0),
        orbit([-1.2, 2.3, 0.4], 0.26, 0.13, 8.6, 40, 0.03),
        orbit([-0.6, 2.4, 0.2], 0.16, 0.2, 9.6, 44, 0.06),
        orbit([0.0, 2.5, 0.0], 0.06, 0.27, 10.4, 48, 0.09),
      ];
      let r = mix(steps[0]!, steps[0]!, 0);
      r.dist -= 0.8 * prog(t, D[1]!, K[0]!, ease.outQuad);
      K.forEach((k, i) => { r = mix(r, steps[i + 1]!, t < k ? 0 : springStep(t - k, 4.2, 0.62)); });
      r.dist += 0.5 * prog(t, K[2]!, D[2]!);
      return r;
    }
    if (t < D[3]!) {
      // B: SNAP: crash through the windows into the text world, then glide along STRAW | BERRY
      const prev = this.camAt(D[2]! - 0.031);
      const u = ease.outExpo(prog(t, D[2]! - 0.03, D[2]! + 0.28));
      const tr = ease.inOutQuad(prog(t, D[2]! + 0.15, D[3]!));
      const b = mix(orbit([Z.S.x - 1.2, 1.2, Z.S.z + 1.0], -0.14, 0.15, 15.5, 40, -0.01), orbit([Z.S.x + 1.6, 1.3, Z.S.z + 1.0], 0.1, 0.18, 14.5, 40, 0.01), tr);
      b.dist -= 0.35 * nudge(D[2]! + 0.15, D[3]!);
      return mix(prev, b, u);
    }
    if (t < D[4]! - 0.05) {
      // C: cut to the confident red "2", then pull back as prompt 2 is typed
      const k0 = orbit([Z.T.x, 3.0, Z.T.z + 0.5], -0.34, 0.06, 8.5, 36, 0.03);
      const k1 = orbit([Z.T.x + 2.0, 2.9, Z.T.z + 1.2], -0.12, 0.1, 15.5, 36, 0);
      const tm = D[3]! + 0.6;
      const r = t < tm ? mix(k0, k1, ease.outQuart(prog(t, D[3]!, tm))) : mix(k1, orbit([Z.T.x + 2.8, 2.9, Z.T.z + 1.2], 0.1, 0.12, 16.5, 36, -0.02), ease.inOutCubic(prog(t, tm, D[4]! - 0.05)));
      r.dist -= 0.3 * nudge(D[3]! + 0.1, D[4]!);
      return r;
    }
    if (t < D[5]!) {
      // D: whip to the glass on "glass", crane up it
      const prev = this.camAt(D[4]! - 0.051);
      const u = ease.outExpo(prog(t, D[4]! - 0.05, D[4]! + 0.26));
      const cr = ease.inOutQuad(prog(t, D[4]! + 0.1, D[5]!));
      const g = mix(orbit([Z.G.x + 1.6, 2.6, Z.G.z + 1.2], -0.3, 0.14, 15.5, 36, -0.02), orbit([Z.G.x + 1.8, 2.6, Z.G.z + 1.0], -0.06, 0.34, 14.5, 36, 0), cr);
      g.dist -= 0.3 * nudge(D[4]! + 0.1, D[5]!);
      return mix(prev, g, u);
    }
    // E: crane over into the rim: a circle ringed by ticks (the next line's clock)
    const prev = this.camAt(D[5]! - 0.001);
    const u = ease.inOutCubic(prog(t, D[5]! - 0.05, D[5]! + 0.6));
    const e = prog(t, D[5]! + 0.6, T.E);
    return mix(prev, orbit([Z.G.x, 0, Z.G.z + 1.3], -0.05 - 0.25 * ease.inOutQuad(e), Math.PI / 2 - 0.001, lerp(18.5, 16, e), 36, 0), u);
  }

  // ---------------------------------------------------------------- render

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t;
    this.animate(t);
    const beatOn = ((this.ctx.audio.beatAt(t) % 1) + 1) % 1 < 0.55;
    this.drawTerminals(t, beatOn);

    const o = this.camAt(t);
    placeCamera(this.cam, o);
    this.cam.updateProjectionMatrix();
    this.cam.updateMatrixWorld();
    this.sh.cam.value.copy(this.cam.position);

    // the world → G-buffer
    clearRT(renderer, this.gbuf, [0, 0, 1], 0);
    renderer.setRenderTarget(this.gbuf);
    renderer.render(this.world, this.cam);

    // cells → glyphs
    const u = this.ascii.u;
    const cell = this.cellAt(t, f.a.kick);
    u.uCell!.value = cell;
    u.uTime!.value = t;
    this.ascii.render(renderer, out);

    // the windows and labels, crisp, in the same camera
    renderer.setRenderTarget(out);
    renderer.render(this.overlay, this.cam);
    void frameIdx; void plain;
    return { bloom: 0.35, bloomThreshold: 0.75, halation: 0.12, ca: 0.6, grain: 0.035, vignette: 0.3 };
  }
}

// label regions in the labels layer
const LBL = {
  straw: { x: 0, y: 0, w: 380, h: 110 },
  berry: { x: 400, y: 0, w: 380, h: 110 },
  n: [0, 1, 2].map((i) => ({ x: 800 + i * 130, y: 0, w: 120, h: 120 })),
  brim: { x: 0, y: 140, w: 360, h: 90 },
  wine: { x: 380, y: 140, w: 360, h: 90 },
  gap: { x: 760, y: 140, w: 200, h: 90 },
};

const orbit = (tgt: V3, az: number, el: number, dist: number, fov: number, roll: number): Orbit => ({ tgt: V(...tgt), az, el, dist, fov, roll });
const mix = (a: Orbit, b: Orbit, u: number): Orbit => ({
  tgt: a.tgt.clone().lerp(b.tgt, u), az: lerp(a.az, b.az, u), el: lerp(a.el, b.el, u), dist: lerp(a.dist, b.dist, u), fov: lerp(a.fov, b.fov, u), roll: lerp(a.roll, b.roll, u),
});
function placeCamera(cam: THREE.PerspectiveCamera, o: Orbit) {
  const ce = Math.cos(o.el), se = Math.sin(o.el), sa = Math.sin(o.az), ca = Math.cos(o.az);
  cam.position.set(o.tgt.x + o.dist * ce * sa, o.tgt.y + o.dist * se, o.tgt.z + o.dist * ce * ca);
  cam.up.set(-se * sa, ce, -se * ca);
  cam.fov = o.fov;
  cam.aspect = 16 / 9;
  cam.lookAt(o.tgt);
  cam.rotateZ(o.roll);
}
