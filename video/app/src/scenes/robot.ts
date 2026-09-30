// robot (docs/TREATMENT.md row #23): the doorbell (the guitar at audio.splice) rings; DEV opens the front door to the
// robot plumber (the chatbot head, v6.0, cap, toolbox). "You're absolutely right." scrolls on its LED dot-matrix face;
// it steps in and knocks DEV over (a visual, no line), walks to the sink with "Move aside, human. I have a task to
// complete." as the objective banner of its POV HUD, fixes the sink in two moves; GAME OVER / CONTINUE? ▶YES NO
// (the cursor can't move: the robot has the controller); then the meta reveal and the title.
import * as THREE from 'three';
import type { Frame } from '../engine/scene';
import { Lyrics, type Line } from '../engine/lyrics';
import { clamp, lerp, ease, keys, springStep, prog, type Key } from '../engine/util';
import { Ps1Stage, type CamState, type V3, uiBox, typeWords } from '../ps1/stage';
import { makeDev, makeBotHead, makeBotBody, type Dev, type BotHead, type BotBody } from '../ps1/cast';
import { psMat, pixText, textW, canvasTex, glyphRows, ADV, LW, LH, psGlobals } from '../ps1/gfx';
import { P } from '../ps1/palette';
import { makeKitchen, COUNTER_H, type Kitchen } from './plumber-set';
import { makeWrench } from './plumber';

const LED_W = 64, LED_H = 48, LED_PX = 3;

/** The credits, one row each (values in a column); "blame" is the human's line. */
const CREDITS: [string, string][] = [
  ['lyrics', 'Opus 5.5 + barely one human'],
  ['music', 'Suno v6, via claude-in-chrome'],
  ['video', 'Opus 5.5 — 100% code, no editors'],
  ['engine', 'Giacomo Magnanini @mexicat'],
  ['source', 'github.com/noisy/your-job-is-safe'],
  ['blame', 'YT @noisyCoder · X @realnoisycoder'],
];

export default class Robot extends Ps1Stage {
  kitchen!: Kitchen;
  dev!: Dev;
  body!: BotBody; head!: BotHead; robot = new THREE.Group();
  toolbox = new THREE.Group(); wrench = makeWrench();
  led = canvasTex(LED_W * LED_PX, LED_H * LED_PX, () => {});
  ledKey = '';
  faceMat!: THREE.RawShaderMaterial; faceTex0: THREE.Texture | null = null;
  hud = this.panel(LW, LH);
  banner = this.panel(300, 62);
  menu = this.panel(210, 62);
  tasks = this.panel(300, 124);
  forNow = this.panel(120, 28);
  labels: Record<string, THREE.Mesh> = {};
  gameOver!: { root: THREE.Group; letters: THREE.Object3D[]; width: number };
  title!: { root: THREE.Group; letters: THREE.Object3D[]; width: number };
  star!: { root: THREE.Group; letters: THREE.Object3D[]; width: number };
  taskDone!: { root: THREE.Group; letters: THREE.Object3D[]; width: number };
  L1!: Line; L2!: Line;
  d: number[] = [];
  bells: number[] = [];
  kicks: number[] = [];

  override async init() {
    const { lyrics: ly, audio: au, start, end } = this.ctx;
    this.L1 = ly.get("You're absolutely right", 0);
    this.L2 = ly.get('Move aside, human', 0);
    // the shot boundaries, anchored to the robot's two lines and snapped to the beat (the bar grid after the
    // splice is only inferred, so shots follow the words): the door, the LED face, the POV scan, the shove,
    // the POV to the sink, GAME OVER on the hit after "complete.", then the credits over the guitar outro
    const nb = (x: number) => au.nearestBeat(x);
    const wI = this.L2.words.find((w) => w.w === 'I') ?? this.L2.words[3]!;
    const afterLine = au.timeOfBeat(Math.ceil(au.beatAt(this.L2.end + 0.02)));
    this.d = [start, nb(this.L1.start - 0.99), nb(this.L1.start + 0.41), nb(this.L1.end + 0.78), nb(this.L2.start + 0.52), nb(wI.start + 0.08), afterLine];
    const dbAfter = (x: number) => au.downbeats.find((y) => y >= x - 0.02) ?? x;
    this.d.push(dbAfter(afterLine + 1.0)); // d7: the credits start (GAME OVER holds until this downbeat)
    this.d.push(dbAfter(this.d[7]! + 1.3)); // d8
    this.d.push(end);
    // the doorbell's notes: loudness peaks of the guitar after the splice
    for (let t = start + 0.01, prev = 0; t < start + 1.6; t += 0.01) {
      const v = au.env('rms', t), nx = au.env('rms', t + 0.01);
      if (v > 0.3 && v >= prev && v >= nx && (this.bells.length === 0 || t - this.bells[this.bells.length - 1]! > 0.2)) this.bells.push(t);
      prev = v;
    }
    if (this.bells.length === 0) this.bells = [start, start + 0.4];
    this.kicks = au.events('kick', this.d[6]! - 0.05, end).map((e) => e[0]);
    this.fogNear = 4; this.fogFar = 15;
    this.kitchen = makeKitchen(); this.world.add(this.kitchen.root);
    this.dev = makeDev(); this.dev.outfit('overalls'); this.world.add(this.dev.root);
    // the robot plumber: humanoid body in overalls blue, the chatbot head (v6.0), a red cap, a toolbox
    this.body = makeBotBody('#3D5A9A');
    this.head = makeBotHead('v6.0');
    this.body.neck.add(this.head.root);
    const cap = new THREE.Group();
    const capM = psMat({ color: P.fail });
    const crown = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.12, 0.54), capM); crown.position.y = 0.56;
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.03, 0.2), capM); brim.position.set(0, 0.51, 0.34);
    cap.add(crown, brim); this.head.root.add(cap);
    const tbM = psMat({ color: P.fail }), tbH = psMat({ color: '#2A2A33' });
    const tb = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.24, 0.2), tbM); tb.position.y = -0.14;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.04), tbH); handle.position.y = 0.0;
    this.toolbox.add(tb, handle); this.toolbox.position.set(0, -0.68, 0); this.body.armL.add(this.toolbox);
    this.wrench.position.set(0, -0.68, 0.05); this.wrench.rotation.x = -Math.PI / 2; this.body.armR.add(this.wrench);
    this.robot.add(this.body.root); this.robot.scale.setScalar(0.92);
    this.world.add(this.robot);
    this.faceMat = this.head.screen.material as THREE.RawShaderMaterial;
    this.led.tex.magFilter = THREE.NearestFilter;
    // labels, titles, the end card
    const L = (k: string, s: string, fg: string, bg: string, sc = 2) => (this.labels[k] = this.label(s, fg, bg, sc));
    L('ding', '♪ DING', P.ink, P.title); L('dong', 'DONG ♪', P.ink, P.title);
    L('human', 'HUMAN', P.uiLine, P.fail, 1); L('sink', '▼ SINK', P.ink, P.title, 1); L('fixed', '✓ SINK FIXED', P.ink, P.fix, 2);
    this.gameOver = this.blockTitle('GAME OVER', { cap: P.fail, side: P.failSide });
    this.title = this.blockTitle('YOUR JOB IS SAFE!', { tracking: 0.06 });
    this.star = this.blockTitle('*');
    this.taskDone = this.blockTitle('TASK COMPLETE', { cap: P.fix, side: P.fixSide, tracking: 0.06 });
  }

  // ================================================================== camera
  camAt(t: number): CamState {
    const [d0, d1, d2, d3, d4, d5, d6, d7, d8, end] = this.d as [number, number, number, number, number, number, number, number, number, number];
    const kv = (ks: [number, V3, ((x: number) => number)?][]): V3 => [0, 1, 2].map((i) => keys(t, ks.map(([tt, v, e]) => [tt, v[i]!, e] as Key))) as V3;
    if (t < d1) {
      // behind DEV at the sink; he turns and walks to the ringing door, the camera follows him
      return { P: kv([[d0, [-1.4, 1.7, 0.9]], [d1, [0.2, 1.55, 0.6], ease.inOutCubic]]), T: kv([[d0, [1.2, 1.3, -1.3]], [d1, [3.0, 1.35, -0.9], ease.inOutCubic]]), roll: keys(t, [[d0, 0.04], [d1, -0.03]]), fov: 52 };
    }
    if (t < d2) {
      // low hero angle past DEV: the robot in the doorway, backlit by the porch lamp; crane up to its face
      return { P: kv([[d1, [1.55, 0.45, 0.35]], [d2, [1.85, 0.95, 0.15], ease.inOutCubic]]), T: kv([[d1, [3.9, 1.6, -0.88]], [d2, [3.9, 1.72, -0.88], ease.inOutCubic]]), roll: keys(t, [[d1, -0.08], [d2, 0.0]]), fov: 56 };
    }
    if (t < d3) {
      // close on the LED face, pushing in as the words scroll
      const push = prog(t, d2, d3, ease.outCubic);
      return { P: [lerp(2.85, 3.05, push), 1.74, lerp(-0.7, -0.8, push)], T: [3.9, 1.7, -0.9], roll: 0.03 - 0.05 * push, fov: 44 };
    }
    if (t < d4) return this.pov(t, [3.9, 1.85, -0.9], [2.7, 1.85, -0.9], [0, 1.4, -0.9], d3, d4);
    if (t < d5) {
      // third person, side on: the robot walks in and knocks DEV over
      return { P: kv([[d4, [2.2, 1.45, 2.9]], [d5, [1.9, 1.35, 2.6], ease.inOutCubic]]), T: kv([[d4, [3.0, 1.2, -0.8]], [d5, [2.5, 0.9, -0.6], ease.inOutCubic]]), roll: 0.03 * Math.sin((t - d4) * 3), fov: 58 };
    }
    // (it stops short of the sink and looks a little down, so the objective banner at the top clears the SINK tag)
    if (t < d6) return this.pov(t, [2.4, 1.85, -1.0], [0.9, 1.8, -0.35], [0, 1.1, -2.6], d5, d6, 0.9);
    const cs = this.cardStart();
    if (t < cs) {
      // wide, low, from behind DEV on the floor: the robot fixing the sink; GAME OVER slams in front of it
      return { P: kv([[d6, [2.6, 0.55, 1.6]], [cs, [2.2, 0.75, 1.3], ease.inOutCubic]]), T: kv([[d6, [0.3, 1.35, -2.2]], [cs, [0.3, 1.45, -2.2]]]), roll: -0.04, fov: 56 };
    }
    // the credits: the robot's POV, turned round from the fixed sink to the human on the floor (a slow push)
    const u = prog(t, cs, end, ease.outCubic);
    const turn = ease.inOutCubic(prog(t, cs, cs + 0.6));
    return { P: [lerp(0.1, 0.35, u), 1.85, lerp(-1.6, -1.2, u)], T: [lerp(0.0, 2.1, turn), lerp(1.4, 0.35, turn), lerp(-3.0, -0.3, turn)], roll: 0.012 * Math.sin(t * 1.3), fov: 58 };
    void d8;
  }

  /** The credits start: GAME OVER holds until just before the next downbeat a second or more after the hit (the first credit line lands on it). */
  private cardStart() { return this.d[7]! - 0.25; }

  /**
   * The credits on the guitar outro's downbeats: one line per downbeat from the card's start, TASK COMPLETE on
   * the next downbeat, the title on the one after, and the asterisk (and "*for now") three beats later, on the
   * outro's last big hit.
   */
  private creditTimes() {
    const au = this.ctx.audio, end = this.d[this.d.length - 1]!;
    const dbs = au.downbeats.filter((y) => y >= this.d[7]! - 0.02);
    // the tracked beats sit at the hits' onset peaks; the attack you hear starts ~55 ms earlier, so everything
    // leads by LEAD (the attack plus a frame); the springing slams start SLAM earlier still, to land on the hit
    const LEAD = 0.08, SLAM = 0.1;
    const at = (i: number) => (dbs[i] ?? this.cardStart() + 1.39 * i) - LEAD;
    const lines = CREDITS.map((_, i) => at(i));
    const done = Math.min(at(CREDITS.length), end - 3.2) - SLAM;
    const title = Math.min(at(CREDITS.length + 1), end - 2.0) - SLAM;
    const star = Math.min(au.timeOfBeat(au.beatAt(title + SLAM + LEAD) + 3) - LEAD, end - 0.8) - SLAM;
    return { lines, done, title, star };
  }

  /** The robot's POV: walking from a to b (with a step bob) while looking toward `look`, a turn of the head at `turn` (0..1 of the shot). */
  private pov(t: number, a: V3, b: V3, look: V3, t0: number, t1: number, turn = 0): CamState {
    const u = prog(t, t0, t1, ease.inOutQuad);
    const steps = (t - t0) * 3.2;
    const bob = 0.03 * Math.abs(Math.sin(steps * Math.PI));
    const P: V3 = [lerp(a[0], b[0], u), lerp(a[1], b[1], u) + bob, lerp(a[2], b[2], u)];
    const k = ease.inOutCubic(clamp(u * 1.6));
    const lk: V3 = turn > 0 ? [lerp(a[0] - 2.5, look[0], k), lerp(1.6, look[1], k), lerp(a[2], look[2], k)] : look;
    return { P, T: lk, roll: 0.012 * Math.sin(steps * Math.PI), fov: 58 };
  }

  // ================================================================== per-frame
  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t;
    const [d0, d1, d2, d3, d4, d5, d6, d7] = this.d as [number, number, number, number, number, number, number, number];
    const endCard = t >= this.cardStart();
    this.fogColor = P.fog;
    this.begin();
    for (const k in this.labels) this.labels[k]!.visible = false;
    this.gameOver.root.visible = false; this.title.root.visible = false; this.star.root.visible = false; this.taskDone.root.visible = false;
    this.kitchen.root.visible = true; this.dev.root.visible = true; this.robot.visible = !endCard;
    this.hud.open = 0; this.banner.open = 0; this.menu.open = 0; this.tasks.open = 0; this.forNow.open = 0;
    if (!endCard) {
      this.animDoor(t);
      this.animDev(t);
      this.animRobot(t);
      this.drawLED(t);
      if (t >= d3 && t < d4 || t >= d5 && t < d6) this.drawHUD(t);
      if (t >= d3 && t < d6) this.drawBanner(t);
      if (t >= d6) this.animGameOver(t);
    } else { this.animDoor(t); this.animDev(t); this.animEnd(t); }
    void d0; void d1; void d2;
    return this.present(f, out);
  }

  private animDoor(t: number) {
    const [, d1, , , d4] = this.d as [number, number, number, number, number];
    // the door swings open as DEV reaches it (just before the downbeat), and the robot's shove slams it wide
    const open = clamp(springStep(t - (d1 - 0.22), 1.8, 0.55), 0, 1.1) * 1.35 + 0.35 * prog(t, d4 + 0.2, d4 + 0.35, ease.outCubic);
    this.kitchen.doorPivot.rotation.y = -open;
    // the faucet drips until the robot fixes it
    const fixed = t >= this.d[6]! + 0.55;
    this.kitchen.drip.visible = !fixed;
    this.kitchen.drip.position.y = COUNTER_H + 0.33 - ((t * 1.8) % 1) * 0.25;
    // the bell notes
    this.bells.slice(0, 4).forEach((b, i) => {
      const lb = this.labels[i % 2 ? 'dong' : 'ding']!;
      const next = this.bells[i + 1] ?? b + 0.45;
      if (t < b || t >= Math.min(b + 0.45, next)) return;
      if (i < 2 || t >= b) {
        lb.visible = true;
        const s = clamp(springStep(t - b, 4, 0.4), 0, 1.25);
        lb.position.set(2.95, 1.75 + 0.15 * s + 0.12 * i, i % 2 ? -0.3 : -1.5);
        lb.scale.setScalar(s * 0.9);
      }
    });
  }

  private animDev(t: number) {
    const [d0, d1, , , d4, d5] = this.d as [number, number, number, number, number, number];
    const dev = this.dev;
    dev.sit(false);
    for (const o of [dev.armL, dev.armR, dev.legL, dev.legR, dev.head, dev.torso, dev.hips]) o.rotation.set(0, 0, 0);
    dev.hips.position.set(0, 0.62, 0);
    dev.root.rotation.set(0, 0, 0);
    if (t < d1) {
      // turn from the sink, walk to the door
      const walk = prog(t, d0 + 0.25, d1 - 0.2, ease.inOutQuad);
      dev.root.position.set(lerp(0, 2.5, walk), 0, lerp(-1.8, -1.02, walk));
      // (DEV faces -z at rotation 0: -PI/2 faces +x, toward the door; he turns from facing the camera, as plumber left him)
      dev.root.rotation.y = lerp(Math.PI, 1.5 * Math.PI, prog(t, d0, d0 + 0.3, ease.outCubic));
      const sw = Math.sin((t - d0) * 11) * 0.5 * (walk > 0 && walk < 1 ? 1 : 0);
      dev.legL.rotation.x = sw; dev.legR.rotation.x = -sw; dev.armL.rotation.x = -sw * 0.6; dev.armR.rotation.x = sw * 0.6;
      dev.setFace(t < d0 + 0.3 ? 'shock' : 'neutral');
      return;
    }
    if (t < d4 + 0.2) {
      // at the door, facing the robot: smug ("absolutely right"), then unsure
      dev.root.position.set(2.5, 0, -1.02); dev.root.rotation.y = -Math.PI / 2 + 0.2;
      dev.setFace(t < this.L1.words[2]!.end ? 'smug' : 'shock');
      dev.armR.rotation.x = t < this.L1.words[2]!.end ? -0.3 : 0;
      return;
    }
    // shoved aside: he topples over sideways onto the floor and stays there
    const fall = prog(t, d4 + 0.2, d4 + 0.62, ease.inQuad);
    const bounce = 0.06 * Math.exp(-Math.max(0, t - d4 - 0.62) * 8) * Math.abs(Math.sin((t - d4 - 0.62) * 25));
    dev.root.position.set(2.5 - 0.2 * fall, bounce, lerp(-1.02, -0.3, fall));
    dev.root.rotation.set(0, -Math.PI / 2, 1.45 * fall, 'YXZ');
    dev.armL.rotation.z = -1.2 * fall; dev.armR.rotation.z = 1.2 * fall; dev.legL.rotation.x = 0.5 * fall;
    dev.setFace(t < d5 ? 'shock' : 'scared');
  }

  private animRobot(t: number) {
    const [, d1, , d3, d4, d5, d6] = this.d as [number, number, number, number, number, number, number];
    const b = this.body;
    for (const o of [b.armL, b.armR, b.legL, b.legR]) o.rotation.set(0, 0, 0);
    this.head.root.rotation.set(0, 0, 0);
    let x = 3.95, z = -0.9, yaw = -Math.PI / 2, walking = false, duck = 0;
    if (t >= d3 && t < d5) {
      const u = prog(t, d3, d4 + 0.5, ease.inOutQuad);
      x = lerp(3.95, 2.75, u); walking = u > 0 && u < 1; duck = Math.sin(clamp((x - 2.9) / 1.0) * Math.PI) * 0.18;
      // the shove: the right arm sweeps DEV aside
      const sh = prog(t, d4 + 0.05, d4 + 0.25, ease.outCubic) - prog(t, d4 + 0.45, d4 + 0.7, ease.inOutCubic);
      b.armR.rotation.set(-1.3 * sh, 0, 0.9 * sh);
    } else if (t >= d5 && t < d6) {
      const u = prog(t, d5 - 0.1, d6 - 0.15, ease.inOutQuad);
      x = lerp(2.75, 0.1, u); z = lerp(-0.9, -1.85, u); walking = u > 0 && u < 1;
      yaw = lerp(-Math.PI / 2, -Math.PI, ease.inOutCubic(clamp(u * 1.5)));
    } else if (t >= d6) {
      x = 0.1; z = -1.85; yaw = Math.PI;
      // fixes it in two moves: wrench on the pipe, a twist on the kick
      const k = this.kicks[1] ?? d6 + 0.35;
      b.armR.rotation.set(-1.9 + 0.5 * prog(t, k, k + 0.12, ease.outBack), 0, -0.2);
      b.armL.rotation.set(-0.3, 0, 0);
      this.head.setFace('focused');
      if (t >= d6 + 0.55) {
        const lb = this.labels.fixed!;
        lb.visible = t < d6 + 0.4; lb.position.set(0.1, 2.75, -2.2);
        lb.scale.setScalar(clamp(springStep(t - d6 - 0.55, 4, 0.45), 0, 1.2));
      }
    }
    if (walking) {
      const s = Math.sin(t * 9) * 0.45;
      b.legL.rotation.x = s; b.legR.rotation.x = -s; b.armL.rotation.x = -s * 0.4;
    }
    this.robot.position.set(x, 0, z); this.robot.rotation.set(0, yaw, 0);
    // (in its own POV the camera is inside its head)
    this.robot.visible = !(t >= d3 && t < d4 || t >= d5 && t < d6);
    b.root.rotation.x = duck;
    // the face: its normal face before the words, LED text for line 1, red "focused" eyes on the job
    const ledOn = t >= this.L1.start - 0.25 && t < d3 + 0.2;
    if (ledOn) this.faceMat.uniforms.uMap!.value = this.led.tex;
    else this.head.setFace(t < d1 + 0.1 ? 'off' : t < this.L1.start - 0.25 ? (Math.floor(t * 8) % 2 ? 'neutral' : 'blink') : 'focused');
  }

  /** The LED dot-matrix face: each word of "You're absolutely right." scans in as sung, one word per row. */
  private drawLED(t: number) {
    const words = this.L1.words;
    const shown = words.map((w) => clamp(Math.floor(Lyrics.wordProgress(w, t) * Array.from(w.w).length + (t >= w.start ? 1 : 0)), 0, Array.from(w.w).length));
    const after = t > this.L1.end + 0.25;
    const key = shown.join(',') + (after ? `:${Math.floor(t * 4) % 2}` : '');
    if (key === this.ledKey) return;
    this.ledKey = key;
    // the dot grid, lit from the bitmap font's glyph rows (no pixel readback: that breaks in the paper skin)
    const grid = new Uint8Array(LED_W * LED_H);
    const light = (x: number, y: number) => { if (x >= 0 && x < LED_W && y >= 0 && y < LED_H) grid[y * LED_W + x] = 1; };
    words.forEach((w, i) => {
      const chars = Array.from(w.w);
      const x0 = Math.round((LED_W - textW(w.w)) / 2), y0 = 6 + i * 13;
      chars.slice(0, shown[i]).forEach((ch, ci) => {
        glyphRows(ch).forEach((bits, r) => { for (let bx = 0; bx < 5; bx++) if (bits & (16 >> bx)) light(x0 + ci * ADV + bx, y0 + r); });
      });
    });
    if (after && Math.floor(t * 4) % 2 === 0) for (let x = -1; x < 2; x++) for (let y = 44; y < 46; y++) light(LED_W / 2 + x, y);
    const c = this.led.ctx;
    c.fillStyle = '#0A0E1C'; c.fillRect(0, 0, LED_W * LED_PX, LED_H * LED_PX);
    for (let y = 0; y < LED_H; y++) for (let x = 0; x < LED_W; x++) {
      const on = grid[y * LED_W + x] === 1;
      c.fillStyle = on ? '#C8F2FF' : '#1A2440';
      c.fillRect(x * LED_PX, y * LED_PX, LED_PX - 1, LED_PX - 1);
    }
    this.led.tex.needsUpdate = true;
  }

  /** The robot's POV HUD: corner brackets, its status line, a target box on the human, a waypoint on the sink. */
  private drawHUD(t: number, mode?: 'done') {
    const h = this.hud;
    const d3 = this.d[3]!, d5 = this.d[5]!;
    h.hang = { ref: t, follow: 0, D: 0.3, x: 0, y: 0, frac: 1.0 };
    h.open = 1;
    const phase = mode ?? (t < this.d[4]! ? 'walk' : 'task');
    h.draw(`${phase}|${Math.floor(t * 6) % 2}`, (c) => {
      const col = P.fail;
      c.fillStyle = col;
      for (const [x, y, sx, sy] of [[6, 6, 1, 1], [LW - 7, 6, -1, 1], [6, LH - 7, 1, -1], [LW - 7, LH - 7, -1, -1]] as [number, number, number, number][]) {
        c.fillRect(Math.min(x, x + sx * 18), y, 19, 2); c.fillRect(x, Math.min(y, y + sy * 18), 2, 19);
      }
      pixText(c, 'PLUMBER UNIT v6.0', 12, LH - 18, P.bot, 1, { shadow: P.uiEdge });
      const st = phase === 'walk' ? 'SCANNING' : phase === 'done' ? 'IDLE' : 'PATHING';
      pixText(c, st, LW - 12 - textW(st), LH - 18, phase === 'done' ? P.fix : Math.floor(t * 6) % 2 ? P.fail : P.uiLine, 1, { shadow: P.uiEdge });
      c.fillStyle = 'rgba(255,75,92,0.10)'; for (let y = 0; y < LH; y += 3) c.fillRect(0, y, LW, 1);
    });
    if (mode === 'done') return;
    if (t < this.d[4]!) {
      // target box on DEV's head
      const lb = this.labels.human!;
      lb.visible = true; lb.position.set(2.5, 1.72 + 0.02 * Math.sin(t * 20), -1.02);
      const dCam = this.camAt(t).P[0] - 2.5;
      lb.scale.setScalar(clamp(dCam * 0.32, 0.12, 0.5));
    } else {
      const lb = this.labels.sink!;
      lb.visible = t >= d5 + 0.3;
      lb.position.set(0, 1.62 + 0.06 * Math.sin(t * 6), -2.65); lb.scale.setScalar(clamp(springStep(t - d5 - 0.3, 4, 0.45), 0, 1.2) * 1.4);
    }
    void d3;
  }

  /** The objective banner: the lyric typed into the robot's quest window (hung in its view, or over its head in 3rd person). */
  private drawBanner(t: number) {
    const w = this.L2.words;
    const [, , , d3, d4, d5, d6] = this.d as [number, number, number, number, number, number, number];
    const part = t < d5 ? w.slice(0, 3) : w.slice(3);
    const bn = this.banner;
    if (t >= d4 && t < d5) {
      // third person: the quest window floats over the robot
      bn.hang = { ref: d4 + 0.5, D: 2.0, x: 0.0, y: 0.58, frac: 0.64, yaw: -0.1, pitch: 0.05 };
    } else bn.hang = { ref: t, follow: 0, D: 0.45, x: 0, y: 0.6, frac: 0.78, yaw: 0, pitch: 0 };
    const segStart = t < d4 ? d3 : t < d5 ? d4 : d5;
    bn.open = clamp((t - segStart) / 0.12) * (t > d6 - 0.12 ? 1 - clamp((t - (d6 - 0.12)) / 0.12) : 1);
    const tw = typeWords(null, part, t, 10, 19, { maxChars: 23 });
    bn.draw(`${part[0]!.gi}|${tw.key}`, (c) => {
      uiBox(c, 0, 0, 300, 62);
      pixText(c, t < d5 ? 'NEW OBJECTIVE' : 'OBJECTIVE', 10, 6, P.fail, 1, { shadow: P.uiEdge });
      pixText(c, '!', 288, 6, P.fail, 1);
      typeWords(c, part, t, 10, 19, { maxChars: 23, key: (x) => /human|task|complete/i.test(x.w) });
    });
  }

  private animGameOver(t: number) {
    const [, , , , , , d6, d7] = this.d as [number, number, number, number, number, number, number, number];
    const g = this.gameOver;
    g.root.visible = true;
    // hang it in front of the shot's camera, letters slamming down one per kick
    const c = this.camAt(d6 + 0.4);
    const rc = new THREE.PerspectiveCamera(); this.pose(rc, c);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(rc.quaternion), upv = new THREE.Vector3(0, 1, 0).applyQuaternion(rc.quaternion);
    const D = 2.4, hh = D * Math.tan(THREE.MathUtils.degToRad((c.fov ?? 52) / 2)), hw = hh * (LW / LH);
    g.root.position.copy(rc.position).addScaledVector(fwd, D).addScaledVector(upv, 0.28 * hh);
    g.root.quaternion.copy(rc.quaternion);
    g.root.scale.setScalar((0.82 * 2 * hw) / g.width);
    g.letters.forEach((l, i) => {
      const t0 = d6 + i * 0.05;
      const s = springStep(t - t0, 3.4, 0.42);
      l.visible = t >= t0;
      l.position.y = lerp(3, 0, clamp(s, 0, 1.3)) + 0.12 * this.ctx.audio.hit('kick', t, 0.08);
      l.rotation.x = (1 - clamp(s)) * -1.2;
    });
    // CONTINUE? ▶YES NO: the cursor won't move (the robot has the controller)
    const m = this.menu;
    const a = d6 + 0.45;
    m.hang = { ref: t, follow: 0, D: 1.2, x: 0, y: -0.4, frac: 0.52, yaw: 0.06, pitch: 0 };
    m.open = t >= a ? clamp((t - a) / 0.12) : 0;
    const tries = this.kicks.filter((k) => k > a + 0.05 && k <= t);
    const lastTry = tries.length ? tries[tries.length - 1]! : -9;
    const jig = t - lastTry < 0.12 ? (Math.floor((t - lastTry) * 50) % 2 ? 3 : -2) : 0;
    m.draw(`${jig}|${tries.length}`, (c) => {
      uiBox(c, 0, 0, 210, 62);
      pixText(c, 'CONTINUE?', 105 - textW('CONTINUE?', 2) / 2, 8, P.uiLine, 2, { shadow: P.uiEdge });
      pixText(c, '▶', 46 + jig, 30, P.key2, 2, { shadow: P.uiEdge });
      pixText(c, 'YES', 62, 30, P.uiLine, 2, { shadow: P.uiEdge });
      pixText(c, 'NO', 134, 30, P.uiDim, 2, { shadow: P.uiEdge });
      pixText(c, tries.length ? 'controller in use: v6.0' : '', 105 - textW('controller in use: v6.0') / 2, 50, P.fail, 1, { shadow: P.uiEdge });
    });
    void d7;
  }

  /**
   * The credits, in the robot's voice: its HUD's objective list ticks the credits in one by one (a line every two
   * beats of the guitar outro), then TASK COMPLETE slams in big on a downbeat under the finished list; then the
   * title slams back in with an asterisk: "*for now". The finished card holds to the last frame.
   */
  private animEnd(t: number) {
    const end = this.d[this.d.length - 1]!;
    const { lines, done, title: tTitle, star: tStar } = this.creditTimes();
    // the HUD frame stays on (the robot is still looking)
    this.drawHUD(t, 'done');
    const cs = this.cardStart();
    const shown = lines.filter((x) => t >= x).length;
    const tk = this.tasks;
    tk.hang = { ref: t, follow: 0, D: 0.9, x: 0.0, y: 0.2, frac: 0.8, yaw: -0.05 + 0.03 * Math.sin(t * 0.9), pitch: 0.02 };
    tk.open = clamp((t - cs) / 0.12) * (1 - clamp((t - tTitle) / 0.12));
    tk.draw(`${shown}`, (c) => {
      uiBox(c, 0, 0, 300, 124);
      let y = 16;
      CREDITS.forEach(([k, v], i) => {
        const on = i < shown;
        pixText(c, on ? '✓' : '·', 10, y, on ? P.fix : P.uiDim, 1, { shadow: P.uiEdge });
        pixText(c, k, 22, y, on ? P.key2 : P.uiDim, 1, { shadow: P.uiEdge });
        if (on) pixText(c, v, 76, y, P.uiLine, 1, { shadow: P.uiEdge });
        y += 16;
      });
    });
    // TASK COMPLETE: big green block letters under the finished list, slamming in letter by letter on the downbeat
    const tc = this.taskDone;
    tc.root.visible = t >= done - 0.02 && t < tTitle;
    if (tc.root.visible) {
      const c = this.camAt(t);
      const rc = new THREE.PerspectiveCamera(); this.pose(rc, c);
      const q = rc.quaternion;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q), upv = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const D = 0.6, hh = D * Math.tan(THREE.MathUtils.degToRad((c.fov ?? 52) / 2)), hw = hh * (LW / LH);
      psGlobals.uLightDir.value.copy(fwd).multiplyScalar(-1).addScaledVector(upv, 0.6).normalize();
      psGlobals.uAmb.value.setRGB(0.45, 0.45, 0.5);
      const sc = (0.8 * 2 * hw) / tc.width;
      tc.root.position.copy(rc.position).addScaledVector(fwd, D).addScaledVector(upv, -0.62 * hh);
      tc.root.quaternion.copy(q); tc.root.scale.setScalar(sc * (1 + 0.04 * this.ctx.audio.hit('kick', t, 0.1)));
      tc.letters.forEach((l, i) => {
        const t0 = done + i * 0.025;
        const s = springStep(t - t0, 3.4, 0.42);
        l.visible = t >= t0; l.position.y = lerp(3, 0, clamp(s, 0, 1.3)); l.rotation.x = (1 - clamp(s)) * -1.2;
      });
      if (t < done + 0.1) this.shake(0.05);
    }
    // the title slams back in, with its asterisk; the room goes dark behind it
    if (t >= tTitle - 0.02) {
      const dark = ease.outCubic(prog(t, tTitle, tTitle + 0.25));
      this.fogColor = P.fog; this.fogNear = lerp(4, 0.6, dark); this.fogFar = lerp(15, 1.0, dark);
      this.begin(); this.drawHUD(t, 'done');
      const c = this.camAt(end - 0.2);
      const rc = new THREE.PerspectiveCamera(); this.pose(rc, c);
      const q = rc.quaternion;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q), upv = new THREE.Vector3(0, 1, 0).applyQuaternion(q), rgt = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const D = 0.5, hh = D * Math.tan(THREE.MathUtils.degToRad((c.fov ?? 52) / 2)), hw = hh * (LW / LH);
      // the card is lit from the viewer (a title screen), not by the room
      psGlobals.uLightDir.value.copy(fwd).multiplyScalar(-1).addScaledVector(upv, 0.6).normalize();
      psGlobals.uAmb.value.setRGB(0.45, 0.45, 0.5);
      const ti = this.title;
      ti.root.visible = true;
      const sc = (0.84 * 2 * hw) / ti.width;
      ti.root.position.copy(rc.position).addScaledVector(fwd, D).addScaledVector(upv, 0.12 * hh);
      ti.root.quaternion.copy(q); ti.root.scale.setScalar(sc);
      ti.letters.forEach((l, i) => {
        const t0 = tTitle + i * 0.03;
        const s = springStep(t - t0, 3.4, 0.45);
        l.visible = t >= t0; l.position.y = lerp(2.5, 0, clamp(s, 0, 1.3)); l.rotation.y = (1 - clamp(s)) * 1.5;
      });
      // the asterisk: small, up at the end of the title, landing last
      const st = this.star;
      const tS = tStar;
      st.root.visible = t >= tS;
      st.root.quaternion.copy(q); st.root.scale.setScalar(sc * 0.9);
      st.root.position.copy(ti.root.position).addScaledVector(rgt, ti.width * sc * 0.5 + 0.45 * sc).addScaledVector(upv, 0.6 * sc);
      st.letters[0]!.rotation.z = (1 - clamp(springStep(t - tS, 3, 0.4))) * 3;
      // "*for now" under it, in the robot's HUD voice
      const fn = this.forNow;
      fn.hang = { ref: end - 0.2, D: 0.5, x: 0.0, y: -0.32, frac: 0.44, yaw: 0, pitch: 0 };
      fn.open = clamp((t - tS - 0.15) / 0.12);
      fn.draw('fornow', (cc) => { uiBox(cc, 0, 0, 120, 28); pixText(cc, '*for now', 60 - textW('*for now', 2) / 2, 7, P.key2, 2, { shadow: P.uiEdge }); });
    }
  }
}
