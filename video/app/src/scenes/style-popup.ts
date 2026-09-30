// Phase-1 style "popup": a pop-up paper book in 3D. Real cardstock solids (printed Canvas fronts, blank
// backs, cream cut edges, fibre bump) lit by a key light with soft shadow maps: hinged tabs, a V-fold, a
// layered glass with a pull-tab, slide-out chat strips, a paper wheel, and a real page turn on the
// "glass" downbeat. Every sung word is printed on its own tab that unfolds from the page at its start;
// held notes keep the tab flexing.
import * as THREE from 'three';
import { Scene, type Frame } from '../engine/scene';
import { makeRT, W, H } from '../engine/gl';
import { F, font, measure } from '../engine/type';
import type { Line } from '../engine/lyrics';
import type { StyleNote } from '../styles/registry';
import { clamp, ease, keys, lerp, prog, springStep, mulberry32, type Key } from '../engine/util';
import { INKS, card, paint, tracePath, text, finish, roundRect, hinge, fibre, shapeBox, fitSafe, envelope, type Box2 } from './style-popup-paper';

export const TITLE = 'Pop-up paper book';
export const NOTE: StyleNote = {
  technique:
    'A pop-up book built as real 3D cardstock: die-cut solids with printed Canvas2D fronts, blank backs and cut edges, hinged mechanisms (tabs, a V-fold, layered cards, slide-out strips, a pull-tab, a wheel) and a real page turn, lit by one key light with PCF soft shadow maps plus a fibre bump; MSAA, rendered by three.js.',
  palette: 'Cream cardstock and warm walnut, printed in ink black, tomato red, leaf green, mustard and wine; soft daylight key with warm fill.',
  typography:
    'Bricolage Grotesque 800 for the word tabs and the STRAW|BERRY V-fold, JetBrains Mono for the chat strips (the machine’s voice), Bodoni italic for chapter heads and the clock wheel, Caveat for margin notes.',
  lyrics:
    'Each sung word is printed on its own paper tab that unfolds up out of the page at the word’s start (spring overshoot) and folds back down when its line is over; held notes (“thing!”, “strawberry,”, “wine,”) keep the tab flexing; a line broken by the page turn continues on the next spread.',
  cost: 'perf (42–47 s, 1 sample, incl. readback) on a quiet GPU: avg 13.4 ms, p95 17.4 ms per frame, of which ~8.3 ms is the engine’s post + readback (the empty smoke scene); the scene itself is ~0.3 ms CPU + ~5 ms GPU (shadow pass + MSAA lit pass, ~80 card solids, zero per-frame Canvas uploads). Measured again while other renders shared the GPU: 18–23 ms (smoke 8–11 ms). Full 204 s song with adaptive motion blur (~12k frames × ~20 sub-frames × ~6 ms) ≈ 25–35 min.',
  risks:
    'Shadow maps and many small solids make it the heaviest of the paper looks; kinematics are hand-eased rather than solved, so a fold seen from a bad angle can look stiff. Legibility depends on the tabs facing the camera, which constrains camera orbits to the front half of the book.',
};

// ------------------------------------------------------------------ book geometry (world units, y up; gutter on the z axis)
const PW = 9, PD = 12; // page width (x) and depth (z)
const YL = 0.16; // top of the left page stack (lower than the leaf's resting height, so the turned leaf lands over the folded pop-ups)
const YR = 0.24; // top of the right page stack under the leaf
const PIV = 0.27; // leaf hinge height
const LEAF_T = 0.05;
const TAB_H = 1.22;
const TAB_CAP = 0.62;
const ROW_Z = [2.55, 4.05];

interface Tab { h: THREE.Group; bend: { value: number }; t0: number; te: number; t1: number; hold?: [number, number]; lie: number; tw: number; th: number; key: string }

export default class PopupScene extends Scene {
  private rt = makeRT(W, H, { samples: 4 });
  private world = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(32, W / H, 0.8, 200);
  private key = new THREE.DirectionalLight(0xfff1dc, 3.1);
  private leaf = new THREE.Group();
  private leafBack = new THREE.Group();
  private tabs: Tab[] = [];
  private T!: ReturnType<PopupScene['timing']>;
  private p: Record<string, THREE.Object3D> = {};
  private wineMat!: THREE.MeshStandardMaterial;
  private wineClip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  private stripClips: { plane: THREE.Plane; local: THREE.Plane; parent: THREE.Object3D }[] = [];
  private glassH = 5.1;
  private fillLevel = { empty: 2.5, half: 3.55, brim: 4.75 };

  private timing() {
    const { lyrics: ly, audio: au } = this.ctx;
    const L0 = ly.get('Watch it try', 0);
    const L1 = ly.get("It can't count the R", 0);
    const L2 = ly.get("It can't fill a glass of wine", 0);
    const L3 = ly.lines[L2.i + 1]!;
    const db = au.downbeats;
    const near = (t: number) => db.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a));
    const snap = near(L1.words[4]!.start), iS = db.indexOf(snap);
    const glass = near(L2.words[4]!.start), iG = db.indexOf(glass);
    const lead = db[iS - 1]!, two = db[iS + 1]!, out = db[iG + 1]!;
    let kicks = au.events('kick', lead + 0.2, snap - 0.03).map((k) => k[0]);
    if (kicks.length < 3) kicks = [snap - 0.36, snap - 0.2, snap - 0.07];
    kicks = kicks.slice(-3);
    const snares = au.events('snare', snap, this.ctx.end + 0.01).map((s) => s[0]);
    const snareAfter = (t: number) => snares.find((s) => s > t) ?? t + 0.35;
    // the page turn: the leaf lifts on the last beat before "glass" and lands a beat after
    const turn0 = glass - 0.36, turn1 = glass + 0.32;
    return { L0, L1, L2, L3, start: this.ctx.start, end: this.ctx.end, lead, snap, two, glass, out, kicks, snares, snareAfter, turn0, turn1 };
  }

  override init() {
    this.T = this.timing();
    const T = this.T;
    this.buildRoom();
    this.buildBook();
    this.buildChat();
    this.buildStrawberry();
    this.buildGlass();
    this.buildSpread2Left();
    // lyric tabs: rows along the front of each spread
    const s1 = (x: number) => (x < 0 ? this.p.left! : this.leaf);
    this.lineTabs(T.L0, [[0, 1, 2, 3, 4], [5, 6, 7]], -2.4, s1, T.L1.words[0]!.start - 0.12, 0);
    this.lineTabs(T.L1, [[0, 1, 2, 3, 4], [5, 6]], 0.2, s1, T.L2.words[0]!.start - 0.14, 1);
    this.lineTabs(T.L2, [[0, 1, 2, 3]], -4.5, s1, T.turn0 + 0.02, 2, 0.93);
    this.lineTabs(T.L2, [[4, 5, 6]], 4.4, () => this.p.right!, 1e9, 0, 1, [0]);
    this.lineTabs(T.L3, [[0, 1, 2]], -4.5, () => this.leafBack, 1e9, 0, 1, [1]);
  }

  // ------------------------------------------------------------------ build

  private buildRoom() {
    const w = this.world;
    w.background = new THREE.Color().setRGB(0.05, 0.035, 0.03, THREE.LinearSRGBColorSpace);
    // walnut table
    const wood = paint({ x0: 0, y0: 0, w: 60, h: 60 }, 34, (c) => {
      const r = mulberry32(3);
      c.fillStyle = '#4a3024'; c.fillRect(0, 0, 60, 60);
      for (let i = 0; i < 12; i++) {
        const y0 = i * 5;
        c.fillStyle = i % 2 ? '#553628' : '#4b2f22'; c.fillRect(0, y0, 60, 5);
        c.strokeStyle = 'rgba(20,10,6,0.55)'; c.lineWidth = 0.04; c.beginPath(); c.moveTo(0, y0); c.lineTo(60, y0); c.stroke();
        for (let k = 0; k < 40; k++) {
          c.strokeStyle = `rgba(${r() < 0.5 ? '30,16,10' : '120,80,55'},${0.12 + r() * 0.15})`;
          c.lineWidth = 0.02 + r() * 0.05;
          const yy = y0 + r() * 5;
          c.beginPath(); c.moveTo(0, yy);
          for (let x = 0; x <= 60; x += 3) c.lineTo(x, yy + Math.sin(x * 0.3 + k) * 0.12 * r());
          c.stroke();
        }
      }
    });
    const table = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.55, bumpMap: fibre(), bumpScale: 0.3 }));
    table.receiveShadow = true;
    w.add(table);
    // lights: soft key with shadows, warm hemisphere fill, a low rim from behind
    const key = this.key;
    key.position.set(-7, 13, 7.5);
    key.target.position.set(0.5, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera as THREE.OrthographicCamera;
    sc.left = -13; sc.right = 13; sc.top = 11; sc.bottom = -11; sc.near = 2; sc.far = 40;
    key.shadow.radius = 3;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    w.add(key, key.target);
    w.add(new THREE.HemisphereLight(0xffe9cf, 0x4a3326, 1.05));
    const rim = new THREE.DirectionalLight(0xcfe0ff, 0.5);
    rim.position.set(6, 5, -10);
    w.add(rim);
  }

  private pageTex(title: string, sub: string, n: number, side: 'L' | 'R', pattern: (c: CanvasRenderingContext2D) => void) {
    const box: Box2 = { x0: 0, y0: 0, w: PW, h: PD };
    return paint(box, 110, (c) => {
      c.fillStyle = INKS.paper; c.fillRect(0, 0, PW, PD);
      pattern(c);
      // chapter head at the top of left pages
      if (title) {
        text(c, title, 0.7, PD - 1.15, font(F.bodoni(400, true), 100), INKS.ink, 'left', 0.62);
        text(c, sub, 0.72, PD - 1.75, font(F.display(100, 600), 100), INKS.redDark, 'left', 0.34);
      }
      text(c, String(n), side === 'L' ? 0.6 : PW - 0.6, 0.5, font(F.bodoni(400, false), 100), INKS.ink, side === 'L' ? 'left' : 'right', 0.3);
      finish(c, box, n);
      // gutter shading on the inner edge
      const gx = side === 'L' ? PW : 0;
      const g = c.createLinearGradient(gx, 0, side === 'L' ? PW - 1.6 : 1.6, 0);
      g.addColorStop(0, 'rgba(60,40,25,0.42)'); g.addColorStop(0.35, 'rgba(60,40,25,0.12)'); g.addColorStop(1, 'rgba(60,40,25,0)');
      c.fillStyle = g; c.fillRect(0, 0, PW, PD);
      // outer edge darkening
      const e = c.createLinearGradient(side === 'L' ? 0 : PW, 0, side === 'L' ? 0.5 : PW - 0.5, 0);
      e.addColorStop(0, 'rgba(60,40,25,0.18)'); e.addColorStop(1, 'rgba(60,40,25,0)');
      c.fillStyle = e; c.fillRect(0, 0, PW, PD);
    });
  }

  /** A flat page face (plane) of the given texture, lying at y, spanning x0..x0+PW. */
  private pagePlane(tex: THREE.Texture, x0: number, y: number, flip = false) {
    const g = new THREE.PlaneGeometry(PW, PD).rotateX(-Math.PI / 2);
    if (flip) g.rotateZ(Math.PI);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.86, bumpMap: fibre(), bumpScale: 0.5 }));
    m.position.set(x0 + PW / 2, y, 0);
    m.receiveShadow = true; m.castShadow = true;
    return m;
  }

  private buildBook() {
    const w = this.world;
    const edgeTex = paint({ x0: 0, y0: 0, w: 4, h: 1 }, 128, (c) => {
      c.fillStyle = '#e9dcc0'; c.fillRect(0, 0, 4, 1);
      for (let i = 0; i < 40; i++) { c.fillStyle = i % 2 ? 'rgba(120,95,60,0.25)' : 'rgba(255,255,255,0.2)'; c.fillRect(0, i / 40, 4, 0.012); }
    });
    const stackMat = new THREE.MeshStandardMaterial({ map: edgeTex, roughness: 0.9 });
    const cover = new THREE.MeshStandardMaterial({ color: new THREE.Color('#6e1f1d'), roughness: 0.7 });
    const cv = new THREE.Mesh(new THREE.BoxGeometry(PW * 2 + 0.7, 0.08, PD + 0.6), cover);
    cv.position.set(0, 0.04, 0); cv.castShadow = cv.receiveShadow = true;
    w.add(cv);
    const stack = (x0: number, top: number) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(PW, top - 0.08, PD), stackMat);
      b.position.set(x0 + PW / 2, 0.08 + (top - 0.08) / 2, 0); b.castShadow = b.receiveShadow = true;
      w.add(b);
    };
    stack(-PW, YL - 0.001);
    stack(0, YR - 0.001);
    // printed pages
    const s1L = this.pageTex('Chapter Two', 'THE SIMPLEST THING', 12, 'L', (c) => {
      // pale sky with halftone dots
      c.fillStyle = '#dfe6de'; c.fillRect(0, 0, PW, PD);
      c.fillStyle = 'rgba(93,143,140,0.22)';
      for (let y = 0.3; y < PD; y += 0.32) for (let x = (y * 3) % 0.32; x < PW; x += 0.32) { const r = 0.05 + 0.05 * (y / PD); c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); }
    });
    const s1R = this.pageTex('', '', 13, 'R', (c) => {
      // strawberry-field rows
      c.fillStyle = '#f3dccf'; c.fillRect(0, 0, PW, PD);
      for (let y = 0.6; y < PD; y += 1.1) {
        c.fillStyle = 'rgba(61,125,69,0.25)'; c.fillRect(0, y, PW, 0.16);
        for (let x = 0.4 + (y % 2); x < PW; x += 1.3) {
          c.fillStyle = 'rgba(214,58,44,0.35)'; c.beginPath(); c.moveTo(x, y - 0.1); c.quadraticCurveTo(x - 0.28, y + 0.25, x, y + 0.42); c.quadraticCurveTo(x + 0.28, y + 0.25, x, y - 0.1); c.fill();
        }
      }
    });
    const s2L = this.pageTex('Chapter Three', 'A GLASS OF WINE', 14, 'L', (c) => {
      // faded gingham
      c.fillStyle = '#f2e6d3'; c.fillRect(0, 0, PW, PD);
      c.fillStyle = 'rgba(214,58,44,0.16)';
      for (let x = 0; x < PW; x += 0.8) c.fillRect(x, 0, 0.4, PD);
      for (let y = 0; y < PD; y += 0.8) c.fillRect(0, y, PW, 0.4);
    });
    const s2R = this.pageTex('', '', 15, 'R', (c) => {
      c.fillStyle = '#e4e6d6'; c.fillRect(0, 0, PW, PD);
      for (let x = 0.2; x < PW; x += 0.7) { c.fillStyle = 'rgba(61,125,69,0.13)'; c.fillRect(x, 0, 0.3, PD); }
    });
    // left page group (static), right page under the leaf (static), the leaf (turns about the gutter)
    const left = new THREE.Group(); left.position.set(0, YL, 0); w.add(left); this.p.left = left;
    left.add(this.pagePlane(s1L, -PW, 0.001));
    const right = new THREE.Group(); right.position.set(0, YR, 0); w.add(right); this.p.right = right;
    right.add(this.pagePlane(s2R, 0, 0.001));
    this.leaf.position.set(0, PIV, 0);
    w.add(this.leaf);
    const lf = new THREE.Mesh(new THREE.BoxGeometry(PW, LEAF_T, PD), stackMat);
    lf.position.set(PW / 2, -0.005, 0); lf.castShadow = lf.receiveShadow = true;
    this.leaf.add(lf);
    const top = this.pagePlane(s1R, 0, 0.021);
    this.leaf.add(top);
    // the leaf's back: spread 2's left page; its own frame reads like the world once the leaf has turned
    this.leafBack.rotation.z = Math.PI;
    this.leaf.add(this.leafBack);
    const back = this.pagePlane(s2L, -PW, 0.031);
    this.leafBack.add(back);
  }

  /** A strip/bubble card with mono text (the machine's voice). */
  private bubble(w: number, h: number, lines: { s: string; size: number; color?: string; fam?: string }[], bg: string, tail: 'left' | 'right' | null, icon = false) {
    const s = roundRect(w, h, Math.min(0.28, h * 0.4), -w / 2, 0);
    const box = shapeBox(s);
    const tex = paint(box, 150, (c) => {
      c.fillStyle = bg; tracePath(c, s); c.fill();
      c.strokeStyle = INKS.ink; c.lineWidth = 0.035; tracePath(c, s); c.stroke();
      let x = -w / 2 + 0.28;
      if (icon) { this.botIcon(c, x + 0.32, h / 2, 0.3); x += 0.8; }
      const gap = h / (lines.length + 1);
      lines.forEach((l, i) => text(c, l.s, x, h - gap * (i + 1) - l.size * 0.35, font(l.fam ?? F.mono(700), 100), l.color ?? INKS.ink, 'left', l.size));
      finish(c, box, Math.floor(w * 10));
    });
    void tail;
    return card(s, { front: tex, thick: 0.025 });
  }

  /** The chatbot icon: an original round face with an antenna. */
  private botIcon(c: CanvasRenderingContext2D, x: number, y: number, r: number) {
    c.save();
    c.fillStyle = INKS.teal; c.strokeStyle = INKS.ink; c.lineWidth = r * 0.12;
    c.beginPath(); c.moveTo(x, y + r * 0.9); c.lineTo(x, y + r * 1.3); c.stroke();
    c.beginPath(); c.arc(x, y + r * 1.35, r * 0.14, 0, 7); c.fillStyle = INKS.mustard; c.fill(); c.stroke();
    c.fillStyle = INKS.teal; c.beginPath(); c.roundRect(x - r, y - r * 0.85, r * 2, r * 1.75, r * 0.45); c.fill(); c.stroke();
    c.fillStyle = INKS.paper;
    for (const ex of [-0.38, 0.38]) { c.beginPath(); c.arc(x + ex * r, y + r * 0.08, r * 0.2, 0, 7); c.fill(); }
    c.strokeStyle = INKS.paper; c.lineWidth = r * 0.12; c.beginPath(); c.arc(x, y - r * 0.12, r * 0.42, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
    c.restore();
  }

  /** Clip `obj`'s materials to the half-space in front of a slit (defined in `parent`'s local frame). */
  private clipTo(obj: THREE.Object3D, parent: THREE.Object3D, local: THREE.Plane) {
    const plane = new THREE.Plane();
    this.stripClips.push({ plane, local, parent });
    ownMaterials(obj);
    obj.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const mm of Array.isArray(m) ? m : [m]) { mm.clippingPlanes = [...(mm.clippingPlanes ?? []), plane]; mm.clipShadows = true; }
    });
  }

  private buildChat() {
    const L = this.p.left!;
    const cw = 7.4, ch = 4.8;
    const s = roundRect(cw, ch, 0.35, -cw / 2, 0);
    const box = shapeBox(s);
    const slits = { q: 3.25, r: 1.72, p: 0.55 };
    const tex = paint(box, 120, (c) => {
      c.fillStyle = '#f7efdc'; tracePath(c, s); c.fill();
      c.fillStyle = INKS.teal; c.fillRect(-cw / 2, ch - 0.8, cw, 0.8);
      this.botIcon(c, -cw / 2 + 0.55, ch - 0.43, 0.24);
      text(c, 'chatbot', -cw / 2 + 1.0, ch - 0.56, font(F.mono(700), 100), INKS.paper, 'left', 0.36);
      text(c, 'online', cw / 2 - 0.3, ch - 0.56, font(F.mono(400), 100), '#cfe3df', 'right', 0.26);
      c.strokeStyle = INKS.ink; c.lineWidth = 0.05; tracePath(c, s); c.stroke();
      // die-cut slits the strips come out of
      c.fillStyle = '#3a2a22';
      c.fillRect(cw / 2 - 0.55, slits.q, 0.06, 0.78);
      c.fillRect(-cw / 2 + 0.35, slits.r - 0.03, 6.6, 0.06);
      c.fillRect(cw / 2 - 0.55, slits.p, 0.06, 0.78);
      text(c, 'pull the tabs', -cw / 2 + 0.35, 0.18, font(F.hand(700), 100), INKS.redDark, 'left', 0.3);
      finish(c, box, 5);
    });
    const cardG = card(s, { front: tex, thick: 0.05 });
    const hc = hinge(cardG, -4.55, 0.0, -2.3);
    L.add(hc);
    this.p.chat = hc;
    // struts behind (a box pop-up's side walls)
    for (const sx of [-2.8, 2.8]) {
      const st = new THREE.Shape(); st.moveTo(0, 0); st.lineTo(1.5, 0); st.lineTo(0, 3.1); st.lineTo(0, 0);
      const sg = card(st, { front: paint(shapeBox(st), 40, (c) => { c.fillStyle = INKS.paper2; c.fillRect(0, 0, 2, 4); }), thick: 0.03 });
      sg.rotation.y = Math.PI / 2;
      sg.position.set(sx, 0, -0.03);
      cardG.add(sg);
    }
    // question strip: slides out of the right slit towards the left, "typed" character by character
    const q = this.bubble(6.55, 0.72, [{ s: 'how many r\'s in "strawberry"?', size: 0.34 }], INKS.mustard, 'right');
    q.position.set(cw / 2 - 0.52, slits.q + 0.03, 0.06);
    cardG.add(q);
    this.p.q = q;
    this.clipTo(q, cardG, new THREE.Plane(new THREE.Vector3(-1, 0, 0), cw / 2 - 0.52));
    // reply bubble: rises out of the long slit
    const rp = this.bubble(6.6, 1.3, [{ s: 'There are 2 R\'s in "strawberry".', size: 0.27 }, { s: 'tokens: [straw] [berry]', size: 0.22, color: INKS.teal, fam: F.mono(400) }], '#fffaf0', null, true);
    rp.position.set(0, slits.r, 0.06);
    cardG.add(rp);
    this.p.reply = rp;
    this.clipTo(rp, cardG, new THREE.Plane(new THREE.Vector3(0, 1, 0), -slits.r));
    // the wine prompt strip, typed out of the lower slit
    const pr = this.bubble(6.55, 0.72, [{ s: 'a wine glass filled to the brim', size: 0.32 }], INKS.pink, 'right');
    pr.position.set(cw / 2 - 0.52, slits.p + 0.03, 0.06);
    cardG.add(pr);
    this.p.prompt = pr;
    this.clipTo(pr, cardG, new THREE.Plane(new THREE.Vector3(-1, 0, 0), cw / 2 - 0.52));
    // the bot's confident answer gets its own pop-up: a big "2"
    const tw = 3.1, th = 2.35;
    const two = new THREE.Shape();
    two.moveTo(-tw / 2 + 0.3, 0); two.lineTo(tw / 2 - 0.3, 0); two.quadraticCurveTo(tw / 2, 0, tw / 2, 0.3);
    two.lineTo(tw / 2, th - 0.3); two.quadraticCurveTo(tw / 2, th, tw / 2 - 0.3, th);
    two.lineTo(-tw / 2 + 1.0, th); two.lineTo(-tw / 2 - 0.35, th + 0.55); two.lineTo(-tw / 2 + 0.35, th - 0.1);
    two.quadraticCurveTo(-tw / 2, th - 0.2, -tw / 2, th - 0.5); two.lineTo(-tw / 2, 0.3); two.quadraticCurveTo(-tw / 2, 0, -tw / 2 + 0.3, 0);
    const twoTex = paint(shapeBox(two), 150, (c) => {
      c.fillStyle = INKS.mustard; tracePath(c, two); c.fill();
      c.strokeStyle = INKS.ink; c.lineWidth = 0.05; tracePath(c, two); c.stroke();
      text(c, '2', -0.25, 0.42, font(F.display(100, 800), 100), INKS.ink, 'center', 2.25);
      text(c, 'R’s', 0.95, 0.5, font(F.display(100, 800), 100), INKS.redDark, 'center', 0.62);
      text(c, 'confident!', 0.95, 1.55, font(F.hand(700), 100), INKS.ink, 'center', 0.42);
      this.botIcon(c, 1.05, 2.0, 0.17);
      finish(c, shapeBox(two), 77);
    });
    const twoCard = card(two, { front: twoTex, thick: 0.04 });
    const h2 = hinge(twoCard, -1.15, 0.0, 0.05);
    L.add(h2);
    this.p.two = h2;
  }

  private buildStrawberry() {
    const leaf = this.leaf;
    const hw = 4.15, bh = 5.0;
    const half = (sgn: number) => {
      const s = new THREE.Shape();
      s.moveTo(0, 0);
      s.bezierCurveTo(sgn * 1.4, 0.15, sgn * hw, 1.6, sgn * hw, 3.3);
      s.bezierCurveTo(sgn * hw, 4.5, sgn * 2.7, bh + 0.1, sgn * 1.4, bh);
      s.bezierCurveTo(sgn * 0.7, bh - 0.05, sgn * 0.25, bh - 0.2, 0, bh - 0.3);
      s.lineTo(0, 0);
      return s;
    };
    const vg = new THREE.Group();
    const hv = hinge(vg, 4.45, 0.022, -1.2);
    leaf.add(hv);
    this.p.berryHinge = hv;
    const fam = F.display(100, 800);
    const letterSize = 1.32;
    const rTiles: { g: THREE.Group; n: number }[] = [];
    const halves: THREE.Group[] = [];
    for (const [sgn, word, label] of [[-1, 'STRAW', '[straw]'], [1, 'BERRY', '[berry]']] as const) {
      const s = half(sgn);
      const box = shapeBox(s);
      const wwid = measure(word, fam, 100) * letterSize / 100;
      const x0 = sgn < 0 ? -hw + 0.35 + (hw - 0.55 - wwid) / 2 : 0.3 + (hw - 0.55 - wwid) / 2;
      const by = 2.2;
      const rIdx = [...word].map((ch, i) => (ch === 'R' ? i : -1)).filter((i) => i >= 0);
      const glyphX = (i: number) => x0 + (measure(word.slice(0, i + 1), fam, 100) - measure(word[i]!, fam, 100)) * letterSize / 100;
      const tex = paint(box, 120, (c) => {
        const g = c.createLinearGradient(0, 0, 0, bh);
        g.addColorStop(0, INKS.redDark); g.addColorStop(0.55, INKS.red); g.addColorStop(1, '#e8553f');
        c.fillStyle = g; tracePath(c, s); c.fill();
        c.save(); tracePath(c, s); c.clip();
        // seeds
        const r = mulberry32(sgn < 0 ? 11 : 12);
        for (let i = 0; i < 70; i++) {
          const x = box.x0 + r() * box.w, y = r() * bh;
          if (y > by - 0.25 && y < by + 1.2) continue;
          c.fillStyle = INKS.mustard; c.beginPath(); c.ellipse(x, y, 0.06, 0.11, 0.3 * sgn, 0, 7); c.fill();
          c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.arc(x - 0.02, y + 0.04, 0.025, 0, 7); c.fill();
        }
        // highlight
        c.fillStyle = 'rgba(255,255,255,0.12)'; c.beginPath(); c.ellipse(sgn * 1.4, 3.8, 0.9, 0.5, -0.5 * sgn, 0, 7); c.fill();
        c.restore();
        // the word, with the R's left out (they are lift-the-flap tiles); the count printed under each flap
        [...word].forEach((ch, i) => {
          if (ch === 'R') {
            const n = sgn < 0 ? 1 : i === 2 ? 2 : 3;
            const cx = glyphX(i) + measure('R', fam, 100) * letterSize / 200;
            c.fillStyle = INKS.mustard; c.beginPath(); c.arc(cx, by + 0.45, 0.42, 0, 7); c.fill();
            text(c, String(n), cx, by + 0.18, font(F.display(100, 800), 100), INKS.ink, 'center', 0.8);
            return;
          }
          text(c, ch, glyphX(i), by, font(fam, 100), INKS.paper, 'left', letterSize);
        });
        text(c, label, sgn < 0 ? -0.35 : 0.35, 0.9, font(F.mono(700), 100), '#ffd9c9', sgn < 0 ? 'right' : 'left', 0.3);
        // crease: the token boundary
        c.setLineDash([0.12, 0.1]); c.strokeStyle = 'rgba(255,240,220,0.8)'; c.lineWidth = 0.035;
        c.beginPath(); c.moveTo(0, 0.1); c.lineTo(0, bh - 0.35); c.stroke();
        finish(c, box, 20 + sgn);
      });
      const hg = new THREE.Group();
      hg.add(card(s, { front: tex, thick: 0.04 }));
      vg.add(hg);
      halves.push(hg);
      // lift-the-flap R tiles on the face
      for (const i of rIdx) {
        const n = sgn < 0 ? 1 : i === 2 ? 2 : 3;
        const tw = measure('R', fam, 100) * letterSize / 100 + 0.12, th = 1.16;
        const ts = roundRect(tw, th, 0.08, -tw / 2, 0);
        const tb = shapeBox(ts);
        const ttex = paint(tb, 160, (c) => {
          c.fillStyle = '#c93226'; tracePath(c, ts); c.fill();
          text(c, 'R', 0, 0.2, font(fam, 100), INKS.paper, 'center', letterSize);
          c.strokeStyle = 'rgba(80,10,5,0.35)'; c.lineWidth = 0.02; tracePath(c, ts); c.stroke();
        });
        const tile = card(ts, { front: ttex, thick: 0.03, backColor: '#f3d6c8' });
        const cx = glyphX(i) + measure('R', fam, 100) * letterSize / 200;
        tile.position.y = -th;
        const th2 = hinge(tile, cx, by - 0.2 + th, 0.045);
        hg.add(th2);
        rTiles.push({ g: th2, n });
      }
    }
    this.p.halfL = halves[0]!; this.p.halfR = halves[1]!;
    rTiles.sort((a, b) => a.n - b.n);
    rTiles.forEach((r, i) => (this.p[`r${i + 1}`] = r.g));
    // calyx and stem behind, leaves in front (the layers)
    const calyx = new THREE.Shape();
    const pts = 14;
    for (let i = 0; i <= pts; i++) {
      const a = Math.PI * (i / pts);
      const rr = i % 2 ? 1.15 : 2.6;
      const x = Math.cos(a) * rr * 1.25, y = Math.sin(a) * rr * 0.85;
      if (i === 0) calyx.moveTo(x, y); else calyx.lineTo(x, y);
    }
    calyx.lineTo(Math.cos(0) * 2.6 * 1.25, 0);
    const cb = shapeBox(calyx);
    const ctex = paint(cb, 90, (c) => {
      c.fillStyle = INKS.green; tracePath(c, calyx); c.fill();
      c.strokeStyle = INKS.greenDark; c.lineWidth = 0.05;
      for (let i = 0; i < 7; i++) { const a = Math.PI * ((i * 2 + 1) / 14); c.beginPath(); c.moveTo(0, 0.1); c.lineTo(Math.cos(a) * 2.2, Math.sin(a) * 1.7); c.stroke(); }
      finish(c, cb, 31);
    });
    const cal = card(calyx, { front: ctex, thick: 0.04 });
    cal.position.set(0, bh - 0.55, -0.32);
    cal.rotation.x = -0.12;
    vg.add(cal);
    for (const [x, rot] of [[2.0, 0.25], [7.0, -0.25]] as const) {
      const lfS = new THREE.Shape();
      lfS.moveTo(0, 0); lfS.bezierCurveTo(-1.1, 0.5, -0.9, 1.5, 0, 2.0); lfS.bezierCurveTo(0.9, 1.5, 1.1, 0.5, 0, 0);
      const lb = shapeBox(lfS);
      const lt = paint(lb, 90, (c) => {
        c.fillStyle = '#4e9152'; tracePath(c, lfS); c.fill();
        c.strokeStyle = INKS.greenDark; c.lineWidth = 0.05; c.beginPath(); c.moveTo(0, 0.05); c.lineTo(0, 1.8); c.stroke();
        for (let k = 0; k < 4; k++) { c.beginPath(); c.moveTo(0, 0.4 + k * 0.35); c.lineTo(0.5, 0.7 + k * 0.35); c.moveTo(0, 0.4 + k * 0.35); c.lineTo(-0.5, 0.7 + k * 0.35); c.stroke(); }
      });
      const lcard = card(lfS, { front: lt, thick: 0.03 });
      lcard.rotation.z = rot;
      const hl = hinge(lcard, x, 0.022, 0.55);
      leaf.add(hl);
      this.p[`leaf${x}`] = hl;
    }
  }

  private buildGlass() {
    const R = this.p.right!;
    const gh = this.glassH;
    const lv = this.fillLevel;
    // bowl as a function: half width at height y (bowl spans 2.35..gh)
    const bowlW = (y: number) => {
      const u = clamp((y - 2.35) / (gh - 2.35));
      return 0.2 + 1.55 * Math.pow(Math.sin(Math.min(1, u * 1.25) * Math.PI / 2), 0.7) - 0.25 * Math.max(0, u - 0.6) / 0.4;
    };
    const outline = (inset: number, y0: number, y1: number) => {
      const pts: THREE.Vector2[] = [];
      const N = 26;
      for (let i = 0; i <= N; i++) { const y = y0 + ((y1 - y0) * i) / N; pts.push(new THREE.Vector2(bowlW(y) - inset, y)); }
      return pts;
    };
    // front card: glass silhouette with the bowl cut out as a window
    const front = new THREE.Shape();
    const ob = outline(0, 2.35, gh);
    front.moveTo(-1.3, 0); front.lineTo(1.3, 0); front.lineTo(1.25, 0.22); front.lineTo(0.14, 0.4); front.lineTo(0.12, 2.1); front.lineTo(0.2, 2.35);
    for (const p of ob) front.lineTo(p.x, p.y);
    for (const p of [...ob].reverse()) front.lineTo(-p.x, p.y);
    front.lineTo(-0.2, 2.35); front.lineTo(-0.12, 2.1); front.lineTo(-0.14, 0.4); front.lineTo(-1.25, 0.22); front.lineTo(-1.3, 0);
    const hole = new THREE.Path();
    const ib = outline(0.16, 2.6, gh - 0.14);
    hole.moveTo(ib[0]!.x, ib[0]!.y);
    for (const p of ib) hole.lineTo(p.x, p.y);
    for (const p of [...ib].reverse()) hole.lineTo(-p.x, p.y);
    front.holes.push(hole);
    const fb = shapeBox(front);
    const ftex = paint(fb, 120, (c) => {
      const g = c.createLinearGradient(-1.8, 0, 1.8, 0);
      g.addColorStop(0, '#c9d6d6'); g.addColorStop(0.3, '#f4f7f2'); g.addColorStop(0.6, '#dde6e3'); g.addColorStop(1, '#aebfc0');
      c.fillStyle = g; tracePath(c, front); c.fill('evenodd');
      c.strokeStyle = '#51605f'; c.lineWidth = 0.04; tracePath(c, front); c.stroke();
      c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 0.09; c.beginPath(); c.moveTo(-1.35, 3.1); c.quadraticCurveTo(-1.6, 4.1, -1.3, 4.8); c.stroke();
    });
    const fcard = card(front, { front: ftex, thick: 0.04 });
    // the backdrop: a measuring chart with the BRIM line
    const bw = 4.6, bhh = gh + 0.9;
    const back = roundRect(bw, bhh, 0.2, -bw / 2, 0);
    const bb = shapeBox(back);
    const btex = paint(bb, 110, (c) => {
      c.fillStyle = '#f7f0df'; tracePath(c, back); c.fill();
      c.strokeStyle = INKS.ink; c.lineWidth = 0.035; tracePath(c, back); c.stroke();
      // the glass's inside, printed on the chart behind the window
      c.fillStyle = 'rgba(160,190,190,0.35)';
      c.beginPath(); const inner = outline(0.16, 2.6, gh - 0.14); inner.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); [...inner].reverse().forEach((p) => c.lineTo(-p.x, p.y)); c.fill();
      // scale marks
      const marks: [number, string][] = [[lv.half, '½'], [(lv.half + lv.empty) / 2, '¼'], [(lv.half + lv.brim) / 2, '¾']];
      c.strokeStyle = 'rgba(33,29,31,0.55)'; c.lineWidth = 0.025;
      for (const [y, s] of marks) { c.beginPath(); c.moveTo(1.55, y); c.lineTo(2.05, y); c.stroke(); text(c, s, 2.08, y - 0.08, font(F.display(100, 600), 100), INKS.ink, 'left', 0.26); }
      // BRIM: red dashed line across at the lip
      c.strokeStyle = INKS.red; c.lineWidth = 0.06; c.setLineDash([0.18, 0.12]);
      c.beginPath(); c.moveTo(-2.1, lv.brim); c.lineTo(2.1, lv.brim); c.stroke(); c.setLineDash([]);
      text(c, 'BRIM', -2.15, lv.brim + 0.15, font(F.display(100, 800), 100), INKS.red, 'left', 0.42);
      text(c, 'Fig. 3: a glass, full', 0, bhh - 0.45, font(F.bodoni(400, true), 100), INKS.ink, 'center', 0.3);
      finish(c, bb, 41);
    });
    const bcard = card(back, { front: btex, thick: 0.04 });
    // wine: a bowl-shaped card clipped by the fill level, plus the liquid's surface disc
    const wineS = new THREE.Shape();
    const wb = outline(0.1, 2.5, gh);
    wineS.moveTo(wb[0]!.x, wb[0]!.y);
    for (const p of wb) wineS.lineTo(p.x, p.y);
    for (const p of [...wb].reverse()) wineS.lineTo(-p.x, p.y);
    const wtex = paint(shapeBox(wineS), 90, (c) => {
      const g = c.createLinearGradient(0, 2.5, 0, gh);
      g.addColorStop(0, '#4d0d1d'); g.addColorStop(1, INKS.wine);
      c.fillStyle = g; tracePath(c, wineS); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.1)'; c.fillRect(-1.2, 2.5, 0.25, gh);
    });
    const wcard = card(wineS, { front: wtex, thick: 0.03 });
    this.wineMat = (wcard.userData.front as THREE.Mesh).material as THREE.MeshStandardMaterial;
    ownMaterials(wcard);
    wcard.traverse((o) => { const m = (o as THREE.Mesh).material; if (m) for (const mm of Array.isArray(m) ? m : [m]) { mm.clippingPlanes = [this.wineClip]; mm.clipShadows = true; } });
    const surf = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: new THREE.Color('#9b2a40'), roughness: 0.35 }));
    surf.castShadow = true;
    this.p.wineSurf = surf;
    this.p.bowlW = new THREE.Object3D();
    (this.p.bowlW as any).fn = bowlW;
    // the three layers on their hinges
    const gx = 4.3;
    const hb = hinge(bcard, gx, 0.02, 0.2);
    const hw = hinge(wcard, gx, 0.02, 0.55);
    const hf = hinge(fcard, gx, 0.02, 0.9);
    hw.add(surf);
    R.add(hb, hw, hf);
    this.p.gBack = hb; this.p.gWine = hw; this.p.gFront = hf;
    // pull-tab: a strip from under the glass out past the page edge
    const tabS = roundRect(5.6, 0.9, 0.18, 0, -0.45);
    const tabTex = paint(shapeBox(tabS), 110, (c) => {
      c.fillStyle = INKS.mustard; tracePath(c, tabS); c.fill();
      c.strokeStyle = INKS.ink; c.lineWidth = 0.03; tracePath(c, tabS); c.stroke();
      text(c, 'PULL', 4.0, -0.15, font(F.display(100, 800), 100), INKS.ink, 'left', 0.42);
      c.fillStyle = INKS.red; c.beginPath(); c.moveTo(3.0, 0.18); c.lineTo(3.7, 0); c.lineTo(3.0, -0.18); c.fill(); c.fillRect(2.2, -0.06, 0.85, 0.12);
    });
    const tab = card(tabS, { front: tabTex, thick: 0.02 });
    tab.rotation.x = -Math.PI / 2;
    const ht = new THREE.Group(); ht.add(tab); ht.position.set(4.3, 0.012, 1.9);
    R.add(ht);
    this.p.pull = ht;
    // a paper slot the tab runs through
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.035, 1.2), new THREE.MeshStandardMaterial({ color: new THREE.Color(INKS.paper2), roughness: 0.9 }));
    slot.position.set(7.6, 0.03, 1.9); slot.castShadow = slot.receiveShadow = true;
    R.add(slot);
  }

  private buildSpread2Left() {
    const B = this.leafBack;
    const y0 = 0.032;
    // the bot's cheerful claim, on a stand
    const rp = this.bubble(6.5, 1.45, [{ s: 'Here\'s a wine glass filled', size: 0.33 }, { s: 'to the brim!  :)', size: 0.33 }], '#fffaf0', null, true);
    const hr = hinge(rp, -3.45, y0, -0.9);
    B.add(hr);
    this.p.reply2 = hr;
    // the wheel (a volvelle): a printed dial on a brass rivet, with two paper hands
    const R0 = 2.05;
    const disc = new THREE.Shape(); disc.absarc(0, 0, R0, 0, Math.PI * 2, false);
    const dtex = paint(shapeBox(disc), 140, (c) => {
      c.fillStyle = '#f8f1df'; c.beginPath(); c.arc(0, 0, R0, 0, 7); c.fill();
      c.strokeStyle = INKS.ink; c.lineWidth = 0.05; c.beginPath(); c.arc(0, 0, R0 - 0.05, 0, 7); c.stroke();
      c.lineWidth = 0.02; c.beginPath(); c.arc(0, 0, R0 - 0.22, 0, 7); c.stroke();
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2, r1 = R0 - 0.22, r0 = r1 - (i % 5 ? 0.1 : 0.22);
        c.lineWidth = i % 5 ? 0.02 : 0.045; c.beginPath(); c.moveTo(Math.sin(a) * r0, Math.cos(a) * r0); c.lineTo(Math.sin(a) * r1, Math.cos(a) * r1); c.stroke();
      }
      for (let i = 1; i <= 12; i++) {
        const a = (i / 12) * Math.PI * 2, r = R0 - 0.72;
        text(c, String(i), Math.sin(a) * r, Math.cos(a) * r - 0.14, font(F.bodoni(400, false), 100), INKS.ink, 'center', 0.42);
      }
      text(c, 'TURN', 0, -R0 + 0.95, font(F.display(100, 800), 100), INKS.red, 'center', 0.22);
      finish(c, shapeBox(disc), 51);
    });
    const dcard = card(disc, { front: dtex, thick: 0.03 });
    dcard.rotation.x = -Math.PI / 2;
    const wheel = new THREE.Group(); wheel.position.set(-4.7, y0 + 0.02, 1.25);
    wheel.add(dcard);
    B.add(wheel);
    this.p.wheel = wheel;
    const hand = (len: number, wd: number, color: string) => {
      const s = new THREE.Shape();
      s.moveTo(-wd, -0.25); s.lineTo(wd, -0.25); s.lineTo(wd * 0.7, len - 0.3); s.lineTo(0, len); s.lineTo(-wd * 0.7, len - 0.3); s.lineTo(-wd, -0.25);
      const hc = card(s, { front: paint(shapeBox(s), 120, (c) => { c.fillStyle = color; tracePath(c, s); c.fill(); }), thick: 0.02 });
      hc.rotation.x = -Math.PI / 2;
      const g = new THREE.Group(); g.add(hc);
      return g;
    };
    const hh = hand(1.05, 0.12, INKS.ink), mh = hand(1.55, 0.08, INKS.red);
    hh.position.y = 0.04; mh.position.y = 0.065;
    wheel.add(hh, mh);
    this.p.hHand = hh; this.p.mHand = mh;
    const rivet = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.08, 20), new THREE.MeshStandardMaterial({ color: new THREE.Color('#b8923a'), roughness: 0.35, metalness: 0.8 }));
    rivet.position.y = 0.09; rivet.castShadow = true;
    wheel.add(rivet);
  }

  /** Word tabs for some of a line's words, in rows at the front of a page. */
  private lineTabs(line: Line, rows: number[][], cx: number, pageOf: (x: number) => THREE.Object3D, foldAt: number, layer: number, scale = 1, rowIdx?: number[]) {
    const fam = F.display(100, 800);
    rows.forEach((idx, ri) => {
      const words = idx.map((i) => line.words[i]!);
      const size = TAB_CAP / 0.72 * scale;
      const widths = words.map((w) => (measure(w.w, fam, 100) * size) / 100 + 0.5 * scale);
      const gap = 0.14;
      const total = widths.reduce((a, b) => a + b, 0) + gap * (words.length - 1);
      let x = cx - total / 2;
      words.forEach((w, k) => {
        // the back row of a two-row line stands on a riser so its words print above the front row
        const riser = rows.length > 1 && (rowIdx?.[ri] ?? ri) === 0 ? 0.62 : 0;
        const tw = widths[k]!, th = TAB_H * scale + riser;
        const s = roundRect(tw, th, 0.1, -tw / 2, 0);
        const box = shapeBox(s);
        const accent = /R’s|strawberry|glass|wine|clock/i.test(w.w);
        const tex = paint(box, 150, (c) => {
          c.fillStyle = accent ? '#fff3dc' : INKS.paper; tracePath(c, s); c.fill();
          c.fillStyle = accent ? INKS.red : INKS.mustard; c.fillRect(-tw / 2, 0, tw, 0.13 * scale);
          if (riser) { c.fillStyle = 'rgba(33,29,31,0.08)'; c.fillRect(-tw / 2 + 0.12, 0.2, tw - 0.24, riser - 0.1); }
          text(c, w.w, 0, 0.33 * scale + riser, font(fam, 100), accent ? INKS.redDark : INKS.ink, 'center', size);
          c.strokeStyle = 'rgba(33,29,31,0.35)'; c.lineWidth = 0.02; tracePath(c, s); c.stroke();
          finish(c, box, w.gi);
        });
        // a flexible tab: a subdivided card whose upper part can curl (held notes)
        const bend = { value: 0 };
        const g = card(s, { front: tex, thick: 0.03 });
        ownMaterials(g);
        g.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[];
          if (!m) return;
          for (const mm of Array.isArray(m) ? m : [m]) {
            mm.onBeforeCompile = (sh) => {
              sh.uniforms.uBend = bend;
              sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n float by = max(transformed.y, 0.0) / ${th.toFixed(3)}; transformed.z += uBend * by * by; transformed.y -= abs(uBend) * by * by * 0.25;`)
                .replace('void main() {', 'uniform float uBend;\nvoid main() {');
            };
            mm.customProgramCacheKey = () => 'bendTab';
          }
        });
        // subdivide front/back so the bend is smooth
        g.children.forEach((ch) => {
          const mesh = ch as THREE.Mesh;
          if (mesh.geometry instanceof THREE.ShapeGeometry) {
            const old = mesh.geometry;
            const pg = new THREE.PlaneGeometry(tw, th, 2, 10);
            pg.translate(0, th / 2, 0);
            const n = old.getAttribute('normal').getZ(0);
            if (n < 0) { pg.rotateY(Math.PI); const uv = pg.getAttribute('uv') as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i)); }
            mesh.geometry = pg;
          }
        });
        const pageY = pageOf(x + tw / 2) === this.leafBack ? 0.032 : pageOf(x + tw / 2) === this.leaf ? 0.022 : 0.0;
        const z = ROW_Z[rowIdx?.[ri] ?? ri]!;
        const h = hinge(g, x + tw / 2, pageY + 0.004 + layer * 0.012, z);
        pageOf(x + tw / 2).add(h);
        const dur = w.end - w.start;
        this.tabs.push({ h, bend, t0: w.start, te: w.end, t1: foldAt, hold: dur > 0.75 ? [w.start + 0.15, w.end] : undefined, lie: layer, tw, th, key: `${line.i}:${cx}` });
        x += tw + gap;
      });
    });
  }

  // ------------------------------------------------------------------ animation

  private animate(t: number) {
    const T = this.T, p = this.p;
    // page turn
    const tp = prog(t, T.turn0, T.turn1, ease.inOutCubic);
    const lift = t > T.turn0 ? Math.sin(Math.PI * tp) : 0;
    this.leaf.rotation.z = Math.PI * tp;
    this.leaf.position.y = PIV + lift * 0.05;
    const flatten1 = prog(t, T.turn0 - 0.22, T.turn0 + 0.06, ease.inCubic); // spread 1 pop-ups fold as the leaf lifts
    const leftGone = prog(t, T.turn1 - 0.3, T.turn1 - 0.07, ease.inCubic); // left-page pop-ups fold before the leaf lands on them

    // chat card: stands; folds back before the leaf lands
    p.chat!.rotation.x = -0.1 - leftGone * (Math.PI / 2 - 0.1);
    // question strip: typed out of the slit (leading edge = first characters)
    const qT0 = T.start + 0.1, qT1 = T.lead - 0.12;
    const qp = prog(t, qT0, qT1);
    const qSteps = Math.floor(qp * 31) / 31; // per character
    const xs = 7.4 / 2 - 0.52, sw = 6.55;
    p.q!.position.x = xs + sw / 2 - qSteps * (sw + 0.05);
    // reply rises on the "2" downbeat
    const rp = t > T.two ? springStep(t - T.two - 0.02, 3.4, 0.5) : 0;
    p.reply!.position.y = 1.72 - 1.3 + 1.32 * rp;
    const u2 = t > T.two ? springStep(t - T.two - 0.03, 2.4, 0.32) : 0;
    const bob = T.snares.reduce((s0, sn) => s0 + (t > sn && sn > T.two ? Math.exp(-(t - sn) * 9) * 0.12 : 0), 0);
    p.two!.rotation.x = (Math.PI / 2) * (1 - u2 * (1 - leftGone)) - bob;
    // prompt strip typed as line 2 begins
    const pT0 = T.L2.words[0]!.start - 0.3, pT1 = T.glass - 0.3;
    const pp = Math.floor(prog(t, pT0, pT1) * 31) / 31;
    p.prompt!.position.x = xs + sw / 2 - pp * (sw + 0.05);

    // strawberry: flat, twitches on the fill's kicks, springs up on the downbeat and opens into its tokens
    const [k1, k2, k3] = T.kicks as [number, number, number];
    const tw = [k1, k2, k3].reduce((s, kt, i) => s + (t > kt && t < T.snap ? Math.exp(-(t - kt) * 9) * [0.18, 0.26, 0.36][i]! : 0), 0);
    const up = t > T.snap ? springStep(t - T.snap, 2.9, 0.36) : 0;
    const flat1 = 1 - flatten1;
    p.berryHinge!.rotation.x = -(Math.PI / 2) * (1 - up * flat1) + tw;
    const open = t > T.snap ? springStep(t - T.snap - 0.05, 2.2, 0.45) : 0;
    const a = 0.42 * open * flat1;
    p.halfL!.rotation.y = -a; p.halfR!.rotation.y = a;
    for (const [k, d] of [['leaf2', 0.13], ['leaf7', 0.17]] as const) {
      const u = t > T.snap ? springStep(t - T.snap - d, 3.0, 0.38) : 0;
      p[k]!.rotation.x = (Math.PI / 2) * (1 - u * 0.85 * flat1) + tw * 0.3;
    }
    // lift-the-flap R's: 1 on "R's", 2 right after, 3 on the snare
    const w4 = T.L1.words[4]!;
    const rT = [w4.start + 0.02, w4.start + 0.16, Math.max(w4.start + 0.3, T.snareAfter(w4.start) - 0.02)];
    rT.forEach((rt, i) => {
      const u = t > rt ? springStep(t - rt, 3.2, 0.42) : 0;
      p[`r${i + 1}`]!.rotation.x = -1.8 * u * flat1;
    });

    // spread 2 right: the glass rises out from under the lifting leaf
    const g0 = T.glass - 0.02;
    const riseB = t > g0 - 0.12 ? springStep(t - g0 + 0.12, 2.4, 0.42) : 0;
    const riseW = t > g0 - 0.06 ? springStep(t - g0 + 0.06, 2.4, 0.42) : 0;
    const riseF = t > g0 ? springStep(t - g0, 2.5, 0.4) : 0;
    p.gBack!.rotation.x = -(Math.PI / 2) * (1 - riseB) - 0.04 * riseB;
    p.gWine!.rotation.x = -(Math.PI / 2) * (1 - riseW);
    p.gFront!.rotation.x = -(Math.PI / 2) * (1 - riseF) + 0.02;
    // the pour: the pull-tab slides out, the wine rises and stops at half; tugs on the snares do nothing
    const lv = this.fillLevel;
    const pour = prog(t, T.glass + 0.05, T.glass + 0.4, ease.outCubic);
    const tug = T.snares.filter((s) => s > T.out - 0.05).reduce((s, sn) => s + (t > sn ? Math.exp(-(t - sn) * 8) * Math.sin((t - sn) * 40) : 0), 0);
    const level = lerp(lv.empty, lv.half, pour) + tug * 0.02;
    p.pull!.position.x = 4.3 + 1.2 * pour + tug * 0.12;
    const bw = (p.bowlW as any).fn as (y: number) => number;
    const surf = p.wineSurf as THREE.Mesh;
    surf.visible = pour > 0.02;
    surf.position.set(0, level, -0.18);
    surf.scale.set(Math.max(0.01, bw(level) - 0.12), 1, 0.2);
    // clip plane: keep y below the level, in the wine card's frame (world)
    const wc = p.gWine!;
    wc.updateWorldMatrix(true, false);
    const n = new THREE.Vector3(0, -1, 0).transformDirection(wc.matrixWorld);
    const pt = new THREE.Vector3(0, level, 0).applyMatrix4(wc.matrixWorld);
    this.wineClip.setFromNormalAndCoplanarPoint(n, pt);

    // spread 2 left (the leaf's back): the reply and the wheel come up once the leaf has landed
    const land = T.turn1 - 0.04;
    const r2 = t > land ? springStep(t - land, 2.8, 0.42) : 0;
    p.reply2!.rotation.x = -(Math.PI / 2) * (1 - r2) - 0.05;
    const wt = t > T.L3.words[1]!.start ? springStep(t - T.L3.words[1]!.start, 1.6, 0.5) : 0;
    p.wheel!.rotation.y = -0.9 + 0.9 * wt + (t - T.glass) * 0.12 * (1 - wt);
    // hands swing to ten past ten on "says"
    const h0 = T.L3.words[1]!.start - 0.2;
    const hs = t > h0 ? springStep(t - h0, 2.6, 0.38) : 0;
    const hA = lerp(2.3, -((10 + 10 / 60) / 12) * Math.PI * 2, hs), mA = lerp(-1.1, -(10 / 60) * Math.PI * 2, hs);
    p.hHand!.rotation.y = hA - p.wheel!.rotation.y * 0; p.mHand!.rotation.y = mA;

    // lyric tabs
    for (const tb of this.tabs) {
      const u = t > tb.t0 - 0.03 ? springStep(t - tb.t0 + 0.03, 3.3, 0.38) : 0;
      const fold = prog(t, tb.t1, tb.t1 + 0.24, ease.inCubic);
      const onLeaf1 = tb.h.parent === this.leaf || tb.h.parent === this.p.left;
      const f1 = onLeaf1 ? Math.max(tb.h.parent === this.leaf ? flatten1 : leftGone, fold) : fold;
      const stand = u * (1 - f1);
      // spread-1 tabs that straddle the gutter would poke out from under the turned leaf
      if (tb.h.parent === this.leaf) tb.h.visible = tp < 0.5;
      tb.h.rotation.x = (Math.PI / 2) * (1 - stand) - 0.06 * stand;
      let bend = 0;
      if (tb.hold && t > tb.hold[0] && t < tb.hold[1] + 0.3) {
        const e = prog(t, tb.hold[0], tb.hold[0] + 0.15) * (1 - prog(t, tb.hold[1], tb.hold[1] + 0.3));
        bend = 0.22 * e * Math.sin((t - tb.hold[0]) * Math.PI * 2 * 3.2);
      }
      tb.bend.value = bend;
    }
  }

  // ------------------------------------------------------------------ camera

  private camAt(t: number) {
    const T = this.T;
    const k = (ks: Key[]) => keys(t, ks);
    const c = { tx: 0, ty: 1, tz: 0, az: 0, el: 0.6, dist: 20, fov: 32, roll: 0 };
    const set = (o: Partial<typeof c>) => Object.assign(c, o);
    if (t < T.lead) {
      const a = T.start, b = T.lead;
      set({ tx: k([[a, -5.2], [b, -3.8]]), ty: 1.9, tz: k([[a, -0.2], [b, 0.8]]), az: k([[a, -0.5], [b, -0.1, ease.inOutCubic]]), el: k([[a, 0.36], [b, 0.46]]), dist: k([[a, 13.2], [b, 14.6]]), roll: k([[a, 0.03], [b, 0]]) });
    } else if (t < T.snap) {
      const [k1, k2, k3] = T.kicks as [number, number, number];
      const back = [k1, k2, k3].reduce((s, kt, i) => s + (t > kt ? springStep(t - kt, 5, 0.5) * [1.4, 1.8, 2.4][i]! : 0), 0);
      set({ tx: k([[T.lead, -1.2], [T.snap, 1.6, ease.inCubic]]), ty: 1.2, tz: k([[T.lead, 0.6], [T.snap, 0.8]]), az: k([[T.lead, -0.2], [T.snap, 0.08, ease.inCubic]]), el: k([[T.lead, 0.62], [T.snap, 0.78]]), dist: 19 + back, roll: -0.015 * back });
    } else if (t < T.two) {
      const a = T.snap, b = T.two;
      const cz = prog(t, a, a + 0.4, ease.outExpo);
      const dive = prog(t, T.L1.words[6]!.start - 0.1, b, ease.inOutCubic);
      set({
        tx: lerp(4.4, 4.8, dive), ty: lerp(2.5, 2.0, dive), tz: lerp(0.6, 1.2, dive),
        az: lerp(k([[a, 0.34], [a + 0.5, 0.2]]), -0.3, dive), el: lerp(lerp(0.75, 0.42, cz), 0.34, dive),
        dist: lerp(lerp(22, 12.5, cz), 8.4, dive), roll: lerp(0.05 * (1 - cz), -0.05, dive),
      });
    } else if (t < T.turn0) {
      const a = T.two, b = T.turn0;
      set({ tx: k([[a, -3.9], [a + 0.5, -0.3, ease.outCubic], [b, -3.8]]), ty: k([[a, 2.4], [b, 1.7]]), tz: k([[a, -1.2], [b, 0.4]]), az: k([[a, 0.1], [a + 0.5, 0.02, ease.outCubic], [b, -0.06]]), el: k([[a, 0.42], [a + 0.5, 0.5, ease.outCubic], [b, 0.44]]), dist: k([[a, 8.6], [a + 0.5, 15.2, ease.outCubic], [b, 12.8]]), roll: k([[a, -0.04], [b, 0.02]]) });
    } else if (t < T.out) {
      // whip with the turning leaf, land on the glass
      const a = T.turn0, b = T.out;
      const wh = prog(t, a, T.glass + 0.25, ease.inOutCubic);
      const o = prog(t, T.glass + 0.25, b, ease.inOutQuad);
      set({
        tx: lerp(-3.8, 2.6, wh), ty: lerp(1.7, 2.8, wh), tz: lerp(0.4, 0.6, wh),
        az: lerp(-0.06, 0.34, wh) - o * 0.4, el: lerp(0.4, 0.4, wh) - o * 0.08,
        dist: lerp(12.8, 12.6, wh) - Math.sin(Math.PI * wh) * -3 - o * 1.8, roll: Math.sin(Math.PI * wh) * 0.1,
      });
    } else {
      // dive to the gap, then swing over to the wheel and look down on the dial
      const a = T.out, b = T.end, s0 = a + 0.7;
      const sw = prog(t, s0, b - 0.12, ease.inOutCubic);
      set({
        tx: lerp(k([[a, 4.6], [s0, 4.3]]), -4.7, sw), ty: lerp(k([[a, 2.75], [s0, 2.9]]), 0.5, sw), tz: lerp(k([[a, 1.6], [s0, 1.4]]), 2.3, sw),
        az: lerp(k([[a, 0.42], [s0, 0.26]]), 0.0, sw), el: lerp(k([[a, 0.1], [s0, 0.16]]), 0.92, sw),
        dist: lerp(k([[a, 9.6], [s0, 10.2]]), 9.4, sw) + Math.sin(Math.PI * sw) * 5, roll: 0,
      });
    }
    return c;
  }

  private applyCam(c: ReturnType<PopupScene['camAt']>) {
    const cam = this.cam;
    const ce = Math.cos(c.el), se = Math.sin(c.el);
    cam.position.set(c.tx + c.dist * ce * Math.sin(c.az), c.ty + c.dist * se, c.tz + c.dist * ce * Math.cos(c.az));
    cam.up.set(-Math.sin(c.az) * se, ce, -Math.cos(c.az) * se);
    cam.lookAt(c.tx, c.ty, c.tz);
    cam.rotateZ(c.roll);
    cam.fov = c.fov;
    cam.updateProjectionMatrix();
  }

  /** The line being sung stays inside title-safe (with the shot's subject), whatever the designed move does. */
  private keepSafe(t: number) {
    const T = this.T;
    const groups = new Map<string, Tab[]>();
    for (const tb of this.tabs) { const g = groups.get(tb.key); if (g) g.push(tb); else groups.set(tb.key, [tb]); }
    let best: { tabs: Tab[]; w: number } | null = null;
    for (const tabs of groups.values()) {
      const a = Math.min(...tabs.map((x) => x.t0)), b = Math.max(...tabs.map((x) => x.te));
      const onRight2 = tabs[0]!.h.parent === this.p.right, onLeftTurn = tabs[0]!.h.parent === this.p.left && a > T.two;
      let w = envelope(t, a, b, 0.35, 0.35);
      if (onRight2) w = prog(t, T.glass + 0.05, T.glass + 0.4, ease.inOutCubic) * envelope(t, a, b, 1, 0.35);
      if (onLeftTurn) w *= 1 - prog(t, T.glass - 0.3, T.glass - 0.05);
      if (w > (best?.w ?? 0)) best = { tabs, w };
    }
    if (!best) return;
    const pts: THREE.Vector3[] = [];
    for (const tb of best.tabs) {
      const par = tb.h.parent!, hp = tb.h.position;
      for (const [x, y] of [[-tb.tw / 2, 0], [tb.tw / 2, 0], [-tb.tw / 2, tb.th], [tb.tw / 2, tb.th]] as const) pts.push(par.localToWorld(new THREE.Vector3(hp.x + x, hp.y + y, hp.z)));
    }
    // the shot's subject: the counted word, the big "2" next to it, the claim next to the glass
    const box = (o: THREE.Object3D) => { const bx = new THREE.Box3().setFromObject(o); for (const x of [bx.min.x, bx.max.x]) for (const y of [bx.min.y, bx.max.y]) for (const z of [bx.min.z, bx.max.z]) pts.push(new THREE.Vector3(x, y, z)); };
    if (t > T.snap + 0.3 && t < T.two) { box(this.p.halfL!); box(this.p.halfR!); }
    else if (t > T.two + 0.35 && t < T.L2.words[0]!.start - 0.2) box(this.p.two!);
    else if (t > T.glass + 0.4 && t < T.out) { box(this.p.reply2!); box(this.p.gBack!); }
    fitSafe(this.cam, pts, best.w);
  }

  // ------------------------------------------------------------------ render

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const { renderer, comp } = this.ctx;
    const t = f.t;
    this.animate(t);
    this.applyCam(this.camAt(t));
    this.world.updateMatrixWorld(true);
    this.keepSafe(t);
    this.world.updateMatrixWorld(true);
    for (const s of this.stripClips) s.plane.copy(s.local).applyMatrix4(s.parent.matrixWorld);
    const prevShadow = renderer.shadowMap.enabled, prevType = renderer.shadowMap.type, prevClip = renderer.localClippingEnabled;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.localClippingEnabled = true;
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, true);
    renderer.render(this.world, this.cam);
    renderer.shadowMap.enabled = prevShadow; renderer.shadowMap.type = prevType; renderer.localClippingEnabled = prevClip;
    comp.draw(renderer, this.rt.texture, out, { mode: 'replace' });
    return {
      bloom: 0.18, bloomThreshold: 1.2, halation: 0.08, ca: 0.4, grain: 0.045, vignette: 0.42,
      shake: [Math.sin(t * 83) * f.a.kick * 2.0, Math.cos(t * 71) * f.a.kick * 1.4] as [number, number],
      zoom: 1 + 0.01 * f.a.snare,
    };
  }
}

/** Give an object its own copies of its materials (the card edge materials are shared). */
function ownMaterials(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.material) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone();
  });
}
