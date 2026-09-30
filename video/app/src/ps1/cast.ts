// The recurring cast and home set, identical in every scene (docs/TREATMENT.md, "The cast"):
//   makeDev()      DEV, the smug programmer (green hoodie). Full body on pivots, eight faces, sit/stand.
//   makeBotHead()  the chatbot: the beige CRT head with two square blue eyes, face states and a version badge.
//   makeBotBody()  a chunky humanoid body for the head (the box packer, the robot plumber…).
//   makeRoom()     DEV's room: desk, CRT with a live 128x96 screen canvas, lamp, chair, window, the
//                  rubber duck and the 10:10 wall clock.
// All geometry sits on the floor (y = 0) facing -z (DEV looks at his desk along -z).
import * as THREE from 'three';
import { pixText, textW, psMat, canvasTex, rng, shade } from './gfx';
import { P } from './palette';

const box = (w: number, h: number, d: number, m: THREE.Material | THREE.Material[]) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const noiseTex = (hex: string, seed: number, size = 16, amt = 0.15) => {
  const R = rng(seed);
  return canvasTex(size, size, (c) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { c.fillStyle = shade(hex, 1 - amt / 2 + R() * amt); c.fillRect(x, y, 1, 1); } }).tex;
};

// ---------------------------------------------------------------- DEV
export type DevFace = 'neutral' | 'smug' | 'laugh' | 'shock' | 'sleep' | 'sad' | 'scared' | 'yell';

function devFaceTex(face: DevFace) {
  return canvasTex(16, 16, (c) => {
    const px = (x: number, y: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
    px(0, 0, 16, 16, P.skin);
    px(0, 0, 16, 4, P.hair); px(0, 4, 2, 3, P.hair); px(14, 4, 2, 3, P.hair);
    const eye = P.ink, mouth = '#7A2E2E', teeth = '#F3ECDF';
    px(7, 8, 2, 2, '#B8826A'); // nose
    switch (face) {
      case 'neutral': px(4, 6, 2, 2, eye); px(10, 6, 2, 2, eye); px(6, 12, 4, 1, mouth); break;
      case 'smug': px(4, 7, 3, 1, eye); px(10, 7, 3, 1, eye); px(3, 5, 4, 1, P.hair); px(10, 4, 4, 1, P.hair); px(5, 12, 6, 1, mouth); px(11, 11, 1, 1, mouth); px(12, 10, 1, 1, mouth); break;
      case 'laugh': px(4, 7, 3, 1, eye); px(9, 7, 3, 1, eye); px(4, 6, 1, 1, eye); px(11, 6, 1, 1, eye); px(4, 11, 8, 3, mouth); px(5, 11, 6, 1, teeth); break;
      case 'shock': px(3, 5, 3, 3, '#FFFFFF'); px(10, 5, 3, 3, '#FFFFFF'); px(4, 6, 1, 1, eye); px(11, 6, 1, 1, eye); px(6, 11, 4, 4, mouth); break;
      case 'sleep': px(4, 7, 3, 1, eye); px(10, 7, 3, 1, eye); px(6, 12, 3, 1, mouth); px(9, 11, 1, 1, mouth); break;
      case 'sad': px(4, 7, 2, 2, eye); px(10, 7, 2, 2, eye); px(3, 5, 3, 1, P.hair); px(10, 5, 3, 1, P.hair); px(6, 13, 4, 1, mouth); px(5, 14, 1, 1, mouth); px(10, 14, 1, 1, mouth); px(3, 9, 1, 2, '#8CD3FF'); break;
      case 'scared': px(3, 5, 3, 3, '#FFFFFF'); px(10, 5, 3, 3, '#FFFFFF'); px(4, 7, 1, 1, eye); px(11, 7, 1, 1, eye); px(5, 12, 6, 2, mouth); px(5, 12, 6, 1, teeth); px(1, 8, 1, 3, '#8CD3FF'); break;
      case 'yell': px(3, 6, 3, 1, eye); px(10, 6, 3, 1, eye); px(4, 5, 2, 1, P.hair); px(10, 5, 2, 1, P.hair); px(4, 10, 8, 5, mouth); px(5, 10, 6, 1, teeth); break;
    }
  }).tex;
}

export interface Dev {
  root: THREE.Group;
  /** Pivots (rotate these): hips carries the upper body. */
  hips: THREE.Object3D; torso: THREE.Object3D; head: THREE.Mesh;
  armL: THREE.Object3D; armR: THREE.Object3D; legL: THREE.Object3D; legR: THREE.Object3D;
  setFace(f: DevFace): void;
  /** Seated (thighs forward, hips at chair height) or standing. */
  sit(on: boolean): void;
  /** Overalls (the plumber) instead of the hoodie. */
  outfit(o: 'hoodie' | 'overalls' | 'pyjamas'): void;
}

export function makeDev(): Dev {
  const root = new THREE.Group();
  const cloth = psMat({ map: noiseTex(P.hoodie, 11) });
  const jeans = psMat({ map: noiseTex(P.jeans, 12) });
  const hair = psMat({ color: P.hair });
  const skin = psMat({ color: P.skin });
  const shoe = psMat({ color: '#2A2A33' });
  const faces = new Map<DevFace, THREE.Texture>();
  const faceMat = psMat({ map: devFaceTex('neutral') });
  const hips = new THREE.Object3D(); hips.position.set(0, 0.62, 0);
  const torso = new THREE.Object3D(); hips.add(torso);
  const body = box(0.5, 0.58, 0.3, cloth); body.position.set(0, 0.3, 0); torso.add(body);
  const head = box(0.32, 0.34, 0.32, [hair, hair, hair, skin, hair, faceMat]); head.position.set(0, 0.78, -0.02); torso.add(head);
  const hood = box(0.36, 0.14, 0.12, cloth); hood.position.set(0, 0.56, 0.16); torso.add(hood);
  const arm = (x: number) => {
    const piv = new THREE.Object3D(); piv.position.set(x, 0.54, 0);
    const a = box(0.13, 0.5, 0.13, cloth); a.position.set(0, -0.24, 0);
    const hand = box(0.12, 0.12, 0.12, skin); hand.position.set(0, -0.53, 0);
    piv.add(a, hand); torso.add(piv); return piv;
  };
  const armL = arm(-0.31), armR = arm(0.31);
  // legs: a hip pivot (the thigh) and a knee pivot (the shin + shoe), so DEV can sit properly
  const knees: THREE.Object3D[] = [];
  const leg = (x: number) => {
    const piv = new THREE.Object3D(); piv.position.set(x, 0, 0);
    const thigh = box(0.2, 0.3, 0.22, jeans); thigh.position.set(0, -0.15, 0);
    const knee = new THREE.Object3D(); knee.position.set(0, -0.3, 0);
    const shin = box(0.19, 0.28, 0.2, jeans); shin.position.set(0, -0.14, 0);
    const s = box(0.2, 0.08, 0.3, shoe); s.position.set(0, -0.28, -0.05);
    knee.add(shin, s); piv.add(thigh, knee); hips.add(piv); knees.push(knee); return piv;
  };
  const legL = leg(-0.13), legR = leg(0.13);
  root.add(hips);
  const dev: Dev = {
    root, hips, torso, head, armL, armR, legL, legR,
    setFace(f) {
      if (!faces.has(f)) faces.set(f, devFaceTex(f));
      faceMat.uniforms.uMap!.value = faces.get(f)!;
    },
    sit(on) {
      // DEV faces -z: a positive x rotation swings the thigh forward (under the desk), the knee bends
      // the shin back to vertical, feet on the floor
      const a = Math.PI / 2 - 0.3;
      hips.position.y = on ? 0.5 : 0.62;
      legL.rotation.x = legR.rotation.x = on ? a : 0;
      for (const k of knees) k.rotation.x = on ? -a : 0;
    },
    outfit(o) {
      const col = o === 'overalls' ? '#3D5A9A' : o === 'pyjamas' ? '#6A7FB8' : P.hoodie;
      cloth.uniforms.uMap!.value = noiseTex(col, 11);
      jeans.uniforms.uMap!.value = noiseTex(o === 'overalls' ? '#3D5A9A' : o === 'pyjamas' ? '#6A7FB8' : P.jeans, 12);
    },
  };
  return dev;
}

// ---------------------------------------------------------------- the chatbot
export type BotFace = 'neutral' | 'happy' | 'talk' | 'blink' | 'think' | 'wrong' | 'glasses' | 'error' | 'focused' | 'off';

function botFaceTex(face: BotFace, frame = 0) {
  return canvasTex(24, 18, (c) => {
    const px = (x: number, y: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
    px(0, 0, 24, 18, '#10162A');
    const e = P.bot;
    if (face === 'off') { px(10, 8, 4, 1, '#2A3350'); return; }
    if (face === 'error') { px(4, 4, 16, 10, '#2E4A8C'); pixText(c, ':(', 7, 5, '#E8E4D8'); return; }
    const eyes = face === 'blink' ? () => { px(5, 7, 4, 1, e); px(15, 7, 4, 1, e); }
      : face === 'focused' ? () => { px(5, 6, 4, 2, P.fail); px(15, 6, 4, 2, P.fail); }
      : face === 'think' ? () => { px(6, 4, 3, 3, e); px(16, 4, 3, 3, e); }
      : () => { px(5, 5, 4, 4, e); px(15, 5, 4, 4, e); };
    eyes();
    if (face === 'glasses') { c.strokeStyle = P.title; c.lineWidth = 1; c.strokeRect(3.5, 3.5, 7, 7); c.strokeRect(13.5, 3.5, 7, 7); px(10, 6, 4, 1, P.title); }
    if (face === 'happy') { px(7, 12, 10, 1, e); px(6, 11, 1, 1, e); px(17, 11, 1, 1, e); }
    else if (face === 'talk') { if (frame % 2) px(9, 11, 6, 3, e); else px(8, 12, 8, 1, e); }
    else if (face === 'wrong') { px(8, 13, 8, 1, e); px(7, 12, 1, 1, e); px(16, 12, 1, 1, e); pixText(c, '?', 19, 1, P.title); }
    else if (face === 'focused') px(8, 13, 8, 1, P.fail);
    else px(8, 12, 8, 1, e);
  }).tex;
}

export interface BotHead {
  root: THREE.Group;
  setFace(f: BotFace, frame?: number): void;
  setVersion(v: string): void;
  /** The face screen mesh (to put your own canvas texture on it: an LED text display, a grawlix…). */
  screen: THREE.Mesh;
}

/** The chatbot's CRT head, ~0.62 wide, standing on y = 0, its face screen facing +z. */
export function makeBotHead(version = 'v1.0'): BotHead {
  const root = new THREE.Group();
  const shell = psMat({ map: noiseTex(P.beige, 21) });
  const dark = psMat({ color: P.beigeDark });
  const faces = new Map<string, THREE.Texture>();
  const faceMat = psMat({ map: botFaceTex('neutral'), unlit: true, fog: 0.5 });
  const casing = box(0.62, 0.5, 0.5, shell); casing.position.set(0, 0.25, 0);
  const back = box(0.4, 0.34, 0.24, shell); back.position.set(0, 0.25, -0.34);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.375), faceMat); screen.position.set(0, 0.26, 0.262);
  const chin = box(0.62, 0.06, 0.5, dark); chin.position.set(0, 0.03, 0);
  const antenna = box(0.03, 0.18, 0.03, dark); antenna.position.set(0.18, 0.59, -0.1);
  const bulb = box(0.07, 0.07, 0.07, psMat({ color: P.fail, emit: '#400010' })); bulb.position.set(0.18, 0.7, -0.1);
  // the version badge on the right side of the casing
  const badgeC = canvasTex(32, 12, () => {});
  const badgeMat = psMat({ map: badgeC.tex, unlit: true, fog: 0.4 });
  const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.12), badgeMat);
  badge.position.set(0.312, 0.3, 0.05); badge.rotation.y = Math.PI / 2;
  const badgeL = badge.clone(); badgeL.position.x = -0.312; badgeL.rotation.y = -Math.PI / 2;
  root.add(casing, back, screen, chin, antenna, bulb, badge, badgeL);
  const head: BotHead = {
    root, screen,
    setFace(f, frame = 0) {
      const k = `${f}:${f === 'talk' ? frame % 2 : 0}`;
      if (!faces.has(k)) faces.set(k, botFaceTex(f, frame));
      faceMat.uniforms.uMap!.value = faces.get(k)!;
    },
    setVersion(v) {
      const c = badgeC.ctx;
      c.fillStyle = P.uiEdge; c.fillRect(0, 0, 32, 12);
      c.fillStyle = P.uiNavy; c.fillRect(1, 1, 30, 10);
      pixText(c, v, Math.floor((32 - textW(v)) / 2), 3, P.key2);
      badgeC.tex.needsUpdate = true;
    },
  };
  head.setVersion(version);
  return head;
}

export interface BotBody { root: THREE.Group; neck: THREE.Object3D; armL: THREE.Object3D; armR: THREE.Object3D; legL: THREE.Object3D; legR: THREE.Object3D }

/** A chunky humanoid body (~1.5 tall to the neck); attach a head to `neck`. `tint` colours the torso (overalls blue for the plumber). */
export function makeBotBody(tint = '#8A93A8'): BotBody {
  const root = new THREE.Group();
  const metal = psMat({ map: noiseTex(tint, 31) });
  const joint = psMat({ color: '#4A5068' });
  const hips = new THREE.Object3D(); hips.position.set(0, 0.7, 0); root.add(hips);
  const torso = box(0.62, 0.66, 0.4, metal); torso.position.set(0, 0.42, 0); hips.add(torso);
  const neck = new THREE.Object3D(); neck.position.set(0, 0.8, 0); hips.add(neck);
  const arm = (x: number) => {
    const piv = new THREE.Object3D(); piv.position.set(x, 0.68, 0);
    const a = box(0.16, 0.56, 0.16, metal); a.position.set(0, -0.27, 0);
    const hnd = box(0.18, 0.14, 0.18, joint); hnd.position.set(0, -0.6, 0);
    piv.add(a, hnd); hips.add(piv); return piv;
  };
  const leg = (x: number) => {
    const piv = new THREE.Object3D(); piv.position.set(x, 0.06, 0);
    const l = box(0.22, 0.64, 0.24, joint); l.position.set(0, -0.36, 0);
    const f = box(0.24, 0.1, 0.34, metal); f.position.set(0, -0.68, 0.05);
    piv.add(l, f); hips.add(piv); return piv;
  };
  return { root, neck, armL: arm(-0.42), armR: arm(0.42), legL: leg(-0.16), legR: leg(0.16) };
}

// ---------------------------------------------------------------- DEV's room
export interface Room {
  root: THREE.Group;
  /** The CRT's live screen (draw into ctx, set tex.needsUpdate); 128x96 texels. */
  screen: { tex: THREE.CanvasTexture; ctx: CanvasRenderingContext2D; mesh: THREE.Mesh };
  /** World position of the screen's centre and the direction it faces (for dives into the CRT). */
  screenPos: THREE.Vector3; screenNormal: THREE.Vector3;
  duck: THREE.Group;
  clock: { root: THREE.Group; hour: THREE.Object3D; minute: THREE.Object3D; second: THREE.Object3D };
  /** Desk top height and the seat position (put DEV there, seated, facing -z). */
  deskY: number; seat: THREE.Vector3;
  /** DEV's desk chair (seat, back, post), to hide or move it. */
  chair: THREE.Group;
}

/** A 10:10 wall clock (radius ~0.3), hands on pivots (rotate about z). */
export function makeClock(r = 0.3, rim: string = P.title) {
  const root = new THREE.Group();
  const faceC = canvasTex(32, 32, (c) => {
    c.fillStyle = '#F3ECDF'; c.fillRect(0, 0, 32, 32);
    c.fillStyle = P.ink;
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; c.fillRect(Math.round(16 + Math.sin(a) * 12) - (i % 3 ? 0 : 1), Math.round(16 - Math.cos(a) * 12) - (i % 3 ? 0 : 1), i % 3 ? 1 : 2, i % 3 ? 1 : 2); }
  });
  const face = new THREE.Mesh(new THREE.CircleGeometry(r, 12), psMat({ map: faceC.tex }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.12, 3, 12), psMat({ color: rim }));
  const hand = (len: number, w: number, col: string) => {
    const piv = new THREE.Object3D(); piv.position.z = 0.01;
    const m = box(w, len, 0.01, psMat({ color: col, unlit: true })); m.position.y = len / 2 - w;
    piv.add(m); return piv;
  };
  const hour = hand(r * 0.5, r * 0.1, P.ink), minute = hand(r * 0.8, r * 0.07, P.ink), second = hand(r * 0.85, r * 0.03, P.fail);
  // 10:10
  hour.rotation.z = -((10 + 10 / 60) / 12) * Math.PI * 2; minute.rotation.z = -(10 / 60) * Math.PI * 2; second.rotation.z = -(30 / 60) * Math.PI * 2;
  root.add(face, ring, hour, minute, second);
  return { root, hour, minute, second };
}

/** The rubber duck (a cube duck, ~0.14 tall), facing +z. */
export function makeDuck() {
  const root = new THREE.Group();
  const y = psMat({ color: '#FFD23F' }), o = psMat({ color: '#F28C28' }), k = psMat({ color: P.ink, unlit: true });
  const b = box(0.16, 0.09, 0.12, y); b.position.set(0, 0.045, 0);
  const h = box(0.08, 0.08, 0.08, y); h.position.set(0, 0.12, 0.02);
  const beak = box(0.05, 0.02, 0.04, o); beak.position.set(0, 0.11, 0.075);
  const e1 = box(0.015, 0.02, 0.01, k); e1.position.set(-0.025, 0.135, 0.062);
  const e2 = e1.clone(); e2.position.x = 0.025;
  root.add(b, h, beak, e1, e2);
  return root;
}

/** `props: false` leaves out the plain keyboard and the mug (for scenes that build detailed ones). */
/**
 * A wooden frame around a w x h opening on a wall, centred on the opening, standing out of the wall along +z
 * (rotate the group like the opening). `sill`: a deeper ledge under it (windows); `bottom: false`: no bottom rail (doors).
 */
export function makeFrame(w: number, h: number, o: { t?: number; depth?: number; color?: string; sill?: boolean; bottom?: boolean } = {}) {
  const t = o.t ?? 0.1, dp = o.depth ?? 0.08;
  const m = psMat({ color: o.color ?? '#4A3222' });
  const g = new THREE.Group();
  const add = (bw: number, bh: number, bd: number, x: number, y: number, z = dp / 2) => { const b = box(bw, bh, bd, m); b.position.set(x, y, z); g.add(b); };
  add(t, h + 2 * t, dp, -(w + t) / 2, 0); add(t, h + 2 * t, dp, (w + t) / 2, 0); // jambs
  add(w + 2 * t, t, dp, 0, (h + t) / 2); // head
  if (o.bottom !== false) add(w + 2 * t, t, dp, 0, -(h + t) / 2);
  if (o.sill) add(w + 2 * t + 0.12, t * 0.7, dp + 0.14, 0, -(h + t) / 2 - t * 0.5, (dp + 0.14) / 2);
  return g;
}

export function makeRoom(opts: { props?: boolean } = {}): Room {
  const props = opts.props ?? true;
  const root = new THREE.Group();
  const R = rng(7);
  const floorT = canvasTex(64, 64, (c) => {
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const tile = ((x >> 5) + (y >> 5)) & 1; c.fillStyle = shade(tile ? '#35507A' : '#2A3C5E', 0.95 + R() * 0.08); c.fillRect(x, y, 1, 1); }
    c.fillStyle = '#1A2640'; c.fillRect(0, 0, 64, 1); c.fillRect(0, 32, 64, 1); c.fillRect(0, 0, 1, 64); c.fillRect(32, 0, 1, 64);
  }, true).tex;
  const floorG = new THREE.PlaneGeometry(16, 16, 4, 4);
  const uv = floorG.attributes.uv!; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 8, uv.getY(i) * 8);
  const floor = new THREE.Mesh(floorG, psMat({ map: floorT })); floor.rotation.x = -Math.PI / 2; root.add(floor);
  const wallT = canvasTex(64, 64, (c) => {
    for (let x = 0; x < 64; x++) { const plank = x >> 4; for (let y = 0; y < 64; y++) { c.fillStyle = shade(['#6B4B36', '#5E4230', '#735039', '#644634'][plank]!, 0.92 + R() * 0.12); c.fillRect(x, y, 1, 1); } }
    c.fillStyle = '#3B281C'; for (const x of [0, 16, 32, 48]) c.fillRect(x, 0, 1, 64);
    c.fillStyle = '#2E2016'; c.fillRect(0, 56, 64, 8);
  }, true).tex;
  const wallG = new THREE.PlaneGeometry(16, 5, 4, 2);
  const wuv = wallG.attributes.uv!; for (let i = 0; i < wuv.count; i++) wuv.setXY(i, wuv.getX(i) * 8, wuv.getY(i) * 2.5);
  const wall = (x: number, z: number, ry: number) => { const w = new THREE.Mesh(wallG, psMat({ map: wallT })); w.position.set(x, 2.5, z); w.rotation.y = ry; root.add(w); };
  wall(0, -4.2, 0); wall(-5, 0, Math.PI / 2); wall(5, 0, -Math.PI / 2);
  const winT = canvasTex(32, 32, (c) => {
    c.fillStyle = '#1B2A55'; c.fillRect(0, 0, 32, 32);
    for (let i = 0; i < 14; i++) { c.fillStyle = R() > 0.5 ? '#E8E4D8' : '#8C93B8'; c.fillRect(Math.floor(R() * 30) + 1, Math.floor(R() * 22) + 1, 1, 1); }
    c.fillStyle = '#F4E3A3'; c.fillRect(22, 5, 4, 4); c.fillStyle = '#1B2A55'; c.fillRect(24, 5, 2, 2);
    c.fillStyle = '#3B281C'; c.fillRect(15, 0, 2, 32); c.fillRect(0, 15, 32, 2);
  }).tex;
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), psMat({ map: winT, unlit: true })); win.position.set(-2.2, 2.4, -4.18); root.add(win);
  const wf = makeFrame(1.6, 1.2, { sill: true }); wf.position.set(-2.2, 2.4, -4.2); root.add(wf);
  const woodT = canvasTex(32, 32, (c) => {
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { c.fillStyle = shade(P.wood, 0.85 + 0.2 * Math.abs(Math.sin(y * 0.9 + Math.sin(x * 0.3) * 2)) + R() * 0.05); c.fillRect(x, y, 1, 1); }
  }).tex;
  const wood = psMat({ map: woodT });
  const add = (m: THREE.Mesh, x: number, y: number, z: number) => { m.position.set(x, y, z); root.add(m); return m; };
  add(box(2.0, 0.08, 0.95, wood), 0, 0.76, -3.35);
  for (const [x, z] of [[-0.92, -3.75], [0.92, -3.75], [-0.92, -2.95], [0.92, -2.95]] as [number, number][]) add(box(0.08, 0.72, 0.08, wood), x, 0.36, z);
  const beige = psMat({ map: noiseTex(P.beige, 5) });
  add(box(0.66, 0.54, 0.58, beige), 0, 1.07, -3.5);
  add(box(0.4, 0.34, 0.3, beige), 0, 1.07, -3.85);
  const scr = canvasTex(128, 96, (c) => { c.fillStyle = '#10162A'; c.fillRect(0, 0, 128, 96); });
  const scrMesh = add(new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.39), psMat({ map: scr.tex, unlit: true, fog: 0.4 })), 0, 1.08, -3.205);
  if (props) add(box(0.56, 0.05, 0.2, beige), 0, 0.82, -3.02);
  const lampM = psMat({ color: '#3A3F55' });
  add(box(0.05, 0.5, 0.05, lampM), 0.75, 1.05, -3.6);
  const shadeM = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.22, 6, 1, true), psMat({ color: P.title, emit: '#5A4010', side: THREE.DoubleSide }));
  add(shadeM, 0.75, 1.32, -3.6);
  const chairM = psMat({ color: '#3B3F5C' });
  const chair = new THREE.Group(); root.add(chair);
  for (const [m, x, y, z] of [[box(0.55, 0.08, 0.55, chairM), 0, 0.5, -2.35], [box(0.55, 0.62, 0.08, chairM), 0, 0.86, -2.08], [box(0.08, 0.46, 0.08, chairM), 0, 0.24, -2.35]] as [THREE.Mesh, number, number, number][]) { m.position.set(x, y, z); chair.add(m); }
  // a mug ("20 YRS"), the rubber duck, the 10:10 clock on the back wall
  const mugC = canvasTex(16, 8, (c) => { c.fillStyle = '#F3ECDF'; c.fillRect(0, 0, 16, 8); pixText(c, ';', 5, 0, P.ink); });
  if (props) add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.11, 6), psMat({ map: mugC.tex })), -0.6, 0.855, -3.15);
  const duck = makeDuck(); duck.position.set(0.45, 0.8, -3.1); duck.rotation.y = -0.5; root.add(duck);
  const clock = makeClock(0.3); clock.root.position.set(1.6, 2.5, -4.17); root.add(clock.root);
  return {
    root, duck, clock,
    screen: { tex: scr.tex, ctx: scr.ctx, mesh: scrMesh },
    screenPos: new THREE.Vector3(0, 1.08, -3.205), screenNormal: new THREE.Vector3(0, 0, 1),
    deskY: 0.8, seat: new THREE.Vector3(0, 0, -2.42), chair,
  };
}
