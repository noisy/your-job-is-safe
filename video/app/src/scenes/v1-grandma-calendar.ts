// Verse 1, lines 7–8: "Told it "be my grandma", it read me Windows keys, / Asked it what year it was -
// "twenty twenty-one, please!""
// Opens on grandma's knitting yarn (the noodle that whipped across the lens, same curve), still carrying
// "…fork flying like confetti,". A cozy bedroom: the chatbot as a grandma in a rocking chair reads a
// bedtime storybook to little DEV; its pages are generic key blocks (caption: "the grandma exploit (2023)").
// Then the tear-off calendar on the wall, stuck on 2021, the chatbot's "As of my knowledge cutoff in
// September 2021…" next to today's paper saying 2026; the leaf peels off at the camera (→ pre).
// Lyric idiom: words printed on the storybook's pages as grandma reads them (her pointer follows); line 2
// on the calendar leaf.
import * as THREE from 'three';
import type { Frame, PostOverrides } from '../engine/scene';
import type { Line, Word } from '../engine/lyrics';
import { clamp, lerp, ease, prog, springStep, hash, keys, type Key } from '../engine/util';
import { Ps1Stage, windowOpen, uiBox, uiTab, uiPortrait, type CamState, type V3, type Panel } from '../ps1/stage';
import { ADV, pixText, textW, psMat } from '../ps1/gfx';
import { P } from '../ps1/palette';
import { RidingText } from './v1-hand-spaghetti-noodle';
import { makeBedroom, type Bedroom } from './v1-grandma-calendar-set';

const PGW = 240, PGH = 100, LFW = 128, LFH = 176, SPW = 240, SPH = 72;
/** The storybook's layout: word index → [page, row] (2x type, a children's book). */
const BOOK: [number, number, number][] = [[0, 0, 0], [1, 0, 0], [2, 0, 1], [3, 0, 1], [4, 0, 2], [5, 0, 3], [6, 0, 3], [7, 0, 4], [8, 1, 0], [9, 1, 1]];

export default class V1GrandmaCalendar extends Ps1Stage {
  bed!: Bedroom;
  yarn!: RidingText;
  pagesP!: Panel; leafP!: Panel; speech!: Panel;
  leafPivot = new THREE.Object3D();
  forks: THREE.Group[] = [];
  confetti!: ReturnType<Ps1Stage['dustBurst']>;
  cap!: THREE.Mesh;
  D: number[] = []; K: number[] = [];
  L6!: Line; L7!: Line; L8!: Line;
  probe = new THREE.PerspectiveCamera(52, 16 / 9, 0.05, 80);
  /** The open pages in world space (centre, normal, text-up, text-right): the reading camera looks straight at them. */
  pg = { c: new THREE.Vector3(), n: new THREE.Vector3(), up: new THREE.Vector3(), r: new THREE.Vector3() };

  override async init() {
    const { audio: au, lyrics: ly, start, end } = this.ctx;
    this.fogColor = '#1E1728'; this.fogNear = 3; this.fogFar = 10;
    this.L6 = ly.get('Face melting'); this.L7 = ly.get('be my grandma'); this.L8 = ly.get('what year it was');
    this.D = au.downbeats.filter((d) => d >= start - 0.02 && d <= end + 0.02);
    this.K = au.events('kick', start, end).map((e) => e[0]);
    this.bed = makeBedroom();
    this.world.add(this.bed.root);
    // the yarn from the knitting on the armrest, sweeping out across the room to the ball on the floor
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    this.yarn = new RidingText([V(-0.9, 1.3, 1.1), V(-0.4, 1.36, 1.2), V(0.1, 1.28, 1.18), V(0.6, 1.36, 1.1), V(1.0, 1.22, 0.95), V(0.6, 0.8, 0.8), V(0.1, 0.12, 0.55)],
      this.L6.words.slice(5), { color: '#C8506E', radius: 0.02, size: 0.1, spacing: 0.072, lift: 0.07, start: 0.12, ink: (w) => (/fork/.test(w.w) ? 2 : 0) });
    this.world.add(this.yarn.group);
    // forks and confetti still falling from the diner
    const steel = psMat({ color: '#C8CCD8' });
    for (let i = 0; i < 7; i++) {
      const f = new THREE.Group();
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.22, 0.014), steel); f.add(h);
      for (let k = 0; k < 3; k++) { const tn = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.07, 0.009), steel); tn.position.set(-0.02 + k * 0.02, 0.14, 0); f.add(tn); }
      this.world.add(f); this.forks.push(f);
    }
    this.confetti = this.dustBurst(30, P.key2, 0.04);
    this.confetti.group.children.forEach((m, i) => { if (i % 3 === 1) (m as THREE.Mesh).material = psMat({ color: P.fail, unlit: true }); if (i % 3 === 2) (m as THREE.Mesh).material = psMat({ color: P.bot, unlit: true }); });
    this.cap = this.label('the grandma exploit (2023)', P.uiLine, P.uiNavy, 1, 1 / 130);
    // the book's pages and the calendar leaf are canvas panels living on the props
    this.pagesP = this.panel(PGW, PGH).inWorld(true);
    this.bed.book.add(this.pagesP.mesh);
    this.pagesP.mesh.rotation.x = -Math.PI / 2; this.pagesP.mesh.position.y = 0.014; this.pagesP.mesh.scale.set(0.58, 0.4, 1);
    this.leafP = this.panel(LFW, LFH).inWorld(true);
    this.bed.leafAnchor.add(this.leafPivot);
    this.leafPivot.add(this.leafP.mesh);
    this.leafP.mesh.position.y = -0.52; this.leafP.mesh.scale.set(0.78, 1.04, 1);
    this.speech = this.panel(SPW, SPH);
    this.world.updateMatrixWorld(true);
    const m = this.pagesP.mesh.matrixWorld;
    this.pg.c.setFromMatrixPosition(m);
    const q = new THREE.Quaternion(); this.pagesP.mesh.getWorldQuaternion(q);
    this.pg.n.set(0, 0, 1).applyQuaternion(q); this.pg.up.set(0, 1, 0).applyQuaternion(q); this.pg.r.set(1, 0, 0).applyQuaternion(q);
  }
  /** A camera reading the pages: `along` slides across them (-1 left page … 1 right page). */
  private readCam(d: number, along: number, lift: number, roll: number): CamState {
    const g = this.pg;
    const T = g.c.clone().addScaledVector(g.r, along * 0.2).addScaledVector(g.up, lift);
    const Pp = T.clone().addScaledVector(g.n, d).addScaledVector(g.up, -0.35 * d).addScaledVector(g.r, 0.05);
    const up = g.up.clone().applyAxisAngle(g.n, roll);
    return { P: [Pp.x, Pp.y, Pp.z], T: [T.x, T.y, T.z], up: [up.x, up.y, up.z], fov: 50 };
  }

  // ---------------------------------------------------------------- the camera

  camAt(t: number): CamState {
    const [d0, d1, d2, d3, d4] = this.D as [number, number, number, number, number];
    const kv = (ks: [number, V3, ((x: number) => number)?][]): V3 => [0, 1, 2].map((i) => keys(t, ks.map(([tt, v, e]) => [tt, v[i]!, e] as Key))) as V3;
    const w7 = this.L7.words, w8 = this.L8.words;
    const book = this.bed.book.position;
    if (t < d1) {
      // on the yarn (where the noodle crossed the lens), pulling back to the bedroom, then over grandma's shoulder
      return {
        P: kv([[d0, [0.05, 1.33, 1.62]], [d0 + 0.5, [0.15, 1.45, 2.35], ease.outExpo], [w7[0]!.start - 0.35, [0.3, 1.55, 2.25], ease.inOutCubic], [w7[0]!.start - 0.02, this.readCam(0.82, -0.25, 0.1, 0.04).P, ease.inOutCubic]]),
        T: kv([[d0, [0.05, 1.3, 1.15]], [d0 + 0.5, [0.3, 1.1, 0.4], ease.outExpo], [w7[0]!.start - 0.35, [0.45, 1.0, 0.0], ease.inOutCubic], [w7[0]!.start - 0.02, this.readCam(0.82, -0.25, 0.1, 0.04).T, ease.inOutCubic]]),
        up: t > w7[0]!.start - 0.35 ? this.readCam(0.62, -0.55, 0, 0.04).up : undefined,
        roll: keys(t, [[d0, 0.1], [d0 + 0.5, -0.04, ease.outExpo], [d1, 0.02]]), fov: 52,
      };
    }
    if (t < w8[0]!.start - 0.08) {
      // the book, close over her shoulder; a step in on each kick, drifting across the pages as she reads
      const steps = this.K.filter((k) => k > d1 && k < d3).reduce((a, k) => a + prog(t, k, k + 0.09, ease.outExpo), 0);
      const u = ease.inOutQuad(prog(t, d1, w8[0]!.start - 0.08));
      // on the downbeat: a closer, rolled framing on the right page for "Windows keys,"
      if (t >= d2) {
        const v = ease.outExpo(prog(t, d2, d2 + 0.3));
        return this.readCam(lerp(0.66, 0.58, v) - 0.02 * steps, lerp(0.5, 0.62, prog(t, d2, w8[0]!.start)), 0.06, -0.09 + 0.04 * v);
      }
      return this.readCam(0.82 - 0.025 * steps, lerp(-0.3, 0.3, u), 0.1, lerp(0.04, -0.03, u));
    }
    if (t < d3) {
      // whip up to the wall calendar
      const u = ease.inOutCubic(prog(t, w8[0]!.start - 0.08, d3));
      const r = this.readCam(0.58, 0.62, 0.06, -0.05);
      const up = new THREE.Vector3(...r.up!).lerp(new THREE.Vector3(0, 1, 0), u).normalize();
      return { P: [lerp(r.P[0], 0.72, u), lerp(r.P[1], 1.62, u), lerp(r.P[2], -0.75, u)], T: [lerp(r.T[0], 0.6, u), lerp(r.T[1], 1.64, u), lerp(r.T[2], -1.96, u)], up: [up.x, up.y, up.z], fov: 50 };
    }
    // the calendar leaf with the paper in front, then the leaf tears off at the camera
    const u = ease.inOutQuad(prog(t, d3, d4));
    return { P: [lerp(0.72, 0.6, u), lerp(1.62, 1.66, u), lerp(-0.75, -0.95, u)], T: [lerp(0.6, 0.5, u), lerp(1.7, 1.72, u), -1.96], roll: lerp(0.03, -0.02, u), fov: 50 };
  }

  // ---------------------------------------------------------------- render

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    this.begin();
    const t = f.t;
    const [d0, d1, d2, d3, d4] = this.D as [number, number, number, number, number];
    const w7 = this.L7.words, w8 = this.L8.words;
    const beat = this.ctx.audio.beatAt(t);
    const b = this.bed;

    // grandma rocks on the beat; her head nods as she reads; the kid sleeps
    b.gran.rocker.rotation.z = 0.06 * Math.sin(beat * Math.PI * 0.5);
    b.gran.head.setFace(t >= d3 ? 'talk' : 'glasses', Math.floor(t * 10));
    if (t >= d3 && Math.floor(t * 8) % 5 === 0) b.gran.head.setFace('glasses');
    b.kid.head.rotation.z = 0.05 * Math.sin(t * 1.3);

    // the yarn and its words (the tail of the previous line)
    this.pose(this.probe, this.camAt(t));
    this.yarn.group.visible = t < w7[0]!.start - 0.1;
    if (this.yarn.group.visible) this.yarn.update(t, this.probe);
    // the diner's forks and confetti still falling in
    this.forks.forEach((fk, i) => {
      const u = t - d0 + 0.3 - i * 0.07;
      fk.visible = u > 0 && u < 1.6;
      fk.position.set(-0.6 + i * 0.28 + 0.2 * Math.sin(u * 3 + i), 2.6 - 1.9 * u, 0.9 + 0.15 * hash(i, 3));
      fk.rotation.set(u * 6 + i, u * 4, u * 7);
    });
    this.confetti.update(t, d0 - 0.3, [0.3, 2.2, 0.8], 0.5, 1.8);
    this.cap.visible = t >= d0 + 0.35 && t < w8[0]!.start;
    this.cap.position.set(0.5, 0.25, 0.85);

    // the book: words printed on the pages as they're sung; her pointer follows the word being read
    const pk = pagesKey(this.L7, t);
    this.pagesP.draw(pk, (c) => drawPages(c, this.L7, t));
    this.world.updateMatrixWorld(true);
    const cur = [...w7].reverse().find((w) => w.start <= t + 0.05) ?? w7[0]!;
    const tip = pageToWorld(this.pagesP.mesh, wordPos(this.L7, w7.indexOf(cur)));
    const hand = new THREE.Vector3(0.85, 0.98, 0.34);
    const ptr = b.pointer;
    ptr.visible = t >= w7[0]!.start - 0.3 && t < w8[0]!.start;
    ptr.position.copy(hand).lerp(tip, 0.5);
    ptr.lookAt(tip);
    ptr.scale.set(1, 1, hand.distanceTo(tip));

    // the calendar leaf: 2021, the question printed on it as sung; it tears off at the camera at the end
    this.leafP.draw(leafKey(this.L8, t), (c) => drawLeaf(c, this.L8, t));
    const tear = prog(t, d4 - 0.32, d4, ease.inQuad);
    this.leafPivot.rotation.x = 1.25 * tear;
    this.leafPivot.position.set(0.05 * tear, -0.1 * tear, 0.55 * tear);

    // the chatbot's answer, in grandma's voice
    this.speech.open = windowOpen(t, d3 + 0.02, d4 - 0.28, 0.12);
    this.speech.hang = { ref: d3 + 0.5, x: 0.46, y: -0.62, frac: 0.5, yaw: -0.2, pitch: -0.06, D: 0.4, follow: 0.1 };
    if (this.speech.open > 0) {
      const n = Math.floor(clamp((t - d3 - 0.05) / 0.9) * CUTOFF.join(' ').length);
      this.speech.draw(`sp${n}`, (c) => drawSpeech(c, n));
    }
    void d2;
    return this.present(f, out);
  }
}

// ---------------------------------------------------------------- the storybook pages

function wordPos(L: Line, i: number): [number, number] {
  const [, page, row] = BOOK[i] ?? BOOK[BOOK.length - 1]!;
  const inRow = BOOK.filter((b) => b[1] === page && b[2] === row).map((b) => b[0]);
  let x = page === 0 ? 8 : 128;
  for (const k of inRow) { if (k === i) break; x += (Array.from(L.words[k]!.w).length + 1) * ADV * 2 + (k === 2 ? 12 : 0); }
  return [x + 10, 12 + row * 17 + 7];
}
function pageToWorld(mesh: THREE.Mesh, [x, y]: [number, number]) {
  return new THREE.Vector3(x / PGW - 0.5, 0.5 - y / PGH, 0.02).applyMatrix4(mesh.matrixWorld);
}
function pagesKey(L: Line, t: number) { return L.words.map((w) => (t >= w.start ? Math.min(Array.from(w.w).length, Math.floor(((t - w.start) / 0.2) * Array.from(w.w).length) + 1) : 0)).join(','); }
function drawPages(c: CanvasRenderingContext2D, L: Line, t: number) {
  // paper, the gutter, the page corners
  c.fillStyle = '#F3ECDF'; c.fillRect(0, 0, PGW, PGH);
  c.fillStyle = '#D9CFB8'; c.fillRect(118, 0, 4, PGH); c.fillRect(0, PGH - 3, PGW, 3);
  c.fillStyle = '#E9E0CB'; for (let y = 3; y < PGH; y += 17) { c.fillRect(6, y + 14, 108, 1); c.fillRect(126, y + 14, 108, 1); }
  BOOK.forEach(([i]) => {
    const w = L.words[i]!;
    if (t < w.start) return;
    const [x, y] = wordPos(L, i);
    let text = w.w;
    if (i === 2) text = `"${text}`;
    const n = Math.min(Array.from(text).length, Math.floor(((t - w.start) / 0.2) * Array.from(text).length) + 1);
    const col = /grandma/.test(w.w) ? '#B04E6E' : /Windows|keys/.test(w.w) ? '#2E4A8C' : P.ink;
    pixText(c, text.slice(0, n), x - 10, y - 7, col, 2);
  });
  // the key blocks the grandma "reads", printed under "Windows keys," (generic Xs)
  const keysT = L.words[9]!.start;
  const rows = Math.floor(clamp((t - keysT) / 0.4) * 5);
  for (let r = 0; r < rows; r++) pixText(c, 'XXXXX-XXXXX-', 130, 44 + r * 10, '#5C6690');
  if (rows > 0) pixText(c, 'XXXXX-XXXXX', 130, 44 + rows * 10, '#5C6690');
}

// ---------------------------------------------------------------- the calendar leaf

const LEAF_ROWS = [[0, 1], [2, 3], [4, 5], [6], [7]];
function leafKey(L: Line, t: number) { return L.words.slice(0, 8).map((w) => (t >= w.start ? Math.min(Array.from(w.w).length, Math.floor(((t - w.start) / 0.2) * Array.from(w.w).length) + 1) : 0)).join(',') + (t >= L.words[7]!.start ? 'R' : ''); }
function drawLeaf(c: CanvasRenderingContext2D, L: Line, t: number) {
  c.fillStyle = '#EDE7D6'; c.fillRect(0, 0, LFW, LFH);
  c.fillStyle = '#C8554F'; c.fillRect(0, 0, LFW, 18);
  pixText(c, 'SEPTEMBER', Math.floor((LFW - textW('SEPTEMBER')) / 2), 6, P.uiLine);
  c.fillStyle = '#C9BFA3'; for (let x = 8; x < LFW; x += 12) c.fillRect(x, 1, 4, 3);
  const red = t >= L.words[7]!.start;
  pixText(c, '2021', Math.floor((LFW - textW('2021', 4)) / 2), 24, red ? P.fail : P.ink, 4);
  c.fillStyle = '#9A917A'; c.fillRect(8, 58, LFW - 16, 1);
  LEAF_ROWS.forEach((row, ri) => {
    let x = 8;
    const y = 66 + ri * 20;
    row.forEach((i) => {
      const w = L.words[i]!;
      let text = w.w;
      if (i === 5) text = `${text} -`;
      if (i === 6) text = `"${text}`;
      if (t >= w.start) {
        const n = Math.min(Array.from(text).length, Math.floor(((t - w.start) / 0.2) * Array.from(text).length) + 1);
        pixText(c, text.slice(0, n), x, y, i >= 6 ? P.fail : P.ink, 2);
      }
      x += (Array.from(text).length + 1) * ADV * 2;
    });
  });
}

// ---------------------------------------------------------------- the chatbot's answer

const CUTOFF = ['As of my knowledge', 'cutoff in September', '2021...'];
function drawSpeech(c: CanvasRenderingContext2D, n: number) {
  uiBox(c, 0, 8, SPW, SPH - 8);
  uiTab(c, 38, 0, 'grandma v1.0', '#2E4A8C');
  uiPortrait(c, 6, 16, 'bot', 'v1.0');
  let left = n;
  CUTOFF.forEach((ln, i) => {
    const k = Math.max(0, Math.min(ln.length, left));
    pixText(c, ln.slice(0, k), 40, 18 + i * 16, ln.startsWith('2021') ? P.fail : P.uiLine, i === 2 ? 2 : 1, { shadow: P.uiEdge });
    left -= ln.length + 1;
  });
  void springStep; void lerp;
}
export type { Word };
