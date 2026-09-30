// Verse 1, lines 4–6: "Drew a hand with extra fingers - what a goof! / Then the Fresh Prince got jiggy with a
// plate of spaghetti, / Face melting in the sauce, fork flying like confetti,"
// Opens inside DEV's CRT (the IM reply "show me the proof" is sent); the chatbot's image generator
// (img gen v1.0) renders a hand top to bottom and a giant six-fingered hand rises out of the screen into
// the room, its fingers counted 1…6 in fail red; DEV points and laughs. Then the 2023 AI-video nightmare,
// restaged in a diner: an original low-poly guy (a plain-text caption names the meme), noodles
// teleporting, the fork fused to his hand, his face melting into the sauce, forks flying like confetti.
// Lyric idioms: line 1 is glyph-wiped by the generator's render scanline; lines 2–3 ride along a noodle.
import * as THREE from 'three';
import type { Frame, PostOverrides } from '../engine/scene';
import type { Line } from '../engine/lyrics';
import { clamp, lerp, ease, prog, springStep, pulse, hash, frameIdx, keys, type Key } from '../engine/util';
import { Ps1Stage, windowOpen, uiBox, uiTab, type CamState, type V3, type Panel } from '../ps1/stage';
import { makeRoom, makeDev, type Room, type Dev } from '../ps1/cast';
import { ADV, pixText, textW, psMat } from '../ps1/gfx';
import { P } from '../ps1/palette';
import { imChars } from './v1-desk-ui';
import { SCREEN_FILL, drawImScreen } from './v1-desk';
import { RidingText } from './v1-hand-spaghetti-noodle';
import { makeDiner, makeDinerSet, type Diner } from './v1-hand-spaghetti-diner';

const DX = 40; // the diner set lives far from DEV's room
const SKIN_AI = '#E6B99A';
const CAPW = 240, CAPH = 80;

export default class V1HandSpaghetti extends Ps1Stage {
  room!: Room; dev!: Dev;
  hand = new THREE.Group(); digits: { piv: THREE.Object3D; tip: THREE.Object3D }[] = [];
  countLabels: THREE.Mesh[] = [];
  diner!: Diner;
  noodleA!: RidingText; noodleB!: RidingText; noodleC!: RidingText;
  whip!: THREE.Mesh;
  forks: THREE.Group[] = [];
  confetti!: ReturnType<Ps1Stage['dustBurst']>;
  caption!: Panel;
  capLabel!: THREE.Mesh;
  D: number[] = []; K: number[] = [];
  L3!: Line; L4!: Line; L5!: Line; L6!: Line;
  im!: ReturnType<typeof imChars>;
  counts: number[] = [];
  sentAt = 0; genAt = 0;
  screenKey = '';
  probe = new THREE.PerspectiveCamera(52, 16 / 9, 0.05, 80);

  override async init() {
    const { audio: au, lyrics: ly, start, end } = this.ctx;
    this.fogNear = 3.5; this.fogFar = 12;
    this.L3 = ly.get('try the robot'); this.L4 = ly.get('Drew a hand'); this.L5 = ly.get('Fresh Prince'); this.L6 = ly.get('Face melting');
    this.D = au.downbeats.filter((d) => d >= start - 0.02 && d <= end + 0.02);
    this.K = au.events('kick', start, end).map((e) => e[0]);
    this.im = imChars(this.L3);
    const proof = this.L3.words[11]!;
    this.sentAt = this.K.find((k) => k > proof.end - 0.02) ?? proof.end + 0.1;
    this.genAt = this.sentAt + 0.06;
    const extra = this.L4.words[4]!;
    const b0 = Math.round(au.beatAt(extra.start));
    this.counts = [0, 1, 2, 3, 4, 5].map((k) => au.timeOfBeat(b0 + k * 0.5));

    // DEV's room (the hand rises out of his CRT)
    this.room = makeRoom();
    this.world.add(this.room.root);
    this.dev = makeDev(); this.dev.sit(true); this.dev.root.position.copy(this.room.seat);
    this.world.add(this.dev.root);
    this.buildHand();
    this.counts.forEach((_, i) => { const l = this.label(String(i + 1), P.uiLine, P.fail, 2, 1 / 70); l.visible = false; this.countLabels.push(l); });

    // the diner
    const set = makeDinerSet(); set.position.x = DX; this.world.add(set);
    this.diner = makeDiner(); this.diner.root.position.set(DX, 0, 0); this.world.add(this.diner.root);
    this.capLabel = this.label('"Will Smith eating spaghetti" (2023)', P.uiLine, P.uiNavy, 1, 1 / 190);
    for (let i = 0; i < 10; i++) {
      const f = this.diner.fork.clone(); f.visible = false; this.world.add(f); this.forks.push(f);
    }
    this.confetti = this.dustBurst(26, P.key2, 0.035);
    const conf2 = this.confetti.group.children;
    conf2.forEach((m, i) => { if (i % 3 === 1) (m as THREE.Mesh).material = psMat({ color: P.fail, unlit: true }); if (i % 3 === 2) (m as THREE.Mesh).material = psMat({ color: P.bot, unlit: true }); });

    // the noodles the words ride
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const w5 = this.L5.words, w6 = this.L6.words;
    const key5 = (w: { w: string }) => (/spaghetti/.test(w.w) ? 1 : /Prince|Fresh/.test(w.w) ? 1 : 0) as 0 | 1;
    // A: out of DEV's CRT toward the camera ("Then the")
    this.noodleA = new RidingText([V(-0.42, 1.2, -2.55), V(-0.12, 1.14, -2.78), V(0.18, 1.19, -3.0), V(0.48, 1.13, -3.22), V(0.7, 1.17, -3.4)], w5.slice(0, 2), { size: 0.055, spacing: 0.04, lift: 0.035, radius: 0.008, start: 0.36 });
    // B: across the diner in front of the guy
    this.noodleB = new RidingText([V(DX - 1.6, 1.24, 1.0), V(DX - 0.8, 1.36, 1.03), V(DX, 1.27, 1.0), V(DX + 0.8, 1.38, 0.98), V(DX + 1.6, 1.28, 0.95), V(DX + 2.4, 1.4, 0.9), V(DX + 3.0, 1.3, 0.86)], w5, { ink: key5, start: 0.1, size: 0.1, spacing: 0.072, lift: 0.07, radius: 0.016 });
    // C: round the melting face, then out past the lens (the whip)
    this.noodleC = new RidingText([V(DX - 1.3, 1.2, 0.78), V(DX - 0.5, 1.28, 0.8), V(DX + 0.3, 1.2, 0.8), V(DX + 1.1, 1.3, 0.78), V(DX + 1.9, 1.18, 0.8), V(DX + 2.6, 1.26, 0.82), V(DX + 3.1, 1.16, 0.86)], w6, { ink: (w) => (/melting|sauce|fork/.test(w.w) ? 2 : 0), start: 0.1, size: 0.1, spacing: 0.072, lift: 0.07, radius: 0.016 });
    this.world.add(this.noodleA.group, this.noodleB.group, this.noodleC.group);
    this.whip = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(-1, 0, 0), V(-0.3, 0.12, 0), V(0.3, -0.1, 0), V(1, 0.05, 0)]), 20, 0.045, 5, false), psMat({ color: '#E8C872' }));
    this.world.add(this.whip);

    this.caption = this.panel(CAPW, CAPH);
  }

  private buildHand() {
    const skin = psMat({ color: SKIN_AI }), nail = psMat({ color: '#F3D3C3' });
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.58, 0.16), skin); palm.position.y = 0.29;
    this.hand.add(palm);
    const wrist = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.14), skin); wrist.position.y = -0.12; this.hand.add(wrist);
    // six digits: a thumb and five fingers (one too many)
    const digit = (x: number, y: number, len: number, ang: number) => {
      const piv = new THREE.Object3D(); piv.position.set(x, y, 0); piv.rotation.z = ang;
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.085, len * 0.55, 0.1), skin); a.position.y = len * 0.275;
      const mid = new THREE.Object3D(); mid.position.y = len * 0.55;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.078, len * 0.45, 0.09), skin); b.position.y = len * 0.225;
      const n = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.02), nail); n.position.set(0, len * 0.38, 0.05);
      const tip = new THREE.Object3D(); tip.position.y = len * 0.5;
      mid.add(b, n, tip); piv.add(a, mid);
      this.hand.add(piv);
      this.digits.push({ piv: mid, tip });
    };
    digit(-0.3, 0.18, 0.34, 0.85); // thumb
    [0.4, 0.46, 0.49, 0.45, 0.38].forEach((len, i) => digit(-0.21 + i * 0.105, 0.58, len, (i - 2) * -0.07));
    this.hand.visible = false;
    this.world.add(this.hand);
  }

  // ---------------------------------------------------------------- camera

  camAt(t: number): CamState {
    const [d0, d1, d2, d3, d4, d5, d6] = this.D as [number, number, number, number, number, number, number];
    const kv = (ks: [number, V3, ((x: number) => number)?][]): V3 => [0, 1, 2].map((i) => keys(t, ks.map(([tt, v, e]) => [tt, v[i]!, e] as Key))) as V3;
    const wThen = this.L5.words[0]!;
    if (t < d1) {
      // inside the CRT (continuing v1-desk's dive), then out a little as the generator renders
      const back = prog(t, this.genAt, d1, ease.inOutCubic);
      return { P: [0.18 * back, 1.08 + 0.05 * back, -2.9 + 0.5 * back], T: [0.05 * back, 1.08 + 0.06 * back, -3.205], roll: -0.04 * back, fov: 52 };
    }
    if (t < d2) {
      // the hand rises out of the screen: low behind DEV's right shoulder, looking up; a step in per count
      const steps = this.counts.reduce((a, c) => a + prog(t, c, c + 0.08, ease.outExpo), 0);
      return {
        P: kv([[d1, [2.1, 1.2, 0.5]], [this.counts[0]!, [1.9, 1.3, 0.25], ease.outCubic], [d2, [1.7, 1.4, 0.0], ease.inOutCubic]]).map((v, i) => v - [0.04, -0.01, 0.06][i]! * steps) as V3,
        T: kv([[d1, [-0.1, 1.4, -3.0]], [this.counts[0]!, [-0.1, 1.95, -2.95], ease.outCubic], [d2, [-0.1, 2.0, -2.95]]]),
        roll: 0.06 - 0.01 * steps, fov: 54,
      };
    }
    if (t < wThen.start - 0.02) {
      // DEV turns to camera, points back up at the hand and laughs
      const u = ease.inOutCubic(prog(t, d2, wThen.start));
      return { P: [lerp(1.35, 1.2, u), lerp(1.45, 1.55, u), lerp(-1.7, -1.9, u)], T: [lerp(0.1, 0.0, u), lerp(1.55, 1.75, u), -2.7], roll: lerp(-0.05, 0.03, u), fov: 50 };
    }
    if (t < d3) {
      // "Then the": a noodle shoots out of the screen; whip after it and dive back into the CRT
      const u = prog(t, wThen.start - 0.02, d3, ease.inOutCubic);
      // round DEV's head (clear of it on the right), then straight into the screen
      const Pw: V3 = [1.2, 1.55, -1.9], Pm: V3 = [0.42, 1.4, -2.72];
      const a = ease.inOutQuad(clamp(u / 0.6)), b = ease.inQuad(clamp((u - 0.6) / 0.4));
      const Pa: V3 = [lerp(Pw[0], Pm[0], a), lerp(Pw[1], Pm[1], a), lerp(Pw[2], Pm[2], a)];
      return {
        P: [lerp(Pa[0], SCREEN_FILL.P[0], b), lerp(Pa[1], SCREEN_FILL.P[1], b), lerp(Pa[2], SCREEN_FILL.P[2], b)],
        T: [lerp(0.1, 0, u), lerp(1.12, 1.08, u), -3.2], roll: lerp(0.08, 0, u), fov: 52,
      };
    }
    if (t < d4) {
      // the diner: out of the video frame, then a truck right along the noodle as the words ride it
      const u = ease.inOutQuad(prog(t, d3 + 0.25, d4));
      const out = ease.outExpo(prog(t, d3, d3 + 0.4));
      return {
        P: [DX + lerp(-0.85, 1.3, u), lerp(1.3, 1.36, out), lerp(1.5, 2.2, out)],
        T: [DX + lerp(-0.75, 1.2, u), 1.2, lerp(0.9, 0.55, out)], roll: lerp(0.05, -0.03, u), fov: 50,
      };
    }
    if (t < d5) {
      // the plate (noodles teleporting between frames), then up to the face as it starts to melt
      const face = prog(t, this.L6.words[0]!.start - 0.2, d5, ease.inOutCubic);
      return {
        P: [DX + lerp(2.4, -0.45, face), lerp(1.45, 1.55, face), lerp(2.25, 2.1, face)],
        T: [DX + lerp(2.0, -0.4, face), lerp(1.1, 1.38, face), lerp(0.6, 0.4, face)], roll: lerp(-0.06, 0.02, face), fov: 50,
      };
    }
    // the melt, then a truck right with "fork flying" as the forks go up like confetti
    const u = ease.inOutQuad(prog(t, d5, d6));
    const kick = this.K.filter((k) => k > d5 && k < d6).reduce((a, k) => a + prog(t, k, k + 0.08, ease.outExpo), 0);
    return { P: [DX + lerp(-0.35, 2.0, u), 1.55, 2.1 - 0.05 * kick], T: [DX + lerp(-0.25, 1.9, u), 1.38, 0.45], roll: lerp(0.02, -0.06, u), fov: 50 };
  }

  // ---------------------------------------------------------------- render

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    this.begin();
    const t = f.t;
    const [d0, d1, d2, d3, d4, d5, d6] = this.D as [number, number, number, number, number, number, number];
    const inDiner = t >= d3;
    this.fogColor = inDiner ? '#1E1A24' : P.fog;
    if (inDiner) { this.fogNear = 3; this.fogFar = 9; } else { this.fogNear = 3.5; this.fogFar = 12; }
    this.begin();
    const w4 = this.L4.words, w5 = this.L5.words, w6 = this.L6.words;

    // ---- DEV
    const dev = this.dev;
    const laughA = w4[6]!.start - 0.1;
    const turn = ease.inOutCubic(prog(t, d2 - 0.1, d2 + 0.25));
    dev.root.rotation.y = -1.25 * turn;
    const lookUp = prog(t, d1, d1 + 0.4, ease.outCubic) * (1 - turn);
    dev.head.rotation.x = -0.5 * lookUp + 0.12 * (1 - lookUp);
    const laugh = t >= laughA && t < w5[0]!.start;
    dev.setFace(laugh ? 'laugh' : t >= d1 ? 'shock' : 'neutral');
    if (t >= d1 && t < d1 + 0.5) dev.setFace('shock');
    if (t >= this.counts[3]! && !laugh && t < d2) dev.setFace('smug');
    const bob = laugh ? Math.abs(Math.sin((t - laughA) * 14)) : 0;
    dev.torso.rotation.x = -0.12 * bob;
    dev.armL.rotation.set(turn > 0.5 ? 0.3 : 1.28, 0, turn > 0.5 ? -2.5 : 0.18);
    dev.armR.rotation.set(1.28 - 0.6 * bob, 0, -0.18);

    // ---- the CRT screen: the IM (sent), then img gen v1.0 rendering, then vid gen playing
    const scanU = prog(t, w4[0]!.start - 0.05, w4[5]!.start, ease.linear);
    const sk = t < this.genAt ? `im${Math.floor(t * 30)}${t >= this.sentAt}` : t < w5[0]!.start - 0.1 ? `gen${Math.floor(scanU * 40)}` : `vid${frameIdx(t) >> 2}`;
    if (sk !== this.screenKey) {
      this.screenKey = sk;
      const c = this.room.screen.ctx;
      if (t < this.genAt) drawImScreen(c, this.im, t, t >= this.sentAt);
      else if (t < w5[0]!.start - 0.1) drawGenScreen(c, scanU);
      else drawVidScreen(c, t);
      this.room.screen.tex.needsUpdate = true;
    }

    // ---- the giant hand: out of the screen on the downbeat, rising over the desk
    const rise = (t < d1 ? 0 : springStep(t - d1, 1.6, 0.55)) * (1 - prog(t, w5[0]!.start - 0.25, w5[0]!.start + 0.05, ease.inCubic));
    this.hand.visible = t >= d1 && t < w5[0]!.start + 0.05;
    this.hand.position.set(0, lerp(1.08, 1.5, clamp(rise, 0, 1.2)), lerp(-3.2, -2.95, clamp(rise)));
    this.hand.scale.setScalar(lerp(0.12, 1.5, clamp(rise, 0, 1.15)));
    this.hand.rotation.set(-0.15, 0.12 * Math.sin(t * 1.3), 0.06 * Math.sin(t * 2.1));
    // the fingers wriggle (a little too much); each counted digit jumps
    this.digits.forEach((d, i) => {
      const c = this.counts[i]!;
      d.piv.rotation.x = 0.25 * Math.sin(t * 5 + i * 1.9) + (t >= c ? -0.35 * pulse(t, c, 0.08) : 0);
    });
    this.world.updateMatrixWorld(true);
    this.countLabels.forEach((l, i) => {
      const c = this.counts[i]!;
      l.visible = this.hand.visible && t >= c;
      if (!l.visible) return;
      this.digits[i]!.tip.getWorldPosition(l.position);
      l.position.z += 0.15; l.position.y += 0.1;
      l.scale.setScalar(clamp(springStep(t - c, 4, 0.4), 0, 1.25) * (i === 5 ? 1.35 : 1));
    });

    // ---- the diner guy
    const dn = this.diner;
    this.capLabel.visible = inDiner;
    this.capLabel.position.set(DX + lerp(-0.6, 0.9, prog(t, d3, d4)), 0.98, 1.35);
    const chew = Math.sin(t * 9);
    const fly = w6[5]!.start;
    dn.armR.rotation.set(-1.1 - 0.5 * Math.max(0, Math.sin(t * 4.3)), 0, 0.15);
    dn.armL.rotation.set(-0.5, 0, -0.1);
    dn.head.rotation.set(0.05 * chew, 0.15 * Math.sin(t * 1.7), 0);
    dn.melt(prog(t, w6[0]!.start, w6[4]!.end, ease.inOutQuad) + 0.12 * Math.max(0, chew) * (t > d3 ? 1 : 0) * 0.3, t);
    // the fork fused to the hand stretches like taffy, then flies off with the others
    dn.fuse.scale.y = 1 + 1.6 * prog(t, d4, w6[5]!.start, ease.inOutQuad);
    dn.fork.visible = t < fly;
    // noodles teleporting between frames (a new place every few output frames)
    const hop = frameIdx(t) >> 2;
    dn.strands.forEach((s, i) => {
      const h = hash(hop, i, 5);
      const mode = h < 0.55 ? 0 : h < 0.8 ? 1 : 2;
      s.position.set(mode === 0 ? 0 : (hash(hop, i, 6) - 0.5) * 0.5, mode === 0 ? 0 : mode === 1 ? 0.45 + hash(hop, i, 7) * 0.4 : 0.3, mode === 2 ? -0.35 : (hash(hop, i, 8) - 0.5) * 0.3);
      s.rotation.y = hash(hop, i, 9) * 6;
    });
    // forks flying like confetti
    this.forks.forEach((fk, i) => {
      const u = t - fly - i * 0.03;
      fk.visible = u > 0;
      if (!fk.visible) return;
      const a = hash(i, 11) * Math.PI * 2, sp = 1.2 + hash(i, 12) * 1.5;
      fk.position.set(DX + 0.4 + Math.cos(a) * sp * u, 1.3 + 2.4 * u - 3.2 * u * u + Math.sin(a) * 0.3, 0.3 + Math.sin(a) * sp * u * 0.6 + 0.6 * u);
      fk.rotation.set(u * 9 + i, u * 7, u * 11);
    });
    this.confetti.update(t, fly, [DX + 0.4, 1.3, 0.4], 0.2, 1.6);

    // ---- the words on the noodles (they face this frame's camera)
    this.pose(this.probe, this.camAt(t));
    this.noodleA.group.visible = t >= w5[0]!.start - 0.05 && t < d3;
    this.noodleB.group.visible = inDiner && t < d5 + 0.1;
    this.noodleC.group.visible = t >= d4 && t >= w6[0]!.start - 0.3;
    if (this.noodleA.group.visible) this.noodleA.update(t, this.probe);
    if (this.noodleB.group.visible) this.noodleB.update(t, this.probe, -0.2 * prog(t, w5[10]!.end, d5 + 0.1));
    if (this.noodleC.group.visible) this.noodleC.update(t, this.probe);
    // the noodle whips across the lens at the end (→ grandma's yarn)
    const wu = prog(t, d6 - 0.16, d6, ease.inQuad);
    this.whip.visible = t >= d6 - 0.16;
    if (this.whip.visible) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.probe.quaternion);
      this.whip.position.copy(this.probe.position).addScaledVector(fwd, 0.35).add(new THREE.Vector3(lerp(0.6, -0.1, wu), -0.02, 0).applyQuaternion(this.probe.quaternion));
      this.whip.quaternion.copy(this.probe.quaternion);
      this.whip.scale.set(0.4, 1, 1);
    }

    // ---- the generator's caption: line 1 glyph-wiped by the render scanline
    const capA = w4[0]!.start - 0.12, capB = w5[0]!.start - 0.05;
    this.caption.open = windowOpen(t, capA, capB, 0.12);
    this.caption.hang = t < d1 ? { ref: d1 - 0.05, x: 0.0, y: -0.52, frac: 0.7, yaw: 0.12, pitch: -0.1, D: 0.45 }
      : t < d2 ? { ref: d1 + 0.5, x: -0.1, y: -0.55, frac: 0.7, yaw: -0.2, pitch: -0.14, D: 0.6, follow: 0.03 }
        : { ref: d2 + 0.2, x: -0.1, y: -0.55, frac: 0.7, yaw: 0.22, pitch: -0.12, D: 0.6, follow: 0.03 };
    if (this.caption.open > 0) {
      const k = captionKey(this.L4, t);
      this.caption.draw(k, (c) => drawCaption(c, this.L4, t));
    }
    if (t >= d4 - 0.02 && t < d4 + 0.06) this.shake(0.02);
    void d0;
    return this.present(f, out);
  }
}

// ---------------------------------------------------------------- the generator's caption (glyph wipe)

const ROWS4 = [[0, 1, 2, 3], [4, 5], [6, 7, 8]];
function wipeOf(w: { start: number; end: number }, t: number) { return clamp((t - w.start) / Math.max(0.12, Math.min(0.32, (w.end - w.start) * 0.9))); }
function captionKey(L: Line, t: number) { return L.words.map((w) => Math.round(wipeOf(w, t) * 8)).join(','); }
function drawCaption(c: CanvasRenderingContext2D, L: Line, t: number) {
  uiBox(c, 0, 8, CAPW, CAPH - 8);
  uiTab(c, 8, 0, 'img gen v1.0 · output', '#2E4A8C');
  ROWS4.forEach((row, ri) => {
    let x = 10;
    const y = 18 + ri * 19;
    row.forEach((wi, k) => {
      const w = L.words[wi]!;
      const txt = ri === 1 && k === 1 ? `${w.w} -` : w.w;
      const u = wipeOf(w, t);
      const rows = Math.round(u * 8);
      if (rows > 0) {
        c.save();
        c.beginPath(); c.rect(x - 1, y - 1, textW(txt, 2) + 4, rows * 2 + 1); c.clip();
        const col = /fingers/.test(w.w) ? P.fail : /goof/.test(w.w) ? P.key2 : P.uiLine;
        pixText(c, txt, x, y, col, 2, { shadow: P.uiEdge });
        c.restore();
        if (u < 1) { c.fillStyle = P.bot; c.fillRect(x - 2, y + rows * 2 - 1, textW(txt, 2) + 5, 1); }
      }
      x += (Array.from(txt).length + 1) * ADV * 2;
    });
  });
}

// ---------------------------------------------------------------- the CRT (128x96)

function drawGenScreen(c: CanvasRenderingContext2D, u: number) {
  c.fillStyle = '#10162A'; c.fillRect(0, 0, 128, 96);
  c.fillStyle = '#2E4A8C'; c.fillRect(0, 0, 128, 10);
  pixText(c, 'img gen v1.0', 3, 2, P.uiLine);
  pixText(c, '> a hand', 4, 13, P.uiLine);
  // the render: a six-fingered hand, revealed top to bottom by the scanline
  const ix = 24, iy = 24, iw = 80, ih = 66;
  c.fillStyle = '#1B2A55'; c.fillRect(ix, iy, iw, ih);
  const img = document.createElement('canvas'); img.width = iw; img.height = ih;
  const g = img.getContext('2d')!;
  g.fillStyle = '#2A3C5E'; g.fillRect(0, 0, iw, ih);
  g.fillStyle = SKIN_AI;
  g.fillRect(24, 34, 32, 26); g.fillRect(28, 58, 24, 8);
  [[26, 12], [32, 8], [38, 6], [44, 8], [50, 12]].forEach(([x, y]) => g.fillRect(x!, y!, 5, 26));
  g.fillRect(14, 36, 12, 5); g.fillRect(10, 32, 6, 6);
  const rows = Math.floor(u * ih);
  c.drawImage(img, 0, 0, iw, rows, ix, iy, iw, rows);
  if (u < 1) { c.fillStyle = P.bot; c.fillRect(ix, iy + rows, iw, 1); }
  pixText(c, `${Math.floor(u * 100)}%`, 4, 86, P.uiDim);
  c.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 1; y < 96; y += 2) c.fillRect(0, y, 128, 1);
}

function drawVidScreen(c: CanvasRenderingContext2D, t: number) {
  c.fillStyle = '#10162A'; c.fillRect(0, 0, 128, 96);
  c.fillStyle = '#2E4A8C'; c.fillRect(0, 0, 128, 10);
  pixText(c, 'vid gen v1.0', 3, 2, P.uiLine);
  // a smeary preview of the diner: the teal wall, the red booth, an orange shirt, a face that won't hold
  c.fillStyle = '#3E8C86'; c.fillRect(4, 12, 120, 40);
  c.fillStyle = '#E8E4D8'; c.fillRect(4, 52, 120, 30);
  c.fillStyle = '#B8322E'; c.fillRect(20, 44, 88, 20);
  c.fillStyle = '#D98A3A'; c.fillRect(46, 50, 36, 26);
  const j = (frameIdx(t) >> 2) % 3;
  c.fillStyle = '#9C6B4E'; c.fillRect(52 + j, 28, 24, 22 + j * 3);
  c.fillStyle = '#E8C872'; for (let i = 0; i < 6; i++) c.fillRect(40 + ((i * 17 + j * 23) % 50), 60 + ((i * 7 + j * 11) % 18), 12, 2);
  pixText(c, '▶ 0:0' + (j + 1), 4, 86, P.uiLine);
  c.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 1; y < 96; y += 2) c.fillRect(0, y, 128, 1);
}
