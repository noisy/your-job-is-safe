// #5 / #12 pre {n:1|2}: the pre-chorus.
//   Feed: a 3D social feed column the camera climbs; the previous line's tail is the first post (the
//   calendar leaf / the circling plane becomes a card), then every word of line 1 is its own post card
//   popping in (hype words highlighted; pre 2: short-video frames). Slop images between them.
//   Room: the camera pulls back out of DEV's CRT (the feed still on it) to DEV at his desk, dressed as a
//   craftsman's workbench; line 2 is typed on a brass plaque on the wall; CRAFT / ART (pre 2: 2010) drop
//   in as block letters; pre 2's CRT shows an old desktop.
//   Machine: a whip to the SLOP MACHINE (the chatbot's face, v1.0 / v3.0) extruding each word of line 3
//   as goo letters on its hit; the conveyor carries them onto DEV's desk (→ chorus-count at his CRT).
import * as THREE from 'three';
import type { Frame } from '../engine/scene';
import type { Line, Word } from '../engine/lyrics';
import { clamp, ease, lerp, hash, springStep } from '../engine/util';
import { Ps1Stage, typeWords, type CamState, type V3 } from '../ps1/stage';
import { makeDev, makeRoom, makeBotHead, type Dev, type Room, type BotHead } from '../ps1/cast';
import { pixText, textW, psMat, canvasTex } from '../ps1/gfx';
import { P } from '../ps1/palette';
import { CARD_W, CARD_H, drawWordCard, drawDecorCard, drawTailCard, drawPlaque, makeSlopMachine } from './pre-props';

const FX = -40; // the feed set
const CW = 1.8, CH = CW * (CARD_H / CARD_W);
const PLAQ: V3 = [-1.32, 1.55, -4.15];
const PLAQ_W = 192, PLAQ_H = 112, PLAQ_WW = 1.45;
const MACH: V3 = [-3.45, 0, -3.2];
const HYPE = /hype|genius|smart|tweet|tiktok|trend/i;

type Card = { mesh: THREE.Mesh; y: number; x: number; t: number; h: number; tail?: boolean };

export default class Pre extends Ps1Stage {
  private n = 1;
  private L0: Line | null = null; private L1!: Line; private L2!: Line; private L3!: Line;
  private D: number[] = [];
  private tRoom = 0; private tPlaque = 0; private tWide = 0; private tMach = 0; private tZoom = 0;
  private cards: Card[] = [];
  private tail: { words: Word[]; tex: ReturnType<typeof canvasTex>; key: string } | null = null;
  private room!: Room; private dev!: Dev; private bot!: BotHead;
  private plaque!: ReturnType<Ps1Stage['panel']>;
  private titles: { obj: ReturnType<Ps1Stage['blockTitle']>; t: number; at: V3 }[] = [];
  private machine!: ReturnType<typeof makeSlopMachine>;
  private goo: { obj: ReturnType<Ps1Stage['blockTitle']>; t: number }[] = [];
  private belt = { a: new THREE.Vector3(), b: new THREE.Vector3() };
  private shavings!: ReturnType<Ps1Stage['dustBurst']>;
  private kicks: number[] = [];
  private screenKey = '';

  override init() {
    const { lyrics: ly, audio: au, start, end } = this.ctx;
    this.n = (this.ctx.params.n as number) ?? 1;
    const k = this.n - 1;
    this.L1 = ly.get(this.n === 1 ? 'So go ahead and hype it' : 'So go ahead and tweet it');
    this.L2 = ly.get("I'll be over here hand-typing", k);
    this.L3 = ly.get("It's slop, it's slop", k);
    const prev = ly.lines[this.L1.i - 1];
    this.L0 = prev && prev.end > start ? prev : null;
    this.D = au.downbeats.filter((d) => d >= start - 0.02 && d <= end + 0.02);
    while (this.D.length < 7) this.D.push((this.D[this.D.length - 1] ?? start) + 1.39);
    this.tRoom = this.D[2]!;
    this.tPlaque = Math.min(this.L2.words[0]!.start - 0.1, this.L1.end + 0.02);
    this.tWide = this.D[4]!;
    this.tMach = this.L3.words[0]!.start - 0.12;
    this.tZoom = this.D[5]!;
    this.kicks = au.events('kick', start, end).map((e) => e[0]);
    this.fogColor = P.fog; this.fogNear = 5; this.fogFar = 16;
    this.buildFeed();
    this.buildRoom();
  }

  // ------------------------------------------------------------------ the feed
  private buildFeed() {
    const style = this.n === 1 ? 'post' : 'video';
    let y = 0, side = 0;
    const add = (mesh: THREE.Mesh, h: number, t: number, tail = false) => {
      const x = tail ? 0 : side++ % 2 ? 0.3 : -0.3;
      y += h / 2;
      mesh.position.set(FX + x, y, 0);
      mesh.rotation.y = tail ? 0 : x > 0 ? -0.12 : 0.12;
      this.world.add(mesh);
      this.cards.push({ mesh, y, x, t, h, tail });
      y += h / 2 + 0.12;
    };
    // the previous line's held tail, as the first post
    if (this.L0) {
      const words = this.L0.words.filter((w) => w.end > this.ctx.start - 1.6).slice(this.n === 1 ? -3 : -5);
      const tex = canvasTex(160, 96, () => {});
      this.tail = { words, tex, key: '' };
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.32, 2, 2), psMat({ map: tex.tex, unlit: true, fog: 0.3, side: THREE.DoubleSide }));
      add(m, 1.32, -Infinity, true);
      if (this.n === 2) {
        // the roundabout's ring from v2-roads, spinning down into the feed like a scroll wheel
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.09, 4, 20), psMat({ color: P.title, emit: '#403010' }));
        ring.position.set(FX, 0.66, 0.2); ring.name = 'ring'; this.world.add(ring);
      }
    }
    // slop / hype posts between the word posts (they scroll in just ahead of the next word)
    const decor = (kind: number, t: number) => {
      const tex = canvasTex(CARD_W, 72, (c) => drawDecorCard(c, kind, style)).tex;
      add(new THREE.Mesh(new THREE.PlaneGeometry(CW, CW * (72 / CARD_W), 2, 2), psMat({ map: tex, unlit: true, fog: 0.3, side: THREE.DoubleSide })), CW * (72 / CARD_W), t);
    };
    const w1 = this.L1.words;
    // (no opening slop post while the previous line's tail is still being sung on the first card)
    if (!this.L0 || this.L0.end < w1[0]!.start - 0.6) decor(this.n === 1 ? 0 : 1, lerp(this.ctx.start, w1[0]!.start, 0.45));
    w1.forEach((w, i) => {
      if (i === 4 || i === 9) decor(i === 4 ? (this.n === 1 ? 1 : 2) : (this.n === 1 ? 3 : 0), (w1[i - 1]!.start + w.start) / 2);
      const tex = canvasTex(CARD_W, CARD_H, (c) => drawWordCard(c, w.w, i + this.n * 20, style, HYPE.test(w.w))).tex;
      add(new THREE.Mesh(new THREE.PlaneGeometry(CW, CH, 2, 2), psMat({ map: tex, unlit: true, fog: 0.3, side: THREE.DoubleSide })), CH, w.start);
    });
    // the app's backdrop: a navy gradient with a faint grid, scrolling with the feed
    const bgT = canvasTex(32, 64, (c) => {
      for (let y = 0; y < 64; y++) { c.fillStyle = y % 16 === 0 ? '#2A3C6E' : `rgb(${20 + y * 0.3},${27 + y * 0.5},${58 + y * 0.9})`; c.fillRect(0, y, 32, 1); }
      c.fillStyle = '#22325E'; c.fillRect(0, 0, 1, 64); c.fillRect(16, 0, 1, 64);
    }, true).tex;
    const bgG = new THREE.PlaneGeometry(24, 40, 2, 4);
    const buv = bgG.attributes.uv!; for (let i = 0; i < buv.count; i++) buv.setXY(i, buv.getX(i) * 6, buv.getY(i) * 5);
    const back = new THREE.Mesh(bgG, psMat({ map: bgT, unlit: true, fog: 0.2 }));
    back.position.set(FX, 12, -6); back.name = 'feedBack'; this.world.add(back);
    // two blurry feed columns behind, for depth
    const blank = canvasTex(32, 18, (c) => { c.fillStyle = this.n === 1 ? '#C8C4BA' : '#1A2036'; c.fillRect(0, 0, 32, 18); c.fillStyle = this.n === 1 ? '#9A968C' : '#2E3654'; c.fillRect(2, 2, 6, 6); c.fillRect(10, 3, 18, 2); c.fillRect(3, 11, 26, 5); }).tex;
    for (const bx of [-3.4, 3.4]) for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), psMat({ map: blank, unlit: true }));
      m.position.set(FX + bx, i * 1.05 + (bx > 0 ? 0.5 : 0), -3);
      m.userData.speed = bx > 0 ? 1 : 0.7;
      m.userData.y0 = m.position.y;
      m.name = 'bg';
      this.world.add(m);
    }
  }

  // ------------------------------------------------------------------ DEV's room, the workbench, the machine
  private buildRoom() {
    this.room = makeRoom();
    this.world.add(this.room.root);
    this.dev = makeDev();
    this.dev.sit(true);
    this.dev.root.position.copy(this.room.seat);
    this.world.add(this.dev.root);
    // craftsman's dressing: a leather apron, a vise, a mallet
    const apron = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.5, 0.04), psMat({ color: '#7A4A2A' }));
    apron.position.set(0, 0.25, -0.17); this.dev.torso.add(apron);
    const vise = new THREE.Group();
    const vm = psMat({ color: '#4A5068' });
    for (const [w, h, d, x, y] of [[0.22, 0.14, 0.18, 0, 0.07], [0.06, 0.14, 0.2, -0.09, 0.2], [0.06, 0.14, 0.2, 0.09, 0.2], [0.3, 0.03, 0.03, 0, 0.2]] as const) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), vm); m.position.set(x, y, 0); vise.add(m);
    }
    vise.position.set(0.72, 0.8, -3.05); this.world.add(vise);
    this.shavings = this.dustBurst(10, '#D9A55A', 0.035);
    // the brass plaque on the wall, typed as sung
    this.plaque = this.panel(PLAQ_W, PLAQ_H).inWorld();
    this.plaque.mesh.position.set(...PLAQ);
    this.plaque.mesh.scale.set(PLAQ_WW, PLAQ_WW * (PLAQ_H / PLAQ_W), 1);
    // block titles over the bench
    if (this.n === 1) {
      const craft = this.L2.words.find((w) => /craft/i.test(w.w)), art = this.L2.words.find((w) => /art!/i.test(w.w));
      if (craft) this.titles.push({ obj: this.blockTitle('CRAFT'), t: craft.start, at: [PLAQ[0] + 0.36, PLAQ[1] + 0.2, PLAQ[2] + 0.2] });
      if (art) this.titles.push({ obj: this.blockTitle('ART!'), t: art.start, at: [PLAQ[0] + 0.4, PLAQ[1] + 0.04, PLAQ[2] + 0.24] });
    } else {
      const ten = this.L2.words.find((w) => /twenty-ten/i.test(w.w));
      if (ten) this.titles.push({ obj: this.blockTitle('2010', { cap: P.bot, side: P.uiNavy }), t: ten.start, at: [PLAQ[0] + 0.38, PLAQ[1] + 0.2, PLAQ[2] + 0.2] });
    }
    for (const ti of this.titles) { ti.obj.root.scale.setScalar(0.1); ti.obj.root.rotation.z = 0.12; }
    // the SLOP MACHINE, its sign and the footnote
    const big = this.n === 2 ? 1.3 : 1;
    const goo = this.n === 1 ? '#A8B84A' : P.fail;
    this.machine = makeSlopMachine(goo);
    this.machine.root.position.set(...MACH);
    this.machine.root.scale.setScalar(big);
    this.world.add(this.machine.root);
    this.bot = makeBotHead(this.n === 1 ? 'v1.0' : 'v3.0');
    this.bot.root.position.set(MACH[0] + 0.1 * big, 1.25 * big, MACH[2]);
    this.bot.root.rotation.y = Math.PI / 2;
    this.bot.root.scale.setScalar(1.1 * big);
    this.world.add(this.bot.root);
    const sign = canvasTex(96, 16, (c) => {
      c.fillStyle = P.uiEdge; c.fillRect(0, 0, 96, 16); c.fillStyle = P.fail; c.fillRect(1, 1, 94, 14);
      pixText(c, 'SLOP MACHINE', 48 - textW('SLOP MACHINE') / 2, 5, P.uiLine, 1, { shadow: P.failSide });
    });
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.18), psMat({ map: sign.tex, unlit: true, fog: 0.4 }));
    sm.position.set(MACH[0] + 0.56 * big, 0.95 * big, MACH[2]); sm.rotation.y = Math.PI / 2;
    this.world.add(sm);
    const note = this.label('Merriam-Webster Word of the Year 2025: slop', P.uiLine, P.uiNavy, 1, 1 / 70);
    note.position.set(MACH[0] + 0.8, 1.72 * (this.n === 2 ? 1.25 : 1), MACH[2] + 0.35);
    note.name = 'note';
    // the conveyor from the nozzle to the desk
    this.belt.a.set(MACH[0] + this.machine.nozzle.x * big, this.machine.nozzle.y * big - 0.08, MACH[2]);
    this.belt.b.set(-0.95, 0.82, MACH[2]);
    const len = this.belt.a.distanceTo(this.belt.b);
    const beltM = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.5), psMat({ color: '#2E3348' }));
    beltM.position.copy(this.belt.a).add(this.belt.b).multiplyScalar(0.5);
    beltM.rotation.z = Math.atan2(this.belt.b.y - this.belt.a.y, this.belt.b.x - this.belt.a.x);
    this.world.add(beltM);
    for (let i = 0; i < 4; i++) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.05), psMat({ color: '#4A5068' }));
      const u = (i + 0.5) / 4;
      leg.position.set(lerp(this.belt.a.x, this.belt.b.x, u), lerp(this.belt.a.y, this.belt.b.y, u) - 0.32, MACH[2] + (i % 2 ? 0.2 : -0.2));
      this.world.add(leg);
    }
    // the goo words, one per word of line 3
    this.L3.words.forEach((w) => {
      if (w.start > this.ctx.end + 0.1) return;
      const obj = this.blockTitle(w.w.toUpperCase(), { cap: goo, side: this.n === 1 ? '#6A7A2A' : P.failSide, depth: 0.5, tracking: 0.02 });
      obj.root.scale.setScalar(0.15 * big);
      this.goo.push({ obj, t: w.start });
    });
  }

  // ------------------------------------------------------------------ camera
  camAt(t: number): CamState {
    if (t < this.tRoom) {
      // climb the feed: the camera settles on each new post
      const on = this.cards.filter((c) => t >= c.t - 0.05);
      const cur = on[on.length - 1] ?? this.cards[0]!;
      const prev = on[on.length - 2] ?? cur;
      const e = ease.outExpo(clamp((t - cur.t + 0.05) / 0.25));
      const y = lerp(prev.y, cur.y, cur.t === -Infinity ? 1 : e) - (cur.tail ? 0 : 0.35);
      const x = lerp(prev.x, cur.x, e) * 0.5;
      const k = on.length;
      const dist = cur.tail ? 2.1 : 2.55;
      const intro = ease.outExpo(clamp((t - this.ctx.start) / 0.5));
      return { P: [FX + x + 0.25 * Math.sin(t * 1.4), y + 0.35, dist + 0.6 * (1 - intro)], T: [FX + x * 0.8, y + 0.28, 0], roll: (k % 2 ? 0.05 : -0.05) * (1 - 0.5 * e) + 0.1 * (1 - intro), fov: 52 };
    }
    const s = this.room.screenPos;
    const crt: CamState = { P: [s.x, s.y, s.z + 0.43], T: [s.x, s.y, s.z], fov: 52 };
    const plaque: CamState = { P: [PLAQ[0] + 0.18, PLAQ[1] + 0.06, PLAQ[2] + 1.05], T: [PLAQ[0] + 0.03, PLAQ[1] + 0.05, PLAQ[2]], fov: 52, roll: -0.03 };
    const plaque2: CamState = { P: [PLAQ[0] - 0.12, PLAQ[1] + 0.04, PLAQ[2] + 1.1], T: [PLAQ[0] + 0.02, PLAQ[1] + 0.02, PLAQ[2]], fov: 52, roll: 0.03 };
    const mach: CamState = { P: [-1.15, 1.55, -1.45], T: [-2.45, 0.95, -3.2], fov: 52, roll: -0.04 };
    const zoom: CamState = { P: [-1.45, 1.1, -2.2], T: [-1.95, 0.78, -3.2], fov: 52, roll: 0.05 };
    const desk: CamState = { P: [-0.1, 1.45, -1.55], T: [-0.8, 0.95, -3.25], fov: 52 };
    // out of the CRT: a slow drift back while the line's last posts are still on it, then a whip to the
    // plaque (line 2 is typed there, held readable), a reframe across it on the next downbeat
    const near: CamState = { P: [s.x + 0.05, s.y + 0.02, s.z + 0.62], T: [s.x, s.y, s.z], fov: 52, roll: 0.03 };
    let c = mixCam(crt, near, ease.outQuad(clamp((t - this.tRoom) / Math.max(0.2, this.L1.end - this.tRoom))));
    c = mixCam(c, plaque, ease.outExpo(clamp((t - (this.tPlaque - 0.06)) / 0.24)));
    c = mixCam(c, plaque2, ease.inOutCubic(clamp((t - this.tWide) / 0.5)));
    c = mixCam(c, mach, ease.outExpo(clamp((t - this.tMach) / 0.24)));
    c = mixCam(c, zoom, ease.outExpo(clamp((t - this.tZoom) / 0.2)));
    c = mixCam(c, desk, ease.inOutCubic(clamp((t - (this.tZoom + 0.55)) / (this.ctx.end - this.tZoom - 0.6))));
    // a push on every kick of the room section
    const k = this.kicks.filter((x) => x <= t && x > this.tRoom).pop();
    if (k !== undefined) {
      const push = 0.05 * (1 - ease.outExpo(clamp((t - k) / 0.15)));
      c.P = [lerp(c.P[0], c.T[0], push), lerp(c.P[1], c.T[1], push), lerp(c.P[2], c.T[2], push)];
    }
    return c;
  }

  // ------------------------------------------------------------------ frame
  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    this.begin();
    const t = f.t;
    const inFeed = t < this.tRoom;
    // feed
    for (const c of this.cards) {
      const u = t - c.t;
      c.mesh.visible = inFeed && u > -0.05;
      if (!c.mesh.visible) continue;
      const pop = c.tail ? 1 : clamp(springStep(u + 0.05, 3.2, 0.4), 0, 1.3);
      c.mesh.scale.set(pop, pop, 1);
    }
    this.world.getObjectByName('feedBack')!.visible = inFeed;
    const ring = this.world.getObjectByName('ring');
    if (ring) {
      const u = clamp((t - this.ctx.start) / 0.4);
      ring.visible = u < 1;
      ring.scale.setScalar(lerp(1.4, 0.05, ease.inCubic(u)));
      ring.rotation.set(0, 0, t * 8);
    }
    this.world.children.forEach((o) => {
      if (o.name !== 'bg') return;
      o.visible = inFeed;
      o.position.y = (o.userData.y0 as number) - ((t * 1.3 * (o.userData.speed as number)) % 2.1);
    });
    if (this.tail && inFeed) this.drawTail(t);

    // room
    this.room.root.visible = this.dev.root.visible = !inFeed;
    this.world.getObjectByName('note')!.visible = !inFeed && t > this.tMach;
    this.plaque.mesh.visible = !inFeed;
    if (!inFeed) {
      const typing = t > this.tPlaque && t < this.tMach + 0.3;
      this.dev.setFace(t < this.tPlaque ? 'smug' : t < this.tMach ? 'smug' : 'neutral');
      this.dev.head.rotation.y = t < this.tPlaque ? 0.25 * Math.sin(t * 5) : 0; // shaking his head at the feed
      const tap = typing ? Math.sin(t * 38) : 0;
      this.dev.armL.rotation.set(1.25 + 0.12 * tap, 0, 0.1);
      this.dev.armR.rotation.set(1.25 - 0.12 * tap, 0, -0.1);
      if (t < this.tPlaque) { this.dev.armR.rotation.set(1.1, 0, -0.25); this.dev.armR.rotation.x += 0.08 * Math.sin(t * 9); } // scrolling
      const kk = this.kicks.filter((x) => x <= t && x > this.tPlaque).pop();
      this.shavings.update(t, kk ?? -9, [0, 0.86, -3.0], 0.05, 0.4);
      this.drawPlaque(t);
      this.drawScreen(t);
      for (const ti of this.titles) {
        const u = t - ti.t;
        // (the plaque now fills the frame and carries the key words in red: the block titles stay off)
        ti.obj.root.visible = false;
        if (!ti.obj.root.visible) continue;
        const d = ease.outBack(clamp((u + 0.08) / 0.2), 2);
        ti.obj.root.position.set(ti.at[0], ti.at[1] + 1.2 * (1 - d), ti.at[2]);
        ti.obj.letters.forEach((l, i) => (l.position.y = 0.08 * Math.sin(t * 7 - i * 0.7)));
      }
      // the machine: the crank turns, the bot talks as it extrudes, each word squeezes out and rides the belt
      const big = this.n === 2 ? 1.3 : 1;
      this.machine.crank.rotation.y = t * 6;
      const lastGoo = this.goo.filter((g) => g.t <= t).pop();
      const talking = lastGoo && t - lastGoo.t < 0.14;
      this.bot.setFace(t < this.tMach ? 'happy' : talking ? 'talk' : 'happy', Math.floor(t * 12));
      this.machine.root.position.y = MACH[1] + (talking ? 0.02 * Math.sin(t * 60) : 0);
      const dir = new THREE.Vector3().subVectors(this.belt.b, this.belt.a);
      const len = dir.length(); dir.normalize();
      this.goo.forEach((g, i) => {
        const u = t - g.t;
        g.obj.root.visible = u >= 0;
        if (!g.obj.root.visible) return;
        const w = g.obj.width * 0.15 * big;
        const squeeze = clamp(u / 0.12);
        // each word stops at its own place on the desk (earlier words pushed further along)
      const stop = len + 0.2 + 0.42 * Math.min(2, this.goo.length - 1 - i);
      const along = Math.min(u * 2.6, stop) + (w / 2) * squeeze;
        const onDesk = along > len;
        const p = new THREE.Vector3().copy(this.belt.a).addScaledVector(dir, Math.min(along, len));
        let y = p.y + 0.02;
        let x = p.x, z = p.z + ((i % 3) - 1) * 0.17;
        if (onDesk) { x = this.belt.b.x + (along - len) * 0.7; y = 0.82; z += (i % 3) * 0.12 - 0.12; }
        const jelly = 1 + 0.12 * Math.sin(u * 22) * Math.exp(-u * 4);
        g.obj.root.position.set(x, y, z);
        g.obj.root.rotation.set(0, 0.35, Math.atan2(dir.y, dir.x) * (onDesk ? 0 : 1));
        g.obj.root.scale.set(0.15 * big * squeeze * jelly, 0.15 * big / jelly, 0.15 * big);
      });
    }
    return this.present(f, out);
  }

  private drawTail(t: number) {
    const tl = this.tail!;
    const on = tl.words.map((w) => t >= w.start);
    const key = on.join('');
    if (key === tl.key) return;
    tl.key = key;
    // rows of at most 12 chars at 2x
    const rows: { w: string; on: boolean }[][] = [[]];
    let n = 0;
    tl.words.forEach((w, i) => {
      if (n > 0 && n + 1 + w.w.length > 12) { rows.push([]); n = 0; }
      rows[rows.length - 1]!.push({ w: w.w, on: on[i]! }); n += (n ? 1 : 0) + w.w.length;
    });
    drawTailCard(tl.tex.ctx, rows, this.n === 1 ? 'post' : 'video');
    tl.tex.tex.needsUpdate = true;
  }

  private drawPlaque(t: number) {
    // "twenty-ten" is set as 2010 on the plaque (same word timing)
    const words = this.L2.words.map((w) => (/twenty-ten/i.test(w.w) ? { ...w, w: w.w.replace(/twenty-ten/i, '2010') } : w));
    const r = typeWords(null, words, t, 10, 12, { scale: 2, maxChars: 15, rowH: 16 });
    this.plaque.draw(r.key, (c) => {
      drawPlaque(c, PLAQ_W, PLAQ_H);
      const rows = r.rows;
      typeWords(c, words, t, 10, 104 / 2 - (rows * 16) / 2 + 2, { scale: 2, maxChars: 15, rowH: 16, color: '#3A2608', shadow: '#E8C766', key: (w) => /craft|art|2010/i.test(w.w), keyColor: P.failSide });
    });
  }

  /** The CRT: the feed (latest word) as the camera pulls out of it, then the editor (pre 2: a 2010 desktop). */
  private drawScreen(t: number) {
    const ws = this.L1.words;
    const lastW = ws.filter((w) => t >= w.start).pop();
    const ten = this.L2.words.find((w) => /twenty-ten/i.test(w.w));
    const mode = t < this.L1.end + 0.1 ? `feed${lastW?.index}` : this.n === 2 && ten && t >= ten.start ? 'os' : `code${Math.floor(Math.max(0, t - this.L1.end) * 6)}`;
    if (mode === this.screenKey) return;
    this.screenKey = mode;
    const c = this.room.screen.ctx;
    if (mode.startsWith('feed')) {
      c.fillStyle = this.n === 1 ? '#E6E2D8' : '#0B0E18'; c.fillRect(0, 0, 128, 96);
      const last3 = ws.filter((w) => t >= w.start).slice(-3);
      last3.forEach((w, i) => {
        const y = 4 + i * 31;
        c.fillStyle = this.n === 1 ? '#F4F1EA' : '#1A2036'; c.fillRect(4, y, 120, 28);
        pixText(c, w.w, 10, y + 7, HYPE.test(w.w) ? P.failSide : this.n === 1 ? P.ink : P.uiLine, 2);
      });
    } else if (mode === 'os') {
      // an original old desktop: a teal field, chunky icons, a grey taskbar and a window
      c.fillStyle = '#2F7F86'; c.fillRect(0, 0, 128, 96);
      for (let i = 0; i < 3; i++) { c.fillStyle = '#E8E4D8'; c.fillRect(6, 6 + i * 20, 12, 10); pixText(c, ['code', 'mp3', 'blog'][i]!, 4, 18 + i * 20, P.uiLine); }
      c.fillStyle = '#C0C0C0'; c.fillRect(30, 16, 90, 58); c.fillStyle = '#1E3A8A'; c.fillRect(31, 17, 88, 9); pixText(c, 'notepad.exe', 34, 18, P.uiLine);
      c.fillStyle = '#FFFFFF'; c.fillRect(33, 28, 84, 44); pixText(c, 'hello world', 36, 32, P.ink); pixText(c, '2010', 36, 44, P.fail);
      c.fillStyle = '#C0C0C0'; c.fillRect(0, 86, 128, 10); c.fillStyle = '#3F7A5A'; c.fillRect(1, 87, 22, 8); pixText(c, 'go', 6, 88, P.uiLine);
    } else {
      const n = Number(mode.slice(4));
      c.fillStyle = '#10162A'; c.fillRect(0, 0, 128, 96);
      const lines = ['fn craft() {', '  // by hand', '  let art = 1;', '  return art;', '}'];
      let chars = n;
      lines.forEach((l, i) => {
        const s = l.slice(0, Math.max(0, chars)); chars -= l.length;
        pixText(c, String(i + 1), 3, 5 + i * 11, '#3A4670');
        pixText(c, s, 14, 5 + i * 11, i === 1 ? P.uiDim : P.uiLine);
      });
    }
    this.room.screen.tex.needsUpdate = true;
  }
}

function mixCam(a: CamState, b: CamState, k: number): CamState {
  const m = (x: V3, y: V3): V3 => [lerp(x[0], y[0], k), lerp(x[1], y[1], k), lerp(x[2], y[2], k)];
  return { P: m(a.P, b.P), T: m(a.T, b.T), roll: lerp(a.roll ?? 0, b.roll ?? 0, k), fov: lerp(a.fov ?? 52, b.fov ?? 52, k) };
}
