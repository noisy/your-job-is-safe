// The cozy bedroom of the grandma exploit: the chatbot as a grandma (the CRT head with reading glasses,
// a knitted shawl, a rocking chair), little DEV asleep in bed, the storybook, the wall calendar stuck on
// 2021 and today's paper. Shared by v1-grandma-calendar and the bridge ("Grandma's out of keys").
import * as THREE from 'three';
import { psMat, canvasTex, rng, shade, pixText } from '../ps1/gfx';
import { makeBotHead, makeBotBody, makeDev, type BotHead, type BotBody, type Dev } from '../ps1/cast';
import { P } from '../ps1/palette';

const box = (w: number, h: number, d: number, m: THREE.Material | THREE.Material[]) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

export interface Bedroom {
  root: THREE.Group;
  gran: { root: THREE.Group; rocker: THREE.Group; head: BotHead; body: BotBody };
  kid: Dev;
  /** The open book in grandma's lap: `pages` is where a 240x100 page texture goes (local x: -0.5..0.5 = left..right page). */
  book: THREE.Group; pages: THREE.Mesh;
  pointer: THREE.Mesh;
  calendar: THREE.Group; leafAnchor: THREE.Object3D;
  paper: THREE.Mesh;
  yarnBall: THREE.Mesh;
}

export function makeBedroom(): Bedroom {
  const root = new THREE.Group();
  const R = rng(41);
  // floor planks and flowered wallpaper
  const floorT = canvasTex(64, 64, (c) => {
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const pl = (y >> 3) & 1; c.fillStyle = shade(pl ? '#7A5230' : '#6B4628', 0.9 + R() * 0.12); c.fillRect(x, y, 1, 1); }
    c.fillStyle = '#3B281C'; for (let y = 0; y < 64; y += 8) c.fillRect(0, y, 64, 1);
  }, true).tex;
  const fg = new THREE.PlaneGeometry(12, 12, 3, 3);
  const fuv = fg.attributes.uv!; for (let i = 0; i < fuv.count; i++) fuv.setXY(i, fuv.getX(i) * 6, fuv.getY(i) * 6);
  const floor = new THREE.Mesh(fg, psMat({ map: floorT })); floor.rotation.x = -Math.PI / 2; root.add(floor);
  const wallT = canvasTex(32, 32, (c) => {
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { c.fillStyle = shade('#8A6A7A', 0.92 + R() * 0.1); c.fillRect(x, y, 1, 1); }
    for (const [x, y] of [[6, 6], [22, 14], [10, 24], [26, 28]] as [number, number][]) { c.fillStyle = '#D9A0A8'; c.fillRect(x - 1, y, 3, 1); c.fillRect(x, y - 1, 1, 3); c.fillStyle = '#F3D36A'; c.fillRect(x, y, 1, 1); }
  }, true).tex;
  const wg = new THREE.PlaneGeometry(12, 4, 3, 2);
  const wuv = wg.attributes.uv!; for (let i = 0; i < wuv.count; i++) wuv.setXY(i, wuv.getX(i) * 8, wuv.getY(i) * 3);
  const back = new THREE.Mesh(wg, psMat({ map: wallT })); back.position.set(0, 2, -2.0); root.add(back);
  const side = new THREE.Mesh(wg, psMat({ map: wallT })); side.position.set(-2.2, 2, 0); side.rotation.y = Math.PI / 2; root.add(side);
  const skirting = box(12, 0.12, 0.04, psMat({ color: '#3B281C' })); skirting.position.set(0, 0.06, -1.98); root.add(skirting);
  const winT = canvasTex(32, 32, (c) => {
    c.fillStyle = '#1B2A55'; c.fillRect(0, 0, 32, 32);
    for (let i = 0; i < 12; i++) { c.fillStyle = R() > 0.5 ? '#E8E4D8' : '#8C93B8'; c.fillRect(Math.floor(R() * 30) + 1, Math.floor(R() * 22) + 1, 1, 1); }
    c.fillStyle = '#F4E3A3'; c.fillRect(5, 6, 5, 5); c.fillStyle = '#3B281C'; c.fillRect(15, 0, 2, 32); c.fillRect(0, 15, 32, 2);
    c.fillStyle = '#B86B7A'; c.fillRect(0, 0, 4, 32); c.fillRect(28, 0, 4, 32);
  }).tex;
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.0), psMat({ map: winT, unlit: true })); win.position.set(-1.0, 2.0, -1.97); root.add(win);

  // the bed (along z), the quilt, the pillow, little DEV asleep in pyjamas
  const wood = psMat({ color: '#6B4628' });
  const quiltT = canvasTex(32, 32, (c) => {
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const k = ((x >> 3) + (y >> 3)) % 3; c.fillStyle = shade(['#C8554F', '#E0B458', '#5E86B5'][k]!, 0.9 + R() * 0.1); c.fillRect(x, y, 1, 1); }
    c.fillStyle = '#F3ECDF'; for (let i = 0; i < 32; i += 8) { c.fillRect(i, 0, 1, 32); c.fillRect(0, i, 32, 1); }
  }).tex;
  const bed = new THREE.Group();
  const frame = box(1.1, 0.3, 2.0, wood); frame.position.set(0, 0.2, 0); bed.add(frame);
  const head = box(1.2, 0.9, 0.08, wood); head.position.set(0, 0.55, -1.02); bed.add(head);
  const foot = box(1.2, 0.5, 0.08, wood); foot.position.set(0, 0.35, 1.02); bed.add(foot);
  const mattress = box(1.0, 0.14, 1.9, psMat({ color: '#E8E4D8' })); mattress.position.set(0, 0.42, 0); bed.add(mattress);
  const quilt = box(1.06, 0.1, 1.3, psMat({ map: quiltT })); quilt.position.set(0, 0.52, 0.3); bed.add(quilt);
  const pillow = box(0.7, 0.12, 0.3, psMat({ color: '#F3ECDF' })); pillow.position.set(0, 0.54, -0.78); bed.add(pillow);
  bed.position.set(1.35, 0, -0.85);
  root.add(bed);
  const kid = makeDev(); kid.outfit('pyjamas'); kid.setFace('sleep');
  kid.root.scale.setScalar(0.6);
  kid.root.rotation.x = -Math.PI / 2; // lying on his back, head toward the headboard
  kid.root.position.set(1.35, 0.6, -0.72);
  root.add(kid.root);
  // today's paper on the quilt, standing against the foot board
  const paperT = canvasTex(64, 48, (c) => {
    c.fillStyle = '#EDE7D6'; c.fillRect(0, 0, 64, 48);
    pixText(c, 'DAILY NEWS', 3, 3, P.ink);
    c.fillStyle = P.ink; c.fillRect(2, 11, 60, 1);
    pixText(c, '2026', 8, 15, P.ink, 3);
    c.fillStyle = '#9A917A'; for (let y = 39; y < 46; y += 3) c.fillRect(3, y, 58, 1);
  }).tex;
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.35), psMat({ map: paperT, side: THREE.DoubleSide }));
  paper.position.set(1.08, 1.98, -1.95); paper.rotation.set(0, 0, -0.08); // pinned beside the calendar
  root.add(paper);

  // the rocking chair and grandma (the chatbot's head, glasses on; a knitted shawl), facing the bed (+x)
  const gran = new THREE.Group();
  const rocker = new THREE.Group();
  const chairM = psMat({ color: '#5A3A22' });
  const seat = box(0.6, 0.06, 0.6, chairM); seat.position.set(0, 0.45, 0); rocker.add(seat);
  const backC = box(0.06, 0.9, 0.6, chairM); backC.position.set(-0.3, 0.9, 0); backC.rotation.z = -0.12; rocker.add(backC);
  for (const z of [-0.26, 0.26]) {
    const rk = box(0.9, 0.05, 0.05, chairM); rk.position.set(0, 0.05, z); rocker.add(rk);
    for (const x of [-0.24, 0.24]) { const lg = box(0.05, 0.42, 0.05, chairM); lg.position.set(x, 0.26, z); rocker.add(lg); }
    const arm = box(0.55, 0.05, 0.06, chairM); arm.position.set(0.02, 0.7, z * 1.05); rocker.add(arm);
  }
  const body = makeBotBody('#8A7FA8');
  body.root.position.set(0.02, -0.25, 0);
  body.root.rotation.y = Math.PI / 2; // the body faces +z: turn it to +x
  body.legL.rotation.x = -Math.PI / 2; body.legR.rotation.x = -Math.PI / 2;
  body.armL.rotation.x = -1.1; body.armR.rotation.x = -1.2; // holding the book up
  const headB = makeBotHead('v1.0');
  headB.setFace('glasses');
  headB.root.scale.setScalar(0.9);
  body.neck.add(headB.root);
  // the shawl: a knitted wedge over the shoulders
  const knitT = canvasTex(16, 16, (c) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { c.fillStyle = shade('#B04E6E', (x + (y >> 1)) % 4 < 2 ? 1.0 : 0.8); c.fillRect(x, y, 1, 1); } }).tex;
  const shawl = box(0.74, 0.28, 0.5, psMat({ map: knitT })); shawl.position.set(0, 0.62, 0.02); body.root.children[0]!.add(shawl);
  rocker.add(body.root);
  gran.add(rocker);
  gran.position.set(0.05, 0, -0.1);
  root.add(gran);
  // the open book in her lap, tilted toward her (and the camera over her shoulder)
  const book = new THREE.Group();
  const cover = box(0.62, 0.02, 0.44, psMat({ color: '#6A2E3E' })); book.add(cover);
  const pages = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.4), psMat({ color: '#F3ECDF' }));
  pages.rotation.x = -Math.PI / 2; pages.position.y = 0.012; book.add(pages);
  // she holds it up open toward the child (+x), leaning back a little: the pages face the bed
  book.rotation.order = 'YXZ';
  book.rotation.set(0.62, Math.PI / 2, 0);
  book.position.set(0.58, 1.12, -0.1);
  book.scale.setScalar(1.35);
  root.add(book);
  const pointer = box(0.012, 0.012, 1, psMat({ color: '#D9C27A' }));
  root.add(pointer);
  // the knitting on the armrest and the yarn ball on the floor
  const yarnBall = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), psMat({ map: knitT }));
  yarnBall.position.set(0.1, 0.1, 0.55); root.add(yarnBall);
  // the tear-off wall calendar (the leaf itself is a panel the scene draws)
  const calendar = new THREE.Group();
  const board = box(0.9, 1.25, 0.04, psMat({ color: '#3B281C' })); calendar.add(board);
  const pad = box(0.82, 1.1, 0.05, psMat({ color: '#EDE7D6' })); pad.position.z = 0.03; calendar.add(pad);
  const ring = box(0.7, 0.05, 0.08, psMat({ color: '#9A917A' })); ring.position.set(0, 0.56, 0.05); calendar.add(ring);
  const leafAnchor = new THREE.Object3D(); leafAnchor.position.set(0, 0.54, 0.065); calendar.add(leafAnchor);
  calendar.position.set(0.35, 1.72, -1.96);
  root.add(calendar);
  return { root, gran: { root: gran, rocker, head: headB, body }, kid, book, pages, pointer, calendar, leafAnchor, paper, yarnBall };
}
