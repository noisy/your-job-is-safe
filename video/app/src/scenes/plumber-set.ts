// The kitchen set shared by `plumber` and `robot`: tiled walls, the sink counter with its cabinet (hinged doors,
// the trap inside), a dripping faucet, and the front door in the right wall (it opens onto a night porch).
import * as THREE from 'three';
import { makeFrame } from '../ps1/cast';
import { psMat, canvasTex, rng, shade } from '../ps1/gfx';
import { P } from '../ps1/palette';

export const COUNTER_H = 1.2, WALL_Z = -3.0, FRONT_Z = -2.35;
/** The front door's opening in the right wall (x = 3.2): z range. */
export const DOOR_Z0 = -1.375, DOOR_Z1 = -0.425;

export interface Kitchen { root: THREE.Group; doorL: THREE.Object3D; doorR: THREE.Object3D; drip: THREE.Mesh; doorPivot: THREE.Object3D }

export function makeKitchen(): Kitchen {
  const root = new THREE.Group();
  const doorL = new THREE.Object3D(), doorR = new THREE.Object3D();
    const R = rng(21);
    const floorT = canvasTex(32, 32, (c) => {
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const k = ((x >> 3) + (y >> 3)) & 1; c.fillStyle = shade(k ? '#D8D0B8' : '#6A7894', 0.94 + R() * 0.08); c.fillRect(x, y, 1, 1); }
    }, true).tex;
    const fg = new THREE.PlaneGeometry(14, 14, 4, 4);
    const fuv = fg.attributes.uv!; for (let i = 0; i < fuv.count; i++) fuv.setXY(i, fuv.getX(i) * 7, fuv.getY(i) * 7);
    const floor = new THREE.Mesh(fg, psMat({ map: floorT })); floor.rotation.x = -Math.PI / 2; root.add(floor);
    const tileT = canvasTex(32, 32, (c) => {
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { c.fillStyle = shade((x % 16 === 0 || y % 16 === 0) ? '#8C93A8' : '#E6E9EE', 0.95 + R() * 0.06); c.fillRect(x, y, 1, 1); }
    }, true).tex;
    const wg = new THREE.PlaneGeometry(10, 4.5, 4, 2);
    const wuv = wg.attributes.uv!; for (let i = 0; i < wuv.count; i++) wuv.setXY(i, wuv.getX(i) * 10, wuv.getY(i) * 4.5);
    const wall = new THREE.Mesh(wg, psMat({ map: tileT })); wall.position.set(0, 2.25, WALL_Z); root.add(wall);
    const side2 = new THREE.Mesh(wg, psMat({ map: tileT })); side2.position.set(-3.4, 2.25, 0); side2.rotation.y = Math.PI / 2; root.add(side2);
    // the right wall, with the front door's opening (z from DOOR_Z0 to DOOR_Z1, 2.1 high)
    const tileM = psMat({ map: tileT });
    const wallPiece = (z0: number, z1: number, y0: number, y1: number) => {
      const g = new THREE.PlaneGeometry(z1 - z0, y1 - y0, 2, 2);
      const u = g.attributes.uv!; for (let i = 0; i < u.count; i++) u.setXY(i, z0 + u.getX(i) * (z1 - z0), y0 + u.getY(i) * (y1 - y0));
      const m = new THREE.Mesh(g, tileM); m.position.set(3.2, (y0 + y1) / 2, (z0 + z1) / 2); m.rotation.y = -Math.PI / 2; root.add(m);
    };
    wallPiece(-5, DOOR_Z0, 0, 4.5); wallPiece(DOOR_Z1, 5, 0, 4.5); wallPiece(DOOR_Z0, DOOR_Z1, 2.1, 4.5);
    // the front door, hinged at its back edge (rotate doorPivot.rotation.y negative to swing it into the room)
    const doorM = psMat({ color: '#7A5230' });
    const doorPivot = new THREE.Object3D(); doorPivot.position.set(3.17, 0, DOOR_Z0); root.add(doorPivot);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.1, DOOR_Z1 - DOOR_Z0), doorM); door.position.set(0, 1.05, (DOOR_Z1 - DOOR_Z0) / 2); doorPivot.add(door);
    const knob = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.06), psMat({ color: P.title })); knob.position.set(-0.05, 1.0, DOOR_Z1 - DOOR_Z0 - 0.12); doorPivot.add(knob);
    // outside: a porch at night with a lamp over the door
    const porch = new THREE.Mesh(new THREE.PlaneGeometry(3, 4), psMat({ color: '#2A3048' })); porch.rotation.x = -Math.PI / 2; porch.position.set(4.8, 0.005, -0.9); root.add(porch);
    const night = new THREE.Mesh(new THREE.PlaneGeometry(8, 5), psMat({ color: '#141B2E', unlit: true })); night.position.set(6.4, 2.5, -0.9); night.rotation.y = -Math.PI / 2; root.add(night);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.12), psMat({ color: '#FFE9A8', emit: '#806020', unlit: true })); lamp.position.set(3.3, 2.35, -0.9); root.add(lamp);
    // counter: two cabinet blocks either side of the sink cabinet, its opening, the doors on hinges
    const woodT = canvasTex(16, 16, (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { c.fillStyle = shade('#8A5A34', 0.85 + 0.15 * Math.abs(Math.sin(x * 1.3)) + R() * 0.06); c.fillRect(x, y, 1, 1); } }).tex;
    const wood = psMat({ map: woodT });
    const add = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); root.add(b); return b; };
    const depth = FRONT_Z - WALL_Z;
    add(1.1, COUNTER_H, depth, wood, -1.05, COUNTER_H / 2, (FRONT_Z + WALL_Z) / 2);
    add(1.1, COUNTER_H, depth, wood, 1.05, COUNTER_H / 2, (FRONT_Z + WALL_Z) / 2);
    add(1.0, 0.08, depth, wood, 0, COUNTER_H - 0.04, (FRONT_Z + WALL_Z) / 2);
    add(1.0, 0.06, depth, wood, 0, 0.03, (FRONT_Z + WALL_Z) / 2);
    add(1.0, COUNTER_H, 0.04, psMat({ color: '#1A1E2C' }), 0, COUNTER_H / 2, WALL_Z + 0.03);
    const top = psMat({ color: '#D8DCE4' });
    add(3.4, 0.07, depth + 0.1, top, 0, COUNTER_H + 0.035, (FRONT_Z + WALL_Z) / 2 + 0.05);
    const steel = psMat({ color: '#A9B2C4' });
    add(0.9, 0.03, 0.5, psMat({ color: '#3A4258' }), 0, COUNTER_H + 0.075, -2.68);
    for (const [w, d, x, z] of [[0.9, 0.04, 0, -2.45], [0.9, 0.04, 0, -2.91], [0.04, 0.5, -0.45, -2.68], [0.04, 0.5, 0.45, -2.68]] as [number, number, number, number][]) add(w, 0.06, d, steel, x, COUNTER_H + 0.1, z);
    add(0.06, 0.32, 0.06, steel, 0, COUNTER_H + 0.23, -2.92);
    add(0.06, 0.06, 0.32, steel, 0, COUNTER_H + 0.38, -2.8);
    add(0.08, 0.06, 0.06, psMat({ color: P.fail }), -0.12, COUNTER_H + 0.26, -2.92);
    add(0.08, 0.06, 0.06, psMat({ color: '#4F8CFF' }), 0.12, COUNTER_H + 0.26, -2.92);
    const drip = add(0.02, 0.05, 0.02, psMat({ color: '#6FB4FF', emit: '#10305A' }), 0, COUNTER_H + 0.3, -2.66);
    // the trap under the sink (inside the cabinet)
    const pipeM = psMat({ color: '#B87333' });
    add(0.06, 0.45, 0.06, pipeM, 0, COUNTER_H - 0.3, -2.7);
    add(0.3, 0.06, 0.06, pipeM, 0.12, COUNTER_H - 0.55, -2.7);
    add(0.06, 0.3, 0.06, pipeM, 0.27, COUNTER_H - 0.72, -2.8);
    // the doors (hinged at the outer edges, like the packing box's lid flaps)
    for (const [piv, x, sgn] of [[doorL, -0.5, 1], [doorR, 0.5, -1]] as [THREE.Object3D, number, number][]) {
      piv.position.set(x, 0.07, FRONT_Z + 0.02);
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.06, 0.04), wood); d.position.set(sgn * 0.25, 0.53, 0);
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.04), steel); h.position.set(sgn * 0.44, 0.6, 0.04);
      piv.add(d, h); root.add(piv);
    }
    // a window over the sink
    const winT = canvasTex(32, 24, (c) => { c.fillStyle = '#1B2A55'; c.fillRect(0, 0, 32, 24); c.fillStyle = '#F4E3A3'; c.fillRect(24, 4, 3, 3); c.fillStyle = '#3B281C'; c.fillRect(15, 0, 2, 24); c.fillRect(0, 11, 32, 2); });
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.9), psMat({ map: winT.tex, unlit: true })); win.position.set(-3.38, 2.3, -1.2); win.rotation.y = Math.PI / 2; root.add(win);
    const wf = makeFrame(1.2, 0.9, { sill: true, color: '#E8E0D0' }); wf.position.set(-3.4, 2.3, -1.2); wf.rotation.y = Math.PI / 2; root.add(wf);
    // the front door's casing, on the room side of the right wall (the door swings inside it)
    const dc = makeFrame(DOOR_Z1 - DOOR_Z0, 2.1, { color: '#E8E0D0', bottom: false, t: 0.11 });
    dc.position.set(3.2, 1.05, (DOOR_Z0 + DOOR_Z1) / 2); dc.rotation.y = -Math.PI / 2; root.add(dc);
    return { root, doorL, doorR, drip, doorPivot };
}
