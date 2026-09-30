// Verse 2, scene 9: "Asked for the Founding Fathers, got the Hamilton cast, / Asked "misgender, or the
// apocalypse?" - it picked…". The office was a stage set: the curtain rises on DEV and the chatbot (v2.0)
// on a Broadway stage. DEV asks for a history painting; a gilt frame (THE FOUNDING FATHERS, 1776) flies
// in… and flies out again as the spotlights slam onto a cast in colonial coats doing jazz hands (the
// overcorrection is the joke; the musical is treated with affection). Then a whip to the chatbot's
// corner: an RPG choice menu, the cursor dithering between the two options and settling on the
// apocalypse (the selection lands in v2-grok, on "picked").
// Lyric idioms: line 1 lights up on the marquee over the proscenium, bulb by bulb as each word is sung;
// line 2 is the choice menu (see v2-stage-set.ts).
import * as THREE from 'three';
import type { Frame } from '../engine/scene';
import type { Line, Word } from '../engine/lyrics';
import { clamp, lerp, ease, prog, pulse } from '../engine/util';
import { Ps1Stage, type CamState, type V3, windowOpen } from '../ps1/stage';
import { makeDev, type Dev } from '../ps1/cast';
import { psMat, psGlobals, canvasTex, pixText, rng, shade } from '../ps1/gfx';
import { P } from '../ps1/palette';
import { glyphBits, buildChatCorner, buildStageShell, menuCam, menuKicks, drawMenu, MENU_W, MENU_H, caption, type ChatCorner } from './v2-stage-set';

const box = (w: number, h: number, d: number, m: THREE.Material | THREE.Material[]) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const mix3 = (a: V3, b: V3, u: number): V3 => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];

/** The marquee: two rows of bulbs, 2 texels per bulb, a chaser border. */
const MQ_COLS = 17, MQ_W = MQ_COLS * 12 + 16, MQ_H = 2 * 16 + 20;
const MARQ_W = 8.2;

export default class V2Stage extends Ps1Stage {
  L1!: Line; L2!: Line;
  T: Record<string, number> = {};
  kicks: number[] = [];
  mk: number[] = [];
  snares: number[] = [];
  dev!: Dev;
  corner!: ChatCorner;
  curtain = new THREE.Group();
  frameG = new THREE.Group();
  cast: { root: THREE.Group; armL: THREE.Object3D; armR: THREE.Object3D; head: THREE.Mesh; k: number }[] = [];
  spots: THREE.Mesh[] = [];
  pools: THREE.Mesh[] = [];
  backdrop!: THREE.Mesh;
  marquee = this.panel(MQ_W, MQ_H);
  menu = this.panel(MENU_W, MENU_H);
  cap!: THREE.Mesh;
  castLight = 0;

  override fogFar = 30;
  override fogNear = 10;

  override async init() {
    const { lyrics: ly, audio: au, start, end } = this.ctx;
    this.L1 = ly.get('Asked for the Founding Fathers', 0);
    this.L2 = ly.get('misgender, or the apocalypse', 0);
    const db = au.downbeats.filter((d) => d >= start - 0.02 && d <= end + 0.02);
    const T = this.T;
    T.d0 = start; T.d1 = db[1] ?? start + 1.39; T.d2 = db[2] ?? start + 2.78; T.d3 = db[3] ?? start + 4.17; T.end = end;
    T.asked = this.L1.words[0]!.start; T.founding = this.L1.words[3]!.start; T.fathersEnd = this.L1.words[4]!.end;
    T.got = this.L1.words[5]!.start; T.ham = this.L1.words[7]!.start; T.castEnd = this.L1.words[8]!.end;
    T.l2 = this.L2.words[0]!.start; T.apo = this.L2.words[4]!.start;
    this.kicks = au.events('kick', start, end + 0.5).map((k) => k[0]);
    this.snares = au.events('snare', start, end + 0.5).map((k) => k[0]);
    this.mk = menuKicks(au, T.l2);
    this.buildStage();
    this.buildCast();
    this.buildFrame();
    this.corner = buildChatCorner(this);
    this.dev = makeDev();
    this.dev.root.position.set(-2.4, 0, -1.3);
    this.dev.root.rotation.y = -1.25;
    this.world.add(this.dev.root);
    this.cap = caption(this, ['Gemini, Feb 2024:', 'image generation of', 'people paused'], 1 / 40);
    this.cap.position.set(-2.9, 0.5, 0.6);
    // the marquee board lives on the proscenium header (in the world, depth-tested)
    this.marquee.inWorld(true);
    this.marquee.mesh.position.set(0, 4.95, 0.23);
    this.marquee.mesh.scale.set(MARQ_W, MARQ_W * (MQ_H / MQ_W), 1);
  }

  // ------------------------------------------------------------------ the set
  private buildStage() {
    const R = rng(33);
    const w = this.world;
    buildStageShell(this);
    const gold = psMat({ color: '#B98E35' });
    // the curtain: red velvet folds (a vertical-stripe texture on a few panels), rising
    const velvet = canvasTex(32, 32, (c) => {
      for (let x = 0; x < 32; x++) { const f = 0.62 + 0.38 * Math.abs(Math.sin((x / 32) * Math.PI * 4)); for (let y = 0; y < 32; y++) { c.fillStyle = shade('#B01E2E', f * (0.95 + R() * 0.08)); c.fillRect(x, y, 1, 1); } }
    }, true).tex;
    const cg = new THREE.PlaneGeometry(10.6, 4.3, 8, 3);
    const cuv = cg.attributes.uv!; for (let i = 0; i < cuv.count; i++) cuv.setXY(i, cuv.getX(i) * 5, cuv.getY(i));
    // a gentle sway in the folds (baked into the vertices)
    const cp = cg.attributes.position!; for (let i = 0; i < cp.count; i++) cp.setZ(i, 0.08 * Math.sin(cp.getX(i) * 2.4));
    const curt = new THREE.Mesh(cg, psMat({ map: velvet, side: THREE.DoubleSide }));
    curt.position.y = 2.15;
    const fringe = box(10.6, 0.12, 0.1, gold); fringe.position.y = 0.02;
    this.curtain.add(curt, fringe);
    this.curtain.position.set(0, 0, 0.35);
    w.add(this.curtain);
    // the backdrop behind the cast: gold "1776" on navy, hidden until the reveal
    const bd = canvasTex(96, 40, (c) => {
      c.fillStyle = '#1B2A55'; c.fillRect(0, 0, 96, 40);
      for (let i = 0; i < 30; i++) { c.fillStyle = R() > 0.5 ? '#E8E4D8' : '#8C93B8'; c.fillRect(Math.floor(R() * 94) + 1, Math.floor(R() * 38) + 1, 1, 1); }
      pixText(c, '1776', 24, 9, '#FFD23F', 4, { shadow: '#6E4A12' });
    });
    this.backdrop = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 3.0), psMat({ map: bd.tex, unlit: true, fog: 0.2 }));
    this.backdrop.position.set(0, 2.6, -6.85); w.add(this.backdrop);
    // spotlight cones (additive) and light pools on the floor, for the reveal
    const coneM = psMat({ color: '#FFF1C8', unlit: true, additive: true, opacity: 0.999, fog: 0.3, side: THREE.DoubleSide });
    const poolM = psMat({ color: '#FFE6A8', unlit: true, additive: true, opacity: 0.999, fog: 0.3 });
    for (const x of [-1.8, 0, 1.8]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.0, 5.5, 8, 1, true), coneM.clone());
      cone.position.set(x * 0.7, 3.4, -3.5); cone.rotation.z = -x * 0.05;
      w.add(cone); this.spots.push(cone);
      const pool = new THREE.Mesh(new THREE.CircleGeometry(1.1, 10), poolM.clone()); pool.rotation.x = -Math.PI / 2; pool.position.set(x, 0.015, -3.4);
      w.add(pool); this.pools.push(pool);
    }
  }

  private buildCast() {
    // five performers in colonial coats and tricorn hats, varied skin tones, jazz hands
    const skins = ['#8D5524', '#E0AC69', '#5C3A21', '#C68642', '#F1C27D'];
    const coats = ['#1F3A7A', '#8E1F2A', '#2F5E3A', '#1F3A7A', '#5A2A6A'];
    const white = psMat({ color: '#EDE6D6' }), boot = psMat({ color: '#1A1A22' }), hatM = psMat({ color: '#15151C' }), goldM = psMat({ color: '#C9A13A' });
    skins.forEach((sk, i) => {
      const root = new THREE.Group();
      const skin = psMat({ color: sk }), coat = psMat({ color: coats[i]! });
      const face = canvasTex(12, 12, (c) => {
        c.fillStyle = sk; c.fillRect(0, 0, 12, 12);
        c.fillStyle = P.ink; c.fillRect(3, 4, 2, 2); c.fillRect(7, 4, 2, 2);
        c.fillStyle = '#5A1E1E'; c.fillRect(4, 8, 4, 2); c.fillStyle = '#F3ECDF'; c.fillRect(4, 8, 4, 1);
        c.fillStyle = '#E8E4D8'; c.fillRect(0, 0, 12, 2); // powdered hair line under the hat
      }).tex;
      const faceM = psMat({ map: face });
      for (const x of [-0.12, 0.12]) { const l = box(0.18, 0.62, 0.2, white); l.position.set(x, 0.31, 0); root.add(l); const b = box(0.2, 0.22, 0.26, boot); b.position.set(x, 0.1, 0.03); root.add(b); }
      const body = box(0.54, 0.62, 0.32, coat); body.position.set(0, 0.95, 0); root.add(body);
      const tails = box(0.56, 0.36, 0.1, coat); tails.position.set(0, 0.55, -0.15); root.add(tails);
      const vest = box(0.2, 0.5, 0.02, white); vest.position.set(0, 0.97, 0.17); root.add(vest);
      for (const y of [0.85, 0.97, 1.09]) { const btn = box(0.04, 0.04, 0.02, goldM); btn.position.set(0.14, y, 0.17); root.add(btn); }
      const head = box(0.3, 0.32, 0.3, [skin, skin, skin, skin, skin, faceM]); head.position.set(0, 1.44, 0); root.add(head);
      const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 3), hatM); hat.position.set(0, 1.64, 0); hat.rotation.y = Math.PI / 6 + Math.PI; root.add(hat);
      const arm = (x: number) => {
        const piv = new THREE.Object3D(); piv.position.set(x, 1.18, 0);
        const a = box(0.13, 0.5, 0.13, coat); a.position.y = -0.24;
        const h = box(0.16, 0.1, 0.05, skin); h.position.y = -0.53;
        piv.add(a, h); root.add(piv); return piv;
      };
      const armL = arm(-0.34), armR = arm(0.34);
      root.position.set(-2.2 + i * 1.1, 0, -3.6 + Math.abs(i - 2) * 0.25);
      this.world.add(root);
      this.cast.push({ root, armL, armR, head, k: i });
    });
  }

  private buildFrame() {
    // the requested history painting: a gilt frame with an empty "rendering" canvas and a plaque
    const gold = psMat({ color: '#D1A640' }), dk = psMat({ color: '#8A6420' });
    const W = 3.4, Hh = 2.2;
    for (const [x, y, fw, fh] of [[0, Hh / 2, W + 0.3, 0.22], [0, -Hh / 2, W + 0.3, 0.22], [-W / 2, 0, 0.22, Hh + 0.3], [W / 2, 0, 0.22, Hh + 0.3]] as [number, number, number, number][]) {
      const b = box(fw, fh, 0.14, gold); b.position.set(x, y, 0); this.frameG.add(b);
      const e = box(fw * 0.9, fh * 0.35, 0.16, dk); e.position.set(x, y, 0.01); this.frameG.add(e);
    }
    const cv = canvasTex(64, 40, (c) => {
      c.fillStyle = '#E8DDBF'; c.fillRect(0, 0, 64, 40);
      c.fillStyle = '#C8BA95'; for (let i = 0; i < 64; i += 4) c.fillRect(i, 0, 2, 40);
      pixText(c, 'RENDERING', 5, 16, '#8A7A55');
    });
    const canvasM = new THREE.Mesh(new THREE.PlaneGeometry(W, Hh), psMat({ map: cv.tex })); canvasM.position.z = -0.02; this.frameG.add(canvasM);
    const pl = canvasTex(112, 12, (c) => { c.fillStyle = '#6E4A12'; c.fillRect(0, 0, 112, 12); c.fillStyle = '#D1A640'; c.fillRect(1, 1, 110, 10); pixText(c, 'THE FOUNDING FATHERS', 4, 3, '#2A1A08'); });
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(2.24, 0.24), psMat({ map: pl.tex, unlit: true, fog: 0.3 })); plaque.position.set(0, -Hh / 2 - 0.3, 0.05); this.frameG.add(plaque);
    const wire = psMat({ color: '#15151C' });
    for (const x of [-1.2, 1.2]) { const c = box(0.02, 4, 0.02, wire); c.position.set(x, Hh / 2 + 2, 0); this.frameG.add(c); }
    this.world.add(this.frameG);
  }

  // ------------------------------------------------------------------ camera
  camAt(t: number): CamState {
    const T = this.T;
    if (t < T.asked) {
      // the curtain fills the frame, rises, and we pull back to the whole proscenium
      const u = prog(t, T.d0, T.asked, ease.inOutCubic);
      return { P: mix3([0, 2.3, 3.4], [0.0, 3.6, 8.2], u), T: mix3([0, 2.3, 0], [0, 3.7, -1], u), roll: 0, fov: 52 };
    }
    if (t < T.d1) {
      // on the marquee as ASKED FOR THE lights up (a slow push, drifting right)
      const u = prog(t, T.asked, T.d1, ease.inOutQuad);
      return { P: [lerp(-0.8, 0.5, u), lerp(3.9, 4.3, u), lerp(7.8, 5.6, u)], T: [lerp(-0.4, 0.3, u), 4.35, -1], roll: lerp(0.02, -0.02, u), fov: 50 };
    }
    if (t < T.got - 0.2) {
      // downbeat: a low angle under the marquee, sweeping an arc as FOUNDING FATHERS lights
      const u = prog(t, T.d1, T.got - 0.2, ease.outCubic);
      const a = lerp(-0.5, 0.35, u);
      return { P: [Math.sin(a) * 5.2, lerp(1.1, 1.5, u), 1.2 + Math.cos(a) * 5.2], T: [Math.sin(a) * 0.8, 4.2, 0], roll: 0.06 * Math.cos(a), fov: 54 };
    }
    if (t < T.d2) {
      // the stage: DEV points at the gilt frame flying in; the marquee flips to GOT THE
      const u = prog(t, T.got - 0.2, T.d2, ease.inCubic);
      return { P: [lerp(1.4, 0.2, u), lerp(3.2, 3.0, u), lerp(8.0, 5.0, u)], T: [0, lerp(3.4, 3.3, u), -2.5], roll: lerp(-0.03, 0.02, u), fov: lerp(52, 46, u) };
    }
    if (t < T.l2 - 0.23) {
      // downbeat: the reveal. Crash in to a low hero angle on the cast, the marquee over them; then orbit
      const k = prog(t, T.d2, T.d2 + 0.18, ease.outExpo);
      const o = prog(t, T.d2 + 0.18, T.l2 - 0.23, ease.inOutQuad);
      const a = lerp(0.18, -0.2, o);
      const P0: V3 = [0.6, 2.2, 9.5], P1: V3 = [Math.sin(a) * 5.0, 0.5, -0.6 + Math.cos(a) * 5.0];
      return { P: mix3(P0, P1, k), T: mix3([0, 2.4, -2], [0, 3.15, -2.6], k), roll: lerp(0, 0.05 * Math.sin(a * 3), k), fov: lerp(52, 62, k) };
    }
    // whip pan to the chatbot's corner, then the menu shot (shared with v2-grok's first bar)
    const mc = menuCam(t, T.l2, this.mk);
    if (t < T.l2) {
      const w = ease.inOutCubic(prog(t, T.l2 - 0.23, T.l2));
      const from = this.camAt(T.l2 - 0.2301);
      const a0 = Math.atan2(from.T[0] - from.P[0], from.T[2] - from.P[2]), a1 = Math.atan2(mc.T[0] - mc.P[0], mc.T[2] - mc.P[2]);
      const P = mix3(from.P, mc.P, w);
      const a = lerp(a0, a1, w), d = 3;
      return { P, T: [P[0] + Math.sin(a) * d, lerp(from.T[1], mc.T[1], w), P[2] + Math.cos(a) * d], roll: 0.12 * Math.sin(w * Math.PI), fov: 52 };
    }
    return mc;
  }

  // ------------------------------------------------------------------ frame
  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, T = this.T;
    this.begin();
    // the curtain goes up; the house lights are warm, the reveal adds the follow spots
    this.curtain.position.y = 5.6 * ease.inOutCubic(prog(t, T.d0 + 0.06, T.asked + 0.1));
    this.curtain.visible = this.curtain.position.y < 5.5;
    const reveal = t >= T.d2 ? 1 : 0;
    this.castLight = reveal * (0.75 + 0.25 * pulse(t, T.d2, 0.25));
    this.spots.forEach((s, i) => { s.visible = reveal > 0 && t < T.l2 - 0.1; ((s.material as THREE.RawShaderMaterial).uniforms.uColor!.value as THREE.Color).setRGB(0.22, 0.2, 0.15).multiplyScalar(this.castLight * (0.8 + 0.2 * Math.sin(t * 7 + i))); });
    this.pools.forEach((s) => { s.visible = reveal > 0 && t < T.l2 - 0.1; ((s.material as THREE.RawShaderMaterial).uniforms.uColor!.value as THREE.Color).setRGB(0.5, 0.42, 0.26).multiplyScalar(this.castLight); });
    this.backdrop.visible = reveal > 0;
    // the cast: in the dark before the reveal, then stepping and jazz-handing on the beats
    const beat = this.ctx.audio.beatAt(t);
    this.cast.forEach((c) => {
      c.root.visible = reveal > 0 && t < T.l2 - 0.1;
      const ph = beat * Math.PI + c.k * 0.4;
      const hop = Math.max(0, Math.sin(ph)) * 0.08;
      c.root.position.y = hop;
      c.root.rotation.y = 0.25 * Math.sin(beat * Math.PI * 0.5 + c.k);
      const jazz = 2.6 + 0.35 * Math.sin(ph * 2);
      c.armL.rotation.z = -jazz * (c.k % 2 ? 1 : 0.85); c.armR.rotation.z = jazz * (c.k % 2 ? 0.85 : 1);
      c.armL.rotation.x = c.armR.rotation.x = -0.2 * Math.sin(ph);
      c.head.rotation.z = 0.15 * Math.sin(ph);
    });
    // the gilt frame: flies in on "got", flies out on the downbeat
    const fin = ease.outBack(prog(t, T.got - 0.35, T.got + 0.05));
    const fout = ease.inCubic(prog(t, T.d2 - 0.02, T.d2 + 0.25));
    this.frameG.position.set(0, lerp(8, 2.6, fin) + 7 * fout, -2.8);
    this.frameG.rotation.z = 0.04 * Math.sin(t * 5) * (1 - fout);
    this.frameG.visible = t > T.got - 0.35 && fout < 1;
    // DEV: asks (smug), points at the frame, then the reveal hits him (shock)
    const dev = this.dev;
    dev.setFace(t < T.got - 0.3 ? 'smug' : t < T.d2 ? 'neutral' : 'shock');
    const point = prog(t, T.got - 0.3, T.got - 0.1, ease.outBack) * (1 - prog(t, T.d2, T.d2 + 0.15));
    dev.armR.rotation.x = -1.4 * point;
    dev.armR.rotation.z = 0.3 * point;
    const recoil = t >= T.d2 ? Math.exp(-(t - T.d2) * 5) : 0;
    dev.torso.rotation.x = 0.25 * recoil;
    dev.armL.rotation.x = -2.6 * clamp((t - T.d2) * 6) * (t > T.d2 ? 1 : 0);
    dev.root.position.y = 0.06 * Math.abs(Math.sin(beat * Math.PI)) * (t < T.d2 ? 1 : 0);
    // the chatbot: talks while the cast sings, then thinks over the menu
    const bot = this.corner.bot;
    bot.setFace(t < T.d2 ? 'neutral' : t < T.l2 ? 'happy' : t < T.apo + 0.1 ? 'think' : 'talk', Math.floor(t * 8));
    this.corner.cloud(t, Infinity);
    this.corner.glow(0);
    // caption only while the cast is on
    this.cap.visible = t >= T.d2 + 0.25 && t < T.l2 - 0.2;
    this.drawMarquee(t);
    this.drawMenuPanel(t);
    // lighting: the reveal floods the stage
    const g = 1 + 0.5 * this.castLight;
    psGlobals.uLightCol.value.multiplyScalar(1.25 * g); psGlobals.uAmb.value.multiplyScalar(1.7 + 0.5 * this.castLight);
    // hits
    const kick = this.kicks.reduce((v, k) => Math.max(v, pulse(t, k, 0.06)), 0);
    this.shake(0.03 * kick + 0.12 * pulse(t, T.d2, 0.08));
    return this.present(f, out, { flash: 0.35 * pulse(t, T.d2, 0.05) });
  }

  // ------------------------------------------------------------------ the marquee
  private drawMarquee(t: number) {
    const T = this.T;
    const phaseB = t >= T.got;
    const ws = phaseB ? this.L1.words.slice(5) : this.L1.words.slice(0, 5);
    const rows: Word[][] = phaseB ? [ws.slice(0, 2), ws.slice(2)] : [ws.slice(0, 3), ws.slice(3)];
    const chase = Math.floor(t * 14);
    // per word: chars lit so far (a quick left-to-right chase from the word's start) and its shimmer
    const lit = (w: Word) => {
      const len = Array.from(w.w).length, dur = Math.min(0.16, (w.end - w.start) * 0.7);
      return t < w.start ? 0 : Math.min(len, Math.floor(((t - w.start) / dur) * len) + 1);
    };
    const held = (w: Word) => w.end - w.start > 0.4 && t > w.start + 0.15 && t < w.end + 0.1;
    const key = `${phaseB ? 1 : 0}|${ws.map(lit).join(',')}|${chase}|${ws.map((w) => (held(w) ? chase % 2 : 0)).join('')}`;
    this.marquee.draw(key, (c) => {
      c.fillStyle = '#140A0C'; c.fillRect(0, 0, MQ_W, MQ_H);
      c.fillStyle = '#B98E35'; c.fillRect(0, 0, MQ_W, 2); c.fillRect(0, MQ_H - 2, MQ_W, 2); c.fillRect(0, 0, 2, MQ_H); c.fillRect(MQ_W - 2, 0, 2, MQ_H);
      // chaser bulbs round the border
      for (let i = 0, x = 4; x < MQ_W - 4; x += 4, i++) {
        const on = (i + chase) % 3 === 0;
        c.fillStyle = on ? '#FFF3C4' : '#5A3A1A'; c.fillRect(x, 4, 2, 2); c.fillRect(MQ_W - x - 2, MQ_H - 6, 2, 2);
      }
      rows.forEach((row, ri) => {
        const text = row.map((w) => w.w.toUpperCase()).join(' ');
        const len = Array.from(text).length;
        let x0 = 8 + Math.floor(((MQ_COLS - len) * 12) / 2);
        const y0 = 11 + ri * 18;
        for (const w of row) {
          const chars = Array.from(w.w.toUpperCase());
          const n = lit(w), sh = held(w);
          chars.forEach((ch, ci) => {
            const g = glyphBits(ch);
            for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) {
              const bx = x0 + ci * 12 + gx * 2, by = y0 + gy * 2;
              if (!g[gy]![gx]) continue;
              const on = ci < n;
              const dim = sh && (gx + gy * 2 + chase) % 4 === 0;
              if (!on) continue;
              c.fillStyle = dim ? '#C9A24A' : '#FFF3C4'; c.fillRect(bx, by, 2, 2);
              c.fillStyle = '#FFD24A'; c.fillRect(bx + 1, by + 1, 1, 1);
            }
          });
          x0 += (chars.length + 1) * 12;
        }
      });
    });
  }

  // ------------------------------------------------------------------ the choice menu
  private drawMenuPanel(t: number) {
    const T = this.T;
    const ws = this.L2.words;
    const open = windowOpen(t, T.l2, T.end + 1, 0.12);
    this.menu.open = open;
    if (open <= 0) return;
    this.menu.hang = { ref: T.l2 + 0.05, follow: 0.02, D: 0.7, x: -0.34, y: 0.08, frac: 0.62, yaw: 0.1, pitch: 0 };
    const cursor = t < ws[1]!.start ? -1 : t < T.apo + 0.05 ? 0 : this.cursorAt(t);
    this.menu.draw(drawMenu(null, ws, t, cursor, 0), (c) => drawMenu(c, ws, t, cursor, 0));
  }
  /** The cursor dithers: down to the apocalypse, back up on a kick, down again for good. */
  private cursorAt(t: number) {
    const T = this.T;
    const k = this.kicks.filter((x) => x > T.apo + 0.1 && x < T.end);
    if (k.length && t >= k[0]! && t < k[0]! + 0.18) return 0;
    return 1;
  }
}

