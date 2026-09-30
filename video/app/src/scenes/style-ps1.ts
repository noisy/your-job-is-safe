// Phase-1 style "ps1": a PS1-era game cutscene. The 3D world renders at 384x216 (exactly 1/5 of 1080p) and is
// upscaled with nearest filtering: vertices snap to that grid (polygon jitter), textures warp affinely,
// Gouraud light and per-vertex fog, 15-bit colour with the ordered dither. Chunky low-poly models: the
// programmer at his desk with a CRT, a giant strawberry, a wine glass on a pedestal.
// Lyric idiom: a JRPG-style dialogue box typing the vocal character by character (held notes wave),
// plus big extruded block-letter titles that drop in on the hits for the key words (R'S, STRAWBERRY,
// GLASS, WINE). The chatbot talks in its own box at the top.
import * as THREE from 'three';
import { Scene, type Frame } from '../engine/scene';
import { FSPass, makeRT } from '../engine/gl';
import { F } from '../engine/type';
import { Lyrics, type Line, type Word } from '../engine/lyrics';
import { clamp, lerp, ease, keys, springStep, hash, prog, frameIdx, type Key } from '../engine/util';
import type { StyleNote } from '../styles/registry';
import { LW, LH, ADV, pixText, textW, psGlobals, psMat, canvasTex, rng, shade, blockGlyph, PS_OUT_FRAG } from './style-ps1-gfx';

export const TITLE = 'PS1 low-poly cutscene';
export const NOTE: StyleNote = {
  technique: 'three.js at an internal 384×216 (1/5 of 1080p), nearest-upscaled: vertices snapped to that grid in the vertex shader (polygon jitter), affine texture mapping (uv·w trick), per-vertex Gouraud light and fog, nearest 64 px textures without mipmaps, then 15-bit colour with the PS1 4×4 ordered dither. Low-poly models built in code; game-cutscene camera with hard cuts on downbeats.',
  palette: 'Night-blue fog #141B2E, warm desk-lamp key light, CRT beige, strawberry red #D8283C with seed yellow, title yellow #FFD23F on orange-red sides; UI navy panels with bone-white pixel text.',
  typography: 'An original hand-built 5×7 bitmap font (drawn at 2× in the dialogue box, 1× in the chat box and on the CRT); block titles extruded from Rubik Mono One with 2 curve segments per glyph.',
  lyrics: 'Both dialogue windows are textured quads hung in the 3D set (vertex-snapped and affine-warped like the walls), anchored per camera stretch so the camera moves around them; on the kick fill the lyric window recoils with each push-in. Bottom window, speaker “DEV”: each character types as the word is sung (a word types over ≤0.22 s from its start), held notes wave, a ▼ blinks when the line is done; key words also drop in as 3D block titles on their hits. The chatbot’s lines type in a second window with its own portrait.',
  cost: 'Measured (render.ts perf, 42–47 s): 11.2 ms/frame at 1 sample, 18.2 ms at 4 (≈2.3 ms per extra sub-frame; the 3D pass is only 384×216). Full 204 s song with motion blur: ≈11 min at ~20 sub-frames, ≈19 min at 36.',
  risks: 'The pixel grid makes small text depend on the bitmap font (fine at 1×/2×); vertex jitter plus motion blur can smear rather than jitter, so the export may want fewer sub-frames for this style. Keeping it original (no real game UI) is a design constraint on the boxes.',
};

const C_FOG = '#141B2E';
const TITLE_CAP = '#FFD23F', TITLE_SIDE = '#D9482B';
const R_CAP = '#FF4B5C', R_SIDE = '#8E1A2A';
const UI_BG = 'rgba(14,20,48,0.9)', UI_LINE = '#E8E4D8', UI_KEY = '#FFD84A', UI_DIM = '#8C93B8';

type V3 = [number, number, number];
type CamState = { P: V3; T: V3; roll: number; fov: number };
/** Dialogue window textures (texels = low-res pixels when shown at their nominal size). */
const LYR_W = 240, LYR_H = 64, CHAT_W = 188, CHAT_H = 52;
/** How a window hangs in front of a reference camera: distance, offset (fractions of the half-frame), width (fraction of the frame), tilt. */
type Hang = { ref: number; D?: number; x: number; y: number; frac: number; yaw: number; pitch: number; follow?: number };

export default class Ps1Scene extends Scene {
  world = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(52, LW / LH, 0.05, 40);
  low = makeRT(LW, LH, { pxScale: 1, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
  outPass = new FSPass(PS_OUT_FRAG, { src: { value: null }, res: { value: new THREE.Vector2(LW, LH) }, dither: { value: 1 } });
  // the two dialogue windows are textures on quads in the world (snapped and warped like everything else)
  lyricC = canvasTex(LYR_W, LYR_H, () => {});
  chatC = canvasTex(CHAT_W, CHAT_H, () => {});
  lyricPanel!: THREE.Mesh; chatPanel!: THREE.Mesh;
  screen = canvasTex(128, 96, () => {});

  L0!: Line; L1!: Line; L2!: Line;
  db: number[] = [];
  kicks: number[] = [];
  countT: number[] = [];
  tokenT = 0;

  // world objects
  dev = new THREE.Group(); head!: THREE.Mesh; armL!: THREE.Object3D; armR!: THREE.Object3D;
  faceMat!: THREE.RawShaderMaterial; faceTex!: THREE.Texture; smugTex!: THREE.Texture;
  berry = new THREE.Group(); berryShadow!: THREE.Mesh;
  glass = new THREE.Group(); wineTop!: THREE.Mesh; brim = new THREE.Group();
  dust: THREE.Mesh[] = [];
  titles: Record<string, { root: THREE.Group; letters: THREE.Object3D[] }> = {};
  labels: Record<string, THREE.Mesh> = {};

  override async init() {
    const { audio: au, lyrics: ly, start, end } = this.ctx;
    this.L0 = ly.get('Watch it try', 0);
    this.L1 = ly.get("It can't count the R", 0);
    this.L2 = ly.get("It can't fill a glass of wine", 0);
    this.db = au.downbeats.filter((d) => d >= start - 0.02 && d <= end + 0.02);
    while (this.db.length < 7) this.db.push((this.db[this.db.length - 1] ?? start) + 1.39);
    const k = au.events('kick', this.db[1]! + 0.1, this.db[2]! - 0.1).map((e) => e[0]);
    this.kicks = k.length >= 3 ? k.slice(-3) : [this.db[2]! - 1.0, this.db[2]! - 0.85, this.db[2]! - 0.7];
    const straw = this.L1.words[6]!;
    const b0 = Math.ceil(au.beatAt(straw.start + 0.05));
    this.countT = [0, 0.5, 1].map((x) => au.timeOfBeat(b0 + x));
    this.tokenT = au.timeOfBeat(b0 + 1.5);
    psGlobals.uFogColor.value.set(C_FOG).convertSRGBToLinear();
    this.buildRoom();
    this.buildDev();
    this.buildBerry();
    this.buildGlass();
    this.buildTitles();
    this.buildLabels();
    const panelMesh = (tex: THREE.Texture) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 4, 1), psMat({ map: tex, unlit: true, fog: 0, side: THREE.DoubleSide }));
      (m.material as THREE.Material).depthTest = false;
      m.renderOrder = 20; m.frustumCulled = false;
      this.world.add(m);
      return m;
    };
    this.lyricPanel = panelMesh(this.lyricC.tex);
    this.chatPanel = panelMesh(this.chatC.tex);
  }

  // ------------------------------------------------------------------ models
  private buildRoom() {
    const R = rng(7);
    const floorT = canvasTex(64, 64, (c) => {
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const tile = ((x >> 5) + (y >> 5)) & 1;
        const n = R() * 0.08;
        c.fillStyle = shade(tile ? '#35507A' : '#2A3C5E', 0.95 + n);
        c.fillRect(x, y, 1, 1);
      }
      c.fillStyle = '#1A2640'; c.fillRect(0, 0, 64, 1); c.fillRect(0, 32, 64, 1); c.fillRect(0, 0, 1, 64); c.fillRect(32, 0, 1, 64);
    }, true).tex;
    const floorG = new THREE.PlaneGeometry(16, 16, 4, 4);
    const uv = floorG.attributes.uv!; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 8, uv.getY(i) * 8);
    const floor = new THREE.Mesh(floorG, psMat({ map: floorT }));
    floor.rotation.x = -Math.PI / 2;
    this.world.add(floor);
    const wallT = canvasTex(64, 64, (c) => {
      for (let x = 0; x < 64; x++) {
        const plank = x >> 4;
        for (let y = 0; y < 64; y++) { c.fillStyle = shade(['#6B4B36', '#5E4230', '#735039', '#644634'][plank]!, 0.92 + R() * 0.12); c.fillRect(x, y, 1, 1); }
      }
      c.fillStyle = '#3B281C'; for (const x of [0, 16, 32, 48]) c.fillRect(x, 0, 1, 64);
      c.fillStyle = '#2E2016'; c.fillRect(0, 56, 64, 8);
    }, true).tex;
    const wallG = new THREE.PlaneGeometry(16, 5, 4, 2);
    const wuv = wallG.attributes.uv!; for (let i = 0; i < wuv.count; i++) wuv.setXY(i, wuv.getX(i) * 8, wuv.getY(i) * 2.5);
    const back = new THREE.Mesh(wallG, psMat({ map: wallT })); back.position.set(0, 2.5, -4.2); this.world.add(back);
    const left = new THREE.Mesh(wallG, psMat({ map: wallT })); left.position.set(-5, 2.5, 0); left.rotation.y = Math.PI / 2; this.world.add(left);
    const right = new THREE.Mesh(wallG, psMat({ map: wallT })); right.position.set(5, 2.5, 0); right.rotation.y = -Math.PI / 2; this.world.add(right);
    // a window with a night sky on the back wall
    const winT = canvasTex(32, 32, (c) => {
      c.fillStyle = '#1B2A55'; c.fillRect(0, 0, 32, 32);
      for (let i = 0; i < 14; i++) { c.fillStyle = R() > 0.5 ? '#E8E4D8' : '#8C93B8'; c.fillRect(Math.floor(R() * 30) + 1, Math.floor(R() * 22) + 1, 1, 1); }
      c.fillStyle = '#F4E3A3'; c.fillRect(22, 5, 4, 4); c.fillStyle = '#1B2A55'; c.fillRect(24, 5, 2, 2);
      c.fillStyle = '#3B281C'; c.fillRect(15, 0, 2, 32); c.fillRect(0, 15, 32, 2);
    }).tex;
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), psMat({ map: winT, unlit: true }));
    win.position.set(-2.2, 2.4, -4.18); this.world.add(win);
    // desk, CRT, keyboard, lamp
    const woodT = canvasTex(32, 32, (c) => {
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { c.fillStyle = shade('#7A5230', 0.85 + 0.2 * Math.abs(Math.sin(y * 0.9 + Math.sin(x * 0.3) * 2)) + R() * 0.05); c.fillRect(x, y, 1, 1); }
    }).tex;
    const wood = psMat({ map: woodT });
    const box = (w: number, h: number, d: number, m: THREE.Material | THREE.Material[], x: number, y: number, z: number) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); this.world.add(b); return b;
    };
    box(2.0, 0.08, 0.95, wood, 0, 0.76, -3.35);
    for (const [x, z] of [[-0.92, -3.75], [0.92, -3.75], [-0.92, -2.95], [0.92, -2.95]] as [number, number][]) box(0.08, 0.72, 0.08, wood, x, 0.36, z);
    const beigeT = canvasTex(16, 16, (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { c.fillStyle = shade('#C9BFA3', 0.93 + R() * 0.1); c.fillRect(x, y, 1, 1); } }).tex;
    const beige = psMat({ map: beigeT });
    box(0.66, 0.54, 0.58, beige, 0, 1.07, -3.5);
    box(0.4, 0.34, 0.3, beige, 0, 1.07, -3.85);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.39), psMat({ map: this.screen.tex, unlit: true, fog: 0.4 }));
    scr.position.set(0, 1.08, -3.205); this.world.add(scr);
    box(0.56, 0.05, 0.2, beige, 0, 0.82, -3.02);
    const lampM = psMat({ color: '#3A3F55' });
    box(0.05, 0.5, 0.05, lampM, 0.75, 1.05, -3.6);
    const shadeM = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.22, 6, 1, true), psMat({ color: '#FFD23F', emit: '#5A4010', side: THREE.DoubleSide }));
    shadeM.position.set(0.75, 1.32, -3.6); this.world.add(shadeM);
    // chair
    const chairM = psMat({ color: '#3B3F5C' });
    box(0.55, 0.08, 0.55, chairM, 0, 0.5, -2.35);
    box(0.55, 0.62, 0.08, chairM, 0, 0.86, -2.08);
    box(0.08, 0.46, 0.08, chairM, 0, 0.24, -2.35);
  }

  private buildDev() {
    const R = rng(11);
    const hoodT = canvasTex(16, 16, (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { c.fillStyle = shade('#3F7A5A', 0.9 + R() * 0.15); c.fillRect(x, y, 1, 1); } }).tex;
    const hood = psMat({ map: hoodT });
    const hair = psMat({ color: '#3A2A1E' });
    const skin = psMat({ color: '#E0B08A' });
    const face = (smug: boolean) => canvasTex(16, 16, (c) => {
      c.fillStyle = '#E0B08A'; c.fillRect(0, 0, 16, 16);
      c.fillStyle = '#3A2A1E'; c.fillRect(0, 0, 16, 4); c.fillRect(0, 4, 2, 3); c.fillRect(14, 4, 2, 3);
      c.fillStyle = '#1B1B2A';
      if (smug) { c.fillRect(4, 7, 3, 1); c.fillRect(10, 7, 3, 1); c.fillStyle = '#3A2A1E'; c.fillRect(3, 5, 4, 1); c.fillRect(10, 4, 4, 1); c.fillStyle = '#1B1B2A'; }
      else { c.fillRect(4, 6, 2, 2); c.fillRect(10, 6, 2, 2); }
      c.fillStyle = '#B8826A'; c.fillRect(7, 8, 2, 2);
      c.fillStyle = '#7A2E2E';
      if (smug) { c.fillRect(5, 12, 6, 1); c.fillRect(11, 11, 1, 1); c.fillRect(12, 10, 1, 1); }
      else c.fillRect(6, 12, 4, 1);
    }).tex;
    this.faceTex = face(false); this.smugTex = face(true);
    this.faceMat = psMat({ map: this.faceTex });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.58, 0.3), hood); torso.position.set(0, 0.86, 0);
    this.head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.34, 0.32), [hair, hair, hair, skin, hair, this.faceMat]);
    this.head.position.set(0, 1.34, -0.02);
    const hoodBack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.12), hood); hoodBack.position.set(0, 1.17, 0.16);
    const arm = (x: number) => {
      const piv = new THREE.Object3D(); piv.position.set(x, 1.08, -0.02);
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.5), hood); a.position.set(0, -0.05, -0.24);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.12), skin); hand.position.set(0, -0.06, -0.52);
      piv.add(a, hand); return piv;
    };
    this.armL = arm(-0.3); this.armR = arm(0.3);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.5), psMat({ color: '#2B3350' })); legs.position.set(0, 0.6, -0.2);
    this.dev.add(torso, this.head, hoodBack, this.armL, this.armR, legs);
    this.dev.position.set(0, 0, -2.42);
    this.world.add(this.dev);
  }

  private buildBerry() {
    const R = rng(3);
    const skinT = canvasTex(32, 32, (c) => {
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { c.fillStyle = shade('#D8283C', 0.9 + R() * 0.14); c.fillRect(x, y, 1, 1); }
      for (let y = 2; y < 32; y += 6) for (let x = (y / 6) % 2 ? 1 : 4; x < 32; x += 6) { c.fillStyle = '#F4D35E'; c.fillRect(x, y, 2, 2); c.fillStyle = '#8E1A2A'; c.fillRect(x, y + 2, 2, 1); }
    }, true).tex;
    const g = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
    const p = g.attributes.position!;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const u = (y + 1) / 2;
      const r = u > 0.66 ? lerp(1, 0.62, (u - 0.66) / 0.34) : lerp(0.12, 1, Math.pow(u / 0.66, 0.75));
      p.setXYZ(i, x * r, y * 1.12, z * r);
    }
    const uvA = g.attributes.uv!; for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i) * 3, uvA.getY(i) * 3);
    g.computeVertexNormals();
    const body = new THREE.Mesh(g, psMat({ map: skinT }));
    this.berry.add(body);
    const leafM = psMat({ color: '#3E8E41', side: THREE.DoubleSide });
    for (let i = 0; i < 6; i++) {
      const piv = new THREE.Object3D(); piv.position.set(0, 1.02, 0); piv.rotation.y = (i / 6) * Math.PI * 2;
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.8, 3), leafM);
      leaf.scale.set(1, 1, 0.3); leaf.rotation.x = Math.PI / 2 - 0.25; leaf.position.set(0, 0.02, 0.36);
      piv.add(leaf); this.berry.add(piv);
    }
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.4, 5), leafM); stem.position.set(0, 1.2, 0); stem.rotation.z = 0.3;
    this.berry.add(stem);
    this.world.add(this.berry);
    this.berryShadow = new THREE.Mesh(new THREE.CircleGeometry(1, 10), psMat({ color: '#000000', opacity: 0.45, unlit: true }));
    this.berryShadow.rotation.x = -Math.PI / 2; this.berryShadow.position.y = 0.01;
    this.world.add(this.berryShadow);
    const dustM = psMat({ color: '#C9BFA3', unlit: true });
    for (let i = 0; i < 16; i++) { const d = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), dustM); this.dust.push(d); this.world.add(d); }
  }

  private buildGlass() {
    const S = 1.5;
    const prof = [[0.34, 0.0], [0.34, 0.03], [0.06, 0.05], [0.04, 0.12], [0.04, 0.42], [0.08, 0.5], [0.24, 0.58], [0.33, 0.72], [0.34, 0.88], [0.31, 1.05], [0.29, 1.14]].map(([r, y]) => new THREE.Vector2(r! * S, y! * S));
    const shell = new THREE.Mesh(new THREE.LatheGeometry(prof, 10), psMat({ color: '#9FB8E8', opacity: 0.32, side: THREE.DoubleSide, emit: '#10182A' }));
    shell.renderOrder = 3;
    const wineProf = [[0.0, 0.5], [0.08, 0.51], [0.22, 0.59], [0.3, 0.7], [0.325, 0.8]].map(([r, y]) => new THREE.Vector2(r! * S, y! * S));
    const wine = new THREE.Mesh(new THREE.LatheGeometry(wineProf, 10), psMat({ color: '#9E1B32', side: THREE.DoubleSide }));
    this.wineTop = new THREE.Mesh(new THREE.CircleGeometry(0.325 * S, 10), psMat({ color: '#C8283F', emit: '#300008', side: THREE.DoubleSide }));
    this.wineTop.rotation.x = -Math.PI / 2; this.wineTop.position.y = 0.8 * S;
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 0.6, 8), psMat({ color: '#5A6488' }));
    ped.position.y = -0.3;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.29 * S + 0.06, 0.035, 4, 16), psMat({ color: '#FFD23F', emit: '#6A5010' }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 1.14 * S;
    this.brim.add(ring);
    // the gap bracket between the wine surface and the brim (outside the bowl)
    const brM = psMat({ color: '#FF4B5C', emit: '#400010' });
    const gx = 0.29 * S + 0.22, y0 = 0.8 * S, y1 = 1.14 * S;
    const vbar = new THREE.Mesh(new THREE.BoxGeometry(0.04, y1 - y0, 0.04), brM); vbar.position.set(gx, (y0 + y1) / 2, 0);
    const t0 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.04), brM); t0.position.set(gx - 0.05, y0, 0);
    const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.04), brM); t1.position.set(gx - 0.05, y1, 0);
    const bracket = new THREE.Group(); bracket.name = 'bracket'; bracket.add(vbar, t0, t1);
    this.brim.add(bracket);
    this.glass.add(ped, wine, this.wineTop, shell, this.brim);
    this.world.add(this.glass);
  }

  private buildTitles() {
    const fam = F.rubik();
    const mk = (word: string, isR: (i: number) => boolean) => {
      const root = new THREE.Group();
      const letters: THREE.Object3D[] = [];
      const gl = Array.from(word).map((ch) => (ch === ' ' ? null : blockGlyph(ch, fam)));
      const adv = gl.map((g) => (g ? g.width + 0.1 : 0.35));
      const total = adv.reduce((a, b) => a + b, 0) - 0.1;
      let x = -total / 2;
      gl.forEach((g, i) => {
        const piv = new THREE.Object3D();
        if (g) {
          const r = isR(i);
          const m = new THREE.Mesh(g.geo, [psMat({ color: r ? R_CAP : TITLE_CAP, emit: r ? '#300008' : '#302000' }), psMat({ color: r ? R_SIDE : TITLE_SIDE })]);
          piv.add(m);
        }
        piv.position.x = x + adv[i]! / 2 - 0.05;
        piv.userData.x0 = piv.position.x;
        x += adv[i]!;
        root.add(piv); letters.push(piv);
      });
      this.world.add(root);
      return { root, letters };
    };
    this.titles.rs = mk("R'S", (i) => i === 0);
    this.titles.straw = mk('STRAWBERRY', (i) => 'STRAWBERRY'[i] === 'R');
    this.titles.glass = mk('GLASS', () => false);
    this.titles.wine = mk('WINE', () => false);
  }

  private buildLabels() {
    const lab = (text: string, fg: string, bg: string, scale = 1) => {
      const w = textW(text, scale) + 6, h = 7 * scale + 6;
      const { tex } = canvasTex(w, h, (c) => {
        c.fillStyle = bg; c.fillRect(1, 0, w - 2, h); c.fillRect(0, 1, w, h - 2);
        c.fillStyle = shade(bg, 1.6); c.fillRect(1, h - 1, w - 2, 1);
        pixText(c, text, 3, 3, fg, scale);
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w / 40, h / 40), psMat({ map: tex, unlit: true, fog: 0.3, side: THREE.DoubleSide }));
      m.renderOrder = 5;
      this.world.add(m);
      return m;
    };
    this.labels.n1 = lab('1', '#1B1B2A', '#FFD23F', 2);
    this.labels.n2 = lab('2', '#1B1B2A', '#FFD23F', 2);
    this.labels.n3 = lab('3', '#1B1B2A', '#FFD23F', 2);
    this.labels.straw = lab('straw', '#E8E4D8', '#2E4A8C', 1);
    this.labels.berry = lab('berry', '#E8E4D8', '#2E4A8C', 1);
    this.labels.tokens = lab('the model sees 2 tokens', '#FFD23F', '#141B2E', 1);
    this.labels.brim = lab('BRIM', '#1B1B2A', '#FFD23F', 2);
    this.labels.gap = lab('GAP!', '#E8E4D8', '#C8283F', 2);
    this.labels.half = lab('half full', '#E8E4D8', '#141B2E', 1);
  }

  // ------------------------------------------------------------------ per-frame
  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const { renderer, comp, audio } = this.ctx;
    const t = f.t;
    const [d0, d1, d2, d3, d4, d5, d6] = this.db as [number, number, number, number, number, number, number];
    const shot = t < d1 ? 1 : t < d2 ? 2 : t < d3 ? 3 : t < d4 ? 4 : t < d5 ? 5 : 6;
    const [k1, k2, k3] = this.kicks as [number, number, number];
    const kstep = (k: number) => prog(t, k, k + 0.08, ease.outExpo);
    const kicks = kstep(k1) + kstep(k2) + kstep(k3);

    // defaults
    psGlobals.uLightCol.value.setRGB(1.0, 0.86, 0.7);
    psGlobals.uAmb.value.setRGB(0.22, 0.25, 0.36);
    psGlobals.uFogNear.value = 3.2; psGlobals.uFogFar.value = 13;
    this.berry.visible = false; this.berryShadow.visible = false; this.glass.visible = false;
    for (const d of this.dust) d.visible = false;
    for (const k in this.titles) this.titles[k]!.root.visible = false;
    for (const k in this.labels) this.labels[k]!.visible = false;
    this.dev.visible = true;
    this.faceMat.uniforms.uMap!.value = shot === 4 && t > d3 + 0.4 ? this.smugTex : this.faceTex;

    // the programmer types (hands bob on the vocal), hits enter on the first kick, then leans back
    const typing = (hash(frameIdx(t) >> 3, 1) - 0.5) * 0.12 * (t < k1 ? 1 : 0);
    const enter = prog(t, k1 - 0.06, k1, ease.inQuad) - prog(t, k1, k1 + 0.2, ease.outCubic);
    this.armL.rotation.x = 0.1 + typing;
    this.armR.rotation.x = 0.1 - typing + 0.35 * enter;
    const lean = prog(t, k1 + 0.1, k1 + 0.5, ease.outBack) * (shot <= 2 ? 1 : 0.6);
    this.dev.rotation.x = -0.12 * lean;
    this.head.rotation.set(-0.08 * lean + (shot === 4 ? 0.12 * Math.sin((t - d3) * 9) * prog(t, d3 + 0.45, d3 + 0.6) : 0), 0, 0);


    if (shot === 1) {
    } else if (shot === 2) {
      // the fill: the room darkens on each kick, a shadow grows on the floor
      const dim = 1 - 0.18 * kicks;
      psGlobals.uLightCol.value.multiplyScalar(dim); psGlobals.uAmb.value.multiplyScalar(dim);
      // the strawberry's shadow on the floor, growing as it falls from above
      this.berryShadow.visible = true;
      const s = 0.2 + 1.0 * prog(t, k1, d2, ease.inQuad);
      this.berryShadow.scale.setScalar(s);
      this.berryShadow.position.set(0, 0.012, 0.6);
      // and at the very end, it is in the top of the frame
      if (t > this.L1.start - 0.05) {
        // it descends out of the dark (hold the breath), then drops
        this.berry.visible = true;
        const hover = prog(t, this.L1.start - 0.05, d2 - 0.12, ease.outCubic);
        const fall = prog(t, d2 - 0.12, d2, ease.inQuad);
        this.berry.position.set(0, lerp(lerp(9, 4.6, hover), 1.3, fall), 0.6); this.berry.scale.set(1.2, 1.35, 1.2); this.berry.rotation.set(0, t * 2.5, 0.15);
      }
    } else if (shot === 3) {
      // SNAP: the strawberry lands on the downbeat; its title and the word drop in on the hits
      this.berry.visible = true; this.berryShadow.visible = true;
      const u = t - d2;
      const sq = 1 - 0.35 * Math.exp(-u * 10) * Math.cos(u * 30);
      this.berry.position.set(0, 1.3 * sq, 0.6);
      this.berry.scale.set(1.2 * (2 - sq), 1.35 * sq, 1.2 * (2 - sq));
      this.berry.rotation.set(0, 0.4 + u * 0.3, 0);
      this.berryShadow.scale.setScalar(1.3); this.berryShadow.position.set(0, 0.012, 0.6);
      this.dust.forEach((d, i) => {
        const a = (i / this.dust.length) * Math.PI * 2 + hash(i, 4) * 0.4, sp = 1.6 + hash(i, 5) * 1.6;
        const r = sp * (1 - Math.exp(-u * 3)), y = 0.1 + 1.6 * hash(i, 6) * u * Math.exp(-u * 2.5);
        d.visible = u < 1.1; d.position.set(Math.cos(a) * (1.2 + r), y, 0.6 + Math.sin(a) * (1.2 + r));
        d.scale.setScalar(Math.max(0.01, 1 - u)); d.rotation.set(u * 5 + i, u * 3, 0);
      });
      // "R'S" slams in on its word, then gets knocked away when STRAWBERRY arrives
      const rs = this.titles.rs!, sw = this.titles.straw!;
      const wR = this.L1.words[4]!, wS = this.L1.words[6]!;
      rs.root.visible = t >= wR.start - 0.02 && t < wS.start + 0.35;
      const rsIn = springStep(t - wR.start, 3.2, 0.42);
      const rsOut = prog(t, wS.start, wS.start + 0.35, ease.inCubic);
      rs.root.position.set(-2.4 * rsOut, lerp(5, 1.75, clamp(rsIn, 0, 1.2)) + 2.5 * rsOut * rsOut, 2.6);
      rs.root.rotation.set(-0.1, 0.1, 1.2 * rsOut);
      rs.root.scale.setScalar(1.2);
      // STRAWBERRY: letter by letter across the held note, the R's in red
      sw.root.visible = t >= wS.start - 0.02;
      sw.root.position.set(0, 1.05, 2.6); sw.root.rotation.set(-0.05, 0, 0); sw.root.scale.setScalar(0.56);
      const split = prog(t, this.tokenT, this.tokenT + 0.25, ease.outBack);
      sw.letters.forEach((l, i) => {
        const lt = wS.start + i * 0.035;
        const s = springStep(t - lt, 3.5, 0.45);
        l.visible = t >= lt;
        l.position.y = lerp(4, 0, clamp(s, 0, 1.3));
        l.position.z = 0;
        l.rotation.y = (1 - clamp(s)) * 1.5;
        l.position.x = l.userData.x0 + (i < 5 ? -0.55 : 0.55) * split;
      });
      // the count, 1-2-3 over the three R's
      sw.root.updateMatrixWorld(true);
      const rIdx = [2, 7, 8];
      rIdx.forEach((li, n) => {
        const lb = this.labels[`n${n + 1}`]!;
        const ct = this.countT[n]!;
        if (t < ct) return;
        lb.visible = true;
        const s = springStep(t - ct, 4, 0.4);
        const L = sw.letters[li]!;
        const wp = new THREE.Vector3(L.position.x, 1.35 + 0.2 * s, 0.4).applyMatrix4(sw.root.matrixWorld);
        lb.position.copy(wp); lb.scale.setScalar(clamp(s, 0, 1.2));
      });
      if (t >= this.tokenT) {
        const s = clamp(springStep(t - this.tokenT, 3.5, 0.5), 0, 1.2);
        sw.root.updateMatrixWorld();
        const lp = (li: number, y: number) => new THREE.Vector3(lerp(sw.letters[Math.floor(li)]!.position.x, sw.letters[Math.ceil(li)]!.position.x, li % 1), y, 0.3).applyMatrix4(sw.root.matrixWorld);
        const a = this.labels.straw!, b = this.labels.berry!, tk = this.labels.tokens!;
        a.visible = b.visible = tk.visible = true;
        a.position.copy(lp(2, 2.25)); b.position.copy(lp(7.5, 2.25)); tk.position.copy(new THREE.Vector3(0, 3.0, 0.3).applyMatrix4(sw.root.matrixWorld));
        for (const m of [a, b, tk]) m.scale.setScalar(s * 1.4);
      }
    } else if (shot === 4) {
      // the CRT answers "2" (camera in camAt); the programmer's face turns smug
    } else {
      // the glass rises like an item reveal; GLASS and WINE drop in; the BRIM ring and the gap
      this.glass.visible = true; this.dev.visible = shot === 5;
      const rise = springStep(t - d4, 2.4, 0.5);
      this.glass.position.set(0, lerp(-2.2, 0.6, clamp(rise, 0, 1.1)), 0.3);
      this.glass.rotation.y = (1 - clamp(rise)) * 3 + t * 0.2;
      this.wineTop.rotation.set(-Math.PI / 2 + 0.05 * Math.sin(t * 6) * Math.exp(-(t - d4)), 0, 0);
      const bracket = this.brim.getObjectByName('bracket')!;
      bracket.visible = t > d5 + 0.1;
      bracket.scale.y = clamp(prog(t, d5 + 0.1, d5 + 0.35, ease.outBack), 0.01, 1.2);
      bracket.rotation.y = -this.glass.rotation.y; // stays on the world +x side, next to the labels
      const gl = this.titles.glass!, wn = this.titles.wine!;
      const wG = this.L2.words[4]!, wW = this.L2.words[6]!;
      const drop = (root: THREE.Group, t0: number, y: number, z: number, sc: number) => {
        root.visible = t >= t0 - 0.02;
        const s = springStep(t - t0, 3.2, 0.42);
        root.position.set(-1.6, lerp(7, y, clamp(s, 0, 1.25)), z); root.scale.setScalar(sc); root.rotation.set(-0.08, 0, 0);
      };
      drop(gl.root, Math.max(wG.start, d4), 3.7, -1.2, 0.9);
      drop(wn.root, wW.start, 2.45, -1.0, 0.9);
      // labels near the rim
      const gy = this.glass.position.y;
      const brimL = this.labels.brim!;
      brimL.visible = t > d4 + 0.3;
      brimL.position.set(1.45, gy + 1.78, 0.5); brimL.scale.setScalar(clamp(springStep(t - d4 - 0.3, 3, 0.5), 0, 1.2) * (shot === 6 ? 0.75 : 1.0));
      if (shot === 6) {
        const gp = this.labels.gap!, hf = this.labels.half!;
        gp.visible = t > d5 + 0.2; hf.visible = t > d5 + 0.35;
        gp.position.set(1.45, gy + 1.42, 0.6); gp.scale.setScalar(clamp(springStep(t - d5 - 0.2, 3, 0.5), 0, 1.2) * 0.7);
        hf.position.set(1.45, gy + 1.08, 0.6); hf.scale.setScalar(clamp(springStep(t - d5 - 0.35, 3, 0.5), 0, 1.2) * 0.9);
      }
      if (shot === 6) {
        const up = prog(t, this.L2.words[6]!.end + 0.05, d6 - 0.1, ease.inOutCubic);
        for (const k of ['brim', 'gap', 'half']) this.labels[k]!.visible = this.labels[k]!.visible && up < 0.35;
        bracket.visible = bracket.visible && up < 0.35;
        this.titles.glass!.root.visible = false;
        this.titles.wine!.root.visible = false;
      }
    }

    // camera (a pure function of t, also used to anchor the dialogue panels in the world)
    const cam = this.cam;
    const cs = this.camAt(t);
    const shake = shot === 2 ? 0.02 * audio.hit('kick', t, 0.06) : shot === 3 ? 0.12 * Math.exp(-(t - d2) * 8) : 0;
    this.pose(cam, cs);
    cam.position.x += shake * (hash(frameIdx(t), 7) - 0.5); cam.position.y += shake * (hash(frameIdx(t), 8) - 0.5);
    for (const k in this.labels) this.labels[k]!.quaternion.copy(cam.quaternion);

    this.drawScreen(t);
    this.drawPanels(t, shot);

    // low-res pass, UI on top (same pixel grid), then 15-bit + dither and the nearest upscale
    renderer.setRenderTarget(this.low);
    renderer.setClearColor(new THREE.Color(C_FOG).convertSRGBToLinear(), 1);
    renderer.clear(true, true, true);
    renderer.render(this.world, cam);
    this.outPass.u.src!.value = this.low.texture;
    this.outPass.render(renderer, out);
    return { bloom: 0, halation: 0, ca: 0, grain: 0, vignette: 0.22 };
  }

  // ------------------------------------------------------------------ the CRT screen (128x96)
  private drawScreen(t: number) {
    const c = this.screen.ctx;
    const [d0, , d2, d3] = this.db as [number, number, number, number];
    c.fillStyle = '#10162A'; c.fillRect(0, 0, 128, 96);
    c.fillStyle = '#2E4A8C'; c.fillRect(0, 0, 128, 11);
    pixText(c, 'chat', 4, 2, '#E8E4D8');
    c.fillStyle = '#E8E4D8'; c.fillRect(112, 3, 5, 5); c.fillRect(119, 3, 5, 5);
    const prompt = `how many r's in "strawberry"?`;
    const typeFrom = d0 - 0.5, typeTo = this.L0.words[6]!.start + 0.15;
    const n = Math.floor(clamp((t - typeFrom) / (typeTo - typeFrom)) * prompt.length);
    const lines = ['> how many r\'s in', '  "strawberry"?'];
    let left = n;
    lines.forEach((ln, i) => {
      const k = Math.min(ln.length, i === 0 ? left + 2 : left + 2);
      pixText(c, ln.slice(0, Math.max(0, k)), 4, 16 + i * 10, '#E8E4D8');
      left -= ln.length - 2;
    });
    if (t < d2 && Math.floor(t * 4) % 2 === 0) { c.fillStyle = '#FFD23F'; c.fillRect(4 + 16 * ADV, 36, 5, 7); }
    if (t >= d3 - 0.05) {
      const k = Math.floor(clamp((t - d3 + 0.05) / 0.3) * 40);
      pixText(c, 'There are'.slice(0, k), 4, 44, '#8CD3FF');
      if (k > 9) pixText(c, '2', 64, 40, '#FFD23F', 4, { shadow: '#2E4A8C' });
      if (k > 12) pixText(c, `R's in`, 4, 64, '#8CD3FF');
      if (k > 20) pixText(c, '"strawberry".', 4, 76, '#8CD3FF');
    }
    // scanlines
    c.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 1; y < 96; y += 2) c.fillRect(0, y, 128, 1);
    this.screen.tex.needsUpdate = true;
  }

  // ------------------------------------------------------------------ the camera: a pure function of t
  private camAt(t: number): CamState {
    const [d0, d1, d2, d3, d4, d5, d6] = this.db as [number, number, number, number, number, number, number];
    const [k1, k2, k3] = this.kicks as [number, number, number];
    const kv = (ks: [number, V3, ((x: number) => number)?][]): V3 => [0, 1, 2].map((i) => keys(t, ks.map(([tt, v, e]) => [tt, v[i]!, e] as Key))) as V3;
    const mix3 = (a: V3, b: V3, u: number): V3 => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
    if (t < d1) {
      // a sweeping arc from behind the room round to over his shoulder, onto the CRT
      return {
        P: kv([[d0, [1.9, 2.2, 0.4]], [d0 + 0.7, [0.2, 1.8, -0.9], ease.inOutCubic], [d1, [-0.62, 1.52, -1.9], ease.inOutCubic]]),
        T: kv([[d0, [0.0, 1.1, -2.9]], [d1, [0.0, 1.12, -3.25], ease.inOutCubic]]),
        roll: keys(t, [[d0, -0.08], [d1, 0.03]]), fov: 52,
      };
    }
    if (t < d2) {
      // the fill: three stepped push-ins onto the monitor, one per kick; then pull back and look up (hold the breath)
      const screen: V3 = [0, 1.08, -3.2];
      const dir = new THREE.Vector3(-0.62, 0.22, 1).normalize();
      const step = (k: number) => prog(t, k, k + 0.09, ease.outExpo);
      const dist = 1.75 - 0.36 * (step(k1) + step(k2) + step(k3)) - 0.1 * prog(t, d1, k1, ease.outCubic);
      const Pn: V3 = [screen[0] + dir.x * dist, screen[1] + dir.y * dist, screen[2] + dir.z * dist];
      const look = prog(t, this.L1.start - 0.05, d2, ease.inOutCubic);
      return {
        P: mix3(Pn, [-1.3, 1.25, -0.9], look),
        T: mix3(screen, [0.0, 4.0, 0.4], look),
        roll: -0.03 * (step(k1) - step(k2) + step(k3)) - 0.12 * look, fov: 50 + 8 * look,
      };
    }
    if (t < d3) {
      // SNAP: crash zoom from wide onto the landed strawberry, then a slow dolly along the word
      const wS = this.L1.words[6]!;
      return {
        P: kv([[d2, [0.4, 2.2, 10.5]], [d2 + 0.3, [0.0, 1.6, 7.0], ease.outExpo], [wS.start, [-0.5, 1.2, 6.6], ease.inOutCubic], [d3, [0.7, 1.0, 6.1], ease.inOutCubic]]),
        T: kv([[d2, [0, 1.3, 0.6]], [wS.start, [0, 1.35, 1.5]], [d3, [0.3, 1.3, 2.0], ease.inOutCubic]]),
        roll: 0.12 * (1 - springStep(t - d2, 2, 0.5)), fov: 52,
      };
    }
    if (t < d4) {
      // the CRT's answer, the smug face, then out wide over the room where the glass will stand
      const toFace = prog(t, d3 + 0.33, d3 + 0.55, ease.inOutCubic);
      const Pscr: V3 = [0.55, 1.2, -2.75], Tscr: V3 = [0.02, 1.1, -3.2];
      const Pfac: V3 = [0.5, 1.5, -3.25], Tfac: V3 = [0.0, 1.33, -2.44];
      const punch = 1 - ease.outExpo(prog(t, d3, d3 + 0.3));
      let P = mix3(mix3(Pscr, Tscr, -0.6 * punch), Pfac, toFace);
      let T = mix3(Tscr, Tfac, toFace);
      const wide = prog(t, this.L2.start + 0.1, d4, ease.inOutCubic);
      // sideways first (clear of the desk and the programmer), then out over the room
      P = [lerp(P[0], 3.2, ease.outCubic(wide)), lerp(P[1], 2.4, wide), lerp(P[2], 4.8, ease.inQuad(wide))];
      T = mix3(T, [0, 1.2, 0.3], wide);
      return { P, T, roll: 0.05 * Math.sin(toFace * Math.PI) - 0.06 * wide, fov: 48 + 8 * wide };
    }
    const gy = lerp(-2.2, 0.6, clamp(springStep(t - d4, 2.4, 0.5), 0, 1.1));
    if (t < d5) {
      const orb = keys(t, [[d4, -0.9], [d4 + 0.35, -0.35, ease.outExpo], [d5, 0.25, ease.inOutCubic]]);
      const r = keys(t, [[d4, 6.8], [d4 + 0.35, 4.8, ease.outExpo], [d5, 4.1]]);
      return {
        P: [Math.sin(orb) * r, keys(t, [[d4, 0.6], [d4 + 0.35, 1.7, ease.outExpo], [d5, 2.0]]), 0.3 + Math.cos(orb) * r],
        T: [0, keys(t, [[d4, 1.2], [d4 + 0.35, 1.9, ease.outExpo], [d5, 2.1]]), 0.2],
        roll: 0.06 * Math.sin(orb * 2), fov: 52,
      };
    }
    // low and close on the gap, then craning up until the rim is a circle
    const le = this.L2.words[6]!.end;
    const up = prog(t, le + 0.05, d6 - 0.1, ease.inOutCubic);
    const gyR = gy + 1.14 * 1.5;
    const Pc = kv([[d5, [1.5, gy + 1.5, 3.9]], [le + 0.05, [1.1, gy + 1.55, 3.4], ease.outCubic]]);
    return { P: mix3(Pc, [0.0, gyR + 2.3, 0.56], up), T: mix3([0.55, gy + 1.4, 0.3], [0, gyR, 0.55], up), roll: 0.08 * (1 - up), fov: 46 };
  }

  private pose(o: THREE.PerspectiveCamera, c: CamState) {
    o.fov = c.fov; o.updateProjectionMatrix();
    o.position.set(...c.P);
    o.up.set(0, 1, 0);
    if (Math.abs(c.P[0] - c.T[0]) + Math.abs(c.P[2] - c.T[2]) < 0.05) o.up.set(0, 0, -1);
    o.lookAt(c.T[0], c.T[1], c.T[2]);
    o.rotateZ(c.roll);
  }

  private refCam = new THREE.PerspectiveCamera(52, LW / LH, 0.05, 40);
  /**
   * Hang a window in the world in front of where the camera is at `h.ref`: the live camera then moves
   * around it (parallax, perspective, the same vertex snapping and affine warp as the set).
   * `open` (0..1) is the window's open/close animation (it grows from its centre line).
   */
  private hang(m: THREE.Mesh, texW: number, texH: number, h: Hang, open: number, t: number) {
    m.visible = open > 0.01;
    if (!m.visible) return;
    const c = this.camAt(h.follow !== undefined ? Math.max(h.ref, t - h.follow) : h.ref);
    const rc = this.refCam; this.pose(rc, c);
    const dCam = Math.hypot(c.T[0] - c.P[0], c.T[1] - c.P[1], c.T[2] - c.P[2]);
    const D = h.D ?? Math.min(1.1, 0.6 * dCam);
    const hh = D * Math.tan(THREE.MathUtils.degToRad(c.fov / 2)), hw = hh * (LW / LH);
    const q = rc.quaternion;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q), right = new THREE.Vector3(1, 0, 0).applyQuaternion(q), upv = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const bob = 0.02 * Math.sin(t * 2.3 + h.ref * 7.1);
    m.position.copy(rc.position).addScaledVector(fwd, D).addScaledVector(right, h.x * hw).addScaledVector(upv, (h.y + bob) * hh);
    m.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(h.pitch, h.yaw, 0, 'YXZ')));
    const w = h.frac * 2 * hw;
    m.scale.set(w * (0.6 + 0.4 * open), w * (texH / texW) * open, 1);
  }

  // ------------------------------------------------------------------ the dialogue windows
  private drawPanels(t: number, shot: number) {
    const [d0, d1, d2, d3, d4, d5, d6] = this.db as [number, number, number, number, number, number, number];
    const [, , k3] = this.kicks as [number, number, number];
    const le = this.L2.words[6]!.end;
    // where the lyric window hangs in each stretch; it closes and reopens (0.12 s) between stretches
    const LY: [number, number, Hang][] = [
      [d0, d0 + 0.75, { ref: d0, follow: 0.03, D: 0.95, x: -0.02, y: -0.5, frac: 0.64, yaw: 0.28, pitch: -0.12 }],
      [d0 + 0.75, d1, { ref: d0 + 0.75, follow: 0.05, D: 0.9, x: 0.04, y: -0.5, frac: 0.74, yaw: -0.26, pitch: -0.1 }],
      [d1, this.L1.start - 0.05, { ref: d1, follow: 0, D: 0.7 + this.kicks.reduce((a, k) => a + (t >= k ? 0.3 * Math.exp(-(t - k) / 0.07) : 0), 0), x: 0.0, y: -0.5, frac: 0.7, yaw: -0.22 + 0.1 * Math.sin(t * 3), pitch: -0.08 }],
      [this.L1.start - 0.05, d2, { ref: d2 - 0.1, x: 0.05, y: -0.5, frac: 0.72, yaw: 0.2, pitch: 0.18 }],
      [d2, d3, { ref: this.L1.words[6]!.start + 0.3, D: 2.2, x: 0.0, y: -0.55, frac: 0.72, yaw: -0.2, pitch: -0.2 }],
      [d3, d3 + 0.35, { ref: d3 + 0.25, x: -0.12, y: -0.5, frac: 0.72, yaw: 0.3, pitch: -0.1 }],
      [d3 + 0.35, this.L2.start + 0.1, { ref: d3 + 0.7, x: 0.08, y: -0.56, frac: 0.66, yaw: -0.3, pitch: -0.1 }],
      [this.L2.start + 0.1, this.L2.start + 0.38, { ref: this.L2.start + 0.1, follow: 0.1, D: 1.0, x: -0.05, y: -0.5, frac: 0.72, yaw: 0.25, pitch: -0.15 }],
      [this.L2.start + 0.38, d4, { ref: this.L2.start + 0.38, follow: 0.06, D: 1.3, x: -0.05, y: -0.5, frac: 0.72, yaw: -0.2, pitch: -0.15 }],
      [d4, d5, { ref: d5 - 0.45, D: 2.2, x: -0.05, y: -0.52, frac: 0.72, yaw: -0.22, pitch: -0.15 }],
      [d5, le + 0.05, { ref: le, D: 1.6, x: -0.08, y: -0.52, frac: 0.72, yaw: 0.28, pitch: -0.12 }],
      [le + 0.05, d6 + 0.1, { ref: le + 0.05, follow: 0.015, D: 0.8, x: 0.0, y: -0.5, frac: 0.64, yaw: 0.12, pitch: -0.2 }],
    ];
    const OC = 0.12;
    const openAt = (a: number, b: number, first: boolean) => (first ? 1 : clamp((t - a) / OC)) * (t > b - OC && b < d6 ? 1 - ease.inQuad(clamp((t - (b - OC)) / OC)) : 1);
    const seg = LY.find(([a, b]) => t >= a && t < b) ?? LY[LY.length - 1]!;
    // no close/open across a hard cut: the window just reappears in the new shot, opening
    const lyOpen = openAt(seg[0], seg[1], seg[0] === d0);
    this.drawLyric(t);
    this.hang(this.lyricPanel, LYR_W, LYR_H, seg[2], ease.outBack(clamp(lyOpen)), t);

    // the chat window: the programmer's prompts and the chatbot's answers
    type Chat = { who: 'you' | 'chatbot'; lines: string[]; from: number; rate: number; a: number; b: number; hang: Hang };
    const chats: Chat[] = [
      { who: 'you', lines: [`how many r's in`, `"strawberry"?`], from: d0 - 0.5, rate: 26, a: d0, b: d1, hang: { ref: d0, follow: 0.04, D: 1.0, x: 0.42, y: 0.55, frac: 0.5, yaw: -0.3, pitch: 0.1 } },
      { who: 'chatbot', lines: [`There are 2 R's`, `in "strawberry".`], from: d3 + 0.02, rate: 60, a: d3, b: d3 + 0.35, hang: { ref: d3 + 0.25, x: 0.44, y: 0.56, frac: 0.5, yaw: -0.35, pitch: 0.1 } },
      { who: 'chatbot', lines: [`There are 2 R's`, `in "strawberry".`], from: d3 - 1, rate: 60, a: d3 + 0.35, b: this.L2.start + 0.1, hang: { ref: d3 + 0.7, x: -0.3, y: 0.48, frac: 0.5, yaw: 0.3, pitch: 0.1 } },
      { who: 'you', lines: ['draw: a wine glass', 'filled to the brim'], from: d4 + 0.02, rate: 70, a: d4, b: d5, hang: { ref: d5 - 0.45, D: 2.0, x: 0.44, y: 0.56, frac: 0.5, yaw: -0.3, pitch: 0.12 } },
      { who: 'chatbot', lines: [`Here's a wine glass`, 'filled to the brim!'], from: d5 + 0.02, rate: 70, a: d5, b: le + 0.2, hang: { ref: le, D: 1.5, x: 0.44, y: 0.56, frac: 0.5, yaw: -0.3, pitch: 0.12 } },
    ];
    const chat = chats.find((c) => t >= c.a && t < c.b) ?? null;
    if (chat) {
      this.drawChat(chat.who, chat.lines, Math.floor((t - chat.from) * chat.rate));
      const hardCut = [d1, d2, d3, d4, d5].includes(chat.b);
      const open = clamp((t - chat.a) / OC) * (hardCut ? 1 : 1 - ease.inQuad(clamp((t - (chat.b - OC)) / OC)));
      this.hang(this.chatPanel, CHAT_W, CHAT_H, chat.hang, ease.outBack(clamp(open)), t);
    } else this.chatPanel.visible = false;
    void shot; void d2;
  }

  /** The lyric window: speaker tab, two rows of 2x bitmap text typed per character (held notes wave). */
  private drawLyric(t: number) {
    const c = this.lyricC.ctx;
    c.clearRect(0, 0, LYR_W, LYR_H);
    const line = t < this.L1.start ? this.L0 : t < this.L2.start ? this.L1 : this.L2;
    const by = 8, bh = LYR_H - by;
    this.panel(c, 0, by, LYR_W, bh);
    this.tab(c, 8, 0, 'DEV', '#3F7A5A');
    const keyWord = (w: Word) => /r[’']s|strawberry|glass|wine/i.test(w.w);
    // greedy rows of at most 19 characters (2x glyphs: 12 px each)
    const rows: Word[][] = [[]];
    let n = 0;
    for (const w of line.words) {
      const len = Array.from(w.w).length;
      if (n > 0 && n + 1 + len > 19) { rows.push([]); n = 0; }
      rows[rows.length - 1]!.push(w); n += (n > 0 ? 1 : 0) + len;
    }
    rows.forEach((row, ri) => {
      let x = 8;
      const y = by + 9 + ri * 19;
      for (const w of row) {
        const len = Array.from(w.w).length;
        const dur = Math.min(0.22, (w.end - w.start) * 0.8);
        const held = w.end - w.start > 0.5;
        const holdAmp = held ? clamp((t - w.start - dur) / 0.15) * (1 - clamp((t - w.end) / 0.3)) : 0;
        pixText(c, w.w, x, y, keyWord(w) ? UI_KEY : UI_LINE, 2, {
          shadow: '#05070F',
          each: (i) => {
            const ct = w.start + (i / len) * dur;
            if (t < ct) return null;
            const pop = t - ct < 0.05 ? -1 : 0;
            return [0, pop + Math.round(Math.sin(t * 16 - i * 0.8) * 2 * holdAmp)];
          },
        });
        x += (len + 1) * ADV * 2;
      }
    });
    if (t > line.end && Math.floor(t * 5) % 2 === 0) {
      c.fillStyle = UI_KEY; const ax = LYR_W - 14, ay = LYR_H - 10;
      c.fillRect(ax, ay, 7, 1); c.fillRect(ax + 1, ay + 1, 5, 1); c.fillRect(ax + 2, ay + 2, 3, 1); c.fillRect(ax + 3, ay + 3, 1, 1);
    }
    this.lyricC.tex.needsUpdate = true;
  }

  /** The chat window: portrait, name tab, two typed lines. */
  private drawChat(who: 'you' | 'chatbot', lines: string[], typed: number) {
    const c = this.chatC.ctx;
    c.clearRect(0, 0, CHAT_W, CHAT_H);
    const y = 8;
    this.panel(c, 0, y, CHAT_W, CHAT_H - y);
    this.portrait(c, 6, y + 6, who);
    this.tab(c, 38, 1, who, who === 'you' ? '#3F7A5A' : '#2E4A8C');
    let n = typed;
    lines.forEach((ln, i) => {
      pixText(c, ln, 40, y + 11 + i * 12, UI_LINE, 1, {
        shadow: '#05070F',
        each: (k) => (k < n ? [0, 0] : null),
        colorAt: (k) => (who === 'chatbot' && ln[k] === '2' ? UI_KEY : UI_LINE),
      });
      n -= ln.length;
    });
    this.chatC.tex.needsUpdate = true;
  }

  private panel(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    c.fillStyle = '#05070F'; c.fillRect(x + 2, y, w - 4, h); c.fillRect(x, y + 2, w, h - 4); c.fillRect(x + 1, y + 1, w - 2, h - 2);
    c.fillStyle = UI_BG; c.fillRect(x + 2, y + 2, w - 4, h - 4);
    c.fillStyle = UI_LINE;
    c.fillRect(x + 3, y + 1, w - 6, 1); c.fillRect(x + 3, y + h - 2, w - 6, 1); c.fillRect(x + 1, y + 3, 1, h - 6); c.fillRect(x + w - 2, y + 3, 1, h - 6);
    c.fillRect(x + 2, y + 2, 1, 1); c.fillRect(x + w - 3, y + 2, 1, 1); c.fillRect(x + 2, y + h - 3, 1, 1); c.fillRect(x + w - 3, y + h - 3, 1, 1);
    c.fillStyle = UI_DIM; c.fillRect(x + 4, y + 3, w - 8, 1);
  }
  private tab(c: CanvasRenderingContext2D, x: number, y: number, name: string, col: string) {
    const w = textW(name) + 8;
    c.fillStyle = '#05070F'; c.fillRect(x - 1, y - 1, w + 2, 12);
    c.fillStyle = col; c.fillRect(x, y, w, 10);
    c.fillStyle = UI_LINE; c.fillRect(x, y, w, 1);
    pixText(c, name, x + 4, y + 2, UI_LINE);
  }
  /** 28x28 portraits: the programmer (smug), and the chatbot (an original CRT face). */
  private portrait(c: CanvasRenderingContext2D, x: number, y: number, who: 'you' | 'chatbot') {
    c.fillStyle = '#05070F'; c.fillRect(x - 1, y - 1, 30, 30);
    c.fillStyle = '#1B2A55'; c.fillRect(x, y, 28, 28);
    const px = (a: number, b: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(x + a, y + b, w, h); };
    if (who === 'you') {
      px(7, 6, 14, 17, '#E0B08A'); px(6, 3, 16, 6, '#3A2A1E'); px(6, 9, 2, 5, '#3A2A1E'); px(20, 9, 2, 5, '#3A2A1E');
      px(9, 12, 3, 1, '#1B1B2A'); px(16, 12, 3, 1, '#1B1B2A'); px(10, 11, 2, 1, '#1B1B2A'); px(16, 11, 2, 1, '#1B1B2A');
      px(10, 18, 8, 1, '#7A2E2E'); px(17, 17, 2, 1, '#7A2E2E'); px(11, 18, 6, 1, '#F3ECDF');
      px(5, 23, 18, 5, '#3F7A5A');
    } else {
      px(4, 5, 20, 17, '#C9BFA3'); px(6, 7, 16, 12, '#10162A');
      px(9, 10, 3, 3, '#8CD3FF'); px(16, 10, 3, 3, '#8CD3FF'); px(10, 16, 8, 1, '#8CD3FF');
      px(11, 22, 6, 3, '#C9BFA3'); px(8, 25, 12, 2, '#9A917A');
    }
  }
}
