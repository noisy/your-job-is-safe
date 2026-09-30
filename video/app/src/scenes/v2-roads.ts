// Verse 2, scene 11: "(…and that's) all I'm gonna say. / Drive-thru bot ignored my "stop!" - nuggets
// pouring down like rain, / Took a Waymo to my flight - it circled…". Out of the black of the censor
// block: the black grille of a drive-thru speaker whose post wears the chatbot's CRT face. DEV in his car
// yells STOP; the order counter climbs to 260 NUGGETS and nuggets rain from the sky. A whip up into the
// sky and down onto a parking-lot roundabout: a robotaxi (a generic white car with a roof sensor dome)
// lapping it with DEV in the back checking his watch, a plane circling overhead in a holding pattern; the
// camera cranes up to a top-down map of the ring (the next scene's scroll wheel).
// Lyric idioms: line 1 (and the censored tail) scrolls on the drive-thru's LED dot-matrix menu board;
// line 2 flips in letter by letter on an airport split-flap departures board.
import * as THREE from 'three';
import type { Frame } from '../engine/scene';
import type { Line, Word } from '../engine/lyrics';
import { clamp, lerp, ease, prog, pulse, hash, frameIdx } from '../engine/util';
import { Ps1Stage, type CamState, type V3, windowOpen } from '../ps1/stage';
import { makeBotHead, makeDev, type BotHead, type Dev } from '../ps1/cast';
import { psMat, psGlobals, canvasTex, pixText, rng, shade } from '../ps1/gfx';
import { P } from '../ps1/palette';
import { caption, glyphBits } from './v2-stage-set';

const box = (w: number, h: number, d: number, m: THREE.Material | THREE.Material[]) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const mix3 = (a: V3, b: V3, u: number): V3 => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
/** The roundabout is far from the drive-thru (the whip through the sky joins them). */
const RX = 80;
const LED_W = 208, LED_H = 60, LED_COLS = 17;
const FLAP_W = 252, FLAP_H = 92;
const RING_R = 2.5;
const NUGGETS = 220;

export default class V2Roads extends Ps1Stage {
  L4!: Line; L5!: Line; L6!: Line;
  T: Record<string, number> = {};
  kicks: number[] = [];
  beats: number[] = [];
  bot!: BotHead;
  dev!: Dev;
  car = new THREE.Group();
  taxi = new THREE.Group();
  taxiDome!: THREE.Mesh;
  rider!: Dev;
  plane = new THREE.Group();
  nuggets: THREE.Mesh[] = [];
  led = this.panel(LED_W, LED_H);
  flap = this.panel(FLAP_W, FLAP_H);
  stop!: { root: THREE.Group; letters: THREE.Object3D[]; width: number };
  capNug!: THREE.Mesh;
  capTaxi!: THREE.Mesh;
  lap!: { mesh: THREE.Mesh; draw: (n: number) => void };

  override fogFar = 24;
  override fogNear = 7;

  override async init() {
    const { lyrics: ly, audio: au, start, end } = this.ctx;
    this.L4 = ly.get('Grew a funny little mustache', 0);
    this.L5 = ly.get('Drive-thru bot ignored', 0);
    this.L6 = ly.get('Took a Waymo', 0);
    const db = au.downbeats.filter((d) => d >= start - 0.02 && d <= end + 0.02);
    const T = this.T;
    T.d0 = start; T.d1 = db[1] ?? start + 1.39; T.d2 = db[2] ?? start + 2.78; T.d3 = db[3] ?? start + 4.17; T.end = end;
    const w5 = this.L5.words, w6 = this.L6.words;
    T.l5 = w5[0]!.start; T.ignored = w5[2]!.start; T.stop = w5[4]!.start; T.stopEnd = w5[4]!.end; T.nug = w5[5]!.start; T.rainEnd = w5[9]!.end;
    T.l6 = w6[0]!.start; T.flight = w6[5]!.start; T.flightEnd = w6[5]!.end; T.it = w6[6]!.start;
    this.kicks = au.events('kick', start - 0.5, end + 0.5).map((k) => k[0]);
    this.beats = au.beats.filter((b) => b >= start - 0.5 && b <= end + 0.5);
    this.buildDriveThru();
    this.buildRoundabout();
    this.stop = this.blockTitle('STOP!', { cap: P.fail, side: P.failSide, depth: 0.4 });
    this.stop.root.scale.setScalar(0.42);
    // (lit from the speaker side it would sit in shadow: give the letters their own glow)
    this.stop.root.traverse((o) => { const m = (o as THREE.Mesh).material; if (Array.isArray(m)) ((m[0] as THREE.RawShaderMaterial).uniforms.uEmit!.value as THREE.Color).set('#6A1420'); });
    this.capNug = caption(this, ["McDonald's AI drive-thru test,", 'TikTok 2024: 260 nuggets.', 'Test ended June 2024.'], 1 / 30);
    this.capNug.position.set(2.2, 2.95, -0.4);
    this.capTaxi = caption(this, ['robotaxi, Dec 2024:', '8 laps of a parking-lot', 'roundabout'], 1 / 42);
    this.capTaxi.position.set(RX + 1.1, 0.6, 3.9);
    // the LED board lives on its posts (in the world); the split-flap board hangs in the shot
    this.led.inWorld(true);
    this.led.mesh.position.set(1.35, 1.55, -0.18);
    this.led.mesh.scale.set(3.6, 3.6 * (LED_H / LED_W), 1);
  }

  // ------------------------------------------------------------------ the drive-thru
  private buildDriveThru() {
    const R = rng(44);
    const w = this.world;
    // asphalt, a kerb, the restaurant wall behind (generic, no brand)
    const asphalt = canvasTex(32, 32, (c) => { for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { c.fillStyle = shade('#2B2E38', 0.85 + R() * 0.25); c.fillRect(x, y, 1, 1); } }, true).tex;
    const g = new THREE.PlaneGeometry(30, 20, 6, 4);
    const uv = g.attributes.uv!; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 15, uv.getY(i) * 10);
    const ground = new THREE.Mesh(g, psMat({ map: asphalt })); ground.rotation.x = -Math.PI / 2; ground.position.set(0, 0, 2); w.add(ground);
    const lane = psMat({ color: '#E8C24A' });
    for (let i = 0; i < 8; i++) { const l = box(0.9, 0.01, 0.1, lane); l.position.set(-6 + i * 1.8, 0.01, 3.4); w.add(l); }
    const kerb = box(14, 0.18, 0.5, psMat({ color: '#8A8578' })); kerb.position.set(0, 0.09, -0.8); w.add(kerb);
    const brick = canvasTex(32, 32, (c) => {
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { c.fillStyle = shade('#7A3A2A', 0.85 + R() * 0.2); c.fillRect(x, y, 1, 1); }
      c.fillStyle = '#4A2418'; for (let y = 0; y < 32; y += 4) { c.fillRect(0, y, 32, 1); for (let x = (y >> 2) % 2 ? 4 : 0; x < 32; x += 8) c.fillRect(x, y, 1, 4); }
    }, true).tex;
    const wg = new THREE.PlaneGeometry(14, 4, 4, 2);
    const wuv = wg.attributes.uv!; for (let i = 0; i < wuv.count; i++) wuv.setXY(i, wuv.getX(i) * 7, wuv.getY(i) * 2);
    const wall = new THREE.Mesh(wg, psMat({ map: brick })); wall.position.set(0, 2, -2.6); w.add(wall);
    const awn = box(14, 0.3, 1.2, psMat({ color: '#D9482B' })); awn.position.set(0, 3.6, -2.1); w.add(awn);
    // the speaker post: a box with a black grille, the chatbot's CRT head on top
    const postM = psMat({ color: '#5A6070' });
    const post = box(0.16, 1.0, 0.16, postM); post.position.set(-0.8, 0.5, 0); w.add(post);
    const grille = canvasTex(24, 32, (c) => {
      c.fillStyle = '#0A0A0E'; c.fillRect(0, 0, 24, 32);
      c.fillStyle = '#1A1C24'; for (let y = 1; y < 32; y += 3) for (let x = (y % 2) + 1; x < 24; x += 3) c.fillRect(x, y, 1, 1);
    }).tex;
    const spk = box(0.72, 0.92, 0.34, [postM, postM, postM, postM, psMat({ map: grille }), postM]);
    spk.position.set(-0.8, 1.35, 0); w.add(spk);
    this.bot = makeBotHead('v2.0');
    this.bot.root.position.set(-0.8, 1.81, 0);
    w.add(this.bot.root);
    // the LED menu board's frame and legs
    const frameM = psMat({ color: '#2A2D38' });
    const fr = box(3.8, 1.2, 0.12, frameM); fr.position.set(1.35, 1.55, -0.26); w.add(fr);
    for (const x of [0.0, 2.7]) { const l = box(0.12, 1.0, 0.12, frameM); l.position.set(x, 0.5, -0.26); w.add(l); }
    const menuTop = canvasTex(96, 12, (c) => { c.fillStyle = '#D9482B'; c.fillRect(0, 0, 96, 12); pixText(c, 'ORDER HERE', 18, 3, '#FFD23F'); });
    const mt = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.28), psMat({ map: menuTop.tex, unlit: true, fog: 0.3 })); mt.position.set(1.35, 2.3, -0.2); w.add(mt);
    // DEV's car: a dull maroon hatchback, driver's window open towards the speaker
    const body = psMat({ color: '#7A2E2E' }), glass = psMat({ color: '#1A2440', opacity: 0.55, unlit: true }), tyre = psMat({ color: '#15151C' });
    const lower = box(3.2, 0.62, 1.5, body); lower.position.y = 0.55; this.car.add(lower);
    // the cabin: a roof on pillars, windscreens front and back, the side windows rolled down
    const roof = box(1.9, 0.1, 1.36, body); roof.position.set(-0.25, 1.4, 0); this.car.add(roof);
    for (const [x, z] of [[-1.15, 0.62], [0.65, 0.62], [-1.15, -0.62], [0.65, -0.62]] as [number, number][]) { const pl = box(0.1, 0.5, 0.1, body); pl.position.set(x, 1.12, z); this.car.add(pl); }
    for (const x of [-1.17, 0.67]) { const ws = box(0.04, 0.46, 1.2, glass); ws.position.set(x, 1.12, 0); this.car.add(ws); }
    for (const [x, z] of [[-1.05, 0.72], [1.05, 0.72], [-1.05, -0.72], [1.05, -0.72]] as [number, number][]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.22, 8), tyre); wh.rotation.x = Math.PI / 2; wh.position.set(x, 0.3, z); this.car.add(wh); }
    const lights = psMat({ color: '#FFF3C4', unlit: true });
    for (const z of [-0.5, 0.5]) { const h = box(0.05, 0.14, 0.3, lights); h.position.set(1.61, 0.65, z); this.car.add(h); }
    this.dev = makeDev();
    this.dev.sit(true);
    this.dev.root.scale.setScalar(0.85);
    this.dev.root.position.set(-0.35, 0.2, -0.25);
    this.dev.root.rotation.y = -Math.PI / 2;
    this.car.add(this.dev.root);
    this.car.position.set(-0.6, 0, 1.6);
    w.add(this.car);
    // the nuggets: golden-brown lumps, a deterministic rain
    const nugT = canvasTex(8, 8, (c) => { for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { c.fillStyle = shade('#C98A3A', 0.8 + R() * 0.35); c.fillRect(x, y, 1, 1); } }).tex;
    const nugM = psMat({ map: nugT });
    for (let i = 0; i < NUGGETS; i++) {
      const n = new THREE.Mesh(new THREE.BoxGeometry(0.22 + hash(i, 1) * 0.08, 0.13, 0.16 + hash(i, 2) * 0.06), nugM);
      n.visible = false; w.add(n); this.nuggets.push(n);
    }
  }

  // ------------------------------------------------------------------ the roundabout
  private buildRoundabout() {
    const R = rng(55);
    const w = this.world;
    const lot = canvasTex(64, 64, (c) => {
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { c.fillStyle = shade('#343844', 0.85 + R() * 0.2); c.fillRect(x, y, 1, 1); }
      c.fillStyle = '#D8D4C8'; for (let x = 0; x < 64; x += 8) c.fillRect(x, 0, 1, 14);
    }, true).tex;
    const g = new THREE.PlaneGeometry(40, 40, 8, 8);
    const uv = g.attributes.uv!; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 8, uv.getY(i) * 8);
    const ground = new THREE.Mesh(g, psMat({ map: lot })); ground.rotation.x = -Math.PI / 2; ground.position.set(RX, 0, 0); w.add(ground);
    // the ring road with a dashed centre line
    const road = canvasTex(64, 8, (c) => { c.fillStyle = '#24262E'; c.fillRect(0, 0, 64, 8); c.fillStyle = '#E8E4D8'; for (let x = 0; x < 64; x += 8) c.fillRect(x, 3, 4, 1); c.fillStyle = '#E8C24A'; c.fillRect(0, 0, 64, 1); c.fillRect(0, 7, 64, 1); }, true).tex;
    const rg = new THREE.RingGeometry(1.7, 3.3, 32, 1);
    const rp = rg.attributes.position!, ruv = rg.attributes.uv!;
    for (let i = 0; i < ruv.count; i++) { const a = Math.atan2(rp.getY(i), rp.getX(i)); ruv.setXY(i, (a / (Math.PI * 2) + 0.5) * 12, Math.hypot(rp.getX(i), rp.getY(i)) > 2.5 ? 1 : 0); }
    const ring = new THREE.Mesh(rg, psMat({ map: road })); ring.rotation.x = -Math.PI / 2; ring.position.set(RX, 0.01, 0); w.add(ring);
    // the island: grass, a kerb, a little tree and the airport sign
    const island = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.18, 16), psMat({ color: '#3F7A3A' })); island.position.set(RX, 0.09, 0); w.add(island);
    const kerb = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.08, 3, 16), psMat({ color: '#C9C4B6' })); kerb.rotation.x = Math.PI / 2; kerb.position.set(RX, 0.12, 0); w.add(kerb);
    const trunk = box(0.14, 0.9, 0.14, psMat({ color: '#6B4A2E' })); trunk.position.set(RX + 0.5, 0.6, -0.4); w.add(trunk);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), psMat({ color: '#2F6A34' })); crown.position.set(RX + 0.5, 1.35, -0.4); w.add(crown);
    const signT = canvasTex(64, 16, (c) => { c.fillStyle = '#2E4A8C'; c.fillRect(0, 0, 64, 16); c.fillStyle = '#E8E4D8'; c.fillRect(1, 1, 62, 1); pixText(c, 'AIRPORT', 4, 5, '#E8E4D8'); pixText(c, '→', 50, 5, '#FFD23F'); });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.28), psMat({ map: signT.tex, unlit: true, fog: 0.3, side: THREE.DoubleSide })); sign.position.set(RX - 0.4, 1.0, 0.3); w.add(sign);
    const sp = box(0.05, 0.9, 0.05, psMat({ color: '#8A8F9E' })); sp.position.set(RX - 0.4, 0.5, 0.28); w.add(sp);
    // the robotaxi: a white car with a spinning roof sensor dome, DEV in the back
    const white = psMat({ color: '#E8E6E0' }), glass = psMat({ color: '#1A2440', opacity: 0.5, unlit: true }), tyre = psMat({ color: '#15151C' });
    const lower = box(1.8, 0.45, 0.9, white); lower.position.y = 0.38; this.taxi.add(lower);
    const cab = box(1.05, 0.38, 0.84, white); cab.position.set(-0.1, 0.78, 0); this.taxi.add(cab);
    const win = box(0.95, 0.3, 0.86, glass); win.position.set(-0.1, 0.8, 0); this.taxi.add(win);
    this.taxiDome = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.18, 6), psMat({ color: '#3A3F4E' })); this.taxiDome.position.set(-0.1, 1.06, 0); this.taxi.add(this.taxiDome);
    const stripe = box(1.82, 0.05, 0.92, psMat({ color: '#2E4A8C' })); stripe.position.y = 0.45; this.taxi.add(stripe);
    for (const [x, z] of [[-0.6, 0.45], [0.6, 0.45], [-0.6, -0.45], [0.6, -0.45]] as [number, number][]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.14, 8), tyre); wh.rotation.x = Math.PI / 2; wh.position.set(x, 0.18, z); this.taxi.add(wh); }
    this.rider = makeDev();
    this.rider.sit(true);
    this.rider.root.scale.setScalar(0.5);
    this.rider.root.position.set(-0.35, 0.28, 0);
    this.rider.root.rotation.y = -Math.PI / 2;
    this.taxi.add(this.rider.root);
    w.add(this.taxi);
    // the lap counter floating over the taxi
    const lapC = canvasTex(40, 12, () => {});
    const lapM = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.27), psMat({ map: lapC.tex, unlit: true, fog: 0.2, side: THREE.DoubleSide }));
    lapM.renderOrder = 6; w.add(lapM); this.billboards.push(lapM);
    let lastLap = -1;
    this.lap = {
      mesh: lapM,
      draw: (n) => {
        if (n === lastLap) return; lastLap = n;
        const c = lapC.ctx; c.clearRect(0, 0, 40, 12);
        c.fillStyle = P.uiEdge; c.fillRect(0, 0, 40, 12); c.fillStyle = '#16204A'; c.fillRect(1, 1, 38, 10);
        pixText(c, `LAP ${n}`, 4, 3, n >= 8 ? P.fail : P.key2);
        lapC.tex.needsUpdate = true;
      },
    };
    // the plane: a little airliner in a holding pattern high above
    const pm = psMat({ color: '#D8DCE4' }), pd = psMat({ color: '#2E4A8C' });
    const fus = box(2.4, 0.34, 0.34, pm); this.plane.add(fus);
    const wing = box(0.5, 0.06, 2.8, pm); wing.position.x = 0.1; this.plane.add(wing);
    const tail = box(0.3, 0.5, 0.06, pd); tail.position.set(-1.05, 0.3, 0); this.plane.add(tail);
    const stab = box(0.25, 0.05, 0.9, pm); stab.position.set(-1.05, 0.05, 0); this.plane.add(stab);
    const nose = box(0.2, 0.2, 0.2, pd); nose.position.x = 1.25; this.plane.add(nose);
    w.add(this.plane);
  }

  /** The robotaxi's angle on the ring (it laps at a steady clip; lap 6 when we arrive, lap 8 by the end). */
  private taxiAngle(t: number) {
    const T = this.T;
    const lapT = (T.end - (T.l6 - 0.2)) / 2.4;
    return { a: ((t - (T.l6 - 0.2)) / lapT) * Math.PI * 2, lap: 6 + Math.floor(Math.max(0, t - (T.l6 - 0.2)) / lapT) };
  }

  // ------------------------------------------------------------------ camera
  camAt(t: number): CamState {
    const T = this.T;
    if (t < T.d1) {
      // out of the black: pressed against the speaker grille, pulling back to the post and the LED board
      const u = prog(t, T.d0, T.d0 + 0.75, ease.inOutCubic);
      const d = prog(t, T.d0 + 0.75, T.d1, ease.inOutQuad);
      const P0: V3 = [-0.8, 1.33, 0.36], P1: V3 = [0.9, 1.55, 3.4], P2: V3 = [1.3, 1.6, 3.2];
      return { P: d > 0 ? mix3(P1, P2, d) : mix3(P0, P1, u), T: d > 0 ? [lerp(0.55, 0.85, d), 1.45, -0.2] : mix3([-0.8, 1.33, 0], [0.55, 1.45, -0.2], u), roll: 0.03 * d, fov: 52 };
    }
    if (t < T.stop - 0.12) {
      // downbeat: over DEV's shoulder, out of the car window at the speaker and the board
      const u = prog(t, T.d1, T.stop - 0.12, ease.linear);
      return { P: [lerp(-0.9, -0.6, u), 2.0, 2.6], T: [lerp(0.9, 1.1, u), 1.45, -0.2], roll: -0.02, fov: 54 };
    }
    if (t < T.nug - 0.08) {
      // STOP!: the reverse angle from the speaker's face, DEV yelling out of the window
      const k = prog(t, T.stop - 0.12, T.stop + 0.06, ease.outExpo);
      return { P: [-0.25, 1.12, 0.25], T: [lerp(-0.85, -0.95, k), 1.25, 1.45], roll: 0.06 * k, fov: lerp(58, 50, k) };
    }
    if (t < T.l6 - 0.3) {
      // the rain: back over the car roof on the board, then crane up and wide into the downpour
      const u = prog(t, T.nug - 0.08, T.d2, ease.outCubic);
      const c = prog(t, T.d2, T.l6 - 0.3, ease.inOutQuad);
      const P0: V3 = [0.4, 2.0, 3.8], P1: V3 = [2.2, 3.3, 5.4];
      return { P: mix3(mix3([-0.6, 2.0, 2.6], P0, u), P1, c), T: mix3([0.9, 1.5, -0.2], [0.9, 1.4, -0.4], c), roll: lerp(0, -0.06, c), fov: lerp(54, 58, c) };
    }
    if (t < T.d3) {
      // whip up into the sky, across to the roundabout, down onto the robotaxi (lands on the downbeat)
      const u = prog(t, T.l6 - 0.3, T.d3, ease.inOutCubic);
      const up = Math.sin(u * Math.PI);
      const Pa: V3 = [2.2, 3.3, 5.4], Pb: V3 = [RX + 1.5, 2.6, 7.2];
      const P = u < 0.5 ? Pa : Pb;
      const Ta: V3 = [0.9, 1.4, -0.4], Tb: V3 = [RX, 0.6, 0];
      const base = u < 0.5 ? Ta : Tb;
      return { P, T: [base[0] + (P[0] - base[0]) * 0.2 * up, lerp(base[1], P[1] + 6, up), base[2] + (P[2] - base[2]) * 0.2 * up], roll: 0.1 * up, fov: 56 };
    }
    // the roundabout: orbit the lapping taxi, then crane up to the top-down map of the ring
    const o = prog(t, T.d3, T.it - 0.15, ease.linear);
    const up = prog(t, T.it - 0.15, T.end, ease.inOutCubic);
    const a = lerp(0.2, -0.5, o);
    const Po: V3 = [RX + Math.sin(a) * 7.4, 2.6, Math.cos(a) * 7.4];
    const Pt: V3 = [RX + 0.0, 11.5, 0.02];
    return { P: mix3(Po, Pt, up), T: mix3([RX, 0.6, 0], [RX, 0, 0], up), roll: 0, fov: lerp(52, 46, up) };
  }

  // ------------------------------------------------------------------ frame
  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, T = this.T;
    this.begin();
    // night lot: a sodium-orange key
    psGlobals.uLightCol.value.setRGB(1.05, 0.82, 0.58);
    psGlobals.uAmb.value.setRGB(0.26, 0.27, 0.4);
    // --- the drive-thru
    const bot = this.bot;
    const talking = t >= T.ignored && t < T.rainEnd;
    bot.setFace(t < T.ignored ? 'neutral' : talking ? 'talk' : 'happy', Math.floor(t * 9));
    const dev = this.dev;
    dev.setFace(t < T.stop - 0.2 ? 'neutral' : t < T.nug ? 'yell' : t < T.rainEnd ? 'shock' : 'sad');
    // DEV leans out of the window to yell, arm waving
    const lean = prog(t, T.stop - 0.25, T.stop, ease.outBack) * (1 - prog(t, T.nug + 0.2, T.nug + 0.5));
    dev.torso.rotation.y = 1.0 * lean;
    dev.armL.rotation.x = -2.2 * lean + 0.4 * Math.sin(t * 20) * lean;
    // STOP! bursts out of the window towards the speaker on the word
    const sw = prog(t, T.stop, T.stop + 0.14, ease.outBack);
    this.stop.root.visible = t >= T.stop && t < T.nug - 0.08;
    this.stop.root.position.set(lerp(-0.9, -0.56, sw), lerp(1.25, 1.3, sw), lerp(1.3, 0.8, sw));
    this.stop.root.rotation.set(0, 2.6, 0.08 * Math.sin(t * 30));
    this.stop.root.scale.setScalar(0.03 + 0.08 * sw);
    // the rain: nuggets from "nuggets", spawning faster and faster, piling up
    const rain0 = T.nug - 0.1, rain1 = T.l6;
    this.nuggets.forEach((n, i) => {
      const u = i / NUGGETS;
      const ts = rain0 + (rain1 - rain0) * Math.sqrt(u);
      const x = -3.2 + hash(i, 3) * 7, z = -0.6 + hash(i, 4) * 4.5;
      const fall = t - ts;
      n.visible = t < T.l6 + 0.2 && fall > 0;
      if (!n.visible) return;
      const onCar = x > -2.2 && x < 1.0 && z > 0.7 && z < 2.2;
      const floorY = onCar ? (x > -1.2 && x < 0.7 ? 1.42 : 0.9) : 0.05;
      const y = Math.max(floorY + hash(i, 5) * 0.08, 7 - 9.8 * 0.5 * fall * fall);
      n.position.set(x, y, z);
      n.rotation.set(fall * 6 * (y > floorY + 0.1 ? 1 : 0) + i, i * 0.7, 0);
    });
    this.capNug.visible = t > T.d2 + 0.1 && t < T.l6 - 0.3;
    this.drawLed(t);
    // --- the roundabout
    const ta = this.taxiAngle(t);
    this.taxi.position.set(RX + Math.cos(ta.a) * RING_R, 0, -Math.sin(ta.a) * RING_R);
    this.taxi.rotation.y = ta.a + Math.PI / 2;
    this.taxi.rotation.z = 0.05;
    this.taxiDome.rotation.y = t * 12;
    this.rider.setFace(t < T.flightEnd ? 'neutral' : 'sad');
    // checking his watch, again
    const watch = 0.5 + 0.5 * Math.sin((t - T.l6) * 5);
    this.rider.armL.rotation.x = -1.4 - 0.3 * watch;
    this.rider.head.rotation.x = 0.35 * watch;
    this.lap.mesh.position.set(this.taxi.position.x, 1.75, this.taxi.position.z);
    this.lap.mesh.visible = t >= T.d3 - 0.2;
    this.lap.draw(Math.min(8, ta.lap));
    const pa = (t - T.l6) * 1.6;
    this.plane.position.set(RX + Math.cos(pa) * 6.5, 6.5, -Math.sin(pa) * 6.5 - 1);
    this.plane.rotation.order = 'YXZ';
    this.plane.rotation.set(0.35, pa + Math.PI / 2, 0);
    this.capTaxi.visible = t >= T.d3 && t < T.it - 0.1;
    this.drawFlap(t);
    const kick = this.kicks.reduce((v, k) => Math.max(v, pulse(t, k, 0.06)), 0);
    this.shake(0.025 * kick + 0.1 * pulse(t, T.stop, 0.08));
    return this.present(f, out);
  }

  // ------------------------------------------------------------------ the LED menu board
  private drawLed(t: number) {
    const T = this.T;
    // row 1: the words scroll in from the right as they are sung (the censored tail first); row 2: the order
    const tail = this.L4.words.slice(7);
    const words = [...tail, ...this.L5.words].filter((w) => t >= w.start);
    const text = words.map((w) => w.w.replace(/[“”"]/g, '').toUpperCase());
    const cur = words[words.length - 1];
    // scroll: the latest word's right edge sits at the right margin, sliding in over its first 0.12 s
    const lens = text.map((s) => Array.from(s).length);
    const total = lens.reduce((a, b) => a + b + 1, 0) - 1;
    const slide = cur ? 1 - ease.outCubic(clamp((t - cur.start) / 0.12)) : 0;
    const off = Math.max(0, total - LED_COLS) - (cur ? slide * (lens[lens.length - 1]! + 1) : 0);
    const count = this.orderCount(t);
    const blink = Math.floor(t * 8) % 2;
    const key = `${words.length}|${Math.round(off * 12)}|${count}|${count >= 260 ? blink : 0}`;
    this.led.draw(key, (c) => {
      c.fillStyle = '#0B0806'; c.fillRect(0, 0, LED_W, LED_H);
      const line = text.join(' ');
      const dot = (x: number, y: number, on: boolean, col: string) => { c.fillStyle = on ? col : '#231811'; c.fillRect(x, y, 1, 1); };
      // row 1: 2 texels per dot, amber
      const chars = Array.from(line);
      for (let ci = 0; ci < chars.length; ci++) {
        const cx = 4 + Math.round((ci - off) * 12);
        if (cx < -12 || cx > LED_W) continue;
        const g = glyphBits(chars[ci]!);
        for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) if (cx + gx * 2 >= 2 && cx + gx * 2 < LED_W - 2) { const on = g[gy]![gx]!; dot(cx + gx * 2, 6 + gy * 2, on, '#FFB338'); if (on) dot(cx + gx * 2 + 1, 6 + gy * 2, true, '#C27A1E'); }
      }
      // row 2: the order counter, red, climbing
      const ord = `NUGGETS x ${String(count).padStart(3, ' ')}`;
      const on2 = count < 260 || blink === 1;
      Array.from(ord).forEach((ch, ci) => {
        const g = glyphBits(ch);
        for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) { const on = g[gy]![gx]! && on2; dot(4 + ci * 12 + gx * 2, 34 + gy * 2, on, count >= 260 ? '#FF4B5C' : '#FF7A3A'); if (on) dot(5 + ci * 12 + gx * 2, 34 + gy * 2, true, '#9A2A1E'); }
      });
      c.fillStyle = '#3A2A1A'; c.fillRect(0, 30, LED_W, 1);
    });
  }
  /** The order counter: starts at 1 when the bot ignores him, climbs on every beat, 260 by "rain". */
  private orderCount(t: number) {
    const T = this.T;
    if (t < T.ignored) return 0;
    const u = clamp((t - T.ignored) / (T.rainEnd - 0.05 - T.ignored));
    const steps = this.beats.filter((b) => b > T.ignored && b <= t).length;
    const smooth = Math.round(260 * u * u);
    return Math.max(1, Math.min(260, Math.round(smooth / 10) * 10 || steps));
  }

  // ------------------------------------------------------------------ the split-flap departures board
  private drawFlap(t: number) {
    const T = this.T;
    const open = windowOpen(t, T.l6 - 0.05, T.end + 0.2, 0.1);
    const up = prog(t, T.it - 0.15, T.end, ease.inOutCubic);
    this.flap.open = open;
    if (open <= 0) return;
    // hang in front of the shot: during the whip it rides along (follow), then it settles on the roundabout
    this.flap.hang = t < T.d3 ? { ref: T.l6, follow: 0.03, D: 0.9, x: 0, y: 0.35, frac: 0.7, yaw: 0, pitch: 0.1 } : { ref: T.d3 + 0.02, follow: 0.01, D: 0.9, x: 0.02, y: lerp(0.42, 0.95, up), frac: lerp(0.7, 0.6, up), yaw: -0.08, pitch: 0.12 };
    const w6 = this.L6.words;
    const rows: Word[][] = [w6.slice(0, 3), w6.slice(3, 6), w6.slice(6, 8)];
    const fi = frameIdx(t);
    const status = t >= T.flightEnd - 0.05 ? (Math.floor(t * 6) % 2 ? 'DELAYED' : '       ') : t >= T.flight ? 'BOARDING' : '';
    // per char: landed, flipping (a random letter) or blank
    const cells: string[] = [];
    const rowText = rows.map((r) => {
      let s = '';
      const out: { ch: string; st: 0 | 1 | 2 }[] = [];
      r.forEach((w, wi) => {
        const txt = w.w.replace(/[“”"!,.]/g, '').toUpperCase();
        const n = Array.from(txt).length, dur = Math.min(0.22, (w.end - w.start) * 0.9);
        Array.from(txt).forEach((ch, i) => {
          const land = w.start + ((i + 1) / n) * dur;
          const st = t >= land ? 2 : t >= w.start ? 1 : 0;
          out.push({ ch: st === 1 ? String.fromCharCode(65 + Math.floor(hash(fi, i, wi) * 26)) : ch, st });
        });
        if (wi < r.length - 1) out.push({ ch: ' ', st: 0 });
        s += txt;
      });
      cells.push(out.map((o) => o.st + o.ch).join(''));
      return out;
    });
    const key = `${cells.join('/')}|${status}`;
    this.flap.draw(key, (c) => {
      c.fillStyle = '#0C0F1A'; c.fillRect(0, 0, FLAP_W, FLAP_H);
      c.fillStyle = '#FFD23F'; c.fillRect(0, 0, FLAP_W, 12);
      pixText(c, 'DEPARTURES', 6, 3, '#0C0F1A');
      pixText(c, 'FLIGHT', 150, 3, '#0C0F1A');
      rowText.forEach((cellsR, ri) => {
        const y = 16 + ri * 25;
        for (let i = 0; i < 12; i++) {
          const x = 4 + i * 12;
          c.fillStyle = '#1C2130'; c.fillRect(x, y, 11, 21);
          c.fillStyle = '#05070F'; c.fillRect(x, y + 10, 11, 1);
          const cell = cellsR[i];
          if (cell && cell.ch !== ' ' && cell.st > 0) pixText(c, cell.ch, x + 1, y + 3, cell.st === 2 ? P.uiLine : P.uiDim, 2);
        }
      });
      // the status column
      const sy = 16;
      for (let i = 0; i < 8; i++) { const x = 152 + i * 12; c.fillStyle = '#1C2130'; c.fillRect(x, sy, 11, 21); c.fillStyle = '#05070F'; c.fillRect(x, sy + 10, 11, 1); }
      if (status.trim()) pixText(c, status, 154, sy + 5, status.startsWith('D') ? P.fail : P.fix, 1, { shadow: P.uiEdge });
      pixText(c, 'GATE 7', 154, sy + 32, P.uiDim);
    });
  }
}

