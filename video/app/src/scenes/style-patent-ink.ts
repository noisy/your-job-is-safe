// Patent-drawing toolkit: meshes drawn as ink line art (per-frame silhouettes + static creases as GPU
// capsule lines, depth-tested against the hatched surfaces), the hatch/stipple surface shader, and 3D
// drafting primitives (dashed and centre lines, arcs, arrows, leaders, stroke-font lettering on planes).
import * as THREE from 'three';
import { GLSL_COMMON } from '../engine/glsl/common';
import { LineBatch as LineBatchBase, type LineBatch } from '../engine/lines';
import type { StrokeText } from '../engine/stroke';
import { hash } from '../engine/util';

export type RGB = [number, number, number];
export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------ ink meshes

/**
 * A mesh plus its edge structure: crease/boundary edges (always inked) and smooth edges whose two faces
 * are tested against the eye every frame (a sign change is a silhouette). Rendering normals are split at
 * creases so the hatching follows the smooth parts.
 */
export class InkMesh {
  mesh: THREE.Mesh;
  private wp: Float32Array;
  private crease: Uint32Array;
  private smooth: Uint32Array;
  private fn: Float32Array;
  private camL = new THREE.Vector3();
  private inv = new THREE.Matrix4();
  private sph = new THREE.Sphere();
  /** Multiplies line widths (e.g. to thin the lines of small parts). */
  weight = 1;
  visible = true;

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, creaseDeg = 32) {
    const src = geo.index ? geo.toNonIndexed() : geo;
    const P = src.getAttribute('position') as THREE.BufferAttribute;
    const n = P.count, F = Math.floor(n / 3);
    // weld corners by position
    const key = new Map<string, number>();
    const wid = new Uint32Array(n);
    const wp: number[] = [];
    const q = (v: number) => Math.round(v * 2e4);
    for (let i = 0; i < n; i++) {
      const k = `${q(P.getX(i))},${q(P.getY(i))},${q(P.getZ(i))}`;
      let id = key.get(k);
      if (id === undefined) { id = wp.length / 3; key.set(k, id); wp.push(P.getX(i), P.getY(i), P.getZ(i)); }
      wid[i] = id;
    }
    this.wp = Float32Array.from(wp);
    const fn = new Float32Array(F * 3);
    const a = V(), b = V(), c = V(), e1 = V(), e2 = V();
    const good = new Uint8Array(F);
    for (let f = 0; f < F; f++) {
      a.fromBufferAttribute(P, f * 3); b.fromBufferAttribute(P, f * 3 + 1); c.fromBufferAttribute(P, f * 3 + 2);
      e1.subVectors(b, a); e2.subVectors(c, a); e1.cross(e2);
      const L = e1.length();
      if (L > 1e-10) { e1.multiplyScalar(1 / L); good[f] = 1; }
      fn[f * 3] = e1.x; fn[f * 3 + 1] = e1.y; fn[f * 3 + 2] = e1.z;
    }
    this.fn = fn;
    // edges -> faces
    const NV = this.wp.length / 3;
    const edges = new Map<number, number[]>();
    for (let f = 0; f < F; f++) {
      if (!good[f]) continue;
      for (let k = 0; k < 3; k++) {
        const u = wid[f * 3 + k]!, v = wid[f * 3 + ((k + 1) % 3)]!;
        if (u === v) continue;
        const kk = Math.min(u, v) * NV + Math.max(u, v);
        const l = edges.get(kk);
        if (l) l.push(f); else edges.set(kk, [f]);
      }
    }
    const cosC = Math.cos((creaseDeg * Math.PI) / 180);
    const cr: number[] = [], sm: number[] = [];
    for (const [kk, fs] of edges) {
      const u = Math.floor(kk / NV), v = kk % NV;
      if (fs.length === 2) {
        const f1 = fs[0]!, f2 = fs[1]!;
        const d = fn[f1 * 3]! * fn[f2 * 3]! + fn[f1 * 3 + 1]! * fn[f2 * 3 + 1]! + fn[f1 * 3 + 2]! * fn[f2 * 3 + 2]!;
        if (d < cosC) cr.push(u, v); else sm.push(u, v, f1, f2);
      } else cr.push(u, v);
    }
    this.crease = Uint32Array.from(cr);
    this.smooth = Uint32Array.from(sm);
    // rendering normals: average the faces around each welded vertex that are within the crease angle
    const vf: number[][] = Array.from({ length: NV }, () => []);
    for (let f = 0; f < F; f++) if (good[f]) for (let k = 0; k < 3; k++) vf[wid[f * 3 + k]!]!.push(f);
    const nrm = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const f = Math.floor(i / 3);
      let x = 0, y = 0, z = 0;
      for (const g of vf[wid[i]!]!) {
        const d = fn[f * 3]! * fn[g * 3]! + fn[f * 3 + 1]! * fn[g * 3 + 1]! + fn[f * 3 + 2]! * fn[g * 3 + 2]!;
        if (d >= cosC) { x += fn[g * 3]!; y += fn[g * 3 + 1]!; z += fn[g * 3 + 2]!; }
      }
      const L = Math.hypot(x, y, z) || 1;
      nrm[i * 3] = x / L; nrm[i * 3 + 1] = y / L; nrm[i * 3 + 2] = z / L;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', P);
    out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    const uv = src.getAttribute('uv');
    out.setAttribute('uv', uv ?? new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    this.mesh = new THREE.Mesh(out, mat);
  }

  /** Ink this mesh's visible-candidate edges for eye `cam` (world): silhouettes at `silW`, creases at `creaseW` px. */
  emit(b: LineBatch, cam: THREE.Vector3, silW: number, creaseW: number, rgb: RGB, alpha = 1, frustum?: THREE.Frustum) {
    if (!this.visible || !this.mesh.visible) return;
    if (frustum) {
      const g = this.mesh.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      this.sph.copy(g.boundingSphere!).applyMatrix4(this.mesh.matrixWorld);
      if (!frustum.intersectsSphere(this.sph)) return;
    }
    let o: THREE.Object3D | null = this.mesh;
    while (o) { if (!o.visible) return; o = o.parent; }
    const M = this.mesh.matrixWorld;
    this.inv.copy(M).invert();
    const cl = this.camL.copy(cam).applyMatrix4(this.inv);
    const m = M.elements, p = this.wp, fn = this.fn;
    const w = this.weight;
    const put = (u: number, v: number, wd: number) => {
      const ux = p[u * 3]!, uy = p[u * 3 + 1]!, uz = p[u * 3 + 2]!;
      const vx = p[v * 3]!, vy = p[v * 3 + 1]!, vz = p[v * 3 + 2]!;
      b.seg(
        m[0]! * ux + m[4]! * uy + m[8]! * uz + m[12]!, m[1]! * ux + m[5]! * uy + m[9]! * uz + m[13]!, m[2]! * ux + m[6]! * uy + m[10]! * uz + m[14]!,
        m[0]! * vx + m[4]! * vy + m[8]! * vz + m[12]!, m[1]! * vx + m[5]! * vy + m[9]! * vz + m[13]!, m[2]! * vx + m[6]! * vy + m[10]! * vz + m[14]!,
        wd * w, rgb[0], rgb[1], rgb[2], alpha,
      );
    };
    const S = this.smooth;
    for (let i = 0; i < S.length; i += 4) {
      const u = S[i]!, f1 = S[i + 2]!, f2 = S[i + 3]!;
      const dx = cl.x - p[u * 3]!, dy = cl.y - p[u * 3 + 1]!, dz = cl.z - p[u * 3 + 2]!;
      const s1 = fn[f1 * 3]! * dx + fn[f1 * 3 + 1]! * dy + fn[f1 * 3 + 2]! * dz;
      const s2 = fn[f2 * 3]! * dx + fn[f2 * 3 + 1]! * dy + fn[f2 * 3 + 2]! * dz;
      if ((s1 > 0) !== (s2 > 0)) put(u, S[i + 1]!, silW);
    }
    const C = this.crease;
    for (let i = 0; i < C.length; i += 2) put(C[i]!, C[i + 1]!, creaseW);
  }
}

// ------------------------------------------------------------------ surfaces

/** Shared light direction (world), upper left front, the patent-office convention. */
export const LIGHT = { value: new THREE.Vector3(-0.55, 0.75, 0.45).normalize() };

export const MODE = { extrude: 0, meridian: 1, section: 2, stipple: 3, plain: 4, level: 5, paper: 6 } as const;

export interface InkMatOpts {
  mode: number;
  /** Hatch lines per world unit (or per uv unit for meridians/stipple). */
  density?: number;
  /** Constant darkness added (section hatches) or the base tone. */
  dark?: number;
  angle?: number;
  paper: RGB;
  ink: RGB;
  /** Discard above this local y (liquid fill). */
  clipY?: number;
  side?: THREE.Side;
  /** Object-space normal axis of the caps of an extrusion (default z). */
  capAxis?: RGB;
  /** Stipple gradient on the caps over this height (0 = off). */
  capStip?: number;
}

const VERT = /* glsl */ `
out vec3 vWN; out vec3 vON; out vec3 vWP; out vec3 vOP; out vec2 vUv;
void main() {
  vUv = uv; vON = normal; vOP = position;
  vWN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
${GLSL_COMMON}
uniform vec3 uLight, uPaper, uInk, uCapAxis; uniform int uMode; uniform float uDensity, uDark, uAngle, uClipY, uFade, uCapStip;
in vec3 vWN; in vec3 vON; in vec3 vWP; in vec3 vOP; in vec2 vUv;
out vec4 fragColor;
float stip(vec2 g, float d) {
  vec2 id = floor(g), f = fract(g) - 0.5;
  vec2 j = (hash22(id) - 0.5) * 0.55;
  float r = 0.36 * sqrt(sat(d)) * step(0.08, d);
  float aa = max(fwidth(g.x), 1e-4) * 0.8;
  return 1.0 - smoothstep(r - aa, r + aa, length(f - j));
}
void main() {
  if (vOP.y > uClipY) discard;
  vec3 N = normalize(vWN); if (!gl_FrontFacing) N = -N;
  float lam = dot(N, uLight);
  float dark = sat(0.5 - 0.5 * lam);
  float ink = 0.0;
  if (uMode == 0) {
    vec3 on = normalize(vON);
    if (abs(dot(on, uCapAxis)) > 0.7) {
      vec2 r = rot2(0.785) * vUv * uDensity * 0.8;
      ink = hatch(r.x, smoothstep(0.42, 0.8, dark) * 0.45);
      if (uCapStip > 0.0) {
        // stipple gradient: the face darkens away from the light (lower right), dots grow
        float g = sat(1.0 - vOP.y / uCapStip) * 0.75 + sat(vOP.x * 0.0) + smoothstep(0.3, 0.8, dark) * 0.4;
        ink = max(ink, stip(vUv * uDensity * 1.45, g * g * 0.7));
      }
    } else {
      ink = hatch(vUv.x * uDensity, smoothstep(0.2, 0.9, dark) * 0.5 + 0.13 + uDark);
    }
  } else if (uMode == 1) {
    float d = smoothstep(0.28, 0.95, dark) * 0.6 + uDark;
    ink = hatch(vUv.x * uDensity, d);
  } else if (uMode == 2) {
    vec2 r = rot2(uAngle) * vUv * uDensity;
    ink = hatch(r.x, uDark);
  } else if (uMode == 3) {
    vec3 an = abs(normalize(vON));
    vec2 sp = an.x > an.y && an.x > an.z ? vOP.zy : (an.y > an.z ? vOP.xz : vOP.xy);
    ink = stip(sp * uDensity, smoothstep(0.15, 0.9, dark) * 0.9 + uDark);
  } else if (uMode == 5) {
    ink = hatch(vUv.y * uDensity, uDark);
  } else if (uMode == 6) {
    // paper: faint fibre, warm tint
    float fib = fbm(vWP.xz * vec2(9.0, 2.5), 3) * 0.5 + 0.5;
    fragColor = vec4(uPaper * (0.975 + 0.035 * fib), 1.0);
    return;
  }
  ink *= uFade;
  fragColor = vec4(mix(uPaper, uInk, ink), 1.0);
}`;

export function inkMaterial(o: InkMatOpts) {
  const m = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uLight: LIGHT,
      uPaper: { value: new THREE.Vector3(...o.paper) },
      uInk: { value: new THREE.Vector3(...o.ink) },
      uMode: { value: o.mode },
      uDensity: { value: o.density ?? 14 },
      uDark: { value: o.dark ?? 0 },
      uAngle: { value: o.angle ?? 0.785 },
      uClipY: { value: o.clipY ?? 1e9 },
      uFade: { value: 1 },
      uCapStip: { value: o.capStip ?? 0 },
      uCapAxis: { value: new THREE.Vector3(...(o.capAxis ?? [0, 0, 1])) },
    },
    side: o.side ?? THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 8,
  });
  return m;
}

// ------------------------------------------------------------------ drafting primitives

type P3 = THREE.Vector3;
const tmp = V(), tmp2 = V();

export function line(b: LineBatch, a: P3, c: P3, w: number, rgb: RGB, alpha = 1) {
  b.seg(a.x, a.y, a.z, c.x, c.y, c.z, w, rgb[0], rgb[1], rgb[2], alpha);
}

/** Polyline, drawn up to fraction `upto` of its length. */
export function poly(b: LineBatch, pts: P3[], w: number, rgb: RGB, upto = 1, alpha = 1) {
  if (upto <= 0 || pts.length < 2) return;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += pts[i]!.distanceTo(pts[i - 1]!);
  let left = total * Math.min(1, upto);
  for (let i = 1; i < pts.length && left > 0; i++) {
    const a = pts[i - 1]!, c = pts[i]!, L = a.distanceTo(c);
    if (L <= left) line(b, a, c, w, rgb, alpha);
    else { tmp.copy(a).lerp(c, left / L); line(b, a, tmp, w, rgb, alpha); }
    left -= L;
  }
}

/** Dashed line: a repeating pattern of [on, off, on, off, ...] lengths (world units). */
export function dashed(b: LineBatch, a: P3, c: P3, pattern: number[], w: number, rgb: RGB, phase = 0, upto = 1) {
  const L = a.distanceTo(c) * upto;
  const period = pattern.reduce((x, y) => x + y, 0);
  let s = -((phase % period) + period) % period;
  let k = 0;
  while (s < L) {
    const len = pattern[k % pattern.length]!;
    if (k % 2 === 0) {
      const s0 = Math.max(0, s), s1 = Math.min(L, s + len);
      if (s1 > s0) {
        const T = a.distanceTo(c);
        tmp.copy(a).lerp(c, s0 / T); tmp2.copy(a).lerp(c, s1 / T);
        line(b, tmp, tmp2, w, rgb);
      }
    }
    s += len; k++;
  }
}
export const DASH = [0.22, 0.12];
export const CENTER = [0.62, 0.1, 0.07, 0.1];

/** Points of an arc in the plane (u, v) around c. */
export function arcPts(c: P3, u: P3, v: P3, r: number, a0: number, a1: number, n = 48, wob?: { amp: number; seed: number; freq?: number }) {
  const out: P3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    let rr = r;
    if (wob) rr *= 1 + wob.amp * (Math.sin(a * (wob.freq ?? 2) + wob.seed * 7.1) * 0.6 + Math.sin(a * 5.3 + wob.seed * 3.3) * 0.4);
    out.push(c.clone().addScaledVector(u, Math.cos(a) * rr).addScaledVector(v, Math.sin(a) * rr));
  }
  return out;
}

/** Cubic Bézier points. */
export function bezPts(p0: P3, p1: P3, p2: P3, p3: P3, n = 24) {
  const out: P3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, s = 1 - t;
    out.push(V(
      s * s * s * p0.x + 3 * s * s * t * p1.x + 3 * s * t * t * p2.x + t * t * t * p3.x,
      s * s * s * p0.y + 3 * s * s * t * p1.y + 3 * s * t * t * p2.y + t * t * t * p3.y,
      s * s * s * p0.z + 3 * s * s * t * p1.z + 3 * s * t * t * p2.z + t * t * t * p3.z,
    ));
  }
  return out;
}

/** Filled drafting arrowhead at `tip`, pointing along `dir`, spread in the plane of `side`. */
export function arrow(b: LineBatch, tip: P3, dir: P3, side: P3, len: number, w: number, rgb: RGB) {
  const d = dir.clone().normalize(), s = side.clone().normalize();
  for (let i = -4; i <= 4; i++) {
    const back = tip.clone().addScaledVector(d, -len).addScaledVector(s, (len * 0.3 * i) / 4);
    line(b, tip, back, w, rgb);
  }
}

/** A text plane: `o` = left end of the baseline, `r` = reading direction, `d` = down (in-plane), `k` = world units per text px. */
export interface TextPlane { o: P3; r: P3; d: P3; k: number }

/**
 * Emit the first `len` px (arc length) of a StrokeText into a batch on a plane. Returns the pen head in
 * world space, or null. `wob` adds a hand tremor (red pencil).
 */
export function letter(b: LineBatch, st: StrokeText, len: number, pl: TextPlane, w: number, rgb: RGB, wob = 0, seed = 0): P3 | null {
  let head: P3 | null = null;
  const map = (x: number, y: number, out: P3) => {
    if (wob) { x += wob * Math.sin(y * 0.07 + seed + x * 0.013); y += wob * Math.sin(x * 0.05 + seed * 1.7); }
    return out.copy(pl.o).addScaledVector(pl.r, x * pl.k).addScaledVector(pl.d, y * pl.k);
  };
  const A = V(), B = V();
  for (let i = 0; i < st.strokes.length; i++) {
    const s0 = st.startLen[i]!;
    if (s0 >= len) break;
    const pts = st.strokes[i]!, L = st.lens[i]!;
    const remain = len - s0;
    if (pts.length === 1) { map(pts[0]!.x, pts[0]!.y, A); line(b, A, A, w, rgb); head = A.clone(); continue; }
    map(pts[0]!.x, pts[0]!.y, A);
    for (let j = 1; j < pts.length; j++) {
      if (L[j - 1]! >= remain) break;
      const a = pts[j - 1]!, c = pts[j]!;
      if (L[j]! <= remain) map(c.x, c.y, B);
      else { const u = (remain - L[j - 1]!) / Math.max(1e-6, L[j]! - L[j - 1]!); map(a.x + (c.x - a.x) * u, a.y + (c.y - a.y) * u, B); }
      line(b, A, B, w, rgb);
      head = B.clone();
      A.copy(B);
    }
  }
  return head;
}

/** Arc length at which char `n` (exclusive) is complete: everything up to char n-1 drawn (typed text). */
export function charsLen(st: StrokeText, n: number) {
  if (n <= 0) return 0;
  const r = st.charRange[Math.min(n, st.charRange.length) - 1];
  return r ? r[1] + 1e-3 : 0;
}

/** Plane lying on a horizontal surface at height y, reading along +x, "down" towards +z (the viewer). */
export function flatPlane(x: number, y: number, z: number, cap: number, st: StrokeText, rotY = 0): TextPlane {
  const r = V(Math.cos(rotY), 0, -Math.sin(rotY)), d = V(Math.sin(rotY), 0, Math.cos(rotY));
  return { o: V(x, y, z), r, d, k: cap / st.capHeight };
}

/** Pencil-grain alpha jitter, stable per segment index and frame-independent. */
export const grain = (i: number, seed: number) => 0.78 + 0.22 * hash(i, seed);

/**
 * A pen whose widths are world units, converted per segment to screen px at the segment's distance, so
 * every capsule keeps a constant width and round joints (LineBatch's worldWidth tapers each capsule,
 * which opens gaps at the joints of curves).
 */
export class WorldPen extends LineBatchBase {
  cam: THREE.PerspectiveCamera | null = null;
  private focal = 1;
  private cp = new THREE.Vector3();
  prepare(cam: THREE.PerspectiveCamera, viewH: number) {
    this.cam = cam;
    this.focal = (viewH / 2) / Math.tan((cam.fov * Math.PI) / 360);
    this.cp.copy(cam.position);
  }
  /** Each segment is also moved towards the eye by `lift` stroke widths: a capsule has one depth across its whole width, so a thick stroke on a tilted surface would otherwise sink into it. */
  lift = 3;
  override seg(ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number, r: number, g: number, bl: number, alpha = 1) {
    const c = this.cp;
    const d = Math.hypot((ax + bx) / 2 - c.x, (ay + by) / 2 - c.y, (az + bz) / 2 - c.z);
    const la = (width * this.lift) / Math.max(1e-3, Math.hypot(c.x - ax, c.y - ay, c.z - az));
    const lb = (width * this.lift) / Math.max(1e-3, Math.hypot(c.x - bx, c.y - by, c.z - bz));
    super.seg(ax + (c.x - ax) * la, ay + (c.y - ay) * la, az + (c.z - az) * la, bx + (c.x - bx) * lb, by + (c.y - by) * lb, bz + (c.z - bz) * lb,
      (width * this.focal) / Math.max(0.05, d), r, g, bl, alpha);
  }
}

const _p = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _pos0 = new THREE.Vector3();
/**
 * Keep points (a lyric line's extent) inside the frame's safe area: dolly back if they are too big,
 * then pan until they fit. Moves the camera position only (orientation kept); `w` blends the
 * correction in (0 = designed camera, 1 = fully corrected).
 */
export function fitSafe(cam: THREE.PerspectiveCamera, pts: THREE.Vector3[], w: number, safe = 0.8) {
  if (w <= 1e-3 || pts.length === 0) return;
  _pos0.copy(cam.position);
  const th = Math.tan((cam.fov * Math.PI) / 360);
  for (let it = 0; it < 3; it++) {
    cam.updateMatrixWorld();
    cam.getWorldDirection(_f);
    _r.setFromMatrixColumn(cam.matrixWorld, 0);
    _u.setFromMatrixColumn(cam.matrixWorld, 1);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, D = 0;
    for (const p of pts) {
      const d = _p.copy(p).sub(cam.position).dot(_f);
      const q = Math.max(0.1, d);
      const x = _p.copy(p).sub(cam.position).dot(_r) / (q * th * cam.aspect), y = _p.copy(p).sub(cam.position).dot(_u) / (q * th);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); D += q;
    }
    D /= pts.length;
    const s = Math.max((x1 - x0) / (2 * safe), (y1 - y0) / (2 * safe), 1);
    const back = (s - 1) * D * 1.02;
    const k = D / (D + back);
    const cx = ((x0 + x1) / 2) * k, cy = ((y0 + y1) / 2) * k, hx = ((x1 - x0) / 2) * k, hy = ((y1 - y0) / 2) * k;
    const dx = cx - hx < -safe ? cx - hx + safe : cx + hx > safe ? cx + hx - safe : 0;
    const dy = cy - hy < -safe ? cy - hy + safe : cy + hy > safe ? cy + hy - safe : 0;
    if (!back && !dx && !dy) break;
    const L = D + back;
    cam.position.addScaledVector(_f, -back).addScaledVector(_r, dx * L * th * cam.aspect).addScaledVector(_u, dy * L * th);
  }
  cam.position.lerpVectors(_pos0, cam.position, Math.min(1, w));
  cam.updateMatrixWorld();
}

/** Smooth on/off envelope around [a, b]. */
export const envelope = (t: number, a: number, b: number, rise = 0.3, fall = 0.3) => {
  const s = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  return Math.min(s((t - (a - rise)) / rise), 1 - s((t - b) / fall));
};
