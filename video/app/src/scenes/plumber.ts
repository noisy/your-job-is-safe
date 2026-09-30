// plumber (docs/TREATMENT.md row #22): "Fine! I'll be a plumber, gonna fix your sink, / AI can't hold a wrench, no
// matter what you think!" DEV (overalls, wrench) pops out of the cabinet under a kitchen sink (its doors open like
// the lid of the packing box the previous scene closed), fixes the faucet, laughs at the chatbot failing to hold a
// wrench, and strikes a hero pose on the long held "think!". Footnote: "train to be a plumber": Geoffrey Hinton,
// June 2025. Lyric idiom: every word is built out of copper pipe runs on the tiled wall, assembling itself just
// before it is sung, then water flows through it as it is sung. The doorbell at `splice` cuts to `robot`.
import * as THREE from 'three';
import type { Frame } from '../engine/scene';
import { Lyrics, type Line, type Word } from '../engine/lyrics';
import { clamp, lerp, ease, keys, springStep, prog, hash, frameIdx, type Key } from '../engine/util';
import { Ps1Stage, type CamState, type V3, uiBox } from '../ps1/stage';
import { makeDev, makeBotHead, type Dev, type BotHead } from '../ps1/cast';
import { psMat, pixText } from '../ps1/gfx';
import { P } from '../ps1/palette';
import { pipeWord, type PipeWord } from './plumber-pipes';
import { makeKitchen, COUNTER_H, WALL_Z, FRONT_Z } from './plumber-set';

type Placed = { w: Word; pipe: PipeWord; group: number };

export function makeWrench() {
  const g = new THREE.Group();
  const m = psMat({ color: '#B8C0D0' });
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.03), m); handle.position.y = 0.21;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.035), m); head.position.y = 0.45;
  const j1 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.035), m); j1.position.set(-0.06, 0.52, 0);
  const j2 = j1.clone(); j2.position.x = 0.06;
  g.add(handle, head, j1, j2);
  return g;
}

export default class Plumber extends Ps1Stage {
  dev!: Dev; bot!: BotHead;
  doorL = new THREE.Object3D(); doorR = new THREE.Object3D();
  wrench = makeWrench(); botWrench = makeWrench();
  drip!: THREE.Mesh;
  words: Placed[] = [];
  tail!: Placed | null;
  note = this.panel(200, 44);
  tailLine!: Line; P1!: Line; P2!: Line;
  db: number[] = [];
  groupEnd: number[] = [];
  kicks: number[] = [];

  override async init() {
    const { lyrics: ly, audio: au, start, end } = this.ctx;
    this.tailLine = ly.get("Now my job's not mine", 0);
    this.P1 = ly.get("Fine! I'll be a plumber", 0);
    this.P2 = ly.get("AI can't hold a wrench", 0);
    this.db = [start, ...au.downbeats.filter((d) => d > start + 0.1 && d < end - 0.1)];
    while (this.db.length < 8) this.db.push(this.db[this.db.length - 1]! + 1.39);
    this.kicks = au.events('kick', this.db[3]!, this.db[4]!).map((e) => e[0]);
    this.fogNear = 4; this.fogFar = 15;
    const k = makeKitchen(); this.world.add(k.root);
    this.doorL = k.doorL; this.doorR = k.doorR; this.drip = k.drip;
    this.dev = makeDev(); this.dev.outfit('overalls'); this.world.add(this.dev.root);
    this.wrench.position.set(0, -0.58, 0); this.wrench.rotation.x = -Math.PI / 2; this.dev.armR.add(this.wrench);
    this.bot = makeBotHead('v5.0'); this.bot.root.scale.setScalar(0.8); this.world.add(this.bot.root);
    this.world.add(this.botWrench);
    this.buildWords();
    this.note.inWorld(false);
  }

  // ------------------------------------------------------------------ pipe words on the wall
  private buildWords() {
    const P1 = this.P1.words, P2 = this.P2.words;
    // two rows per group, big and low on the wall (above the counter); the last line's tail stays up with "think!"
    const rows: { words: Word[]; y: number; em: number; group: number }[] = [
      { words: [P1[0]!, P1[1]!], y: 2.85, em: 0.72, group: 1 },
      { words: [P1[2]!, P1[3]!, P1[4]!], y: 2.0, em: 0.72, group: 1 },
      { words: [P1[5]!, P1[6]!], y: 2.85, em: 0.72, group: 2 },
      { words: [P1[7]!, P1[8]!], y: 2.0, em: 0.72, group: 2 },
      { words: [P2[0]!, P2[1]!], y: 2.85, em: 0.72, group: 3 },
      { words: [P2[2]!, P2[3]!, P2[4]!], y: 2.0, em: 0.72, group: 3 },
      { words: [P2[5]!, P2[6]!, P2[7]!, P2[8]!], y: 3.35, em: 0.62, group: 4 },
      { words: [P2[9]!], y: 1.95, em: 1.3, group: 5 },
    ];
    for (const r of rows) {
      const pipes = r.words.map((w) => pipeWord(w.w, r.em, r.em * (r.em > 1 ? 0.06 : 0.075), { pipe: '#A8551F', water: '#2F7BFF', head: '#8CC8FF' }));
      const space = r.em * 0.35;
      const total = pipes.reduce((a, p) => a + p.width, 0) + space * (pipes.length - 1);
      let x = -total / 2;
      pipes.forEach((p, i) => {
        p.mesh.position.set(x, r.y, WALL_Z + 0.08);
        this.world.add(p.mesh);
        this.words.push({ w: r.words[i]!, pipe: p, group: r.group });
        x += p.width + space;
      });
    }
    // the previous line's held "keep..." (inside the cabinet, draining away)
    const kw = this.tailLine.words[this.tailLine.words.length - 1]!;
    const kp = pipeWord(kw.w, 0.3, 0.02, { pipe: '#C0692B', water: '#3F8CFF' });
    kp.mesh.position.set(-kp.width / 2, 0.52, FRONT_Z + 0.08);
    this.world.add(kp.mesh);
    this.tail = { w: kw, pipe: kp, group: 0 };
    // a group is on the wall until the next group's first word is about to be built
    const first = (g: number) => this.words.find((p) => p.group === g)?.w.start ?? this.ctx.end + 1;
    // (never before the group's own last word has been sung)
    const lastEnd = (g: number) => Math.max(...this.words.filter((p) => p.group === g).map((p) => p.w.end));
    this.groupEnd = [0, ...[1, 2, 3].map((g) => Math.max(lastEnd(g) + 0.12, first(g + 1) - 0.4)), this.ctx.end + 1, this.ctx.end + 1];
  }

  // ------------------------------------------------------------------ camera
  camAt(t: number): CamState {
    const [d0, d1, d2, d3, d4, d5, d6, d7] = this.db as [number, number, number, number, number, number, number, number];
    const end = this.ctx.end;
    const kv = (ks: [number, V3, ((x: number) => number)?][]): V3 => [0, 1, 2].map((i) => keys(t, ks.map(([tt, v, e]) => [tt, v[i]!, e] as Key))) as V3;
    const fine = this.P1.words[0]!.start;
    if (t < d1) return {
      P: kv([[d0, [0.05, 0.72, -0.3]], [fine, [0.0, 0.8, 0.0], ease.linear], [fine + 0.35, [0.2, 1.6, 2.6], ease.outExpo], [d1, [0.3, 1.75, 3.0]]]),
      T: kv([[d0, [0, 0.62, -2.5]], [fine, [0, 0.65, -2.5]], [fine + 0.35, [0, 1.75, -2.6], ease.outExpo], [d1, [0, 1.85, -2.7]]]),
      roll: keys(t, [[d0, 0.04], [fine + 0.35, -0.03, ease.outExpo], [d1, 0]]), fov: 54,
    };
    if (t < d2) {
      const a = keys(t, [[d1, 0.55], [d2, -0.35, ease.inOutCubic]]);
      return { P: [Math.sin(a) * 4.4, 2.15, -2.6 + Math.cos(a) * 4.4], T: [0, 2.3, -2.8], roll: 0.03 * Math.sin(a * 3), fov: 56 };
    }
    if (t < d3) {
      const out = prog(t, this.P2.start - 0.1, d3, ease.inOutCubic);
      return {
        P: kv([[d2, [2.7, 2.2, 1.1]], [this.P2.start - 0.1, [2.4, 2.2, 0.8], ease.outCubic], [d3, [0.4, 2.15, 2.9], ease.inOutCubic]]),
        T: kv([[d2, [0.2, 2.3, -2.8]], [this.P2.start - 0.1, [0.3, 2.3, -2.8]], [d3, [0.0, 2.35, -2.8], ease.inOutCubic]]),
        roll: 0.06 * (1 - out), fov: 50,
      };
    }
    if (t < d4) {
      // the drum roll: a stepped push-in every other kick
      const ks = this.kicks.filter((_, i) => i % 2 === 0);
      const steps = ks.reduce((a, k) => a + prog(t, k, k + 0.06, ease.outExpo), 0);
      const n = Math.max(1, ks.length);
      const u = steps / n;
      return { P: [lerp(0.4, 0.15, u), lerp(2.15, 2.25, u), lerp(2.9, 1.3, u)], T: [0.0, 2.45, -2.8], roll: 0.025 * (Math.round(steps) % 2 ? 1 : -1) * (1 - u * 0.5), fov: 54 };
    }
    if (t < d5) return { P: kv([[d4, [1.1, 0.5, 1.6]], [d5, [0.7, 0.55, 1.2], ease.outCubic]]), T: [0, 2.3, -2.6], roll: -0.07, fov: 60 };
    if (t < d6) {
      const a = keys(t, [[d5, -1.0], [d6, 0.9, ease.inOutCubic]]);
      return { P: [Math.sin(a) * 4.0, 1.4, -2.2 + Math.cos(a) * 4.0], T: [0, 2.3, -2.6], roll: 0.04 * Math.sin(a), fov: 58 };
    }
    if (t < d7) return { P: kv([[d6, [0.4, 3.5, 2.8]], [d7, [0.1, 3.1, 2.1], ease.inOutCubic]]), T: [0, 1.9, -2.4], roll: 0, fov: 54 };
    return { P: kv([[d7, [-1.6, 1.5, 2.4]], [end, [-1.2, 1.55, 1.9], ease.inOutQuad]]), T: kv([[d7, [0.1, 2.2, -2.2]], [end, [0.4, 2.1, -2.0]]]), roll: 0.02, fov: 56 };
  }

  // ------------------------------------------------------------------ per-frame
  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t;
    this.begin();
    const [d0, d1, d2, d3, d4, d5, , d7] = this.db as [number, number, number, number, number, number, number, number];
    const dev = this.dev;
    const fine = this.P1.words[0]!;
    // the cabinet doors swing open on the first downbeat (the previous scene's box lid, opening)
    const open = clamp(springStep(t - d0 - 0.02, 1.6, 0.5), 0, 1.15);
    this.doorL.rotation.y = -1.9 * open; this.doorR.rotation.y = 1.9 * open;
    // DEV: crouched in the cabinet, pops out on "Fine!", fixes the faucet, laughs at the bot, the hero pose
    const pop = prog(t, fine.start - 0.05, fine.start + 0.3, ease.outCubic);
    dev.armL.rotation.set(0, 0, 0); dev.armR.rotation.set(0, 0, 0); dev.legL.rotation.set(0, 0, 0); dev.legR.rotation.set(0, 0, 0);
    dev.root.rotation.set(0, 0, 0); dev.head.rotation.set(0, 0, 0); dev.torso.rotation.set(0, 0, 0);
    this.bot.root.visible = false; this.botWrench.visible = false;
    if (t < d1) {
      dev.sit(pop < 0.5);
      const hop = Math.sin(pop * Math.PI) * 0.45;
      dev.root.position.set(lerp(0, 0.35, pop), lerp(-0.3, 0, pop) + hop, lerp(-2.65, -1.55, pop));
      dev.root.rotation.y = Math.PI;
      dev.armR.rotation.x = lerp(1.2, 2.8, pop); dev.armL.rotation.z = -0.4 * pop;
      dev.setFace(pop > 0 ? 'yell' : 'smug');
    } else if (t < d2) {
      dev.sit(false);
      dev.root.position.set(0, 0, -1.95);
      const beat = this.ctx.audio.beatAt(t);
      dev.armR.rotation.x = 2.3 + 0.15 * Math.sin(beat * Math.PI * 2); dev.armL.rotation.x = 2.0;
      dev.armR.rotation.y = 0.4 * Math.sin(beat * Math.PI);
      dev.setFace('smug');
    } else if (t < d4) {
      dev.sit(false);
      dev.root.position.set(-0.3, 0, -1.7);
      dev.root.rotation.y = t < d3 ? -0.9 : Math.PI;
      const laugh = t < d3 ? Math.sin(t * 22) * 0.06 : 0.05 * this.ctx.audio.hit('kick', t, 0.05);
      dev.torso.rotation.x = laugh; dev.armL.rotation.x = t < d3 ? 1.6 : 0; dev.armR.rotation.x = t < d3 ? 0.2 : 2.9;
      dev.armL.rotation.z = t < d3 ? 0 : -0.7;
      dev.setFace(t < d3 ? 'laugh' : 'smug');
      if (t < d3) {
        // the chatbot tries to hold a wrench: it has no hands
        this.bot.root.visible = true; this.botWrench.visible = true;
        this.bot.root.position.set(1.05, COUNTER_H + 0.07, -2.62); this.bot.root.rotation.y = -0.35;
        const slip = prog(t, this.P2.words[0]!.start, this.P2.words[0]!.end, ease.inQuad);
        this.botWrench.position.set(0.72 + 0.1 * slip, COUNTER_H + 0.45 - 0.42 * slip, -2.4);
        this.botWrench.rotation.set(0, 0, 0.3 + 1.3 * slip);
        this.bot.setFace(slip > 0.8 ? 'error' : slip > 0 ? 'wrong' : 'focused');
      }
    } else {
      // the hero pose on "think!": wrench raised, fist on the hip, legs apart
      dev.sit(false);
      dev.root.position.set(0, 0, -1.8); dev.root.rotation.y = Math.PI;
      const raise = prog(t, d4, this.P2.words[9]!.start + 0.1, ease.outBack);
      dev.armR.rotation.x = lerp(0.3, 3.0, raise); dev.armR.rotation.z = 0.25 * raise;
      dev.armL.rotation.z = -0.8 * raise; dev.armL.rotation.x = -0.4 * raise;
      dev.legL.rotation.z = -0.18 * raise; dev.legR.rotation.z = 0.18 * raise;
      dev.torso.rotation.x = -0.05 * raise;
      dev.setFace('smug');
      // at the very end he hears the doorbell and turns to it, still pleased with himself (the shock comes at the door)
      const turn = prog(t, this.ctx.end - 0.45, this.ctx.end - 0.15, ease.inOutCubic);
      dev.head.rotation.y = -1.1 * turn;
    }
    // the faucet drips until he fixes it on "sink,"
    const fixed = t >= this.P1.words[8]!.start;
    const dt = (t * 1.8) % 1;
    this.drip.visible = !fixed && t >= d0;
    this.drip.position.y = COUNTER_H + 0.33 - dt * 0.25;

    this.animWords(t);
    this.drawNote(t);
    void d5; void d7;
    return this.present(f, out);
  }

  private animWords(t: number) {
    for (const p of [...this.words, ...(this.tail ? [this.tail] : [])]) {
      const u = p.pipe.mat.uniforms;
      const { w, group } = p;
      if (group === 0) {
        // "keep..." (held from the previous line): already built, draining out as the note ends
        u.uBuild!.value = 1 - prog(t, this.db[0]! + 0.05, this.db[0]! + 0.3);
        u.uFlow!.value = 1 - Lyrics.wordProgress(w, t);
        p.pipe.mesh.visible = u.uBuild!.value > 0.001;
        continue;
      }
      const gStart = this.words.find((q) => q.group === group)!.w.start - 0.4;
      const gEnd = this.groupEnd[group]!;
      const build = prog(t, w.start - 0.2, w.start - 0.06, ease.outCubic);
      // a finished group leaves at once (a half-dismantled word would read as a different word)
      u.uBuild!.value = t < gEnd ? build : 0;
      u.uFlow!.value = Lyrics.wordProgress(w, t);
      p.pipe.mesh.visible = t >= gStart && t < gEnd && u.uBuild!.value > 0.001;
    }
  }

  /** The footnote, pinned to the cabinet side like a note (readable in the opening shots). */
  private drawNote(t: number) {
    const n = this.note;
    const a = this.db[0]! + 0.35, b = this.P1.words[5]!.start;
    n.open = t >= a && t < b ? clamp((t - a) / 0.12) * (1 - clamp((t - (b - 0.12)) / 0.12)) : 0;
    n.hang = { ref: this.db[0]! + 1.25, D: 1.6, x: -0.3, y: 0.42, frac: 0.42, yaw: 0.25, pitch: 0.08 };
    n.draw('note', (c) => {
      uiBox(c, 0, 0, 200, 44);
      pixText(c, '"train to be a plumber":', 8, 9, P.uiLine, 1, { shadow: P.uiEdge });
      pixText(c, 'Geoffrey Hinton,', 8, 20, P.key2, 1, { shadow: P.uiEdge });
      pixText(c, 'June 2025', 8, 31, P.uiDim, 1, { shadow: P.uiEdge });
    });
    void hash; void frameIdx;
  }
}
