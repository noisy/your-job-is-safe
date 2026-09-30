// #16 solo [after("And my job is mine to keep", 2nd) → cut("Monday morning")], the guitar solo, no lyrics.
//   The fails get patched while DEV isn't looking. The camera dives through DEV's CRT (PATCH NOTES on it)
//   into the chatbot's patch-notes screen: a PS1 inventory menu in 3D. Every two beats a new line types
//   in (a pixel icon, the fail's name, FAIL in red) while its low-poly model spins on the pedestal; on
//   the next beat it is ticked FIXED ✓ in fix green and the model repairs itself (the third R lights up,
//   the glass fills to the brim, the clock ticks, the sixth finger goes…); the version climbs
//   v3.2 → v4.8. DEV air-guitars on his keyboard in the back, eyes closed. The last bar: "v5.0 — CAN NOW
//   DO YOUR JOB." (→ breakdown's Monday ticket board, a hard cut on the downbeat).
import * as THREE from 'three';
import type { Frame } from '../engine/scene';
import { clamp, ease, lerp, springStep } from '../engine/util';
import { Ps1Stage, uiBox, type CamState, type V3 } from '../ps1/stage';
import { makeDev, makeRoom, type Dev, type Room } from '../ps1/cast';
import { pixText, textW, psMat, canvasTex } from '../ps1/gfx';
import { P } from '../ps1/palette';
import { makeItems, type Item } from './solo-props';
import { makeSunburst } from './intro-props';

const X = 60; // the menu set
const LIST_W = 224, LIST_H = 176, LIST_WW = 2.2;
const LIST: V3 = [X + 0.9, 1.15, 0.1];
const PED: V3 = [X - 1.2, 0, -0.35];
const VERS = ['3.2', '3.4', '3.6', '3.8', '4.0', '4.3', '4.6', '4.8'];

export default class Solo extends Ps1Stage {
  private beat = (_k: number) => 0;
  private tIn = 0; private tFinal = 0;
  private tItem: number[] = []; private tFix: number[] = [];
  private room!: Room; private dev!: Dev;
  private items: Item[] = [];
  private list!: ReturnType<Ps1Stage['panel']>;
  private finalP!: ReturnType<Ps1Stage['panel']>;
  private head!: ReturnType<Ps1Stage['blockTitle']>;
  private v5!: ReturnType<Ps1Stage['blockTitle']>;
  private sparks!: ReturnType<Ps1Stage['dustBurst']>;
  private set = new THREE.Group();
  private floor!: THREE.Mesh; private burst!: THREE.Group; private spot!: THREE.Mesh;
  private screenKey = '';

  override init() {
    const { audio: au, start } = this.ctx;
    const b0 = Math.round(au.beatAt(start));
    this.beat = (k: number) => au.timeOfBeat(b0 + k);
    this.tIn = this.beat(2);
    this.tItem = VERS.map((_, i) => this.beat(4 + 2 * i));
    this.tFix = VERS.map((_, i) => this.beat(5 + 2 * i));
    this.tFinal = this.beat(20);
    this.fogColor = P.fog; this.fogNear = 5; this.fogFar = 16;

    this.room = makeRoom(); this.world.add(this.room.root);
    this.world.add(this.set);
    // the menu world: a scrolling grid floor, a slow sunburst, a pedestal, DEV on a little stage behind
    const grid = canvasTex(32, 32, (c) => { c.fillStyle = '#10162A'; c.fillRect(0, 0, 32, 32); c.fillStyle = '#2E4A8C'; c.fillRect(0, 0, 32, 1); c.fillRect(0, 0, 1, 32); }, true).tex;
    const fg = new THREE.PlaneGeometry(30, 30, 6, 6);
    const fuv = fg.attributes.uv!; for (let i = 0; i < fuv.count; i++) fuv.setXY(i, fuv.getX(i) * 20, fuv.getY(i) * 20);
    this.floor = new THREE.Mesh(fg, psMat({ map: grid, unlit: true }));
    this.floor.rotation.x = -Math.PI / 2; this.floor.position.set(X, 0, 0); this.set.add(this.floor);
    this.burst = makeSunburst(20, '#1B3A3A', '#141B2E', 12);
    this.burst.position.set(X, 2, -7); this.set.add(this.burst);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.42, 8), psMat({ color: P.uiNavy }));
    ped.position.set(PED[0], 0.21, PED[2]); this.set.add(ped);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.04, 3, 16), psMat({ color: P.title, emit: '#403010' }));
    ring.rotation.x = Math.PI / 2; ring.position.set(PED[0], 0.43, PED[2]); this.set.add(ring);
    this.items = makeItems();
    for (const it of this.items) { this.set.add(it.model); }
    this.sparks = this.dustBurst(16, P.fix, 0.07);
    this.head = this.blockTitle('PATCH NOTES', { depth: 0.4 });
    this.head.root.scale.setScalar(0.4);
    this.v5 = this.blockTitle('v5.0', { cap: P.fix, side: P.fixSide, depth: 0.5 });
    this.v5.root.scale.setScalar(0.28);
    // DEV rocking out on a stage in the back, the keyboard as his guitar
    this.dev = makeDev(); this.dev.setFace('laugh');
    this.dev.root.position.set(X + 0.3, 0.3, -2.2);
    this.dev.root.rotation.y = Math.PI; // facing the camera
    this.dev.root.scale.setScalar(1.35);
    this.set.add(this.dev.root);
    const stage = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.3, 1.4), psMat({ color: '#3B3F5C' }));
    stage.position.set(X + 0.3, 0.15, -2.2); this.set.add(stage);
    const keysT = canvasTex(32, 8, (c) => { c.fillStyle = P.beige; c.fillRect(0, 0, 32, 8); c.fillStyle = P.beigeDark; for (let x = 1; x < 32; x += 3) for (let y = 1; y < 8; y += 3) c.fillRect(x, y, 2, 2); }).tex;
    const kb = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.05), psMat({ map: keysT }));
    // the keytar: the keyboard slung diagonally across his front (DEV faces local -z), a neck up to his left
    kb.position.set(0.02, 0.24, -0.19); kb.rotation.z = -0.5; this.dev.torso.add(kb);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.05), psMat({ color: '#2A2A33' }));
    neck.position.set(-0.46, 0.2, 0); kb.add(neck);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.62, 0.03), psMat({ color: P.fail }));
    strap.position.set(0, 0.3, -0.16); strap.rotation.z = 0.7; this.dev.torso.add(strap);
    this.spot = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.2, 8, 1, true), psMat({ color: '#FFE9A8', opacity: 0.18, additive: true, unlit: true, side: THREE.DoubleSide, fog: 0 }));
    this.spot.position.set(X + 0.3, 2.1, -2.2); this.spot.scale.set(1.3, 1.1, 1.3); this.set.add(this.spot);
    // the list and the last message
    this.list = this.panel(LIST_W, LIST_H).inWorld();
    this.list.mesh.position.set(...LIST);
    this.list.mesh.rotation.y = -0.16;
    this.list.mesh.scale.set(LIST_WW, LIST_WW * (LIST_H / LIST_W), 1);
    this.finalP = this.panel(200, 72);
    this.finalP.mesh.position.set(X + 0.35, 1.1, 1.0);
    this.finalP.mesh.scale.set(2.1, 2.1 * (72 / 200), 1);
    this.finalP.draw('final', (c) => {
      uiBox(c, 0, 0, 200, 72, P.uiBg);
      pixText(c, 'v5.0', 8, 7, P.fix, 1);
      pixText(c, 'NEW FEATURE:', 36, 7, P.uiDim, 1);
      pixText(c, 'CAN NOW DO', 100 - textW('CAN NOW DO', 3) / 2, 20, P.key2, 3, { shadow: P.uiEdge });
      pixText(c, 'YOUR JOB.', 100 - textW('YOUR JOB.', 3) / 2, 45, P.key2, 3, { shadow: P.uiEdge });
    });
  }

  camAt(t: number): CamState {
    const s = this.room.screenPos;
    if (t < this.tIn) {
      // DEV's CRT, PATCH NOTES on it: push in until the screen is the frame
      const e = ease.inCubic(clamp((t - this.ctx.start) / (this.tIn - this.ctx.start)));
      return { P: [s.x + 0.05 * (1 - e), s.y, s.z + lerp(0.8, 0.3, e)], T: [s.x, s.y, s.z], fov: 52 };
    }
    const front: CamState = { P: [X + 0.05, 1.3, 2.75], T: [X - 0.05, 1.0, 0], fov: 52 };
    const item: CamState = { P: [X - 2.2, 1.5, 2.45], T: [X - 0.6, 1.0, -0.1], fov: 52, roll: 0.04 };
    const side: CamState = { P: [X + 1.9, 1.5, 2.3], T: [X + 0.1, 1.0, 0], fov: 52, roll: -0.03 };
    // DEV in the spotlight, rocking out behind the item on the pedestal
    const devC: CamState = { P: [X - 1.35, 1.45, 1.55], T: [X - 0.15, 1.45, -1.6], fov: 52, roll: 0.05 };
    // fly back out of the PATCH NOTES title into the menu
    const inCam: CamState = { P: [X, 1.25, 0.9], T: [X, 1.25, -1], fov: 60 };
    let c = mixCam(inCam, front, ease.outExpo(clamp((t - this.tIn) / 0.6)));
    // one framing per item (alternating), a push on each FIXED beat
    const i = this.tItem.filter((x) => t >= x).length - 1;
    if (i >= 0) {
      const target = [front, item, side, devC][i % 4]!;
      const prev = i === 0 ? front : [front, item, side, devC][(i - 1) % 4]!;
      c = mixCam(prev, target, ease.outExpo(clamp((t - this.tItem[i]!) / 0.28)));
      const push = 0.1 * springStep(t - this.tFix[i]!, 2.5, 0.5) * (t > this.tFix[i]! ? 1 : 0);
      c.P = [lerp(c.P[0], c.T[0], push), lerp(c.P[1], c.T[1], push), lerp(c.P[2], c.T[2], push)];
    }
    // the last bar: crash zoom onto the new feature
    const fin: CamState = { P: [X + 0.35, 1.18, 2.35], T: [X + 0.35, 1.12, 1.0], fov: 52 };
    const z = ease.outExpo(clamp((t - this.tFinal) / 0.18));
    if (z > 0) c = mixCam(c, fin, z);
    c.roll = (c.roll ?? 0) + (z > 0 ? 0.03 * Math.sin((t - this.tFinal) * 3) : 0);
    return c;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    this.begin();
    const t = f.t, au = this.ctx.audio;
    const inside = t >= this.tIn;
    this.room.root.visible = !inside;
    this.set.visible = inside;
    if (!inside) this.drawScreen();
    this.list.mesh.visible = inside;
    this.finalP.open = t >= this.tFinal ? clamp((t - this.tFinal) / 0.12) : 0;
    this.finalP.mesh.visible = this.finalP.open > 0.01;
    this.finalP.mesh.scale.set(2.1 * (0.6 + 0.4 * ease.outBack(this.finalP.open)), 2.1 * (72 / 200) * ease.outBack(this.finalP.open), 1);
    // the PATCH NOTES title flies past the camera on the way in, then hangs over the menu
    const hu = t - this.tIn;
    this.head.root.visible = inside && hu < 0.55; // flies past on the way in; the list panel carries the name after
    const he = ease.outExpo(clamp(hu / 0.6));
    this.head.root.position.set(X, lerp(1.25, 2.3, he), lerp(0.2, -0.9, he));
    this.head.letters.forEach((l, k) => (l.position.y = 0.08 * Math.sin(t * 6 - k * 0.5)));
    this.v5.root.visible = false; // (cropped at the top at this framing; the panel already says v5.0)
    const vu = t - this.tFinal;
    this.v5.root.position.set(X + 0.35, 1.66 + 0.8 * (1 - ease.outBack(clamp(vu / 0.2), 2)), 0.9);
    this.v5.root.rotation.y = 0.2 * Math.sin(t * 2);
    // grid and sunburst move with the beat
    this.burst.rotation.z = t * 0.2;
    this.floor.position.z = (t * 1.2) % 1.5;
    // DEV air guitar: headbang on the beat, strum on the eighths
    const beat = au.beatAt(t);
    // head-bang on the beats (the head drops forward, toward local -z: a negative x tilt for his head box)
    const bang = Math.abs(Math.sin(Math.PI * beat));
    this.dev.head.rotation.x = -0.4 * bang;
    this.dev.hips.rotation.x = 0.1 * bang;
    this.dev.setFace(bang > 0.6 ? 'laugh' : 'sleep'); // eyes shut, mouth open on the hits
    // left hand up on the neck (fretting, sliding on the half beats), right hand strumming the keys
    this.dev.armL.rotation.set(1.35 + 0.08 * Math.sin(Math.PI * 2 * beat), 0, -0.55);
    this.dev.armR.rotation.set(0.75 + 0.3 * Math.sin(Math.PI * 4 * beat), 0, 0.35);
    this.dev.legL.rotation.z = -0.15; this.dev.legR.rotation.z = 0.15;
    this.spot.rotation.y = t;
    // the item on the pedestal: pops in, spins, repairs on its FIXED beat
    const cur = this.tItem.filter((x) => t >= x).length - 1;
    this.items.forEach((it, i) => {
      const on = i === cur && t < this.tFinal;
      it.model.visible = inside && on;
      it.fix(t >= this.tFix[i]! ? clamp((t - this.tFix[i]!) / 0.1) : 0, t);
      if (!on) return;
      const pop = clamp(springStep(t - this.tItem[i]!, 3, 0.4), 0, 1.3);
      const fixed = t >= this.tFix[i]!;
      it.model.scale.setScalar(1.3 * pop * (fixed ? 1 + 0.15 * Math.exp(-(t - this.tFix[i]!) * 8) : 1));
      it.model.position.set(PED[0], 1.05 + 0.06 * Math.sin(t * 3), PED[2]);
      it.model.rotation.y = t * (fixed ? 2.4 : 1.2);
    });
    const fixK = this.tFix.filter((x) => t >= x).length - 1;
    this.sparks.update(t, fixK >= 0 ? this.tFix[fixK]! : -9, [PED[0], 0.9, PED[2]], 0.3, 0.6);
    if (inside) this.drawList(t);
    if (t >= this.tFinal && t - this.tFinal < 0.1) this.shake(0.08);
    return this.present(f, out);
  }

  private drawList(t: number) {
    const shown = this.tItem.filter((x) => t >= x).length;
    const typed = this.tItem.map((x, i) => clamp(Math.floor(((t - x) / 0.2) * this.items[i]!.name.length), 0, this.items[i]!.name.length));
    const fixed = this.tFix.map((x) => t >= x);
    const flash = this.tFix.map((x) => t >= x && t - x < 0.2);
    const ver = fixed.lastIndexOf(true);
    const key = `${shown}|${typed.join(',')}|${fixed.map(Number).join('')}|${flash.map(Number).join('')}`;
    this.list.draw(key, (c) => {
      uiBox(c, 0, 0, LIST_W, LIST_H, P.uiBg);
      pixText(c, 'PATCH NOTES', 8, 7, P.uiLine, 2, { shadow: P.uiEdge });
      const v = `v${VERS[Math.max(0, ver)]}`;
      pixText(c, v, LIST_W - 8 - textW(v, 2), 7, P.key2, 2, { shadow: P.uiEdge });
      c.fillStyle = P.uiDim; c.fillRect(6, 23, LIST_W - 12, 1);
      for (let i = 0; i < shown; i++) {
        const y = 27 + i * 18;
        if (i === shown - 1) { c.fillStyle = P.uiNavy; c.fillRect(4, y - 1, LIST_W - 8, 17); }
        if (flash[i]) { c.fillStyle = P.fixSide; c.fillRect(4, y - 1, LIST_W - 8, 17); }
        this.items[i]!.icon(c, 7, y + 1);
        pixText(c, this.items[i]!.name.slice(0, typed[i]!), 24, y + 2, P.uiLine, 2, { shadow: P.uiEdge });
        const st = fixed[i] ? 'FIXED ✓' : 'FAIL ✗';
        pixText(c, st, LIST_W - 8 - textW(st), y + 5, fixed[i] ? P.fix : P.fail);
      }
    });
  }

  private drawScreen() {
    if (this.screenKey === 'pn') return;
    this.screenKey = 'pn';
    const c = this.room.screen.ctx;
    c.fillStyle = '#10162A'; c.fillRect(0, 0, 128, 96);
    uiBox(c, 6, 10, 116, 76, P.uiBg);
    pixText(c, 'PATCH', 64 - textW('PATCH', 3) / 2, 22, P.title, 3, { shadow: P.titleSide });
    pixText(c, 'NOTES', 64 - textW('NOTES', 3) / 2, 46, P.title, 3, { shadow: P.titleSide });
    pixText(c, 'v3.2', 64 - textW('v3.2') / 2, 72, P.key2);
    this.room.screen.tex.needsUpdate = true;
  }
}

function mixCam(a: CamState, b: CamState, k: number): CamState {
  const m = (x: V3, y: V3): V3 => [lerp(x[0], y[0], k), lerp(x[1], y[1], k), lerp(x[2], y[2], k)];
  return { P: m(a.P, b.P), T: m(a.T, b.T), roll: lerp(a.roll ?? 0, b.roll ?? 0, k), fov: lerp(a.fov ?? 52, b.fov ?? 52, k) };
}
