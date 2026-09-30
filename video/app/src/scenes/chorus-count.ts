// chorus-count: the chorus's strawberry-and-wine-glass cutscene (docs/TREATMENT.md rows #6, #13, #19).
//   {v: 1}       38.76-48.49  "…slop machine," tail, "Watch it try…", the kick-fill wind-up, STRAWBERRY with its three
//                             R's counted, the bot's confident "2", straw|berry tokens, the half-full glass, BRIM/GAP.
//   {v: 2}       as v1 with the irony growing: the reply flickers "3" for two frames before "2", the glass a little
//                             fuller, the bot's badge v3.0, DEV doesn't look.
//   {v: 'final'} the mirror: the bot (v5.0) counts 1-2-3 and answers "There are 3 R's" in fix green, the third R
//                             lights up; the glass fills to the brim, overflows and the wine runs down DEV's back.
// Lyric idiom: the DEV dialogue window hung in the world typing per character (held notes wave) + 3D block titles
// dropping in on the hits.
import * as THREE from 'three';
import type { Frame } from '../engine/scene';
import type { Line, Word } from '../engine/lyrics';
import { clamp, lerp, ease, keys, springStep, hash, prog, frameIdx, type Key } from '../engine/util';
import { Ps1Stage, type CamState, type V3, type Hang, uiBox, uiTab, uiNext, uiPortrait, typeWords } from '../ps1/stage';
import { makeRoom, makeDev, makeBotHead, type Room, type Dev, type BotHead } from '../ps1/cast';
import { pixText, ADV, psMat, psGlobals } from '../ps1/gfx';
import { P } from '../ps1/palette';
import { makeStrawberry, makeWineGlass, type WineGlass } from './chorus-count-props';

const LYR_W = 240, LYR_H = 64, CHAT_W = 188, CHAT_H = 52;
type Title = { root: THREE.Group; letters: THREE.Object3D[]; width: number };
type Seg = [number, number, Hang];

export default class ChorusCount extends Ps1Stage {
  v: 1 | 2 | 'final' = 1;
  room!: Room; dev!: Dev; bot!: BotHead;
  berry = new THREE.Group(); berryShadow!: THREE.Mesh;
  glass!: WineGlass;
  goo!: Title;
  titles: Record<string, Title> = {};
  labels: Record<string, THREE.Mesh> = {};
  dust!: ReturnType<Ps1Stage['dustBurst']>;
  lyricP = this.panel(LYR_W, LYR_H);
  chatP = this.panel(CHAT_W, CHAT_H);
  spill: THREE.Mesh[] = [];
  clockDrips: THREE.Mesh[] = [];
  // anchors (all from the data)
  L0!: Line; L1!: Line; L2!: Line; tail: Line | null = null;
  d: number[] = []; // v1/v2: [pre, d0, d1, d2 (R's downbeat), d3, d4, d5, end]; final: [f0, f1, f2, f3, end]
  kicks: number[] = [];
  countT: number[] = [];
  tokenT = 0;

  override async init() {
    const { audio: au, lyrics: ly, start, end, params } = this.ctx;
    this.v = params.v === 'final' ? 'final' : params.v === 2 ? 2 : 1;
    const db = au.downbeats.filter((x) => x >= start - 0.02 && x <= end + 0.02);
    if (this.v === 'final') {
      this.L1 = ly.get('Now it always finds', 0);
      this.L2 = ly.get('Now the wine drips', 0);
      this.L0 = this.L1;
      this.d = [start, ...db.filter((x) => x > start + 0.1 && x < end - 0.1), end];
      while (this.d.length < 5) this.d.splice(this.d.length - 1, 0, (this.d[this.d.length - 2]! + this.d[this.d.length - 1]!) / 2);
      const miss = this.L1.words[5]!; // "missing" (held)
      this.countT = [0, 1, 2].map((i) => lerp(miss.start + 0.05, miss.end - 0.2, i / 2));
    } else {
      const nth = this.v === 2 ? 1 : 0;
      this.L0 = ly.get('Watch it try', nth);
      this.L1 = ly.get("It can't count the R", nth);
      this.L2 = ly.get("It can't fill a glass of wine", nth);
      this.tail = ly.find("it's a slop machine")[nth] ?? null;
      const rs = this.L1.words[4]!.start;
      let c = 0;
      db.forEach((x, i) => { if (Math.abs(x - rs) < Math.abs(db[c]! - rs)) c = i; });
      this.d = [start, db[c - 2] ?? start + 1.39, db[c - 1] ?? start + 2.78, db[c] ?? rs, db[c + 1] ?? rs + 1.39, db[c + 2] ?? rs + 2.78, db[c + 3] ?? rs + 4.17, end];
      const k = au.events('kick', this.d[2]! + 0.1, this.d[3]! - 0.1).map((e) => e[0]);
      this.kicks = k.length >= 3 ? k.slice(-3) : [this.d[3]! - 1.0, this.d[3]! - 0.85, this.d[3]! - 0.7];
      const straw = this.L1.words[6]!;
      const b0 = Math.ceil(au.beatAt(straw.start + 0.05));
      this.countT = [0, 0.5, 1].map((x) => au.timeOfBeat(b0 + x));
      this.tokenT = au.timeOfBeat(b0 + 1.5);
    }
    const version = this.v === 'final' ? 'v5.0' : this.v === 2 ? 'v3.0' : 'v1.0';

    this.room = makeRoom(); this.world.add(this.room.root);
    this.dev = makeDev(); this.dev.sit(true); this.dev.root.position.copy(this.room.seat); this.world.add(this.dev.root);
    this.bot = makeBotHead(version); this.bot.root.scale.setScalar(1.5); this.world.add(this.bot.root);
    this.berry = makeStrawberry(); this.world.add(this.berry);
    this.berryShadow = new THREE.Mesh(new THREE.CircleGeometry(1, 10), psMat({ color: '#000000', opacity: 0.45, unlit: true }));
    this.berryShadow.rotation.x = -Math.PI / 2; this.world.add(this.berryShadow);
    this.glass = makeWineGlass(); this.world.add(this.glass.root);
    this.dust = this.dustBurst(16);
    const goo = this.v === 2 ? [P.fail, P.failSide] : ['#A8B04A', '#5E6A22'];
    this.goo = this.blockTitle('SLOP MACHINE,', { cap: goo[0], side: goo[1], tracking: 0.06 });
    const green = this.v === 'final';
    this.titles.rs = this.blockTitle("R'S", { capAt: (i) => (i === 0 ? [P.fail, P.failSide] : null) });
    this.titles.straw = this.blockTitle('STRAWBERRY', { capAt: (_i, ch) => (ch === 'R' ? (green ? [P.fix, P.fixSide] : [P.fail, P.failSide]) : null) });
    this.titles.glass = this.blockTitle('GLASS');
    this.titles.wine = this.blockTitle('WINE');
    const n = (s: string) => this.label(s, P.ink, green ? P.fix : P.title, 2);
    this.labels.n1 = n(green ? '1✓' : '1'); this.labels.n2 = n(green ? '2✓' : '2'); this.labels.n3 = n(green ? '3✓' : '3');
    this.labels.straw = this.label('straw', P.uiLine, P.uiNavy, 1);
    this.labels.berry = this.label('berry', P.uiLine, P.uiNavy, 1);
    this.labels.tokens = this.label('the model sees 2 tokens', P.key2, P.fog, 1);
    this.labels.brim = this.label('BRIM', P.ink, P.title, 2);
    this.labels.brimOk = this.label('BRIM ✓', P.ink, P.fix, 2);
    this.labels.gap = this.label('GAP!', P.uiLine, '#C8283F', 2);
    this.labels.half = this.label('half full', P.uiLine, P.fog, 1);
    this.labels.fixed = this.label('3 R\'s ✓', P.ink, P.fix, 2);
    // the final chorus: wine running from the rim down DEV's back, and drips on the wall clock
    const wineM = psMat({ color: '#B0203A', emit: '#200006' });
    for (let i = 0; i < 9; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1, 0.09), wineM); s.visible = false; this.spill.push(s); this.world.add(s); }
    for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.022, 1, 0.01), wineM); s.visible = false; this.clockDrips.push(s); this.world.add(s); }
  }

  // ================================================================== camera (a pure function of t)
  camAt(t: number): CamState {
    return this.v === 'final' ? this.camFinal(t) : this.v === 2 ? this.camChorus2(t) : this.camChorus(t);
  }

  private kv(t: number, ks: [number, V3, ((x: number) => number)?][]): V3 {
    return [0, 1, 2].map((i) => keys(t, ks.map(([tt, v, e]) => [tt, v[i]!, e] as Key))) as V3;
  }

  private camChorus(t: number): CamState {
    const [pre, d0, d1, d2, d3, d4, d5, d6] = this.d as [number, number, number, number, number, number, number, number];
    const [k1, k2, k3] = this.kicks as [number, number, number];
    const mix3 = (a: V3, b: V3, u: number): V3 => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
    if (t < d0) {
      // the goo word slides in along the desk; then up and over to DEV starting to type
      return {
        P: this.kv(t, [[pre, [1.45, 1.05, -1.7]], [pre + 0.8, [1.2, 1.08, -1.72], ease.outCubic], [d0, [0.95, 1.5, -1.45], ease.inOutCubic]]),
        T: this.kv(t, [[pre, [0.75, 0.88, -2.86]], [pre + 0.8, [0.58, 0.88, -2.86], ease.outCubic], [d0, [0.1, 1.05, -3.1], ease.inOutCubic]]),
        roll: keys(t, [[pre, 0.1], [d0, -0.04]]), fov: 48,
      };
    }
    if (t < d1) {
      return {
        P: this.kv(t, [[d0, [1.9, 2.2, 0.4]], [d0 + 0.7, [0.2, 1.8, -0.9], ease.inOutCubic], [d1, [-0.62, 1.52, -1.9], ease.inOutCubic]]),
        T: this.kv(t, [[d0, [0.0, 1.1, -2.9]], [d1, [0.0, 1.12, -3.25], ease.inOutCubic]]),
        roll: keys(t, [[d0, -0.08], [d1, 0.03]]), fov: 52,
      };
    }
    if (t < d2) {
      // the fill: three stepped push-ins onto the monitor, one per kick; then pull back and look up (hold the breath)
      const screen: V3 = [0, 1.08, -3.2];
      const dir = new THREE.Vector3(-0.62, 0.22, 1).normalize();
      const step = (k: number) => prog(t, k, k + 0.09, ease.outExpo);
      const dist = 1.75 - 0.36 * (step(k1) + step(k2) + step(k3)) - 0.1 * prog(t, d1, k1, ease.outCubic);
      const Pn: V3 = [screen[0] + dir.x * dist, screen[1] + dir.y * dist, screen[2] + dir.z * dist];
      const look = prog(t, this.L1.start - 0.05, d2, ease.inOutCubic);
      return { P: mix3(Pn, [-1.3, 1.25, -0.9], look), T: mix3(screen, [0.0, 4.0, 0.4], look), roll: -0.03 * (step(k1) - step(k2) + step(k3)) - 0.12 * look, fov: 50 + 8 * look };
    }
    if (t < d3) {
      const wS = this.L1.words[6]!;
      return {
        P: this.kv(t, [[d2, [0.4, 2.2, 10.5]], [d2 + 0.3, [0.0, 1.6, 7.0], ease.outExpo], [wS.start, [-0.5, 1.2, 6.6], ease.inOutCubic], [d3, [0.7, 1.0, 6.1], ease.inOutCubic]]),
        T: this.kv(t, [[d2, [0, 1.3, 0.6]], [wS.start, [0, 1.35, 1.5]], [d3, [0.3, 1.3, 2.0], ease.inOutCubic]]),
        roll: 0.12 * (1 - springStep(t - d2, 2, 0.5)), fov: 52,
      };
    }
    if (t < d4) {
      // the CRT's answer, the smug face, then out wide over the room where the glass will stand
      const toFace = prog(t, d3 + 0.33, d3 + 0.55, ease.inOutCubic);
      const Pscr: V3 = [0.55, 1.2, -2.75], Tscr: V3 = [0.02, 1.1, -3.2];
      const Pfac: V3 = [0.5, 1.5, -3.25], Tfac: V3 = [0.0, 1.33, -2.44];
      const punch = 1 - ease.outExpo(prog(t, d3, d3 + 0.3));
      let Pp = mix3(mix3(Pscr, Tscr, -0.6 * punch), Pfac, toFace);
      let Tt = mix3(Tscr, Tfac, toFace);
      const wide = prog(t, this.L2.start + 0.1, d4, ease.inOutCubic);
      Pp = [lerp(Pp[0], 3.2, ease.outCubic(wide)), lerp(Pp[1], 2.4, wide), lerp(Pp[2], 4.8, ease.inQuad(wide))];
      Tt = mix3(Tt, [0, 1.2, 0.3], wide);
      return { P: Pp, T: Tt, roll: 0.05 * Math.sin(toFace * Math.PI) - 0.06 * wide, fov: 48 + 8 * wide };
    }
    const gy = this.glassY(t);
    if (t < d5) {
      const orb = keys(t, [[d4, -0.9], [d4 + 0.35, -0.35, ease.outExpo], [d5, 0.25, ease.inOutCubic]]);
      const r = keys(t, [[d4, 6.8], [d4 + 0.35, 4.8, ease.outExpo], [d5, 4.1]]);
      return {
        P: [Math.sin(orb) * r, keys(t, [[d4, 0.6], [d4 + 0.35, 1.7, ease.outExpo], [d5, 2.0]]), 0.3 + Math.cos(orb) * r],
        T: [0, keys(t, [[d4, 1.2], [d4 + 0.35, 1.9, ease.outExpo], [d5, 2.1]]), 0.2],
        roll: 0.06 * Math.sin(orb * 2), fov: 52,
      };
    }
    // low and close on the gap, then craning up until the rim is a circle (it becomes the next scene's clock face)
    const le = this.L2.words[6]!.end;
    const up = prog(t, le + 0.05, d6 - 0.1, ease.inOutCubic);
    const gyR = gy + this.glass.rimY;
    const Pc = this.kv(t, [[d5, [1.5, gy + 1.5, 3.9]], [le + 0.05, [1.1, gy + 1.55, 3.4], ease.outCubic]]);
    return { P: mix3(Pc, [0.0, gyR + 2.3, 0.56], up), T: mix3([0.55, gy + 1.4, 0.3], [0, gyR, 0.55], up), roll: 0.08 * (1 - up), fov: 46 };
  }

  /**
   * Chorus 2: the same beats restaged with a different choreography: a top-down crane onto the goo, the CRT's
   * POV on DEV typing, a top-down "map" fill with dutch-angle steps, the strawberry drop and its titles from a
   * worm's-eye orbit (the other way round), DEV turned away from the answer, the glass rising from floor level.
   */
  private camChorus2(t: number): CamState {
    const [pre, d0, d1, d2, d3, d4, d5, d6] = this.d as [number, number, number, number, number, number, number, number];
    const [k1, k2, k3] = this.kicks as [number, number, number];
    const mix3 = (a: V3, b: V3, u: number): V3 => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
    if (t < d0) {
      // straight down onto the desk, craning in as the red goo letters rain onto it
      const u = prog(t, pre, d0, ease.inOutCubic);
      return { P: mix3([0.55, 2.3, -2.65], [0.6, 1.55, -2.45], u), T: [0.55, 0.8, -2.9], up: [0, 0, -1], roll: 0.25 - 0.35 * u, fov: 50 };
    }
    if (t < d1) {
      // the CRT's point of view: DEV's face over the keyboard, typing at us; then round to his left
      const u = prog(t, d0, d0 + 0.8, ease.outCubic), side = prog(t, d0 + 0.8, d1, ease.inOutCubic);
      const Pc: V3 = mix3([0.05, 1.12, -3.15], [-0.1, 1.22, -3.1], u);
      return { P: mix3(Pc, [-1.35, 1.55, -2.55], side), T: mix3([0.0, 1.3, -2.42], [0.1, 1.1, -3.1], side), roll: lerp(0.06, -0.08, side), fov: lerp(64, 56, side) };
    }
    if (t < d2) {
      // the fill as a map: top-down on the desk, one stepped crash-zoom and dutch roll per kick; then a whip down to
      // the floor looking up at the strawberry coming out of the dark
      const step = (k: number) => prog(t, k, k + 0.08, ease.outExpo);
      const n = step(k1) + step(k2) + step(k3);
      const h = 4.2 - 0.85 * n;
      const look = prog(t, this.L1.start - 0.05, d2 - 0.04, ease.inOutCubic);
      return {
        P: mix3([0.0, h, -2.75], [1.25, 0.25, 2.8], look), T: mix3([0.0, 0.8, -2.9], [0.0, 4.2, 0.6], look),
        up: look < 0.5 ? [0, 0, -1] : undefined, roll: 0.14 * n * (1 - look) - 0.1 * look, fov: 52 + 6 * look,
      };
    }
    if (t < d3) {
      // worm's-eye orbit round the landed strawberry, clockwise this time, rising as the word arrives
      const a = keys(t, [[d2, -0.55], [d3, 0.45, ease.inOutCubic]]);
      const r = keys(t, [[d2, 7.5], [d2 + 0.25, 5.2, ease.outExpo], [d3, 4.8]]);
      const y = keys(t, [[d2, 0.3], [this.L1.words[6]!.start, 0.45], [d3, 1.2, ease.inOutCubic]]);
      return { P: [Math.sin(a) * r, y, 1.4 + Math.cos(a) * r], T: [0, keys(t, [[d2, 1.9], [d3, 1.5]]), 1.6], roll: -0.1 * (1 - springStep(t - d2, 2, 0.5)), fov: 56 };
    }
    if (t < d4) {
      // the answer arrives behind DEV's back: he has turned round laughing, the screen glows over his shoulder
      const u = prog(t, d3, this.L2.start + 0.1, ease.outCubic);
      const wide = prog(t, this.L2.start + 0.1, d4, ease.inOutCubic);
      const Pn = mix3([-0.2, 1.35, -1.55], [0.35, 1.45, -1.7], u);
      return { P: mix3(Pn, [-3.0, 2.6, 4.4], ease.inQuad(wide)), T: mix3([0.1, 1.25, -2.9], [0, 1.2, 0.3], wide), roll: 0.12 - 0.2 * wide, fov: 50 + 6 * wide };
    }
    const gy = this.glassY(t);
    if (t < d5) {
      // from the floor: the glass rises past the lens; crane up with it
      const u = prog(t, d4, d5, ease.outCubic);
      return { P: [lerp(-1.9, -2.4, u), lerp(0.12, 1.4, u), lerp(2.4, 3.6, u)], T: [0, lerp(2.4, 2.0, u), 0.3], roll: lerp(-0.12, 0.02, u), fov: 58 };
    }
    // close on the gap from the left, then the same crane to the rim circle (the hand-off to the clocks)
    const le = this.L2.words[6]!.end;
    const up = prog(t, le + 0.05, d6 - 0.1, ease.inOutCubic);
    const gyR = gy + this.glass.rimY;
    const Pc = this.kv(t, [[d5, [-1.6, gy + 1.45, 3.7]], [le + 0.05, [-1.2, gy + 1.55, 3.3], ease.outCubic]]);
    return { P: mix3(Pc, [0.0, gyR + 2.3, 0.56], up), T: mix3([0.35, gy + 1.4, 0.3], [0, gyR, 0.55], up), roll: -0.08 * (1 - up), fov: 46 };
  }

  /** The glass rises out of the floor like an item reveal on the "glass" downbeat. */
  private glassY(t: number) { return lerp(-2.2, 0.6, clamp(springStep(t - this.d[5]!, 2.4, 0.5), 0, 1.1)); }

  // ================================================================== per-frame
  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    this.begin();
    for (const k in this.titles) this.titles[k]!.root.visible = false;
    for (const k in this.labels) this.labels[k]!.visible = false;
    this.berry.visible = false; this.berryShadow.visible = false; this.glass.root.visible = false; this.bot.root.visible = false;
    this.goo.root.visible = false; this.glass.bracket.visible = false;
    for (const s of [...this.spill, ...this.clockDrips]) s.visible = false;
    this.dev.root.visible = true; this.room.chair.visible = true; this.dev.sit(true);
    if (this.v === 'final') this.animFinal(f.t); else this.animChorus(f.t);
    this.drawScreen(f.t);
    this.drawPanels(f.t);
    return this.present(f, out);
  }

  private animChorus(t: number) {
    const [pre, d0, d1, d2, d3, d4, d5, d6] = this.d as [number, number, number, number, number, number, number, number];
    const [k1, k2, k3] = this.kicks as [number, number, number];
    const kstep = (k: number) => prog(t, k, k + 0.08, ease.outExpo);
    const kicks = kstep(k1) + kstep(k2) + kstep(k3);
    const dev = this.dev;
    // DEV: types (hands bob), hits enter on the first kick, leans back smug; v2 doesn't even look at the answer
    const typing = (hash(frameIdx(t) >> 3, 1) - 0.5) * 0.12 * (t > d0 - 0.4 && t < k1 ? 1 : 0);
    const enter = prog(t, k1 - 0.06, k1, ease.inQuad) - prog(t, k1, k1 + 0.2, ease.outCubic);
    const relax = 1 - prog(t, d0 - 0.45, d0 - 0.2, ease.inOutCubic);
    dev.armL.rotation.x = lerp(1.25 + typing, -2.7, relax); dev.armR.rotation.x = lerp(1.25 - typing + 0.35 * enter, -2.7, relax);
    dev.armL.rotation.z = -0.5 * relax; dev.armR.rotation.z = 0.5 * relax;
    const lean = prog(t, k1 + 0.1, k1 + 0.5, ease.outBack) * (t < d2 ? 1 : 0.6);
    dev.hips.rotation.x = 0.12 * lean;
    const nod = t >= d3 ? 0.12 * Math.sin((t - d3) * 9) * prog(t, d3 + 0.45, d3 + 0.6) : 0;
    dev.head.rotation.set(0.08 * lean + nod, 0, 0);
    const away = this.v === 2 && t >= d3 && t < d4;
    dev.root.rotation.y = away ? Math.PI * 0.82 : 0;
    this.room.chair.visible = !away;
    dev.setFace(t < pre + 0.6 ? 'neutral' : this.v === 2 && t >= d3 && t < d4 ? 'laugh' : t >= d3 + 0.4 && t < d4 ? 'smug' : 'smug');

    if (t < d0) {
      // the tail of the pre-chorus: "…slop machine," as goo letters carried in along the desk, then melting
      const g = this.goo;
      g.root.visible = true;
      g.root.position.set(0.58, 0.8, -2.86); g.root.scale.setScalar(0.12); g.root.rotation.set(0, 0.25, 0);
      const tw = this.tail?.words ?? [];
      const wSlop = tw[tw.length - 2], wMach = tw[tw.length - 1];
      const melt = prog(t, d0 - 0.35, d0 + 0.05, ease.inCubic);
      g.letters.forEach((l, i) => {
        const w = i < 5 ? wSlop : wMach;
        const tIn = (w?.start ?? pre) + (i < 5 ? 0 : (i - 5) * 0.035) - 0.12;
        const s = clamp(springStep(t - tIn, 3, 0.4), 0, 1.3);
        l.visible = t >= tIn;
        const v2 = this.v === 2;
        l.position.x = l.userData.x0 + (v2 ? 0 : (1 - clamp(s)) * 6 + 0.6 * (1 - prog(t, pre, pre + 0.8, ease.outCubic)));
        l.scale.set(1 + 0.25 * (1 - clamp(s)) + 0.4 * melt, (0.6 + 0.4 * clamp(s)) * (1 - 0.8 * melt), 1 + 0.3 * melt);
        l.position.y = v2 ? (1 - clamp(s)) * 9 : 0.02 * Math.sin(t * 11 + i) * (1 - melt);
        l.rotation.z = v2 ? (1 - clamp(s)) * (i % 2 ? 1.2 : -1.2) : 0;
      });
    } else if (t < d2) {
      // the fill: the room darkens on each kick; the strawberry comes down out of the dark
      const dim = t >= d1 ? 1 - 0.18 * kicks : 1;
      psGlobals.uLightCol.value.multiplyScalar(dim); psGlobals.uAmb.value.multiplyScalar(dim);
      if (t >= d1) {
        this.berryShadow.visible = true;
        this.berryShadow.scale.setScalar(0.2 + 1.0 * prog(t, k1, d2, ease.inQuad)); this.berryShadow.position.set(0, 0.012, 0.6);
        this.shake(0.02 * this.ctx.audio.hit('kick', t, 0.06));
      }
      if (t > this.L1.start - 0.05) {
        this.berry.visible = true;
        const hover = prog(t, this.L1.start - 0.05, d2 - 0.12, ease.outCubic);
        const fall = prog(t, d2 - 0.12, d2, ease.inQuad);
        this.berry.position.set(0, lerp(lerp(9, 4.6, hover), 1.3, fall), 0.6); this.berry.scale.set(1.2, 1.35, 1.2); this.berry.rotation.set(0, t * 2.5, 0.15);
      }
    } else if (t < d3) {
      this.animStrawberry(t, d2, false);
    } else if (t < d4) {
      // (the answer is on the CRT and in the chat window)
    } else {
      this.animGlass(t, d4, d5, d6, this.v === 2 ? 0.88 : 0.8);
    }
    void d5;
  }

  /** The landed strawberry, R'S, STRAWBERRY dropping in letter by letter, the 1-2-3 count and the token split. */
  private animStrawberry(t: number, t0: number, correct: boolean) {
    this.berry.visible = true; this.berryShadow.visible = true;
    const u = t - t0;
    // (in the final chorus the strawberry has been lying there since chorus 1: no landing squash)
    const sq = correct ? 1 : 1 - 0.35 * Math.exp(-Math.max(0, u) * 10) * Math.cos(u * 30);
    this.berry.position.set(0, 1.3 * sq, 0.6);
    this.berry.scale.set(1.2 * (2 - sq), 1.35 * sq, 1.2 * (2 - sq));
    this.berry.rotation.set(0, 0.4 + u * 0.3, 0);
    this.berryShadow.scale.setScalar(1.3); this.berryShadow.position.set(0, 0.012, 0.6);
    if (!correct) { this.dust.update(t, t0, [0, 0, 0.6]); this.shake(0.12 * Math.exp(-u * 8)); }
    // the chatbot stands next to it, confident
    this.bot.root.visible = true;
    this.bot.root.position.set(2.3, 0, 1.2); this.bot.root.rotation.y = -0.5;
    const L1 = this.L1;
    const sw = this.titles.straw!;
    if (!correct) {
      const rs = this.titles.rs!;
      const wR = L1.words[4]!, wS = L1.words[6]!;
      rs.root.visible = t >= wR.start - 0.02 && t < wS.start + 0.35;
      const rsIn = springStep(t - wR.start, 3.2, 0.42), rsOut = prog(t, wS.start, wS.start + 0.35, ease.inCubic);
      if (this.v === 2) {
        // chorus 2: R'S spins in from the left and is flung off to the right
        rs.root.position.set(lerp(-9, 0, clamp(rsIn, 0, 1.15)) + 7 * rsOut * rsOut, 1.75 + 0.6 * rsOut, 2.6);
        rs.root.rotation.set(-0.1, (1 - clamp(rsIn)) * 6.3, -1.0 * rsOut); rs.root.scale.setScalar(1.2);
      } else {
        rs.root.position.set(-2.4 * rsOut, lerp(5, 1.75, clamp(rsIn, 0, 1.2)) + 2.5 * rsOut * rsOut, 2.6);
        rs.root.rotation.set(-0.1, 0.1, 1.2 * rsOut); rs.root.scale.setScalar(1.2);
      }
      this.bot.setFace(t >= this.tokenT ? 'think' : 'happy');
      sw.root.visible = t >= wS.start - 0.02;
      const split = prog(t, this.tokenT, this.tokenT + 0.25, ease.outBack);
      sw.letters.forEach((l, i) => {
        const lt = wS.start + i * 0.035;
        const s = springStep(t - lt, 3.5, 0.45);
        l.visible = t >= lt;
        if (this.v === 2) {
          // chorus 2: each letter rolls in from the right, spinning like a wheel
          l.position.y = 0; l.rotation.set(0, 0, (1 - clamp(s)) * 5); l.rotation.y = 0;
          l.position.x = l.userData.x0 + (1 - clamp(s, 0, 1.3)) * 9 + (i < 5 ? -0.55 : 0.55) * split;
        } else {
          l.position.y = lerp(4, 0, clamp(s, 0, 1.3)); l.rotation.y = (1 - clamp(s)) * 1.5;
          l.position.x = l.userData.x0 + (i < 5 ? -0.55 : 0.55) * split;
        }
      });
    } else {
      // the final chorus: STRAWBERRY slams in whole on the downbeat, the bot counts the R's right
      sw.root.visible = true;
      const s = clamp(springStep(u, 3.2, 0.45), 0, 1.25);
      sw.root.visible = u >= 0;
      sw.letters.forEach((l, i) => { l.visible = true; l.position.y = lerp(4.5, 0, s) + 0.3 * (1 - clamp(s)) * Math.sin(i); l.rotation.y = 0; l.position.x = l.userData.x0; l.scale.setScalar(1); });
      this.bot.setFace(t > this.countT[2]! ? 'happy' : 'talk', frameIdx(t) >> 2);
    }
    sw.root.position.set(0, 1.05, 2.6); sw.root.rotation.set(-0.05, 0, 0); sw.root.scale.setScalar(0.56);
    sw.root.updateMatrixWorld(true);
    [2, 7, 8].forEach((li, n) => {
      const lb = this.labels[`n${n + 1}`]!;
      const ct = this.countT[n]!;
      if (t < ct) return;
      lb.visible = true;
      const s = springStep(t - ct, 4, 0.4);
      lb.position.copy(new THREE.Vector3(sw.letters[li]!.position.x + (correct && n === 2 ? 0.3 : 0), 1.35 + 0.2 * s + (correct && n === 2 ? 0.9 : 0), 0.4).applyMatrix4(sw.root.matrixWorld));
      lb.scale.setScalar(clamp(s, 0, 1.2));
    });
    if (!correct && t >= this.tokenT) {
      const s = clamp(springStep(t - this.tokenT, 3.5, 0.5), 0, 1.2);
      const lp = (li: number, y: number) => new THREE.Vector3(lerp(sw.letters[Math.floor(li)]!.position.x, sw.letters[Math.ceil(li)]!.position.x, li % 1), y, 0.3).applyMatrix4(sw.root.matrixWorld);
      const a = this.labels.straw!, b = this.labels.berry!, tk = this.labels.tokens!;
      a.visible = b.visible = tk.visible = true;
      a.position.copy(lp(2, 2.25)); b.position.copy(lp(7.5, 2.25)); tk.position.copy(new THREE.Vector3(0, 3.0, 0.3).applyMatrix4(sw.root.matrixWorld));
      for (const m of [a, b, tk]) m.scale.setScalar(s * 1.4);
    }
  }

  /** The glass on its pedestal: GLASS / WINE titles, BRIM, the GAP bracket and "half full". */
  private animGlass(t: number, d4: number, d5: number, d6: number, level: number) {
    const g = this.glass;
    g.root.visible = true; this.dev.root.visible = t < d5;
    const gy = this.glassY(t);
    g.root.position.set(0, gy, 0.3);
    g.root.rotation.y = (1 - clamp(springStep(t - d4, 2.4, 0.5))) * 3 + t * 0.2;
    g.fill(level, 0, t, 0.05 * Math.sin(t * 6) * Math.exp(-(t - d4)));
    g.bracket.visible = t > d5 + 0.1;
    g.bracket.scale.y = clamp(prog(t, d5 + 0.1, d5 + 0.35, ease.outBack), 0.01, 1.2);
    g.bracket.rotation.y = -g.root.rotation.y;
    const wG = this.L2.words[4]!, wW = this.L2.words[6]!;
    const drop = (ti: Title, t0: number, y: number, z: number) => {
      ti.root.visible = t >= t0 - 0.02;
      const s = springStep(t - t0, 3.2, 0.42);
      if (this.v === 2) {
        const side = ti === this.titles.glass ? -1 : 1;
        ti.root.position.set(lerp(side * 10, -1.6, clamp(s, 0, 1.2)), y, z); ti.root.scale.setScalar(0.9); ti.root.rotation.set(-0.08, (1 - clamp(s)) * side * 3.2, 0);
      } else {
        ti.root.position.set(-1.6, lerp(7, y, clamp(s, 0, 1.25)), z); ti.root.scale.setScalar(0.9); ti.root.rotation.set(-0.08, 0, 0);
      }
    };
    drop(this.titles.glass!, Math.max(wG.start, d4), 3.7, -1.2);
    drop(this.titles.wine!, wW.start, 2.45, -1.0);
    const brimL = this.labels.brim!;
    brimL.visible = t > d4 + 0.3;
    brimL.position.set(1.45, gy + 1.78, 0.5); brimL.scale.setScalar(clamp(springStep(t - d4 - 0.3, 3, 0.5), 0, 1.2) * (t >= d5 ? 0.75 : 1.0));
    if (t >= d5) {
      const up = prog(t, wW.end + 0.05, d6 - 0.1, ease.inOutCubic);
      const gp = this.labels.gap!, hf = this.labels.half!;
      gp.visible = t > d5 + 0.2 && up < 0.35; hf.visible = t > d5 + 0.35 && up < 0.35;
      brimL.visible = brimL.visible && up < 0.35;
      g.bracket.visible = g.bracket.visible && up < 0.35;
      gp.position.set(1.45, gy + 1.42, 0.6); gp.scale.setScalar(clamp(springStep(t - d5 - 0.2, 3, 0.5), 0, 1.2) * 0.7);
      hf.position.set(1.45, gy + 1.08, 0.6); hf.scale.setScalar(clamp(springStep(t - d5 - 0.35, 3, 0.5), 0, 1.2) * 0.9);
      this.titles.glass!.root.visible = false; this.titles.wine!.root.visible = false;
    }
  }

  // ================================================================== the final chorus
  private camFinal(t: number): CamState {
    const [f0, f1, f2, f3, f4] = this.d as [number, number, number, number, number];
    const wine = this.L2.words[2]!;
    if (t < f1) {
      return { P: this.kv(t, [[f0, [0.8, 2.0, 8.2]], [f1, [0.1, 1.5, 6.4], ease.inOutCubic]]), T: this.kv(t, [[f0, [0, 1.6, 0.6]], [f1, [0, 1.35, 1.2]]]), roll: keys(t, [[f0, -0.05], [f1, 0.02]]), fov: 52 };
    }
    const whip = prog(t, wine.start - 0.42, wine.start - 0.18, ease.inOutCubic);
    if (t < f3) {
      const Pw = this.kv(t, [[f1, [0.2, 2.0, 9.5]], [f1 + 0.3, [-0.4, 1.3, 6.6], ease.outExpo], [f2, [0.3, 1.1, 6.2], ease.inOutCubic], [wine.start - 0.42, [0.9, 1.0, 5.9], ease.inOutCubic]]);
      const Tw = this.kv(t, [[f1, [0, 1.3, 0.8]], [f2, [0.2, 1.4, 1.8]], [wine.start - 0.42, [0.7, 1.3, 2.2], ease.inOutCubic]]);
      // whip round to the glass standing right behind DEV's chair
      const Pg = this.kv(t, [[wine.start - 0.18, [2.6, 1.8, -0.2]], [f3, [2.3, 1.9, -0.45], ease.outCubic]]), Tg: V3 = [0.45, 0.95, -2.1];
      return { P: [lerp(Pw[0], Pg[0], whip), lerp(Pw[1], Pg[1], whip), lerp(Pw[2], Pg[2], whip)], T: [lerp(Tw[0], Tg[0], whip), lerp(Tw[1], Tg[1], whip), lerp(Tw[2], Tg[2], whip)], roll: 0.1 * Math.sin(whip * Math.PI) + 0.1 * (1 - springStep(t - f1, 2, 0.5)) * (1 - whip), fov: 52 };
    }
    // behind DEV: the wine runs down his back; then past him to the wall clock, wine dripping on its face
    const toClock = prog(t, this.L2.words[5]!.start - 0.05, f4 - 0.08, ease.inOutCubic);
    const Pb = this.kv(t, [[f3, [-0.75, 1.45, -0.85]], [f3 + 0.6, [-0.6, 1.35, -1.1], ease.outCubic]]), Tb: V3 = [0.15, 1.1, -2.3];
    const clk = this.room.clock.root.position;
    const Pc: V3 = [clk.x - 0.05, clk.y - 0.02, clk.z + 1.0], Tc: V3 = [clk.x, clk.y, clk.z];
    const u = toClock;
    return { P: [lerp(Pb[0], Pc[0], u), lerp(Pb[1], Pc[1], u) + 0.5 * Math.sin(u * Math.PI), lerp(Pb[2], Pc[2], u)], T: [lerp(Tb[0], Tc[0], u), lerp(Tb[1], Tc[1], u), lerp(Tb[2], Tc[2], u)], roll: -0.06 * (1 - u) + 0.04 * Math.sin(t * 20) * (1 - u) * 0.3, fov: 52 - 8 * u };
  }

  private animFinal(t: number) {
    const [f0, f1, f2, f3, f4] = this.d as [number, number, number, number, number];
    const dev = this.dev;
    // out of the bridge's white fog
    const clear = prog(t, f0, f0 + 0.7, ease.outCubic);
    this.fogNear = lerp(0.2, 3.2, clear); this.fogFar = lerp(2.5, 13, clear);
    this.fogColor = '#' + new THREE.Color('#F3ECDF').lerp(new THREE.Color(P.fog), clear).getHexString();
    this.begin();
    dev.armL.rotation.x = 1.25; dev.armR.rotation.x = 1.25;
    const wine = this.L2.words[2]!, drips = this.L2.words[3]!;
    if (t < f3 && t < wine.start - 0.3) {
      // the strawberry (still on the floor since chorus 1) and the counting
      this.animStrawberry(t, f1, true);
      if (t < f1) { this.titles.straw!.root.visible = false; for (const k of ['n1', 'n2', 'n3']) this.labels[k]!.visible = false; }
      const rLit = this.L1.words[6]!; // "R,"
      if (t >= rLit.start) {
        // the missing R lights up
        const L = this.titles.straw!.letters[8]!;
        const s = springStep(t - rLit.start, 4, 0.35);
        L.scale.setScalar(1 + 0.35 * Math.exp(-(t - rLit.start) * 3) * clamp(s, 0, 1.3));
        L.position.y = 0.25 * clamp(s, 0, 1.2);
        const fx = this.labels.fixed!;
        fx.visible = true;
        fx.position.copy(new THREE.Vector3(-1.2, 2.7, 0.5).applyMatrix4(this.titles.straw!.root.matrixWorld));
        fx.scale.setScalar(clamp(s, 0, 1.2) * 1.2);
      }
      dev.setFace(t < this.countT[1]! ? 'neutral' : 'shock');
    } else {
      // the glass fills to the brim, overflows and runs down DEV's back
      const g = this.glass;
      g.root.visible = true;
      g.root.position.set(0.95, 0.6 * 0.72, -1.9); g.root.scale.setScalar(0.72); g.root.rotation.y = 0.3;
      const lv = lerp(0.8, 1.14, prog(t, wine.start, drips.start + 0.15, ease.inOutQuad));
      const over = prog(t, drips.start + 0.1, f4 - 0.3, ease.outCubic);
      g.fill(lv, over, t, 0.03 * Math.sin(t * 9));
      const ok = this.labels.brimOk!;
      ok.visible = lv >= 1.13;
      ok.position.set(1.7, g.root.position.y + g.rimY * 0.72 + 0.15, -1.6); ok.scale.setScalar(clamp(springStep(t - drips.start, 3, 0.5), 0, 1.2) * 0.9);
      // the spill: from the rim on DEV's side over to his shoulders and down his back
      const rim = new THREE.Vector3(0.66, g.root.position.y + g.rimY * 0.72, -2.02);
      const path = [rim, new THREE.Vector3(0.36, 1.62, -2.22), new THREE.Vector3(0.1, 1.46, -2.28), new THREE.Vector3(0.03, 1.15, -2.27), new THREE.Vector3(0.02, 0.85, -2.26), new THREE.Vector3(0.05, 0.55, -2.24)];
      const run = prog(t, drips.start + 0.25, f4 - 0.15, ease.linear) * (path.length - 1);
      this.spill.forEach((s, i) => {
        const seg = Math.floor(i / 2), part = i % 2;
        if (seg >= path.length - 1 || run <= seg) return;
        const a = path[seg]!, b = path[seg + 1]!;
        const fr = clamp(run - seg);
        const p0 = a.clone().lerp(b, part * 0.5), p1 = a.clone().lerp(b, Math.min(fr, part * 0.5 + 0.5));
        if (p1.distanceTo(p0) < 0.01) return;
        s.visible = true;
        s.position.copy(p0).add(p1).multiplyScalar(0.5);
        s.lookAt(p1); s.rotateX(Math.PI / 2);
        s.scale.set(1 + 0.3 * Math.sin(t * 12 + i), p1.distanceTo(p0), 1);
      });
      // a chill: DEV shivers once the wine reaches his back
      const chill = prog(t, drips.start + 0.5, drips.start + 0.7);
      dev.torso.rotation.z = 0.05 * Math.sin(t * 38) * chill;
      dev.hips.rotation.x = -0.1 * chill;
      dev.setFace(chill > 0 ? 'scared' : 'shock');
      // he jumps up out of the chair as it runs down his back
      const up = chill > 0;
      dev.sit(!up); this.room.chair.visible = !up;
      dev.armL.rotation.x = up ? 0.4 : 1.25; dev.armR.rotation.x = up ? 0.4 : 1.25; dev.armL.rotation.z = up ? -0.5 : 0; dev.armR.rotation.z = up ? 0.5 : 0;
      if (chill > 0) this.shake(0.015 * chill);
      // the splash reaches the 10:10 clock on the wall: drips run down its face
      const clk = this.room.clock.root.position;
      this.clockDrips.forEach((s, i) => {
        const t0 = f3 + 0.5 + i * 0.12;
        if (t < t0) return;
        const len = Math.min(0.22, (t - t0) * 0.4);
        s.visible = true;
        s.position.set(clk.x - 0.18 + i * 0.09 + 0.02 * hash(i, 2), clk.y + 0.22 - len / 2 - 0.06 * hash(i, 3), clk.z + 0.03);
        s.scale.set(1, len, 1);
      });
    }
    void f2;
  }

  // ================================================================== the CRT screen (128x96)
  private drawScreen(t: number) {
    const c = this.room.screen.ctx;
    const fin = this.v === 'final';
    const d = this.d;
    const replyT = fin ? d[2]! : d[4]!;
    const typeFrom = fin ? d[0]! - 2 : d[1]! - 0.5, typeTo = fin ? d[0]! - 1 : this.L0.words[6]!.start + 0.15;
    const prompt = `how many r's in "strawberry"?`;
    const n = Math.floor(clamp((t - typeFrom) / (typeTo - typeFrom)) * prompt.length);
    const k = t >= replyT - 0.05 ? Math.floor(clamp((t - replyT + 0.05) / 0.3) * 40) : -1;
    const flick = this.v === 2 && k > 9 && frameIdx(t) - frameIdx(replyT - 0.05 + 0.3 * (10 / 40)) < 2;
    const key = `${n}|${k}|${flick}|${t < (fin ? d[1]! : d[3]!) && Math.floor(t * 4) % 2 === 0}`;
    if (key === this.room.screen.tex.userData.key) return;
    this.room.screen.tex.userData.key = key;
    c.fillStyle = '#10162A'; c.fillRect(0, 0, 128, 96);
    c.fillStyle = P.uiNavy; c.fillRect(0, 0, 128, 11);
    pixText(c, 'chat', 4, 2, P.uiLine);
    c.fillStyle = P.uiLine; c.fillRect(112, 3, 5, 5); c.fillRect(119, 3, 5, 5);
    const lines = ['> how many r\'s in', '  "strawberry"?'];
    let left = n;
    lines.forEach((ln, i) => { pixText(c, ln.slice(0, Math.max(0, Math.min(ln.length, left + 2))), 4, 16 + i * 10, P.uiLine); left -= ln.length - 2; });
    if (key.endsWith('true')) { c.fillStyle = P.title; c.fillRect(4 + 16 * ADV, 36, 5, 7); }
    if (k >= 0) {
      const col = fin ? P.fix : P.bot;
      pixText(c, 'There are'.slice(0, k), 4, 44, col);
      const digit = fin || flick ? '3' : '2';
      if (k > 9) pixText(c, digit, 64, 40, fin || flick ? P.fix : P.title, 4, { shadow: P.uiNavy });
      if (k > 12) pixText(c, `R's in`, 4, 64, col);
      if (k > 20) pixText(c, '"strawberry".', 4, 76, col);
    }
    c.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 1; y < 96; y += 2) c.fillRect(0, y, 128, 1);
    this.room.screen.tex.needsUpdate = true;
  }

  // ================================================================== the dialogue windows
  private drawPanels(t: number) {
    const fin = this.v === 'final';
    const d = this.d;
    const lyrSegs: Seg[] = fin ? this.lyricSegsFinal() : this.lyricSegs(t);
    const OC = 0.12;
    const seg = lyrSegs.find(([a, b]) => t >= a && t < b) ?? null;
    const lp = this.lyricP;
    if (seg) {
      const first = seg[0] === lyrSegs[0]![0];
      lp.hang = this.v === 2 ? { ...seg[2], ref: seg[0], follow: seg[0] === this.d[2] || seg[0] === this.L1.start - 0.05 ? 0 : 0.025, D: Math.min(seg[2].D ?? 1.1, 1.0) } : seg[2];
      lp.open = (first ? clamp((t - seg[0]) / OC) : clamp((t - seg[0]) / OC)) * (t > seg[1] - OC && seg[1] < this.ctx.end - 0.01 && !this.isCut(seg[1]) ? 1 - ease.inQuad(clamp((t - (seg[1] - OC)) / OC)) : 1);
    } else lp.open = 0;
    const words = this.lyricWords(t);
    const tw = typeWords(null, words, t, 8, 17);
    const done = words.length > 0 && t > words[words.length - 1]!.end;
    lp.draw(`${words[0]?.gi ?? -1}|${tw.key}|${done && Math.floor(t * 5) % 2 === 0}`, (c) => {
      uiBox(c, 0, 8, LYR_W, LYR_H - 8);
      uiTab(c, 8, 0, 'DEV', P.hoodie);
      typeWords(c, words, t, 8, 17, { key: (w) => /r[’']s|strawberry|glass|wine|\bR,|missing|spine/i.test(w.w) });
      if (done) uiNext(c, LYR_W - 14, LYR_H - 10, t);
    });

    // chat window: the prompt and the chatbot's answers
    type Chat = { who: 'dev' | 'bot'; lines: string[]; from: number; rate: number; a: number; b: number; hang: Hang; green?: boolean };
    const ver = fin ? 'v5.0' : this.v === 2 ? 'v3.0' : 'v1.0';
    const chats: Chat[] = fin ? [
      { who: 'bot', lines: [`There are 3 R's`, `in "strawberry".`], from: d[2]! + 0.02, rate: 60, a: d[2]!, b: this.L2.words[2]!.start - 0.3, green: true, hang: { ref: d[2]! + 0.3, x: 0.44, y: 0.56, frac: 0.5, yaw: -0.3, pitch: 0.1 } },
    ] : [
      { who: 'dev', lines: [`how many r's in`, `"strawberry"?`], from: d[1]! - 0.5, rate: 26, a: d[1]! - 0.45, b: d[2]!, hang: { ref: d[1]! - 0.45, follow: 0.04, D: 1.0, x: 0.42, y: 0.55, frac: 0.5, yaw: -0.3, pitch: 0.1 } },
      { who: 'bot', lines: [`There are 2 R's`, `in "strawberry".`], from: d[4]! + 0.02, rate: 60, a: d[4]!, b: d[4]! + 0.35, hang: { ref: d[4]! + 0.25, x: 0.44, y: 0.56, frac: 0.5, yaw: -0.35, pitch: 0.1 } },
      { who: 'bot', lines: [`There are 2 R's`, `in "strawberry".`], from: d[4]! - 1, rate: 60, a: d[4]! + 0.35, b: this.L2.start + 0.1, hang: { ref: d[4]! + 0.7, x: -0.3, y: 0.48, frac: 0.5, yaw: 0.3, pitch: 0.1 } },
      { who: 'dev', lines: ['draw: a wine glass', 'filled to the brim'], from: d[5]! + 0.02, rate: 70, a: d[5]!, b: d[6]!, hang: { ref: d[6]! - 0.45, D: 2.0, x: 0.44, y: 0.56, frac: 0.5, yaw: -0.3, pitch: 0.12 } },
      { who: 'bot', lines: [`Here's a wine glass`, 'filled to the brim!'], from: d[6]! + 0.02, rate: 70, a: d[6]!, b: this.L2.words[6]!.end + 0.2, hang: { ref: this.L2.words[6]!.end, D: 1.5, x: 0.44, y: 0.56, frac: 0.5, yaw: -0.3, pitch: 0.12 } },
    ];
    const chat = chats.find((c) => t >= c.a && t < c.b) ?? null;
    const cp = this.chatP;
    if (chat) {
      const typed = Math.floor((t - chat.from) * chat.rate);
      // v2: for two frames the reply's digit reads "3" before it settles on "2"
      const digitAt = chat.lines[0]!.indexOf('2');
      const tDigit = chat.from + (digitAt + 1) / chat.rate;
      const flick = this.v === 2 && chat.who === 'bot' && chat.from > d[4]! && frameIdx(t) - frameIdx(tDigit) < 2 && t >= tDigit;
      cp.hang = this.v === 2 ? { ...chat.hang, ref: chat.a, follow: 0.025, D: Math.min(chat.hang.D ?? 1.1, 1.0) } : chat.hang;
      cp.open = clamp((t - chat.a) / OC) * (this.isCut(chat.b) ? 1 : 1 - ease.inQuad(clamp((t - (chat.b - OC)) / OC)));
      cp.draw(`${chat.who}|${chat.lines[0]}|${Math.min(typed, 60)}|${flick}`, (c) => {
        uiBox(c, 0, 8, CHAT_W, CHAT_H - 8);
        uiPortrait(c, 6, 14, chat.who, chat.who === 'bot' ? ver : undefined);
        uiTab(c, 38, 1, chat.who === 'bot' ? 'chatbot' : 'you', chat.who === 'bot' ? P.uiNavy : P.hoodie);
        let n = typed;
        chat.lines.forEach((ln, i) => {
          const shown = flick ? ln.replace('2', '3') : ln;
          pixText(c, shown, 40, 19 + i * 12, P.uiLine, 1, {
            shadow: P.uiEdge,
            each: (k) => (k < n ? [0, 0] : null),
            colorAt: (k) => (chat.green || flick ? (/[3✓]/.test(shown[k]!) ? P.fix : P.uiLine) : shown[k] === '2' ? P.key2 : P.uiLine),
          });
          n -= ln.length;
        });
      });
    } else cp.open = 0;
  }

  private isCut(x: number) { return this.d.some((d) => Math.abs(d - x) < 1e-6); }

  /** The words the lyric window shows at t: the current line (a previous line's held tail stays until the next starts). */
  private lyricWords(t: number): Word[] {
    if (this.v === 'final') return t < this.L2.start ? this.L1.words : this.L2.words;
    return t < this.L1.start ? this.L0.words : t < this.L2.start ? this.L1.words : this.L2.words;
  }

  private lyricSegs(t: number): Seg[] {
    // d1..d6: the starts of shots 1..6 (d3 = the "R's" downbeat)
    const [, d1, d2, d3, d4, d5, d6] = this.d as [number, number, number, number, number, number, number];
    const le = this.L2.words[6]!.end;
    const w0 = this.L0.words[0]!.start;
    return [
      [w0 - 0.05, d1, { ref: d1 - 0.3, follow: 0.03, D: 0.85, x: -0.04, y: -0.55, frac: 0.62, yaw: 0.26, pitch: -0.1 }],
      [d1, d1 + 0.75, { ref: d1, follow: 0.03, D: 0.95, x: -0.02, y: -0.5, frac: 0.64, yaw: 0.28, pitch: -0.12 }],
      [d1 + 0.75, d2, { ref: d1 + 0.75, follow: 0.05, D: 0.9, x: 0.04, y: -0.5, frac: 0.74, yaw: -0.26, pitch: -0.1 }],
      [d2, this.L1.start - 0.05, { ref: d2, follow: 0, D: 0.7 + this.kicks.reduce((a, k) => a + (t >= k ? 0.3 * Math.exp(-(t - k) / 0.07) : 0), 0), x: 0.0, y: -0.5, frac: 0.7, yaw: -0.22, pitch: -0.08 }],
      [this.L1.start - 0.05, d3, { ref: this.L1.start - 0.05, follow: 0, D: 0.8, x: 0.02, y: -0.5, frac: 0.72, yaw: 0.2, pitch: 0.14 }],
      [d3, d4, { ref: this.L1.words[6]!.start + 0.3, D: 2.2, x: 0.0, y: -0.55, frac: 0.72, yaw: -0.2, pitch: -0.2 }],
      [d4, d4 + 0.35, { ref: d4 + 0.25, x: -0.12, y: -0.5, frac: 0.72, yaw: 0.3, pitch: -0.1 }],
      [d4 + 0.35, this.L2.start + 0.1, { ref: d4 + 0.7, x: 0.1, y: -0.64, frac: 0.62, yaw: -0.3, pitch: -0.1 }],
      [this.L2.start + 0.1, this.L2.start + 0.38, { ref: this.L2.start + 0.1, follow: 0.1, D: 1.0, x: -0.05, y: -0.5, frac: 0.72, yaw: 0.25, pitch: -0.15 }],
      [this.L2.start + 0.38, d5, { ref: this.L2.start + 0.38, follow: 0.06, D: 1.3, x: -0.05, y: -0.5, frac: 0.72, yaw: -0.2, pitch: -0.15 }],
      [d5, d6, { ref: d6 - 0.45, D: 2.2, x: -0.05, y: -0.52, frac: 0.72, yaw: -0.22, pitch: -0.15 }],
      [d6, le + 0.05, { ref: d6, follow: 0.03, D: 1.0, x: -0.06, y: -0.45, frac: 0.7, yaw: 0.28, pitch: -0.12 }],
      [le + 0.05, this.ctx.end + 0.1, { ref: le + 0.05, follow: 0, D: 0.8, x: 0.0, y: -0.36, frac: 0.64, yaw: 0.12, pitch: -0.12 }],
    ];
  }

  private lyricSegsFinal(): Seg[] {
    const [f0, f1, f2, f3] = this.d as [number, number, number, number, number];
    const wine = this.L2.words[2]!;
    return [
      [this.L1.start - 0.2, f1, { ref: f1 - 0.3, D: 1.4, x: -0.04, y: -0.52, frac: 0.72, yaw: 0.24, pitch: -0.12 }],
      [f1, f2, { ref: f2 - 0.4, D: 2.0, x: 0.0, y: -0.55, frac: 0.72, yaw: -0.2, pitch: -0.2 }],
      [f2, wine.start - 0.3, { ref: wine.start - 0.45, D: 1.8, x: -0.04, y: -0.55, frac: 0.72, yaw: 0.22, pitch: -0.15 }],
      [wine.start - 0.3, f3, { ref: f3 - 0.2, D: 1.2, x: -0.06, y: -0.52, frac: 0.72, yaw: -0.24, pitch: -0.12 }],
      [f3, this.ctx.end + 0.1, { ref: f3, follow: 0.05, D: 0.8, x: -0.1, y: 0.5, frac: 0.66, yaw: 0.2, pitch: 0.12 }],
    ].map((s) => s as Seg).filter(([a]) => a >= f0 - 1);
  }
}
