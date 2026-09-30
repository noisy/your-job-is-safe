// endscreen [duration + CREDITS_TAIL → duration + END_TAIL], silent: the YouTube end screen. The user places two
// video links over it in YouTube's editor, so the two 16:9 tiles are EMPTY and FIXED on screen (the camera never
// moves): x 150–870 and 1050–1770, y 300–705 of the 1920x1080 frame, from ~0.45 s to the end.
//   It opens on robot's last frame (YOUR JOB IS SAFE!* / *for now in the robot's HUD): the card slides up and
//   away, the HUD corners fade, and the choice opens: "WHERE WILL AI LEAD US?" and CHOOSE YOUR FUTURE in block
//   letters, two framed tiles with P(BLOOM) ▶ (left: the hopeful future, the author's software-on-demand video)
//   and P(DOOM) ▶ (right: a friend's "Upping My P(doom)") under them, the cursor hopping between the two; DEV
//   hopeful bottom left, the v6.0 robot plumber bottom right twirling its wrench; sunburst and stars behind.
import * as THREE from 'three';
import type { Frame } from '../engine/scene';
import { clamp, ease, lerp, hash, springStep } from '../engine/util';
import { Ps1Stage, uiBox, type CamState } from '../ps1/stage';
import { makeDev, makeBotHead, makeBotBody, type Dev, type BotHead, type BotBody } from '../ps1/cast';
import { pixText, textW, psMat, canvasTex, psGlobals, LW, LH } from '../ps1/gfx';
import { P } from '../ps1/palette';
import { makeSunburst } from './intro-props';

const FOV = 52;
const D = 4; // the plane the UI sits on
const HH = D * Math.tan(THREE.MathUtils.degToRad(FOV / 2)), HW = HH * (16 / 9);
/** Screen px (1920x1080, y down) on the UI plane → world. */
const wx = (px: number, d = D) => (px / 960 - 1) * HW * (d / D);
const wy = (py: number, d = D) => (1 - py / 540) * HH * (d / D);
/** The tiles (the thumbnails' rects) and their frames, in screen px. */
const TILES = [{ x0: 150, x1: 870 }, { x0: 1050, x1: 1770 }];
const TY0 = 300, TY1 = 705, BORDER = 20;
const T_OPEN = 0.3; // s after the start: the tiles open (fully there by T_OPEN + 0.14)

export default class EndScreen extends Ps1Stage {
  private t0 = 0;
  private card!: ReturnType<Ps1Stage['blockTitle']>;
  private star!: ReturnType<Ps1Stage['blockTitle']>;
  private forNow!: THREE.Mesh; private hud!: THREE.Mesh;
  private title!: ReturnType<Ps1Stage['blockTitle']>;
  private question!: THREE.Mesh;
  private frames: THREE.Mesh[] = [];
  private labels: { mesh: THREE.Mesh; tex: ReturnType<typeof canvasTex>; key: string }[] = [];
  private burst!: THREE.Group;
  private stars: THREE.Mesh[] = [];
  private dev!: Dev; private bot!: { head: BotHead; body: BotBody; root: THREE.Group; wrench: THREE.Group };

  override init() {
    this.t0 = this.ctx.start;
    this.fogColor = '#05070F'; this.fogNear = 40; this.fogFar = 60;
    // background: a slow sunburst and drifting stars (behind everything)
    this.burst = makeSunburst(20, '#16204A', '#0B1024', 30);
    this.burst.position.set(0, 0, -12); this.world.add(this.burst);
    const sm = psMat({ color: P.uiLine, unlit: true, fog: 0 });
    for (let i = 0; i < 70; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), sm);
      this.world.add(m); this.stars.push(m);
    }
    // robot's final card, re-set exactly where robot left it
    this.card = this.blockTitle('YOUR JOB IS SAFE!', { tracking: 0.06 });
    const cs = (wx(1785) - wx(135)) / this.card.width;
    this.card.root.scale.setScalar(cs);
    this.card.root.userData.y = wy(475);
    this.star = this.blockTitle('*');
    this.star.root.scale.setScalar(cs * 0.9);
    this.star.root.userData.p = [wx(1830), wy(345)];
    const fn = canvasTex(120, 28, (c) => { uiBox(c, 0, 0, 120, 28); pixText(c, '*for now', 60 - textW('*for now', 2) / 2, 7, P.key2, 2, { shadow: P.uiEdge }); });
    this.forNow = this.quad(fn.tex, 550, 610, 1370, 795);
    const hud = canvasTex(LW, LH, (c) => {
      c.fillStyle = P.fail;
      for (const [x, y, sx, sy] of [[6, 4, 1, 1], [LW - 7, 4, -1, 1], [6, LH - 5, 1, -1], [LW - 7, LH - 5, -1, -1]] as const) {
        c.fillRect(Math.min(x, x + sx * 19), y, 20, 1); c.fillRect(x, Math.min(y, y + sy * 18), 1, 19);
        c.fillRect(Math.min(x, x + sx * 19), y + sy, 20, 1); c.fillRect(x + sx, Math.min(y, y + sy * 18), 1, 19);
      }
      pixText(c, 'PLUMBER UNIT v6.0', 12, LH - 18, P.bot);
      pixText(c, 'IDLE', LW - 12 - textW('IDLE'), LH - 18, P.fix);
    });
    this.hud = this.quad(hud.tex, 0, 0, 1920, 1080, D * 0.98, 0.999);
    // the level select
    this.title = this.blockTitle('CHOOSE YOUR FUTURE', { depth: 0.4, tracking: 0.05 });
    const ts = Math.min((wx(1560) - wx(360)) / this.title.width, 0.62);
    this.title.root.scale.setScalar(ts);
    this.title.root.position.set(0, wy(245), 0.0 - D);
    const q = 'WHERE WILL AI LEAD US?';
    const qt = canvasTex(200, 12, (c) => pixText(c, q, 100 - textW(q) / 2, 2, P.uiLine, 1, { shadow: P.uiEdge }));
    this.question = this.quad(qt.tex, 460, 70, 1460, 130);
    TILES.forEach((tl) => {
      const x0 = tl.x0 - BORDER, x1 = tl.x1 + BORDER, y0 = TY0 - BORDER, y1 = TY1 + BORDER;
      const tw = (x1 - x0) / 5, th = (y1 - y0) / 5, b = BORDER / 5;
      const tex = canvasTex(tw, th, (c) => {
        uiBox(c, 0, 0, tw, th, P.uiBg);
        c.fillStyle = '#0B1024'; c.fillRect(b, b, tw - 2 * b, th - 2 * b); // the tile: plain, the thumbnail covers it
      });
      const m = this.quad(tex.tex, x0, y0, x1, y1);
      m.userData.rect = [x0, y0, x1, y1];
      this.frames.push(m);
      const lt = canvasTex(144, 20, () => {});
      const lm = this.quad(lt.tex, (tl.x0 + tl.x1) / 2 - 360, 735, (tl.x0 + tl.x1) / 2 + 360, 835);
      this.labels.push({ mesh: lm, tex: lt, key: '' });
    });
    // DEV (overalls, sulking) and the v6.0 robot plumber, small in the bottom corners
    const dc = 3;
    this.dev = makeDev(); this.dev.outfit('overalls'); this.dev.setFace('neutral');
    this.dev.root.scale.setScalar(0.34);
    this.dev.root.position.set(wx(200, dc), wy(1062, dc), -dc);
    this.dev.root.rotation.y = Math.PI + 0.45; // turned toward the camera (he sits off-axis, bottom left)
    this.world.add(this.dev.root);
    const body = makeBotBody('#3D5A9A'), head = makeBotHead('v6.0');
    head.setFace('happy');
    head.screen.position.z += 0.03; // at 0.29x and 3 units away the kit's offset still z-fights: keep the face clear
    head.root.position.y = 0.02; body.neck.add(head.root);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.1, 0.56), psMat({ color: P.fail })); cap.position.set(0, 0.55, 0.02); head.root.add(cap);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 0.2), psMat({ color: P.failSide })); brim.position.set(0, 0.52, 0.34); head.root.add(brim);
    const wrench = new THREE.Group();
    const steel = psMat({ color: '#B8BECC' });
    const hnd = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.05), steel); hnd.position.y = 0.2; wrench.add(hnd);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.06), steel); jaw.position.y = 0.46; wrench.add(jaw);
    const jaw2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.06), steel); jaw2.position.set(0.08, 0.54, 0); wrench.add(jaw2);
    wrench.position.set(0, -0.62, 0.05); body.armR.add(wrench);
    const root = new THREE.Group(); root.add(body.root);
    root.scale.setScalar(0.29);
    root.position.set(wx(1715, dc), wy(1062, dc), -dc);
    root.rotation.y = -0.5;
    this.world.add(root);
    this.bot = { head, body, root, wrench };
  }

  /** A flat, unlit quad covering screen px (x0,y0)-(x1,y1) at distance d. */
  private quad(tex: THREE.Texture, x0: number, y0: number, x1: number, y1: number, d = D, opacity = 1) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), psMat({ map: tex, unlit: true, fog: 0, opacity }));
    m.scale.set(wx(x1, d) - wx(x0, d), wy(y0, d) - wy(y1, d), 1);
    m.position.set((wx(x0, d) + wx(x1, d)) / 2, (wy(y0, d) + wy(y1, d)) / 2, -d);
    this.world.add(m);
    return m;
  }

  /** The camera never moves: the tiles must stay where YouTube's overlays are placed. */
  camAt(): CamState { return { P: [0, 0, 0], T: [0, 0, -1], fov: FOV }; }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    this.begin();
    // lit from the viewer, like a title screen
    psGlobals.uLightDir.value.set(0.25, 0.6, 1).normalize();
    psGlobals.uAmb.value.setRGB(0.45, 0.45, 0.5);
    const u = f.t - this.t0;

    // robot's card leaves: the title flies up, "*for now" drops, the HUD corners fade
    const up = ease.inCubic(clamp((u - 0.05) / 0.35));
    const cy = this.card.root.userData.y as number;
    this.card.root.visible = up < 1;
    this.card.root.position.set(0, cy + up * 2.6, -D);
    this.card.letters.forEach((l, i) => { l.position.y = up * 0.9 * hash(i, 3); l.rotation.z = up * (hash(i, 5) - 0.5) * 1.2; });
    const sp = this.star.root.userData.p as [number, number];
    this.star.root.visible = up < 1;
    this.star.root.position.set(sp[0], sp[1] + up * 2.8, -D);
    this.star.letters[0]!.rotation.z = u * 4;
    const down = ease.inCubic(clamp((u - 0.1) / 0.3));
    this.forNow.visible = down < 1;
    this.forNow.position.y = wy(702) - down * 2.8;
    this.hud.visible = u < 0.45;
    (this.hud.material as THREE.RawShaderMaterial).uniforms.uOpacity!.value = 1 - clamp(u / 0.4);

    // background
    const bg = clamp((u - 0.15) / 0.5);
    this.burst.visible = bg > 0;
    this.burst.scale.setScalar(lerp(0.2, 1, ease.outCubic(bg)));
    this.burst.rotation.z = u * 0.08;
    this.stars.forEach((s, i) => {
      const x = (hash(i, 1) - 0.5) * 16, y0 = (hash(i, 2) - 0.5) * 9, z = -8 - hash(i, 3) * 3;
      s.position.set(x + 0.15 * Math.sin(u * 0.4 + i), ((y0 + u * (0.12 + 0.2 * hash(i, 4)) + 4.5) % 9) - 4.5, z);
      s.visible = bg > 0.5 && Math.floor(u * 3 + hash(i, 6) * 10) % 7 !== 0;
    });

    // the tiles open (JRPG windows) and then never move
    this.frames.forEach((m, i) => {
      const o = clamp((u - T_OPEN - 0.04 * i) / 0.12);
      const [x0, y0, x1, y1] = m.userData.rect as number[];
      const w = wx(x1!) - wx(x0!), h = wy(y0!) - wy(y1!);
      m.visible = o > 0;
      m.scale.set(w * (o >= 1 ? 1 : 0.6 + 0.4 * o), h * (o >= 1 ? 1 : o), 1);
    });
    // the question, then CHOOSE YOUR FUTURE drops in letter by letter, then bobs
    this.question.visible = u > 0.4;
    this.title.letters.forEach((l, i) => {
      const s = springStep(u - 0.55 - i * 0.025, 3.2, 0.42);
      l.visible = u > 0.55 + i * 0.025;
      l.position.y = lerp(2.5, 0, clamp(s, 0, 1.3)) + 0.06 * Math.sin(u * 2.4 - i * 0.45);
    });
    // the choice: P(BLOOM) + P(DOOM) = 1, so the cursor sets one to 1 (lit, ▶) and the other to 0 (dim)
    const sel = Math.floor(Math.max(0, u - 1) / 1.4) % 2;
    this.labels.forEach((lb, i) => {
      const on = u > 0.7 + 0.08 * i;
      lb.mesh.visible = on;
      const chosen = sel === i;
      const cur = chosen && Math.floor(u * 4) % 2 === 0;
      const key = `${cur}|${sel}`;
      if (key === lb.key) return;
      lb.key = key;
      const c = lb.tex.ctx;
      c.clearRect(0, 0, 144, 20);
      const s = `${i === 0 ? 'P(BLOOM)' : 'P(DOOM)'}=${chosen ? 1 : 0}`;
      const col = chosen ? (i === 0 ? P.fix : P.fail) : P.uiDim;
      const x0 = 72 - textW(`${s} ▶`, 2) / 2;
      pixText(c, s, x0, 3, col, 2, { shadow: P.uiEdge });
      if (cur) pixText(c, '▶', x0 + textW(`${s} `, 2), 3, col, 2, { shadow: P.uiEdge });
      lb.tex.tex.needsUpdate = true;
    });

    // DEV waits, arms crossed, hoping (a glance to the left tile now and then); the robot twirls its wrench
    const pop = (d: number) => clamp(springStep(u - d, 2.6, 0.4), 0, 1.2);
    this.dev.root.visible = u > 0.9;
    this.dev.root.scale.setScalar(0.34 * pop(0.9));
    this.dev.armL.rotation.set(1.3, 0, 0.9); this.dev.armR.rotation.set(1.3, 0, -0.9);
    this.dev.head.rotation.x = 0.25 + 0.08 * Math.sin(u * 0.9);
    this.dev.legR.rotation.x = 0.35 * Math.max(0, Math.sin(u * 3.1)) * (Math.floor(u / 2.2) % 2);
    this.dev.hips.rotation.x = 0.06 * Math.sin(u * 0.9);
    const bt = this.bot;
    bt.root.visible = u > 1.05;
    bt.root.scale.setScalar(0.29 * pop(1.05));
    bt.body.armR.rotation.set(1.9 + 0.1 * Math.sin(u * 2), 0, 0);
    const twirl = (u % 2.6) - 1.6;
    bt.wrench.rotation.z = twirl > 0 && twirl < 0.5 ? ease.inOutCubic(twirl / 0.5) * Math.PI * 2 : 0;
    bt.body.armL.rotation.set(0.3 * Math.sin(u * 1.4), 0, 0.15);
    bt.head.setFace(Math.floor(u * 1.1) % 5 === 4 ? 'blink' : sel === 1 ? 'focused' : 'happy');
    this.dev.setFace(sel === 0 ? 'smug' : 'scared');
    bt.head.root.rotation.y = 0.25 * Math.sin(u * 0.7);
    return this.present(f, out);
  }
}
