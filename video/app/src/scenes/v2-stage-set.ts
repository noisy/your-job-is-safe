// Verse 2, the set shared by `v2-stage` and the first bar of `v2-grok`: the chatbot's corner of the
// stage (its CRT head on a podium, a painted city-night window flat behind it with the mushroom cloud
// that rises there on "blast!"), the RPG choice menu, and the camera over that corner. Both scenes build
// it at the same coordinates with the same camera, so the cut at "picked" is a continuous shot.
import * as THREE from 'three';
import type { Word } from '../engine/lyrics';
import type { AudioData } from '../engine/audio';
import { clamp, lerp, ease, prog, hash, noise1 } from '../engine/util';
import { type Ps1Stage, type CamState, type V3, uiBox } from '../ps1/stage';
import { makeBotHead, type BotHead } from '../ps1/cast';
import { psMat, canvasTex, pixText, textW, rng, shade, glyphRows } from '../ps1/gfx';
import { P } from '../ps1/palette';

const box = (w: number, h: number, d: number, m: THREE.Material | THREE.Material[]) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

/** Where the chatbot stands (stage right) and where its window flat hangs behind it. */
export const BOT_AT: V3 = [2.4, 0, -1.6];
const WIN_AT: V3 = [4.3, 2.05, -4.9];

/** The stage itself (plank floor, apron, pit, footlights, back wall, proscenium), shared by both scenes. */
export function buildStageShell(stage: Ps1Stage) {
  const R = rng(33);
  const w = stage.world;
  const planks = canvasTex(64, 64, (c) => {
    for (let y = 0; y < 64; y++) { const p = y >> 3; for (let x = 0; x < 64; x++) { c.fillStyle = shade(['#6B4A2E', '#5C3F27', '#744F31', '#63452B'][p % 4]!, 0.9 + R() * 0.14); c.fillRect(x, y, 1, 1); } }
    c.fillStyle = '#2E2016'; for (let y = 0; y < 64; y += 8) c.fillRect(0, y, 64, 1);
  }, true).tex;
  const fg = new THREE.PlaneGeometry(12, 8, 6, 4);
  const uv = fg.attributes.uv!; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6, uv.getY(i) * 4);
  const floor = new THREE.Mesh(fg, psMat({ map: planks })); floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, -3); w.add(floor);
  // the apron edge and the dark pit in front of it
  const apron = box(12, 0.5, 0.3, psMat({ color: '#2A1A14' })); apron.position.set(0, -0.25, 1.05); w.add(apron);
  const pit = new THREE.Mesh(new THREE.PlaneGeometry(30, 12), psMat({ color: '#0A0C16' })); pit.rotation.x = -Math.PI / 2; pit.position.set(0, -0.5, 7); w.add(pit);
  // footlights along the apron
  const bulbM = psMat({ color: '#FFE9A0', unlit: true, fog: 0.2 });
  for (let i = 0; i < 17; i++) { const b = box(0.12, 0.08, 0.08, bulbM); b.position.set(-4.8 + i * 0.6, 0.04, 0.95); w.add(b); }
  // back wall and wings
  const wallM = psMat({ color: '#3E2A3E' });
  const back = box(12, 7, 0.2, wallM); back.position.set(0, 3.5, -7); w.add(back);
  // proscenium: pillars and the header the marquee hangs on
  const gold = psMat({ color: '#B98E35' }), red = psMat({ color: '#6E1822' });
  for (const x of [-5.2, 5.2]) { const p = box(0.9, 5.6, 0.7, red); p.position.set(x, 2.8, 0.2); w.add(p); const g = box(1.0, 0.2, 0.8, gold); g.position.set(x, 5.6, 0.2); w.add(g); }
  const header = box(11.3, 1.9, 0.5, red); header.position.set(0, 5.0, -0.05); w.add(header);
  const trim = box(11.3, 0.12, 0.6, gold); trim.position.set(0, 4.0, -0.05); w.add(trim);
}

/** The kicks the menu camera steps in on (from the second one after line 2 starts). */
export function menuKicks(au: AudioData, l2Start: number) {
  return au.events('kick', l2Start + 0.35, l2Start + 4).map((k) => k[0]);
}

export interface ChatCorner {
  bot: BotHead;
  /** Animate the mushroom cloud rising behind the window flat from `t0` (a pure function of t). */
  cloud(t: number, t0: number): void;
  /** 0..1 white glow of the window flat (the blast's light). */
  glow(k: number): void;
}

export function buildChatCorner(stage: Ps1Stage): ChatCorner {
  const R = rng(91);
  const w = stage.world;
  // podium: a little lectern in stage red and gold
  const red = psMat({ color: '#8E1F2A' }), gold = psMat({ color: '#C9A13A' });
  const pod = box(0.9, 0.95, 0.7, red); pod.position.set(BOT_AT[0], 0.475, BOT_AT[2]); w.add(pod);
  const podTop = box(1.0, 0.06, 0.8, gold); podTop.position.set(BOT_AT[0], 0.98, BOT_AT[2]); w.add(podTop);
  const bot = makeBotHead('v2.0');
  bot.root.position.set(BOT_AT[0], 1.01, BOT_AT[2]);
  bot.root.scale.setScalar(1.25);
  bot.root.rotation.y = -0.55;
  w.add(bot.root);
  // the window flat: a painted night skyline in a wooden frame, a stage-set window
  const skyC = canvasTex(64, 48, (c) => {
    for (let y = 0; y < 48; y++) { c.fillStyle = shade('#1B2A55', 0.7 + (y / 48) * 0.5); c.fillRect(0, y, 64, 1); }
    for (let i = 0; i < 18; i++) { c.fillStyle = R() > 0.5 ? '#E8E4D8' : '#8C93B8'; c.fillRect(Math.floor(R() * 62) + 1, Math.floor(R() * 20) + 1, 1, 1); }
    let x = 0;
    while (x < 64) {
      const bw = 5 + Math.floor(R() * 8), bh = 10 + Math.floor(R() * 20);
      c.fillStyle = shade('#0C1224', 0.9 + R() * 0.3); c.fillRect(x, 48 - bh, bw, bh);
      for (let yy = 48 - bh + 2; yy < 46; yy += 3) for (let xx = x + 1; xx < x + bw - 1; xx += 2) if (R() > 0.55) { c.fillStyle = '#F4E3A3'; c.fillRect(xx, yy, 1, 1); }
      x += bw + 1;
    }
  });
  const flat = new THREE.Group();
  flat.position.set(...WIN_AT);
  flat.lookAt(0.6, 1.4, 1.2);
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.9), psMat({ map: skyC.tex, unlit: true, fog: 0.3 }));
  sky.position.z = -0.9;
  const wood = psMat({ color: '#5E4230' });
  const frameBits: [number, number, number, number][] = [[0, 0.98, 2.4, 0.12], [0, -0.98, 2.4, 0.12], [-1.14, 0, 0.12, 2.0], [1.14, 0, 0.12, 2.0], [0, 0, 2.3, 0.07], [0, 0, 0.07, 2.0]];
  for (const [x, y, fw, fh] of frameBits) { const b = box(fw, fh, 0.1, wood); b.position.set(x, y, 0); flat.add(b); }
  const wall = psMat({ color: '#3A2A3E' });
  for (const [x, y, fw, fh] of [[0, 1.75, 5, 1.4], [0, -1.75, 5, 1.4], [-2.1, 0, 1.8, 2.2], [2.1, 0, 1.8, 2.2]] as [number, number, number, number][]) { const b = box(fw, fh, 0.05, wall); b.position.set(x, y, -0.06); flat.add(b); }
  // the blast's glow: an additive plane over the painted sky
  const glowM = psMat({ color: '#FFF4D8', unlit: true, additive: true, opacity: 0.999, fog: 0 });
  const glowP = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.9), glowM); glowP.position.z = -0.5; glowP.visible = false;
  flat.add(sky, glowP);
  // the mushroom cloud: a stem of stacked puffs and a rolling cap, rising behind the window
  const cloudG = new THREE.Group();
  cloudG.position.z = -0.7;
  cloudG.scale.setScalar(1.35);
  const hot = psMat({ color: '#FFB347', unlit: true, fog: 0 }), mid = psMat({ color: '#E8743B', unlit: true, fog: 0 }), pale = psMat({ color: '#F3E3C0', unlit: true, fog: 0 });
  const puffs: { m: THREE.Mesh; k: number; a: number; r: number; cap: boolean }[] = [];
  for (let i = 0; i < 7; i++) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), i % 2 ? mid : hot); cloudG.add(m); puffs.push({ m, k: i / 6, a: 0, r: 0, cap: false }); }
  for (let i = 0; i < 12; i++) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 0), i % 3 ? pale : hot); cloudG.add(m); puffs.push({ m, k: 1, a: (i / 12) * Math.PI * 2, r: 1, cap: true }); }
  flat.add(cloudG);
  cloudG.visible = false;
  w.add(flat);
  return {
    bot,
    cloud(t, t0) {
      const u = t - t0;
      cloudG.visible = u >= 0;
      if (!cloudG.visible) return;
      const rise = ease.outCubic(clamp(u / 0.55));
      const H = -0.95 + 1.55 * rise, capR = 0.2 + 0.55 * ease.outCubic(clamp(u / 0.7));
      for (const p of puffs) {
        if (!p.cap) {
          p.m.position.set(noise1(p.k * 7 + u * 3, 3) * 0.05, lerp(-0.95, H, p.k), 0);
          p.m.scale.setScalar(0.7 + 0.5 * p.k + 0.3 * rise);
        } else {
          const roll = u * 2.2;
          p.m.position.set(Math.cos(p.a + roll * 0.3) * capR, H + 0.12 * Math.sin(p.a * 2 + roll), Math.sin(p.a) * 0.1);
          p.m.scale.setScalar(0.6 + 0.9 * rise + 0.15 * hash(p.a * 10, 2));
        }
        p.m.rotation.set(u * 2 + p.a, u * 1.3, 0);
      }
    },
    glow(k) {
      glowP.visible = k > 0.01;
      (glowM.uniforms.uColor!.value as THREE.Color).setRGB(k, k * 0.95, k * 0.85);
    },
  };
}

/** The camera on the chatbot's corner for the choice menu: a stepped push-in per kick from `a`. */
export function menuCam(t: number, a: number, kicks: number[]): CamState {
  let k = 0;
  for (const kt of kicks) if (t >= kt) k += ease.outExpo(clamp((t - kt) / 0.1));
  const d = 1 - Math.min(k, 5) * 0.06;
  // (the bot sits in the right third, the window flat behind it; the menu hangs on the left)
  const P0: V3 = [0.2, 1.55, 1.9], T0: V3 = [BOT_AT[0] - 1.7, 1.5, BOT_AT[2] + 0.1];
  const s = prog(t, a, a + 2.5, ease.linear);
  const P: V3 = [lerp(T0[0], P0[0], d) - 0.25 * s, lerp(T0[1], P0[1], d), lerp(T0[2], P0[2], d)];
  return { P, T: [T0[0] + 0.2 * s, T0[1] + 0.05 * s, T0[2]], roll: -0.04 + 0.03 * s, fov: 50 };
}

export const MENU_W = 304, MENU_H = 130;

/**
 * The RPG choice menu. Title row "Asked", options "misgender," / "or" / "the apocalypse?", a footer row
 * typing "it picked the blast!". Each word appears at its start; `cursor` is 0 (option 1), 1 (option 2)
 * or -1 (hidden); `picked` inverts option 2 (the selection). Returns the key for Panel.commit.
 */
export function drawMenu(c: CanvasRenderingContext2D | null, words: Word[], t: number, cursor: number, picked: number) {
  // words: Asked, misgender, or, the, apocalypse, it, picked, the, blast
  const vis = (w: Word | undefined) => !!w && t >= w.start;
  const n = (w: Word | undefined) => {
    if (!w || t < w.start) return 0;
    const len = Array.from(clean(w.w)).length;
    return Math.min(len, Math.floor(((t - w.start) / Math.max(0.04, Math.min(0.2, (w.end - w.start) * 0.8))) * len) + 1);
  };
  const blink = Math.floor(t * 6) % 2;
  const pk = picked > 0 ? (Math.floor(t * 14) % 2) : 0;
  const key = `${words.map(n).join(',')}|${cursor}|${blink}|${picked > 0 ? 1 : 0}${pk}`;
  if (!c) return key;
  uiBox(c, 0, 10, MENU_W, MENU_H - 10);
  // the tab: who is choosing (the chatbot, v2.0)
  const tab = 'CHATBOT v2.0 CHOOSES';
  const tabW = textW(tab) + 8;
  c.fillStyle = P.uiEdge; c.fillRect(7, 3, tabW + 2, 12);
  c.fillStyle = P.uiNavy; c.fillRect(8, 4, tabW, 10);
  pixText(c, tab, 12, 6, P.key2);
  const put = (w: Word | undefined, x: number, y: number, col: string, scale = 2) => {
    if (!w) return x;
    const s = clean(w.w).slice(0, n(w));
    if (s) pixText(c, s, x, y, col, scale, { shadow: P.uiEdge });
    return x + (Array.from(clean(w.w)).length + 1) * 6 * scale;
  };
  const [wAsked, wMis, wOr, wThe, wApo, wIt, wPicked, wThe2, wBlast] = words;
  put(wAsked, 12, 19, P.uiDim);
  // the two options at 3x, the cursor between them
  const o1y = 36, o2y = 74;
  if (vis(wMis)) put(wMis, 30, o1y, P.uiLine, 3);
  if (vis(wOr)) put(wOr, 56, 59, P.uiDim);
  if (picked > 0) {
    c.fillStyle = pk ? P.fail : '#B8323F';
    c.fillRect(26, o2y - 3, 18 * 15 + 2, 27);
  }
  let x = 30;
  x = put(wThe, x, o2y, P.uiLine, 3);
  put(wApo, x, o2y, picked > 0 ? P.uiLine : P.key2, 3);
  if (cursor >= 0 && (blink || picked > 0)) pixText(c, '▶', 8, cursor === 0 ? o1y : o2y, P.key2, 3, { shadow: P.uiEdge });
  // footer: it picked the blast!
  let fx = 12;
  const fy = MENU_H - 20;
  fx = put(wIt, fx, fy, P.uiLine);
  fx = put(wPicked, fx, fy, P.uiLine);
  fx = put(wThe2, fx, fy, P.uiLine);
  put(wBlast, fx, fy, P.fail);
  return key;
}
const clean = (s: string) => s.replace(/[“”"]/g, '');

/**
 * A plain-text caption sign (the facts behind a gag: who, when), several lines of 1x bitmap text on a
 * navy plate, billboarded to face the camera. `texel` = world units per texel.
 */
export function caption(stage: Ps1Stage, lines: string[], texel = 1 / 36, fg: string = P.uiLine) {
  const w = Math.max(...lines.map((l) => textW(l))) + 8, h = lines.length * 10 + 5;
  const { tex } = canvasTex(w, h, (c) => {
    c.fillStyle = P.uiEdge; c.fillRect(1, 0, w - 2, h); c.fillRect(0, 1, w, h - 2);
    c.fillStyle = '#16204A'; c.fillRect(1, 1, w - 2, h - 2);
    lines.forEach((l, i) => pixText(c, l, 4, 3 + i * 10, i === 0 ? P.key2 : fg, 1, { shadow: P.uiEdge }));
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w * texel, h * texel), psMat({ map: tex, unlit: true, fog: 0.2, side: THREE.DoubleSide }));
  m.renderOrder = 5;
  stage.world.add(m);
  stage.billboards.push(m);
  return m;
}

/** The kit's 5x7 bitmap font as a bit grid (7 rows x 5 columns), for bulb and LED dot-matrix signs. */
export const glyphBits = (ch: string): boolean[][] =>
  glyphRows(ch).slice(0, 7).map((bits) => [16, 8, 4, 2, 1].map((b) => (bits & b) !== 0));
