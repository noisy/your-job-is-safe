// #8 / #15 / #21 chorus-sleep (docs/TREATMENT.md): DEV sleeps smug in his room at night.
//   line 1 "Nah, I'm not losing sleep,": Zzz dream letters float up out of DEV's head into a dream bubble;
//   line 2 "It's a toy, it's a joke, it's a party trick,": the camera dives through the bubble into the dream: a
//          wind-up toy chatbot flubs its juggling trick while wooden alphabet blocks drop into rows, word by word;
//   line 3 "And my job is mine to keep!": a cloud wipe lands on DEV's desk, the words hammered into his brass
//          plaque one by one (red while struck), the MINE trophy beside it.
//   v: 1       out: pull back wide: the room stands on a stage; the curtain drops (v2-stage raises it).
//   v: 2       the toy's trick is suddenly competent; out: a dive into DEV's CRT, which is installing PATCH NOTES (solo).
//   v: 'final' the mirror: the chatbot (v5.0, a humanoid body) packs DEV's desk into a cardboard box on his bed; the
//              plaque is rewritten word by word ("Now my job's not mine to keep..."), old words scratched out; the
//              trophy gets a NOT sticker; the plaque goes in last and the lid closes (plumber).
// In: v1/v2 from the waving palm going dark (DEV's dark bedroom); final from the hand gripping the box.
import * as THREE from 'three';
import type { Frame } from '../engine/scene';
import type { Line, Word } from '../engine/lyrics';
import { clamp, ease, lerp, prog, springStep, type Key, keys } from '../engine/util';
import { Ps1Stage, type CamState, type V3, type Panel } from '../ps1/stage';
import { makeRoom, makeDev, makeBotHead, makeBotBody, type Room, type Dev } from '../ps1/cast';
import { psMat, canvasTex, pixText, psGlobals, textW } from '../ps1/gfx';
import { P } from '../ps1/palette';
import {
  makeBed, makeCloud, charTex, makeDreamSet, makeToyBot, blockMat, drawPlaque, PLAQ_W, PLAQ_H, makeMallet, makeTrophy,
  makeNamePlate, makeStage,
} from './chorus-sleep-set';
import { makeCardboardBox } from './chorus-clocks-set';

type Ver = 1 | 2 | 'final';

const BED: V3 = [-2.8, 0, -3.0];
const HEAD: V3 = [-2.8, 0.86, -3.66]; // DEV's head on the pillow
const BUB: V3 = [-2.55, 3.35, -2.7]; // the dream bubble
const DX = 30; // the dream set's offset along x
const PLQ: V3 = [-0.92, 1.0, -2.86]; // the plaque's centre on the desk
const PLQ_TX = 0.0068; // world units per plaque texel
const PLQ_TILT = -0.35;
const BOXP: V3 = [-2.8, 0.56, -2.3]; // the cardboard box, on the foot of the bed (final)
const BOX_W = 0.95, BOX_H = 0.5, BOX_D = 0.62;
const CH_TX = 0.068; // dream letters
const BLK = 0.24, BLK_PITCH = 0.27, SPACE = 0.2;

interface Flyer { mesh: THREE.Mesh; t: number; slot: V3; from: V3; w: Word; held: boolean; dream: V3 }
interface Block { mesh: THREE.Mesh; t: number; pos: V3; rz: number }

export default class ChorusSleep extends Ps1Stage {
  v: Ver = 1;
  room!: Room;
  dev!: Dev;
  devG = new THREE.Group();
  bubble!: ReturnType<typeof makeCloud>;
  puffs: THREE.Mesh[] = [];
  wipe!: ReturnType<typeof makeCloud>;
  flyers: Flyer[] = [];
  blocks: Block[] = [];
  toy!: ReturnType<typeof makeToyBot>;
  plaque!: Panel;
  mallet = new THREE.Group();
  spark!: THREE.Mesh;
  trophy!: ReturnType<typeof makeTrophy>;
  nameplate!: THREE.Group;
  stage!: ReturnType<typeof makeStage>;
  bot: { body: ReturnType<typeof makeBotBody>; head: ReturnType<typeof makeBotHead> } | null = null;
  cbox = new THREE.Group();
  flaps: THREE.Object3D[] = [];
  L1!: Line; L2!: Line; L3!: Line;
  old: Line | null = null;
  db: number[] = [];
  kicks: number[] = [];
  tDive = 0; tDesk = 0; tWide = 0;
  /** Centre of each line-2 word's blocks (the dream camera follows the newest word). */
  wordC: V3[] = [];
  strikes: number[] = [];
  slots: { x: number; y: number; w: number }[] = [];
  screenKey = '';
  /** Plaque world units per texel (bigger in the final chorus, where it is the whole lyric). */
  get ptx() { return this.v === 'final' ? 0.0082 : PLQ_TX; }

  override async init() {
    const { lyrics: ly, audio: au, start, end, params } = this.ctx;
    this.v = (params.v ?? 1) as Ver;
    const fin = this.v === 'final', nth = this.v === 2 ? 1 : 0;
    this.L1 = ly.get("Nah, I'm not losing sleep", fin ? 1 : nth);
    this.L2 = ly.get("It's a toy, it's a joke", fin ? 1 : nth);
    this.L3 = fin ? ly.get("Now my job's not mine to keep") : ly.get('And my job is mine to keep', nth);
    if (fin) this.old = ly.get('And my job is mine to keep', 0);
    this.db = au.downbeats.filter((d) => d >= start - 0.02 && d <= end + 0.02);
    while (this.db.length < 9) this.db.push(this.db[this.db.length - 1]! + 1.39);
    this.kicks = au.events('kick', start, end).map((e) => e[0]);
    // a hard cut into the dream on the last downbeat before line 2 (the line-1 letters come along, hanging in the dream sky)
    this.tDive = [...au.downbeats].reverse().find((x) => x <= this.L2.words[0]!.start - 0.3) ?? this.L2.words[0]!.start - 0.9;
    this.tDesk = this.L3.words[0]!.start - 0.06;
    const keep = this.L3.words[this.L3.words.length - 1]!;
    this.tWide = this.v === 1 ? this.db[7]! : Math.max(this.db[7]!, keep.end - 0.05);
    this.fogColor = '#0E1428'; this.fogNear = 5; this.fogFar = 18;

    // DEV's room (the home set), trimmed to a stage-sized box with an open front
    this.room = makeRoom();
    const kids = this.room.root.children;
    const floor = kids[0]!; floor.scale.set(0.66, 0.48, 1); floor.position.z = -0.35;
    for (const k of kids.slice(2, 4)) { k.scale.x = 0.48; k.position.z = -0.35; }
    this.world.add(this.room.root);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(10.2, 8), psMat({ color: '#2A1E16' }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 5, -0.2); this.world.add(ceil);
    this.drawScreen('sleep');
    const bed = makeBed(); bed.root.position.set(...BED); bed.blanket.position.y = 0.8; this.world.add(bed.root);
    // DEV asleep (pyjamas), on his back, head on the pillow
    this.dev = makeDev(); this.dev.outfit('pyjamas'); this.dev.setFace('sleep');
    this.dev.root.rotation.x = Math.PI / 2;
    this.devG.add(this.dev.root); this.devG.rotation.y = Math.PI;
    this.devG.position.set(BED[0], 0.74, HEAD[2] + 1.4);
    this.dev.armL.rotation.x = this.dev.armR.rotation.x = 0.1;
    this.world.add(this.devG);
    this.devG.visible = !fin;
    // the stage the room stands on
    this.stage = makeStage(); this.world.add(this.stage.root);
    // desk props: the plaque, the mallet, the trophy, the name plate
    this.plaque = this.panel(PLAQ_W, PLAQ_H).inWorld();
    this.plaque.hang = null;
    this.trophy = makeTrophy(); this.trophy.root.position.set(0.82, 0.8, -3.15); this.trophy.root.rotation.y = -0.3; this.world.add(this.trophy.root);
    this.trophy.sticker.visible = false;
    this.nameplate = makeNamePlate(); this.nameplate.position.set(0.52, 0.8, -2.95); this.nameplate.rotation.y = -0.2; this.world.add(this.nameplate);
    this.mallet.add(makeMallet()); this.world.add(this.mallet);
    this.spark = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.03), psMat({ color: '#FFF2B0', unlit: true, fog: 0, side: THREE.DoubleSide }));
    this.world.add(this.spark); this.billboards.push(this.spark);
    this.layoutPlaque();
    // strike times: one per word, more taps while a held word rings
    for (const w of this.L3.words) { this.strikes.push(w.start); for (let k = w.start + 0.22; k < w.end - 0.08; k += 0.22) this.strikes.push(k); }

    if (!fin) {
      this.buildDream();
      this.bubble = makeCloud(1.7);
      this.bubble.root.position.set(...BUB);
      this.world.add(this.bubble.root);
      for (let i = 0; i < 3; i++) {
        const p = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07 + i * 0.05, 1), this.bubble.mat);
        const u = 0.45 + i * 0.17;
        p.position.set(lerp(HEAD[0] + 0.2, BUB[0], u), lerp(HEAD[1] + 0.5, BUB[1] - 1.0, u), lerp(HEAD[2] + 0.2, BUB[2], u));
        this.world.add(p); this.puffs.push(p);
      }
      this.wipe = makeCloud(1.0, '#A9BCE8', 0.96);
      this.world.add(this.wipe.root);
      this.buildDreamLetters();
    } else {
      // the chatbot packs the desk into a cardboard box on DEV's bed
      const body = makeBotBody('#8A93A8'), head = makeBotHead('v5.0');
      head.setFace('happy');
      body.neck.add(head.root);
      body.root.position.set(-1.65, 0, -3.45); body.root.rotation.y = 0.5;
      this.world.add(body.root);
      this.bot = { body, head };
      // DEV's chair is already gone
      for (const k of this.room.root.children) if (Math.abs(k.position.x) < 0.3 && k.position.z > -2.45 && k.position.z < -2.0 && k.position.y < 1.2) k.visible = false;
      this.cbox.add(makeCardboardBox(BOX_W, BOX_H, BOX_D)); // small: the plaque sticks out of it (the inside is never shown)
      const fm = psMat({ color: '#B8864E', side: THREE.DoubleSide });
      for (const [x, z, ry, w] of [[0, BOX_D / 2, 0, BOX_W], [0, -BOX_D / 2, Math.PI, BOX_W], [BOX_W / 2, 0, Math.PI / 2, BOX_D], [-BOX_W / 2, 0, -Math.PI / 2, BOX_D]] as const) {
        const piv = new THREE.Object3D(); piv.position.set(x, BOX_H, z); piv.rotation.order = 'YXZ'; piv.rotation.y = ry; // fold about the flap's own edge
        const f = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.3), fm); f.position.set(0, 0.15, 0); piv.add(f);
        this.cbox.add(piv); this.flaps.push(piv);
      }
      this.cbox.position.set(...BOXP); this.cbox.rotation.y = 0.1;
      this.world.add(this.cbox);
    }
  }

  // ---------------------------------------------------------------- build helpers
  private buildDream() {
    const ds = makeDreamSet(); ds.root.position.x = DX; this.world.add(ds.root);
    this.toy = makeToyBot(this.v === 2 ? 'v3.0' : 'v1.0');
    this.toy.root.position.set(DX - 0.9, ds.tableY, -1.35);
    this.toy.head.setFace('happy');
    this.world.add(this.toy.root);
    // blocks: one row per phrase, back to front
    const n2 = this.L2.words.length; // It's a toy, / it's a joke, / it's a party trick,
    const rows = [[0, 1, 2], [3, 4, 5], Array.from({ length: n2 - 6 }, (_, k) => 6 + k)];
    rows.forEach((idx, ri) => {
      const words = idx.map((i) => this.L2.words[i]!);
      const chars = words.reduce((s, w) => s + Array.from(w.w).length, 0);
      const width = chars * BLK_PITCH + (words.length - 1) * SPACE;
      let x = DX - width / 2 + BLK_PITCH / 2;
      const z = -0.25 + ri * 0.62;
      let col = ri;
      for (const w of words) {
        const cs = Array.from(w.w), dur = Math.min(0.3, (w.end - w.start) * 0.8);
        cs.forEach((ch, i) => {
          const m = new THREE.Mesh(new THREE.BoxGeometry(BLK, BLK, BLK), blockMat(ch, col++));
          this.world.add(m);
          this.blocks.push({ mesh: m, t: w.start + (i / cs.length) * dur, pos: [x, ds.tableY + BLK / 2, z], rz: ((i * 37 + ri * 11) % 7 - 3) * 0.02 });
          x += BLK_PITCH;
        });
        const bs = this.blocks.slice(-cs.length);
        this.wordC.push([bs.reduce((q, b) => q + b.pos[0], 0) / bs.length, ds.tableY + BLK / 2, z]);
        x += SPACE;
      }
    });
  }

  private buildDreamLetters() {
    const rows = [[0, 1, 2], [3, 4]];
    rows.forEach((idx, ri) => {
      const words = idx.map((i) => this.L1.words[i]!);
      const text = words.map((w) => w.w).join(' ');
      const adv = 6 * CH_TX;
      let x = BUB[0] + 0.35 - (Array.from(text).length * adv) / 2 + adv / 2; // (+0.35: centred in the bubble as the camera sees it)
      const y = BUB[1] + 0.4 - ri * 0.78, z = BUB[2] + 0.55;
      for (const w of words) {
        const cs = Array.from(w.w), dur = Math.min(0.3, (w.end - w.start) * 0.8);
        const wc = x + ((cs.length - 1) * adv) / 2;
        cs.forEach((ch, i) => {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(8 * CH_TX, 10 * CH_TX), psMat({ map: charTex(ch, '#1B2A55', ''), unlit: true, fog: 0.1, side: THREE.DoubleSide }));
          m.renderOrder = 30; const mm = m.material as THREE.RawShaderMaterial; mm.depthTest = false; mm.transparent = true; // drawn after (in front of) the bubble
          m.userData.room = charTex(ch, '#1B2A55', ''); m.userData.dream = charTex(ch, '#F3ECDF', '#1B2A55');
          this.world.add(m); this.billboards.push(m);
          const dream: V3 = [DX - 0.3 + (x - BUB[0]), 2.45 + (y - BUB[1]), -1.0];
          this.flyers.push({ mesh: m, t: w.start + (i / cs.length) * dur, slot: [x, y, z], from: [HEAD[0] + 0.15 + (x - wc) * 0.8, HEAD[1] + 0.45, HEAD[2] + 0.35], w, held: w.end - w.start > 0.6, dream });
          x += adv;
        });
        x += adv;
      }
    });
  }

  /** Plaque slots (texels): three rows in the final (max of old/new widths), two otherwise. */
  private layoutPlaque() {
    const rows = this.v === 'final' ? [[0, 1, 2], [3, 4, 5], [6]] : [[0, 1, 2, 3], [4, 5, 6]];
    const rowY = this.v === 'final' ? [17, 32, 47] : [24, 42];
    const wOf = (i: number) => Math.max(textW(this.L3.words[i]!.w, 2), this.old ? textW(this.old.words[i]?.w ?? '', 2) : 0);
    rows.forEach((idx, ri) => {
      const total = idx.reduce((s, i) => s + wOf(i), 0) + (idx.length - 1) * 12;
      let x = Math.floor((PLAQ_W - total) / 2);
      for (const i of idx) { this.slots[i] = { x, y: rowY[ri]!, w: wOf(i) }; x += wOf(i) + 12; }
    });
  }

  private drawScreen(mode: 'sleep' | 'patch', pct = 0) {
    const key = `${mode}${Math.floor(pct * 20)}`;
    if (key === this.screenKey) return;
    this.screenKey = key;
    const c = this.room.screen.ctx;
    c.fillStyle = '#10162A'; c.fillRect(0, 0, 128, 96);
    if (mode === 'sleep') {
      pixText(c, 'z z z', 44, 40, '#3B4A78');
    } else {
      c.fillStyle = P.uiNavy; c.fillRect(0, 0, 128, 12);
      pixText(c, 'PATCH NOTES', 31, 3, P.key2);
      pixText(c, 'chatbot v3.2', 28, 22, P.bot);
      pixText(c, 'installing', 34, 40, P.uiLine);
      pixText(c, 'while you sleep', 19, 50, P.uiDim);
      c.fillStyle = '#26345E'; c.fillRect(10, 68, 108, 8);
      c.fillStyle = P.fix; c.fillRect(11, 69, Math.floor(106 * pct), 6);
      pixText(c, `${Math.floor(pct * 100)}%`, 54, 80, P.uiLine);
    }
    this.room.screen.tex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- camera
  camAt(t: number): CamState {
    const d = this.db, fin = this.v === 'final';
    const mix = (a: { P: V3; T: V3 }, b: { P: V3; T: V3 }, u: number) => ({ P: a.P.map((x, i) => lerp(x, b.P[i]!, u)) as V3, T: a.T.map((x, i) => lerp(x, b.T[i]!, u)) as V3 });
    const kick = (a: number, b: number, amt: number) => this.kicks.filter((x) => x > a && x < b).reduce((s, x) => s + amt * ease.outExpo(clamp((t - x) / 0.18)), 0);
    const plq = (dist: number, dx = 0, dy = 0): { P: V3; T: V3 } => ({ P: [PLQ[0] + dx, PLQ[1] + 0.16 + dy, PLQ[2] + dist], T: [PLQ[0] + dx * 0.4, PLQ[1] - 0.02, PLQ[2]] });
    if (fin) {
      const a = this.ctx.start, w = this.L3.words, keep = w[6]!;
      const boxTop = { P: [BOXP[0] + 0.2, 2.2, BOXP[2] + 1.1] as V3, T: [BOXP[0], 0.9, BOXP[2]] as V3 };
      const main = plq(1.05, 0.25);
      if (t < w[0]!.start - 0.02) return { ...mix(boxTop, main, prog(t, a, w[0]!.start - 0.02, ease.inOutCubic)), roll: 0.03, fov: 52 };
      if (t < d[1]!) { const c = mix(main, plq(0.95, 0.1), prog(t, w[0]!.start, d[1]!, ease.inOutQuad)); c.P[2] -= kick(w[0]!.start, d[1]!, 0.04); return { ...c, roll: -0.02, fov: 52 }; }
      // (low: the box's rim hides its inside)
      const wide = { P: [-1.5, 1.22, -0.75] as V3, T: [-1.85, 1.12, -2.85] as V3 };
      if (t < keep.start + 0.05) return { ...mix(plq(0.95, 0.1), wide, prog(t, d[1]!, d[1]! + 0.35, ease.outExpo)), roll: 0.02, fov: 52 };
      // outside the box (its inside is never shown): the front, with the plaque sticking out of it, then a push
      // into the cardboard face as the light goes (plumber opens on its cabinet doors)
      // from in front, just above the rim: the angled plaque reads, the front wall hides the inside
      const front = { P: [BOXP[0] + 0.3, BOXP[1] + 0.85, BOXP[2] + 1.4] as V3, T: [BOXP[0], BOXP[1] + 0.66, BOXP[2]] as V3 };
      const close = { P: [BOXP[0] + 0.18, BOXP[1] + 0.8, BOXP[2] + 1.12] as V3, T: [BOXP[0] + 0.02, BOXP[1] + 0.66, BOXP[2]] as V3 };
      const m = mix(mix(wide, front, prog(t, keep.start - 0.08, keep.start + 0.12, ease.inOutCubic)), close, prog(t, keep.start + 0.12, this.ctx.end, ease.outCubic));
      return { ...m, roll: 0, fov: 52 };
    }
    if (this.v === 2) {
      const v2 = this.cam2(t, mix, kick);
      if (v2) return v2;
    }
    if (t < d[1]!) {
      // A: close on DEV's smug sleeping face, the first letters leaving it
      const u = prog(t, d[0]!, d[1]!, ease.inOutQuad);
      return { P: [HEAD[0] + lerp(1.4, 1.0, u), HEAD[1] + lerp(1.5, 1.8, u), HEAD[2] + lerp(6.5, 6.0, u)], T: [BUB[0] - 0.15, HEAD[1] + lerp(1.85, 2.05, u), HEAD[2]], roll: lerp(0.04, 0.015, u), fov: 52 };
    }
    if (t < d[2]!) {
      // B: a crane up with the letters to the dream bubble
      const u = prog(t, d[1]!, d[2]!, ease.inOutCubic);
      return { ...mix({ P: [HEAD[0] + 1.0, HEAD[1] + 1.8, HEAD[2] + 6.0], T: [BUB[0] - 0.15, HEAD[1] + 2.05, HEAD[2]] }, { P: [BUB[0] + 0.5, BUB[1] - 0.1, BUB[2] + 4.6], T: [BUB[0], BUB[1] + 0.0, BUB[2]] }, u), roll: 0.02, fov: 52 };
    }
    if (t < this.tDive) {
      // C: the bubble with the line in it, a step in per kick (up to the cut)
      const base = { P: [BUB[0] + 0.5, BUB[1] - 0.1, BUB[2] + 4.6] as V3, T: [BUB[0], BUB[1], BUB[2]] as V3 };
      const c = mix(base, { P: [BUB[0] + 0.1, BUB[1] + 0.05, BUB[2] + 3.9], T: [BUB[0], BUB[1] + 0.05, BUB[2]] }, prog(t, d[2]!, this.tDive, ease.outCubic));
      c.P[2] -= kick(d[2]!, this.tDive, 0.12);
      return { ...c, roll: 0.02, fov: 52 };
    }
    if (t < this.tDesk) {
      // D: the dream. Cut in on the toy with the line hanging above it, then follow the blocks word by word,
      // close (a letter ~12% of the frame), and pull back to the toy on its "trick"
      const w = this.L2.words, s0 = w[0]!.start;
      const est = mix({ P: [DX - 0.1, 2.55, 3.6], T: [DX - 0.4, 1.95, -0.9] }, { P: [DX + 0.3, 2.1, 3.0], T: [DX - 0.5, 1.6, -0.9] }, prog(t, this.tDive, s0, ease.inOutQuad));
      let i = 0;
      for (let k = 0; k < w.length; k++) if (w[k]!.start - 0.12 <= t) i = k;
      const cA = this.wordC[Math.max(0, i - 1)]!, cB = this.wordC[i]!;
      const e = ease.inOutCubic(prog(t, w[i]!.start - 0.12, w[i]!.start + 0.1));
      const cc: V3 = [lerp(cA[0], cB[0], e), lerp(cA[1], cB[1], e), lerp(cA[2], cB[2], e)];
      const follow = { P: [cc[0] + 0.2, cc[1] + 0.55, cc[2] + 1.4] as V3, T: [cc[0], cc[1] + 0.12, cc[2]] as V3 };
      const tr = w[w.length - 1]!;
      const toy = { x: DX + 0.1, z: -1.35 }; // where the walk ends (camAt must not read animated state)
      const trick = { P: [cc[0] - 0.2, cc[1] + 1.35, cc[2] + 2.7] as V3, T: [lerp(cc[0], toy.x, 0.45), cc[1] + 0.25, lerp(cc[2], toy.z, 0.4)] as V3 };
      let m = mix(est, follow, prog(t, s0 - 0.15, s0 + 0.12, ease.inOutCubic));
      m = mix(m, trick, prog(t, tr.start - 0.05, tr.start + 0.3, ease.outCubic));
      m.P[2] -= kick(s0, this.tDesk, 0.05);
      return { ...m, roll: 0.04 * Math.sin(t * 1.3), fov: 52 };
    }
    // E: the plaque, row by row; a low reframe with the trophy on the downbeat
    const w = this.L3.words;
    const onRow2 = prog(t, w[4]!.start - 0.25, w[4]!.start + 0.05, ease.inOutCubic);
    let c = mix(plq(1.1, -0.1, 0.02), plq(1.05, 0.08, -0.03), prog(t, this.tDesk, w[3]!.end, ease.inOutQuad));
    c = mix(c, { P: [PLQ[0] + 0.22, PLQ[1] + 0.1, PLQ[2] + 1.15], T: [PLQ[0] + 0.02, PLQ[1] - 0.04, PLQ[2]] }, onRow2);
    c.P[2] -= kick(this.tDesk, this.tWide, 0.03);
    if (t < this.tWide) return { ...c, roll: lerp(0.03, -0.03, onRow2), fov: 52 };
    if (this.v === 1) {
      // F (v1): pull out wide: the room is a set on a stage; the curtain falls
      const u = prog(t, this.tWide, this.ctx.end - 0.55, ease.inOutCubic);
      const wide = mix(c, { P: [0.2, 2.6, 12.4], T: [0, 2.4, 0] }, u);
      // the curtain falls and the camera pushes into it: red velvet fills the frame by the cut (v2-stage raises it)
      const k = prog(t, this.ctx.end - 0.55, this.ctx.end - 0.04, ease.inOutCubic);
      return { ...mix(wide, { P: [0, 3.4, 6.9], T: [0, 3.4, 4.2] }, k), roll: 0, fov: 52 };
    }
    // F (v2): a dive into DEV's CRT, installing PATCH NOTES while he sleeps
    const u = prog(t, this.tWide, this.ctx.end, ease.inOutCubic);
    const s = this.room.screenPos;
    return { ...mix(c, { P: [s.x, s.y + 0.02, s.z + 0.62], T: [s.x, s.y, s.z] }, u), roll: 0, fov: 52 };
  }

  /**
   * Chorus 2's own choreography on the same sets (null: fall through to the shared shots, i.e. the plaque's
   * dive into the CRT): a top-down map shot over DEV as the letters rise at the lens, an orbit round the bubble
   * from the left, a low dolly from the left along the rising blocks, a top-down view of the toy's (now clean)
   * trick, and a pan that follows the hammer along the plaque from the right.
   */
  private cam2(t: number, mix: (a: { P: V3; T: V3 }, b: { P: V3; T: V3 }, u: number) => { P: V3; T: V3 }, kick: (a: number, b: number, amt: number) => number): CamState | null {
    const d = this.db;
    if (t < this.tDive) {
      const top = { P: [HEAD[0] - 1.9, HEAD[1] + 1.3, HEAD[2] + 5.6] as V3, T: [HEAD[0] + 0.35, HEAD[1] + 2.05, HEAD[2]] as V3 }; // from the window side of the bed
      const left = { P: [BUB[0] - 1.1, BUB[1] - 1.1, BUB[2] + 5.6] as V3, T: [BUB[0] + 0.3, BUB[1] + 0.05, BUB[2]] as V3 };
      const right = { P: [BUB[0] + 1.4, BUB[1] + 0.4, BUB[2] + 5.4] as V3, T: [BUB[0] + 0.3, BUB[1] + 0.05, BUB[2]] as V3 };
      let c = mix(top, left, prog(t, this.L1.words[1]!.start - 0.1, d[2]!, ease.inOutCubic));
      c = mix(c, right, prog(t, d[2]!, this.tDive, ease.inOutQuad));
      c.P[1] += kick(d[2]!, this.tDive, 0.1);
      return { ...c, roll: lerp(0.0, -0.06, prog(t, d[1]!, this.tDive)), fov: 52 };
    }
    if (t < this.tDesk) {
      const w = this.L2.words, s0 = w[0]!.start, tr = w[w.length - 1]!;
      let i = 0;
      for (let k = 0; k < w.length; k++) if (w[k]!.start - 0.12 <= t) i = k;
      const cA = this.wordC[Math.max(0, i - 1)]!, cB = this.wordC[i]!;
      const e = ease.inOutCubic(prog(t, w[i]!.start - 0.12, w[i]!.start + 0.1));
      const cc: V3 = [lerp(cA[0], cB[0], e), lerp(cA[1], cB[1], e), lerp(cA[2], cB[2], e)];
      const est = { P: [DX - 0.9, 1.8, 3.9] as V3, T: [DX + 0.1, 2.3, -1.0] as V3 };
      const dolly = { P: [cc[0] - 0.75, cc[1] + 0.32, cc[2] + 1.3] as V3, T: [cc[0] + 0.1, cc[1] + 0.08, cc[2]] as V3 };
      const over = { P: [DX + 0.15, 4.6, 0.9] as V3, T: [DX + 0.05, 0.95, -0.2] as V3 };
      let m = mix(est, dolly, prog(t, s0 - 0.15, s0 + 0.12, ease.inOutCubic));
      m = mix(m, over, prog(t, tr.start - 0.1, tr.start + 0.35, ease.outCubic));
      return { ...m, roll: -0.05 * (1 - prog(t, tr.start - 0.1, tr.start + 0.35)), fov: 52 };
    }
    if (t < this.tWide) {
      // follow the hammer word by word, from the right, low
      const w = this.L3.words;
      let i = 0;
      for (let k = 0; k < w.length; k++) if (w[k]!.start - 0.15 <= t) i = k;
      const xOf = (j: number) => { const sl = this.slots[j]!; return PLQ[0] + (sl.x + sl.w / 2 - PLAQ_W / 2) * this.ptx; };
      const yOf = (j: number) => PLQ[1] + (PLAQ_H / 2 - this.slots[j]!.y - 7) * this.ptx;
      const e = ease.inOutCubic(prog(t, w[i]!.start - 0.15, w[i]!.start + 0.08));
      const x = lerp(xOf(Math.max(0, i - 1)), xOf(i), i === 0 ? 1 : e), y = lerp(yOf(Math.max(0, i - 1)), yOf(i), i === 0 ? 1 : e);
      const c = { P: [x + 0.42, y - 0.02, PLQ[2] + 0.72] as V3, T: [x - 0.04, y, PLQ[2]] as V3 };
      return { ...c, roll: -0.05, fov: 52 };
    }
    return null;
  }

  // ---------------------------------------------------------------- render
  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    this.begin();
    const t = f.t, fin = this.v === 'final';
    // night light: moon-blue ambient, the desk lamp's warm key; the dream is starlit
    const inDream = !fin && t >= this.tDive && t < this.tDesk;
    psGlobals.uAmb.value.setRGB(0.16, 0.2, 0.36);
    if (inDream) { psGlobals.uFogColor.value.set('#16204A').convertSRGBToLinear(); psGlobals.uLightCol.value.setRGB(1.0, 0.9, 0.72); }
    // v1/v2: fade up from the dark palm
    if (!fin) {
      const up = prog(t, this.ctx.start, this.ctx.start + 0.5, ease.outQuad);
      psGlobals.uLightCol.value.multiplyScalar(0.15 + 0.85 * up); psGlobals.uAmb.value.multiplyScalar(0.2 + 0.8 * up);
    }
    if (this.v === 1) {
      // house lights up on the curtain, so it matches v2-stage's first frame
      const k = prog(t, this.ctx.end - 0.5, this.ctx.end - 0.05, ease.inOutQuad);
      psGlobals.uLightCol.value.multiplyScalar(1 + 0.45 * k); psGlobals.uAmb.value.multiplyScalar(1 + 0.9 * k);
    }
    this.animateDev(t);
    this.animateLetters(t);
    this.animateDream(t);
    this.animatePlaque(t);
    if (fin) {
      this.animatePacking(t);
      // the lid shuts over the lens: the light goes with it (plumber opens on the cabinet doors)
      const k = prog(t, this.ctx.end - 0.22, this.ctx.end - 0.02, ease.inQuad);
      psGlobals.uLightCol.value.multiplyScalar(1 - 0.75 * k); psGlobals.uAmb.value.multiplyScalar(1 - 0.75 * k);
    }
    // the wipes: the bubble opens when the dive passes through it; a cloud fills the lens on the way to the desk
    if (!fin) {
      const c = this.camAt(t);
      const wipeOut = prog(t, this.tDive, this.tDive + 0.35, ease.outCubic);
      const toDesk = prog(t, this.tDesk - 0.14, this.tDesk, ease.inCubic), fromDesk = prog(t, this.tDesk, this.tDesk + 0.14, ease.outCubic);
      const k = t < this.tDesk ? (t >= this.tDive ? toDesk : 0) : 1 - fromDesk;
      void wipeOut;
      this.wipe.root.visible = k > 0.02;
      if (this.wipe.root.visible) {
        const fwd = new THREE.Vector3(c.T[0] - c.P[0], c.T[1] - c.P[1], c.T[2] - c.P[2]).normalize();
        this.wipe.root.position.set(c.P[0] + fwd.x * 0.9, c.P[1] + fwd.y * 0.9, c.P[2] + fwd.z * 0.9);
        this.wipe.root.scale.setScalar(Math.max(0.01, k * 1.3));
      }
      this.bubble.root.visible = t < this.tDive + 0.05;
      const grow = springStep(t - (this.v === 2 ? this.db[1]! - 0.25 : this.L1.words[0]!.start - 0.35), 1.8, 0.5);
      const gs = Math.max(0.001, grow) * (1 + 0.03 * Math.sin(t * 3));
      this.bubble.root.scale.set(gs * 2.05, gs * 1.2, gs);
      this.bubble.root.visible = this.bubble.root.visible && grow > 0.01;
      this.puffs.forEach((p, i) => { p.visible = t < this.tDive && t > this.L1.words[0]!.start - 0.4 + i * 0.08; });
      // stage curtain (v1), patch notes on the CRT (v2)
      if (this.v === 1) this.stage.curtain.position.y = lerp(9.6, 3.3, prog(t, this.ctx.end - 0.75, this.ctx.end - 0.3, ease.inQuad));
      if (this.v === 2) this.drawScreen(t > this.tWide - 1.2 ? 'patch' : 'sleep', prog(t, this.tWide - 1.2, this.ctx.end + 0.6));
    }
    this.shake(0.02 * f.a.kick);
    return this.present(f, out);
  }

  private animateDev(t: number) {
    if (this.v === 'final') return;
    const breath = Math.sin(t * 2.4);
    this.dev.torso.scale.set(1, 1, 1 + 0.03 * breath);
    this.dev.head.rotation.z = 0.12 + 0.04 * Math.sin(t * 0.9);
    this.dev.setFace(Math.floor(t * 0.7) % 4 === 3 ? 'smug' : 'sleep');
  }

  /** Line 1: each character floats up out of DEV's head as a Zzz letter and settles into the dream bubble. */
  private animateLetters(t: number) {
    for (const fl of this.flyers) {
      const u = (t - fl.w.start - 0.05) / 0.55;
      const gone = this.L2.words[0]!.start + 0.25;
      fl.mesh.visible = t >= fl.t && t < gone;
      if (!fl.mesh.visible) continue;
      (fl.mesh.material as THREE.RawShaderMaterial).uniforms.uMap!.value = t >= this.tDive ? fl.mesh.userData.dream : fl.mesh.userData.room;
      if (t >= this.tDive) {
        // in the dream: the line hangs over the table (the held word still waving), then floats away up
        const hold = fl.held ? clamp((t - fl.w.start - 0.2) / 0.15) * (1 - clamp((t - fl.w.end) / 0.3)) : 0;
        const up = prog(t, this.L2.words[0]!.start - 0.3, gone, ease.inQuad);
        fl.mesh.position.set(fl.dream[0], fl.dream[1] + up * 1.6 + hold * 0.06 * Math.sin(t * 16 - fl.dream[0] * 5) + 0.03 * Math.sin(t * 2 + fl.dream[0]), fl.dream[2]);
        fl.mesh.scale.setScalar(1 - up * 0.5);
        continue;
      }
      const e = ease.outCubic(clamp(u));
      const s = fl.slot, a = fl.from;
      const arc = Math.sin(Math.PI * clamp(u)) * 0.6;
      const sway = Math.sin(t * 4 + fl.w.start * 9) * 0.18 * Math.sin(Math.PI * clamp(u));
      const holdAmp = fl.held ? clamp((t - fl.w.start - 0.2) / 0.15) * (1 - clamp((t - fl.w.end) / 0.3)) : 0;
      const bob = 0.02 * Math.sin(t * 2.2 + s[0]) + holdAmp * 0.06 * Math.sin(t * 16 - s[0] * 5);
      fl.mesh.position.set(lerp(a[0], s[0], e) + sway, lerp(a[1], s[1], e) + arc * 0.3 + bob, lerp(a[2], s[2], e));
      fl.mesh.scale.setScalar(0.8 + 0.2 * e);
    }
  }

  /** Line 2: blocks drop onto the table; the toy winds across it and does its "party trick". */
  private animateDream(t: number) {
    if (this.v === 'final') return;
    for (const b of this.blocks) {
      const u = t - b.t;
      b.mesh.visible = u >= 0;
      if (!b.mesh.visible) continue;
      if (this.v === 2) {
        // chorus 2: the blocks spin up out of the tabletop
        const r = springStep(u, 3.2, 0.45);
        b.mesh.position.set(b.pos[0], b.pos[1] - (1 - r) * BLK * 1.1, b.pos[2]);
        b.mesh.rotation.set(0, (1 - clamp(r)) * Math.PI * 1.5, b.rz);
        continue;
      }
      const fall = clamp(u / 0.18);
      const bounce = u > 0.18 ? Math.exp(-(u - 0.18) * 9) * Math.abs(Math.sin((u - 0.18) * 22)) * 0.1 : 0;
      b.mesh.position.set(b.pos[0], b.pos[1] + (1 - fall * fall) * 1.3 + bounce, b.pos[2]);
      b.mesh.rotation.set((1 - fall) * 1.2, (1 - fall) * 0.6, b.rz + (1 - fall) * 0.8);
    }
    const y = this.toy;
    const w = this.L2.words, party = w[w.length - 2]!, trick = w[w.length - 1]!;
    const x0 = DX - 0.9;
    // wind-up walk, the key turning
    const walk = prog(t, this.tDive, party.start - 0.1);
    y.root.position.x = x0 + walk * 1.0;
    y.root.position.y = 0.97 + Math.abs(Math.sin(t * 18)) * 0.03 * (walk < 1 ? 1 : 0);
    y.key.rotation.z = t * 9;
    y.feet.forEach((ft, i) => { ft.position.z = 0.04 + Math.sin(t * 18 + i * Math.PI) * 0.05 * (walk < 1 ? 1 : 0); });
    const jug0 = party.start - 0.1;
    const competent = this.v === 2;
    y.root.rotation.set(0, 0.25 * Math.sin(t * 3), 0);
    y.balls.forEach((b, i) => {
      if (t < jug0) { b.position.set(0.28 * (i - 1), 0.08, 0.2); return; }
      const ph = (t - jug0) * 2.6 + i / 3;
      const cyc = ph % 1;
      const jx = Math.cos(Math.PI * cyc) * 0.26 * (Math.floor(ph) % 2 ? 1 : -1), jy = 0.55 + Math.sin(Math.PI * cyc) * 0.55;
      if (competent || t < trick.start) { b.position.set(jx, jy, 0.24); return; }
      // v1: the trick collapses on "trick,": the balls drop and scatter
      const u = t - trick.start, dir = i - 1;
      b.position.set(jx + dir * u * 0.9, Math.max(0.07, jy - 4.5 * u * u + 0.4 * u) + (u > 0.35 ? Math.abs(Math.sin(u * 14)) * 0.08 * Math.exp(-u * 5) : 0), 0.24 + u * 0.3);
    });
    const armUp = t >= jug0 ? 1 : 0;
    y.arms.forEach((a, i) => { a.rotation.x = -armUp * (1.2 + 0.4 * Math.sin((t - jug0) * 16 + i * Math.PI)); });
    if (!competent && t > trick.start + 0.1) {
      const u = springStep(t - trick.start - 0.1, 1.8, 0.5);
      y.root.rotation.z = -u * 1.35; y.root.position.y = 0.97 + u * 0.08;
      y.head.setFace('error');
    } else if (competent && t > trick.start) {
      y.root.rotation.x = 0.45 * Math.sin(Math.PI * clamp((t - trick.start) / 0.5));
      y.head.setFace('happy');
    } else y.head.setFace(t > party.start ? 'focused' : 'happy');
  }

  /** Line 3: the plaque, struck word by word (red while being hammered); the final chorus rewrites it. */
  private animatePlaque(t: number) {
    const fin = this.v === 'final';
    const pm = this.plaque.mesh;
    const onDesk = fin ? true : t >= this.tDesk - 0.02;
    pm.visible = onDesk;
    // placement (on the desk, tilted back); the final chorus throws it into the box on "keep..."
    const w = this.L3.words, keep = w[w.length - 1]!;
    const fly = fin ? prog(t, keep.start - 0.05, keep.start + 0.15, ease.inOutQuad) : 0;
    const arc = Math.sin(Math.PI * fly) * 0.6;
    // (final) it lands at an angle, partly in the small box: its lower edge drops in behind the front wall, it
    // leans back over the back rim (it is wider than the box, so it covers the opening), twisted a little
    // (tilted ~30°: only its lower-left corner is inside, between the walls; the bottom edge crosses the rim near
    // the middle and the right half rests above the rim, past the wall, so it never cuts through the cardboard)
    const outY = BOXP[1] + BOX_H + 0.25;
    pm.position.set(lerp(PLQ[0], BOXP[0], fly), lerp(PLQ[1], outY, fly) + arc, lerp(PLQ[2], BOXP[2] + 0.02, fly));
    pm.rotation.set(lerp(PLQ_TILT, -0.35, fly), lerp(0.08, 0.12, fly), lerp(0, 0.5, fly));
    pm.scale.set(PLAQ_W * this.ptx, PLAQ_H * this.ptx, 1);
    // content
    let key = '';
    const rows: { text: string; x: number; y: number; scratched?: boolean; fresh?: boolean }[] = [];
    w.forEach((wd, i) => {
      const s = this.slots[i]!;
      const sung = t >= wd.start - 0.02, hot = sung && t < wd.end + 0.1;
      if (fin) {
        const oldW = this.old!.words[i]!.w, changed = oldW.replace(/[^a-z]/gi, '') !== wd.w.replace(/[^a-z]/gi, '') || oldW !== wd.w;
        if (!sung) rows.push({ text: oldW, x: s.x, y: s.y });
        else {
          if (changed) rows.push({ text: oldW, x: s.x, y: s.y, scratched: true });
          rows.push({ text: wd.w, x: s.x, y: s.y, fresh: hot });
        }
      } else if (sung) rows.push({ text: wd.w, x: s.x, y: s.y, fresh: hot });
      key += `${sung ? 1 : 0}${hot ? 1 : 0}`;
    });
    this.plaque.draw(key, (c) => drawPlaque(c, rows));
    // the mallet: raised between strikes, down on each one, at the current word's slot
    const last = this.strikes.filter((s) => s <= t).pop(), next = this.strikes.find((s) => s > t);
    const cur = w.slice().reverse().find((wd) => wd.start <= t + 0.12) ?? w[0]!;
    const sl = this.slots[w.indexOf(cur)]!;
    const lx = (sl.x + sl.w / 2 - PLAQ_W / 2) * this.ptx, ly = (PLAQ_H / 2 - sl.y - 7) * this.ptx;
    const right = new THREE.Vector3(1, 0, 0).applyEuler(pm.rotation), up = new THREE.Vector3(0, 1, 0).applyEuler(pm.rotation), nrm = new THREE.Vector3(0, 0, 1).applyEuler(pm.rotation);
    const hit = pm.position.clone().addScaledVector(right, lx).addScaledVector(up, ly).addScaledVector(nrm, 0.01);
    let lift = 0.9;
    if (last !== undefined) lift = Math.min(0.9, (t - last) / 0.12 * 0.9);
    if (next !== undefined && next - t < 0.08) lift = Math.min(lift, ((next - t) / 0.08) * 0.9);
    const hammering = !fin && t >= this.tDesk && t < keep.end + 0.3;
    this.mallet.visible = hammering;
    if (hammering) {
      this.mallet.position.copy(hit).addScaledVector(nrm, 0.02).addScaledVector(right, 0.38).addScaledVector(up, 0.02);
      this.mallet.rotation.set(0, Math.PI / 2 + 0.08, 0);
      this.mallet.rotateX(lift * 0.9);
    }
    const sparkU = last !== undefined ? t - last : 9;
    this.spark.visible = hammering && sparkU < 0.06 && onDesk;
    this.spark.position.copy(hit).addScaledVector(nrm, 0.03);
    this.spark.scale.setScalar(0.6 + sparkU * 10);
  }

  /** The final chorus: the chatbot throws DEV's desk things into the box on the beats; the lid closes. */
  private animatePacking(t: number) {
    const b = this.bot!;
    const w = this.L3.words, keep = w[6]!;
    const room = this.room;
    const items: [THREE.Object3D, number, V3][] = [
      [room.duck, this.ctx.audio.timeOfBeat(Math.ceil(this.ctx.audio.beatAt(this.db[1]! + 0.05))), [0.45, 0.8, -3.1]],
      [this.nameplate, this.ctx.audio.timeOfBeat(Math.ceil(this.ctx.audio.beatAt(this.db[1]! + 0.4))), [0.52, 0.8, -2.95]],
      [this.trophy.root, this.ctx.audio.timeOfBeat(Math.ceil(this.ctx.audio.beatAt(this.db[1]! + 0.75))), [0.82, 0.8, -3.15]],
    ];
    let swing = 0;
    items.forEach(([o, t0, home], i) => {
      const u = prog(t, t0, t0 + 0.32, ease.inOutQuad);
      const inBox: V3 = [BOXP[0] + (i - 1) * 0.35, BOXP[1] + 0.12, BOXP[2] + ((i % 2) - 0.5) * 0.3];
      o.position.set(lerp(home[0], inBox[0], u), lerp(home[1], inBox[1], u) + Math.sin(Math.PI * u) * 0.8, lerp(home[2], inBox[2], u));
      o.rotation.x = u * 2.2 * (i % 2 ? 1 : -1);
      swing = Math.max(swing, 1 - Math.abs((t - t0) / 0.25));
    });
    // the NOT sticker slaps onto MINE on "not"
    const not = w[3]!;
    this.trophy.sticker.visible = t >= not.start;
    this.trophy.sticker.scale.setScalar(t >= not.start ? Math.min(1.1, springStep(t - not.start, 4, 0.4)) : 0.01);
    b.body.armR.rotation.x = -0.4 - 1.2 * clamp(swing);
    b.body.armL.rotation.x = -0.3 + 0.2 * Math.sin(t * 6);
    b.head.setFace(t > not.start && t < not.end + 0.2 ? 'talk' : 'happy', Math.floor(t * 8));
    b.body.root.rotation.y = 0.35 + 0.25 * Math.sin(t * 3);
    // the flaps: open outwards, then shut after the plaque lands
    // the flaps stay open (the plaque sticks out); they jolt when it lands
    const jolt = t >= keep.start + 0.15 ? Math.exp(-(t - keep.start - 0.15) * 7) * Math.sin((t - keep.start - 0.15) * 30) : 0;
    this.flaps.forEach((fl, i) => { fl.rotation.x = 2.1 + 0.12 * jolt * (i % 2 ? 1 : -1); });
  }
}
