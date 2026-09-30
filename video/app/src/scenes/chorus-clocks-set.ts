// The clock shop set for `chorus-clocks`: the giant wall clock whose numerals the lyric replaces, the wall of
// small 10:10 clocks, the row of six word-clocks over DEV's hammock, the hourglass, the image generator's CRT
// and the hand it grows (six digits in chorus 1, five in the final chorus). Everything faces +z, floor y = 0.
import * as THREE from 'three';
import { psMat, canvasTex, pixText, textW, rng, shade } from '../ps1/gfx';
import { makeClock } from '../ps1/cast';
import { P } from '../ps1/palette';

const box = (w: number, h: number, d: number, m: THREE.Material | THREE.Material[]) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

/** A pixel-text decal texture: the word at `scale`, optional plate behind it. Returns the texture and its texel size. */
export function wordTex(text: string, fg: string, scale: number, plate?: string, pad = 3) {
  const w = textW(text, scale) + pad * 2 + scale, h = 7 * scale + pad * 2 + scale;
  const { tex } = canvasTex(w, h, (c) => {
    if (plate) {
      c.fillStyle = P.uiEdge; c.fillRect(1, 0, w - 2, h); c.fillRect(0, 1, w, h - 2);
      c.fillStyle = plate; c.fillRect(1, 1, w - 2, h - 2);
    }
    pixText(c, text, pad, pad, fg, scale, { shadow: plate ? P.uiEdge : undefined });
  });
  return { tex, w, h };
}

/** A flat decal quad (unlit), `texel` world units per texel, centred. */
export function decal(tex: THREE.Texture, w: number, h: number, texel: number, fog = 0.6) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w * texel, h * texel), psMat({ map: tex, unlit: true, fog }));
  return m;
}

// ---------------------------------------------------------------- the giant clock
export interface BigClock {
  root: THREE.Group; hour: THREE.Object3D; minute: THREE.Object3D; second: THREE.Object3D;
  /** The dim hour numerals, index 1..12 (index 0 unused). */
  numerals: THREE.Mesh[];
  R: number;
  /** Position of hour slot `h` on the face (local x, y). */
  slot(h: number, r?: number): [number, number];
}

export function makeBigClock(R = 2.4, rim: string = P.title): BigClock {
  const root = new THREE.Group();
  const faceC = canvasTex(128, 128, (c) => {
    const g = rng(41);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) { c.fillStyle = shade('#F3ECDF', 0.95 + g() * 0.06); c.fillRect(x, y, 1, 1); }
    c.fillStyle = P.ink;
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2, big = i % 5 === 0;
      for (let k = big ? 0 : 1; k < (big ? 6 : 3); k++) {
        const r = 60 - k;
        c.fillRect(Math.round(64 + Math.sin(a) * r), Math.round(64 - Math.cos(a) * r), big ? 2 : 1, big ? 2 : 1);
      }
    }
    c.fillStyle = '#D8CDB5';
    for (let r = 20; r < 24; r++) for (let i = 0; i < 90; i++) { const a = (i / 90) * Math.PI * 2; c.fillRect(Math.round(64 + Math.sin(a) * r), Math.round(64 - Math.cos(a) * r), 1, 1); }
  });
  const face = new THREE.Mesh(new THREE.CircleGeometry(R, 24), psMat({ map: faceC.tex }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R, R * 0.09, 4, 24), psMat({ color: rim }));
  const back = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.02, R * 1.02, 0.3, 24), psMat({ color: shade(rim, 0.55) }));
  back.rotation.x = Math.PI / 2; back.position.z = -0.16;
  root.add(back, face, ring);
  const slot = (h: number, r = R * 0.7): [number, number] => { const a = (h / 12) * Math.PI * 2; return [Math.sin(a) * r, Math.cos(a) * r]; };
  const numerals: THREE.Mesh[] = [new THREE.Mesh()];
  for (let h = 1; h <= 12; h++) {
    const t = wordTex(String(h), P.ink, 2, undefined, 1);
    const m = decal(t.tex, t.w, t.h, R * 0.022);
    const [x, y] = slot(h);
    m.position.set(x, y, 0.03);
    root.add(m); numerals.push(m);
  }
  const hand = (len: number, w: number, col: string, z: number) => {
    const piv = new THREE.Object3D(); piv.position.z = z;
    const m = box(w, len, 0.05, psMat({ color: col })); m.position.y = len / 2 - w * 0.8;
    const tip = box(w * 1.6, w * 1.6, 0.05, psMat({ color: col })); tip.position.y = len - w; tip.rotation.z = Math.PI / 4;
    piv.add(m, tip); root.add(piv); return piv;
  };
  const hour = hand(R * 0.5, R * 0.07, P.ink, 0.1), minute = hand(R * 0.78, R * 0.05, P.ink, 0.14), second = hand(R * 0.85, R * 0.018, P.fail, 0.18);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.06, R * 0.06, 0.1, 8), psMat({ color: rim }));
  hub.rotation.x = Math.PI / 2; hub.position.z = 0.2; root.add(hub);
  return { root, hour, minute, second, numerals, R, slot };
}

/** Rotation (about z, clockwise positive in the clock's view) for a hand showing `frac` of a turn. */
export const handAngle = (frac: number) => -frac * Math.PI * 2;

// ---------------------------------------------------------------- the wall
export function makeShopRoom() {
  const root = new THREE.Group();
  const R = rng(5);
  const wallT = canvasTex(64, 64, (c) => {
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const stripe = (x >> 3) & 1;
      c.fillStyle = shade(stripe ? '#4A5A3E' : '#42523A', 0.92 + R() * 0.1); c.fillRect(x, y, 1, 1);
    }
    c.fillStyle = '#C9A24A'; for (let y = 4; y < 64; y += 16) for (let x = 3; x < 64; x += 16) c.fillRect(x, y, 2, 2);
  }, true).tex;
  const wallG = new THREE.PlaneGeometry(20, 7, 4, 2);
  const uv = wallG.attributes.uv!; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 10, uv.getY(i) * 3.5);
  const wall = new THREE.Mesh(wallG, psMat({ map: wallT })); wall.position.set(0, 3.5, -4.3); root.add(wall);
  const side = (x: number, ry: number) => { const w = new THREE.Mesh(wallG, psMat({ map: wallT })); w.position.set(x, 3.5, 3); w.rotation.y = ry; root.add(w); };
  side(-9.5, Math.PI / 2); side(9.5, -Math.PI / 2);
  const floorT = canvasTex(32, 32, (c) => {
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { c.fillStyle = shade(((x >> 3) + (y >> 4)) & 1 ? '#5C3B26' : '#6B472F', 0.9 + R() * 0.12); c.fillRect(x, y, 1, 1); }
    c.fillStyle = '#3B2618'; for (let y = 0; y < 32; y += 16) c.fillRect(0, y, 32, 1);
  }, true).tex;
  const floorG = new THREE.PlaneGeometry(20, 16, 4, 4);
  const fuv = floorG.attributes.uv!; for (let i = 0; i < fuv.count; i++) fuv.setXY(i, fuv.getX(i) * 10, fuv.getY(i) * 8);
  const floor = new THREE.Mesh(floorG, psMat({ map: floorT })); floor.rotation.x = -Math.PI / 2; floor.position.z = 2; root.add(floor);
  // skirting and a picture rail
  const trim = psMat({ color: '#2E1E14' });
  const sk = box(20, 0.3, 0.1, trim); sk.position.set(0, 0.15, -4.25); root.add(sk);
  const rail = box(20, 0.08, 0.08, trim); rail.position.set(0, 6.4, -4.25); root.add(rail);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(20, 16), psMat({ color: '#2A2418' }));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 7, 2); root.add(ceil);
  for (let i = 0; i < 4; i++) { const beam = box(20, 0.25, 0.3, trim); beam.position.set(0, 6.85, -3 + i * 3); root.add(beam); }
  return root;
}

export interface WallClock { root: THREE.Group; hour: THREE.Object3D; minute: THREE.Object3D; second: THREE.Object3D; r: number; x: number; y: number; seed: number }

/** Dozens of small clocks on the wall, all at 10:10, avoiding the rectangles in `keepOut` ([x0, y0, x1, y1]). */
export function makeClockWall(keepOut: [number, number, number, number][]) {
  const R = rng(17);
  const rims = [P.title, '#B8B8C8', '#7A5230', P.fail, '#8CD3FF', '#C9BFA3', '#3F7A5A'];
  const out: WallClock[] = [];
  const root = new THREE.Group();
  for (let gy = 0; gy < 6; gy++) for (let gx = 0; gx < 18; gx++) {
    const x = -8.6 + gx * 1.0 + (gy % 2) * 0.5 + (R() - 0.5) * 0.3, y = 0.9 + gy * 0.95 + (R() - 0.5) * 0.25;
    const r = 0.22 + R() * 0.2;
    if (keepOut.some(([a, b, c, d]) => x + r > a && x - r < c && y + r > b && y - r < d)) continue;
    if (R() < 0.18) continue;
    const ck = makeClock(r, rims[Math.floor(R() * rims.length)]!);
    ck.root.position.set(x, y, -4.2);
    ck.root.rotation.z = (R() - 0.5) * 0.1;
    root.add(ck.root);
    out.push({ ...ck, r, x, y, seed: out.length });
  }
  return { root, clocks: out };
}

// ---------------------------------------------------------------- the hammock, DEV's hourglass
/** A sagging hammock between two posts at x0..x1 (height y, depth z): a net texture on a strip. */
export function makeHammock(x0: number, x1: number, y: number, z: number, sag = 0.8) {
  const root = new THREE.Group();
  const netT = canvasTex(16, 16, (c) => {
    c.fillStyle = '#E3D2A6';
    for (let i = 0; i < 16; i += 4) { c.fillRect(i, 0, 1, 16); c.fillRect(0, i, 16, 1); }
    c.fillStyle = '#B09A6A'; for (let i = 0; i < 16; i += 4) c.fillRect(i, i, 1, 1);
  }, true).tex;
  const N = 12, W = 0.9;
  const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N, x = x0 + (x1 - x0) * u, yy = y - sag * 4 * u * (1 - u);
    for (const s of [-1, 1]) {
      const curl = (1 - 4 * u * (1 - u)) * 0.15 + 0.12;
      pos.push(x, yy + curl * (s * s), z + s * W * 0.5 * (0.35 + 0.65 * 4 * u * (1 - u)));
      uvs.push(u * 8, (s + 1) * 1.5);
    }
  }
  for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const net = new THREE.Mesh(g, psMat({ map: netT, side: THREE.DoubleSide }));
  root.add(net);
  const ropeM = psMat({ color: '#B09A6A' });
  for (const x of [x0, x1]) { const r = box(0.04, 0.04, 0.04, ropeM); r.position.set(x, y + 0.2, z); root.add(r); }
  return root;
}

/** A grandfather clock (tall case, a 10:10 face on top), ~2.6 tall. */
export function makeGrandfather(rim = '#C9A24A') {
  const root = new THREE.Group();
  const wood = psMat({ color: '#5A3620' }), dark = psMat({ color: '#3A2214' });
  const base = box(0.8, 0.5, 0.55, dark); base.position.y = 0.25;
  const body = box(0.62, 1.5, 0.45, wood); body.position.y = 1.25;
  const head = box(0.85, 0.85, 0.5, wood); head.position.y = 2.42;
  const cap = box(0.95, 0.12, 0.58, dark); cap.position.y = 2.9;
  const win = box(0.36, 0.9, 0.02, psMat({ color: '#1B2A55', unlit: true })); win.position.set(0, 1.25, 0.235);
  const pend = box(0.14, 0.14, 0.02, psMat({ color: rim, unlit: true })); pend.position.set(0, 0.95, 0.25);
  root.add(base, body, head, cap, win, pend);
  const ck = makeClock(0.34, rim); ck.root.position.set(0, 2.42, 0.26); root.add(ck.root);
  return { root, pendulum: pend, clock: ck };
}

/** An hourglass (~0.34 tall) whose top bulb never empties (the chatbot's 10:10 hourglass). */
export function makeHourglass() {
  const root = new THREE.Group();
  const frame = psMat({ color: '#7A5230' }), glassM = psMat({ color: '#BFE3F0', opacity: 0.55, side: THREE.DoubleSide });
  const sand = psMat({ color: '#F2C65A' });
  for (const y of [0, 0.34]) { const p = box(0.24, 0.03, 0.24, frame); p.position.y = y; root.add(p); }
  for (const [x, z] of [[-0.1, -0.1], [0.1, -0.1], [-0.1, 0.1], [0.1, 0.1]] as const) { const p = box(0.02, 0.34, 0.02, frame); p.position.set(x, 0.17, z); root.add(p); }
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.15, 6), glassM); top.position.y = 0.245; top.rotation.x = Math.PI; root.add(top);
  const bot = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.15, 6), glassM); bot.position.y = 0.095; root.add(bot);
  const topSand = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.11, 6), sand); topSand.position.y = 0.26; topSand.rotation.x = Math.PI; root.add(topSand);
  const pile = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.06, 6), sand); pile.position.y = 0.05; root.add(pile);
  const stream = box(0.012, 0.13, 0.012, psMat({ color: '#F2C65A', unlit: true })); stream.position.y = 0.12; root.add(stream);
  return { root, topSand, pile, stream };
}

// ---------------------------------------------------------------- the image generator's CRT and its hand
/** A beige CRT (1.3 wide) on its own, with a 128x96 screen canvas facing +z. */
export function makeGenCrt(title: string, prompt: string, badgeCol: string = P.key2) {
  const root = new THREE.Group();
  const R = rng(9);
  const beigeT = canvasTex(16, 16, (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { c.fillStyle = shade(P.beige, 0.93 + R() * 0.1); c.fillRect(x, y, 1, 1); } }).tex;
  const beige = psMat({ map: beigeT });
  const body = box(1.3, 1.0, 1.0, beige); body.position.y = 0.5;
  const back = box(0.8, 0.7, 0.5, beige); back.position.set(0, 0.5, -0.7);
  const stand = box(0.6, 0.08, 0.5, psMat({ color: P.beigeDark })); stand.position.y = -0.04;
  const scr = canvasTex(128, 96, (c) => {
    c.fillStyle = '#10162A'; c.fillRect(0, 0, 128, 96);
    c.fillStyle = P.uiNavy; c.fillRect(0, 0, 128, 11);
    pixText(c, title, 3, 2, badgeCol);
    c.fillStyle = '#1B2A55'; c.fillRect(4, 16, 120, 12);
    pixText(c, prompt, 7, 19, P.uiLine);
    c.fillStyle = '#26345E'; c.fillRect(4, 84, 120, 6);
    c.fillStyle = P.fix; c.fillRect(5, 85, 118, 4);
    pixText(c, '100%', 50, 74, P.uiDim);
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.06, 0.8), psMat({ map: scr.tex, unlit: true, fog: 0.4 }));
  screen.position.set(0, 0.52, 0.505);
  root.add(body, back, stand, screen);
  return { root, screen };
}

export interface Hand {
  root: THREE.Group;
  wrist: THREE.Object3D;
  palm: THREE.Mesh;
  /** Digit pivots in reading order (left to right as seen from the front); each has `.userData.mid` (second joint) and `.userData.tip`. */
  digits: THREE.Object3D[];
}

/** A big low-poly hand (palm ~1 wide) on a forearm, palm facing +z, fingers up. `fingers` excludes the thumb. */
export function makeHand(fingers: number, skin = '#E6B394') {
  const root = new THREE.Group();
  const sk = psMat({ color: skin }), sk2 = psMat({ color: shade(skin, 0.86) }), nail = psMat({ color: '#F6DCCB' });
  const wrist = new THREE.Object3D(); root.add(wrist);
  const arm = box(0.42, 1.9, 0.38, sk2); arm.position.y = -0.95; wrist.add(arm);
  const cuff = box(0.5, 0.18, 0.46, psMat({ color: '#2E4A8C' })); cuff.position.y = -0.4; wrist.add(cuff);
  const PW = 1.0, PH = 0.95;
  const palm = box(PW, PH, 0.28, sk); palm.position.y = PH / 2; wrist.add(palm);
  const digits: THREE.Object3D[] = [];
  const finger = (x: number, y: number, w: number, l1: number, l2: number, rz = 0) => {
    const piv = new THREE.Object3D(); piv.position.set(x, y, 0); piv.rotation.z = rz;
    const a = box(w, l1, w * 1.05, sk); a.position.y = l1 / 2; piv.add(a);
    const mid = new THREE.Object3D(); mid.position.y = l1; piv.add(mid);
    const b = box(w * 0.92, l2, w * 0.98, sk); b.position.y = l2 / 2; mid.add(b);
    const n = box(w * 0.6, w * 0.4, 0.02, nail); n.position.set(0, l2 - w * 0.3, -w * 0.5); mid.add(n);
    const tip = new THREE.Object3D(); tip.position.y = l2 + 0.05; mid.add(tip);
    piv.userData.mid = mid; piv.userData.tip = tip;
    wrist.add(piv);
    return piv;
  };
  // the thumb on the left, then the fingers across the top of the palm
  const thumb = finger(-PW / 2 - 0.02, 0.28, 0.2, 0.36, 0.3, 1.05);
  digits.push(thumb);
  const fw = (PW - 0.04) / fingers;
  for (let i = 0; i < fingers; i++) {
    const x = -PW / 2 + 0.02 + fw * (i + 0.5);
    const long = 1 - Math.abs(i - (fingers - 1) * 0.55) / fingers;
    digits.push(finger(x, PH, fw * 0.82, 0.34 + 0.12 * long, 0.28 + 0.1 * long, (i - (fingers - 1) / 2) * -0.24));
  }
  return { root, wrist, palm, digits } as Hand;
}

/** A cardboard box (open top) for the hand to close on. */
export function makeCardboardBox(w = 1.1, h = 0.8, d = 0.8) {
  const root = new THREE.Group();
  const R = rng(23);
  const t = canvasTex(32, 32, (c) => {
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { c.fillStyle = shade('#B8864E', 0.9 + R() * 0.1 + ((y >> 2) & 1) * 0.03); c.fillRect(x, y, 1, 1); }
    c.fillStyle = '#8A5E32'; c.fillRect(0, 14, 32, 3);
  }).tex;
  const m = psMat({ map: t });
  const inner = psMat({ color: '#6E4A26', side: THREE.DoubleSide });
  const bottom = box(w, 0.04, d, m); bottom.position.y = 0.02; root.add(bottom);
  for (const [x, z, ww, dd] of [[0, d / 2, w, 0.04], [0, -d / 2, w, 0.04], [w / 2, 0, 0.04, d], [-w / 2, 0, 0.04, d]] as const) {
    const s = box(ww, h, dd, [m, m, inner, inner, m, m]); s.position.set(x, h / 2, z); root.add(s);
  }
  return root;
}
