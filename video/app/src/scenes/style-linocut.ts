// Phase-1 style "linocut": the 3D world is a carved lino block printed on cream paper. Every
// surface's lighting becomes gouge strokes (white V-cuts whose width follows the light), in carbon
// black plus a vermilion block printed slightly off-register. Lyrics: each word is a wood-type block
// that slams onto the paper at its start, lifts and leaves the print; held notes keep spreading and smear.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { FSPass, makeRT, clearRT } from '../engine/gl';
import { F, font, glyphX } from '../engine/type';
import type { Line } from '../engine/lyrics';
import { clamp, lerp, ease, prog, springStep, hash, hexToLinear, pulse, type Key, keys } from '../engine/util';
import type { StyleNote } from '../styles/registry';
import { PlateShared, plateMaterial, depthMaterial, printMaterial, maxBlend, COMPOSITE_FRAG, type PlateOpts } from './style-linocut-gl';
import { extrudeWord, strawberryBody, strawberryCalyx, wineGlassGeometry, wineGeometry, bubbleShape, GLASS } from './style-linocut-geo';

export const TITLE = 'Linocut relief print in 3D';
export const NOTE: StyleNote = {
  technique: 'A real three.js relief world rendered into two ink "plates" (MSAA target: r = black, g = vermilion) by one gouge shader: light becomes tapered, broken V-cut strokes that follow each surface, with a shadow map from the key light; a composite pass prints the plates on fibrous paper with uneven ink take and the vermilion off-register.',
  palette: 'Cream paper #EFE6D2, carbon ink #1A1714, vermilion #D8401F (overprint gives a maroon third tone). No tones outside the two inks and the paper.',
  typography: 'Anton caps as wood type for the lyrics and the hero STRAWBERRY (extruded from the font outlines); JetBrains Mono carved into the chat slabs as the machine voice.',
  lyrics: 'One word per hit: every word is a wood-type block that slams onto the bed at the word\'s start, lifts and leaves its print; on held notes (thing!, strawberry, wine) the print keeps pressing after the block lifts: the ink spreads, a pale rim squeezes out and the letters drag along the row while the note rings. Annotations (the 1-2-3 count, the straw | berry tokens, the clock dial) are hand-stamped pops.',
  cost: 'Measured (perf, 1080p, machine shared with other renders): 12.7–16.5 ms/frame at 1 sample incl. readback, ~5.7 ms per sub-frame at 12 samples (shadow map + MSAA plate + composite). Full 204 s song with motion blur at ~24 sub-frames/frame: about 30 min.',
  risks: 'Gouge density needs its LOD fade to stay clean in wide shots; lots of printed text on an oblique bed must stay readable, so the camera stays high on lyric beats. Two-plate look depends on the composite; overdoing ink take makes the type crumble.',
};

const HEXC = { paper: '#EFE6D2', ink: '#1A1714', red: '#D8401F' };
const EMPX = 150; // print-atlas px per em
const FACE_PX = 170; // face-atlas px per world unit
const ANTON = F.anton();
const MONO = F.mono(700);
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
type V3 = [number, number, number];

// ---- world layout (world units; the bed is y = 0, the camera looks roughly toward -z) ----
const Z = {
  A: { x: -18.5 }, // lead-in: the question
  S: { x: 0 }, // the hero STRAWBERRY
  R1: { x: 16.2, y: 2.9, z: -1.4, rot: -0.3 }, // the bot's "2"
  P: { x: 24.8, y: 2.45, z: -1.0, rot: -0.12 }, // prompt 2
  G: { x: 34.5, z: 0 }, // the glass
};
const GLASS_H = 4.4;
const WINE_LEVEL = GLASS.bowlBottom + 0.5 * (GLASS.rim - GLASS.bowlBottom); // half full

interface Cell { w: number; h: number; draw: (c: CanvasRenderingContext2D, x: number, y: number) => void; x?: number; y?: number }
interface Stamp {
  key: string;
  cell: Cell;
  em: number; // world units per em
  inkW: number; // world width of the ink
  x: number; z: number; rot: number;
  ts: number; tl: number; tEnd: number; held: boolean; big: boolean;
  slide: [number, number];
  plane?: THREE.Mesh; mat?: THREE.RawShaderMaterial;
  block?: THREE.Mesh; bmat?: THREE.RawShaderMaterial;
  noBlock?: boolean;
}
interface Slab { group: THREE.Group; mat: THREE.RawShaderMaterial; roller: THREE.Group; w: number; h: number; t0: number; t1: number; pop?: number }

export default class Linocut extends Scene {
  private sh = new PlateShared();
  private world = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(36, 16 / 9, 0.5, 300);
  private lightCam = new THREE.OrthographicCamera(-48, 48, 26, -26, 1, 160);
  private plate = makeRT(1920, 1080, { samples: 4 });
  private shadowRT = new THREE.WebGLRenderTarget(2048, 2048, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
  private depthMat = depthMaterial();
  private comp = new FSPass(COMPOSITE_FRAG, {
    uPlate: { value: null }, uReg: { value: new THREE.Vector2(4.5, -3.0) }, uRegRot: { value: 0.0012 }, uPull: { value: 0 }, uFlash: { value: 0 },
    uPaper: { value: V(...hexToLinear(HEXC.paper)) }, uInkC: { value: V(...hexToLinear(HEXC.ink)) }, uRed: { value: V(...hexToLinear(HEXC.red)) },
  });
  private stamps: Stamp[] = [];
  private slabs: Record<string, Slab> = {};
  private letters: { mesh: THREE.Mesh; ch: string; x: number; i: number }[] = [];
  private two!: THREE.Mesh;
  private dots: THREE.Mesh[] = [];
  private brimRing!: THREE.Mesh;
  private ruler!: THREE.Group;
  private glass!: THREE.Group;
  private T!: ReturnType<Linocut['anchors']>;

  private anchors() {
    const { lyrics: ly, audio: au, start, end } = this.ctx;
    const lead = ly.get('Watch it try', 0), l1 = ly.get("It can't count the R", 0), l2 = ly.get("It can't fill a glass of wine", 0);
    const l3 = ly.lines[l2.i + 1]!;
    const D = au.downbeats.filter((d) => d >= start - 0.02 && d <= end + 0.02);
    const beatsOf = (a: number, b: number) => au.beats.filter((x) => x >= a - 0.02 && x < b - 0.02);
    const kicks = au.events('kick', D[1]! + 0.1, D[2]! - 0.05).map((e) => e[0]);
    while (kicks.length < 3) kicks.push(lerp(D[1]!, D[2]!, 0.25 + kicks.length * 0.2));
    const bB = beatsOf(D[2]!, D[3]!);
    const kickMid = au.events('kick', (bB[2] ?? D[2]! + 0.7) + 0.05, (bB[3] ?? D[3]! - 0.35) - 0.05)[0]?.[0] ?? lerp(bB[2]!, bB[3]!, 0.5);
    const bG = beatsOf(D[4]!, D[5]!);
    const kG = au.events('kick', D[4]! + 0.2, D[5]! - 0.1).map((e) => e[0]);
    const snE = au.events('snare', D[5]! + 0.1, end).map((e) => e[0]);
    const kE = au.events('kick', D[5]! + 0.1, end - 0.05).map((e) => e[0]);
    return {
      S: start, E: end, D, lead, l1, l2, l3, kicks: kicks.slice(0, 3),
      tokens: bB[1] ?? D[2]! + 0.35, counts: [bB[2] ?? D[2]! + 0.7, kickMid, bB[3] ?? D[2]! + 1.05],
      brim: bG[1] ?? D[4]! + 0.35, gap: kG.find((k) => k > (bG[1] ?? 0) + 0.1) ?? D[4]! + 0.9,
      ticks: snE[snE.length - 1] ?? end - 0.35, hands: kE[kE.length - 1] ?? end - 0.15,
    };
  }

  override async init() {
    this.T = this.anchors();
    const T = this.T;
    this.world.background = null;
    const P = (o: PlateOpts) => plateMaterial(this.sh, o);

    // ---- the bed ----
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(260, 140).rotateX(-Math.PI / 2), P({ mode: 2, freq: 3.2, bias: 0.06, seed: 3 }));
    bed.position.set(10, 0, -20);
    this.world.add(bed);

    // ---- hero: STRAWBERRY as carved wood letters, split into its two tokens ----
    const em = 3.25, gap = 1.25;
    const word = extrudeWord('STRAWBERRY', ANTON, em, 0.95, { bevel: 0.035 });
    const blackL = P({ ink: [1, 0], freq: 4.2, u: [0, 1, 0], v: [1, 0, 0], solidFace: true, bias: 0.05, seed: 7 });
    const redL = P({ ink: [1, 1], blackStart: 0.5, freq: 4.2, u: [0, 1, 0], v: [1, 0, 0], solidFace: true, seed: 8 });
    redL.uniforms.uFaceInk = { value: new THREE.Vector2(0, 1) };
    word.forEach((g, i) => {
      const m = new THREE.Mesh(g.geo, g.ch === 'R' ? redL : blackL);
      const x = g.x + (i >= 5 ? gap / 2 : -gap / 2);
      m.position.set(Z.S.x + x, 0, -0.8);
      m.layers.enable(1);
      this.world.add(m);
      this.letters.push({ mesh: m, ch: g.ch, x: m.position.x + g.w / 2, i });
    });
    // the fruit
    const berry = new THREE.Group();
    const body = new THREE.Mesh(strawberryBody(), P({ mode: 5, ink: [1, 1], blackStart: 0.42, freq: 14, seed: 11 }));
    const calyx = new THREE.Mesh(strawberryCalyx(), P({ ink: [1, 0], freq: 30, u: [1, 0, 1], v: [0, 0, 1], seed: 12, side: THREE.DoubleSide, bias: 0.3 }));
    berry.add(body, calyx);
    berry.scale.setScalar(3.3);
    berry.position.set(Z.S.x + 10.6, 1.42, -1.6);
    berry.rotation.set(0.35, -0.5, 1.28);
    berry.traverse((o) => o.layers.enable(1));
    this.world.add(berry);

    // ---- the wine glass (half full), a BRIM ring and a ruler ----
    this.glass = new THREE.Group();
    const glassMesh = new THREE.Mesh(wineGlassGeometry(), P({ mode: 4, freq: 26, side: THREE.DoubleSide, transparent: true, seed: 21 }));
    const wine = new THREE.Mesh(wineGeometry(WINE_LEVEL), P({ mode: 6, ink: [1, 1], blackStart: 0.45, freq: 13, seed: 22 }));
    this.glass.add(wine, glassMesh);
    this.glass.scale.setScalar(GLASS_H);
    this.glass.position.set(Z.G.x, 0, Z.G.z);
    wine.layers.enable(1);
    this.world.add(this.glass);
    const ringMat = P({ ink: [0, 1], freq: 40, transparent: true, seed: 23, bias: 1 });
    this.brimRing = new THREE.Mesh(new THREE.TorusGeometry(GLASS.rimR * GLASS_H + 0.07, 0.045, 8, 96).rotateX(Math.PI / 2), ringMat);
    this.brimRing.position.set(Z.G.x, GLASS.rim * GLASS_H, Z.G.z);
    this.world.add(this.brimRing);

    // ---- print atlas: every stamped word / mark ----
    this.buildStamps();
    const atlas = this.packAtlas(this.stamps.map((s) => s.cell), 4096, 4096, true);
    for (const s of this.stamps) this.makeStamp(s, atlas);

    // ---- chat slabs (their text carved into the face; a roller inks it) ----
    const faces: Record<string, Cell> = {
      q: this.faceCell(9.8, 2.4, 'user', ['how many r’s in', '“strawberry”?'].map((s) => s.replace('’', "'").replace('“', '"').replace('”', '"'))),
      r1: this.faceCell(8.6, 2.7, 'bot', ['There are 2 R\'s in', '"strawberry".']),
      p: this.faceCell(8.4, 2.1, 'user', ['a wine glass filled', 'to the brim']),
      r2: this.faceCell(7.8, 2.5, 'bot', ['Here\'s a wine glass', 'filled to the brim!']),
      dots: this.faceCell(3.6, 1.6, 'bot', []),
      ruler: this.rulerCell(),
    };
    const faceTex = this.packAtlas(Object.values(faces), 4096, 2048, false);
    this.sh.face.value = faceTex;
    const cellUV = (c: Cell, tex: { w: number; h: number }) => new THREE.Vector4(c.x! / tex.w, 1 - (c.y! + c.h) / tex.h, c.w / tex.w, c.h / tex.h);
    const texSize = { w: 4096, h: 2048 };
    const mkSlab = (key: string, x: number, y: number, z: number, rot: number, w: number, h: number, kind: 'user' | 'bot', tail: 'left' | 'right', t0: number, t1: number) => {
      const g = new THREE.Group();
      const mat = P({ ink: [1, 0], freq: 7, u: [0, 1, 0], v: [1, 0, 0], seed: 30 + t0, bias: kind === 'bot' ? 0.25 : 0 });
      mat.uniforms.uFaceOn!.value = 1;
      mat.uniforms.uFaceRect!.value = new THREE.Vector4(-w / 2, -h / 2, w, h);
      mat.uniforms.uFaceUV!.value = cellUV(faces[key]!, texSize);
      const slab = new THREE.Mesh(new THREE.ExtrudeGeometry(bubbleShape(w, h, 0.35, tail), { depth: 0.32, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1, curveSegments: 8 }), mat);
      slab.position.z = -0.32;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, y - h / 2 + 0.1, 0.22), P({ ink: [1, 0], freq: 9, u: [1, 0, 0], v: [0, 1, 0], seed: 31, bias: 0.2 }));
      post.position.set(tail === 'left' ? w * 0.28 : -w * 0.28, -(y - h / 2 + 0.1) / 2 - h / 2 + 0.05, -0.16);
      g.add(slab, post);
      const roller = new THREE.Group();
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, h * 0.92, 20), P({ ink: [1, 0], freq: 16, bias: 0.35, seed: 32 }));
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.3), P({ ink: [1, 0], freq: 9, u: [1, 0, 0], v: [0, 0, 1], seed: 33, bias: 0.1 }));
      handle.position.set(0, h * 0.5, 0.7);
      roller.add(drum, handle);
      roller.position.z = 0.3;
      g.add(roller);
      g.position.set(x, y, z);
      g.rotation.y = rot;
      g.traverse((o) => o.layers.enable(1));
      this.world.add(g);
      this.slabs[key] = { group: g, mat, roller, w, h, t0, t1 };
    };
    const D = T.D;
    mkSlab('q', Z.A.x - 0.6, 2.5, -1.3, 0.12, 9.8, 2.4, 'user', 'right', T.S + 0.12, D[1]! - 0.2);
    mkSlab('dots', Z.A.x + 6.4, 3.7, -2.6, -0.2, 3.6, 1.6, 'bot', 'left', -1, -1);
    mkSlab('r1', Z.R1.x, Z.R1.y, Z.R1.z, Z.R1.rot, 8.6, 2.7, 'bot', 'left', D[3]! + 0.05, D[3]! + 0.62);
    mkSlab('p', Z.P.x, Z.P.y, Z.P.z, Z.P.rot, 8.4, 2.1, 'user', 'right', T.l2.words[0]!.start - 0.25, T.l2.words[3]!.end + 0.02);
    mkSlab('r2', Z.G.x - 4.3, 3.3, -2.4, 0.3, 7.8, 2.5, 'bot', 'right', D[4]! + 0.18, D[4]! + 0.85);
    // the typing indicator: three dots pop in on the three kicks of the fill
    for (let i = 0; i < 3; i++) {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.2, 20).rotateX(Math.PI / 2), P({ ink: [0, 1], freq: 30, bias: 1, seed: 40 + i }));
      d.position.set(-0.75 + i * 0.75, -0.18, 0.12);
      this.slabs.dots!.group.add(d);
      this.dots.push(d);
    }
    // the big confident "2"
    const two = extrudeWord('2', F.mono(800), 3.6, 0.8, { bevel: 0.04 })[0]!;
    const twoMat = P({ ink: [1, 1], blackStart: 0.45, freq: 5, u: [0, 1, 0], v: [1, 0, 0], solidFace: true, seed: 50 });
    twoMat.uniforms.uFaceInk = { value: new THREE.Vector2(0, 1) };
    two.geo.translate(-two.w / 2, 0, 0.4);
    this.two = new THREE.Mesh(two.geo, twoMat);
    this.two.position.set(Z.R1.x - 3.2, 0, Z.R1.z + 2.9);
    this.two.rotation.y = -0.18;
    this.two.layers.enable(1);
    this.world.add(this.two);
    // the ruler next to the glass
    this.ruler = new THREE.Group();
    const rw = 0.9, rh = 5.2;
    const rmat = P({ ink: [1, 0], freq: 8, u: [0, 1, 0], v: [1, 0, 0], seed: 60 });
    rmat.uniforms.uFaceOn!.value = 1;
    rmat.uniforms.uFaceRect!.value = new THREE.Vector4(-rw / 2, 0, rw, rh);
    rmat.uniforms.uFaceUV!.value = cellUV(faces.ruler!, texSize);
    const rbox = new THREE.Mesh(new THREE.BoxGeometry(rw, rh, 0.22).translate(0, rh / 2, -0.11), rmat);
    this.ruler.add(rbox);
    this.ruler.position.set(Z.G.x + 2.35, 0, Z.G.z + 0.3);
    this.ruler.rotation.y = -0.25;
    this.ruler.traverse((o) => o.layers.enable(1));
    this.world.add(this.ruler);

    // uniforms the materials read for the solid face ink (default: the object's own ink)
    this.world.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.RawShaderMaterial | undefined;
      if (m?.uniforms?.uMode && !m.uniforms.uFaceInk) m.uniforms.uFaceInk = { value: (m.uniforms.uInk.value as THREE.Vector2).clone() };
    });

    this.lightCam.layers.set(1);
    const c = V(12, 0, -2);
    this.lightCam.position.copy(c).addScaledVector(this.sh.light.value, 70);
    this.lightCam.lookAt(c);
    this.lightCam.updateMatrixWorld();
    this.lightCam.updateProjectionMatrix();
    this.sh.shadowVP.value.multiplyMatrices(this.lightCam.projectionMatrix, this.lightCam.matrixWorldInverse);
    this.sh.shadow.value = this.shadowRT.texture;
  }

  // ---------------------------------------------------------------- stamps (lyrics + marks)

  private textCell(text: string, family: string, red: 'none' | 'all' | 'R', emPx = EMPX, pad = 18): Cell {
    const c = document.createElement('canvas').getContext('2d')!;
    c.font = font(family, emPx);
    const tw = c.measureText(text).width;
    return {
      w: Math.ceil(tw + pad * 2), h: Math.ceil(emPx * 1.22 + pad * 2),
      draw: (g, x, y) => {
        g.font = font(family, emPx);
        g.textBaseline = 'alphabetic';
        const bx = x + pad, by = y + pad + emPx * 0.97;
        if (red === 'R') {
          const chars = Array.from(text);
          chars.forEach((ch, i) => {
            g.fillStyle = ch === 'R' ? 'rgb(0,255,0)' : 'rgb(255,0,0)';
            g.fillText(ch, bx + glyphX(text, i, family, emPx), by);
          });
        } else {
          g.fillStyle = red === 'all' ? 'rgb(0,255,0)' : 'rgb(255,0,0)';
          g.fillText(text, bx, by);
        }
      },
    };
  }

  private buildStamps() {
    const T = this.T;
    const stamps: Stamp[] = [];
    const lyricStamp = (w: Line['words'][number], em: number, red: 'none' | 'all' | 'R' = 'none'): Stamp => {
      const text = w.w.toUpperCase();
      const cell = this.textCell(text, ANTON, red);
      const dur = w.end - w.start;
      const held = dur > 0.7;
      return {
        key: text, cell, em, inkW: (cell.w - 36) / EMPX * em, x: 0, z: 0, rot: 0,
        ts: w.start, tl: w.start + (held ? 0.16 : clamp(dur * 0.6, 0.06, 0.14)), tEnd: w.end, held, big: held || red !== 'none',
        slide: held ? [0.035 * em, 0] : [0, 0],
      };
    };
    const row = (ss: Stamp[], cx: number, z: number, rot = 0) => {
      const gapW = (s: Stamp) => s.em * 0.26;
      const total = ss.reduce((a, s, i) => a + s.inkW + (i ? gapW(s) : 0), 0);
      let x = cx - total / 2;
      for (const s of ss) {
        s.x = x + s.inkW / 2; s.z = z; s.rot = rot;
        x += s.inkW + gapW(s);
      }
      stamps.push(...ss);
    };
    const L = T.lead.words, W1 = T.l1.words, W2 = T.l2.words, W3 = T.l3.words;
    // the sung line is the biggest type in every frame
    row(L.slice(0, 5).map((w) => lyricStamp(w, 1.9)), Z.A.x + 0.4, 1.9);
    row(L.slice(5).map((w, i) => lyricStamp(w, 1.9, i === 2 ? 'all' : 'none')), Z.A.x + 0.9, 4.55);
    row(W1.slice(0, 3).map((w) => lyricStamp(w, 1.75)), Z.S.x - 3.4, 3.2);
    row(W1.slice(3, 6).map((w, i) => lyricStamp(w, 2.0, i === 1 ? 'all' : 'none')), Z.S.x + 2.2, 5.3);
    row([lyricStamp(W1[6]!, 2.7, 'R')], Z.S.x + 0.2, 7.9);
    row(W2.slice(0, 4).map((w) => lyricStamp(w, 1.9)), Z.P.x - 1.2, 3.0);
    row(W2.slice(4).map((w, i) => lyricStamp(w, 2.0, i === 2 ? 'all' : 'none')), Z.G.x, 4.6);
    row(W3.slice(0, 2).filter((w) => w.start < T.E).map((w) => lyricStamp(w, 1.7)), Z.G.x, -4.3);

    // tokens: brackets under the two groups of letters (the model sees "straw" + "berry")
    const tokenCell = (label: string, wWorld: number, em: number): Cell => {
      const wPx = Math.round((wWorld / em) * EMPX), hPx = Math.round(EMPX * 1.25);
      return {
        w: wPx + 24, h: hPx,
        draw: (g, x, y) => {
          g.fillStyle = 'rgb(255,0,0)';
          const x0 = x + 12, x1 = x + 12 + wPx, yb = y + 16;
          g.fillRect(x0, yb, wPx, 16);
          g.fillRect(x0, yb - 4, 16, 40); g.fillRect(x1 - 16, yb - 4, 16, 40);
          g.font = font(F.mono(800), EMPX * 0.7);
          g.textAlign = 'center';
          g.fillText(label, x + 12 + wPx / 2, y + hPx - 30);
          g.textAlign = 'left';
        },
      };
    };
    const lx = this.letterXs();
    const grp = [[lx[0]!.x0, lx[4]!.x1], [lx[5]!.x0, lx[9]!.x1]] as const;
    ['straw', 'berry'].forEach((label, i) => {
      const [a, b] = grp[i]!;
      const cell = tokenCell(label, b - a, 1.1);
      stamps.push({ key: `tok-${label}`, cell, em: 1.1, inkW: b - a, x: (a + b) / 2, z: 0.75, rot: 0, ts: T.tokens + i * 0.09, tl: T.tokens + i * 0.09 + 0.1, tEnd: T.tokens + i * 0.09 + 0.1, held: false, big: false, slide: [0, 0], noBlock: true });
    });
    // the count: 1, 2, 3 under the three R's (the third one bigger: the one the machine missed)
    const rs = lx.filter((l) => l.ch === 'R');
    rs.forEach((r, i) => {
      const n = String(i + 1);
      const em = i === 2 ? 1.25 : 0.95;
      const c = this.textCell(n, ANTON, 'all', EMPX, 30);
      const cell: Cell = {
        w: c.w + 40, h: c.h,
        draw: (g, x, y) => {
          c.draw(g, x + 20, y);
          g.strokeStyle = 'rgb(0,255,0)'; g.lineWidth = 12;
          g.beginPath(); g.ellipse(x + (c.w + 40) / 2, y + c.h * 0.47, c.w * 0.62, c.h * 0.42, 0, 0, Math.PI * 2); g.stroke();
        },
      };
      stamps.push({ key: `n${n}`, cell, em, inkW: (c.w / EMPX) * em * 0.8, x: (r.x0 + r.x1) / 2, z: 1.95, rot: 0, ts: T.counts[i]!, tl: T.counts[i]! + 0.1, tEnd: T.counts[i]! + 0.1, held: false, big: i === 2, slide: [0, 0], noBlock: true });
    });
    // the clock hook under the glass: twelve ticks, then two hands at ten past ten
    const dialPx = 820;
    const dial = (hands: boolean): Cell => ({
      w: dialPx, h: dialPx,
      draw: (g, x, y) => {
        const cx = x + dialPx / 2, cy = y + dialPx / 2;
        g.save();
        g.translate(cx, cy);
        if (!hands) {
          g.fillStyle = 'rgb(255,0,0)';
          for (let i = 0; i < 12; i++) {
            g.save(); g.rotate((i / 12) * Math.PI * 2);
            const long = i % 3 === 0;
            g.fillRect(-(long ? 12 : 7), -dialPx * 0.47, long ? 24 : 14, long ? 70 : 44);
            g.restore();
          }
        } else {
          g.fillStyle = 'rgb(255,0,0)';
          const hand = (ang: number, len: number, wd: number) => { g.save(); g.rotate(ang); g.beginPath(); g.moveTo(-wd, 18); g.lineTo(0, -len); g.lineTo(wd, 18); g.closePath(); g.fill(); g.restore(); };
          hand((-2 / 12) * Math.PI * 2 + (10 / 60) * (Math.PI * 2 / 12), dialPx * 0.37, 22); // hour hand just past ten
          hand((2 / 12) * Math.PI * 2, dialPx * 0.46, 16); // minute hand on two
        }
        g.restore();
      },
    });
    const dialW = 7.0;
    stamps.push({ key: 'dial', cell: dial(false), em: (dialW / dialPx) * EMPX, inkW: dialW * 0.9, x: Z.G.x, z: Z.G.z, rot: 0, ts: T.ticks, tl: T.ticks + 0.12, tEnd: T.ticks + 0.12, held: false, big: true, slide: [0, 0], noBlock: true });
    stamps.push({ key: 'hands', cell: dial(true), em: (dialW / dialPx) * EMPX, inkW: dialW * 0.9, x: Z.G.x, z: Z.G.z, rot: 0, ts: T.hands, tl: T.hands + 0.1, tEnd: T.hands + 0.1, held: false, big: true, slide: [0, 0], noBlock: true });
    this.stamps = stamps;
  }

  /** x extents (world) of the hero letters, by index. */
  private letterXs() {
    const em = 3.25, gap = 1.25;
    const word = extrudeWord('STRAWBERRY', ANTON, em, 0.1, { bevel: 0 });
    return word.map((g, i) => {
      const x = Z.S.x + g.x + (i >= 5 ? gap / 2 : -gap / 2);
      g.geo.dispose();
      return { ch: g.ch, x0: x, x1: x + g.w };
    });
  }

  /** Shelf-pack cells into one canvas texture. `blur`: glyph masks are blurred so the print shader can threshold (spread) them. */
  private packAtlas(cells: Cell[], CW: number, CH: number, blur: boolean): THREE.Texture {
    const cv = document.createElement('canvas');
    cv.width = CW; cv.height = CH;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#000'; g.fillRect(0, 0, CW, CH);
    let x = 0, y = 0, rowH = 0;
    for (const c of cells) {
      if (x + c.w > CW) { x = 0; y += rowH + 8; rowH = 0; }
      c.x = x; c.y = y;
      x += c.w + 8; rowH = Math.max(rowH, c.h);
    }
    if (y + rowH > CH) console.warn('linocut atlas overflow', y + rowH, CH);
    g.globalCompositeOperation = blur ? 'lighter' : 'source-over';
    if (blur) g.filter = 'blur(3.5px)';
    for (const c of cells) {
      g.save();
      g.beginPath(); g.rect(c.x!, c.y!, c.w, c.h); g.clip();
      c.draw(g, c.x!, c.y!);
      g.restore();
    }
    if (blur) {
      // blue: a wide blur of both inks, the clean paper a stamp leaves around its letters
      const tmp = document.createElement('canvas');
      tmp.width = CW; tmp.height = CH;
      const tg = tmp.getContext('2d')!;
      tg.drawImage(cv, 0, 0);
      const id = tg.getImageData(0, 0, CW, CH), d = id.data;
      for (let i = 0; i < d.length; i += 4) { const v = Math.max(d[i]!, d[i + 1]!); d[i] = 0; d[i + 1] = 0; d[i + 2] = v; }
      tg.putImageData(id, 0, 0);
      g.filter = 'blur(14px)';
      g.drawImage(tmp, 0, 0);
      g.filter = 'none';
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.NoColorSpace;
    // the blurred print masks are thresholded: mip blur would eat the type on the oblique bed
    tex.minFilter = blur ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = !blur;
    tex.anisotropy = 16;
    (tex as any).__w = CW; (tex as any).__h = CH;
    return tex;
  }

  private makeStamp(s: Stamp, atlas: THREE.Texture) {
    const c = s.cell, CW = 4096, CH = 4096;
    const w = (c.w / EMPX) * s.em, d = (c.h / EMPX) * s.em;
    const mat = printMaterial(atlas);
    mat.uniforms.uUV!.value = new THREE.Vector4(c.x! / CW, 1 - (c.y! + c.h) / CH, c.w / CW, c.h / CH);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), mat);
    plane.position.set(s.x, 0.012, s.z);
    plane.rotation.y = s.rot;
    plane.visible = false;
    plane.renderOrder = 2;
    this.world.add(plane);
    s.plane = plane; s.mat = mat;
    if (!s.noBlock) {
      const bh = s.em * 0.34, bw = s.inkW + s.em * 0.3, bd = s.em * 1.02;
      const bmat = plateMaterial(this.sh, { mode: 3, ink: [1, 0], freq: 5.5 / Math.max(0.8, s.em * 0.7), u: [0, 0, 1], v: [1, 0, 0], seed: hash(s.ts) * 100, bias: -0.1 });
      bmat.uniforms.uFaceInk = { value: new THREE.Vector2(1, 0) };
      bmat.uniforms.uHalf = { value: new THREE.Vector3(bw / 2, bh / 2, bd / 2) };
      const block = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), bmat);
      block.visible = false;
      block.layers.enable(1);
      this.world.add(block);
      s.block = block; s.bmat = bmat;
    }
  }

  private faceCell(w: number, h: number, kind: 'user' | 'bot', lines: string[]): Cell {
    const wp = Math.round(w * FACE_PX), hp = Math.round(h * FACE_PX);
    return {
      w: wp, h: hp,
      draw: (g, x, y) => {
        const INK = 'rgb(255,0,0)', RED = 'rgb(0,255,0)', CUT = 'rgb(0,0,0)';
        const r = 0.35 * FACE_PX;
        const rr = (x0: number, y0: number, ww: number, hh: number, rad: number) => { g.beginPath(); g.roundRect(x0, y0, ww, hh, rad); };
        const fg = kind === 'bot' ? CUT : INK;
        if (kind === 'bot') { g.fillStyle = INK; rr(x, y, wp, hp, r); g.fill(); }
        else { g.strokeStyle = INK; g.lineWidth = 16; rr(x + 20, y + 20, wp - 40, hp - 40, r * 0.8); g.stroke(); }
        // label
        g.fillStyle = fg;
        g.font = font(F.mono(400), 30);
        g.textBaseline = 'alphabetic';
        const label = kind === 'bot' ? 'chatbot' : 'you';
        if (kind === 'bot') { g.fillStyle = RED; g.fillRect(x + 50, y + 34, 24, 24); g.fillStyle = fg; }
        g.fillText(label, x + (kind === 'bot' ? 88 : 50), y + 58);
        const size = Math.min(96, (wp * 0.86) / (Math.max(...lines.map((l) => l.length), 1) * 0.6));
        g.font = font(F.mono(700), size);
        lines.forEach((ln, i) => {
          const ly = y + hp * 0.5 + (i - (lines.length - 1) / 2) * size * 1.18 + size * 0.36 + 16;
          let lx = x + 50;
          for (const ch of ln) {
            g.fillStyle = kind === 'bot' && ch === '2' ? RED : fg;
            if (kind === 'bot' && ch === '2') { g.fillStyle = CUT; g.fillRect(lx - 4, ly - size * 0.8, size * 0.6 + 8, size * 0.95); g.fillStyle = RED; }
            g.fillText(ch, lx, ly);
            lx += size * 0.6;
          }
        });
      },
    };
  }

  private rulerCell(): Cell {
    const rw = 0.9, rh = 5.2;
    const wp = Math.round(rw * FACE_PX), hp = Math.round(rh * FACE_PX);
    return {
      w: wp, h: hp,
      draw: (g, x, y) => {
        const INK = 'rgb(255,0,0)', RED = 'rgb(0,255,0)';
        const Y = (world: number) => y + hp - world * FACE_PX; // canvas y of a height on the ruler
        g.strokeStyle = INK; g.lineWidth = 10; g.strokeRect(x + 8, y + 8, wp - 16, hp - 16);
        g.fillStyle = INK;
        for (let k = 1; k < 26; k++) { if (k * 0.2 > WINE_LEVEL * GLASS_H - 0.3 && k * 0.2 < GLASS.rim * GLASS_H + 0.45) continue; const yy = Y(k * 0.2); g.fillRect(x + 8, yy - 3, k % 5 === 0 ? wp * 0.42 : wp * 0.22, 6); }
        const rim = GLASS.rim * GLASS_H, lvl = WINE_LEVEL * GLASS_H;
        g.fillStyle = RED;
        g.fillRect(x, Y(rim) - 8, wp, 16);
        g.fillStyle = INK;
        g.fillRect(x, Y(lvl) - 6, wp, 12);
        g.textAlign = 'center';
        g.font = font(ANTON, 58);
        g.fillText('BRIM', x + wp / 2, Y(rim) - 26);
        g.font = font(ANTON, 44);
        g.fillText('WINE', x + wp / 2, Y(lvl) + 58);
        // the gap: a red double arrow between the wine level and the brim
        g.fillStyle = RED;
        const ax = x + wp * 0.24, y0 = Y(rim) + 14, y1 = Y(lvl) - 12;
        g.fillRect(ax - 5, y0 + 18, 10, y1 - y0 - 36);
        g.beginPath(); g.moveTo(ax - 20, y0 + 26); g.lineTo(ax, y0); g.lineTo(ax + 20, y0 + 26); g.fill();
        g.beginPath(); g.moveTo(ax - 20, y1 - 26); g.lineTo(ax, y1); g.lineTo(ax + 20, y1 - 26); g.fill();
        g.save();
        g.translate(x + wp * 0.64, (y0 + y1) / 2);
        g.font = font(ANTON, 54);
        g.fillText('GAP', 0, 20);
        g.restore();
        g.textAlign = 'left';
      },
    };
  }

  // ---------------------------------------------------------------- animation

  private updateStamps(t: number) {
    for (const s of this.stamps) {
      const mat = s.mat!, plane = s.plane!;
      const printed = t >= s.ts;
      plane.visible = printed;
      if (printed) {
        // held notes keep pressing after the block lifts: the ink spreads and drags along the row
        const holdP = s.held ? prog(t, s.ts, s.tEnd) : 1;
        const press = s.held ? lerp(0.4, 0.58, ease.outQuad(holdP)) : 0.38 + (s.big ? 0.08 : 0);
        mat.uniforms.uInk!.value = clamp(0.55 + (t - s.ts) * 14);
        mat.uniforms.uPress!.value = press;
        const sl = this.slideAt(s, t);
        const w = (s.cell.w / EMPX) * s.em, d = (s.cell.h / EMPX) * s.em;
        (mat.uniforms.uSmear!.value as THREE.Vector2).set(sl[0] / w, -sl[1] / d);
      }
      // marks without a block pop onto the paper (a hand stamp: big, then pressed flat)
      if (s.noBlock) plane.scale.setScalar(printed ? 1 + 0.6 * (1 - springStep(t - s.ts, 5, 0.5)) : 1);
      const b = s.block;
      if (!b) continue;
      const tIn = 0.22, tOut = 0.24;
      if (t < s.ts - tIn || t > s.tl + tOut) { b.visible = false; continue; }
      b.visible = true;
      const r = hash(s.ts, 3), r2 = hash(s.ts, 7);
      const bh = s.em * 0.34;
      let y = 0, rx = 0, rz = 0, dz = 0, dx = 0, sq = 1;
      if (t < s.ts) {
        const p = prog(t, s.ts - tIn, s.ts);
        y = 14 * (1 - p * p * p); // drops from far above: in frame only for the last instant
        rx = (1 - p) * (r - 0.5) * 0.7; rz = (1 - p) * (r2 - 0.5) * 0.5;
        dz = (1 - p) * -1.0; dx = (1 - p) * (r - 0.5) * 1.2;
      } else if (t < s.tl) {
        sq = 1 - 0.22 * pulse(t, s.ts, 0.035);
      } else {
        const q = prog(t, s.tl, s.tl + tOut);
        y = 11 * ease.outQuad(q);
        rx = -0.9 * q; dz = -3.5 * q; dx = (r2 - 0.5) * 2 * q;
      }
      b.position.set(s.x + dx, y + (bh / 2) * sq, s.z + dz);
      b.rotation.set(rx, s.rot, rz);
      b.scale.set(1, sq, 1);
      s.bmat!.uniforms.uPress!.value = t >= s.ts && t < s.tl ? 1 : 0;
    }
  }

  /** How far a held stamp has slid (world, along its row) by t. */
  private slideAt(s: Stamp, t: number): [number, number] {
    if (!s.held || t < s.ts) return [0, 0];
    const p = ease.outQuad(prog(t, s.tl, s.tEnd));
    return [s.slide[0] * p, s.slide[1] * p];
  }

  private updateSlabs(t: number) {
    for (const s of Object.values(this.slabs)) {
      const rev = s.t0 < 0 ? 1 : ease.inOutQuad(prog(t, s.t0, s.t1));
      s.mat.uniforms.uReveal!.value = rev * 1.02;
      const rolling = rev > 0 && rev < 1;
      s.roller.visible = rolling || (t > s.t0 - 0.15 && t < s.t1 + 0.15 && s.t0 >= 0);
      const x = lerp(-s.w / 2 - 0.2, s.w / 2 + 0.2, rev);
      s.roller.position.x = x;
      s.roller.position.z = 0.3 + 0.4 * (1 - window01(t, s.t0 - 0.15, s.t1 + 0.15, 0.15, 0.15));
      (s.roller.children[0] as THREE.Mesh).rotation.y = -x / 0.26;
    }
    // typing indicator dots: one per kick of the fill
    this.dots.forEach((d, i) => {
      const k = this.T.kicks[i]!;
      const sp = t < k ? 0 : springStep(t - k, 5, 0.3);
      d.scale.setScalar(Math.max(1e-3, sp));
      d.position.z = 0.12 + 0.25 * pulse(t, k, 0.08);
    });
  }

  private updateProps(t: number) {
    const T = this.T, D = T.D;
    // the "2" slams up out of the bed on the cut
    const tp = D[3]! - 0.02;
    const s2 = t < tp ? 0 : springStep(t - tp, 3.2, 0.42);
    this.two.scale.set(1, Math.max(1e-3, s2), 1);
    this.two.rotation.y = -0.18 + 0.12 * Math.sin((t - tp) * 1.3) * (t > tp ? 1 : 0);
    this.two.visible = t > tp - 0.01;
    // hero letters: a small jolt on the snap, the R's hop on their count
    for (const l of this.letters) {
      const hop = l.ch === 'R' ? this.countHop(t, l.i) : 0;
      const snap = t < D[2]! ? 0 : pulse(t, D[2]!, 0.09) * Math.sin(l.i * 1.7) * 0.18;
      l.mesh.position.y = hop * 0.45 + Math.max(0, snap);
      l.mesh.rotation.z = hop * 0.05 * (l.i % 2 ? 1 : -1);
    }
    // ruler pops up with the BRIM mark; the ring around the rim prints on the next hit
    const rp = t < T.brim - 0.1 ? 0 : springStep(t - (T.brim - 0.1), 3.5, 0.45);
    // on the crane up into the rim the signs sink back into the bed: only the glass and the dial remain
    const sink = prog(t, D[5]! + 0.2, D[5]! + 0.75, ease.inBack);
    this.ruler.scale.set(1, Math.max(1e-3, rp * (1 - sink)), 1);
    const r2 = this.slabs.r2!.group, p2 = this.slabs.p!.group;
    const sinkP = prog(t, D[4]! - 0.05, D[4]! + 0.3, ease.inBack); // one idea per downbeat: prompt 2 leaves with the whip
    r2.position.y = 3.3 - 6.5 * sink; p2.position.y = Z.P.y - 6 * sinkP;
    r2.visible = sink < 0.99; p2.visible = sinkP < 0.99;
    this.ruler.visible = rp > 0.001;
    const rg = t < T.brim ? 0 : springStep(t - T.brim, 4, 0.4);
    this.brimRing.scale.setScalar(Math.max(1e-3, rg));
    this.brimRing.visible = rg > 0.001;
    // the wine sloshes a little on the glass reveal (a tilt of the whole glass)
    const sl = t < D[4]! ? 0 : Math.exp(-(t - D[4]!) * 2.2) * Math.sin((t - D[4]!) * 11);
    this.glass.rotation.z = 0.035 * sl;
  }

  private countHop(t: number, i: number) {
    const rIdx = [2, 7, 8].indexOf(i);
    if (rIdx < 0) return 0;
    const tc = this.T.counts[rIdx]!;
    return t < tc ? 0 : Math.exp(-(t - tc) * 7) * Math.sin(Math.min(Math.PI, (t - tc) * 18)) + (rIdx === 2 ? 0 : 0);
  }

  // ---------------------------------------------------------------- camera

  /** Camera as an orbit around a target: azimuth (0 = looking toward -z), elevation, distance (rad, rad, world). */
  private camAt(t: number): Orbit {
    const T = this.T, D = T.D, K = T.kicks;
    const beatNudge = (a: number, b: number) => {
      // a small push on every beat inside a shot: moves land on the beat instead of drifting
      let n = 0;
      for (const bt of this.ctx.audio.beats) if (bt > a + 0.05 && bt < b - 0.05 && t >= bt) n += 1 - Math.pow(0.5, (t - bt) / 0.07);
      return n;
    };
    if (t < D[1]!) {
      // A1: a slow crane down over the press bed onto the question
      const u = ease.inOutCubic(prog(t, D[0]! - 0.35, D[1]!));
      const o = orbit([-18.4, 1.0, 1.6], -0.28, 0.62, 18.5, 36, -0.035, 0);
      const o2 = orbit([-17.4, 0.9, 2.1], 0.04, 0.54, 15.5, 36, 0.01, 0);
      const r = mixOrbit(o, o2, u);
      r.dist -= 0.45 * beatNudge(D[0]!, D[1]!);
      return r;
    }
    if (t < D[2]! - 0.03) {
      // A2: close on the pressing THING!, then the wind-up: three kicks, three steps back and up
      const thing = this.stamps.find((s) => s.key.startsWith('THING'))!;
      const steps: Orbit[] = [
        orbit([thing.x - 0.2, 0.3, thing.z - 0.6], 0.42, 0.5, 10.5, 36, 0.0, 1),
        orbit([thing.x + 1.6, 0.3, thing.z - 1.2], 0.34, 0.62, 15, 38, 0.02, 1),
        orbit([thing.x + 4.0, 0.2, thing.z - 1.8], 0.26, 0.74, 20, 40, 0.035, 1),
        orbit([thing.x + 6.8, 0.0, thing.z - 2.2], 0.18, 0.86, 26, 41, 0.05, 1),
      ];
      let r = mixOrbit(steps[0]!, steps[0]!, 0);
      r.dist -= 1.2 * prog(t, D[1]!, K[0]!, ease.outQuad);
      for (let i = 0; i < 3; i++) {
        const sp = t < K[i]! ? 0 : springStep(t - K[i]!, 4.2, 0.62);
        const nxt = mixOrbit(steps[i]!, steps[i + 1]!, 1);
        r = mixOrbit(r, nxt, sp * (i === 0 ? 1 : 1));
      }
      r.dist += 1.6 * prog(t, K[2]!, D[2]!); // hold the breath: a slow creep back until the snap
      return r;
    }
    if (t < D[3]!) {
      // B: SNAP onto the hero, then truck along STRAW | BERRY while the R's are counted
      const prev = this.camAt(D[2]! - 0.031);
      const u = ease.outExpo(prog(t, D[2]! - 0.03, D[2]! + 0.24));
      const tr = ease.inOutQuad(prog(t, D[2]! + 0.1, D[3]!));
      const b = mixOrbit(orbit([-1.6, 0.8, 4.0], -0.2, 0.56, 17.5, 34, -0.02, 2), orbit([1.8, 0.8, 3.8], 0.12, 0.52, 20, 34, 0.01, 2), tr);
      b.dist -= 0.35 * beatNudge(D[2]! + 0.1, D[3]!);
      return mixOrbit(prev, b, u);
    }
    if (t < D[4]! - 0.05) {
      // C: cut to the confident "2", pull back to the bot's answer, drift right to prompt 2
      const k0 = orbit([Z.R1.x - 3.0, 1.7, Z.R1.z + 3.0], -0.42, 0.16, 8.0, 34, 0.03, 3);
      const k1 = orbit([Z.R1.x - 0.8, 2.3, Z.R1.z + 1.2], -0.22, 0.26, 14.5, 34, 0.0, 3);
      const k2 = orbit([Z.P.x - 0.6, 1.3, Z.P.z + 2.2], 0.04, 0.42, 16, 34, -0.02, 3);
      const tm = D[3]! + 0.55;
      const r = t < tm ? mixOrbit(k0, k1, ease.outQuart(prog(t, D[3]!, tm))) : mixOrbit(k1, k2, ease.inOutCubic(prog(t, tm, D[4]! - 0.05)));
      r.dist -= 0.3 * beatNudge(D[3]! + 0.1, D[4]!);
      return r;
    }
    if (t < D[5]!) {
      // D: whip-pan to the glass on "glass", then crane up it
      const prev = this.camAt(D[4]! - 0.051);
      const u = ease.outExpo(prog(t, D[4]! - 0.05, D[4]! + 0.24));
      const cr = ease.inOutQuad(prog(t, D[4]! + 0.1, D[5]!));
      const g = mixOrbit(orbit([Z.G.x - 0.6, 2.0, Z.G.z + 2.2], -0.3, 0.4, 12.5, 34, -0.02, 4), orbit([Z.G.x - 0.4, 1.7, Z.G.z + 2.2], -0.08, 0.58, 14.5, 34, 0.0, 4), cr);
      g.dist -= 0.3 * beatNudge(D[4]! + 0.1, D[5]!);
      return mixOrbit(prev, g, u);
    }
    // E: crane up and over into the rim: a circle (the next line's clock); the frame turns like a hand
    const prev = this.camAt(D[5]! - 0.001);
    const u = ease.inOutCubic(prog(t, D[5]! - 0.05, D[5]! + 0.6));
    const e = prog(t, D[5]! + 0.6, T.E);
    const top = orbit([Z.G.x, 0.0, Z.G.z - 0.3], -0.06 - 0.22 * ease.inOutQuad(e), Math.PI / 2 - 0.001, lerp(21.5, 19.5, e), 34, 0, 4);
    return mixOrbit(prev, top, u);
  }

  // ---------------------------------------------------------------- render

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t;
    this.updateStamps(t);
    this.updateSlabs(t);
    this.updateProps(t);

    const c = this.camAt(t);
    const cam = this.cam;
    placeCamera(cam, c);
    // stamp impacts shake the bed a touch
    let shake = 0;
    for (const s of this.stamps) if (!s.noBlock && t >= s.ts && t < s.ts + 0.3) shake += pulse(t, s.ts, 0.035) * (s.big ? 1 : 0.4);
    cam.position.y += 0.035 * shake;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.sh.cam.value.copy(cam.position);

    // shadow map from the key light
    this.world.overrideMaterial = this.depthMat;
    clearRT(renderer, this.shadowRT, [1, 1, 1]);
    renderer.setRenderTarget(this.shadowRT);
    renderer.render(this.world, this.lightCam);
    this.world.overrideMaterial = null;

    // the plates
    clearRT(renderer, this.plate, [0, 0, 0]);
    renderer.setRenderTarget(this.plate);
    renderer.render(this.world, cam);

    // print
    const u = this.comp.u;
    u.uPlate!.value = this.plate.texture;
    u.uPull!.value = c.shot * 1.37;
    void shotOf;
    (u.uReg!.value as THREE.Vector2).set(4.5 + 1.5 * Math.sin(c.shot * 2.1), -3.0 + 1.2 * Math.cos(c.shot * 1.3));
    this.comp.render(renderer, out);
    return { bloom: 0, halation: 0, ca: 0, grain: 0.028, vignette: 0.22, shake: [0, 1.5 * shake] };
  }
}

interface Orbit { tgt: THREE.Vector3; az: number; el: number; dist: number; fov: number; roll: number; shot: number }
const orbit = (tgt: V3, az: number, el: number, dist: number, fov: number, roll: number, shot: number): Orbit => ({ tgt: V(...tgt), az, el, dist, fov, roll, shot });
/** Blend two orbits (targets linearly, angles and distance as numbers: moves swing along arcs). */
const mixOrbit = (a: Orbit, b: Orbit, u: number): Orbit => ({
  tgt: a.tgt.clone().lerp(b.tgt, u), az: lerp(a.az, b.az, u), el: lerp(a.el, b.el, u), dist: lerp(a.dist, b.dist, u),
  fov: lerp(a.fov, b.fov, u), roll: lerp(a.roll, b.roll, u), shot: u < 0.5 ? a.shot : b.shot,
});
const shotOf = (o: Orbit) => o.shot;
function placeCamera(cam: THREE.PerspectiveCamera, o: Orbit) {
  const ce = Math.cos(o.el), se = Math.sin(o.el), sa = Math.sin(o.az), ca = Math.cos(o.az);
  cam.position.set(o.tgt.x + o.dist * ce * sa, o.tgt.y + o.dist * se, o.tgt.z + o.dist * ce * ca);
  cam.up.set(-se * sa, ce, -se * ca); // the elevation tangent: never degenerate, even straight down
  cam.fov = o.fov;
  cam.aspect = 16 / 9;
  cam.lookAt(o.tgt);
  cam.rotateZ(o.roll);
}
const window01 = (x: number, a: number, b: number, fi: number, fo: number) => Math.min(clamp((x - a) / fi), 1 - clamp((x - (b - fo)) / fo));
void keys; void (null as unknown as Key); void maxBlend;
