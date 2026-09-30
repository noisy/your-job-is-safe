// #17 breakdown [cut("Monday morning") → cut("And lately")]: half-time, uneasy.
//   The kanban board on DEV's wall: a new ticket (#4211) in TODO; every word of "Monday morning, new
//   ticket on the board," is a sticky note slapped on as sung; the estimate ("Two weeks," I estimated,
//   "maybe even more") goes up in DOING, DEV smug with his marker. He types the ticket into the
//   chatbot's prompt box (typed per character) "just to watch it choke", then goes for coffee (a
//   time-lapse: he's gone, the light flickers) while the chatbot opens pull request #4211 on his CRT;
//   the line types into its description, the tests tick green, MERGED. "Oh…": a grawlix bubble gets
//   autocorrected to "duck!", and the rubber duck on his desk turns and stares (push-in on its eye,
//   to black → bridge).
import * as THREE from 'three';
import type { Frame } from '../engine/scene';
import type { Line, Word } from '../engine/lyrics';
import { clamp, ease, lerp, hash } from '../engine/util';
import { Ps1Stage, typeWords, uiPortrait, windowOpen, type CamState, type V3 } from '../ps1/stage';
import { makeDev, makeRoom, type Dev, type Room } from '../ps1/cast';
import { psMat, canvasTex, pixText, psGlobals } from '../ps1/gfx';
import { P } from '../ps1/palette';
import { BOARD_W, BOARD_H, drawBoard, drawNote, noteW, makeCoffee, drawPrompt, drawPR, drawBubble } from './breakdown-props';

const BX = -4.95, BY = 1.7, BZ = -1.4, BW = 4.4, BH = BW * (BOARD_H / BOARD_W);
const TX = BW / BOARD_W; // world units per board texel
const NT = 0.0085; // world units per note texel
const COFFEE: V3 = [3.55, 0, -2.9];
const PR_W = 224, PR_H = 168;
const clean = (s: string) => s.replace(/["“”]/g, '');

type Note = { piv: THREE.Object3D; t: number; tilt: number };

export default class Breakdown extends Ps1Stage {
  private A!: Line; private B!: Line; private C!: Line; private D!: Line; private E!: Line;
  private db: number[] = [];
  private room!: Room; private dev!: Dev;
  private notes: Note[] = [];
  private ticket!: THREE.Object3D;
  private marker!: THREE.Mesh;
  private coffee!: ReturnType<typeof makeCoffee>;
  private prompt!: ReturnType<Ps1Stage['panel']>;
  private pr!: ReturnType<Ps1Stage['panel']>;
  private bubble!: ReturnType<Ps1Stage['panel']>;
  private duckHead = new THREE.Vector3(); private duckFace = new THREE.Vector3();
  private screenKey = '';

  override init() {
    const { lyrics: ly, audio: au, start, end } = this.ctx;
    this.A = ly.get('Monday morning'); this.B = ly.get('I estimated'); this.C = ly.get('Typed it in the prompt box');
    this.D = ly.get('Came back from my coffee'); this.E = ly.get('duck!');
    this.db = au.downbeats.filter((d) => d >= start - 0.02 && d <= end + 0.02);
    this.fogColor = P.fog; this.fogNear = 5; this.fogFar = 15;
    this.room = makeRoom(); this.world.add(this.room.root);
    this.dev = makeDev(); this.world.add(this.dev.root);
    this.marker = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.04), psMat({ color: P.fail }));
    this.marker.position.set(0, -0.62, 0.02); this.dev.armR.add(this.marker);

    // the board on the left wall
    const bt = canvasTex(BOARD_W, BOARD_H, (c) => drawBoard(c)).tex;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH, 4, 2), psMat({ map: bt }));
    board.position.set(BX, BY, BZ); board.rotation.y = Math.PI / 2; this.world.add(board);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.06, BH + 0.1, BW + 0.1), psMat({ color: '#5A6488' }));
    frame.position.set(BX - 0.04, BY, BZ); this.world.add(frame);
    // board texel (u, v) → world
    const at = (u: number, v: number): V3 => [BX + 0.015, BY + BH / 2 - v * TX, BZ + BW / 2 - u * TX];
    // the ticket
    const tk = canvasTex(80, 40, (c) => {
      c.fillStyle = '#FFFFFF'; c.fillRect(0, 0, 80, 40); c.fillStyle = P.uiNavy; c.fillRect(0, 0, 80, 11);
      pixText(c, 'TICKET #4211', 4, 2, P.uiLine); pixText(c, 'new feature', 4, 15, P.ink); pixText(c, 'est: ?', 4, 26, P.fail);
    }).tex;
    this.ticket = this.notePivot(tk, 80 * NT, 40 * NT, at(8, 26));
    // sticky notes: line A under the ticket in TODO, line B in DOING, flowed in rows
    const flow = (words: Word[], u0: number, u1: number, v0: number, col: string) => {
      let u = u0, v = v0;
      words.forEach((w, i) => {
        const s = clean(w.w), nw = noteW(s), wu = (nw * NT) / TX;
        if (u + wu > u1 && u > u0) { u = u0; v += (40 * NT) / TX + 3; }
        const tex = canvasTex(nw, 36, (c) => drawNote(c, nw, 36, s, col, w.gi)).tex;
        const p = at(u + wu / 2, v + (18 * NT) / TX);
        const piv = this.notePivot(tex, nw * NT, 36 * NT, p);
        this.notes.push({ piv, t: w.start, tilt: (hash(w.gi, 2) - 0.5) * 0.18 });
        u += wu + 3;
      });
    };
    flow(this.A.words, 6, 82, 50, '#F7E08A');
    flow(this.B.words, 90, 166, 26, '#F4B6C2');
    this.coffee = makeCoffee();
    this.coffee.root.position.set(...COFFEE); this.coffee.root.rotation.y = -0.7; this.world.add(this.coffee.root);
    // the prompt box, the PR on the CRT, the speech bubble
    this.prompt = this.panel(240, 70);
    this.prompt.hang = { ref: this.C.start + 0.1, x: 0, y: -0.42, frac: 0.64, pitch: -0.08, follow: 0.15 };
    this.pr = this.panel(PR_W, PR_H).inWorld();
    const s = this.room.screenPos;
    this.pr.mesh.position.set(s.x, s.y, s.z + 0.006);
    this.pr.mesh.scale.set(0.52, 0.39, 1);
    this.bubble = this.panel(150, 56);
    this.bubble.hang = { ref: (this.db[9] ?? this.E.start - 0.2) + 0.25, x: 0.32, y: 0.48, frac: 0.42, follow: 0.1 };
    // the duck's head (for the stare)
    const d = this.room.duck;
    this.duckHead.set(d.position.x, d.position.y + 0.125, d.position.z);
    this.duckFace.set(Math.sin(d.rotation.y), 0, Math.cos(d.rotation.y));
  }

  private notePivot(tex: THREE.Texture, w: number, h: number, p: V3) {
    const piv = new THREE.Object3D();
    piv.position.set(...p); piv.rotation.y = Math.PI / 2;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), psMat({ map: tex, side: THREE.DoubleSide }));
    piv.add(m); this.world.add(piv);
    return piv;
  }

  // ------------------------------------------------------------------ camera
  camAt(t: number): CamState {
    const [, d1, , d3, d4, , d6, , d8, d9] = this.db as number[];
    const A = this.A, B = this.B, C = this.C, D = this.D, E = this.E;
    // the ticket: a slow slide across it from its header down to "est: ?", pushing in on the downbeat
    const tp = this.ticket.position, su = ease.inOutQuad(clamp((t - this.ctx.start) / (A.start - 0.15 - this.ctx.start)));
    const tk = ease.outExpo(clamp((t - (d1! - 0.02)) / 0.3)) * 0.25;
    const tick: CamState = { P: [tp.x + 1.3 - tk - 0.35 * su, tp.y + 0.12 - 0.2 * su, tp.z + 0.35 - 0.3 * su], T: [tp.x, tp.y + 0.1 - 0.2 * su, tp.z + 0.1 - 0.18 * su], fov: 52, roll: 0.05 - 0.08 * su };
        const devB: CamState = { P: [-2.55, 1.55, -0.35], T: [-4.55, 1.7, -1.4], fov: 52, roll: 0.03 };
    const est: CamState = { P: [-3.25, 1.75, -0.95], T: [BX, 1.75, -1.4], fov: 52, roll: -0.03 };
    const desk: CamState = { P: [0.62, 1.45, -1.9], T: [-0.05, 1.12, -3.3], fov: 52 };
    const desk2: CamState = { P: [-0.62, 1.48, -1.95], T: [0.08, 1.1, -3.3], fov: 52, roll: 0.03 };
    const wide: CamState = { P: [1.95, 1.8, 0.35], T: [1.25, 1.0, -2.75], fov: 52 };
    const prC: CamState = { P: [0.04, 1.1, -2.64], T: [0, 1.08, -3.2], fov: 52 };
    const face: CamState = { P: [0.2, 1.32, -3.0], T: [0, 1.3, -2.44], fov: 52, roll: -0.04 };
    const dh = this.duckHead, df = this.duckFace;
    const duckC: CamState = { P: [dh.x + df.x * 0.42 + 0.05, dh.y + 0.05, dh.z + df.z * 0.42], T: [dh.x, dh.y + 0.005, dh.z], fov: 52 };
    const eye: CamState = { P: [dh.x + df.x * 0.06 - 0.02, dh.y + 0.012, dh.z + df.z * 0.06 + 0.012], T: [dh.x - 0.02, dh.y + 0.01, dh.z], fov: 52 };
    const go = (a: CamState, b: CamState, t0: number, dur: number, fn = ease.outExpo) => mixCam(a, b, fn(clamp((t - t0) / dur)));
    // the board: the camera follows the newest note (a slap, a settle)
    let c = tick;
    const on = this.notes.filter((n) => t >= n.t - 0.05);
    if (on.length) {
      const cur = on[on.length - 1]!, prev = on[on.length - 2];
      const noteCam = (n: Note): CamState => { const p = n.piv.position; return { P: [p.x + 1.85, p.y + 0.05, p.z + 0.2], T: [p.x, p.y - 0.05, p.z - 0.05], fov: 52, roll: n.tilt * 0.3 }; };
      c = mixCam(prev ? noteCam(prev) : tick, noteCam(cur), ease.outExpo(clamp((t - cur.t + 0.05) / 0.28)));
    }
    c = go(c, devB, d3!, 0.4);
    c = go(c, est, d4!, 0.35);
    c = go(c, desk, C.start - 0.22, 0.26);
    c = go(c, desk2, d6!, 0.4);
    c = go(c, wide, D.start - 0.1, 0.3);
    c = go(c, prC, d8!, 0.35);
    c = go(c, face, d9!, 0.2);
    c = go(c, duckC, E.words[1]!.start + 0.26, 0.16);
    c = go(c, eye, this.ctx.end - 0.22, 0.2, ease.inCubic);
    // uneasy: a slow sway everywhere, never quite still
    c.roll = (c.roll ?? 0) + 0.015 * Math.sin(t * 1.7);
    return c;
  }

  // ------------------------------------------------------------------ frame
  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    this.begin();
    const t = f.t;
    const [, , , d3, , , , , d8, d9] = this.db as number[];
    const B = this.B, C = this.C, D = this.D, E = this.E;
    // the notes slap on as sung
    for (const n of this.notes) {
      const u = t - n.t;
      n.piv.visible = u > -0.03;
      if (!n.piv.visible) continue;
      const s = 1 + 0.45 * (1 - ease.outExpo(clamp((u + 0.03) / 0.12)));
      n.piv.scale.setScalar(s);
      n.piv.children[0]!.rotation.z = n.tilt * (1 + 2 * (1 - clamp(u / 0.1)));
    }
    // DEV: at the board with his marker, at the desk typing, off for coffee (time-lapse), back, shocked
    const dev = this.dev;
    const atBoard = t < C.start - 0.2;
    const away0 = D.start, back0 = d8! - 0.38;
    if (atBoard) {
      dev.sit(false);
      const turn = t > d3! ? 1 : 0;
      dev.root.position.set(-4.05, 0, -1.55);
      dev.root.rotation.y = Math.PI / 2 - 0.95 * turn;
      dev.setFace(turn ? 'smug' : 'neutral');
      const write = t > B.start - 0.1 && t < B.end;
      // (the arm pivots hang down: a positive x rotation swings an arm forward, toward DEV's -z)
      dev.armR.rotation.set(2.1 + (write ? 0.15 * Math.sin(t * 22) : 0) - (turn ? 0.4 : 0), 0, -0.2);
      dev.armL.rotation.set(0, 0, 0.15);
      dev.head.rotation.y = turn ? 0.3 : 0;
    } else if (t < away0 || t >= d8!) {
      dev.sit(true);
      dev.root.position.copy(this.room.seat); dev.root.rotation.y = 0;
      const typing = t < D.start;
      const tap = typing ? Math.sin(t * 40) : 0;
      dev.armL.rotation.set(1.25 + 0.12 * tap, 0, 0.1); dev.armR.rotation.set(1.25 - 0.12 * tap, 0, -0.1);
      dev.head.rotation.y = 0;
      dev.setFace(t < D.start ? 'smug' : t < d9! ? 'neutral' : t < E.words[1]!.start + 0.1 ? 'shock' : 'scared');
      if (t >= d9!) { dev.armL.rotation.set(2.6, 0, 0.3); dev.armR.rotation.set(2.6, 0, -0.3); } // hands to his head
    } else {
      // coffee: out, a sip, back (fast: a time-lapse)
      dev.sit(false); dev.setFace('neutral');
      const seat = this.room.seat, cof = new THREE.Vector3(COFFEE[0] - 0.55, 0, COFFEE[2] + 0.45);
      const go = ease.inOutQuad(clamp((t - away0) / 0.35)), ret = ease.inOutQuad(clamp((t - back0) / 0.35));
      const k = go * (1 - ret);
      dev.root.position.set(lerp(seat.x, cof.x, k), 0, lerp(seat.z + 0.5, cof.z, k));
      dev.root.rotation.y = lerp(Math.PI / 2 + 0.3, -Math.PI / 2 - 0.2, go) * (1 - ret) + ret * 0;
      const walk = (go > 0 && go < 1) || (ret > 0 && ret < 1) ? Math.sin(t * 30) : 0;
      dev.legL.rotation.x = 0.5 * walk; dev.legR.rotation.x = -0.5 * walk;
      dev.armL.rotation.set(-0.5 * walk, 0, 0.1);
      dev.armR.rotation.set(go >= 1 && ret <= 0 ? 1.6 : 0.5 * walk, 0, -0.1); // the sip
    }
    this.marker.visible = atBoard;
    this.coffee.stream.visible = t > away0 + 0.3 && t < back0;
    // the time-lapse: the light flickers between day and night while he's away
    if (t > away0 + 0.2 && t < back0 + 0.2) {
      const fl = 0.5 + 0.5 * Math.sin(t * 34);
      psGlobals.uLightCol.value.setRGB(1.0 * (0.7 + 0.5 * fl), 0.86 * (0.7 + 0.5 * fl), 0.7 * (0.8 + 0.4 * fl));
      psGlobals.uAmb.value.setRGB(0.22 + 0.2 * fl, 0.25 + 0.2 * fl, 0.36 + 0.15 * fl);
    }
    // the duck turns to stare at him
    const turn = ease.outBack(clamp((t - (E.words[1]!.start + 0.22)) / 0.16));
    this.room.duck.rotation.y = -0.5 + 0.35 * turn;

    // prompt box
    this.prompt.open = windowOpen(t, C.start - 0.12, D.start - 0.05);
    if (this.prompt.open > 0) {
      const r = typeWords(null, C.words, t, 12, 18, { scale: 2, maxChars: 18, rowH: 16 });
      this.prompt.draw(r.key, (cx) => { drawPrompt(cx, 240, 70); typeWords(cx, C.words, t, 12, 18, { scale: 2, maxChars: 18, rowH: 16, key: (w) => /choke/i.test(w.w) }); });
    }
    // the PR the chatbot opens while he's away
    const prOn = t > D.start - 0.05;
    if (t < d8!) {
      this.pr.hang = { ref: D.start + 0.3, x: -0.36, y: 0.02, frac: 0.56, yaw: 0.18, follow: 0.1 };
      this.pr.open = windowOpen(t, D.start - 0.05, d8! + 1);
      this.pr.inWorld(false); // floating in front of the camera: the UI layer
    } else {
      this.pr.hang = null; this.pr.open = 1;
      const sp = this.room.screenPos;
      this.pr.mesh.position.set(sp.x, sp.y, sp.z + 0.006); this.pr.mesh.quaternion.identity(); this.pr.mesh.scale.set(0.52, 0.39, 1);
      this.pr.inWorld(true); // back on the CRT: part of the set
    }
    this.pr.mesh.visible = prOn;
    if (prOn) {
      const tests = clamp(Math.floor((t - away0 - 0.6) / 0.22), 0, 5);
      const merged = t >= d8! + 0.1;
      const lines = clamp(Math.floor((t - away0) * 12), 0, 24);
      const r = typeWords(null, D.words, t, 6, 24, { scale: 2, maxChars: 17, rowH: 17 });
      this.pr.draw(`${r.key}|${tests}|${merged}|${lines}|${merged ? 0 : Math.floor(t * 4) % 3}`, (cx) => {
        drawPR(cx, PR_W, PR_H, { tests, merged, lines, t });
        typeWords(cx, D.words, t, 6, 24, { scale: 2, maxChars: 17, rowH: 17, color: P.ink, shadow: '#D0D6E2', key: (w) => /masterstroke/i.test(w.w), keyColor: '#2E9E4E' });
      });
    }
    // Oh… duck!
    this.bubble.open = windowOpen(t, E.start - 0.02, E.words[1]!.start + 0.3);
    if (this.bubble.open > 0) {
      const g = clamp(Math.floor(((t - E.start) / 0.2) * 6) + 1, 0, 6);
      const duck = t >= E.words[1]!.start ? clamp((t - E.words[1]!.start) / 0.2) : 0;
      this.bubble.draw(`${g}|${Math.round(duck * 10)}`, (cx) => drawBubble(cx, 150, 56, { grawlix: g, duck }));
    }
    this.drawScreen(t);
    if (t >= d9! && t - d9! < 0.1) this.shake(0.03);
    // the duck's eye goes to black
    const fade = clamp((t - (this.ctx.end - 0.14)) / 0.12);
    return this.present(f, out, { fade });
  }

  private drawScreen(t: number) {
    const k = t < this.C.start - 0.2 ? 'code' : 'bot';
    if (k === this.screenKey) return;
    this.screenKey = k;
    const c = this.room.screen.ctx;
    c.fillStyle = '#10162A'; c.fillRect(0, 0, 128, 96);
    if (k === 'code') { pixText(c, 'TICKET #4211', 6, 6, P.uiDim); pixText(c, '// todo: 2 weeks', 6, 20, P.uiDim); }
    else { uiPortrait(c, 50, 22, 'bot', 'v5.0'); pixText(c, 'ask me anything', 64 - 45, 62, P.bot); }
    this.room.screen.tex.needsUpdate = true;
  }
}

function mixCam(a: CamState, b: CamState, k: number): CamState {
  const m = (x: V3, y: V3): V3 => [lerp(x[0], y[0], k), lerp(x[1], y[1], k), lerp(x[2], y[2], k)];
  return { P: m(a.P, b.P), T: m(a.T, b.T), roll: lerp(a.roll ?? 0, b.roll ?? 0, k), fov: lerp(a.fov ?? 52, b.fov ?? 52, k) };
}
