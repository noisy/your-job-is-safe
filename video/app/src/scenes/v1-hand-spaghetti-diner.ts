// The 2023 AI-video nightmare, restaged as an original low-poly diner guy (not a likeness of anyone; the
// reference is a plain-text caption): a booth, a plate of spaghetti, a fork. `melt(t)` sags the face into
// the sauce; the bridge reuses him smooth (subdivided, no vertex snapping: the one model that doesn't wobble).
import * as THREE from 'three';
import { hash, clamp } from '../engine/util';
import { psMat, canvasTex, rng, shade } from '../ps1/gfx';
import { P } from '../ps1/palette';

const SKIN = '#9C6B4E', SHIRT = '#D98A3A', HAIR = '#22160F', SAUCE = '#B8321F', NOODLE = '#E8C872';

/** Materials of the smooth version don't snap to the pixel grid (a private uSnap = 0). */
function mat(o: Parameters<typeof psMat>[0], smooth: boolean) {
  const m = psMat(o);
  if (smooth) m.uniforms.uSnap = { value: 0 };
  return m;
}

function faceTex(smooth: boolean) {
  return canvasTex(24, 24, (c) => {
    const px = (x: number, y: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
    px(0, 0, 24, 24, SKIN);
    px(0, 0, 24, 5, HAIR); px(0, 5, 2, 4, HAIR); px(22, 5, 2, 4, HAIR);
    px(5, 8, 5, 1, HAIR); px(14, 8, 5, 1, HAIR); // brows
    px(6, 10, 3, 3, '#F3ECDF'); px(15, 10, 3, 3, '#F3ECDF'); px(7, 11, 2, 2, P.ink); px(16, 11, 2, 2, P.ink);
    px(11, 12, 2, 5, shade(SKIN, 0.8)); // nose
    if (smooth) { px(8, 18, 8, 1, '#5A2A22'); px(7, 17, 1, 1, '#5A2A22'); px(16, 17, 1, 1, '#5A2A22'); }
    else { px(7, 18, 10, 3, '#5A2A22'); px(8, 18, 8, 1, '#F3ECDF'); px(9, 20, 5, 1, SAUCE); } // mouth full of noodles
  }).tex;
}

export interface Diner {
  root: THREE.Group;
  head: THREE.Mesh; headBase: Float32Array;
  armR: THREE.Object3D; armL: THREE.Object3D; fork: THREE.Group; fuse: THREE.Mesh;
  plate: THREE.Group; strands: THREE.Mesh[];
  /** Face melting 0..1 (a pure function of the amount and t for the drips). */
  melt(amount: number, t: number): void;
}

/** The guy seated behind a table, facing +z; the plate sits on the table in front of him. */
export function makeDiner(smooth = false): Diner {
  const root = new THREE.Group();
  const R = rng(19);
  const shirt = mat({ map: canvasTex(16, 16, (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { c.fillStyle = shade(SHIRT, 0.9 + R() * 0.15 - (y % 5 === 0 ? 0.08 : 0)); c.fillRect(x, y, 1, 1); } }).tex }, smooth);
  const skin = mat({ color: SKIN }, smooth);
  const hair = mat({ color: HAIR }, smooth);
  // head: subdivided so it can melt (or rounded for the smooth version)
  const headGeo = smooth ? new THREE.SphereGeometry(0.2, 24, 18) : new THREE.BoxGeometry(0.36, 0.4, 0.34, 4, 5, 4);
  if (smooth) headGeo.scale(0.95, 1.05, 0.9);
  const faceM = mat({ map: faceTex(smooth) }, smooth);
  const head = new THREE.Mesh(headGeo, smooth ? faceM : [hair, hair, hair, skin, faceM, hair]);
  if (smooth) {
    // wrap the face texture on the front half only: u from the angle, v from the height
    const pos = headGeo.attributes.position!, uv = headGeo.attributes.uv!;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const a = Math.atan2(x, z);
      uv.setXY(i, clamp(0.5 + a / 2.4, 0.02, 0.98), clamp(0.5 + y / 0.42, 0.02, 0.98));
    }
  }
  head.position.set(0, 1.38, 0);
  const headBase = Float32Array.from(headGeo.attributes.position!.array as Float32Array);
  const torso = new THREE.Mesh(smooth ? new THREE.CylinderGeometry(0.24, 0.27, 0.58, 16) : new THREE.BoxGeometry(0.52, 0.58, 0.3), shirt);
  torso.position.set(0, 0.92, 0);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.14), skin); neck.position.set(0, 1.22, 0);
  const arm = (x: number) => {
    const piv = new THREE.Object3D(); piv.position.set(x, 1.12, 0);
    const a = new THREE.Mesh(smooth ? new THREE.CylinderGeometry(0.06, 0.055, 0.48, 10) : new THREE.BoxGeometry(0.13, 0.48, 0.13), shirt); a.position.y = -0.22;
    const h = new THREE.Mesh(smooth ? new THREE.SphereGeometry(0.065, 12, 8) : new THREE.BoxGeometry(0.12, 0.12, 0.12), skin); h.position.y = -0.5;
    piv.add(a, h); root.add(piv); return piv;
  };
  const armL = arm(-0.33), armR = arm(0.33);
  // the fork in his right hand (and a skin-coloured bridge: the fork fused to the hand)
  const fork = new THREE.Group();
  const steel = mat({ color: '#C8CCD8' }, smooth);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.2, 0.012), steel); handle.position.y = 0.1;
  fork.add(handle);
  for (let i = 0; i < 3; i++) { const tine = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.07, 0.008), steel); tine.position.set(-0.018 + i * 0.018, 0.23, 0); fork.add(tine); }
  fork.position.set(0, -0.52, 0.04); fork.rotation.x = -0.9;
  armR.add(fork);
  const fuse = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.05), skin); fuse.position.set(0, -0.56, 0.08); fuse.visible = !smooth;
  armR.add(fuse);
  root.add(head, torso, neck);
  // table + plate of spaghetti
  const tableM = mat({ color: '#D9D2BC' }, smooth);
  const table = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.06, 0.8), tableM); table.position.set(0, 0.76, 0.5);
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.74, 0.1), mat({ color: '#6A6F82' }, smooth)); leg.position.set(0, 0.37, 0.5);
  root.add(table, leg);
  const plate = new THREE.Group();
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.03, smooth ? 32 : 10), mat({ color: '#F3ECDF' }, smooth));
  plate.add(dish);
  const noodleM = mat({ color: NOODLE }, smooth), sauceM = mat({ color: SAUCE }, smooth);
  const strands: THREE.Mesh[] = [];
  for (let k = 0; k < (smooth ? 14 : 9); k++) {
    const pts: THREE.Vector3[] = [];
    for (let j = 0; j < 8; j++) { const a = j * 1.2 + k * 0.9; const r = 0.03 + 0.12 * hash(k, j, 1); pts.push(new THREE.Vector3(Math.cos(a) * r, 0.03 + 0.04 * hash(k, j, 2), Math.sin(a) * r)); }
    const s = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), smooth ? 40 : 14, 0.009, smooth ? 6 : 3, false), noodleM);
    plate.add(s); strands.push(s);
  }
  const sauce = new THREE.Mesh(new THREE.SphereGeometry(0.075, smooth ? 16 : 6, smooth ? 10 : 4), sauceM); sauce.scale.y = 0.35; sauce.position.y = 0.075;
  plate.add(sauce);
  plate.position.set(0, 0.8, 0.45);
  root.add(plate);
  return {
    root, head, headBase, armR, armL, fork, fuse, plate, strands,
    melt(amount, t) {
      if (smooth) return;
      const pos = headGeo.attributes.position!;
      for (let i = 0; i < pos.count; i++) {
        const x = headBase[i * 3]!, y = headBase[i * 3 + 1]!, z = headBase[i * 3 + 2]!;
        const front = clamp((z + 0.05) / 0.22);
        const low = clamp((0.2 - y) / 0.4);
        const n = hash(Math.round(x * 50), Math.round(z * 50), 3);
        // the lower face sags and drips toward the plate, the front bulges out
        const sag = amount * (0.12 + 0.9 * low * low) * (0.6 + 0.7 * n) * (0.5 + 0.5 * front);
        const drip = amount * front * low * 0.25 * (0.5 + 0.5 * Math.sin(t * 3 + n * 9)) * (n > 0.6 ? 1.6 : 0.6);
        pos.setXYZ(i, x * (1 + 0.3 * amount * low), y - sag - drip, z + amount * front * 0.12 * low);
      }
      pos.needsUpdate = true;
      head.geometry.computeVertexNormals();
    },
  };
}

/** The diner around him: a red booth, a checker floor, a tiled wall, a pendant lamp, a menu board. */
export function makeDinerSet(smooth = false) {
  const g = new THREE.Group();
  const R = rng(23);
  const floorT = canvasTex(32, 32, (c) => { for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { c.fillStyle = shade(((x >> 3) + (y >> 3)) & 1 ? '#E8E4D8' : '#2A2A36', 0.92 + R() * 0.1); c.fillRect(x, y, 1, 1); } }, true).tex;
  const fg = new THREE.PlaneGeometry(10, 10, 3, 3);
  const fuv = fg.attributes.uv!; for (let i = 0; i < fuv.count; i++) fuv.setXY(i, fuv.getX(i) * 5, fuv.getY(i) * 5);
  const floor = new THREE.Mesh(fg, mat({ map: floorT }, smooth)); floor.rotation.x = -Math.PI / 2; g.add(floor);
  const wallT = canvasTex(32, 32, (c) => { for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { c.fillStyle = shade(y < 12 ? '#3E8C86' : '#E8E4D8', 0.9 + R() * 0.12 - (x % 8 === 0 || y % 8 === 0 ? 0.15 : 0)); c.fillRect(x, y, 1, 1); } }, true).tex;
  const wg = new THREE.PlaneGeometry(10, 4, 3, 2);
  const wuv = wg.attributes.uv!; for (let i = 0; i < wuv.count; i++) wuv.setXY(i, wuv.getX(i) * 5, wuv.getY(i) * 2);
  const wall = new THREE.Mesh(wg, mat({ map: wallT }, smooth)); wall.position.set(0, 2, -0.9); g.add(wall);
  const red = mat({ color: '#B8322E' }, smooth);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.14, 0.55), red); seat.position.set(0, 0.5, -0.15); g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 0.18), red); back.position.set(0, 0.95, -0.5); g.add(back);
  const lamp = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.2, smooth ? 24 : 6, 1, true), mat({ color: P.title, emit: '#5A4010', side: THREE.DoubleSide }, smooth)); lamp.position.set(0, 2.2, 0.45); g.add(lamp);
  const cord = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.0, 0.02), mat({ color: P.ink }, smooth)); cord.position.set(0, 2.8, 0.45); g.add(cord);
  return g;
}
