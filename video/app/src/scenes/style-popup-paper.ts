// Pop-up book toolkit: cardstock pieces as real solids (shaped front print, blank back, cream cut edges),
// printed with Canvas2D illustrations, a shared paper-fibre bump, and hinges (a group whose rotation folds
// the piece about one of its edges).
import * as THREE from 'three';
import { SCALE } from '../engine/gl';
import { mulberry32 } from '../engine/util';

export const INKS = {
  paper: '#f1e7d0',
  paper2: '#e6d8b8',
  edge: '#efe4c9',
  ink: '#211d1f',
  red: '#d63a2c',
  redDark: '#9e2419',
  green: '#3d7d45',
  greenDark: '#28552f',
  mustard: '#e9b23b',
  wine: '#7a1830',
  sky: '#b9cfd2',
  teal: '#5d8f8c',
  pink: '#f2c9b8',
};

let fibreTex: THREE.CanvasTexture | null = null;
/** Paper tooth: tiling fibres + fine noise (a bump map). */
export function fibre() {
  if (fibreTex) return fibreTex;
  const n = 512, cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#808080'; c.fillRect(0, 0, n, n);
  const r = mulberry32(7);
  const img = c.getImageData(0, 0, n, n);
  for (let i = 0; i < n * n; i++) { const v = 128 + (r() - 0.5) * 36; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; }
  c.putImageData(img, 0, 0);
  for (let i = 0; i < 1400; i++) {
    const x = r() * n, y = r() * n, a = r() * Math.PI, L = 6 + r() * 26;
    c.strokeStyle = r() < 0.5 ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)';
    c.lineWidth = 0.6 + r() * 0.8;
    c.beginPath(); c.moveTo(x, y);
    c.quadraticCurveTo(x + Math.cos(a) * L * 0.5 + (r() - 0.5) * 6, y + Math.sin(a) * L * 0.5 + (r() - 0.5) * 6, x + Math.cos(a) * L, y + Math.sin(a) * L);
    c.stroke();
  }
  fibreTex = new THREE.CanvasTexture(cv);
  fibreTex.wrapS = fibreTex.wrapT = THREE.RepeatWrapping;
  return fibreTex;
}

export interface Box2 { x0: number; y0: number; w: number; h: number }
export function shapeBox(s: THREE.Shape): Box2 {
  const pts = s.getPoints(24);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * A canvas mapped onto a box of shape space (y up) at `ppu` px per unit; `draw` gets the context already
 * transformed so it can draw in shape units (y up, origin at the shape's origin).
 */
export function paint(box: Box2, ppu: number, draw: (c: CanvasRenderingContext2D, px: number) => void) {
  const s = ppu * Math.min(2, SCALE);
  const cv = document.createElement('canvas');
  cv.width = Math.max(4, Math.ceil(box.w * s)); cv.height = Math.max(4, Math.ceil(box.h * s));
  const c = cv.getContext('2d')!;
  c.setTransform(s, 0, 0, -s, -box.x0 * s, (box.y0 + box.h) * s);
  draw(c, 1 / s);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Trace a THREE.Shape (and its holes) as a canvas path in shape units. */
export function tracePath(c: CanvasRenderingContext2D, s: THREE.Shape) {
  c.beginPath();
  const put = (pts: THREE.Vector2[]) => { pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath(); };
  put(s.getPoints(48));
  for (const h of s.holes) put(h.getPoints(48));
}

/** Draw text upright in shape space (y up) at (x, y) baseline. */
export function text(c: CanvasRenderingContext2D, str: string, x: number, y: number, fontCss: string, fill: string, align: CanvasTextAlign = 'left', size = 1) {
  c.save();
  c.translate(x, y); c.scale(size / 100, -size / 100);
  c.font = fontCss; c.fillStyle = fill; c.textAlign = align; c.textBaseline = 'alphabetic';
  c.fillText(str, 0, 0);
  c.restore();
}

/** Printed-paper finish over a painted card: fibre speckle and a slight vignette of ink. */
export function finish(c: CanvasRenderingContext2D, box: Box2, seed = 1) {
  const r = mulberry32(seed);
  c.save();
  c.globalAlpha = 0.07;
  for (let i = 0; i < 500; i++) {
    c.fillStyle = r() < 0.5 ? '#ffffff' : '#5a4630';
    const x = box.x0 + r() * box.w, y = box.y0 + r() * box.h, s = (0.004 + r() * 0.012) * Math.max(box.w, box.h);
    c.fillRect(x, y, s, s * 0.35);
  }
  c.restore();
}

export interface CardOpts {
  thick?: number;
  front: THREE.Texture;
  back?: THREE.Texture | null;
  backColor?: string;
  edgeColor?: string;
  rough?: number;
}

const edgeMats = new Map<string, THREE.MeshStandardMaterial>();
function edgeMat(color: string) {
  let m = edgeMats.get(color);
  if (!m) { m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.95 }); edgeMats.set(color, m); }
  return m;
}

/** Remap a ShapeGeometry's uv (shape units) to 0..1 over `box`. */
function fitUV(g: THREE.BufferGeometry, box: Box2, flipX = false) {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const u = (uv.getX(i) - box.x0) / box.w, v = (uv.getY(i) - box.y0) / box.h;
    uv.setXY(i, flipX ? 1 - u : u, v);
  }
}

/**
 * A die-cut card: front face printed with `front`, back face blank (or printed), cut edges in cream.
 * Lies in the local XY plane (front towards +z), thickness along z. All parts cast and receive shadows.
 */
export function card(shape: THREE.Shape, o: CardOpts) {
  const th = o.thick ?? 0.035;
  const box = shapeBox(shape);
  const g = new THREE.Group();
  const bump = fibre();
  const fg = new THREE.ShapeGeometry(shape, 24);
  fitUV(fg, box);
  const fm = new THREE.MeshStandardMaterial({ map: o.front, roughness: o.rough ?? 0.82, bumpMap: bump, bumpScale: 0.5 });
  const front = new THREE.Mesh(fg, fm);
  front.position.z = th / 2;
  // the back: same outline facing -z (winding reversed, not mirrored); a printed back reads from behind
  const bg = new THREE.ShapeGeometry(shape, 24);
  fitUV(bg, box, true);
  const ix = bg.index!;
  for (let i = 0; i < ix.count; i += 3) { const a1 = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, a1); }
  const nn = bg.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < nn.count; i++) nn.setXYZ(i, 0, 0, -1);
  const bm = o.back
    ? new THREE.MeshStandardMaterial({ map: o.back, roughness: 0.85, bumpMap: bump, bumpScale: 0.5 })
    : new THREE.MeshStandardMaterial({ color: new THREE.Color(o.backColor ?? INKS.paper2), roughness: 0.9, bumpMap: bump, bumpScale: 0.6 });
  const back = new THREE.Mesh(bg, bm);
  back.position.z = -th / 2;
  const side = new THREE.ExtrudeGeometry(shape, { depth: th, bevelEnabled: false, curveSegments: 24 });
  side.translate(0, 0, -th / 2);
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  const edges = new THREE.Mesh(side, [hidden, edgeMat(o.edgeColor ?? INKS.edge)]);
  for (const m of [front, back, edges]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
  g.userData.front = front;
  return g;
}

export function roundRect(w: number, h: number, r: number, x0 = -w / 2, y0 = 0) {
  const s = new THREE.Shape();
  s.moveTo(x0 + r, y0);
  s.lineTo(x0 + w - r, y0); s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  s.lineTo(x0 + w, y0 + h - r); s.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
  s.lineTo(x0 + r, y0 + h); s.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
  s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}

/** A hinge: rotating `.rotation.x` folds the child about the local x axis (its bottom edge). */
export function hinge(child: THREE.Object3D, x = 0, y = 0, z = 0) {
  const h = new THREE.Group();
  h.position.set(x, y, z);
  h.add(child);
  return h;
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
