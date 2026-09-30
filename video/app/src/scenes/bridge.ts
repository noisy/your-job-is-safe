// The bridge (whispered, instruments out, thick fog): "And lately... something's weird. / Grandma's out of
// keys, / My Tesla's driving me, hands-free, / The wine is dripping down on me... / Will Smith eats
// spaghetti, smooth and slow, / And I can't tell it's fake... / ...Oh no."
// Out of the dark (the duck's eye from the breakdown) into DEV's foggy room; grandma's storybook with blank
// pages; a one-second flash of a car through a painted-road wall (plain-text caption), then DEV riding in a
// car that drives itself, hands on his knees; a wine glass over him, full to the brim and dripping on him;
// the spaghetti diner guy again but smooth, calm and shaded (the one model that doesn't wobble); DEV at his
// CRT unable to tell; "…Oh no." and the fog whites out on the downbeat (→ the final chorus).
// Lyric idiom: thin whisper letters that wipe in out of the fog, held notes stretching the glyphs; each
// line floats past the camera like a drifting sign.
import * as THREE from 'three';
import type { Frame, PostOverrides } from '../engine/scene';
import type { Line } from '../engine/lyrics';
import { clamp, lerp, ease, prog, springStep, hash, frameIdx } from '../engine/util';
import { Ps1Stage, windowOpen, type CamState, type V3, type Panel } from '../ps1/stage';
import { makeRoom, makeDev, type Room, type Dev } from '../ps1/cast';
import { psMat, canvasTex, pixText, textW, rng, shade } from '../ps1/gfx';
import { P } from '../ps1/palette';
import { makeBedroom, type Bedroom } from './v1-grandma-calendar-set';
import { makeDiner, makeDinerSet, type Diner } from './v1-hand-spaghetti-diner';
import { wineGlassGeometry, wineGeometry, GLASS } from './style-linocut-geo';
import { SGW, SGH, drawWhisper, whisperKey } from './bridge-whisper';

const BX = 40, RX = 80, WX = 120, DX = 160; // bedroom, road, painted wall, diner
const FOG = '#4A5670', WHITE = '#F3F0E8';
const GL_S = 1.25; // the giant glass over DEV
// the record self-driving trip: the Tesla Diner in Hollywood (Los Angeles) to Myrtle Beach, SC, the car doing every mile
const CAPTION = ['self-driving coast to coast: 2,732.4 mi,', '24 states, 23 Supercharger stops, 0 hands'];
const CAPW = 504, CAPH = 40;
const box = (w: number, h: number, d: number, m: THREE.Material | THREE.Material[]) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

export default class Bridge extends Ps1Stage {
  room!: Room; dev!: Dev;
  bed!: Bedroom; flipPage = new THREE.Object3D();
  road = new THREE.Group(); lamps: THREE.Group[] = []; car = new THREE.Group(); wheel!: THREE.Mesh; driver!: Dev;
  mapLabels: THREE.Mesh[] = [];
  map!: { tex: THREE.CanvasTexture; ctx: CanvasRenderingContext2D }; mapCar!: THREE.Mesh; prop = new THREE.Group(); mapKey = '';
  glass = new THREE.Group(); drips: THREE.Mesh[] = []; puddle!: THREE.Mesh;
  diner!: Diner; dinerCap!: THREE.Mesh;
  signs: Panel[] = [];
  capP!: Panel;
  lines: Line[] = [];
  D: number[] = []; K: number[] = [];
  /** Hard cuts (downbeats where the set changes). */
  cuts: number[] = [];
  screenKey = '';

  override async init() {
    const { audio: au, lyrics: ly, start, end } = this.ctx;
    this.fogColor = FOG; this.fogNear = 1.2; this.fogFar = 7;
    const q = ['And lately', "Grandma's out of keys", "My Tesla's driving me", 'The wine is dripping', 'eats spaghetti, smooth', "can't tell it's fake", 'Oh no'];
    this.lines = q.map((s) => ly.get(s));
    this.D = au.downbeats.filter((d) => d >= start - 0.02 && d <= end + 0.02);
    this.K = au.events('kick', start, end).map((e) => e[0]);
    const near = (x: number) => this.D.reduce((a, d) => (Math.abs(d - x) < Math.abs(a - x) ? d : a), this.D[0]!);
    const L = this.lines;
    // the sets change on the downbeats nearest these moments
    this.cuts = [
      near(L[1]!.start - 0.1), // grandma
      near(L[2]!.start + 0.4), // the map: coast to coast
      near(L[2]!.start + 2.4), // the car
      near(L[3]!.end - 1.9), // the glass
      near(L[4]!.start + 0.4), // the diner
      near(L[5]!.start - 0.5), // DEV at the CRT
      near(L[6]!.start - 0.45), // his face
    ];
    this.buildRoom();
    this.bed = makeBedroom(); this.bed.root.position.x = BX; this.world.add(this.bed.root);
    this.bed.gran.head.setFace('think');
    // a blank page that keeps turning
    const page = new THREE.Mesh(new THREE.PlaneGeometry(0.29, 0.4).translate(0.145, 0, 0), psMat({ color: '#F3ECDF', side: THREE.DoubleSide }));
    page.rotation.x = -Math.PI / 2;
    this.flipPage.add(page); this.flipPage.position.y = 0.016;
    this.bed.book.add(this.flipPage);
    this.bed.pointer.visible = false;
    this.buildRoad();
    this.buildMap();
    const set = makeDinerSet(true); set.position.x = DX; this.world.add(set);
    this.diner = makeDiner(true); this.diner.root.position.set(DX, 0, 0); this.world.add(this.diner.root);
    this.dinerCap = this.label('"Will Smith eating spaghetti", 2026', P.uiLine, P.uiNavy, 1, 1 / 190);
    const sign = this.panel(SGW, SGH);
    (sign.mesh.material as THREE.RawShaderMaterial).uniforms.uFogAmt!.value = 0;
    this.signs.push(sign);
    this.capP = this.panel(CAPW, CAPH);
    this.capP.draw('cap', (c) => {
      c.fillStyle = P.uiEdge; c.fillRect(0, 0, CAPW, CAPH);
      c.fillStyle = P.uiNavy; c.fillRect(1, 1, CAPW - 2, CAPH - 2);
      CAPTION.forEach((ln, i) => pixText(c, ln, Math.floor((CAPW - textW(ln, 2)) / 2), 4 + i * 18, P.uiLine, 2, { shadow: P.uiEdge }));
    });
  }

  private buildRoom() {
    this.room = makeRoom();
    this.world.add(this.room.root);
    this.dev = makeDev(); this.dev.sit(true); this.dev.root.position.copy(this.room.seat);
    this.world.add(this.dev.root);
    // the giant glass over him, full to the brim and overflowing (low-poly lathes)
    const glassM = psMat({ color: '#CFE3F0', opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
    const wineM = psMat({ color: '#9A1A30', emit: '#200006' });
    const g = new THREE.Mesh(wineGlassGeometry(12), glassM);
    const w = new THREE.Mesh(wineGeometry(GLASS.rim - 0.004, 12), wineM);
    const bulge = new THREE.Mesh(new THREE.SphereGeometry(GLASS.rimR * 0.98, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2), wineM);
    bulge.scale.y = 0.08; bulge.position.y = GLASS.rim;
    this.glass.add(w, bulge, g);
    // wine running down the outside
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      const st = box(0.02, 0.22 + 0.1 * hash(i, 2), 0.02, wineM);
      st.position.set(Math.cos(a) * (GLASS.rimR + 0.01), GLASS.rim - 0.12, Math.sin(a) * (GLASS.rimR + 0.01));
      this.glass.add(st);
    }
    this.glass.scale.setScalar(GL_S);
    this.glass.position.set(0.05, 1.62, -2.5);
    this.glass.rotation.z = 0.08;
    this.world.add(this.glass);
    for (let i = 0; i < 14; i++) { const d = box(0.05, 0.07, 0.05, wineM); this.world.add(d); this.drips.push(d); }
    this.puddle = new THREE.Mesh(new THREE.CircleGeometry(0.5, 8), psMat({ color: '#5A0E1C' }));
    this.puddle.rotation.x = -Math.PI / 2; this.puddle.position.set(0.1, 0.012, -2.3);
    this.world.add(this.puddle);
  }

  private buildRoad() {
    const R = rng(51);
    const roadT = canvasTex(32, 64, (c) => {
      for (let y = 0; y < 64; y++) for (let x = 0; x < 32; x++) { c.fillStyle = shade('#2A2C36', 0.9 + R() * 0.15); c.fillRect(x, y, 1, 1); }
      c.fillStyle = '#E8E4D8'; c.fillRect(15, 0, 2, 26); c.fillRect(1, 0, 1, 64); c.fillRect(30, 0, 1, 64);
    }, true).tex;
    const rg = new THREE.PlaneGeometry(7, 80, 2, 20);
    const ruv = rg.attributes.uv!; for (let i = 0; i < ruv.count; i++) ruv.setXY(i, ruv.getX(i), ruv.getY(i) * 20);
    const road = new THREE.Mesh(rg, psMat({ map: roadT })); road.rotation.x = -Math.PI / 2;
    this.road.add(road);
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(60, 80, 4, 8), psMat({ color: '#16241E' })); grass.rotation.x = -Math.PI / 2; grass.position.y = -0.01;
    this.road.add(grass);
    this.road.position.x = RX;
    this.world.add(this.road);
    const post = psMat({ color: '#4A5068' }), lampM = psMat({ color: '#FFE3A0', unlit: true });
    for (let i = 0; i < 8; i++) {
      const g = new THREE.Group();
      const p = box(0.12, 3.2, 0.12, post); p.position.y = 1.6; g.add(p);
      const arm = box(0.9, 0.08, 0.08, post); arm.position.set(-0.4, 3.15, 0); g.add(arm);
      const l = box(0.34, 0.1, 0.2, lampM); l.position.set(-0.8, 3.08, 0); g.add(l);
      g.position.set(RX + (i % 2 ? -4.2 : 4.2), 0, 0); if (i % 2) g.rotation.y = Math.PI;
      this.world.add(g); this.lamps.push(g);
    }
    // the car: a plain white hatch (no badge), see-through cabin, DEV in the driver's seat
    const white = psMat({ color: '#4A4E57' }) /* Stealth Gray */, dark = psMat({ color: '#17191F' }), glassy = psMat({ color: '#2A3A55', opacity: 0.14 });
    // an open cabin: a low floor, hood and trunk, thin door panels, so DEV's legs read in the footwell
    const floor = box(1.8, 0.12, 4.2, dark); floor.position.y = 0.16; this.car.add(floor);
    const hood = box(1.8, 0.55, 1.1, white); hood.position.set(0, 0.5, -1.55); this.car.add(hood);
    const trunk = box(1.8, 0.55, 1.1, white); trunk.position.set(0, 0.5, 1.55); this.car.add(trunk);
    for (const x of [-0.87, 0.87]) { const door = box(0.06, 0.3, 2.0, white); door.position.set(x, 0.37, 0); this.car.add(door); }
    for (const [x, z] of [[-0.8, 1.0], [0.8, 1.0], [-0.8, -1.0], [0.8, -1.0]] as [number, number][]) {
      const pil = box(0.08, 0.86, 0.08, white); pil.position.set(x, 1.2, z); this.car.add(pil);
    }
    const roof = box(1.7, 0.08, 2.2, white); roof.position.set(0, 1.64, -0.1); this.car.add(roof);
    const wind = box(1.6, 0.75, 0.03, glassy); wind.position.set(0, 1.24, -1.06); wind.rotation.x = -0.35; this.car.add(wind);
    for (const [x, z] of [[-0.92, 1.35], [0.92, 1.35], [-0.92, -1.35], [0.92, -1.35]] as [number, number][]) {
      const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 8), dark); wh.rotation.z = Math.PI / 2; wh.position.set(x, 0.34, z); this.car.add(wh);
    }
    for (const x of [-0.6, 0.6]) {
      const hl = box(0.34, 0.12, 0.04, psMat({ color: '#FFF1C0', unlit: true })); hl.position.set(x, 0.62, -2.11); this.car.add(hl);
      const tl = box(0.3, 0.1, 0.04, psMat({ color: '#FF4B5C', unlit: true })); tl.position.set(x, 0.66, 2.11); this.car.add(tl);
    }
    const seatM = psMat({ color: '#3B3F5C' });
    for (const x of [-0.42, 0.42]) { const st = box(0.55, 0.12, 0.55, seatM); st.position.set(x, 0.56, 0.2); this.car.add(st); const bk = box(0.55, 0.62, 0.1, seatM); bk.position.set(x, 0.92, 0.5); this.car.add(bk); }
    this.wheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 4, 10), dark);
    this.wheel.position.set(-0.42, 0.95, -0.55); this.wheel.rotation.x = -0.5; this.car.add(this.wheel);
    const column = box(0.05, 0.05, 0.35, dark); column.position.set(-0.42, 0.88, -0.72); column.rotation.x = -0.5; this.car.add(column);
    const dash = box(1.6, 0.2, 0.3, dark); dash.position.set(0, 0.85, -0.9); this.car.add(dash);
    // DEV seated (the kit's sit(): thighs forward along -z, shins down to the floor), hands on his knees, off the wheel
    this.driver = makeDev(); this.driver.sit(true); this.driver.root.position.set(-0.42, 0.12, 0.28); this.driver.setFace('scared');
    this.driver.armL.rotation.set(0.95, 0, 0.12); this.driver.armR.rotation.set(0.95, 0, -0.12);
    this.car.add(this.driver.root);
    // the painted-wall prop standing in the lane ahead (a callback: this time the car steers round it)
    const R2 = rng(61);
    const paintT = canvasTex(64, 40, (c) => {
      c.fillStyle = '#7FA4D8'; c.fillRect(0, 0, 64, 20);
      c.fillStyle = '#F3ECDF'; c.fillRect(8, 5, 12, 3); c.fillRect(42, 9, 14, 3);
      c.fillStyle = '#4E7A44'; c.fillRect(0, 20, 64, 20);
      c.fillStyle = '#44464F'; c.beginPath(); c.moveTo(14, 40); c.lineTo(30, 20); c.lineTo(34, 20); c.lineTo(50, 40); c.fill();
      c.fillStyle = '#F3ECDF'; for (let y = 23; y < 40; y += 5) c.fillRect(31, y, 2, 2);
      for (let i = 0; i < 30; i++) { c.fillStyle = shade('#4E7A44', 0.8 + R2() * 0.3); c.fillRect(Math.floor(R2() * 64), 20 + Math.floor(R2() * 20), 1, 1); }
    }).tex;
    const board = box(3.0, 2.0, 0.12, [psMat({ color: '#9A917A' }), psMat({ color: '#9A917A' }), psMat({ color: '#9A917A' }), psMat({ color: '#9A917A' }), psMat({ map: paintT }), psMat({ map: paintT })]);
    board.position.y = 1.1; this.prop.add(board);
    for (const x of [-1.2, 1.2]) { const leg = box(0.1, 0.3, 0.5, psMat({ color: '#5A4A3A' })); leg.position.set(x, 0.1, 0.2); this.prop.add(leg); }
    this.world.add(this.prop);
    this.car.position.set(RX + 1.1, 0, 0);
    this.world.add(this.car);
  }

  /** A map of the US (an original, simplified outline) lying on a table; the route draws itself west to east. */
  private buildMap() {
    const c = canvasTex(128, 80, () => {});
    this.map = { tex: c.tex, ctx: c.ctx };
    const board = new THREE.Mesh(new THREE.PlaneGeometry(8, 5), psMat({ map: c.tex, unlit: true, fog: 0.4 }));
    board.rotation.x = -Math.PI / 2; board.position.set(WX, 0.02, 0);
    const frame = box(8.3, 0.1, 5.3, psMat({ color: '#5A3A22' })); frame.position.set(WX, -0.04, 0);
    const table = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), psMat({ color: '#2A2238' })); table.rotation.x = -Math.PI / 2; table.position.set(WX, -0.1, 0);
    this.mapCar = box(0.26, 0.14, 0.14, psMat({ color: '#4A4E57', emit: '#101216' }));
    this.world.add(board, frame, table, this.mapCar);
    const at = ([x, y]: [number, number]) => new THREE.Vector3(WX + (x - 0.5) * 8, 0.35, (y - 0.5) * 5);
    const la = this.label('Los Angeles, CA', P.uiLine, P.uiNavy, 1, 1 / 45); la.position.copy(at(ROUTE[0]!)).add(new THREE.Vector3(0.2, 0.1, 0.55));
    const mb = this.label('Myrtle Beach, SC', P.uiLine, P.uiNavy, 1, 1 / 45); mb.position.copy(at(ROUTE[ROUTE.length - 1]!)).add(new THREE.Vector3(-0.5, 0.1, 0.55));
    this.mapLabels = [la, mb];
  }

  // ---------------------------------------------------------------- the camera

  private setOf(t: number) { let k = 0; for (const c of this.cuts) if (t >= c) k++; return k; }

  camAt(t: number): CamState {
    const [c1, c2, c3, c4, c5, c6, c7] = this.cuts as [number, number, number, number, number, number, number];
    const t0 = this.D[0]!, s = this.setOf(t);
    const kickPush = (a: number, b: number) => this.K.filter((k) => k > a && k < b).reduce((acc, k) => acc + prog(t, k, k + 0.12, ease.outExpo), 0);
    if (s === 0) {
      // the duck's eye in the dark, pulling slowly back to DEV at his desk in the fog; then his face
      const mid = this.D[2] ?? t0 + 2.8;
      if (t < mid) {
        const u = ease.inOutCubic(prog(t, t0, mid));
        return { P: [lerp(0.7, 1.25, u), lerp(0.98, 1.5, u), lerp(-2.62, -1.6, u)], T: [lerp(0.45, 0.1, u), lerp(0.92, 1.05, u), lerp(-3.08, -2.9, u)], roll: lerp(0.08, -0.03, u), fov: 50 };
      }
      const u = ease.inOutQuad(prog(t, mid, c1));
      return { P: [lerp(0.75, 0.55, u), lerp(1.4, 1.36, u), lerp(-3.05, -2.95, u)], T: [0, 1.28, -2.46], roll: lerp(0.02, -0.02, u), fov: 50 };
    }
    if (s === 1) {
      // grandma's book, blank; a slow drift in from the bedside
      const u = ease.inOutQuad(prog(t, c1, c2));
      return { P: [BX + lerp(1.75, 1.35, u), lerp(1.45, 1.35, u), lerp(0.6, 0.15, u)], T: [BX + 0.5, lerp(1.2, 1.12, u), -0.1], roll: lerp(-0.03, 0.02, u), fov: 50 };
    }
    if (s === 2) {
      // the map: a crane that follows the route from the west coast to the east
      const u = ease.inOutQuad(prog(t, c2, c3));
      const r = routeAt(ROUTE, ease.inOutQuad(prog(t, c2 + 0.1, c3 - 0.25)));
      const mx = WX + (r[0] - 0.5) * 8, mz = (r[1] - 0.5) * 5;
      return { P: [lerp(WX - 1.5, mx + 0.6, u * 0.8), lerp(6.2, 4.6, u), lerp(3.4, mz + 3.0, u)], T: [lerp(WX - 0.8, mx, 0.7), 0, lerp(0.2, mz, 0.7)], roll: lerp(-0.04, 0.04, u), fov: 50 };
    }
    if (s === 3) {
      // beside DEV in the cabin (hands on his knees, the wheel turning itself), then up and back to a high
      // chase view as the car swerves smoothly round the painted wall and back into its lane
      const cx = this.car.position.x;
      const u = ease.inOutCubic(prog(t, c3 + 0.15, c3 + 0.6));
      const Pa: V3 = [cx + 0.62, 1.22, 0.05], Ta: V3 = [cx - 0.42, 0.9, -0.15];
      const Pb: V3 = [RX + 1.1 + 1.6, 4.2, 7.2], Tb: V3 = [RX + 0.2, 0.6, -5];
      return { P: [lerp(Pa[0], Pb[0], u), lerp(Pa[1], Pb[1], u), lerp(Pa[2], Pb[2], u)], T: [lerp(Ta[0], Tb[0], u), lerp(Ta[1], Tb[1], u), lerp(Ta[2], Tb[2], u)], roll: lerp(-0.03, 0.03, u), fov: lerp(62, 52, u) };
    }
    if (s === 4) {
      // under the glass: looking up past DEV at the overflowing rim, drifting down to the drops on him
      const u = ease.inOutQuad(prog(t, c4, c5));
      return { P: [lerp(1.6, 1.3, u), lerp(1.15, 1.3, u), lerp(-1.0, -1.45, u)], T: [lerp(0.05, 0.0, u), lerp(2.05, 1.55, u), lerp(-2.5, -2.45, u)], roll: lerp(-0.05, 0.03, u), fov: 58 };
    }
    if (s === 5) {
      // the smooth diner: a slow arc, one small push per kick (the drums are back)
      const u = ease.inOutQuad(prog(t, c5, c6));
      const a = lerp(-0.5, 0.35, u), r = 2.3 - 0.08 * kickPush(c5, c6);
      return { P: [DX + Math.sin(a) * r, 1.45, 0.3 + Math.cos(a) * r], T: [DX, 1.2, 0.2], roll: 0.02 * Math.sin(a), fov: 50 };
    }
    if (s === 6) {
      // DEV at his CRT watching it; can't tell: push toward the screen, then round to his face
      const u = ease.inOutQuad(prog(t, c6, c7));
      const turn = ease.inOutCubic(prog(t, c6 + (c7 - c6) * 0.55, c7));
      const Pa: V3 = [lerp(0.55, 0.3, u), 1.4, lerp(-1.75, -2.2, u)], Ta: V3 = [0, 1.08, -3.2];
      const Pb: V3 = [0.55, 1.34, -3.0], Tb: V3 = [0, 1.28, -2.46];
      return { P: [lerp(Pa[0], Pb[0], turn), lerp(Pa[1], Pb[1], turn), lerp(Pa[2], Pb[2], turn)], T: [lerp(Ta[0], Tb[0], turn), lerp(Ta[1], Tb[1], turn), lerp(Ta[2], Tb[2], turn)], roll: 0.03 * (1 - turn) - 0.02 * turn, fov: 50 };
    }
    // "…Oh no.": in on his face as the fog goes white
    const u = ease.inOutQuad(prog(t, c7, this.ctx.end));
    return { P: [lerp(0.4, 0.2, u), lerp(1.32, 1.3, u), lerp(-2.95, -2.78, u)], T: [0, 1.28, -2.46], roll: lerp(-0.02, 0.03, u), fov: 50 };
  }

  // ---------------------------------------------------------------- render

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const t = f.t;
    const [c1, c2, c3, c4, c5, c6, c7] = this.cuts as [number, number, number, number, number, number, number];
    const end = this.ctx.end, t0 = this.D[0]!;
    const s = this.setOf(t);
    // fog: out of black at the start, whiting out at the end
    const dark = 1 - prog(t, t0, t0 + 1.4, ease.inOutQuad);
    const white = prog(t, this.lines[6]!.end + 0.05, end - 0.05, ease.inQuad);
    const fc = new THREE.Color(FOG).lerp(new THREE.Color('#000000'), Math.pow(dark, 0.5)).lerp(new THREE.Color(WHITE), white);
    this.fogColor = `#${fc.getHexString()}`;
    // out of the black of the duck's eye; into white at the end (fog so thick nothing is left)
    this.fogNear = lerp(lerp(0.45, 0.0, dark), 0.0, white);
    this.fogFar = lerp(lerp(3.8, 0.12, Math.pow(dark, 0.6)), 0.08, white);
    if (s === 2) { this.fogNear = 3; this.fogFar = 14; }
    if (s === 3) { this.fogNear = lerp(2, 5, prog(t, c3 + 0.15, c3 + 0.6)); this.fogFar = lerp(9, 22, prog(t, c3 + 0.15, c3 + 0.6)); }
    if (s === 5) { this.fogNear = 1.4; this.fogFar = 6.5; }
    this.begin();

    const beat = this.ctx.audio.beatAt(t);
    const L = this.lines;
    // DEV (the room): still, uneasy; looks up under the glass; flinches at the drops
    const dev = this.dev;
    dev.setFace(s === 4 ? 'scared' : s >= 6 ? (t >= L[6]!.start - 0.05 ? 'scared' : 'shock') : 'sad');
    dev.armL.rotation.set(1.28, 0, 0.18); dev.armR.rotation.set(1.28, 0, -0.18);
    dev.head.rotation.x = s === 4 ? -0.55 : s >= 6 && t < c6 + (c7 - c6) * 0.55 ? 0.12 : 0.05 * Math.sin(t * 0.7);
    this.glass.visible = s === 4 || (s === 3 && t > c4 - 0.2);
    this.glass.rotation.set(0.05 * Math.sin(t * 0.8), 0, 0.08 + 0.03 * Math.sin(t * 0.6));
    this.puddle.visible = s >= 4;
    this.puddle.scale.setScalar(0.3 + 0.7 * prog(t, c4, c5));
    // drops from the rim onto his head and shoulders (a pure function of t: each drop on its own cycle)
    this.drips.forEach((d, i) => {
      const period = 0.9 + 0.3 * hash(i, 3);
      const ph = ((t - c4) / period + hash(i, 4)) % 1;
      d.visible = s === 4 && t > c4;
      const a = hash(i, 5) * Math.PI * 2, r = GLASS.rimR * GL_S;
      const x0 = this.glass.position.x + Math.cos(a) * r, z0 = this.glass.position.z + Math.sin(a) * r, y0 = this.glass.position.y + GLASS.rim * GL_S;
      const y = y0 - 5.5 * ph * ph;
      d.position.set(x0 * (1 - ph * 0.3), Math.max(0.02, y), z0 + ph * 0.1);
      d.scale.set(1, 1 + 2 * ph, 1);
    });
    if (s === 4) this.dev.torso.rotation.x = 0.05 * Math.max(0, Math.sin(t * 7));

    // grandma: the book is blank, she keeps turning pages, finds nothing
    this.flipPage.rotation.z = Math.PI * ((t * 0.9) % 1);
    this.bed.gran.head.setFace(Math.floor(t * 1.2) % 3 === 2 ? 'error' : 'think');
    this.bed.gran.rocker.rotation.z = 0.04 * Math.sin(t * 1.4);

    // the road: lamps and lane marks stream past; the wheel turns on its own
    const v = 7.5;
    this.road.children[0]!.position.z = ((t * v) % 4) - 2;
    this.lamps.forEach((g, i) => { g.position.z = 20 - (((t * v) + Math.floor(i / 2) * 10 + (i % 2) * 5) % 40); });
    this.car.position.y = 0.02 * Math.sin(t * 9);
    this.driver.head.rotation.y = 0.25 * Math.sin(t * 0.8);

    // the map: the route draws itself in fix green, the car token rides its head
    const ru = ease.inOutQuad(prog(t, c2 + 0.1, c3 - 0.25));
    const mk = `${Math.round(ru * 90)}`;
    if (mk !== this.mapKey) { this.mapKey = mk; drawMap(this.map.ctx, ru); this.map.tex.needsUpdate = true; }
    const rp = routeAt(ROUTE, ru), rq = routeAt(ROUTE, Math.min(1, ru + 0.01));
    this.mapCar.position.set(WX + (rp[0] - 0.5) * 8, 0.1, (rp[1] - 0.5) * 5);
    this.mapCar.rotation.y = -Math.atan2(rq[1] - rp[1], rq[0] - rp[0]);
    // the swerve: the prop comes down the lane, the car eases into the next lane and back
    const tp = c4 - 0.15, pz = v * (t - tp);
    this.prop.position.set(RX + 1.1, 0, pz);
    this.prop.visible = s === 3;
    const dx = -2.3 * Math.exp(-Math.pow(pz / 5, 2));
    const slope = -2.3 * Math.exp(-Math.pow(pz / 5, 2)) * (-2 * pz / 25) * v; // d(dx)/dt
    this.car.position.x = RX + 1.1 + dx;
    this.car.rotation.y = -Math.atan2(slope, v) * 0.8;
    this.wheel.rotation.z = 0.5 * Math.sin(t * 0.9) + 1.2 * this.car.rotation.y;
    this.capP.open = s === 2 ? windowOpen(t, c2 + 0.08, c3, 0.12) : 0;
    this.capP.hang = { ref: c2 + 0.05, follow: 0, x: 0, y: -0.8, frac: 0.9, D: 0.5 };
    this.mapLabels.forEach((m) => { m.visible = s === 2; });

    // the diner, smooth and slow
    const dn = this.diner;
    dn.armR.rotation.set(-1.0 - 0.45 * (0.5 + 0.5 * Math.sin(t * 1.6)), 0, 0.12);
    dn.armL.rotation.set(-0.45, 0, -0.1);
    dn.head.rotation.set(0.04 * Math.sin(t * 1.6 + 1), 0.1 * Math.sin(t * 0.5), 0);
    this.dinerCap.visible = s === 5;
    this.dinerCap.position.set(DX, 0.95, 1.3);

    // the CRT: idle code in the fog, then the smooth clip DEV can't tell apart
    const sk = s >= 6 ? `clip${frameIdx(t) >> 3}` : 'idle';
    if (sk !== this.screenKey) {
      this.screenKey = sk;
      const c = this.room.screen.ctx;
      if (s >= 6) drawSmoothClip(c, t); else drawIdle(c);
      this.room.screen.tex.needsUpdate = true;
    }

    // the whisper sign: one line at a time; it swaps to the next line (top/bottom alternating) the moment
    // the next line starts, and clears if the voice pauses long enough
    const lastCut = [t0, ...this.cuts].filter((c) => c <= t).pop() ?? t0;
    const p = this.signs[0]!;
    const i = L.reduce((k, l, j) => (t >= l.start - 0.12 ? j : k), -1);
    const l = L[i];
    const a = l ? Math.max(l.start - 0.12, (L[i - 1]?.start ?? -1e9)) : 0;
    const b = l ? Math.min((L[i + 1]?.start ?? 1e9) - 0.12, l.end + 1.6, end + 0.1) : 0;
    if (!l || t >= b) p.open = 0;
    else {
      const u = prog(t, a, b);
      const up = i % 2 === 0;
      p.open = windowOpen(t, a, b, 0.12, false, (L[i + 1]?.start ?? 1e9) - 0.12 <= l.end + 1.6) * (1 - white);
      p.hang = {
        ref: t, follow: clamp(t - lastCut, 0, 0.45),
        D: lerp(1.1, 0.8, u), x: lerp(0.06, -0.06, u) * (up ? 1 : -1), y: (up ? 0.55 : -0.66) + 0.03 * Math.sin(t * 1.3 + i),
        frac: 0.74, yaw: lerp(-0.2, 0.18, u) * (up ? 1 : -1), pitch: up ? 0.08 : -0.08, roll: 0.02 * Math.sin(t * 0.9 + i),
      };
      p.draw(`${i}:${whisperKey(l, t)}`, (c) => drawWhisper(c, l, t));
    }
    void beat; void springStep; void c1; void c3; void c5;
    return this.present(f, out);
  }
}

// ---------------------------------------------------------------- the CRT (128x96)

function drawIdle(c: CanvasRenderingContext2D) {
  c.fillStyle = '#10162A'; c.fillRect(0, 0, 128, 96);
  c.fillStyle = '#2E4A8C'; c.fillRect(0, 0, 128, 10);
  pixText(c, 'hand_written.c', 3, 2, P.uiLine);
  ['// something', '// is weird', '', 'while (true) {', '  wait();', '}'].forEach((ln, i) => pixText(c, ln, 4, 16 + i * 10, i < 2 ? '#7FC98F' : P.uiDim));
  c.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 1; y < 96; y += 2) c.fillRect(0, y, 128, 1);
}
/** The same diner shot, but calm and properly shaded: soft gradients, a face that holds. */
function drawSmoothClip(c: CanvasRenderingContext2D, t: number) {
  const g = c.createLinearGradient(0, 10, 0, 96);
  g.addColorStop(0, '#3E8C86'); g.addColorStop(0.45, '#357A75'); g.addColorStop(0.46, '#DAD5C6'); g.addColorStop(1, '#B9B3A2');
  c.fillStyle = g; c.fillRect(0, 0, 128, 96);
  const booth = c.createLinearGradient(0, 40, 0, 70); booth.addColorStop(0, '#C23A34'); booth.addColorStop(1, '#8A2522');
  c.fillStyle = booth; c.fillRect(18, 40, 92, 26);
  const sh = c.createRadialGradient(64, 66, 4, 64, 66, 26); sh.addColorStop(0, '#E39A4E'); sh.addColorStop(1, '#B8702E');
  c.fillStyle = sh; c.beginPath(); c.ellipse(64, 68, 22, 16, 0, 0, Math.PI * 2); c.fill();
  const bob = Math.sin(t * 1.6) * 1.2;
  const fc = c.createRadialGradient(61, 36 + bob, 2, 64, 38 + bob, 14); fc.addColorStop(0, '#B07E5E'); fc.addColorStop(1, '#8A5A40');
  c.fillStyle = fc; c.beginPath(); c.ellipse(64, 38 + bob, 11, 13, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#22160F'; c.beginPath(); c.ellipse(64, 28 + bob, 11, 5, 0, Math.PI, Math.PI * 2); c.fill();
  c.fillStyle = '#F3ECDF'; c.beginPath(); c.ellipse(64, 84, 26, 5, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#E8C872'; c.beginPath(); c.ellipse(64, 82, 14, 3, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = 'rgba(0,0,0,0.18)'; for (let y = 1; y < 96; y += 2) c.fillRect(0, y, 128, 1);
  c.fillStyle = '#10162A'; c.fillRect(0, 0, 128, 9);
  pixText(c, 'vid gen v5.0  ▶ 0:0' + (1 + Math.floor(t) % 9), 3, 1, P.uiLine);
}

// ---------------------------------------------------------------- the coast-to-coast map (128x80)

/** A simplified US outline (x west→east, y north→south, 0..1): an original drawing, not a real map. */
const OUTLINE: [number, number][] = [[0.03, 0.12], [0.14, 0.09], [0.42, 0.11], [0.56, 0.13], [0.62, 0.21], [0.68, 0.16], [0.77, 0.2], [0.86, 0.12], [0.93, 0.05], [0.97, 0.12],
  [0.9, 0.24], [0.87, 0.34], [0.84, 0.45], [0.81, 0.57], [0.76, 0.67], [0.81, 0.86], [0.77, 0.89], [0.72, 0.73], [0.62, 0.72], [0.55, 0.76], [0.48, 0.93], [0.42, 0.81],
  [0.33, 0.72], [0.22, 0.7], [0.12, 0.63], [0.06, 0.46], [0.02, 0.3]];
const ROUTE: [number, number][] = [[0.12, 0.6], [0.2, 0.63], [0.3, 0.64], [0.4, 0.62], [0.5, 0.6], [0.6, 0.61], [0.7, 0.6], [0.79, 0.58]];
function routeAt(r: [number, number][], u: number): [number, number] {
  const f = clamp(u) * (r.length - 1), i = Math.min(r.length - 2, Math.floor(f)), k = f - i;
  return [lerp(r[i]![0], r[i + 1]![0], k), lerp(r[i]![1], r[i + 1]![1], k)];
}
function drawMap(c: CanvasRenderingContext2D, u: number) {
  const W = 128, H = 80;
  c.fillStyle = '#1E3560'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#2E4A8C'; for (let y = 2; y < H; y += 6) for (let x = (y % 12) / 2; x < W; x += 9) c.fillRect(x, y, 3, 1);
  c.fillStyle = '#4E7A44';
  c.beginPath(); OUTLINE.forEach(([x, y], i) => (i ? c.lineTo(x * W, y * H) : c.moveTo(x * W, y * H))); c.closePath(); c.fill();
  c.strokeStyle = '#E8E4D8'; c.lineWidth = 1; c.stroke();
  // the route so far, in fix green, with the start and the finish
  const n = 60, k = Math.floor(clamp(u) * n);
  c.fillStyle = P.fix;
  for (let i = 0; i <= k; i++) { const [x, y] = routeAt(ROUTE, i / n); c.fillRect(Math.round(x * W) - 1, Math.round(y * H) - 1, 2, 2); }
  const [sx, sy] = ROUTE[0]!, [ex, ey] = ROUTE[ROUTE.length - 1]!;
  c.fillStyle = P.uiLine; c.fillRect(sx * W - 2, sy * H - 2, 4, 4);
  c.fillStyle = u >= 0.999 ? P.fix : P.uiLine; c.fillRect(ex * W - 2, ey * H - 2, 4, 4);
  if (u >= 0.999) pixText(c, '✓', ex * W - 2, ey * H - 11, P.fix);
  // the 23 Supercharger stops, each lighting up as the car passes it
  for (let i = 1; i <= 23; i++) {
    const v = i / 24, [x, y] = routeAt(ROUTE, v);
    c.fillStyle = u >= v ? '#FFD84A' : '#2A3C2A';
    c.fillRect(Math.round(x * W) - 1, Math.round(y * H) + 2, 2, 2);
  }
}
