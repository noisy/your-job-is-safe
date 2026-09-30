// The PS1 stage: the base class every scene of the video extends, and the in-world UI toolkit.
//
//   export default class MyScene extends Ps1Stage {
//     override async init() { this.world.add(...); }
//     camAt(t) { return { P: [x, y, z], T: [x, y, z], roll: 0, fov: 52 }; }   // a pure function of t
//     override render(f, out) { this.begin(); /* animate */ return this.present(f, out); }
//   }
//
// `present` poses the camera from camAt(t) (plus shake), renders the world at 384x216 and writes the
// 15-bit dithered, nearest-upscaled frame into `out`. Everything the lyrics need (panels hung in the
// world, typed dialogue text, block titles, pixel labels) lives here so every scene looks the same.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { FSPass, makeRT } from '../engine/gl';
import { F } from '../engine/type';
import { Lyrics, type Word } from '../engine/lyrics';
import { clamp, ease, hash, frameIdx, springStep } from '../engine/util';
import { LW, LH, ADV, pixText, textW, psGlobals, psMat, canvasTex, blockGlyph, PS_OUT_FRAG, PAPER_OUT_FRAG } from './gfx';
import { PAPER } from './skin';
import { P } from './palette';

export type V3 = [number, number, number];
/** The layer of always-on-top UI windows (drawn after the paper out pass; PS1 renders both layers at once). */
export const UI_LAYER = 1;
/**
 * Mark your own always-on-top mesh (depthTest off, drawn over the world, like a Panel) as UI: it joins the
 * transparent pass and the UI layer, so the paper skin's contact shadows and cut edges don't draw over it.
 */
export function asUi(m: THREE.Mesh, order = 20) {
  const mm = m.material as THREE.Material;
  mm.depthTest = false; mm.transparent = true; mm.depthWrite = false;
  m.renderOrder = order;
  m.layers.set(UI_LAYER);
  return m;
}
export type CamState = { P: V3; T: V3; roll?: number; fov?: number; up?: V3 };

/** Default engine post for the PS1 look: no bloom, grain, halation or chromatic aberration. */
export const PS1_POST: PostOverrides = PAPER
  ? { bloom: 0, halation: 0, ca: 0, grain: 0.028, vignette: 0.28 } // paper: a little paper grain, no pixels
  : { bloom: 0, halation: 0, ca: 0, grain: 0, vignette: 0.22 };

/** The paper skin's backdrop for a scene's fog colour: lifted and saturated like the paper material. */
function paperBackdrop(hex: string) {
  const c = new THREE.Color(hex); // sRGB components
  const lift = (x: number) => 0.14 + 0.86 * x;
  const r = lift(c.r), g = lift(c.g), b = lift(c.b);
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  const sat = (x: number) => Math.min(1, Math.max(0, l + (x - l) * 1.3));
  return new THREE.Color(sat(r), sat(g), sat(b));
}

export abstract class Ps1Stage extends Scene {
  world = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(52, LW / LH, 0.05, 80);
  /** Clear/fog colour of this scene (sRGB hex). */
  fogColor: string = P.fog;
  fogNear = 3.2;
  fogFar = 13;
  /** The world's render target: 384x216 nearest (PS1), or the full output size with 4x MSAA (paper). */
  private low = PAPER
    ? makeRT(undefined, undefined, { depthBuffer: true, samples: 4, depthTexture: new THREE.DepthTexture(1, 1) })
    : makeRT(LW, LH, { pxScale: 1, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
  private outPass = new FSPass(PAPER ? PAPER_OUT_FRAG : PS_OUT_FRAG, {
    src: { value: null }, res: { value: PAPER ? new THREE.Vector2(this.low.width, this.low.height) : new THREE.Vector2(LW, LH) }, dither: { value: 1 },
    depth: { value: null }, near: { value: 0.05 }, far: { value: 80 }, aoAmt: { value: 0.75 }, edgeAmt: { value: 0.6 },
  });
  private clear = new THREE.Color();
  /** Camera shake for this frame (world units), set by scenes via `shake()`. */
  private shakeAmt = 0;

  /** The camera, as a pure function of song time. Also used to hang panels in the world. */
  abstract camAt(t: number): CamState;

  /**
   * Reset the shared PS1 uniforms to this scene's defaults. psGlobals is shared by every scene's
   * materials, so each scene must set its lighting at the start of every render (call this first).
   */
  begin() {
    psGlobals.uLightDir.value.set(0.4, 0.8, 0.45).normalize();
    psGlobals.uLightCol.value.setRGB(1.0, 0.86, 0.7);
    psGlobals.uAmb.value.setRGB(0.22, 0.25, 0.36);
    psGlobals.uFogNear.value = this.fogNear;
    psGlobals.uFogFar.value = this.fogFar;
    psGlobals.uFogColor.value.set(this.fogColor).convertSRGBToLinear();
    psGlobals.uSnap.value = PAPER ? 0 : 1;
    this.shakeAmt = 0;
  }

  /** Add camera shake for this frame (seeded per output frame, so every sub-frame of a frame agrees). */
  shake(amount: number) { this.shakeAmt += amount; }

  /** Point a camera at a CamState. */
  pose(o: THREE.PerspectiveCamera, c: CamState) {
    o.fov = c.fov ?? 52; o.updateProjectionMatrix();
    o.position.set(c.P[0], c.P[1], c.P[2]);
    if (c.up) o.up.set(c.up[0], c.up[1], c.up[2]);
    else if (Math.abs(c.P[0] - c.T[0]) + Math.abs(c.P[2] - c.T[2]) < 0.05) o.up.set(0, 0, -1);
    else o.up.set(0, 1, 0);
    o.lookAt(c.T[0], c.T[1], c.T[2]);
    o.rotateZ(c.roll ?? 0);
  }

  /** Pose the camera for t, render the world at 384x216 and write the dithered, upscaled frame. */
  present(f: Frame, out: THREE.WebGLRenderTarget, post: PostOverrides = {}): PostOverrides {
    const { renderer } = this.ctx;
    this.pose(this.cam, this.camAt(f.t));
    if (this.shakeAmt > 0) {
      const k = frameIdx(f.t);
      this.cam.position.x += this.shakeAmt * (hash(k, 7) - 0.5);
      this.cam.position.y += this.shakeAmt * (hash(k, 8) - 0.5);
    }
    this.world.updateMatrixWorld(true);
    for (const p of this.panels) p.place(this, f.t);
    for (const l of this.billboards) l.quaternion.copy(this.cam.quaternion);
    renderer.setRenderTarget(this.low);
    if (PAPER) this.clear.copy(paperBackdrop(this.fogColor)).convertSRGBToLinear();
    else this.clear.set(this.fogColor).convertSRGBToLinear();
    renderer.setClearColor(this.clear, 1);
    renderer.clear(true, true, true);
    if (PAPER) this.cam.layers.set(0); else { this.cam.layers.set(0); this.cam.layers.enable(UI_LAYER); }
    renderer.render(this.world, this.cam);
    this.outPass.u.src!.value = this.low.texture;
    if (PAPER) {
      this.outPass.u.depth!.value = this.low.depthTexture;
      this.outPass.u.near!.value = this.cam.near; this.outPass.u.far!.value = this.cam.far;
    }
    this.outPass.render(renderer, out);
    if (PAPER) {
      // the windows, straight into the output (depthTest off: no depth needed)
      this.cam.layers.set(UI_LAYER);
      renderer.setRenderTarget(out);
      renderer.render(this.world, this.cam);
      this.cam.layers.set(0);
    }
    return { ...PS1_POST, ...post };
  }

  // ---------------------------------------------------------------- in-world UI
  panels: Panel[] = [];
  billboards: THREE.Object3D[] = [];

  /** A canvas-textured quad in the world (a dialogue window, a menu, a sign). See Panel. */
  panel(texW: number, texH: number) {
    const p = new Panel(texW, texH);
    this.world.add(p.mesh);
    this.panels.push(p);
    return p;
  }

  /** A pixel-text label that always faces the camera (numbers, tags, BRIM…), `h` world units per texel row. */
  label(text: string, fg: string, bg: string, scale = 1, texel = 1 / 40) {
    const w = textW(text, scale) + 6, h = 7 * scale + 6;
    const { tex } = canvasTex(w, h, (c) => {
      c.fillStyle = bg; c.fillRect(1, 0, w - 2, h); c.fillRect(0, 1, w, h - 2);
      c.fillStyle = P.uiEdge; c.fillRect(1, h - 1, w - 2, 1);
      pixText(c, text, 3, 3, fg, scale);
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w * texel, h * texel), psMat({ map: tex, unlit: true, fog: 0.3, side: THREE.DoubleSide }));
    m.renderOrder = 5;
    this.world.add(m);
    this.billboards.push(m);
    return m;
  }

  /** Extruded block-letter title (Rubik Mono One), letters on pivots for per-letter animation. */
  blockTitle(word: string, opts: { cap?: string; side?: string; capAt?: (i: number, ch: string) => [string, string] | null; depth?: number; tracking?: number } = {}) {
    const root = new THREE.Group();
    const letters: THREE.Object3D[] = [];
    const fam = F.rubik();
    const gl = Array.from(word).map((ch) => (ch === ' ' ? null : blockGlyph(ch, fam, opts.depth ?? 0.34)));
    const tr = opts.tracking ?? 0.1;
    const adv = gl.map((g) => (g ? g.width + tr : 0.35));
    const total = adv.reduce((a, b) => a + b, 0) - tr;
    let x = -total / 2;
    gl.forEach((g, i) => {
      const piv = new THREE.Object3D();
      if (g) {
        const ch = word[i]!;
        const [cap, side] = opts.capAt?.(i, ch) ?? [opts.cap ?? P.title, opts.side ?? P.titleSide];
        piv.add(new THREE.Mesh(g.geo, [psMat({ color: cap, emit: '#201808' }), psMat({ color: side })]));
      }
      piv.position.x = x + adv[i]! / 2 - tr / 2;
      piv.userData.x0 = piv.position.x;
      x += adv[i]!;
      root.add(piv); letters.push(piv);
    });
    this.world.add(root);
    return { root, letters, width: total };
  }

  /** Cubes flung out from a point on an impact at t0 (a pure function of t). Returns the group. */
  dustBurst(n = 14, color: string = P.beige, size = 0.12) {
    const g = new THREE.Group();
    const m = psMat({ color, unlit: true });
    for (let i = 0; i < n; i++) g.add(new THREE.Mesh(new THREE.BoxGeometry(size, size, size), m));
    this.world.add(g);
    return {
      group: g,
      update(t: number, t0: number, at: V3, radius = 1.2, life = 1.1) {
        const u = t - t0;
        g.visible = u >= 0 && u < life;
        if (!g.visible) return;
        g.children.forEach((d, i) => {
          const a = (i / n) * Math.PI * 2 + hash(i, 4) * 0.4, sp = 1.6 + hash(i, 5) * 1.6;
          const r = sp * (1 - Math.exp(-u * 3)), y = 0.1 + 1.6 * hash(i, 6) * u * Math.exp(-u * 2.5);
          d.position.set(at[0] + Math.cos(a) * (radius + r), at[1] + y, at[2] + Math.sin(a) * (radius + r));
          d.scale.setScalar(Math.max(0.01, 1 - u / life));
          d.rotation.set(u * 5 + i, u * 3, 0);
        });
      },
    };
  }
}

// ---------------------------------------------------------------- panels (dialogue windows, menus, screens)

/** How a panel hangs in front of the camera pose at time `ref`. x/y: fractions of the half-frame; frac: width as a fraction of the frame width; yaw/pitch: tilt (radians). follow: hang from where the camera was `follow` s ago (a lag on fast moves). D: distance from the camera (default min(1.1, 0.6·target distance)). */
export type Hang = { ref: number; D?: number; x: number; y: number; frac: number; yaw?: number; pitch?: number; roll?: number; follow?: number };

/**
 * A canvas-textured quad living in the 3D world: snapped and warped like the set, never a screen overlay.
 * Draw into `ctx` (texels = low-res pixels when shown at nominal size), call `commit(key)` (re-uploads only
 * when the key changes), and either set `hang` + `open` (it is placed each frame in front of the camera
 * pose at `hang.ref`, and the live camera moves around it) or position `mesh` yourself (`hang = null`).
 */
export class Panel {
  mesh: THREE.Mesh;
  tex: THREE.CanvasTexture;
  ctx: CanvasRenderingContext2D;
  hang: Hang | null = null;
  /** 0..1 open state (JRPG window: grows from its centre line). */
  open = 1;
  private key = '';
  private refCam = new THREE.PerspectiveCamera(52, LW / LH, 0.05, 80);
  constructor(public texW: number, public texH: number) {
    const c = canvasTex(texW, texH, () => {});
    this.tex = c.tex; this.ctx = c.ctx;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 4, 1), psMat({ map: c.tex, unlit: true, fog: 0, side: THREE.DoubleSide }));
    // UI windows draw last, over everything: they join the transparent pass (three renders it after the
    // opaque one, so renderOrder alone would still let transparent glass draw over a window)
    const mm = this.mesh.material as THREE.Material;
    mm.depthTest = false; mm.transparent = true; mm.depthWrite = false;
    this.mesh.renderOrder = 20;
    // (paper skin: on-top windows live on layer 1 and are drawn after the out pass, so its contact
    // shadows and cut edges, computed from the world's depth, never darken a window)
    this.mesh.layers.set(UI_LAYER);
    this.mesh.frustumCulled = false;
  }
  /** Re-upload the canvas only when `key` (a string describing what was drawn) changes. */
  commit(key: string) {
    if (key !== this.key) { this.key = key; this.tex.needsUpdate = true; }
  }
  /** Draw into the (cleared) canvas and commit, but only when `key` changed. */
  draw(key: string, fn: (c: CanvasRenderingContext2D) => void) {
    if (key === this.key) return;
    this.ctx.clearRect(0, 0, this.texW, this.texH);
    fn(this.ctx);
    this.commit(key);
  }
  /** Depth-test against the world (a sign on a wall) instead of always drawing on top (a UI window). */
  inWorld(on = true) {
    const mm = this.mesh.material as THREE.Material;
    mm.depthTest = on; mm.transparent = !on; mm.depthWrite = on;
    this.mesh.renderOrder = on ? 0 : 20;
    this.mesh.layers.set(on ? 0 : UI_LAYER);
    return this;
  }
  place(stage: Ps1Stage, t: number) {
    const h = this.hang;
    if (!h) { this.mesh.visible = this.mesh.visible && this.open > 0.01; return; }
    this.mesh.visible = this.open > 0.01;
    if (!this.mesh.visible) return;
    const c = stage.camAt(h.follow !== undefined ? Math.max(h.ref, t - h.follow) : h.ref);
    const rc = this.refCam; stage.pose(rc, c);
    const dCam = Math.hypot(c.T[0] - c.P[0], c.T[1] - c.P[1], c.T[2] - c.P[2]);
    const D = h.D ?? Math.min(1.1, 0.6 * dCam);
    const hh = D * Math.tan(THREE.MathUtils.degToRad((c.fov ?? 52) / 2)), hw = hh * (LW / LH);
    const q = rc.quaternion;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q), right = new THREE.Vector3(1, 0, 0).applyQuaternion(q), upv = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const bob = 0.02 * Math.sin(t * 2.3 + h.ref * 7.1);
    this.mesh.position.copy(rc.position).addScaledVector(fwd, D).addScaledVector(right, h.x * hw).addScaledVector(upv, (h.y + bob) * hh);
    this.mesh.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(h.pitch ?? 0, h.yaw ?? 0, h.roll ?? 0, 'YXZ')));
    const w = h.frac * 2 * hw, o = ease.outBack(clamp(this.open));
    this.mesh.scale.set(w * (0.6 + 0.4 * o), w * (this.texH / this.texW) * o, 1);
  }
}

/** Open/close envelope for a window shown over [a, b): opens over `oc` s, closes over the last `oc` s (unless `hardOut`). */
export function windowOpen(t: number, a: number, b: number, oc = 0.12, hardIn = false, hardOut = false) {
  const i = hardIn ? (t >= a ? 1 : 0) : clamp((t - a) / oc);
  const o = hardOut ? (t < b ? 1 : 0) : 1 - ease.inQuad(clamp((t - (b - oc)) / oc));
  return t < a || t >= b ? 0 : i * o;
}

// ---------------------------------------------------------------- UI drawing (the one window style)

/** The window frame: dark edge, navy fill, bone-white bevel line. */
export function uiBox(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string = P.uiBg) {
  c.fillStyle = P.uiEdge; c.fillRect(x + 2, y, w - 4, h); c.fillRect(x, y + 2, w, h - 4); c.fillRect(x + 1, y + 1, w - 2, h - 2);
  c.fillStyle = fill; c.fillRect(x + 2, y + 2, w - 4, h - 4);
  c.fillStyle = P.uiLine;
  c.fillRect(x + 3, y + 1, w - 6, 1); c.fillRect(x + 3, y + h - 2, w - 6, 1); c.fillRect(x + 1, y + 3, 1, h - 6); c.fillRect(x + w - 2, y + 3, 1, h - 6);
  c.fillRect(x + 2, y + 2, 1, 1); c.fillRect(x + w - 3, y + 2, 1, 1); c.fillRect(x + 2, y + h - 3, 1, 1); c.fillRect(x + w - 3, y + h - 3, 1, 1);
  c.fillStyle = P.uiDim; c.fillRect(x + 4, y + 3, w - 8, 1);
}
/** A speaker name tab on top of a window. */
export function uiTab(c: CanvasRenderingContext2D, x: number, y: number, name: string, col: string) {
  const w = textW(name) + 8;
  c.fillStyle = P.uiEdge; c.fillRect(x - 1, y - 1, w + 2, 12);
  c.fillStyle = col; c.fillRect(x, y, w, 10);
  c.fillStyle = P.uiLine; c.fillRect(x, y, w, 1);
  pixText(c, name, x + 4, y + 2, P.uiLine);
}
/** The blinking "next" triangle at a window's bottom-right corner. */
export function uiNext(c: CanvasRenderingContext2D, x: number, y: number, t: number, col: string = P.key2) {
  if (Math.floor(t * 5) % 2 !== 0) return;
  c.fillStyle = col;
  c.fillRect(x, y, 7, 1); c.fillRect(x + 1, y + 1, 5, 1); c.fillRect(x + 2, y + 2, 3, 1); c.fillRect(x + 3, y + 3, 1, 1);
}
/** 28x28 portraits: DEV (smug) and the chatbot (the CRT face; version badge under it). */
export function uiPortrait(c: CanvasRenderingContext2D, x: number, y: number, who: 'dev' | 'bot', version?: string) {
  c.fillStyle = P.uiEdge; c.fillRect(x - 1, y - 1, 30, 30);
  c.fillStyle = '#1B2A55'; c.fillRect(x, y, 28, 28);
  const px = (a: number, b: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(x + a, y + b, w, h); };
  if (who === 'dev') {
    px(7, 6, 14, 17, P.skin); px(6, 3, 16, 6, P.hair); px(6, 9, 2, 5, P.hair); px(20, 9, 2, 5, P.hair);
    px(9, 12, 3, 1, P.ink); px(16, 12, 3, 1, P.ink); px(10, 11, 2, 1, P.ink); px(16, 11, 2, 1, P.ink);
    px(10, 18, 8, 1, '#7A2E2E'); px(17, 17, 2, 1, '#7A2E2E'); px(11, 18, 6, 1, '#F3ECDF');
    px(5, 23, 18, 5, P.hoodie);
  } else {
    px(4, 5, 20, 17, P.beige); px(6, 7, 16, 12, '#10162A');
    px(9, 10, 3, 3, P.bot); px(16, 10, 3, 3, P.bot); px(10, 16, 8, 1, P.bot);
    px(11, 22, 6, 3, P.beige); px(8, 25, 12, 2, P.beigeDark);
    if (version) { c.fillStyle = P.uiEdge; c.fillRect(x + 1, y + 20, textW(version) + 2, 8); pixText(c, version, x + 2, y + 21, P.key2); }
  }
}

/**
 * Typed dialogue text: the words of a line (or several) laid out in rows of at most `maxChars`, each
 * character appearing as the word is sung (a word types over ≤0.22 s from its start), held notes waving,
 * key words in yellow. Returns a key describing what is visible (for Panel.commit) and whether the line
 * is fully typed.
 */
export function typeWords(c: CanvasRenderingContext2D | null, words: Word[], t: number, x: number, y: number,
  o: { scale?: number; maxChars?: number; rowH?: number; key?: (w: Word) => boolean; color?: string; keyColor?: string; shadow?: string; typeDur?: number } = {}) {
  const scale = o.scale ?? 2, maxChars = o.maxChars ?? 19, rowH = o.rowH ?? 19;
  const rows: Word[][] = [[]];
  let n = 0;
  for (const w of words) {
    const len = Array.from(w.w).length;
    if (n > 0 && n + 1 + len > maxChars) { rows.push([]); n = 0; }
    rows[rows.length - 1]!.push(w); n += (n > 0 ? 1 : 0) + len;
  }
  let key = '';
  rows.forEach((row, ri) => {
    let xx = x;
    const yy = y + ri * rowH;
    for (const w of row) {
      const len = Array.from(w.w).length;
      const dur = Math.min(o.typeDur ?? 0.22, (w.end - w.start) * 0.8);
      const held = w.end - w.start > 0.5;
      const holdAmp = held ? clamp((t - w.start - dur) / 0.15) * (1 - clamp((t - w.end) / 0.3)) : 0;
      const shown = clamp(Math.floor(((t - w.start) / Math.max(1e-3, dur)) * len) + 1, 0, len);
      const wave = holdAmp > 0 ? Math.floor(t * 30) : 0;
      key += `${shown}:${wave}|`;
      if (c) pixText(c, w.w, xx, yy, o.key?.(w) ? (o.keyColor ?? P.key2) : (o.color ?? P.uiLine), scale, {
        shadow: o.shadow ?? P.uiEdge,
        each: (i) => {
          const ct = w.start + (i / len) * dur;
          if (t < ct) return null;
          const pop = t - ct < 0.05 ? -1 : 0;
          return [0, pop + Math.round(Math.sin(t * 16 - i * 0.8) * 2 * holdAmp)];
        },
      });
      xx += (len + 1) * ADV * scale;
    }
  });
  const done = words.length > 0 && t >= words[words.length - 1]!.end;
  return { key, done, rows: rows.length };
}

/** Progress helpers re-exported for scene code. */
export { Lyrics, springStep };
