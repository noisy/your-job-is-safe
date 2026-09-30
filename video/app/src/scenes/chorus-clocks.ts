// #7 / #14 / #20 chorus-clocks (docs/TREATMENT.md): the clock shop where every clock the chatbot draws says
// 10:10. The sung words ARE the clock numerals: line 1 lights up in the hour slots of the giant wall clock
// (in chorus 1 "ten" sits where the hour hand points and "ten," where the minute hand points: the hands read
// the lyric), line 2 on the row of six word-clocks over DEV's hammock, line 3 one word per digit of the hand
// the image generator grows (six digits; the final chorus: five, and "me," on the palm).
//   v: 1       chorus 1: everything frozen at 10:10, DEV smug in the hammock, laughing at the six-fingered hand.
//   v: 2       the same, while the fails get fixed behind DEV's back: one clock's second hand twitches, the
//              hand has five fingers for exactly one frame, the chatbot is v3.0.
//   v: 'final' the mirror: the clocks tick fine and sweep into a countdown to DEADLINE, the hammock is empty,
//              the hourglass has run out, the hand (five fingers) waves DEV bye and grips a cardboard box.
// In: the previous scene's rim circle / wine drip becomes the giant clock face. Out: v1/v2 the palm fills the
// frame and goes dark (DEV's dark bedroom, chorus-sleep); final: the hand closes on the box (chorus-sleep final).
import * as THREE from 'three';
import type { Frame } from '../engine/scene';
import type { Line, Word } from '../engine/lyrics';
import { clamp, ease, keys, lerp, prog, springStep, frameIdx, type Key } from '../engine/util';
import { Ps1Stage, type CamState, type V3, uiBox, windowOpen } from '../ps1/stage';
import { makeDev, type Dev } from '../ps1/cast';
import { pixText, textW, psGlobals, psMat } from '../ps1/gfx';
import { P } from '../ps1/palette';
import {
  wordTex, decal, makeBigClock, handAngle, makeShopRoom, makeClockWall, makeHammock, makeGrandfather, makeHourglass,
  makeGenCrt, makeHand, makeCardboardBox, type BigClock, type WallClock, type Hand,
} from './chorus-clocks-set';

type Ver = 1 | 2 | 'final';

// ---------------------------------------------------------------- layout (world units; floor y = 0, wall z = -4.3)
const G: V3 = [0, 3.3, -4.05]; // giant clock centre
const GR = 2.4;
const ROW = { x0: 2.95, dx: 1.2, y: 3.35, z: -4.12, r: 0.55 };
const HAM = { x0: 3.0, x1: 8.7, y: 2.05, z: -3.3 };
const CRT: V3 = [-0.9, 0, -0.9]; // counter position (in front of the giant clock)
const COUNTER_H = 0.95;
const DEV_FRONT: V3 = [1.55, 0, 2.6];
const WORD_TEXEL = 0.03;
/** The sung word's plate: a brighter blue than the navy of the words already sung (bone-white text, dark shadow). */
const HOT_PLATE = '#3A74E0';
const HAND_S = 1.6; // giant-clock word decals
const ROW_TEXEL = 0.0145;

interface Lit { w: Word; hot: THREE.Mesh; done: THREE.Mesh; at: [number, number]; base: number }

export default class ChorusClocks extends Ps1Stage {
  v: Ver = 1;
  big!: BigClock;
  wall: WallClock[] = [];
  rowClocks: { root: THREE.Group; hour: THREE.Object3D; minute: THREE.Object3D; second: THREE.Object3D; face: THREE.Object3D }[] = [];
  bigWords: Lit[] = [];
  rowWords: Lit[] = [];
  tags: { w: Word; hot: THREE.Mesh; done: THREE.Mesh; num: THREE.Mesh; string: THREE.Mesh; digit: number; x: number }[] = [];
  hand!: Hand;
  handRoot = new THREE.Group();
  crtScreen!: THREE.Mesh;
  devFront!: Dev;
  devHam: Dev | null = null;
  hammock = new THREE.Group();
  glass!: ReturnType<typeof makeHourglass>;
  box = new THREE.Group();
  drips: THREE.Mesh[] = [];
  deadline: ReturnType<Ps1Stage['blockTitle']> | null = null;
  countdown: ReturnType<Ps1Stage['panel']> | null = null;
  sign!: ReturnType<Ps1Stage['panel']>;
  L1!: Line; L2!: Line; L3!: Line;
  db: number[] = [];
  kicks: number[] = [];
  beats: number[] = [];
  handT0 = 0;
  twitchClock = -1;

  override async init() {
    const { lyrics: ly, audio: au, start, end, params } = this.ctx;
    this.v = (params.v ?? 1) as Ver;
    const fin = this.v === 'final', nth = this.v === 2 ? 1 : 0;
    this.L1 = fin ? ly.get('Every clock is ticking fine') : ly.get('Every clock says ten past ten', nth);
    this.L2 = fin ? ly.get('Counting down to my deadline') : ly.get("So I've got plenty of time", nth);
    this.L3 = fin ? ly.get('Five fingers waving bye to me') : ly.get('Six fingers waving hi at me', nth);
    this.db = au.downbeats.filter((d) => d >= start - 0.02 && d <= end + 0.02);
    while (this.db.length < (fin ? 7 : 6)) this.db.push(this.db[this.db.length - 1]! + 1.39);
    this.kicks = au.events('kick', start, end).map((e) => e[0]);
    this.beats = au.beats.filter((b) => b >= start - 0.5 && b <= end + 0.5);
    this.fogColor = '#141B2E'; this.fogNear = 6; this.fogFar = 22;
    // the hand rises on the downbeat before its line
    this.handT0 = this.db[fin ? 4 : 3]!;

    this.world.add(makeShopRoom());
    // the giant clock, its word decals
    this.big = makeBigClock(GR, P.title);
    this.big.root.position.set(...G);
    this.world.add(this.big.root);
    this.setTime(this.big, 10, 10, 30);
    const slots = fin ? [7, 8, 9, 10, 12] : [7, 8, 9, 10, 12, 2];
    this.L1.words.forEach((w, i) => { if (slots[i]) this.bigWords.push(this.litWord(w, this.big.root, this.slotPos(slots[i]!, textW(w.w, 2) + 8), WORD_TEXEL, 0.2)); }); // (in front of the rim, which sticks out of the face)
    // the wall of clocks and the shop sign
    const wall = makeClockWall([[-3.0, 0.3, 3.0, 6.3], [2.2, 0, 9.6, 4.5]]);
    this.wall = wall.clocks; this.world.add(wall.root);
    this.twitchClock = this.wall.reduce((best, c, i) => (Math.abs(c.x + 3.6) + Math.abs(c.y - 3.2) < Math.abs(this.wall[best]!.x + 3.6) + Math.abs(this.wall[best]!.y - 3.2) ? i : best), 0);
    this.sign = this.panel(120, 34).inWorld();
    this.sign.hang = null;
    this.sign.mesh.position.set(-6.3, 1.45, -4.15);
    this.sign.mesh.scale.set(120 * 0.03, 34 * 0.03, 1);
    const ver = this.v === 1 ? 'v1.0' : this.v === 2 ? 'v3.0' : 'v5.0';
    this.sign.draw('sign', (c) => {
      uiBox(c, 0, 0, 120, 34);
      pixText(c, `CHATBOT CLOCKS ${ver}`, 6, 4, P.key2);
      pixText(c, 'YOU ASKED: 4:35', 6, 14, P.uiLine);
      pixText(c, 'YOU GOT:', 6, 23, P.uiLine);
      pixText(c, fin ? '4:35 ✓' : '10:10', 6 + textW('YOU GOT: '), 23, fin ? P.fix : P.fail);
    });
    // the row of word clocks, the grandfather clocks and the hammock
    this.L2.words.forEach((w, i) => {
      const x = ROW.x0 + i * ROW.dx;
      const root = new THREE.Group(); root.position.set(x, ROW.y, ROW.z); this.world.add(root);
      const ck = makeBigClock(ROW.r, i % 2 ? '#B8B8C8' : '#C9A24A');
      ck.numerals.forEach((n, h) => { if (h === 12) n.visible = false; });
      root.add(ck.root);
      this.setTime(ck, 10, 10, 30);
      this.rowClocks.push({ root, hour: ck.hour, minute: ck.minute, second: ck.second, face: ck.root });
      this.rowWords.push(this.litWord(w, root, [0, ROW.r * 0.3], ROW_TEXEL, 0.24));
    });
    for (const x of [HAM.x0 - 0.35, HAM.x1 + 0.35]) { const gf = makeGrandfather(); gf.root.position.set(x, 0, HAM.z - 0.2); this.world.add(gf.root); }
    // the hammock swings about its rope line; DEV (v1 smug, v2 asleep) lies along it, sagging with it
    const net = makeHammock(HAM.x0, HAM.x1, HAM.y, HAM.z, 0.85);
    net.position.set(0, -(HAM.y + 0.2), -HAM.z);
    this.hammock.add(net);
    this.hammock.position.set(0, HAM.y + 0.2, HAM.z);
    this.world.add(this.hammock);
    this.glass = makeHourglass();
    const midX = (HAM.x0 + HAM.x1) / 2, sagY = HAM.y - 0.85 - (HAM.y + 0.2);
    if (!fin) {
      const d = makeDev(); d.setFace(this.v === 2 ? 'sleep' : 'smug');
      // on his back (face up), head towards +x: feet at the root, so centre the body on the pivot
      d.root.position.y = -0.72;
      const back = new THREE.Group(); back.rotation.x = Math.PI / 2; back.add(d.root);
      const lay = new THREE.Group(); lay.rotation.y = Math.PI / 2; lay.add(back);
      const holder = new THREE.Group(); holder.add(lay); holder.position.set(midX, sagY + 0.24, 0);
      this.hammock.add(holder);
      // sagging: torso and legs raised out of the dip, knees bent, hands behind the head
      d.torso.rotation.x = -0.32;
      d.legL.rotation.x = d.legR.rotation.x = -0.34;
      for (const lg of [d.legL, d.legR]) { const knee = lg.children.find((c) => c.children.length > 0); if (knee) knee.rotation.x = 0.42; }
      d.legL.rotation.z = 0.05; d.legR.rotation.z = -0.1;
      d.armL.rotation.set(-(Math.PI - 0.4), 0, 0.55); d.armR.rotation.set(-(Math.PI - 0.4), 0, -0.55);
      this.devHam = d;
      // the 10:10 hourglass on his belly
      this.glass.root.position.set(midX - 0.55, sagY + 0.12, 0.3);
      this.hammock.add(this.glass.root);
    } else this.world.add(this.glass.root);
    // the counter with the image generator's CRT, and the hand it grows
    const counter = new THREE.Mesh(new THREE.BoxGeometry(2.6, COUNTER_H, 1.3), [0, 1, 2, 3, 4, 5].map((i) => this.woodMat(i === 2)));
    counter.position.set(CRT[0], COUNTER_H / 2, CRT[2]); this.world.add(counter);
    const crt = makeGenCrt(`img gen ${ver}`, fin ? 'a hand waving bye' : 'a hand waving hi', this.v === 1 ? P.key2 : P.fix);
    crt.root.position.set(CRT[0], COUNTER_H + 0.04, CRT[2] - 0.05);
    this.world.add(crt.root);
    this.crtScreen = crt.screen;
    this.hand = makeHand(fin ? 4 : 5);
    this.handRoot.add(this.hand.root);
    this.hand.root.scale.setScalar(HAND_S);
    this.world.add(this.handRoot);
    // the finger words hang in a row above the hand on strings from their (counted) fingertips
    const TT = 0.018, gap = 0.15;
    const widths = this.L3.words.map((w) => (textW(w.w, 2) + 6) * TT);
    let x = -(widths.reduce((q, v) => q + v, 0) + gap * (widths.length - 1)) / 2;
    const stringM = psMat({ color: P.uiLine, unlit: true });
    this.L3.words.forEach((w, i) => {
      const digit = i < this.hand.digits.length ? i : -1; // the final chorus: the sixth word hangs from the palm
      const hot = this.label(w.w, P.uiLine, HOT_PLATE, 2, TT);
      const done = this.label(w.w, P.uiLine, P.uiNavy, 2, TT);
      const num = this.label(String(i + 1), P.uiLine, P.fail, 1, 0.042);
      const string = new THREE.Mesh(new THREE.BoxGeometry(0.025, 1, 0.025), stringM);
      this.world.add(string);
      this.tags.push({ w, hot, done, num, string, digit, x: x + widths[i]! / 2 });
      x += widths[i]! + gap;
    });
    // DEV in the foreground watching the hand
    this.devFront = makeDev();
    this.devFront.setFace(fin ? 'scared' : 'laugh');
    this.devFront.root.position.set(...DEV_FRONT);
    this.devFront.root.rotation.y = 2.55;
    this.devFront.root.visible = false; // the hand waves at the lens: DEV's point of view
    this.world.add(this.devFront.root);
    if (fin) {
      this.box.add(makeCardboardBox(1.5, 0.9, 1.0));
      this.world.add(this.box);
      // the countdown and DEADLINE over the row
      this.countdown = this.panel(104, 22).inWorld();
      this.countdown.hang = null;
      this.countdown.mesh.position.set(ROW.x0 + 2.5 * ROW.dx, 4.3, -4.1);
      this.countdown.mesh.scale.set(104 * 0.026, 22 * 0.026, 1);
      this.deadline = this.blockTitle('DEADLINE', { cap: P.fail, side: P.failSide });
      this.deadline.root.scale.setScalar(0.62);
      this.deadline.root.position.set(ROW.x0 + 2.5 * ROW.dx, 4.85, -3.9);
      // wine dripping down the clock face (from the previous scene's overflowing glass)
      for (let i = 0; i < 5; i++) {
        const d = new THREE.Mesh(new THREE.BoxGeometry(0.09 + (i % 2) * 0.05, 1, 0.02), this.wineMat());
        this.world.add(d); this.drips.push(d);
      }
    }
  }

  private woodMat(top: boolean) {
    return psMatCached(top ? '#7A5230' : '#5A3620');
  }
  private wineMat() { return psMatCached('#8E1A2A', true); }

  /** A lit-word decal pair (hot = yellow plate while sung, done = ink afterwards) at `at` on `parent`. */
  private litWord(w: Word, parent: THREE.Object3D, at: [number, number], texel: number, z: number): Lit {
    const h = wordTex(w.w, P.uiLine, 2, HOT_PLATE), d = wordTex(w.w, P.uiLine, 2, P.uiNavy);
    const hot = decal(h.tex, h.w, h.h, texel), done = decal(d.tex, d.w, d.h, texel);
    for (const m of [hot, done]) { m.position.set(at[0], at[1], z); parent.add(m); m.visible = false; }
    return { w, hot, done, at, base: 1 };
  }

  /** Where a word of `texels` width sits for hour slot h, kept inside the face. */
  private slotPos(h: number, texels: number): [number, number] {
    const [x, y] = this.big.slot(h, GR * 0.68);
    const half = (texels * WORD_TEXEL) / 2, lim = Math.sqrt(Math.max(0, (GR * 0.92) ** 2 - y * y)) - half;
    return [Math.sign(x) * Math.min(Math.abs(x), Math.max(0, lim)), y];
  }

  private setTime(ck: { hour: THREE.Object3D; minute: THREE.Object3D; second: THREE.Object3D }, h: number, m: number, s: number) {
    ck.hour.rotation.z = handAngle(((h % 12) + m / 60) / 12);
    ck.minute.rotation.z = handAngle((m + s / 60) / 60);
    ck.second.rotation.z = handAngle(s / 60);
  }

  // ---------------------------------------------------------------- camera
  camAt(t: number): CamState {
    if (this.v === 2) return this.cam2(t);
    const d = this.db, fin = this.v === 'final';
    const k = (ks: Key[]) => keys(t, ks);
    const kick = (a: number, b: number, amt: number) => this.kicks.filter((x) => x > a && x < b).reduce((s, x) => s + amt * ease.outExpo(clamp((t - x) / 0.18)), 0);
    const slotW = (h: number): V3 => { const [x, y] = this.big.slot(h, GR * 0.68); return [G[0] + x, G[1] + y, G[2]]; };
    const face = (h: number, D: number, dx = 0): { P: V3; T: V3 } => { const s = slotW(h); return { P: [s[0] * 0.8 + dx, s[1] - 0.05, G[2] + D], T: [s[0] * 0.92, s[1], G[2]] }; };
    const mixC = (a: { P: V3; T: V3 }, b: { P: V3; T: V3 }, u: number) => ({ P: a.P.map((x, i) => lerp(x, b.P[i]!, u)) as V3, T: a.T.map((x, i) => lerp(x, b.T[i]!, u)) as V3 });
    const rowAt = (i: number): V3 => [ROW.x0 + i * ROW.dx, ROW.y, ROW.z];
    if (t < d[1]!) {
      // A: the clock face, head on (the previous scene's circle), then along the numerals as they light
      const whole = { P: [0, G[1], G[2] + lerp(11, 6.0, ease.outExpo(prog(t, d[0]!, d[0]! + 0.5)))] as V3, T: G };
      if (fin) {
        const u = prog(t, d[0]!, d[1]!, ease.inOutCubic);
        const c = mixC(whole, face(8, 4.2, -0.6), u);
        return { ...c, roll: lerp(0, 0.05, u), fov: 52 };
      }
      const w = this.L1.words;
      const tTen = w[3]!.start, tPast = w[4]!.start;
      if (t < tTen - 0.28) { const u = prog(t, d[0]!, tTen - 0.28, ease.outCubic); return { ...mixC(whole, { P: [-0.5, G[1], G[2] + 5.1], T: [-0.5, G[1], G[2]] }, u), roll: 0, fov: 52 }; }
      const u1 = prog(t, tTen - 0.28, tTen + 0.05, ease.inOutCubic), u2 = prog(t, tPast - 0.12, tPast + 0.15, ease.inOutCubic), u3 = prog(t, tPast + 0.2, d[1]!, ease.inQuad);
      let c = mixC({ P: [-0.5, G[1], G[2] + 5.1], T: [-0.5, G[1], G[2]] }, face(10, 3.4), u1);
      c = mixC(c, face(12, 3.3), u2);
      c = mixC(c, face(2, 3.5, 0.4), u3);
      return { ...c, roll: lerp(0.06, -0.06, u2 * 0.5 + u3 * 0.5), fov: 52 };
    }
    if (t < d[2]!) {
      if (fin) {
        // B (final): close on the ticking face, riding the numerals of line 1
        const w = this.L1.words;
        const u1 = prog(t, w[2]!.start - 0.2, w[2]!.start + 0.1, ease.inOutCubic), u2 = prog(t, w[3]!.start - 0.2, w[3]!.start + 0.1, ease.inOutCubic), u3 = prog(t, w[4]!.start - 0.2, d[2]!, ease.inOutCubic);
        let c = mixC(face(8, 4.0, -0.4), face(9, 3.5), u1);
        c = mixC(c, face(10, 3.4), u2);
        c = mixC(c, face(12, 3.6), u3);
        return { ...c, roll: 0.04 - 0.08 * u3, fov: 52 };
      }
      // B: close on "ten," (the minute hand's numeral), then a whip to the row: the camera rides the clock of the word sung
      const tenE = this.L1.words[5]!.end;
      const onTen = mixC(face(2, 3.5, 0.4), face(2, 2.9, 0.2), prog(t, d[1]!, tenE, ease.outQuad));
      const c = mixC(onTen, this.rowFollow(t, 0), prog(t, tenE - 0.02, this.L2.words[0]!.start + 0.08, ease.inOutCubic));
      return { ...c, roll: -0.04 * Math.sin(Math.PI * prog(t, tenE - 0.02, this.L2.words[0]!.start + 0.08)), fov: 52 };
    }
    if (t < d[3]!) {
      if (fin) {
        // C (final): wide, every clock ticking, then over to the empty hammock and its row
        const u = prog(t, d[2]!, d[3]!, ease.inOutCubic);
        const c = mixC({ P: [-1.5, 2.4, 6.8], T: [0.5, 3.2, -4] }, { P: [rowAt(0)[0] + 0.1, 2.8, -0.6], T: [rowAt(0)[0] + 0.7, 3.3, ROW.z] }, u);
        return { ...c, roll: 0.03, fov: 52 };
      }
      // C: on the held "plenty" a low hero angle: DEV smug in the hammock under the popped word clock; then the row again
      const w = this.L2.words, pl = w[3]!;
      const mx = (HAM.x0 + HAM.x1) / 2;
      const hero = { P: [mx + 0.9, 3.0, ROW.z + 4.3] as V3, T: [mx + 0.4, 2.6, ROW.z] as V3 };
      const u = prog(t, pl.start + 0.2, pl.start + 0.55, ease.inOutCubic), u2 = prog(t, pl.end - 0.1, w[4]!.start + 0.08, ease.inOutCubic);
      const c = mixC(mixC(this.rowFollow(t, 0), hero, u), this.rowFollow(t, 0), u2);
      c.P[2] -= kick(d[2]!, d[3]!, 0.15);
      return { ...c, roll: 0.05 * u * (1 - u2), fov: 52 };
    }
    if (t < d[4]!) {
      if (fin) {
        // D (final): along the row as the countdown runs out, DEADLINE slams in above it
        const w = this.L2.words;
        const u = prog(t, d[3]!, w[4]!.start, ease.inOutCubic), u2 = prog(t, w[4]!.start - 0.05, d[4]!, ease.outExpo);
        const c = mixC({ P: [rowAt(1)[0] - 0.2, 3.1, -1.0], T: [rowAt(1)[0] + 0.4, 3.35, ROW.z] }, { P: [rowAt(4)[0] - 0.3, 3.2, -0.9], T: [rowAt(4)[0], 3.45, ROW.z] }, u);
        const c2 = mixC(c, { P: [rowAt(2.5)[0], 3.9, 1.9], T: [rowAt(2.5)[0], 4.2, ROW.z] }, u2);
        return { ...c2, roll: 0.05 * (1 - u2), fov: 52 };
      }
      // D: a crash onto "time!", then a whip pan to the CRT as the hand rises out of it
      const w = this.L2.words;
      const u = prog(t, d[3]!, w[5]!.end - 0.05, ease.outCubic), wh = prog(t, w[5]!.end - 0.08, this.L3.words[0]!.start + 0.12, ease.inOutCubic);
      const onTime = { P: [rowAt(5)[0] - 0.15, 3.3, ROW.z + 1.9] as V3, T: [rowAt(5)[0], 3.35, ROW.z] as V3 };
      const onHand = this.handCam(t, 0);
      const c = mixC(mixC(this.rowFollow(t, 0), onTime, u), onHand, wh);
      return { ...c, roll: Math.sin(Math.PI * wh) * 0.12, fov: 52 };
    }
    if (fin && t < d[5]!) {
      // E (final): the hand waving bye (five digits), at the lens
      const u = prog(t, d[4]!, d[5]!, ease.outCubic);
      const c = mixC({ P: [2.6, 1.7, 4.9], T: [-0.6, 2.3, -1.0] }, this.handCam(t, 0.3), u);
      return { ...c, roll: 0.03, fov: 52 };
    }
    // E: the hand waves at the lens (DEV's point of view), then the palm turns
    // to the lens and fills the frame (v1/v2) or the camera drops onto the box it grips (final)
    const a = fin ? d[5]! : d[4]!, b = this.ctx.end;
    const u = prog(t, a, b - 0.8, ease.inOutCubic), push = prog(t, b - 0.8, b, ease.inCubic);
    const p = this.palmWorld();
    const hero = { P: [p.x + lerp(0.9, 0.35, u), p.y + 1.3, p.z + lerp(5.2, 4.7, u)] as V3, T: [p.x + lerp(0.2, 0.05, u), p.y + 1.2, p.z] as V3 };
    const cl = fin
      ? { P: [p.x + 0.3, p.y - 0.2, p.z + 3.0] as V3, T: [p.x, p.y - 0.8, p.z] as V3 }
      : { P: [p.x, p.y + 0.35, p.z + 1.0] as V3, T: [p.x, p.y + 0.35, p.z] as V3 };
    return { ...mixC(hero, cl, push), roll: lerp(-0.05, 0, push) + Math.sin(t * 2) * 0.01, fov: 52 };
  }

  /**
   * A camera riding the row clock of the word being sung (eased from word to word). `style` 0: level, in
   * front (chorus 1); 1: high and to the side, looking down along the row (chorus 2).
   */
  private rowFollow(t: number, style: 0 | 1): { P: V3; T: V3 } {
    const w = this.L2.words;
    let i = 0;
    for (let k = 0; k < w.length; k++) if (w[k]!.start - 0.12 <= t) i = k;
    const e = ease.inOutCubic(prog(t, w[i]!.start - 0.12, w[i]!.start + 0.1));
    const x = ROW.x0 + lerp(Math.max(0, i - 1), i, i === 0 ? 1 : e) * ROW.dx;
    return style === 0
      ? { P: [x - 0.3, ROW.y - 0.15, ROW.z + 3.1], T: [x, ROW.y + 0.05, ROW.z] }
      : { P: [x - 1.3, ROW.y + 1.5, ROW.z + 2.6], T: [x + 0.1, ROW.y + 0.05, ROW.z] };
  }

  /**
   * Chorus 2's own choreography on the same set: a low orbit up across the clock face (words flip in), a tilt
   * down to DEV asleep, the row from high and to the side (words spin in), a dolly into the held "plenty",
   * and the hand from the side of the CRT, orbiting to the front as the finger words drop in.
   */
  private cam2(t: number): CamState {
    const d = this.db;
    const mixC = (a: { P: V3; T: V3 }, b: { P: V3; T: V3 }, u: number) => ({ P: a.P.map((x, i) => lerp(x, b.P[i]!, u)) as V3, T: a.T.map((x, i) => lerp(x, b.T[i]!, u)) as V3 });
    const slotW = (h: number): V3 => { const [x, y] = this.big.slot(h, GR * 0.68); return [G[0] + x, G[1] + y, G[2]]; };
    const kick = (a: number, b: number, amt: number) => this.kicks.filter((x) => x > a && x < b).reduce((s, x) => s + amt * ease.outExpo(clamp((t - x) / 0.18)), 0);
    const w1 = this.L1.words, w2 = this.L2.words, w3 = this.L3.words;
    // slot-aimed shots from below-left, rising
    const onSlot = (h: number, D: number, low: number): { P: V3; T: V3 } => { const s = slotW(h); return { P: [s[0] - 1.2, s[1] - low, G[2] + D], T: [s[0] * 0.95, s[1], G[2]] }; };
    if (t < d[1]!) {
      const low = { P: [G[0] - 4.1, 1.5, G[2] + 4.3] as V3, T: [G[0] - 0.8, G[1] - 0.4, G[2]] as V3 };
      // (the first frames: head on, as chorus-count's rim circle left it; then a drop into the low orbit)
      const whole = { P: [0, G[1], G[2] + 7.5] as V3, T: G };
      let c = mixC(whole, low, prog(t, d[0]!, d[0]! + 0.45, ease.inOutCubic));
      c = mixC(c, onSlot(9, 3.5, 1.1), prog(t, d[0]! + 0.35, w1[3]!.start - 0.1, ease.outCubic));
      c = mixC(c, onSlot(10, 3.2, 0.8), prog(t, w1[3]!.start - 0.15, w1[3]!.start + 0.1, ease.inOutCubic));
      c = mixC(c, onSlot(12, 3.1, 0.5), prog(t, w1[4]!.start - 0.15, w1[4]!.start + 0.1, ease.inOutCubic));
      c = mixC(c, onSlot(2, 3.2, 0.3), prog(t, w1[5]!.start - 0.18, w1[5]!.start + 0.05, ease.inOutCubic));
      return { ...c, roll: lerp(0.12, -0.04, prog(t, d[0]!, d[1]!)) * prog(t, d[0]!, d[0]! + 0.45), fov: 52 };
    }
    const midX = (HAM.x0 + HAM.x1) / 2;
    const topDown = { P: [midX + 0.1, 5.4, HAM.z + 0.35] as V3, T: [midX, 1.2, HAM.z] as V3 };
    if (t < w2[0]!.start - 0.15) {
      // tilt down from "ten," to a map view of DEV asleep in the hammock
      return { ...mixC(onSlot(2, 3.2, 0.3), topDown, prog(t, w1[5]!.end - 0.05, w2[0]!.start - 0.15, ease.inOutCubic)), roll: 0, fov: 52 };
    }
    if (t < w2[5]!.end - 0.05) {
      // the row from high and to the side; the held "plenty" gets a dolly-in from wide
      const pl = w2[3]!;
      let c = mixC(topDown, this.rowFollow(t, 1), prog(t, w2[0]!.start - 0.15, w2[0]!.start + 0.12, ease.inOutCubic));
      const x3 = ROW.x0 + 3 * ROW.dx;
      const wide = { P: [midX, 2.3, ROW.z + 6.2] as V3, T: [midX, 2.55, ROW.z] as V3 }, near = { P: [x3 - 0.1, ROW.y - 0.25, ROW.z + 2.2] as V3, T: [x3, ROW.y + 0.05, ROW.z] as V3 };
      const inPl = prog(t, pl.start - 0.05, pl.start + 0.12, ease.outExpo), push = prog(t, pl.start + 0.1, pl.end, ease.inOutQuad), out = prog(t, pl.end - 0.05, w2[4]!.start + 0.1, ease.inOutCubic);
      c = mixC(c, mixC(wide, near, push), inPl * (1 - out));
      c.P[1] += kick(w2[0]!.start, w2[5]!.end, 0.06);
      return { ...c, roll: -0.08 * (1 - inPl * (1 - out)), fov: 52 };
    }
    // the hand: from the side of the CRT, orbiting round to the front as the words drop in; the palm fills the frame
    const p = this.palmWorld();
    const orbit = prog(t, w2[5]!.end, w3[w3.length - 1]!.start, ease.inOutCubic);
    const ang = lerp(-1.25, 0.18, orbit), R = lerp(4.4, 5.6, orbit);
    const around = { P: [p.x + Math.sin(ang) * R, p.y + lerp(0.6, 1.3, orbit), p.z + Math.cos(ang) * R] as V3, T: [p.x, p.y + lerp(0.7, 1.2, orbit), p.z] as V3 };
    const whip = prog(t, w2[5]!.end - 0.05, w2[5]!.end + 0.4, ease.inOutCubic);
    const x5 = ROW.x0 + 5 * ROW.dx;
    let c = mixC({ P: [x5 - 1.3, ROW.y + 1.5, ROW.z + 2.6], T: [x5 + 0.1, ROW.y + 0.05, ROW.z] }, around, whip);
    const push = prog(t, this.ctx.end - 0.8, this.ctx.end, ease.inCubic);
    c = mixC(c, { P: [p.x, p.y + 0.35, p.z + 1.0], T: [p.x, p.y + 0.35, p.z] }, push);
    return { ...c, roll: Math.sin(Math.PI * whip) * -0.1, fov: 52 };
  }

  /** A camera on the hand: `k` 0 = medium over DEV's shoulder, 1 = close. */
  private handCam(t: number, k: number): { P: V3; T: V3 } {
    const p = this.palmWorld(t);
    const far = { P: [p.x + 1.1, p.y + 1.3, p.z + 6.0] as V3, T: [p.x, p.y + 1.2, p.z] as V3 };
    const near = { P: [p.x + 0.4, p.y + 1.3, p.z + 5.2] as V3, T: [p.x, p.y + 1.2, p.z] as V3 };
    return { P: far.P.map((x, i) => lerp(x, near.P[i]!, k)) as V3, T: far.T.map((x, i) => lerp(x, near.T[i]!, k)) as V3 };
  }

  /** The hand's rise out of the CRT (a pure function of t). */
  private handPose(t: number) {
    const up = t > this.handT0 - 0.15 ? springStep(t - this.handT0 + 0.15, 1.6, 0.55) : 0;
    return { up, x: CRT[0], y: COUNTER_H + 0.35 + up * 0.55, z: CRT[2] + 0.55 + up * 0.25 };
  }
  private palmWorld(t = -1) {
    const h = this.handPose(t < 0 ? this.ctx.end : t);
    return new THREE.Vector3(h.x, h.y + 0.62 * HAND_S, h.z);
  }

  // ---------------------------------------------------------------- render
  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    this.begin();
    const t = f.t, d = this.db, fin = this.v === 'final';
    const beat = this.ctx.audio.beatAt(t);
    // the giant clock: frozen at 10:10 (v2: a twitch), ticking fine in the final chorus, then sweeping into the countdown
    if (fin) {
      const tick0 = this.L1.words[0]!.start;
      const ticks = t > tick0 ? Math.floor(this.ctx.audio.beatAt(t) - this.ctx.audio.beatAt(tick0)) + ease.outExpo(clamp((this.ctx.audio.beatAt(t) % 1) / 0.25)) : 0;
      const sweep = t > this.L2.words[0]!.start ? Math.pow(prog(t, this.L2.words[0]!.start, this.L2.words[4]!.start), 2) * 7 : 0;
      this.setTime(this.big, 10, 10 + ticks * 0.2 + sweep * 60 * 0.08, 30 + ticks * 6 + sweep * 60); // (racing forward, into the future)
      this.drips.forEach((m, i) => {
        const x = [-1.1, -0.3, 0.6, 1.3, 1.9][i]!, y0 = Math.sqrt(GR * GR - x * x) * 0.96;
        const len = 0.3 + prog(t, d[0]! - 0.3 + i * 0.12, d[1]! + 0.6 + i * 0.1, ease.outQuad) * (0.8 + (i % 3) * 0.45);
        m.position.set(G[0] + x, G[1] + y0 - len / 2, G[2] + 0.22);
        m.scale.y = len;
      });
    } else {
      this.setTime(this.big, 10, 10, 30);
    }
    // words on the numerals
    this.showWords(this.bigWords, t, this.big.numerals, this.v === 'final' ? [7, 8, 9, 10, 12] : [7, 8, 9, 10, 12, 2], 1.3, 0.16, this.v === 2 ? 'flip' : 'pop');
    this.showWords(this.rowWords, t, null, null, 1.3, 0.22, this.v === 2 ? 'spin' : 'pop');
    // wall clocks: 10:10 (v2: one second hand twitches); the final chorus: every clock ticks its own (right) time
    this.wall.forEach((c, i) => {
      if (fin) {
        const on = t > this.L1.words[1]!.start;
        const hh = (i * 7) % 12, mm = (i * 23) % 60;
        const s = on ? (beat - this.ctx.audio.beatAt(this.L1.words[1]!.start)) * 6 : 0;
        const sweep = t > this.L2.words[0]!.start ? Math.pow(prog(t, this.L2.words[0]!.start, this.L2.words[4]!.start), 2) * 2 * (1 + (i % 3)) : 0;
        this.setTime(c, on ? hh : 10, (on ? mm : 10) + s / 60 + sweep * 60, 30 + s + sweep * 360);
      } else if (this.v === 2 && i === this.twitchClock) {
        const bt = Math.floor(beat);
        this.setTime(c, 10, 10, 30 + (bt % 4 === 2 ? 6 * ease.outExpo(clamp((beat % 1) / 0.12)) : 0) + Math.floor(bt / 4) * 0);
      } else this.setTime(c, 10, 10, 30);
    });
    this.rowClocks.forEach((c, i) => {
      if (fin && t > this.L2.words[0]!.start) {
        const spin = Math.pow(prog(t, this.L2.words[0]!.start, this.L2.words[4]!.start + 0.4), 1.5);
        this.setTime(c, 10, 10 + spin * 180 * (1 + i * 0.2), 30 + spin * 3000);
      } else this.setTime(c, 10, 10, 30);
      // the clock of the word being sung pops forward
      const w = this.rowWords[i]!.w;
      const on = t >= w.start - 0.05 && t < w.end + 0.15;
      const s = 1 + 0.16 * (on ? springStep(t - w.start + 0.05, 3, 0.4) : 0) * (1 - clamp((t - w.end - 0.15) / 0.2));
      c.root.scale.setScalar(s);
      c.root.position.z = ROW.z + (s - 1) * 1.2;
    });
    // the hammock sways with DEV in it; his hourglass never empties (the final chorus: it has run out, on the floor)
    const sway = Math.sin(t * 1.9) * (this.v === 2 ? 0.07 : 0.05);
    this.hammock.rotation.x = sway;
    const hx = (HAM.x0 + HAM.x1) / 2 + 0.2;
    if (fin) {
      this.glass.root.position.set(hx + 0.4, 0.12, HAM.z + 0.9);
      this.glass.root.rotation.set(0, 0.4, Math.PI / 2);
      this.glass.topSand.visible = false; this.glass.stream.visible = false; this.glass.pile.scale.set(1.4, 2.4, 1.4);
    } else this.glass.stream.scale.y = 0.8 + 0.2 * Math.sin(t * 20);
    if (this.devHam) {
      const L = this.L2.words;
      this.devHam.setFace(this.v === 2 ? (Math.floor(t * 0.8) % 5 === 4 ? 'smug' : 'sleep') : t > L[3]!.start && t < L[3]!.end ? 'sleep' : 'smug');
    }
    // the hand: rises out of the CRT, waves (hi / bye), closes on the box in the final chorus
    const hp = this.handPose(t);
    this.handRoot.position.set(hp.x, hp.y, hp.z);
    this.handRoot.visible = hp.up > 0.01;
    const waving = t > this.handT0;
    const wv = waving ? Math.sin((t - this.handT0) * Math.PI * 2 * 1.43) : 0;
    const grip = fin ? prog(t, this.L3.words[5]!.start - 0.05, this.ctx.end - 0.15, ease.inOutCubic) : 0;
    this.hand.wrist.rotation.z = wv * 0.32 * (1 - grip);
    this.hand.wrist.rotation.x = -0.12 - grip * 0.5;
    this.hand.digits.forEach((dg, i) => {
      const curl = 0.12 * (1 + Math.sin(t * 7 + i)) + grip * 1.35;
      dg.rotation.x = -curl * (i === 0 ? 0.4 : 1);
      (dg.userData.mid as THREE.Object3D).rotation.x = -curl * 0.9;
    });
    // v2: exactly one frame with five fingers
    if (this.v === 2) {
      const hi = this.L3.words[3]!;
      this.hand.digits[this.hand.digits.length - 1]!.visible = frameIdx(t) !== frameIdx(hi.start + 0.2);
    }
    if (fin) {
      const up = prog(t, this.L3.words[4]!.start, this.L3.words[5]!.start + 0.2, ease.outCubic);
      this.box.visible = up > 0;
      this.box.position.set(hp.x, hp.y - 1.7 + up * 0.75, hp.z + 0.45);
      this.box.rotation.y = 0.1;
    }
    // the finger tags: each word lights at its digit as sung (the final chorus: "me," on the palm)
    this.hand.root.updateWorldMatrix(true, true);
    const tipW = new THREE.Vector3(), baseW = new THREE.Vector3(), dir = new THREE.Vector3();
    const rowY = hp.y + 2.05 * HAND_S, rowZ = hp.z + 0.25;
    for (const tg of this.tags) {
      const { w } = tg;
      const vis = t >= w.start - 0.02 && hp.up > 0.3;
      const hot = vis && t < w.end + 0.1;
      const dig = tg.digit >= 0 ? this.hand.digits[tg.digit]! : null;
      const shown = dig ? dig.visible : true;
      if (dig) { (dig.userData.tip as THREE.Object3D).getWorldPosition(tipW); dig.getWorldPosition(baseW); dir.subVectors(tipW, baseW).normalize(); }
      else { this.hand.palm.getWorldPosition(tipW); tipW.z += 0.2; dir.set(0, 0, 0); }
      const pop = springStep(t - w.start + 0.02, 3.5, 0.4);
      const drop = this.v === 2 ? (1 - clamp(pop)) * 1.6 : -(1 - clamp(pop)) * 0.6;
      const pos = new THREE.Vector3(hp.x + tg.x, rowY + drop + (w.end - w.start > 0.5 && hot ? Math.sin(t * 16) * 0.05 : 0), rowZ);
      tg.hot.visible = hot && shown; tg.done.visible = vis && !hot && shown;
      tg.hot.position.copy(pos); tg.done.position.copy(pos);
      tg.hot.scale.setScalar(this.v === 2 ? 1.25 : Math.max(0.01, Math.min(1.25, pop * 1.25)));
      tg.num.visible = vis && shown && !!dig;
      tg.num.position.copy(tipW).addScaledVector(dir, 0.2); tg.num.position.z += 0.2;
      tg.num.scale.setScalar(Math.max(0.01, Math.min(1, pop)));
      // the string from the fingertip to the word
      const top = pos.clone(); top.y -= 0.22;
      const len = top.distanceTo(tipW);
      tg.string.visible = vis && shown && len > 0.05;
      tg.string.position.copy(tipW).lerp(top, 0.5);
      tg.string.scale.set(1, len, 1);
      tg.string.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(tipW).normalize());
    }
    // DEV in the foreground: laughing and pointing at the hand (the final chorus: scared, backing off)
    const dv = this.devFront;
    if (fin) {
      dv.setFace(t > this.L3.words[3]!.start ? 'sad' : 'scared');
      dv.root.position.z = DEV_FRONT[2] + prog(t, this.handT0, this.ctx.end) * 0.6;
      dv.armL.rotation.x = dv.armR.rotation.x = -1.4 + Math.sin(t * 9) * 0.05;
      dv.armL.rotation.z = 0.4; dv.armR.rotation.z = -0.4;
    } else {
      const laugh = Math.abs(Math.sin(t * 11));
      dv.setFace(laugh > 0.5 ? 'laugh' : 'smug');
      dv.torso.rotation.x = -0.1 * laugh;
      dv.armR.rotation.x = 1.6 + 0.1 * laugh; dv.armR.rotation.z = -0.25;
      dv.armL.rotation.x = -0.3 + 0.2 * laugh; dv.armL.rotation.z = 0.5;
    }
    // the final chorus: the countdown and DEADLINE
    if (fin && this.countdown && this.deadline) {
      const w = this.L2.words;
      const n = t < w[0]!.start - 0.1 ? 6 : t < w[1]!.start ? 5 : t < w[2]!.start ? 4 : t < w[3]!.start ? 3 : t < w[4]!.start ? 2 : t < d[4]! ? 1 : 0;
      this.countdown.open = windowOpen(t, w[0]!.start - 0.4, this.ctx.end, 0.12, false, true);
      this.countdown.mesh.visible = this.countdown.open > 0.01; // (unhung panels: Panel.place only hides)
      this.countdown.mesh.scale.set(104 * 0.026, 22 * 0.026 * ease.outBack(clamp(this.countdown.open)), 1);
      const blink = n === 0 && frameIdx(t) % 12 < 6;
      this.countdown.draw(`cd${n}${blink}`, (c) => {
        uiBox(c, 0, 0, 104, 22, n <= 1 ? '#5A0A14' : P.uiBg);
        if (!blink) pixText(c, `00:00:0${Math.max(0, n)}`, 5, 4, n <= 1 ? P.fail : P.uiLine, 2, { shadow: P.uiEdge });
      });
      const t0 = w[4]!.start;
      this.deadline.root.visible = t > t0 - 0.05;
      this.deadline.letters.forEach((l, i) => {
        const u = springStep(t - t0 - i * 0.03, 3.2, 0.35);
        l.position.y = (1 - u) * 3;
        l.rotation.x = (1 - clamp(u)) * 1.2;
      });
      if (t > t0 && t < t0 + 0.2) this.shake(0.12 * (1 - (t - t0) / 0.2));
    }
    // kicks shake the set a little; the palm goes dark at the end of v1/v2 (DEV's dark bedroom follows)
    this.shake(0.03 * f.a.kick);
    if (!fin) {
      const dark = prog(t, this.ctx.end - 0.45, this.ctx.end, ease.inQuad);
      psGlobals.uLightCol.value.multiplyScalar(1 - dark * 0.92);
      psGlobals.uAmb.value.multiplyScalar(1 - dark * 0.9);
      const fc = new THREE.Color(this.fogColor).lerp(new THREE.Color('#05070F'), dark);
      psGlobals.uFogColor.value.copy(fc).convertSRGBToLinear();
    }
    return this.present(f, out);
  }

  /**
   * Word decals: hidden (the numeral shows) before the word, a yellow plate while sung (`hotScale`, pushed out
   * of the face by `hotZ`), navy after. Entrances: v1/final pop; v2 flips in like a split-flap (`flip`) or spins in.
   */
  private showWords(list: Lit[], t: number, numerals: THREE.Mesh[] | null, slots: number[] | null, hotScale = 1, hotZ = 0, entrance: 'pop' | 'flip' | 'spin' = 'pop') {
    list.forEach((L, i) => {
      const { w } = L;
      const on = t >= w.start - 0.02;
      const hot = on && t < w.end + 0.12;
      L.hot.visible = hot; L.done.visible = on && !hot;
      if (numerals && slots) numerals[slots[i]!]!.visible = !on;
      const pop = springStep(t - w.start + 0.02, 3.6, 0.38);
      const held = w.end - w.start > 0.5 && hot;
      L.hot.position.z = L.done.position.z + hotZ * clamp(pop);
      L.hot.rotation.set(0, 0, held ? Math.sin(t * 13) * 0.06 : 0);
      if (entrance === 'pop') L.hot.scale.setScalar(Math.max(0.01, (0.3 + 0.7 * pop) * hotScale));
      else {
        L.hot.scale.setScalar(hotScale);
        const u = 1 - clamp(pop);
        if (entrance === 'flip') L.hot.rotation.x = -u * Math.PI / 2; else L.hot.rotation.y = u * Math.PI;
      }
    });
  }
}

const matCache = new Map<string, THREE.Material>();
function psMatCached(col: string, unlit = false) {
  const k = `${col}${unlit}`;
  let m = matCache.get(k);
  if (!m) { m = psMat({ color: col, unlit }); matCache.set(k, m); }
  return m;
}
