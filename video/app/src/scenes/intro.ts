// #1 intro [0 → cut("I write my code")], the spoken intro (no music until audio.musicStart).
//   Frame 0: the game's title screen (YOUR JOB IS SAFE! in block letters, a spinning thumbs-up, a
//   CERTIFIED SAFE seal, PRESS START, ©1999 DEV SOFT).
//   "AI will replace all programmers by next year.": the title flips away into a newsflash montage; three
//   front pages spin in, each carrying a real, paraphrased quote, and the spoken words are slammed onto
//   them one per word as block-letter ink (NEXT YEAR in fail red).
//   The laugh: DEV laughing at the camera in his room, HA HA HA popping on the laugh's peaks.
//   "Yeah. They said that last year too.": a tear-off calendar flips a year per word (2020 → 2026),
//   every leaf stamped NEXT YEAR; the last leaf flies at the lens and the camera dives into DEV's CRT
//   (→ v1-desk pulls back out of it).
import * as THREE from 'three';
import type { Frame } from '../engine/scene';
import type { Line } from '../engine/lyrics';
import { clamp, ease, lerp, hash, springStep } from '../engine/util';
import { Ps1Stage, type CamState, type V3 } from '../ps1/stage';
import { makeDev, makeRoom, type Dev, type Room } from '../ps1/cast';
import { pixText, textW, psMat, canvasTex, rng } from '../ps1/gfx';
import { P } from '../ps1/palette';
import { introQuotes, drawFrontPage, drawLeaf, makeThumbsUp, makeSunburst, PAGE_TW, PAGE_TH } from './intro-props';

const TITLE_X = 100; // the title screen set
const NEWS_X = 200; // the newsflash set
const PAGE_W = 3.0, PAGE_H = PAGE_W * (PAGE_TH / PAGE_TW);
const LEAF_W = 0.6, LEAF_H = LEAF_W * (76 / 64);
const CAL: V3 = [-0.62, 1.95, -4.13]; // (right of the window frame, above the monitor)

type Stamp = { w: string; t: number; page: number; inked: boolean; obj: { root: THREE.Group; width: number; letters: THREE.Object3D[] } };

export default class Intro extends Ps1Stage {
  private L1!: Line; private L2!: Line;
  private tFlip = 0; private tLaugh = 0; private tCal = 0; private tOut = 0;
  private pageLand: number[] = [];
  private laughPeaks: number[] = [];

  private title!: { a: ReturnType<Ps1Stage['blockTitle']>; b: ReturnType<Ps1Stage['blockTitle']> };
  private thumb!: THREE.Group; private seal!: THREE.Group; private press!: THREE.Mesh; private copy!: THREE.Mesh;
  private titleBurst!: THREE.Group; private newsBurst!: THREE.Group; private ticker!: THREE.Mesh;
  private pages: THREE.Group[] = [];
  private stamps: Stamp[] = [];
  private room!: Room; private dev!: Dev;
  private has: ReturnType<Ps1Stage['blockTitle']>[] = [];
  private leaves: THREE.Object3D[] = [];
  private leafWords: { t: number }[] = [];
  private deskPages: THREE.Mesh[] = [];

  override init() {
    const { lyrics: ly, audio: au } = this.ctx;
    this.L1 = ly.get('AI will replace'); this.L2 = ly.get('They said that last year');
    const w1 = this.L1.words, w2 = this.L2.words;
    this.tFlip = w1[0]!.start - 0.16;
    this.tLaugh = this.L1.end + 0.02;
    this.tCal = w2[0]!.start - 0.14;
    this.tOut = this.L2.end;
    // the laugh: peaks of the vocal envelope between the two lines (fallback: evenly spaced)
    const peaks: number[] = [];
    for (let t = this.tLaugh + 0.05; t < this.tCal - 0.05; t += 0.01) {
      const v = au.env('vocal', t);
      if (v > 0.18 && v >= au.env('vocal', t - 0.03) && v >= au.env('vocal', t + 0.03) && (peaks.length === 0 || t - peaks[peaks.length - 1]! > 0.2)) peaks.push(t);
    }
    this.laughPeaks = peaks.length >= 3 ? peaks : Array.from({ length: 6 }, (_, i) => this.tLaugh + 0.2 + i * 0.36);

    this.fogColor = P.fog; this.fogNear = 6; this.fogFar = 22;
    this.buildTitle();
    this.buildNews(w1);
    this.buildRoom(w2);
  }

  // ------------------------------------------------------------------ sets
  private buildTitle() {
    const X = TITLE_X;
    this.titleBurst = makeSunburst(18, '#1B2A55', '#141B2E', 9);
    this.titleBurst.position.set(X, 0.4, -4); this.world.add(this.titleBurst);
    const R = rng(5);
    const stars = canvasTex(128, 72, (c) => {
      for (let i = 0; i < 90; i++) { c.fillStyle = R() > 0.7 ? P.uiLine : P.uiDim; c.fillRect(Math.floor(R() * 128), Math.floor(R() * 72), 1, 1); }
    });
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(24, 13.5), psMat({ map: stars.tex, unlit: true, fog: 0, depthWrite: false }));
    sky.position.set(X, 0.4, -4.2); sky.renderOrder = -1; (sky.material as THREE.Material).transparent = true; this.world.add(sky);
    const a = this.blockTitle('YOUR JOB', { depth: 0.42 }), b = this.blockTitle('IS SAFE!', { depth: 0.42 });
    a.root.position.set(X, 1.05, 0); b.root.position.set(X, -0.2, 0);
    a.root.scale.setScalar(0.95); b.root.scale.setScalar(0.95);
    this.title = { a, b };
    this.thumb = makeThumbsUp(); this.thumb.position.set(X - 3.2, 0.35, 0.4); this.world.add(this.thumb);
    // the seal: CERTIFIED / ✓ / SAFE on a green rosette
    const sealT = canvasTex(64, 64, (c) => {
      c.fillStyle = P.fixSide; c.beginPath(); c.arc(32, 32, 31, 0, Math.PI * 2); c.fill();
      c.fillStyle = P.fix; c.beginPath(); c.arc(32, 32, 27, 0, Math.PI * 2); c.fill();
      pixText(c, '100%', 32 - textW('100%', 2) / 2, 10, P.ink, 2);
      pixText(c, '✓', 32 - textW('✓', 2) / 2, 27, P.ink, 2);
      pixText(c, 'SAFE', 32 - textW('SAFE', 2) / 2, 42, P.ink, 2);
    });
    this.seal = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.62, 16), psMat({ map: sealT.tex, unlit: true, side: THREE.DoubleSide }));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.06, 3, 16), psMat({ color: P.title }));
    this.seal.add(disc, rim);
    this.seal.position.set(X + 3.25, 0.45, 0.4); this.seal.scale.setScalar(0.85); this.world.add(this.seal);
    const txt = (s: string, col: string, scale: number, w: number) => {
      const W = textW(s, scale) + 4, H = 7 * scale + 4;
      const tt = canvasTex(W, H, (c) => pixText(c, s, 1, 1, col, scale, { shadow: P.uiEdge }));
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * (H / W)), psMat({ map: tt.tex, unlit: true, fog: 0 }));
      this.world.add(m); return m;
    };
    this.press = txt('PRESS START', P.uiLine, 2, 2.6); this.press.position.set(X, -1.3, 0.3);
    this.copy = txt('©1999 DEV SOFT   ALL JOBS RESERVED', P.uiDim, 1, 5.0); this.copy.position.set(X, -1.95, 0.3);
  }

  private buildNews(words: Line['words']) {
    const X = NEWS_X;
    this.newsBurst = makeSunburst(16, '#5A1622', '#2A0E1A', 10);
    this.newsBurst.position.set(X, 0, -3); this.world.add(this.newsBurst);
    // the BREAKING ticker: a long strip that slides past under the pages
    const tick = canvasTex(256, 12, (c) => {
      c.fillStyle = P.fail; c.fillRect(0, 0, 256, 12);
      let x = 2;
      while (x < 256) { pixText(c, 'BREAKING', x, 3, P.uiLine); x += textW('BREAKING') + 8; c.fillStyle = P.title; c.fillRect(x - 5, 5, 2, 2); }
    }, true);
    const tg = new THREE.PlaneGeometry(16, 0.4, 8, 1);
    const tuv = tg.attributes.uv!; for (let i = 0; i < tuv.count; i++) tuv.setX(i, tuv.getX(i) * 4);
    this.ticker = new THREE.Mesh(tg, psMat({ map: tick.tex, unlit: true, fog: 0 }));
    this.ticker.position.set(X, -1.12, 0.4); this.world.add(this.ticker);
    // three front pages. The headline grows word by word as one clean three-row headline: each new page
    // spins in on top already carrying the words so far (pre-inked) and gets the next words slammed on.
    const split = [[0, 3], [3, 5], [5, words.length]] as const;
    const offs: V3[] = [[-0.12, 0.06, 0], [0.1, -0.04, 0.12], [0.0, 0.0, 0.24]];
    const rolls = [0.05, -0.04, 0.015];
    const red = (w: string) => /next|year/i.test(w);
    const mk = (w: string) => this.blockTitle(w.toUpperCase(), { cap: red(w) ? P.fail : P.ink, side: red(w) ? P.failSide : '#05070F', depth: 0.3, tracking: 0.06 });
    // one scale for every row: the widest row fits the page
    const probe = split.map(([a, b]) => words.slice(a, b).map((w) => mk(w.w)));
    const gap = 0.45;
    const rowW = (objs: { width: number }[]) => objs.reduce((s, o) => s + o.width, 0) + gap * (objs.length - 1);
    const S = Math.min(0.26, (PAGE_W * 0.9) / Math.max(...probe.map(rowW)));
    probe.flat().forEach((o) => { o.root.removeFromParent(); });
    const rowY = [70, 100, 128].map((ty) => PAGE_H / 2 - ty * (PAGE_H / PAGE_TH));
    introQuotes.forEach((q, i) => {
      const g = new THREE.Group();
      const tex = canvasTex(PAGE_TW, PAGE_TH, (c) => drawFrontPage(c, q, i)).tex;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(PAGE_W, PAGE_H, 4, 3), psMat({ map: tex, unlit: true, fog: 0, side: THREE.DoubleSide }));
      g.add(m);
      g.userData.home = [X + offs[i]![0], offs[i]![1], offs[i]![2]];
      g.userData.roll = rolls[i];
      this.world.add(g); this.pages.push(g);
      for (let r = 0; r <= i; r++) {
        const [a, b] = split[r]!;
        const ws = words.slice(a, b);
        const objs = ws.map((w) => mk(w.w));
        let x = -(rowW(objs) * S) / 2;
        objs.forEach((o, k) => {
          o.root.scale.setScalar(S);
          o.root.position.set(x + (o.width * S) / 2, rowY[r]!, 0.02);
          x += o.width * S + gap * S;
          g.add(o.root);
          this.stamps.push({ w: ws[k]!.w, t: ws[k]!.start, page: i, inked: r < i, obj: o });
        });
      }
      this.pageLand.push(words[split[i]![0]]!.start - 0.06);
    });
  }

  private buildRoom(words: Line['words']) {
    this.room = makeRoom();
    this.world.add(this.room.root);
    this.dev = makeDev();
    this.dev.setFace('laugh');
    this.dev.root.position.set(0.05, 0, -1.55);
    this.dev.root.rotation.y = Math.PI; // turned round from the desk, laughing at us
    this.world.add(this.dev.root);
    for (let i = 0; i < 3; i++) {
      const h = this.blockTitle('HA', { depth: 0.36 });
      h.root.scale.setScalar(0.42);
      this.has.push(h);
    }
    // the three front pages, now lying on his desk
    this.pages.forEach((_, i) => {
      const src = (this.pages[i]!.children[0] as THREE.Mesh).material as THREE.RawShaderMaterial;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.38), psMat({ map: src.uniforms.uMap!.value, side: THREE.DoubleSide }));
      m.rotation.set(-Math.PI / 2, 0, 0.3 - i * 0.35);
      m.position.set(-0.55 + i * 0.12, 0.805 + i * 0.002, -3.1 + i * 0.05);
      this.world.add(m); this.deskPages.push(m);
    });
    // the tear-off calendar on the back wall: a board, a binding, and one leaf per year
    const board = new THREE.Mesh(new THREE.BoxGeometry(LEAF_W + 0.14, LEAF_H + 0.24, 0.04), psMat({ color: '#5A3A24' }));
    board.position.set(CAL[0], CAL[1] - 0.04, CAL[2] - 0.03); this.world.add(board);
    const bind = new THREE.Mesh(new THREE.BoxGeometry(LEAF_W + 0.1, 0.08, 0.06), psMat({ color: P.fail }));
    bind.position.set(CAL[0], CAL[1] + LEAF_H / 2 + 0.03, CAL[2] + 0.02); this.world.add(bind);
    const years = [2019, ...words.map((_, i) => 2020 + i)];
    this.leafWords = [{ t: -Infinity }, ...words.map((w) => ({ t: w.start }))];
    years.forEach((y, i) => {
      const tex = canvasTex(64, 76, (c) => drawLeaf(c, y, i === 0 ? '' : words[i - 1]!.w)).tex;
      const piv = new THREE.Object3D(); // pivot on the leaf's top edge
      piv.position.set(CAL[0], CAL[1] + LEAF_H / 2, CAL[2] + 0.004 * (years.length - i));
      const m = new THREE.Mesh(new THREE.PlaneGeometry(LEAF_W, LEAF_H, 2, 2), psMat({ map: tex, side: THREE.DoubleSide }));
      m.position.y = -LEAF_H / 2;
      piv.add(m);
      this.world.add(piv); this.leaves.push(piv);
    });
    const sc = this.room.screen.ctx;
    sc.fillStyle = '#10162A'; sc.fillRect(0, 0, 128, 96);
    this.room.screen.tex.needsUpdate = true;
  }

  // ------------------------------------------------------------------ camera
  camAt(t: number): CamState {
    const X = TITLE_X, N = NEWS_X;
    if (t < this.tFlip + 0.1) {
      // the title screen: a slow drift that starts designed at frame 0, a push as it flips away
      const u = t;
      const flip = ease.inCubic(clamp((t - this.tFlip) / 0.1));
      return { P: [X + Math.sin(u * 0.9) * 0.35, 0.55 + Math.sin(u * 0.7) * 0.08, 5.3 - u * 0.25 - flip * 2.5], T: [X, 0.3, 0], roll: 0.02 * Math.sin(u * 0.8), fov: 52 };
    }
    if (t < this.tLaugh) {
      // the newsflash: each page lands with a punch-in, the camera leans with the pile
      const i = this.pageLand.filter((x) => t >= x).length - 1;
      const land = this.pageLand[Math.max(0, i)]!;
      const punch = 0.35 * (1 - ease.outExpo(clamp((t - land) / 0.3)));
      const drift = (t - this.tFlip) * 0.12;
      const roll = [0.06, -0.05, 0.03][Math.max(0, i)]! * (1 - ease.outExpo(clamp((t - land) / 0.4)));
      const out = ease.inOutQuad(clamp((t - (this.L1.end - 0.4)) / 0.4));
      return { P: [N + 0.12 * Math.sin(t * 1.3) - 0.3 * out, 0.12 + 0.3 * out, 2.35 - punch - drift * 0.4 + 1.0 * out], T: [N, 0.02, 0], roll: roll - 0.08 * out, fov: 52 };
    }
    if (t < this.tCal) {
      // the laugh: a sub-cut every other peak (a whip), cycling a push on his laughing face, the HAs from
      // below, a low hero angle; each peak in between is a punch-in
      const n = this.laughPeaks.filter((x) => t >= x).length;
      const shots: CamState[] = [
        { P: [0.45, 1.0, 0.35], T: [0.05, 1.5, -1.55], fov: 56, roll: 0.02 },
        { P: [0.2, 1.46, -0.95], T: [0.05, 1.42, -1.55], fov: 52, roll: -0.08 },
        { P: [-0.35, 1.25, -0.45], T: [0.1, 1.95, -1.4], fov: 56, roll: 0.1 },
        { P: [0.75, 0.75, 0.2], T: [0.05, 1.35, -1.55], fov: 58, roll: -0.05 },
      ];
      // a sub-cut every half second from the first "ha" (whips between the four framings)
      const step = 0.46, k = Math.floor((t - this.tLaugh) / step);
      const si = k % 4, pi = (k + 3) % 4;
      const tSwitch = this.tLaugh + k * step;
      let c = k === 0 ? shots[0]! : mixCam(shots[pi]!, shots[si]!, ease.outExpo(clamp((t - tSwitch) / 0.12)));
      const last = this.laughPeaks[n - 1];
      if (last !== undefined) {
        const punch = 0.12 * (1 - ease.outExpo(clamp((t - last) / 0.18)));
        c = { ...c, P: [lerp(c.P[0], c.T[0], punch), lerp(c.P[1], c.T[1], punch), lerp(c.P[2], c.T[2], punch)] };
      }
      c.roll = (c.roll ?? 0) + 0.05 * Math.sin(t * 7) * this.ctx.audio.env('vocal', t);
      return c;
    }
    // the calendar: a push per leaf; then the dive into the CRT
    const flips = this.leafWords.filter((l) => t >= l.t).length - 1;
    const d = 1.35 - Math.min(flips, 7) * 0.07;
    const sway = 0.08 * Math.sin(t * 2.1);
    const calCam: CamState = { P: [CAL[0] + 0.25 + sway, CAL[1] - 0.05, CAL[2] + d], T: [CAL[0], CAL[1] - 0.05, CAL[2]], roll: -0.04 + 0.03 * Math.sin(t * 3), fov: 52 };
    const intro = ease.outExpo(clamp((t - this.tCal) / 0.35));
    const from: CamState = { P: [-0.2, 1.3, -0.6], T: [CAL[0], CAL[1], CAL[2]], fov: 52 };
    let c = mixCam(from, calCam, intro);
    // out: whip across to the CRT and push into its screen until it fills the frame
    const s = this.room.screenPos;
    const dive = ease.inOutCubic(clamp((t - this.tOut - 0.02) / (this.ctx.end - this.tOut - 0.02)));
    // lands exactly on v1-desk's first pose (SCREEN_FILL)
    const crt: CamState = { P: [s.x, s.y, s.z + 0.305], T: [s.x, s.y, s.z], fov: 52 };
    if (dive > 0) c = mixCam(c, crt, dive);
    return c;
  }

  // ------------------------------------------------------------------ frame
  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    this.begin();
    const t = f.t, au = this.ctx.audio;
    const inTitle = t < this.tFlip + 0.12, inNews = t >= this.tFlip && t < this.tLaugh, inRoom = t >= this.tLaugh - 0.02;

    // --- title
    const { a, b } = this.title;
    [a, b].forEach((ti, row) => ti.letters.forEach((l, i) => {
      const k = row * 8 + i;
      const flip = ease.inBack(clamp((t - this.tFlip - 0.012 * k) / 0.14));
      l.position.y = 0.05 * Math.sin(t * 3.2 - k * 0.55) - flip * 1.5;
      l.rotation.x = -flip * 1.6;
      l.rotation.z = row === 1 && i === 7 ? 0.18 * Math.sin(t * 4.2) : 0; // the "!" does the sarcasm
      l.position.x = (l.userData.x0 as number) + (row === 1 && i === 7 ? 0.05 * Math.sin(t * 4.2) : 0);
    }));
    a.root.visible = b.root.visible = inTitle;
    this.thumb.visible = this.seal.visible = this.press.visible = this.copy.visible = inTitle;
    this.titleBurst.visible = inTitle;
    this.thumb.rotation.y = t * 1.9;
    this.thumb.position.y = 0.35 + 0.08 * Math.sin(t * 2.4);
    this.seal.rotation.y = 0.35 * Math.sin(t * 1.3);
    this.seal.rotation.z = 0.08 * Math.sin(t * 2.0);
    this.press.visible = inTitle && Math.floor(t * 2.2) % 2 === 0;
    this.titleBurst.rotation.z = t * 0.12;

    // --- newsflash
    this.newsBurst.visible = this.ticker.visible = inNews;
    this.newsBurst.rotation.z = -t * 0.35;
    this.ticker.position.x = NEWS_X - ((t * 1.6) % 4);
    this.pages.forEach((g, i) => {
      const land = this.pageLand[i]!, u = (t - land) / 0.28 + 1; // 0 → 1 over the spin-in
      g.visible = inNews && u > 0;
      if (!g.visible) return;
      const e = ease.outCubic(clamp(u));
      const home = g.userData.home as V3;
      g.position.set(home[0], home[1], lerp(1.5, home[2], e)); // slapped down in front of the pile
      g.rotation.set(0, 0, (1 - e) * Math.PI * 4 + (g.userData.roll as number));
      g.scale.setScalar(lerp(0.55, 1, e));
    });
    let slam = 0;
    for (const s of this.stamps) {
      const u = s.inked ? 1 : t - s.t;
      // a page's ink hides once the next page has landed on top of it (the new page carries it on)
      const covered = t > (this.pageLand[s.page + 1] ?? Infinity) - 0.12;
      s.obj.root.visible = inNews && this.pages[s.page]!.visible && u >= -0.05 && !covered;
      if (!s.obj.root.visible) continue;
      // the letterpress: the word drops onto the page and is pressed flat into ink
      const e = ease.inQuad(clamp((u + 0.05) / 0.07));
      s.obj.root.position.z = lerp(0.9, 0.03, e);
      const k = s.obj.root.scale.x;
      s.obj.root.scale.set(k, k, k * lerp(1, 0.12, e));
      if (u >= 0 && u < 0.12) slam = Math.max(slam, 1 - u / 0.12);
    }
    if (inNews && slam > 0) this.shake(0.05 * slam);

    // --- the room: the laugh, the calendar, the dive
    this.room.root.visible = this.dev.root.visible = inRoom;
    for (const m of this.deskPages) m.visible = inRoom;
    this.leaves.forEach((l) => (l.visible = inRoom));
    if (inRoom) {
      const env = au.env('vocal', t);
      const laughing = t < this.tCal + 0.2;
      this.dev.setFace(laughing ? 'laugh' : t < this.tOut - 0.1 ? 'smug' : 'smug');
      const rock = laughing ? 0.22 + 0.18 * env + 0.06 * Math.sin(t * 17) * env : 0.05;
      this.dev.hips.rotation.x = rock; // leaning back
      this.dev.head.rotation.z = laughing ? 0.12 * Math.sin(t * 9) : 0;
      this.dev.armL.rotation.set(0.7, 0, -0.35 - 0.1 * env);
      this.dev.armR.rotation.set(0.7, 0, 0.35 + 0.1 * env);
      this.dev.root.position.y = laughing ? 0.03 * Math.abs(Math.sin(t * 11)) * env * 3 : 0;
      // HA HA HA: each peak pops the next HA, which then bounces with the laugh
      const pos: V3[] = [[-0.62, 1.78, -1.3], [0.1, 1.98, -1.4], [0.8, 1.78, -1.3]];
      this.has.forEach((h, i) => {
        // the HAs pop on a steady laugh rhythm from the first "ha" (the peaks drive the punch-ins)
        const pops = Array.from({ length: 12 }, (_, k) => this.tLaugh + 0.08 + k * 0.23).filter((x) => x < this.tCal);
        const myPeaks = pops.filter((x, k) => k % 3 === i && x <= t);
        const last = myPeaks[myPeaks.length - 1];
        const on = last !== undefined && t < this.tCal + 0.1;
        h.root.visible = on;
        if (!on) return;
        const pop = springStep(t - last, 3.2, 0.35);
        const p = pos[i]!;
        h.root.position.set(p[0], p[1] + 0.12 * env + 0.05 * Math.sin(t * 8 + i), p[2]);
        h.root.scale.setScalar(0.42 * clamp(pop, 0, 1.3));
        h.root.rotation.set(0, (i - 1) * 0.3, 0.12 * Math.sin(t * 6 + i * 2));
        h.letters.forEach((l, k) => (l.position.y = 0.12 * Math.abs(Math.sin(t * 10 + k + i))));
      });
      // the calendar: the previous leaf tears off (flips over the top and flies away) as each word starts
      this.leaves.forEach((l, i) => {
        const next = this.leafWords[i + 1]?.t ?? Infinity;
        const isLast = i === this.leaves.length - 1;
        const off = isLast ? this.tOut - 0.02 : next;
        const u = t - off;
        if (u < 0) { l.rotation.set(0, 0, 0); l.position.set(CAL[0], CAL[1] + LEAF_H / 2, CAL[2] + 0.004 * (this.leaves.length - i)); l.visible = true; return; }
        if (isLast) {
          // the last leaf flies at the lens
          const e = ease.inQuad(clamp(u / 0.2));
          l.position.set(CAL[0] + 0.3 * e, CAL[1] + LEAF_H / 2 - 0.2 * e, CAL[2] + 0.004 + 1.2 * e);
          l.rotation.set(-0.5 * e, 0.4 * e, 0.3 * e);
          l.visible = u < 0.2;
          return;
        }
        const e = clamp(u / 0.16);
        l.rotation.set(-Math.PI * 0.95 * ease.outQuad(e), 0, (hash(i, 3) - 0.5) * 0.8 * e);
        l.position.set(CAL[0] + (hash(i, 4) - 0.5) * 0.9 * e * e, CAL[1] + LEAF_H / 2 + 0.6 * e * e, CAL[2] + 0.004 * (this.leaves.length - i) + 0.9 * e * e);
        l.visible = u < 0.2;
      });
      // the CRT's screen: a dark editor with a caret, as v1-desk finds it
      this.drawScreen(t);
    }
    return this.present(f, out);
  }

  private screenKey = '';
  private drawScreen(t: number) {
    const k = `c${this.ctx.audio.beatAt(t) % 1 < 0.55 ? 0 : 1}`; // blinks on the beat, as in v1-desk
    if (k === this.screenKey) return;
    this.screenKey = k;
    // the empty editor v1-desk opens on: hand_written.c, a caret, scanlines
    const c = this.room.screen.ctx;
    c.fillStyle = '#10162A'; c.fillRect(0, 0, 128, 96);
    c.fillStyle = '#2E4A8C'; c.fillRect(0, 0, 128, 10);
    pixText(c, 'hand_written.c', 3, 2, P.uiLine);
    if (k === 'c0') { c.fillStyle = P.key2; c.fillRect(16, 13, 5, 8); }
    c.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 1; y < 96; y += 2) c.fillRect(0, y, 128, 1);
    this.room.screen.tex.needsUpdate = true;
  }
}

function mixCam(a: CamState, b: CamState, k: number): CamState {
  const m = (x: V3, y: V3): V3 => [lerp(x[0], y[0], k), lerp(x[1], y[1], k), lerp(x[2], y[2], k)];
  return { P: m(a.P, b.P), T: m(a.T, b.T), roll: lerp(a.roll ?? 0, b.roll ?? 0, k), fov: lerp(a.fov ?? 52, b.fov ?? 52, k) };
}

