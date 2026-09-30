// Phase-1 style "clay": claymation, raymarched. A plasticine studio set (table, backdrop sweep) marched
// at half resolution: fingerprinted clay, warm key / cool fill, soft contact shadows, slight DOF. The
// set moves in stop-motion (time quantised to 12 fps, "on twos", with a seeded boil per step), the
// camera included. Lyric words are rolled clay that squash down onto the set.
import * as THREE from 'three';
import { Scene, type Frame } from '../engine/scene';
import { FSPass, makeRT, SS_TAP, W, H } from '../engine/gl';
import { F } from '../engine/type';
import type { Line, Word } from '../engine/lyrics';
import { clamp, ease, frameIdx, hash, keys, lerp, pulse, springStep } from '../engine/util';
import type { StyleNote } from '../styles/registry';
import { ClayAtlas, SPREAD, type AtlasReq } from './style-clay-atlas';
import { claySetFrag, CLAY_DOF_FRAG, MAX_WORDS } from './style-clay-sdf';

export const TITLE = 'Claymation, raymarched';
export const NOTE: StyleNote = {
  technique:
    'A raymarched SDF plasticine set (table, backdrop sweep, props, extruded letters from a distance-field text atlas) at half resolution with a depth-of-field upscale: fingerprint whorls and tool marks on the normals, wrap lighting, soft shadows, AO, a resin glass with fake refraction. Everything moves in stop-motion, the camera included: time is quantised to 12 fps on twos (aligned to output frames) with a per-step boil: the plasticine lumps re-form, lights and puppets jitter.',
  palette:
    'Studio plasticine: dusty teal-grey sweep, warm brown clay table, cream letters and bubbles, charcoal type, strawberry red, leaf green, mustard chips, near-black wine red; a warm key and a cool fill.',
  typography:
    'Rolled clay words in Bricolage Grotesque ExtraBold (the narrator), raised JetBrains Mono Bold on the chat slabs (the chatbot), a big red Bricolage STRAWBERRY.',
  lyrics:
    'Each word is a rolled clay word that drops onto the table at its start, squashes, overshoots and settles (stop-motion steps); held notes pull the word sideways like taffy and let it snap back; finished lines squash flat and vanish.',
  cost: 'perf mode (1 sub-frame, incl. post + readback; the smoke scene alone is 8.9 ms): 17.7 ms avg, p95 23 ms. Puppets and camera step at 12 fps, so a frame’s sub-frames only differ by their AA tap and the adaptive sampler stops at ~12: the full song is about 45 min.',
  risks:
    'Raymarching is the costliest style here; small type on the slabs softens at half resolution; 12 fps stepping of the camera can feel choppy on long moves; too much boil reads as noise.',
};

const STEP_FRAMES = 5; // 60 fps / 12 fps: animation on twos at 24
interface Times {
  start: number; end: number; d1: number; dR: number; d3: number; dG: number; d5: number;
  kicks: number[]; counts: number[]; snareC: number; snareD: number;
  L0: Line; L1: Line; L2: Line; L3: Line;
}
interface Row { x: number; z: number; maxW: number; wpp: number; flat: boolean; step: number }
interface Slot { x: number; y: number; z: number; wpp: number; rect: [number, number, number, number]; sx: number; sy: number; base: number; flat: boolean; tint: number; depth: number }

const WORD_PX = 96;

export default class ClayScene extends Scene {
  private T!: Times;
  private atlas!: ClayAtlas;
  private rt = makeRT(W / 2, H / 2, { depthBuffer: false });
  private set!: FSPass;
  private dof = new FSPass(CLAY_DOF_FRAG, { src: { value: null }, texel: { value: new THREE.Vector2() }, focus: { value: 5 }, aperture: { value: 1.2 } });
  private cam = new THREE.PerspectiveCamera(34, 16 / 9, 0.05, 50);

  override init() {
    const { lyrics: ly, audio: au } = this.ctx;
    const start = this.ctx.start, end = this.ctx.end;
    const L0 = ly.get('Watch it try'), L1 = ly.get("It can't count the R", 0), L2 = ly.get("It can't fill a glass of wine", 0), L3 = ly.get('Every clock says', 0);
    const db = au.downbeats;
    const near = (x: number) => db.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
    const after = (x: number) => db.find((d) => d > x + 0.05) ?? x + 1.39;
    const before = (x: number) => [...db].reverse().find((d) => d < x - 0.05) ?? x - 1.39;
    const dR = near(L1.words[4]!.start), dG = near(L2.words[4]!.start);
    const d1 = before(dR), d3 = after(dR), d5 = after(dG);
    const kicks = au.events('kick', d1 + 0.1, dR - 0.05).map((e) => e[0]).slice(-3);
    const bR = Math.round(au.beatAt(dR));
    const counts = [1, 2, 3].map((i) => au.timeOfBeat(bR + i));
    const snareC = au.events('snare', d3 + 0.05, dG)[0]?.[0] ?? d3 + 0.35;
    const snareD = au.events('snare', dG + 0.7, d5)[0]?.[0] ?? dG + 1.05;
    this.T = { start, end, d1, dR, d3, dG, d5, kicks, counts, snareC, snareD, L0, L1, L2, L3 };

    const disp = F.display(100, 800), mono = F.mono(700);
    const reqs: AtlasReq[] = [];
    for (const l of [L0, L1, L2, L3]) for (const w of l.words) reqs.push({ key: `w${w.gi}`, text: w.w, family: disp, size: WORD_PX });
    reqs.push(
      { key: 'hero', text: 'STRAWBERRY', family: disp, size: 170 },
      { key: 'q1', text: 'how many r\'s in', family: mono, size: 64 },
      { key: 'q2', text: '"strawberry"?', family: mono, size: 64 },
      { key: 'chatbot', text: 'chatbot', family: mono, size: 56 },
      { key: 'replyA', text: 'There are', family: mono, size: 64 },
      { key: 'replyB', text: 'R\'s in "strawberry".', family: mono, size: 64 },
      { key: 'tok', text: 'tokens: [straw] [berry]', family: mono, size: 64 },
      { key: 'prompt', text: 'a wine glass filled to the brim', family: mono, size: 64 },
      { key: 'claim1', text: 'Here\'s a wine glass', family: mono, size: 64 },
      { key: 'claim2', text: 'filled to the brim!', family: mono, size: 64 },
      { key: 'brim', text: 'BRIM', family: F.mono(800), size: 64 },
      { key: 'n1', text: '1', family: disp, size: 96 }, { key: 'n2', text: '2', family: disp, size: 96 }, { key: 'n3', text: '3', family: disp, size: 96 },
    );
    this.atlas = new ClayAtlas(reqs);
    const frag = claySetFrag(this.atlas);
    const v = (n = 4) => ({ value: new THREE.Vector4(0, 0, 0, n === 4 ? 0 : 0) });
    this.set = new FSPass(frag, {
      atlas: { value: this.atlas.tex }, ssTap: SS_TAP, rtRes: { value: new THREE.Vector2(this.rt.width, this.rt.height) },
      camPos: { value: new THREE.Vector3() }, camRot: { value: new THREE.Matrix3() }, tanF: { value: Math.tan((17 * Math.PI) / 180) },
      shot: { value: 0 }, boil: { value: 0 }, keyDir: { value: new THREE.Vector3(-0.55, 0.75, 0.45).normalize() },
      wA: { value: Array.from({ length: MAX_WORDS }, () => new THREE.Vector4()) },
      wB: { value: Array.from({ length: MAX_WORDS }, () => new THREE.Vector4()) },
      wC: { value: Array.from({ length: MAX_WORDS }, () => new THREE.Vector4()) },
      wD: { value: Array.from({ length: MAX_WORDS }, () => new THREE.Vector4()) },
      uBub: v(), uBot: v(), qReveal: { value: new THREE.Vector2() }, dots: { value: new THREE.Vector3() },
      uHero: v(), heroB: { value: new Array(10).fill(0) }, uFruit: v(), fruitRot: { value: 0 },
      uChip: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
      uReply: v(), replyRev: { value: new THREE.Vector4() }, uRing: v(), uCutter: v(), uPrompt: v(), promptReveal: { value: 0 },
      uGlass: v(), wineLvl: { value: 0 }, uClaim: v(), claimReveal: { value: new THREE.Vector2() }, uTag: v(), uHands: v(),
    });
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const { renderer } = this.ctx;
    const t = f.t, T = this.T, u = this.set.u;
    // stop-motion: puppets live on 12 fps steps aligned to output frames; the camera is continuous
    const step = Math.floor(frameIdx(t) / STEP_FRAMES);
    const ts = (step * STEP_FRAMES) / 60;
    u.boil!.value = step % 97;
    const kj = (k: number) => (hash(step, k) - 0.5) * 0.02;
    (u.keyDir!.value as THREE.Vector3).set(-0.55 + kj(1), 0.75 + kj(2), 0.45 + kj(3)).normalize();

    const shot = t < T.dR ? 0 : t < T.dG ? 1 : 2;
    u.shot!.value = shot;
    // the camera is animated on the same steps: a real stop-motion rig, frame by frame
    const focus = this.camera(ts);
    this.words(ts, t, step);
    if (shot === 0) this.animChat(ts, step);
    else if (shot === 1) this.animStrawberry(ts, step);
    else this.animGlass(ts, step);

    const c = this.cam;
    (u.camPos!.value as THREE.Vector3).copy(c.position);
    (u.camRot!.value as THREE.Matrix3).setFromMatrix4(c.matrixWorld);
    u.tanF!.value = Math.tan(((c.fov / 2) * Math.PI) / 180);
    this.set.render(renderer, this.rt);
    this.dof.u.src!.value = this.rt.texture;
    (this.dof.u.texel!.value as THREE.Vector2).set(1 / this.rt.width, 1 / this.rt.height);
    this.dof.u.focus!.value = focus;
    this.dof.render(renderer, out);
    const snap = pulse(t, T.dR, 0.1);
    return {
      bloom: 0.22, bloomThreshold: 1.0, halation: 0.08, ca: 0.35, grain: 0.05, vignette: 0.38,
      shake: [snap * 6 * (hash(frameIdx(t), 1) - 0.5), snap * 6 * (hash(frameIdx(t), 2) - 0.5)] as [number, number],
    };
  }

  // ------------------------------------------------------------------ camera (continuous)
  /** Sets the camera for t; returns the focus distance. */
  private camera(t: number): number {
    const T = this.T, c = this.cam;
    let pos: THREE.Vector3, tgt: THREE.Vector3, roll = 0;
    const up = new THREE.Vector3(0, 1, 0);
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const orb = (target: THREE.Vector3, dist: number, yaw: number, pitch: number) =>
      V(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    if (t < T.dR) {
      // crane in, then arc along the table across the bar; the push on the bar line finds the bot
      const o = ease.outExpo(clamp((t - T.start) / 0.8)), arc = ease.inOutQuad(clamp((t - T.start - 0.5) / (T.d1 - T.start - 0.5)));
      let dist = lerp(7.4, 5.3, o) - 0.5 * arc, yaw = lerp(-0.6, -0.25, o) + 0.45 * arc, pitch = lerp(0.7, 0.44, o) - 0.06 * arc;
      let tx = 0.2 + 0.3 * arc, ty = 0.35;
      const pb = springStep(t - T.d1, 2.4, 0.55);
      dist = lerp(dist, 4.9, pb); yaw = lerp(yaw, -0.18, pb); tx = lerp(tx, -0.55, pb); ty = lerp(ty, 0.5, pb);
      T.kicks.forEach((k, i) => { const s = ease.outExpo(clamp((t - k) / 0.13)); dist += [0.32, 0.32, 0.34][i]! * s; pitch += 0.04 * s; ty -= 0.05 * s; });
      const k3 = T.kicks[2] ?? T.dR - 0.6;
      if (t > k3) { const h = clamp((t - k3) / (T.dR - k3)); dist += 0.15 * ease.outQuad(h); roll = -0.035 * ease.inQuad(h); }
      yaw -= 0.1 * clamp((t - (T.kicks[0] ?? T.dR)) / 0.6) * (t > (T.kicks[0] ?? 1e9) ? 1 : 0);
      tgt = V(tx, ty, -0.2); pos = orb(tgt, dist, yaw, pitch);
    } else if (t < T.d3) {
      const uu = t - T.dR, D = T.d3 - T.dR;
      let dist = keys(uu, [[0, 1.9], [0.5, 6.0, ease.outExpo], [D, 5.6, ease.inOutQuad]]);
      const yaw = keys(uu, [[0, 0.45], [0.5, 0.1, ease.outExpo], [D, -0.08, ease.inOutQuad]]);
      const pitch = keys(uu, [[0, 0.05], [0.5, 0.32, ease.outExpo], [D, 0.36, ease.inOutQuad]]);
      for (const k of T.counts) dist -= 0.25 * pulse(t, k, 0.14);
      tgt = V(keys(uu, [[0, -1.1], [0.5, 0.25, ease.outExpo]]), keys(uu, [[0, 0.3], [0.5, 0.2, ease.outExpo]]), 0);
      pos = orb(tgt, dist, yaw, pitch);
    } else if (t < T.dG) {
      const a = ease.outExpo(clamp((t - T.d3) / 0.35));
      const b = ease.outBack(clamp((t - T.snareC) / 0.3), 1.2);
      const c0 = T.L2.words[0]!.start - 0.3, cc = ease.inOutQuad(clamp((t - c0) / 0.5));
      let dist = lerp(5.6, 7.4, a), yaw = lerp(-0.08, 0.12, a), pitch = lerp(0.36, 0.3, a);
      let tx = lerp(0.25, 0.1, a), ty = lerp(0.2, 0.55, a);
      dist = lerp(dist, 5.4, b); ty = lerp(ty, 1.25, b); tx = lerp(tx, -0.55, b);
      dist = lerp(dist, 6.4, cc); tx = lerp(tx, -4.2, cc); ty = lerp(ty, 0.8, cc); yaw = lerp(yaw, -0.18, cc); pitch = lerp(pitch, 0.16, cc);
      tgt = V(tx, ty, 0); pos = orb(tgt, dist, yaw, pitch);
    } else if (t < T.d5) {
      const uu = t - T.dG, D = T.d5 - T.dG;
      let dist = keys(uu, [[0, 3.2], [0.55, 6.3, ease.outExpo], [D, 5.8, ease.inOutQuad]]);
      dist -= 0.45 * springStep(t - T.snareD, 2.2, 0.6) * (t > T.snareD ? 1 : 0);
      const yaw = keys(uu, [[0, -0.1], [0.55, 0.2, ease.outExpo], [D, -0.12, ease.inOutQuad]]);
      const pitch = keys(uu, [[0, 0.7], [0.55, 0.2, ease.outExpo], [D, 0.25, ease.inOutQuad]]);
      tgt = V(keys(uu, [[0, -0.5], [0.55, 0.5, ease.outExpo]]), keys(uu, [[0, 1.3], [0.55, 0.8, ease.outExpo]]), -0.2);
      pos = orb(tgt, dist, yaw, pitch);
    } else {
      // out: up over the glass, looking down into the rim
      const uu = t - T.d5;
      const el = keys(uu, [[0, 0.5], [0.7, 1.22, ease.outExpo], [T.end - T.d5, 1.3, ease.inOutQuad]]);
      const dist = keys(uu, [[0, 5.8], [0.7, 4.7, ease.outExpo], [T.end - T.d5, 4.3, ease.inOutQuad]]);
      tgt = V(-0.2, 0.7, -0.1);
      pos = orb(tgt, dist, 0.05 * Math.sin(uu * 0.8), el);
      roll = keys(uu, [[0, 0.25], [0.8, 0, ease.outExpo]]);
    }
    // the rig is nudged by hand between exposures
    const st = Math.round(t * 12);
    pos.add(V((hash(st, 91) - 0.5) * 0.012, (hash(st, 92) - 0.5) * 0.008, (hash(st, 93) - 0.5) * 0.012));
    c.fov = 34;
    c.position.copy(pos);
    c.up.copy(up);
    c.lookAt(tgt);
    c.rotateZ(roll);
    c.updateMatrixWorld(true);
    return pos.distanceTo(tgt);
  }

  // ------------------------------------------------------------------ the lyric words (stop-motion)
  private rowFor(line: Line, t: number): Row {
    const T = this.T, wpp = 0.0036;
    if (line === T.L0) return { x: 0.45, z: -0.1, maxW: 4.0, wpp: 0.0052, flat: false, step: 0.75 };
    if (line === T.L1) return t < T.dR ? { x: 0.35, z: 0.45, maxW: 4.4, wpp: 0.0052, flat: false, step: 0.8 } : { x: 0.1, z: 1.2, maxW: 4.6, wpp: 0.0046, flat: false, step: 0.85 };
    if (line === T.L2) {
      if (t < T.dG) return { x: -3.9, z: 0.75, maxW: 4.2, wpp: 0.0046, flat: false, step: 0.85 };
      if (t < T.d5) return { x: 0.45, z: 0.35, maxW: 4.3, wpp: 0.0046, flat: false, step: 0.85 };
      return { x: -0.3, z: 0.42, maxW: 3.4, wpp: 0.0037, flat: true, step: 0.5 };
    }
    return { x: 1.35, z: -0.55, maxW: 1.9, wpp: 0.0039, flat: true, step: 0.5 };
  }

  private words(ts: number, t: number, step: number) {
    const T = this.T, u = this.set.u;
    const slots: Slot[] = [];
    const lines: [Line, number][] = [[T.L0, T.L1.start - 0.02], [T.L1, T.L1.end + 0.3], [T.L2, T.L2.end + 0.22], [T.L3, Infinity]];
    for (const [line, exitT] of lines) {
      if (ts < line.words[0]!.start - 0.2 || ts > exitT + 0.2) continue;
      const row = this.rowFor(line, t);
      // wrap into rows that stack toward the camera (or down the table when lying flat)
      const space = WORD_PX * 0.3 * row.wpp;
      const rows: { w: Word; width: number }[][] = [[]];
      let acc = 0;
      for (const w of line.words) {
        const it = this.atlas.get(`w${w.gi}`), width = (it.w - 2 * SPREAD) * row.wpp;
        if (acc > 0 && acc + width > row.maxW) { rows.push([]); acc = 0; }
        rows[rows.length - 1]!.push({ w, width }); acc += width + space;
      }
      rows.forEach((r, ri) => {
        const total = r.reduce((a, b) => a + b.width, 0) + space * (r.length - 1);
        let x = row.x - total / 2;
        for (const { w, width } of r) {
          const s = this.wordAnim(w, ts, exitT, step);
          if (s) {
            const it = this.atlas.get(`w${w.gi}`);
            const jit = (k: number) => (hash(step, w.gi, k) - 0.5) * 0.006;
            slots.push({
              x: x + jit(1), y: s.y, z: row.z + ri * row.step + jit(2), wpp: row.wpp, rect: [it.x, it.y, it.w, it.h],
              sx: s.sx, sy: s.sy, base: it.base, flat: row.flat, tint: /strawberry|wine/i.test(w.w) ? 3 : w.gi % 3, depth: 0.055,
            });
            if (row.flat) slots[slots.length - 1]!.z = row.z + ri * row.step * 1.0 + jit(2);
          }
          x += width + space;
        }
      });
    }
    const A = u.wA!.value as THREE.Vector4[], B = u.wB!.value as THREE.Vector4[], C = u.wC!.value as THREE.Vector4[], D = u.wD!.value as THREE.Vector4[];
    for (let i = 0; i < MAX_WORDS; i++) {
      const s = slots[i];
      if (!s) { D[i]!.set(0, 0, 0, 0); continue; }
      A[i]!.set(s.x, s.y, s.z, s.wpp);
      B[i]!.set(...s.rect);
      C[i]!.set(s.sx, s.sy, s.base, s.flat ? 1 : 0);
      D[i]!.set(s.tint, 1, s.depth, 0);
    }
  }

  /** A word drops in, squashes on landing, overshoots, settles; held notes stretch it; at exit it squashes flat. */
  private wordAnim(w: Word, ts: number, exitT: number, step: number) {
    const u = ts - w.start;
    // a short drop (one or two steps in the air) so a falling word never crosses the row above it
    if (u < -0.12) return null;
    let y = 0, sx = 1, sy = 1;
    if (u < 0) { const k = -u / 0.12; y = 0.28 * k * k; sy = 1.2; sx = 0.88; }
    else {
      const s = springStep(u, 3.0, 0.3);
      sy = 0.5 + 0.5 * s; sx = 1 / Math.sqrt(sy);
    }
    const dur = w.end - w.start;
    if (dur > 0.55) {
      const p = clamp((ts - w.start - 0.22) / (dur - 0.22));
      const rel = ts > w.end ? 1 - springStep(ts - w.end, 3.5, 0.3) : 1;
      const pull = 0.38 * ease.outQuad(p) * rel + 0.02 * Math.sin(step * 2.1) * p * rel;
      sx *= 1 + pull; sy /= 1 + 0.12 * pull;
    }
    if (ts > exitT) {
      const e = clamp((ts - exitT) / 0.12);
      if (e >= 1) return null;
      sy *= 1 - 0.4 * e; sx *= 1 + 0.15 * e; y -= 0.55 * e;
    }
    return { y, sx, sy };
  }

  // ------------------------------------------------------------------ props (stop-motion)
  private jit(step: number, id: number, a = 0.004) { return (hash(step, id) - 0.5) * a; }

  private animChat(ts: number, step: number) {
    const T = this.T, u = this.set.u;
    let sq = 1;
    T.kicks.forEach((k, i) => (sq -= [0.1, 0.09, 0.08][i]! * springStep(ts - k, 4, 0.4)));
    const k3 = T.kicks[2] ?? T.dR;
    if (ts > k3) sq -= 0.05 * clamp((ts - k3) / (T.dR - k3));
    (u.uBub!.value as THREE.Vector4).set(0.55 + this.jit(step, 1), 0.64 * sq + 0.1, -0.9, sq);
    // typing: one char per ~quarter of a beat, finishing before the bar line
    const q1 = this.atlas.get('q1'), q2 = this.atlas.get('q2'), n1 = q1.cx1.length, n = n1 + q2.cx1.length;
    const t0 = T.start - 0.55, t1 = T.d1 - 0.3;
    const k = clamp(Math.floor(((ts - t0) / (t1 - t0)) * n), 0, n);
    const rv = (it: typeof q1, c: number) => (c <= 0 ? -100 : it.cx1[c - 1]! - SPREAD + 2);
    (u.qReveal!.value as THREE.Vector2).set(rv(q1, Math.min(k, n1)), rv(q2, k - n1));
    const pop = ts > T.d1 ? springStep(ts - T.d1, 2.6, 0.4) : 0;
    (u.uBot!.value as THREE.Vector4).set(-2.75 + this.jit(step, 2), 0.28 * pop * sq + 0.02, -0.2, pop * sq);
    const beat = this.ctx.audio.beatAt(ts);
    (u.dots!.value as THREE.Vector3).set(...([0, 1, 2].map((i) => Math.max(0, Math.sin((beat * 2 - i * 0.3) * Math.PI)) * 0.08) as [number, number, number]));
  }

  private animStrawberry(ts: number, step: number) {
    const T = this.T, u = this.set.u, it = this.atlas.get('hero');
    const inC = ts >= T.d3;
    const wpp = 4.3 / it.w, x0 = -2.15;
    // the R's jump on "R's" and on their counts
    const hb = u.heroB!.value as number[];
    const rIdx = [2, 7, 8];
    for (let i = 0; i < 10; i++) {
      // they pop up out of the table one after another, overshoot and settle
      const tl = T.dR - 0.09 + 0.016 * i;
      let y = -0.75 * (1 - springStep(ts - tl, 3.4, 0.38));
      const ri = rIdx.indexOf(i);
      if (ri >= 0) {
        const hop = (tc: number, hgt: number) => { const d = ts - tc; return d > 0 && d < 0.32 ? hgt * Math.sin((d / 0.32) * Math.PI) : 0; };
        y += hop(T.L1.words[4]!.start, 0.16);
        if (!inC) y += hop(T.counts[ri]!, 0.22);
      }
      hb[i] = y + this.jit(step, 10 + i, 0.006);
    }
    const split = inC ? 0.14 * springStep(ts - T.d3 - 0.12, 2.6, 0.45) : 0;
    (u.uHero!.value as THREE.Vector4).set(x0, 0, 0, split);
    const fp = springStep(ts - T.dR - 0.1, 2.2, 0.4);
    (u.uFruit!.value as THREE.Vector4).set(2.95 + this.jit(step, 3), 0, -0.95, 1.2 * clamp(fp, 0, 1.2));
    u.fruitRot!.value = 0.6 + step * 0.05;
    // the count: a mustard chip with its number drops onto each R on the beats after the hit
    const chips = u.uChip!.value as THREE.Vector4[];
    const capH = 170 * 0.72 * wpp;
    rIdx.forEach((li, i) => {
      const cx = x0 + ((it.cx0[li]! + it.cx1[li]!) / 2 - SPREAD) * wpp + (li < 5 ? -split : split);
      const d = ts - T.counts[i]!;
      if (d < -0.1 || (inC && ts > T.d3 + 0.1)) { chips[i]!.set(0, 0, 0, 0); return; }
      const y = capH + 0.2 + (d < 0 ? 0.6 * (-d / 0.1) : 0);
      chips[i]!.set(cx, y, 0.05, d < 0 ? 0.9 : 0.75 + 0.25 * springStep(d, 3, 0.35));
    });
    // C: the reply, the cut into tokens, the missed R ringed, then the next prompt
    if (inC) {
      const rp = springStep(ts - T.d3, 2.4, 0.4);
      (u.uReply!.value as THREE.Vector4).set(0.1, 1.25, -1.1, clamp(rp, 0, 1.2));
      const rev = (key: string, t0: number, t1: number) => {
        const it2 = this.atlas.get(key), n = it2.cx1.length, k = clamp(Math.floor(((ts - t0) / (t1 - t0)) * n), 0, n);
        return k === 0 ? -100 : it2.cx1[k - 1]! - SPREAD + 2;
      };
      // the "2" lands big and bounces again on the snare
      const two = ts > T.d3 + 0.2 ? springStep(ts - T.d3 - 0.2, 2.6, 0.32) * (1 + 0.18 * Math.max(0, Math.sin(clamp((ts - T.snareC) / 0.25) * Math.PI))) : 0;
      (u.replyRev!.value as THREE.Vector4).set(rev('replyA', T.d3 + 0.04, T.d3 + 0.2), two, rev('replyB', T.d3 + 0.27, T.d3 + 0.5), ts > T.d3 + 0.55 ? 1e4 : -100);
      const cy = ts - T.d3;
      (u.uCutter!.value as THREE.Vector4).set(x0 + (((it.cx1[4]! + it.cx0[5]!) / 2) - SPREAD) * wpp, cy < 0.12 ? lerp(1.2, -0.05, cy / 0.12) : lerp(-0.05, 2.2, clamp((cy - 0.2) / 0.2)), 0, cy < 0.45 ? 1 : 0);
      const rg = ts > T.snareC ? springStep(ts - T.snareC, 2.8, 0.35) : 0;
      const rx = x0 + ((it.cx0[2]! + it.cx1[2]!) / 2 - SPREAD) * wpp - split;
      (u.uRing!.value as THREE.Vector4).set(rx, capH * 0.5, 0.05, rg * (1 + 0.06 * Math.sin(step * 1.7)));
      const tp = T.L2.words[0]!.start - 0.12;
      const pp = ts > tp ? springStep(ts - tp, 2.6, 0.4) : 0;
      (u.uPrompt!.value as THREE.Vector4).set(-5.25, 1.1, -1.1, pp);
      const pr = this.atlas.get('prompt'), pn = pr.cx1.length;
      const pk = clamp(Math.floor(((ts - tp - 0.08) / (T.L2.words[3]!.end - tp - 0.1)) * pn), 0, pn);
      u.promptReveal!.value = pk === 0 ? -100 : pr.cx1[pk - 1]! - SPREAD + 2;
    } else {
      for (const k of ['uReply', 'uRing', 'uCutter', 'uPrompt']) (u[k]!.value as THREE.Vector4).set(0, 0, 0, 0);
    }
  }

  private animGlass(ts: number, step: number) {
    const T = this.T, u = this.set.u;
    const gx = -0.5, gz = -0.2;
    // the glass drops onto the table on "glass"; the wine rises and stops at half
    const d = ts - T.dG;
    const y = d < 0 ? 1.6 * (-d / 0.17) ** 2 : 0.07 * Math.max(0, Math.sin(d * 18)) * Math.exp(-d * 9);
    (u.uGlass!.value as THREE.Vector4).set(gx + this.jit(step, 4, 0.003), y, gz, 1);
    u.wineLvl!.value = 0.5 * ease.outCubic(clamp((ts - T.dG - 0.15) / 0.5));
    const cp = springStep(ts - T.dG - 0.12, 2.4, 0.4);
    (u.uClaim!.value as THREE.Vector4).set(1.9, 1.25, -0.7, clamp(cp, 0, 1.2) * (ts > T.dG + 0.1 && ts < T.d5 ? 1 : 0));
    const rev = (key: string, t0: number, t1: number) => {
      const it = this.atlas.get(key), n = it.cx1.length, k = clamp(Math.floor(((ts - t0) / (t1 - t0)) * n), 0, n);
      return k === 0 ? -100 : it.cx1[k - 1]! - SPREAD + 2;
    };
    (u.claimReveal!.value as THREE.Vector2).set(rev('claim1', T.dG + 0.2, T.dG + 0.55), rev('claim2', T.dG + 0.56, T.dG + 0.9));
    const tb = T.L2.words[5]!.start - 0.05;
    const tg = ts > tb ? clamp(springStep(ts - tb, 2.5, 0.45), 0, 1.1) : 0;
    (u.uTag!.value as THREE.Vector4).set(gx - 0.98, 0, gz, ts < T.d5 ? tg : 0);
    const beads = ts > T.snareD - 0.15 ? 0.5 * clamp((ts - T.snareD + 0.15) / 0.2) : 0;
    const tc = T.L3.words[0]!.start - 0.35;
    const ticks = ts > tc ? clamp(Math.floor((ts - tc) / 0.025), 0, 12) : 0;
    const th = T.L3.words[1]!.start;
    const hm = ts > th ? springStep(ts - th, 3, 0.4) : 0, hh = ts > th + 0.09 ? springStep(ts - th - 0.09, 3, 0.4) : 0;
    (u.uHands!.value as THREE.Vector4).set(hm, hh, ticks, beads);
  }
}
