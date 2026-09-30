// Words riding a 3D curve (a spaghetti noodle; later grandma's yarn): each word slides along the curve
// into its place as it is sung, the letters standing up off the strand and tilting with it on screen.
// Letters are quads cut from one bitmap-font atlas, so a whole line costs no canvas uploads.
import * as THREE from 'three';
import type { Word } from '../engine/lyrics';
import { clamp, ease } from '../engine/util';
import { pixText, psMat, canvasTex } from '../ps1/gfx';
import { P } from '../ps1/palette';

const CHARS = ' abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?\'"-:;()';
const CW = 13, CH = 17, COLS = 16;
let atlasCache: { tex: THREE.Texture; rows: number } | null = null;
/** A 2x bitmap-font atlas with the drop shadow baked in, in three inks (bone, yellow, fail red). */
function atlas() {
  if (atlasCache) return atlasCache;
  const n = CHARS.length, rows = Math.ceil(n / COLS) * 3;
  const inks = [P.uiLine, P.key2, P.fail];
  const { tex } = canvasTex(COLS * CW, rows * CH, (c) => {
    inks.forEach((ink, k) => Array.from(CHARS).forEach((ch, i) => {
      const x = (i % COLS) * CW, y = (Math.floor(i / COLS) + k * Math.ceil(n / COLS)) * CH;
      pixText(c, ch, x, y + 1, ink, 2, { shadow: P.uiEdge });
    }));
  });
  atlasCache = { tex, rows };
  return atlasCache;
}

export type Ink = 0 | 1 | 2;
export interface RideOpts { size?: number; spacing?: number; lift?: number; color?: string; radius?: number; slide?: number; ink?: (w: Word) => Ink; start?: number }

/**
 * A strand (tube) along `pts` with the words of `words` laid along it from arc length `start`.
 * update(t, cam): each word appears at its sung start sliding back from further along the strand,
 * held words (≥0.5 s) spread their letters while they ring. `slots[i]` = arc position of word i.
 */
export class RidingText {
  group = new THREE.Group();
  curve: THREE.CatmullRomCurve3;
  length: number;
  tube: THREE.Mesh;
  letters: { mesh: THREE.Mesh; wi: number; ci: number; n: number }[] = [];
  slots: number[] = [];
  private words: Word[];
  private o: Required<Omit<RideOpts, 'ink'>> & { ink: (w: Word) => Ink };
  constructor(pts: THREE.Vector3[], words: Word[], o: RideOpts = {}) {
    this.words = words;
    this.o = { size: 0.065, spacing: 0.047, lift: 0.045, color: '#E8C872', radius: 0.012, slide: 0.35, start: 0.1, ink: () => 0, ...o };
    this.curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    this.length = this.curve.getLength();
    this.tube = new THREE.Mesh(new THREE.TubeGeometry(this.curve, Math.max(16, Math.round(this.length * 30)), this.o.radius, 5, false), psMat({ color: this.o.color }));
    this.group.add(this.tube);
    const A = atlas();
    const perInk = Math.ceil(CHARS.length / COLS);
    let s = this.o.start;
    words.forEach((w, wi) => {
      const chars = Array.from(w.w);
      this.slots.push(s);
      chars.forEach((ch, ci) => {
        const idx = Math.max(0, CHARS.indexOf(ch === '’' ? "'" : ch === '“' || ch === '”' ? '"' : ch));
        const ink = this.o.ink(w);
        const geo = new THREE.PlaneGeometry(this.o.size * (CW / CH), this.o.size);
        const u0 = (idx % COLS) / COLS, v0 = 1 - (Math.floor(idx / COLS) + ink * perInk + 1) / A.rows;
        const uv = geo.attributes.uv!;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) / COLS, v0 + uv.getY(i) / A.rows);
        const m = new THREE.Mesh(geo, psMat({ map: A.tex, unlit: true, fog: 0.15, side: THREE.DoubleSide }));
        m.renderOrder = 6;
        this.group.add(m);
        this.letters.push({ mesh: m, wi, ci, n: chars.length });
      });
      s += (chars.length + 1) * this.o.spacing;
    });
  }
  private tmp = new THREE.Vector3(); private tan = new THREE.Vector3(); private q = new THREE.Quaternion();
  update(t: number, cam: THREE.Camera, drift = 0) {
    const o = this.o;
    cam.updateMatrixWorld();
    const view = cam.matrixWorldInverse;
    for (const L of this.letters) {
      const w = this.words[L.wi]!;
      const since = t - w.start;
      L.mesh.visible = since >= 0;
      if (!L.mesh.visible) continue;
      const held = w.end - w.start > 0.5 ? clamp((t - w.start - 0.15) / Math.max(0.1, w.end - w.start - 0.15)) : 0;
      const ringOut = held > 0 ? 1 - clamp((t - w.end) / 0.4) : 0;
      const spread = 1 + 0.45 * held * ringOut;
      const arrive = ease.outCubic(clamp(since / 0.22));
      const s = this.slots[L.wi]! + drift + L.ci * o.spacing * spread + (1 - arrive) * o.slide;
      const u = clamp(s / this.length, 0, 1);
      this.curve.getPointAt(u, this.tmp);
      this.curve.getTangentAt(u, this.tan);
      // stand the letter up off the strand (toward the camera's up), bob on held notes
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      const bob = held * ringOut * 0.012 * Math.sin(t * 16 - L.ci * 0.8);
      L.mesh.position.copy(this.tmp).addScaledVector(up, o.lift + bob);
      // face the camera, rolled to follow the strand's direction on screen
      const a = this.tmp.clone().applyMatrix4(view), b = this.tmp.clone().add(this.tan).applyMatrix4(view);
      let ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
      ang = clamp(ang, -0.6, 0.6);
      L.mesh.quaternion.copy(cam.quaternion).multiply(this.q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang));
      L.mesh.scale.setScalar(0.3 + 0.7 * arrive);
    }
  }
}
