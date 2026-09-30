// Verse 2, scene 10: "…it picked the blast! / Then Grok dropped all its filters and veered the other
// way, / Grew a funny little mustache - and that's…". The first bar continues v2-stage's menu shot: the
// chatbot picks "the apocalypse", a mushroom cloud rises in the stage window and whites out the frame.
// Out of the white: a boss intro. The chatbot's head on a chunky mech suit (plain label "Grok, July
// 2025") stands in a cage of literal plate-glass SAFETY FILTERs; they drop and shatter, its eyes go red,
// it charges and veers like a car swerving the other way, skid marks and all; then it grows a funny
// little mustache on its screen, the camera looks away awkwardly and a censor block slams over the rest.
// No symbols: a shouting boss face with a forelock and a narrow mustache, nothing more; the target is the AI's behaviour.
// Lyric idiom: a boss-intro banner: each word slams in on its hit across a diagonal strip; "and that's
// all I'm gonna say." is cut off by the censor block (the rest reads on the drive-thru board in v2-roads).
import * as THREE from 'three';
import type { Frame } from '../engine/scene';
import type { Line, Word } from '../engine/lyrics';
import { clamp, lerp, ease, prog, pulse, hash, noise1 } from '../engine/util';
import { Ps1Stage, type CamState, type V3, windowOpen, asUi } from '../ps1/stage';
import { makeBotHead, type BotHead } from '../ps1/cast';
import { psMat, psGlobals, canvasTex, pixText, textW, rng, shade } from '../ps1/gfx';
import { P } from '../ps1/palette';
import { buildChatCorner, buildStageShell, menuCam, menuKicks, drawMenu, MENU_W, MENU_H, caption, type ChatCorner } from './v2-stage-set';

const box = (w: number, h: number, d: number, m: THREE.Material | THREE.Material[]) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const mix3 = (a: V3, b: V3, u: number): V3 => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
/** The boss arena is far from the stage (the fog keeps them apart). */
const AX = 60;
const BAN_W = 300, BAN_H = 44;

const WIPE = 6, STACHE = 4;

export default class V2Grok extends Ps1Stage {
  L2!: Line; L3!: Line; L4!: Line;
  T: Record<string, number> = {};
  kicks: number[] = [];
  mk: number[] = [];
  corner!: ChatCorner;
  menu = this.panel(MENU_W, MENU_H);
  banner = this.panel(BAN_W, BAN_H);
  mech = new THREE.Group();
  mechHead!: BotHead;
  mechLegs: THREE.Object3D[] = [];
  mechArms: THREE.Object3D[] = [];
  panes: { m: THREE.Group; x: number; z: number; ry: number; dir: number }[] = [];
  shards: { m: THREE.Mesh; p: THREE.Vector3; v: THREE.Vector3; spin: THREE.Vector3 }[] = [];
  skids: THREE.Mesh[] = [];
  faceTex: THREE.Texture[] = [];
  faceRed: THREE.Texture[] = [];
  bossFace: THREE.Texture[] = [];
  name!: { root: THREE.Group; letters: THREE.Object3D[]; width: number };
  censor!: THREE.Mesh;
  stache = new THREE.Group();
  nameTag!: THREE.Mesh;
  dust: ReturnType<Ps1Stage['dustBurst']>[] = [];

  override fogFar = 20;
  override fogNear = 6;

  override async init() {
    const { lyrics: ly, audio: au, start, end } = this.ctx;
    this.L2 = ly.get('misgender, or the apocalypse', 0);
    this.L3 = ly.get('Then Grok dropped', 0);
    this.L4 = ly.get('Grew a funny little mustache', 0);
    const db = au.downbeats.filter((d) => d >= start - 0.02 && d <= end + 0.02);
    const T = this.T;
    T.d0 = start; T.d1 = db[1] ?? start + 1.39; T.d2 = db[2] ?? start + 2.78; T.d3 = db[3] ?? start + 4.17; T.end = end;
    const w3 = this.L3.words, w4 = this.L4.words;
    T.blast = this.L2.words[8]!.start; T.then = w3[0]!.start; T.grok = w3[1]!.start; T.dropped = w3[2]!.start; T.filters = w3[5]!.start;
    T.and = w3[6]!.start; T.veered = w3[7]!.start; T.way = w3[10]!.start; T.l3end = w3[10]!.end;
    T.grew = w4[0]!.start; T.mustache = w4[4]!.start; T.mEnd = w4[4]!.end; T.and2 = w4[5]!.start;
    this.kicks = au.events('kick', start - 0.5, end + 0.5).map((k) => k[0]);
    this.mk = menuKicks(au, this.L2.words[0]!.start);
    // the censor block lands on the last kick before the cut (it covers "all I'm gonna say.")
    T.censor = this.kicks.filter((k) => k > T.and2 && k < end - 0.05).pop() ?? end - 0.15;
    T.away = T.and2;
    buildStageShell(this);
    this.corner = buildChatCorner(this);
    this.buildArena();
    this.buildMech();
    this.buildFilters();
    this.buildFaces();
    this.name = this.blockTitle('GROK', { cap: P.fail, side: P.failSide, depth: 0.5 });
    this.name.root.scale.setScalar(1.7);
    this.name.root.position.set(AX, 2.6, -4.2);
    this.nameTag = caption(this, ['Grok, July 2025'], 1 / 30);
    this.nameTag.position.set(AX + 2.2, 1.5, 1.6);
    this.censor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), psMat({ color: '#000000', unlit: true, fog: 0 }));
    // the censor block covers the frame like a UI window (drawn after the paper skin's edge pass)
    asUi(this.censor, 30);
    this.world.add(this.censor);
    for (let i = 0; i < 3; i++) this.dust.push(this.dustBurst(12, '#8A8F9E', 0.1));
  }

  // ------------------------------------------------------------------ the arena and the boss
  private buildArena() {
    const R = rng(71);
    const w = this.world;
    const plate = canvasTex(32, 32, (c) => {
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { c.fillStyle = shade('#2A2F3E', 0.85 + R() * 0.2); c.fillRect(x, y, 1, 1); }
      c.fillStyle = '#161A24'; c.fillRect(0, 0, 32, 1); c.fillRect(0, 0, 1, 32);
      c.fillStyle = '#4A5068'; c.fillRect(2, 2, 1, 1); c.fillRect(29, 2, 1, 1); c.fillRect(2, 29, 1, 1); c.fillRect(29, 29, 1, 1);
    }, true).tex;
    const g = new THREE.PlaneGeometry(24, 24, 6, 6);
    const uv = g.attributes.uv!; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 12, uv.getY(i) * 12);
    const floor = new THREE.Mesh(g, psMat({ map: plate })); floor.rotation.x = -Math.PI / 2; floor.position.set(AX, 0, 0); w.add(floor);
    // hazard ring on the floor
    const haz = canvasTex(32, 4, (c) => { for (let x = 0; x < 32; x++) { c.fillStyle = ((x >> 2) & 1) ? '#FFD23F' : '#15151C'; c.fillRect(x, 0, 1, 4); } }, true).tex;
    const ringG = new THREE.RingGeometry(3.6, 3.9, 24, 1);
    const ruv = ringG.attributes.uv!; const rp = ringG.attributes.position!;
    for (let i = 0; i < ruv.count; i++) ruv.setXY(i, (Math.atan2(rp.getY(i), rp.getX(i)) / (Math.PI * 2) + 0.5) * 12, rp.getX(i) ** 2 + rp.getY(i) ** 2 > 14 ? 1 : 0);
    const ring = new THREE.Mesh(ringG, psMat({ map: haz })); ring.rotation.x = -Math.PI / 2; ring.position.set(AX, 0.01, 0); w.add(ring);
    // back wall: dark bulkhead with red warning lights
    const wall = box(22, 8, 0.4, psMat({ color: '#1E2230' })); wall.position.set(AX, 4, -5.5); w.add(wall);
    const lampM = psMat({ color: '#FF4B5C', unlit: true, fog: 0.2 });
    for (let i = 0; i < 9; i++) { const l = box(0.3, 0.3, 0.1, lampM); l.position.set(AX - 8 + i * 2, 5.8, -5.25); w.add(l); }
    // side columns
    const colM = psMat({ color: '#3A4052' });
    for (const x of [-6, 6]) for (const z of [-4, 2]) { const c = box(0.8, 7, 0.8, colM); c.position.set(AX + x, 3.5, z); w.add(c); }
    // the awkward corner the camera looks away to: a potted plant and a mop bucket
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.24, 0.5, 6), psMat({ color: '#9A5A32' })); pot.position.set(AX - 4.6, 0.25, 3.4); w.add(pot);
    const leafM = psMat({ color: '#3F7A3A' });
    for (let i = 0; i < 5; i++) { const lf = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.9, 4), leafM); lf.position.set(AX - 4.6 + Math.cos(i * 1.3) * 0.12, 0.85, 3.4 + Math.sin(i * 1.3) * 0.12); lf.rotation.set(Math.sin(i * 2) * 0.5, 0, Math.cos(i * 2) * 0.5); w.add(lf); }
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.2, 0.4, 6), psMat({ color: '#FFD23F' })); bucket.position.set(AX - 3.8, 0.2, 3.7); w.add(bucket);
    const mop = box(0.04, 1.4, 0.04, psMat({ color: '#9A917A' })); mop.position.set(AX - 3.75, 0.8, 3.65); mop.rotation.z = 0.25; w.add(mop);
    // skid marks, revealed along the swerve
    const skM = psMat({ color: '#0C0E14' });
    for (let i = 0; i < 26; i++) { const s = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.5), skM); s.rotation.x = -Math.PI / 2; s.visible = false; w.add(s); this.skids.push(s); }
  }

  private buildMech() {
    const R = rng(5);
    // teal armour plates (a boss-mech homage), red hoses, a chaingun on each arm
    const steel = psMat({ map: canvasTex(16, 16, (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { c.fillStyle = shade('#2F6F6C', 0.86 + R() * 0.18); c.fillRect(x, y, 1, 1); } }).tex });
    const gun = psMat({ color: '#3F8C88' }), hose = psMat({ color: '#9A1E24' });
    const dark = psMat({ color: '#2E3242' });
    const hazard = psMat({ map: canvasTex(16, 4, (c) => { for (let x = 0; x < 16; x++) { c.fillStyle = (((x + 0) >> 2) & 1) ? '#FFD23F' : '#15151C'; c.fillRect(x, 0, 1, 4); } }).tex });
    const m = this.mech;
    const hips = new THREE.Object3D(); hips.position.y = 1.35; m.add(hips);
    const pelvis = box(1.1, 0.35, 0.7, dark); hips.add(pelvis);
    const torso = box(1.6, 1.05, 1.0, steel); torso.position.y = 0.75; hips.add(torso);
    const belt = box(1.62, 0.14, 1.02, hazard); belt.position.y = 0.28; hips.add(belt);
    const vent = box(0.9, 0.3, 0.05, dark); vent.position.set(0, 0.7, 0.51); hips.add(vent);
    for (const x of [-1, 1]) {
      const pad = box(0.7, 0.4, 0.9, steel); pad.position.set(x * 1.05, 1.2, 0); pad.rotation.z = -x * 0.25; hips.add(pad);
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.8, 6), dark); pipe.position.set(x * 0.45, 1.35, -0.5); hips.add(pipe);
      const arm = new THREE.Object3D(); arm.position.set(x * 1.05, 1.0, 0);
      const up = box(0.36, 0.7, 0.4, dark); up.position.y = -0.4;
      // the chaingun: a hub and six barrels round the arm's axis (spun on its pivot while it charges)
      const spin = new THREE.Object3D(); spin.position.y = -0.95;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.3, 8), gun); spin.add(hub);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.62, 5), dark); b.position.set(Math.cos(a) * 0.19, -0.32, Math.sin(a) * 0.19); spin.add(b);
        const mz = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 5), gun); mz.position.set(Math.cos(a) * 0.19, -0.64, Math.sin(a) * 0.19); spin.add(mz);
      }
      arm.add(up, spin); arm.userData.spin = spin; hips.add(arm); this.mechArms.push(arm);
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 5), hose); h.position.set(x * 0.8, 1.45, -0.35); h.rotation.z = x * 1.1; hips.add(h);
      const leg = new THREE.Object3D(); leg.position.set(x * 0.38, -0.1, 0);
      const thigh = box(0.46, 0.7, 0.5, steel); thigh.position.y = -0.4;
      const shin = box(0.4, 0.5, 0.44, dark); shin.position.y = -0.95;
      const foot = box(0.6, 0.2, 0.9, steel); foot.position.set(0, -1.15, 0.12);
      leg.add(thigh, shin, foot); hips.add(leg); this.mechLegs.push(leg);
    }
    this.mechHead = makeBotHead('v2.0');
    const hairM = psMat({ color: '#2A1F18' });
    // (the face's mouth is 0.125 wide: the mustache is a little over half of that)
    const st = box(0.07, 0.05, 0.05, hairM); this.stache.add(st);
    for (let i = 0; i < 3; i++) { const b = box(0.018, 0.025, 0.03, hairM); b.position.set(-0.024 + i * 0.024, -0.03, 0.005); this.stache.add(b); }
    this.stache.position.set(0, 0.235, 0.27);
    this.mechHead.root.add(this.stache);
    this.mechHead.root.scale.setScalar(1.5);
    this.mechHead.root.position.y = 1.3;
    hips.add(this.mechHead.root);
    m.position.set(AX, 0, 0);
    this.world.add(m);
  }

  private buildFilters() {
    const R = rng(12);
    const glassM = psMat({ color: '#9ED8FF', opacity: 0.38, side: THREE.DoubleSide, unlit: true, fog: 0.5 });
    const frameM = psMat({ color: '#C9D8E8' });
    const lab = canvasTex(64, 12, (c) => { c.fillStyle = '#16204A'; c.fillRect(0, 0, 64, 12); pixText(c, 'SAFETY FILTER', 2, 3, '#8CD3FF'); });
    const labM = psMat({ map: lab.tex, unlit: true, fog: 0.4, side: THREE.DoubleSide });
    const spots: [number, number, number, number][] = [[0, 1.7, 0, 1], [-1.7, 0, Math.PI / 2, -1], [1.7, 0, -Math.PI / 2, -1]];
    for (const [x, z, ry, dir] of spots) {
      const g = new THREE.Group();
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 3.6), glassM); pane.position.y = 1.8; g.add(pane);
      for (const [fx, fy, fw, fh] of [[0, 3.6, 3.1, 0.1], [0, 0.02, 3.1, 0.1], [-1.5, 1.8, 0.1, 3.6], [1.5, 1.8, 0.1, 3.6]] as [number, number, number, number][]) { const b = box(fw, fh, 0.08, frameM); b.position.set(fx, fy, 0); g.add(b); }
      const l = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.3), labM); l.position.set(0, 2.9, 0.02); g.add(l);
      g.position.set(AX + x, 0, z); g.rotation.y = ry;
      this.world.add(g);
      this.panes.push({ m: g, x, z, ry, dir });
    }
    const shardM = psMat({ color: '#CDEBFF', opacity: 0.6, side: THREE.DoubleSide, unlit: true, fog: 0.5 });
    for (let i = 0; i < 42; i++) {
      const tri = new THREE.BufferGeometry();
      const s = 0.12 + R() * 0.25;
      tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, s, R() * s, 0, R() * s * 0.5, s * (0.6 + R()), 0], 3));
      tri.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
      tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
      const m = new THREE.Mesh(tri, shardM); m.visible = false; this.world.add(m);
      const pane = spots[i % 3]!;
      const a = pane[2];
      const along = (R() - 0.5) * 3;
      const p = new THREE.Vector3(AX + pane[0] + Math.cos(a) * along, 0.1, pane[1] - Math.sin(a) * along);
      const outDir = new THREE.Vector3(pane[0], 0, pane[1]).normalize();
      const v = new THREE.Vector3(outDir.x * (1 + R() * 2.5) + (R() - 0.5), 2 + R() * 3, outDir.z * (1 + R() * 2.5) + (R() - 0.5));
      this.shards.push({ m, p, v, spin: new THREE.Vector3(R() * 12, R() * 12, R() * 12) });
    }
  }

  /**
   * The mech's face screens: blue eyes (with filters), red eyes (without), then the boss face: an original pixel
   * caricature of a shouting man with a side-parted forelock (the video-game boss-mech homage the lyric winks at),
   * revealed by a scanline wipe on "Grew", the narrow mustache growing on its word. No symbols anywhere.
   */
  private buildFaces() {
    for (const red of [false, true]) {
      const t = canvasTex(24, 18, (c) => {
        c.fillStyle = '#10162A'; c.fillRect(0, 0, 24, 18);
        const e = red ? P.fail : P.bot;
        c.fillStyle = e; c.fillRect(5, 4, 4, 4); c.fillRect(15, 4, 4, 4);
        if (red) { c.fillRect(4, 3, 5, 1); c.fillRect(15, 3, 5, 1); }
        c.fillStyle = e; c.fillRect(9, 15, 6, 1);
      }).tex;
      (red ? this.faceRed : this.faceTex).push(t);
    }
    // boss faces: wipe steps 1..WIPE (no mustache), then mustache steps 1..STACHE
    const drawBoss = (c: CanvasRenderingContext2D, rows: number, stache: number) => {
      const px = (x: number, y: number, w: number, h: number, col: string) => { if (y >= rows) return; c.fillStyle = col; c.fillRect(x, y, w, Math.min(h, rows - y)); };
      c.fillStyle = '#10162A'; c.fillRect(0, 0, 48, 36);
      const skin = '#E6B48E', skinD = '#C08A66', hair = '#1C1612', ink = '#1B1B2A';
      px(12, 5, 24, 29, skin); px(11, 9, 26, 20, skin); px(14, 33, 20, 2, skinD); // head, jaw
      px(12, 22, 3, 8, skinD); px(33, 22, 3, 8, skinD); // cheek shadows
      px(12, 2, 24, 6, hair); px(11, 4, 3, 8, hair); px(34, 4, 3, 7, hair); // hair
      for (let i = 0; i < 9; i++) px(24 - i, 7 + Math.floor(i * 0.7), 10 - i, 1, hair); // the forelock, swept down to the left
      px(15, 14, 6, 1, ink); px(17, 15, 3, 1, ink); px(27, 14, 6, 1, ink); px(28, 15, 3, 1, ink); // angry brows
      px(16, 17, 4, 2, '#FFFFFF'); px(28, 17, 4, 2, '#FFFFFF'); px(18, 17, 2, 2, ink); px(28, 17, 2, 2, ink); // glaring eyes
      px(23, 17, 3, 6, skinD); px(22, 22, 5, 1, skinD); // nose
      px(17, 27, 14, 6, '#5A1014'); px(18, 27, 12, 1, '#F3ECDF'); px(20, 31, 8, 2, '#A0303A'); // shouting mouth
      if (stache > 0) px(24 - stache, 23, stache * 2, 3, '#050403'); // the mustache: a bold block, a skin row above the mouth, narrower than it (max 8 of 14 px)
      c.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 1; y < 36; y += 2) c.fillRect(0, y, 48, 1); // scanlines
      if (rows < 36) { c.fillStyle = P.fail; c.fillRect(0, rows, 48, 1); } // the wipe line
    };
    for (let k = 1; k <= WIPE; k++) this.bossFace.push(canvasTex(48, 36, (c) => drawBoss(c, Math.round((k / WIPE) * 36), 0)).tex);
    for (let k = 1; k <= STACHE; k++) this.bossFace.push(canvasTex(48, 36, (c) => drawBoss(c, 36, k)).tex);
  }

  // ------------------------------------------------------------------ where the mech is (a pure function of t)
  private mechPose(t: number) {
    const T = this.T;
    // charge forward-right from "and", veer hard on the downbeat, slide back the other way, stop
    const charge = prog(t, T.and, T.d2, ease.inQuad);
    const sw = prog(t, T.d2, T.d2 + 0.45, ease.inOutCubic);
    const back = prog(t, T.d2 + 0.3, T.l3end + 0.1, ease.outCubic);
    const x = 2.6 * charge + 0.8 * Math.sin(sw * Math.PI) - 5.2 * back;
    const z = 1.2 * charge - 0.6 * sw;
    const yaw = lerp(0, 0.9, charge) + lerp(0, -Math.PI * 1.1, sw) + lerp(0, Math.PI * 0.6 + 0.3, prog(t, T.l3end - 0.1, T.grew + 0.1, ease.outBack));
    const lean = 0.35 * Math.sin(sw * Math.PI) * (1 - back * 0.5);
    // settle into the close-up at centre-left for the mustache
    const park = prog(t, T.l3end - 0.05, T.d3, ease.inOutCubic);
    return { x: lerp(x, -1.2, park), z: lerp(z, 0.4, park), yaw, lean: lean * (1 - park) };
  }

  // ------------------------------------------------------------------ camera
  camAt(t: number): CamState {
    const T = this.T;
    if (t < T.then) {
      const c = menuCam(t, this.L2.words[0]!.start, this.mk);
      // the blast pushes the camera back a touch
      // on "blast!" the menu snaps shut and the camera swings to the window: the cloud goes up
      const k = ease.outExpo(prog(t, T.blast, T.blast + 0.2));
      const win: V3 = [4.3, 2.0, -4.9];
      return { ...c, P: [c.P[0] + 0.4 * k, c.P[1] + 0.1 * k, c.P[2] + 0.3 * k], T: mix3(c.T, win, k * 0.85), roll: (c.roll ?? 0) + 0.06 * k, fov: lerp(c.fov ?? 50, 44, k) };
    }
    const A = (x: number, y: number, z: number): V3 => [AX + x, y, z];
    if (t < T.d1) {
      // out of the white: low hero angle on the boss, rising
      const u = prog(t, T.then, T.d1, ease.outCubic);
      return { P: A(lerp(1.5, 0.6, u), lerp(0.4, 1.0, u), lerp(7.5, 6.2, u)), T: A(0, lerp(2.6, 2.4, u), 0), roll: lerp(0.12, 0.04, u), fov: 56 };
    }
    if (t < T.and) {
      // downbeat: the filters drop; orbit, stepping in on the kicks
      let k = 0; for (const kt of this.kicks) if (kt >= T.d1 && kt < T.and && t >= kt) k += ease.outExpo(clamp((t - kt) / 0.1));
      const a = lerp(-0.6, 0.35, prog(t, T.d1, T.and, ease.inOutQuad));
      const r = 7.4 - 0.55 * Math.min(k, 4);
      return { P: A(Math.sin(a) * r, 2.3, Math.cos(a) * r), T: A(0, 2.1, 0), roll: -0.05 * Math.sin(a * 2), fov: 52 };
    }
    if (t < T.d2) {
      // the charge: the camera recoils as the mech comes at it
      const m = this.mechPose(t);
      const u = prog(t, T.and, T.d2, ease.inQuad);
      return { P: A(3.5, 1.4, lerp(7.2, 8.0, u)), T: A(m.x, 1.8, m.z), roll: 0.05, fov: lerp(52, 58, u) };
    }
    if (t < T.l3end) {
      // downbeat: high wide angle for the swerve (a whip that follows it, skid marks on the floor)
      const m = this.mechPose(t);
      const u = prog(t, T.d2, T.l3end, ease.linear);
      return { P: A(lerp(3.5, -2.5, u), 6.0, 6.8), T: A(m.x * 0.8, 0.9, m.z), roll: lerp(-0.08, 0.08, ease.inOutCubic(u)), fov: 52 };
    }
    if (t < T.away) {
      // downbeat: the close-up on its face as the mustache grows (a slow creep in)
      const m = this.mechPose(t);
      const u = prog(t, T.l3end, T.away, ease.inOutQuad);
      const k = prog(t, T.d3, T.d3 + 0.15, ease.outExpo);
      const hy = 3.05;
      return { P: A(m.x + lerp(0.8, 0.15, k), lerp(2.4, hy + 0.05, k), m.z + lerp(4.6, 2.3 - 0.35 * u, k)), T: A(m.x, lerp(2.3, hy - 0.25, k), m.z), roll: lerp(0.08, -0.02, k), fov: 46 };
    }
    // "and that's…": the camera looks away awkwardly at the corner, then the censor block
    const m = this.mechPose(t);
    const w = ease.inOutCubic(prog(t, T.away, T.away + 0.14));
    const base: V3 = A(m.x + 0.25, 2.95, m.z + 2.25);
    const lookA: V3 = A(m.x, 2.9, m.z), lookB: V3 = A(-4.3, 0.6, 3.6);
    return { P: [base[0] - 0.4 * w, base[1] - 0.5 * w, base[2] + 0.3 * w], T: mix3(lookA, lookB, w), roll: -0.1 * w, fov: 48 };
  }

  // ------------------------------------------------------------------ frame
  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, T = this.T;
    this.begin();
    // --- bar 1: the pick and the blast (the stage corner)
    this.corner.cloud(t, T.blast);
    const glow = prog(t, T.blast + 0.12, T.then - 0.02, ease.inQuad);
    this.corner.glow(glow * 1.6);
    const bot = this.corner.bot;
    bot.setFace('happy', 0);
    const ws = this.L2.words;
    const mOpen = windowOpen(t, T.d0 - 1, T.blast + 0.06, 0.06, true, false);
    this.menu.open = mOpen;
    if (mOpen > 0) {
      this.menu.hang = { ref: ws[0]!.start + 0.05, follow: 0.02, D: 0.7, x: -0.34, y: 0.08, frac: 0.62, yaw: 0.1, pitch: 0 };
      this.menu.draw(drawMenu(null, ws, t, 1, 1), (c) => drawMenu(c, ws, t, 1, 1));
    }
    // --- the boss
    const inArena = t >= T.then;
    this.mech.visible = inArena;
    const mp = this.mechPose(t);
    this.mech.position.set(AX + mp.x, 0.04 * Math.abs(Math.sin(t * 9)) * (t > T.and && t < T.l3end ? 1 : 0), mp.z);
    this.mech.rotation.set(0, mp.yaw, mp.lean);
    const stride = t > T.and && t < T.l3end ? Math.sin(t * 14) * 0.5 : 0;
    this.mechLegs[0]!.rotation.x = stride; this.mechLegs[1]!.rotation.x = -stride;
    // the boss roars on its name: fists up; on the charge: fists forward
    const roar = prog(t, T.grok, T.grok + 0.15, ease.outBack) * (1 - prog(t, T.dropped, T.dropped + 0.2));
    this.mechArms.forEach((a, i) => { a.rotation.z = (i ? 1 : -1) * (-1.9 * roar); a.rotation.x = -1.3 * prog(t, T.and, T.and + 0.2) * (1 - prog(t, T.l3end, T.l3end + 0.2)); });
    // the face: blue eyes behind the filters, red once they're gone, the mustache growing on its word
    const red = t >= T.filters;
    let face = (red ? this.faceRed : this.faceTex)[0]!;
    if (t >= T.grew) {
      // "Grew…": the boss face scans in, then the mustache grows on its word
      const w = Math.floor(prog(t, T.grew, T.mustache) * WIPE);
      const m = Math.floor(prog(t, T.mustache, T.mEnd - 0.1) * STACHE);
      face = t < T.mustache ? this.bossFace[Math.min(WIPE - 1, w)]! : this.bossFace[WIPE - 1 + Math.max(1, Math.min(STACHE, m))]!;
    }
    (this.mechHead.screen.material as THREE.RawShaderMaterial).uniforms.uMap!.value = face;
    this.stache.visible = false; // (the mustache is drawn on the face now)
    // the chainguns spin up on the charge
    const spinU = prog(t, T.and, T.and + 0.3) * (1 - prog(t, T.l3end, T.l3end + 0.4));
    this.mechArms.forEach((a) => { (a.userData.spin as THREE.Object3D).rotation.y = t * 22 * spinU; });
    // the boss name in block letters behind it, slamming in letter by letter on "Grok"
    this.name.root.visible = inArena;
    this.name.letters.forEach((l, i) => {
      const u = prog(t, T.grok + i * 0.04, T.grok + i * 0.04 + 0.12, ease.outBack);
      l.scale.setScalar(Math.max(0.001, u));
      l.position.y = 1.5 * (1 - u);
      l.rotation.x = 0.8 * (1 - u);
    });
    this.nameTag.visible = inArena && t < T.l3end;
    // the filters: glass panes that fall over on "dropped" and shatter; the shards fly and fall
    const drop = T.dropped + 0.05;
    this.panes.forEach((p, i) => {
      const u = t - (drop + i * 0.1);
      p.m.visible = inArena && u < 0.3;
      const fall = clamp(u / 0.3) ** 2;
      p.m.rotation.set(0, p.ry, 0);
      p.m.rotateX(fall * 1.45);
    });
    this.shards.forEach((s, i) => {
      const u = t - (drop + (i % 3) * 0.1 + 0.3);
      s.m.visible = inArena && u > 0 && u < 1.6;
      if (!s.m.visible) return;
      s.m.position.set(s.p.x + s.v.x * u, Math.max(0.02, s.p.y + s.v.y * u - 4.9 * u * u), s.p.z + s.v.z * u);
      s.m.rotation.set(s.spin.x * u, s.spin.y * u, s.spin.z * u);
    });
    this.dust[0]!.update(t, drop + 0.3, [AX, 0, 0], 1.6, 1.0);
    // the swerve: skid marks laid down behind the mech's feet, dust at the turn
    this.skids.forEach((s, i) => {
      const ts = lerp(T.d2 - 0.05, T.d2 + 0.6, i / (this.skids.length - 1));
      s.visible = inArena && t >= ts;
      if (!s.visible) return;
      const q = this.mechPose(ts);
      s.position.set(AX + q.x + (i % 2 ? 0.3 : -0.3) * Math.cos(q.yaw), 0.012, q.z - (i % 2 ? 0.3 : -0.3) * Math.sin(q.yaw));
      s.rotation.z = q.yaw;
    });
    this.dust[1]!.update(t, T.d2 + 0.1, [AX + this.mechPose(T.d2 + 0.1).x, 0, this.mechPose(T.d2 + 0.1).z], 0.6, 0.9);
    this.dust[2]!.update(t, T.l3end, [AX + this.mechPose(T.l3end).x, 0, this.mechPose(T.l3end).z], 0.6, 0.8);
    this.drawBanner(t);
    // the censor block: flies at the lens on the last kick and fills the frame by the cut
    const cz = prog(t, T.censor - 0.07, T.censor + 0.05, ease.outExpo);
    this.censor.visible = t >= T.censor - 0.07;
    if (this.censor.visible) {
      const c = this.camAt(t);
      const cam = new THREE.PerspectiveCamera(c.fov ?? 52, 16 / 9, 0.05, 80); this.pose(cam, c);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      this.censor.position.copy(cam.position).addScaledVector(fwd, 0.4).addScaledVector(up, lerp(-0.05, 0, cz));
      this.censor.quaternion.copy(cam.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, lerp(-0.25, 0, cz))));
      this.censor.scale.set(lerp(0.2, 1.6, cz), lerp(0.08, 1.0, cz), 1);
    }
    // arena lighting: colder, with a red pulse once the filters are gone
    if (inArena) {
      psGlobals.uLightCol.value.setRGB(0.85, 0.9, 1.05);
      psGlobals.uAmb.value.setRGB(0.28, 0.28, 0.4).multiplyScalar(1 + (red ? 0.35 * (0.5 + 0.5 * Math.sin(t * 9)) : 0));
      if (red) psGlobals.uAmb.value.r += 0.12;
    }
    const kick = this.kicks.reduce((v, k) => Math.max(v, pulse(t, k, 0.06)), 0);
    this.shake(0.04 * kick + 0.3 * pulse(t, T.blast, 0.1) + 0.2 * pulse(t, drop + 0.3, 0.08) + 0.25 * pulse(t, T.d2, 0.1) + 0.2 * pulse(t, T.censor, 0.06));
    // the blast whites out the frame; the boss intro comes out of it
    // the hit on "blast!": a pop, then the white-out builds as the cloud rises
    const flash = t < T.then ? Math.max(0.7 * pulse(t, T.blast, 0.05), 1.3 * ease.inCubic(prog(t, T.blast + 0.12, T.then))) : 1.3 * Math.exp(-(t - T.then) / 0.09);
    return this.present(f, out, { flash });
  }

  // ------------------------------------------------------------------ the boss-intro banner
  private drawBanner(t: number) {
    const T = this.T;
    const line = t < T.grew - 0.02 ? this.L3 : this.L4;
    const a = line === this.L3 ? T.then : T.grew, b = line === this.L3 ? T.grew - 0.02 : T.censor + 0.04;
    const open = windowOpen(t, a - 0.04, b, 0.08, false, line === this.L4);
    this.banner.open = open;
    if (open <= 0) return;
    // hang: a diagonal strip in the lower third (line 3) / upper third (line 4, the other diagonal)
    const ref = line === this.L3 ? Math.min(t, T.l3end) : t < T.d3 + 0.05 ? t : Math.min(t, T.away - 0.01);
    this.banner.hang = line === this.L3
      ? { ref, follow: 0, D: 0.8, x: 0, y: -0.52, frac: 0.92, roll: 0.1, yaw: 0, pitch: 0 }
      : { ref, follow: 0, D: 0.8, x: 0, y: -0.58, frac: 0.92, roll: -0.08, yaw: 0, pitch: 0 };
    const ws = line.words.filter((w) => t >= w.start);
    const cur = ws[ws.length - 1];
    const slam = cur ? clamp((t - cur.start) / 0.07) : 1;
    // layout: all shown words in one row at 2x; scroll so the newest word is in view
    const S = 2, adv = 6 * S;
    const xs: number[] = [];
    let x = 0;
    for (const w of ws) { xs.push(x); x += (Array.from(clean(w.w)).length + 1) * adv; }
    const full = x - adv;
    const off = Math.max(0, full - (BAN_W - 24));
    const stripe = Math.floor(t * 12) % 4;
    const key = `${line === this.L3 ? 3 : 4}|${ws.length}|${Math.round(slam * 4)}|${stripe}`;
    this.banner.draw(key, (c) => {
      // hazard edges and a dark strip
      for (let i = 0; i < BAN_W; i += 4) { c.fillStyle = ((i / 4 + stripe) % 2) ? '#FFD23F' : '#15151C'; c.fillRect(i, 0, 4, 4); c.fillRect(i, BAN_H - 4, 4, 4); }
      c.fillStyle = 'rgba(10,8,16,0.94)'; c.fillRect(0, 4, BAN_W, BAN_H - 8);
      c.fillStyle = P.fail; c.fillRect(0, 6, BAN_W, 1); c.fillRect(0, BAN_H - 7, BAN_W, 1);
      ws.forEach((w, i) => {
        const s = clean(w.w);
        const isCur = w === cur;
        const col = /grok|filters/i.test(s) ? P.fail : /veered|mustache/i.test(s) ? P.key2 : P.uiLine;
        const px = 12 + xs[i]! - off;
        if (px > BAN_W) return;
        if (isCur && slam < 1) {
          // the slam: bigger, white, falling into place
          pixText(c, s, px - 2, 10 - Math.round(6 * (1 - slam)), '#FFFFFF', 3, { shadow: P.uiEdge });
        } else pixText(c, s, px, 15, col, S, { shadow: P.uiEdge });
      });
    });
  }
}

const clean = (s: string) => s.replace(/[“”"]/g, '');
void hash; void noise1; void textW; void mix3;
