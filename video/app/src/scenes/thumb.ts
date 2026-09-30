// YouTube thumbnails: 30 still compositions staged with the video's own models (DEV, the chatbot heads and
// bodies, the strawberry, the wine glass, clocks, the duck, the box, the kitchen), framed for a 16:9 thumbnail:
// big faces, one clear idea, a 1–3 word headline in 3D block letters. Rendered with `?thumb=N` (1..30) by
// scripts/thumbs3d.ts. Everything is a pure function of the thumbnail number (nothing animates).
import * as THREE from 'three';
import type { Frame } from '../engine/scene';
import { Ps1Stage, uiBox, uiTab, type CamState, type V3 } from '../ps1/stage';
import { makeDev, makeBotHead, makeBotBody, makeRoom, makeClock, makeDuck, type Dev, type DevFace, type BotFace } from '../ps1/cast';
import { psMat, psGlobals, pixText, textW, LW, LH } from '../ps1/gfx';
import { P } from '../ps1/palette';
import { makeStrawberry, makeWineGlass } from './chorus-count-props';
import { makeBigClock, makeHand, makeCardboardBox, makeHourglass } from './chorus-clocks-set';
import { makeBed, makeToyBot, drawPlaque, PLAQ_W, PLAQ_H } from './chorus-sleep-set';
import { makeKitchen } from './plumber-set';
import { makeSunburst, drawLeaf } from './intro-props';
import { makeSlopMachine } from './pre-props';
import { drawPR } from './breakdown-props';

type Title = { s: string; x: number; y: number; w: number; cap?: string; side?: string; rot?: number };
type Comp = { fog: string; cam: CamState; titles: Title[]; build: (s: ThumbScene) => void; light?: (s: ThumbScene) => void };

const RED: [string, string] = [P.fail, P.failSide], GRN: [string, string] = [P.fix, P.fixSide], YEL: [string, string] = [P.title, P.titleSide];
const WHT: [string, string] = ['#F3ECDF', '#8C93B8'];
const SAFE = 0.93; // headlines stay inside this fraction of the half-frame
const t = (s: string, x: number, y: number, w: number, c: [string, string] = YEL, rot = 0): Title => ({ s, x, y, w, cap: c[0], side: c[1], rot });

export default class ThumbScene extends Ps1Stage {
  comp!: Comp;
  n = 1;

  // ---------------------------------------------------------------- builders
  dev(x: number, z: number, face: DevFace, o: { ry?: number; outfit?: 'hoodie' | 'overalls' | 'pyjamas'; sit?: boolean; y?: number; s?: number } = {}): Dev {
    const d = makeDev(); d.setFace(face);
    if (o.outfit) d.outfit(o.outfit);
    d.sit(!!o.sit);
    d.root.position.set(x, o.y ?? 0, z); d.root.rotation.y = o.ry ?? Math.PI; d.root.scale.setScalar(o.s ?? 1);
    this.world.add(d.root);
    return d;
  }
  bot(x: number, y: number, z: number, face: BotFace, o: { ver?: string; s?: number; ry?: number; body?: string; cap?: boolean } = {}) {
    const h = makeBotHead(o.ver ?? 'v5.0'); h.setFace(face);
    h.screen.position.z += 0.03;
    let root: THREE.Object3D = h.root;
    let body: ReturnType<typeof makeBotBody> | null = null;
    if (o.body) { body = makeBotBody(o.body); body.neck.add(h.root); root = body.root; }
    if (o.cap) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.12, 0.56), psMat({ color: P.fail })); cap.position.set(0, 0.56, 0.02); h.root.add(cap);
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.04, 0.22), psMat({ color: P.failSide })); brim.position.set(0, 0.51, 0.35); h.root.add(brim);
    }
    root.position.set(x, y, z); root.rotation.y = o.ry ?? 0; root.scale.setScalar(o.s ?? 1);
    this.world.add(root);
    return { head: h, body, root };
  }
  wrench(parent: THREE.Object3D, y = -0.6) {
    const g = new THREE.Group(), steel = psMat({ color: '#B8BECC' });
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.5, 0.05), steel); a.position.y = -0.2; g.add(a);
    const j = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.06), steel); j.position.y = -0.46; g.add(j);
    g.position.y = y; parent.add(g); return g;
  }
  burst(a: string, b: string, z = -6, r = 18, n = 18) { const s = makeSunburst(n, a, b, r); s.position.set(0, 1.2, z); this.world.add(s); return s; }
  floor(col: string, y = 0) { const f = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), psMat({ color: col })); f.rotation.x = -Math.PI / 2; f.position.y = y; this.world.add(f); return f; }
  add<T extends THREE.Object3D>(o: T, x: number, y: number, z: number, s = 1, ry = 0) { o.position.set(x, y, z); o.scale.setScalar(s); o.rotation.y = ry; this.world.add(o); return o; }
  /** A UI window with pixel text hung in front of the camera (x, y: -1..1 of the frame; frac: width fraction). */
  win(lines: string[], x: number, y: number, frac: number, o: { tab?: string; tabCol?: string; col?: (i: number) => string; scale?: number; yaw?: number } = {}) {
    const sc = o.scale ?? 2;
    const w = Math.max(...lines.map((l) => textW(l, sc))) + 16, h = lines.length * (9 * sc) + 14 + (o.tab ? 8 : 0);
    const p = this.panel(w, h);
    p.draw('x', (c) => {
      const y0 = o.tab ? 8 : 0;
      uiBox(c, 0, y0, w, h - y0);
      if (o.tab) uiTab(c, 8, 0, o.tab, o.tabCol ?? P.uiNavy);
      lines.forEach((l, i) => pixText(c, l, 8, y0 + 7 + i * 9 * sc, o.col?.(i) ?? P.uiLine, sc, { shadow: P.uiEdge }));
    });
    p.hang = { ref: 0, x, y, frac, D: 1.0, yaw: o.yaw ?? 0 };
    return p;
  }

  // ---------------------------------------------------------------- the 30 compositions
  comps(): Comp[] {
    const s = this;
    return [
      // 1: the smug programmer and the strawberry: "2 R's?"
      { fog: '#1B1030', cam: { P: [0, 1.4, 2.1], T: [0, 1.3, 0], fov: 48 }, titles: [t("2 R'S?", 0.5, 0.62, 0.52, RED, -0.06)],
        build: () => { s.burst('#3A1440', '#1B1030'); s.dev(-0.95, 0.4, 'smug', { ry: Math.PI - 0.35 }); s.add(makeStrawberry(), 0.55, 0.85, -0.3, 0.42, 0.4); s.bot(1.15, 0.55, 0.2, 'wrong', { s: 0.75, ry: -0.5 }); s.win(["There are 2 R's", 'in "strawberry".'], 0.46, -0.62, 0.44, { tab: 'chatbot', col: (i) => (i === 0 ? P.key2 : P.uiLine) }); } },
      // 2: YOUR JOB IS SAFE? a colossal chatbot head looming over the programmer
      { fog: '#07060C', cam: { P: [0.7, 0.8, 3.4], T: [0.2, 1.6, 0], fov: 56 }, titles: [t('SAFE?', 0.5, 0.66, 0.36, WHT)],
        build: () => { s.bot(-1.1, 0.5, -2.6, 'focused', { s: 5.2, ver: 'v6.0', ry: 0.15 }); s.dev(0.95, 1.6, 'smug', { ry: Math.PI + 0.3 }); s.floor('#141B2E'); } },
      // 3: MOVE ASIDE: the robot plumber shoving DEV out of the frame
      { fog: '#1B2238', cam: { P: [0, 1.25, 3.0], T: [0, 1.15, 0], fov: 52 }, titles: [t('MOVE ASIDE', 0, 0.7, 0.7, RED)],
        build: () => { s.floor('#8C93B8'); const r = s.bot(0.55, 0, 0, 'focused', { ver: 'v6.0', body: '#3D5A9A', cap: true, ry: -0.35 }); r.body!.armL.rotation.x = -1.3; r.body!.armL.rotation.z = 0.4; s.wrench(r.body!.armR);
          const d = s.dev(-0.8, 0.5, 'scared', { outfit: 'overalls', ry: Math.PI - 0.45 }); d.root.rotation.z = 0.45; d.armL.rotation.set(0, 0, -1.9); d.armR.rotation.set(0, 0, 1.4); } },
      // 4: HOW MANY R's? a giant strawberry with the three R's floating round it
      { fog: '#20102A', cam: { P: [0, 1.3, 4.2], T: [0, 1.2, 0], fov: 50 }, titles: [t('R', -1.0, 0.1, 0.13, RED, 0.2), t('R', 0.72, 0.35, 0.13, RED, -0.2), t('R', 0.6, -0.45, 0.13, RED, 0.15), t('HOW MANY?', 0, 0.72, 0.62, YEL)],
        build: () => { s.burst('#3A1430', '#20102A'); s.add(makeStrawberry(), 0, 0.2, -0.2, 1.05, 0.5); s.bot(-1.35, 0.05, 0.5, 'think', { s: 0.8, ry: 0.5 }); } },
      // 5: FILLED TO THE BRIM? the half-full glass, DEV laughing at it
      { fog: '#161A30', cam: { P: [0, 1.45, 2.7], T: [0, 1.3, 0], fov: 50 }, titles: [t('BRIM?', 0.55, 0.64, 0.4, YEL, -0.05)],
        build: () => { s.burst('#262E58', '#161A30'); const g = makeWineGlass(); g.fill(0.8, 0, 0); g.brim.visible = true; s.add(g.root, 0.5, 0.25, 0, 1.0); const d = s.dev(-0.8, 1.1, 'laugh', { ry: Math.PI - 0.4 }); d.armR.rotation.set(-1.4, 0, 0.3); } },
      // 6: IT LEARNED: the glass overflowing onto DEV
      { fog: '#1A0E16', cam: { P: [0, 1.6, 3.1], T: [0, 1.5, 0], fov: 50 }, titles: [t('IT LEARNED.', 0, -0.72, 0.66, RED)],
        build: () => { s.burst('#3A1020', '#1A0E16'); const g = makeWineGlass(); g.fill(1.14, 1, 0.3); s.add(g.root, 0.3, 1.5, -0.4, 0.8); s.dev(-0.25, 0.9, 'scared'); } },
      // 7: 10:10 FOREVER: the giant clock behind the smug programmer
      { fog: '#1E2A20', cam: { P: [0.3, 1.3, 3.6], T: [0.2, 1.4, 0], fov: 52 }, titles: [t('10:10', -0.6, 0.5, 0.33, YEL), t('FOREVER', -0.6, 0.18, 0.33, WHT)],
        build: () => { const ck = makeBigClock(1.7); ck.hour.rotation.z = -((10 + 10 / 60) / 12) * Math.PI * 2; ck.minute.rotation.z = -(10 / 60) * Math.PI * 2; s.add(ck.root, 1.25, 1.9, -1.4); s.dev(0.55, 0.9, 'smug', { ry: Math.PI + 0.3 }); const hg = makeHourglass(); s.add(hg.root, -1.25, 0, 0.6, 0.9); s.floor('#3A2A1E'); } },
      // 8: 6 FINGERS: the six-fingered AI hand waving at DEV
      { fog: '#142018', cam: { P: [0, 1.4, 3.4], T: [0, 1.4, 0], fov: 52 }, titles: [t('6 FINGERS', 0.3, 0.7, 0.58, YEL)],
        build: () => { s.burst('#1F3A28', '#142018'); const h = makeHand(6); s.add(h.root, -0.95, 0.6, 0.2, 0.75, 0.2); s.dev(0.95, 0.8, 'laugh', { ry: Math.PI + 0.45 }); } },
      // 9: FIRED BY AI: the robot packs DEV's desk into a box, the plaque sticking out
      { fog: '#1E1A16', cam: { P: [0.1, 1.3, 3.2], T: [0, 1.0, 0], fov: 54 }, titles: [t('REPLACED', 0, 0.7, 0.62, RED)],
        build: () => { s.floor('#2A3C5E'); s.add(makeCardboardBox(1.0, 0.55, 0.65), -0.3, 0, 0.5); const pl = s.panel(PLAQ_W, PLAQ_H).inWorld(); pl.draw('p', (c) => drawPlaque(c, [{ text: 'SENIOR DEV', x: 20, y: 30 }])); pl.hang = null; pl.mesh.position.set(-0.28, 0.72, 0.6); pl.mesh.rotation.set(-0.3, 0, 0.25); pl.mesh.scale.set(PLAQ_W * 0.0062, PLAQ_H * 0.0062, 1);
          s.bot(0.95, 0, 0, 'happy', { body: '#8A93A8', ry: -0.4 }); s.dev(-1.15, 0.2, 'sad', { ry: Math.PI - 0.5 }); } },
      // 10: PLAN B: DEV the plumber, wrench raised, in front of the sink
      { fog: '#2A3048', cam: { P: [0.1, 1.35, 2.3], T: [0.2, 1.35, 0], fov: 50 }, titles: [t('PLAN B:', -0.55, 0.62, 0.36, RED), t('PLUMBER', 0.3, -0.72, 0.5, YEL, -0.04)],
        build: () => { const k = makeKitchen(); s.add(k.root, 0, 0, 1.4); const d = s.dev(0.35, 0.3, 'smug', { outfit: 'overalls' }); d.armR.rotation.set(-2.9, 0, -0.2); s.wrench(d.armR, -0.62); } },
      // 11: GAME OVER: the robot plumber standing over DEV on the floor
      { fog: '#0C0C14', cam: { P: [-0.2, 0.9, 2.6], T: [0.2, 0.75, 0], fov: 56 }, titles: [t('GAME OVER', 0, 0.68, 0.7, RED)],
        build: () => { s.floor('#C9C4B4'); const r = s.bot(0.75, 0, -0.3, 'happy', { ver: 'v6.0', body: '#3D5A9A', cap: true, ry: -0.3 }); s.wrench(r.body!.armR); const d = makeDev(); d.outfit('overalls'); d.setFace('shock'); d.root.rotation.x = Math.PI / 2; d.armL.rotation.z = -1.2; d.armR.rotation.z = 1.2; const g = new THREE.Group(); g.add(d.root); g.rotation.y = -Math.PI / 2 - 0.35; g.position.set(0.2, 0.16, 0.7); s.world.add(g); } },
      // 12: ABSOLUTELY RIGHT: the chatbot's grin, close
      { fog: '#101828', cam: { P: [0, 0.3, 1.25], T: [0, 0.28, 0], fov: 50 }, titles: [t('ABSOLUTELY', 0, 0.7, 0.62, GRN), t('RIGHT.', 0, -0.72, 0.4, GRN)],
        build: () => { s.burst('#1C3050', '#101828', -3, 12); s.bot(0, 0, 0, 'happy', { ver: 'v5.0', s: 1.0 }); } },
      // 13: DEV vs AI
      { fog: '#18101A', cam: { P: [0, 1.35, 2.2], T: [0, 1.3, 0], fov: 50 }, titles: [t('VS', 0, 0.05, 0.22, YEL)],
        build: () => { s.burst('#3A1A20', '#18101A'); s.dev(-0.72, 0.2, 'yell', { ry: Math.PI - 0.5 }); s.bot(0.72, 1.0, 0.2, 'focused', { ry: -0.5, s: 0.95, ver: 'v6.0' }); } },
      // 14: OH... DUCK! the giant rubber duck staring at DEV
      { fog: '#1A1430', cam: { P: [0.3, 1.1, 3.1], T: [0.1, 1.2, 0], fov: 52 }, titles: [t('OH...DUCK!', 0, 0.72, 0.64, YEL)],
        build: () => { s.burst('#302A58', '#1A1430'); const dk = makeDuck(); s.add(dk, 0.75, 0, -0.4, 10, -0.5); s.dev(-0.95, 0.6, 'shock', { ry: Math.PI - 0.6 }); } },
      // 15: SLOP MACHINE
      { fog: '#16201A', cam: { P: [0.4, 1.2, 3.2], T: [0.2, 1.0, 0], fov: 52 }, titles: [t('SLOP', -0.35, 0.62, 0.42, GRN, 0.05)],
        build: () => { s.burst('#233A28', '#16201A'); const m = makeSlopMachine('#7CC04A'); s.add(m.root, 0.2, 0, -0.3, 1.3, -0.4); s.bot(1.35, 1.7, 0.2, 'happy', { s: 0.75, ver: 'v3.0', ry: -0.5 }); s.dev(-1.1, 1.0, 'sad', { ry: Math.PI - 0.4 }); } },
      // 16: 2 WEEKS? the estimate vs the robot with a coffee
      { fog: '#1A1A22', cam: { P: [0, 1.3, 2.8], T: [0, 1.2, 0], fov: 52 }, titles: [t('"2 WEEKS"', -0.4, 0.66, 0.5, WHT, 0.05)],
        build: () => { s.burst('#2A2A3A', '#1A1A22'); s.dev(-0.8, 0.3, 'smug', { ry: Math.PI - 0.3 }); s.bot(0.85, 0, 0, 'happy', { body: '#8A93A8', ry: -0.4 }); s.win(['done: 4 min'], 0.52, 0.5, 0.36, { tab: 'chatbot v5.0', col: () => P.fix }); } },
      // 17: MERGED: the finished PR and DEV's face
      { fog: '#121622', cam: { P: [0, 1.35, 2.0], T: [0, 1.3, 0], fov: 50 }, titles: [t('MERGED', 0.5, -0.7, 0.44, GRN)],
        build: () => { s.burst('#1E2A40', '#121622'); s.dev(-0.55, 0.2, 'shock', { ry: Math.PI - 0.3 }); const pr = s.panel(200, 150); pr.draw('pr', (c) => drawPR(c, 200, 150, { tests: 5, merged: true, lines: 5, t: 10 })); pr.hang = { ref: 0, x: 0.45, y: 0.1, frac: 0.46, D: 1.0, yaw: -0.2 }; } },
      // 18: EVOLVING: the chatbot heads v1 → v6, growing
      { fog: '#101420', cam: { P: [0, 0.75, 4.3], T: [0, 0.6, 0], fov: 54 }, titles: [t('v1 > v6', 0, 0.72, 0.5, YEL)],
        build: () => { s.burst('#1E2640', '#101420'); ['v1.0', 'v2.0', 'v3.0', 'v4.0', 'v5.0', 'v6.0'].forEach((v, i) => { const sc = 0.55 + i * 0.28; s.bot(-2.9 + i * 0.95 + i * i * 0.06, sc * 0.3, -0.15 * i, i === 5 ? 'focused' : 'happy', { ver: v, s: sc, ry: 0.35 - i * 0.12 }); }); } },
      // 19: NEW HIRES: an army of robots behind the lone programmer
      { fog: '#0E1018', cam: { P: [0, 1.2, 3.4], T: [0, 1.3, -2], fov: 54 }, titles: [t('NEW HIRES', 0, 0.72, 0.6, RED)],
        build: () => { s.floor('#1A2034'); for (let r = 0; r < 3; r++) for (let c = -3; c <= 3; c++) s.bot(c * 1.0 + (r % 2) * 0.5, 0, -1.6 - r * 1.3, 'focused', { body: '#8A93A8', ver: 'v6.0', s: 0.9 }); s.dev(0, 1.3, 'scared'); } },
      // 20: HAND-CODED: DEV at his desk, seen from the monitor
      { fog: '#141B2E', cam: { P: [0.5, 1.72, -3.35], T: [0.05, 1.28, -2.45], fov: 54 }, titles: [t('HAND-CODED', 0, 0.72, 0.6, YEL)],
        build: () => { const rm = makeRoom(); s.world.add(rm.root); const d = s.dev(0, -2.42, 'smug', { sit: true, ry: 0 }); d.armL.rotation.x = d.armR.rotation.x = -1.1; } },
      // 21: DEADLINE: the countdown over the ticking clock, DEV scared
      { fog: '#1E1212', cam: { P: [0, 1.35, 2.6], T: [0, 1.45, 0], fov: 50 }, titles: [t('DEADLINE', 0, 0.72, 0.56, RED)],
        build: () => { const ck = makeBigClock(1.4, P.fail); s.add(ck.root, 0.8, 1.7, -1.2); s.dev(-0.55, 0.3, 'scared', { ry: Math.PI - 0.3 }); s.win(['00:00:01'], 0.52, -0.55, 0.36, { col: () => P.fail, scale: 3 }); s.burst('#3A1414', '#1E1212', -3.5); } },
      // 22: IT'S 2021? the calendar stuck in the past and the chatbot in reading glasses
      { fog: '#2A1E2E', cam: { P: [0, 1.0, 2.3], T: [0, 1.0, 0], fov: 50 }, titles: [t("IT'S 2021?", 0, 0.72, 0.62, YEL)],
        build: () => { s.burst('#4A2E48', '#2A1E2E'); s.bot(0.62, 0.5, 0.2, 'glasses', { s: 1.0, ver: 'v1.0', ry: -0.35 }); const lf = s.panel(80, 110); lf.draw('lf', (c) => drawLeaf(c, 2021, 'today')); lf.hang = { ref: 0, x: -0.45, y: -0.1, frac: 0.3, D: 1.0, yaw: 0.25 }; } },
      // 23: STOP! the drive-thru counter running away, nuggets raining
      { fog: '#20140E', cam: { P: [0, 1.3, 2.6], T: [0, 1.3, 0], fov: 52 }, titles: [t('STOP!', -0.5, 0.64, 0.4, RED, 0.08)],
        build: () => { s.burst('#3A2410', '#20140E'); s.dev(-0.6, 0.3, 'yell', { ry: Math.PI - 0.3 }); s.win(['NUGGETS x 260'], 0.45, 0.35, 0.44, { col: () => P.key2, scale: 2 });
          const nug = psMat({ color: '#D9A04A' }); for (let i = 0; i < 40; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.12), nug); m.position.set(-2.4 + (i * 0.97) % 4.8, 0.2 + ((i * 1.37) % 2.6), -0.6 + ((i * 0.53) % 1.2)); m.rotation.set(i, i * 1.7, i * 0.3); s.world.add(m); } } },
      // 24: CHOOSE: two doors, P(BLOOM) and P(DOOM), DEV between them from behind
      { fog: '#0C1020', cam: { P: [0, 1.4, 3.4], T: [0, 1.4, 0], fov: 52 }, titles: [t('P(BLOOM)', -0.52, 0.64, 0.4, GRN), t('P(DOOM)', 0.52, 0.64, 0.38, RED), t('?', 0, -0.2, 0.08, YEL)],
        build: () => { s.floor('#1A2034'); for (const [x, col] of [[-1.3, P.fix], [1.3, P.fail]] as [number, string][]) { const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.1, 0.1), psMat({ color: col, emit: col === P.fix ? '#0A3016' : '#30080C', unlit: true })); door.position.set(x, 1.05, -1.2); s.world.add(door); }
          s.dev(0, 0.8, 'neutral', { ry: 0 }); } },
      // 25: JUST A TOY? the wind-up toy robot and the real one's shadow behind it
      { fog: '#08080E', cam: { P: [0, 0.55, 2.2], T: [0, 0.9, 0], fov: 56 }, titles: [t('JUST A TOY?', 0, -0.72, 0.62, YEL)],
        build: () => { s.floor('#2A1E16'); const toy = makeToyBot('v1.0'); s.add(toy.root, -0.35, 0, 0.5, 1.6, 0.3); toy.head.setFace('happy'); s.bot(1.5, 1.5, -2.2, 'focused', { ver: 'v6.0', s: 3.0, ry: -0.3 }); } },
      // 26: AI IS SLOP: DEV laughing at the broken little chatbot
      { fog: '#1E1428', cam: { P: [0, 1.25, 2.6], T: [0, 1.1, 0], fov: 50 }, titles: [t('AI IS SLOP', 0, 0.72, 0.62, YEL, -0.03)],
        build: () => { s.burst('#34204A', '#1E1428'); const d = s.dev(-0.55, 0.2, 'laugh', { ry: Math.PI - 0.35 }); d.armR.rotation.set(-1.5, 0, 0.3); s.bot(0.75, 0.85, 0.3, 'error', { s: 1.0, ver: 'v1.0', ry: -0.4 }); } },
      // 27: NEW SENIOR DEV: the robot at DEV's desk, DEV sad beside it
      { fog: '#141B2E', cam: { P: [1.3, 1.3, -0.6], T: [0, 1.1, -2.9], fov: 56 }, titles: [t('NEW SENIOR DEV', 0, -0.74, 0.64, GRN)],
        build: () => { const rm = makeRoom(); s.world.add(rm.root); const r = s.bot(0, 0, -2.5, 'happy', { body: '#8A93A8', ver: 'v6.0', ry: 0.5 }); void r; s.dev(1.2, -2.0, 'sad', { ry: Math.PI + 0.9 }); } },
      // 28: P(DOOM)=1: the chatbot's red eyes out of the dark
      { fog: '#050507', cam: { P: [0, 0.3, 1.15], T: [0, 0.32, 0], fov: 50 }, titles: [t('P(DOOM)=1', 0, -0.72, 0.6, RED)],
        build: () => { s.bot(0, 0, 0, 'focused', { ver: 'v6.0' }); } },
      // 29: SLEEP TIGHT: DEV asleep and smug, the robot's face looming behind the bed
      { fog: '#0A0E1C', cam: { P: [0.35, 2.05, 0.6], T: [-0.1, 1.05, -1.2], fov: 54 }, titles: [t('SLEEP TIGHT', 0, -0.74, 0.6, WHT)],
        build: () => { s.floor('#1E2A48'); const bed = makeBed('over', 0.92); s.add(bed.root, 0, 0, -0.3); const d = makeDev(); d.outfit('pyjamas'); d.setFace('smug'); d.root.rotation.x = Math.PI / 2; d.armL.rotation.x = d.armR.rotation.x = 0.1;
          const g = new THREE.Group(); g.add(d.root); g.rotation.y = Math.PI; g.position.set(0, 0.72, 0.44); s.world.add(g);
          s.bot(-0.85, 1.2, -2.2, 'focused', { s: 1.4, ver: 'v6.0', ry: 0.35 }); const wall = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), psMat({ color: '#1A2440' })); wall.position.set(0, 3, -3.2); s.world.add(wall); } },
      // 30: TASK COMPLETE: the robot plumber hero shot at the sink
      { fog: '#1B2238', cam: { P: [0.4, 0.5, 2.6], T: [0.2, 1.3, 0], fov: 56 }, titles: [t('TASK COMPLETE', 0, 0.72, 0.66, GRN)],
        build: () => { const k = makeKitchen(); s.add(k.root, 0, 0, 1.9); const r = s.bot(0.2, 0, 0.1, 'happy', { ver: 'v6.0', body: '#3D5A9A', cap: true, ry: -0.2 }); r.body!.armR.rotation.x = -2.8; s.wrench(r.body!.armR); } },
    ];
  }

  override init() {
    this.n = Math.min(30, Math.max(1, Math.round(Number(this.ctx.params.n ?? 1))));
    this.comp = this.comps()[this.n - 1]!;
    this.fogColor = this.comp.fog; this.fogNear = 6; this.fogFar = 24;
    this.comp.build(this);
    // the headline: block letters hung in the camera's view (x, y: -1..1 of the frame; w: width fraction)
    const rc = new THREE.PerspectiveCamera(52, LW / LH, 0.05, 80); this.pose(rc, this.comp.cam);
    const q = rc.quaternion, fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q), up = new THREE.Vector3(0, 1, 0).applyQuaternion(q), rt = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const D = 1.2, hh = D * Math.tan(THREE.MathUtils.degToRad((this.comp.cam.fov ?? 52) / 2)), hw = hh * (LW / LH);
    for (const ti of this.comp.titles) {
      const b = this.blockTitle(ti.s, { cap: ti.cap, side: ti.side, tracking: 0.06 });
      const x = Math.max(-(SAFE - ti.w), Math.min(SAFE - ti.w, ti.x));
      b.root.position.copy(rc.position).addScaledVector(fwd, D).addScaledVector(rt, x * hw).addScaledVector(up, ti.y * hh);
      b.root.quaternion.copy(q); b.root.rotateZ(ti.rot ?? 0);
      b.root.scale.setScalar((ti.w * 2 * hw) / b.width);
      b.root.traverse((o) => { o.renderOrder = 25; const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined; for (const mm of m ? (Array.isArray(m) ? m : [m]) : []) mm.depthTest = false; });
    }
  }

  camAt(): CamState { return this.comp.cam; }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    this.begin();
    // a warm key from the camera side and a lifted ambient: thumbnails read bright
    psGlobals.uLightDir.value.set(0.35, 0.7, 0.9).normalize();
    psGlobals.uLightCol.value.setRGB(1.08, 0.95, 0.82);
    psGlobals.uAmb.value.setRGB(0.36, 0.38, 0.5);
    this.comp.light?.(this);
    return this.present(f, out, { vignette: 0.3 });
  }
}
