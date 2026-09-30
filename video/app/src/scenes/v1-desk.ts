// Verse 1, lines 1–3: DEV's room at night. "I write my code by hand, every semicolon mine, / Twenty years
// of tabs, never spaces - by design, / They said "try the robot, bro", I said "show me the proof","
// Lyric idiom: per-character typing into the code editor (a window hung by the CRT, mirrored on the CRT
// itself): syntax colours, → tab marks, a blinking caret; every character is a key press on the keyboard.
// The coworker's "try the robot, bro" arrives as an IM popup with the chatbot's v1.0 icon; DEV types his
// reply and the camera dives into the CRT (→ v1-hand-spaghetti opens inside the screen).
import * as THREE from 'three';
import type { Frame, PostOverrides } from '../engine/scene';
import type { Line } from '../engine/lyrics';
import { clamp, lerp, ease, prog, springStep, pulse, keys, type Key } from '../engine/util';
import { Ps1Stage, windowOpen, type CamState, type V3, type Panel } from '../ps1/stage';
import { makeRoom, makeDev, type Room, type Dev } from '../ps1/cast';
import { pixText, psMat, canvasTex } from '../ps1/gfx';
import { P } from '../ps1/palette';
import { editorRows, allChars, drawEditorWindow, editorKey, drawEditorScreen, imChars, drawIM, imKey, EDW, EDH, IMW, IMH, type Row } from './v1-desk-ui';

const KB = { x: 0, y: 0.8, z: -2.98, pitch: 0.043, key: 0.036 };
const ROWS = ['`1234567890-=', "\tqwertyuiop[]", "^asdfghjkl;'\n", '<zxcvbnm,./>'];
/** The CRT screen's centre (makeRoom) and a camera pose that fills the frame with it. */
export const SCREEN: V3 = [0, 1.08, -3.205];
export const SCREEN_FILL: CamState = { P: [0, 1.08, -2.9], T: [0, 1.08, -3.205], fov: 52 };

interface Key3 { mesh: THREE.Group; x: number; z: number; presses: number[] }

export default class V1Desk extends Ps1Stage {
  room!: Room;
  dev!: Dev;
  keys: Key3[] = [];
  keyOf = new Map<string, number>();
  rows!: Row[];
  im!: ReturnType<typeof imChars>;
  editor!: Panel;
  imPanel!: Panel;
  semi!: THREE.Group; tab!: THREE.Group;
  D: number[] = [];
  K: number[] = [];
  L1!: Line; L2!: Line; L3!: Line;
  kickSemi = 0;
  screenKey = '';

  override async init() {
    const { audio: au, lyrics: ly, start, end } = this.ctx;
    this.fogNear = 3.5; this.fogFar = 11;
    this.L1 = ly.get('I write my code'); this.L2 = ly.get('Twenty years of tabs'); this.L3 = ly.get('try the robot');
    this.D = au.downbeats.filter((d) => d >= start - 0.02 && d <= end + 0.02);
    this.K = au.events('kick', start, end).map((e) => e[0]);
    // the last ';' of "mine;" lands on the first kick after "mine" starts
    this.kickSemi = this.K.find((k) => k > this.L1.words[8]!.start) ?? this.L1.words[8]!.end;
    this.rows = editorRows(this.L1, this.L2, this.L3, this.kickSemi);
    this.im = imChars(this.L3);

    // without the room's plain keyboard and mug: this scene builds detailed ones
    this.room = makeRoom({ props: false });
    this.world.add(this.room.root);
    this.dev = makeDev();
    this.dev.sit(true);
    this.dev.root.position.copy(this.room.seat);
    this.world.add(this.dev.root);
    this.buildKeyboard();
    this.buildMug();
    // block glyphs that jump out of the keys on the two theatrical presses
    this.semi = this.blockTitle(';', { cap: P.key2, side: P.titleSide }).root;
    this.tab = this.blockTitle('TAB', { cap: '#F28C28', side: '#8E3A12' }).root;
    // key presses for every typed character (and the reply in the IM)
    const typed = [...allChars(this.rows), ...this.im.reply];
    for (const c of typed) {
      const k = c.ch === '→' ? this.keyOf.get('\t') : this.keyOf.get(c.ch.toLowerCase()) ?? (c.ch === '"' ? this.keyOf.get("'") : undefined);
      if (k !== undefined) this.keys[k]!.presses.push(c.t);
    }
    this.editor = this.panel(EDW, EDH);
    this.imPanel = this.panel(IMW, IMH);
  }

  private buildKeyboard() {
    const g = new THREE.Group();
    g.position.set(KB.x, KB.y, KB.z);
    g.rotation.x = 0.08;
    this.world.add(g);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.23), psMat({ color: P.beigeDark }));
    base.position.y = 0.015; g.add(base);
    // one legend atlas: 16x16 texels per key
    const legends: string[] = [];
    ROWS.forEach((r) => legends.push(...Array.from(r)));
    legends.push(' ');
    const N = legends.length, cols = 16, rowsN = Math.ceil(N / cols);
    const atlas = canvasTex(cols * 16, rowsN * 16, (c) => {
      legends.forEach((ch, i) => {
        const x = (i % cols) * 16, y = Math.floor(i / cols) * 16;
        c.fillStyle = ch === ';' ? '#E9D98A' : ch === '\t' ? '#E9B27A' : '#D9D2BC'; c.fillRect(x, y, 16, 16);
        c.fillStyle = '#A89F86'; c.fillRect(x, y + 15, 16, 1); c.fillRect(x + 15, y, 1, 16);
        const lab = ch === '\t' ? 'TAB' : ch === '^' ? 'CAP' : ch === '\n' ? 'ENT' : ch === '<' || ch === '>' ? 'SH' : ch === ' ' ? '' : ch.toUpperCase();
        if (lab.length === 1) pixText(c, lab, x + 5, y + 4, P.ink);
        else if (lab) { c.fillStyle = P.ink; pixText(c, lab, x + 1, y + 4, P.ink); }
      });
    });
    const capMat = psMat({ map: atlas.tex });
    const sideMat = psMat({ color: '#B8AF96' });
    const mkKey = (idx: number, ch: string, x: number, z: number, w: number) => {
      const piv = new THREE.Group();
      const geo = new THREE.BoxGeometry(w, 0.022, KB.key);
      // top face (group 2 in BoxGeometry) samples its atlas cell
      const uv = geo.attributes.uv!;
      const u0 = (idx % cols) / cols, v0 = 1 - (Math.floor(idx / cols) + 1) / rowsN;
      for (let i = 8; i < 12; i++) uv.setXY(i, u0 + uv.getX(i) / cols, v0 + uv.getY(i) / rowsN);
      const m = new THREE.Mesh(geo, [sideMat, sideMat, capMat, sideMat, sideMat, sideMat]);
      m.position.y = 0.011;
      piv.add(m);
      piv.position.set(x, 0.03, z);
      g.add(piv);
      this.keys.push({ mesh: piv, x: KB.x + x, z: KB.z + z, presses: [] });
      this.keyOf.set(ch, this.keys.length - 1);
    };
    let idx = 0;
    ROWS.forEach((r, ri) => {
      const z = -0.07 + ri * KB.pitch;
      const off = [0, 0.012, 0.02, 0.03][ri]!;
      Array.from(r).forEach((ch, ci) => {
        const wide = ch === '\t' || ch === '^' || ch === '\n' || ch === '<' || ch === '>';
        const x = -0.27 + off + ci * KB.pitch + (ch === '\n' || ch === '>' ? 0.01 : 0);
        mkKey(idx++, ch, x, z, wide ? KB.key * 1.3 : KB.key);
      });
    });
    mkKey(idx, ' ', 0, -0.07 + 4 * KB.pitch, 0.26);
  }

  private buildMug() {
    const tex = canvasTex(96, 20, (c) => {
      c.fillStyle = '#F3ECDF'; c.fillRect(0, 0, 96, 20);
      pixText(c, '20', 2, 3, P.hoodie, 2);
      pixText(c, 'YRS', 26, 7, P.ink);
    }).tex;
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.06, 0.14, 8), [psMat({ map: tex }), psMat({ color: '#F3ECDF' }), psMat({ color: '#3A2A1E' })]);
    mug.position.set(-0.52, 0.87, -3.05);
    mug.rotation.y = -1.1;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.012, 4, 8), psMat({ color: '#F3ECDF' }));
    handle.position.set(-0.46, 0.87, -3.1); handle.rotation.y = 0.4;
    this.world.add(mug, handle);
  }

  // ---------------------------------------------------------------- the camera

  camAt(t: number): CamState {
    const [d0, d1, d2, d3, d4, d5, d6] = this.D as [number, number, number, number, number, number, number];
    const kv = (ks: [number, V3, ((x: number) => number)?][]): V3 => [0, 1, 2].map((i) => keys(t, ks.map(([tt, v, e]) => [tt, v[i]!, e] as Key))) as V3;
    const semiK = this.kickSemi;
    const tabsT = this.L2.words[3]!.start;
    if (t < d1) {
      // out of the CRT (the intro's last leaf landed as its frame): a fast pull back to reveal the room,
      // then an arc round DEV's left onto the desk as the first words type
      return {
        P: kv([[d0 + 0.12, SCREEN_FILL.P], [d0 + 0.7, [1.75, 1.7, -0.5], ease.outExpo], [d1, [0.98, 1.36, -2.15], ease.inOutCubic]]),
        T: kv([[d0 + 0.12, SCREEN_FILL.T], [d0 + 0.7, [0, 0.95, -3.0], ease.outExpo], [d1, [-0.08, 1.0, -3.1], ease.inOutCubic]]),
        roll: keys(t, [[d0 + 0.12, 0], [d0 + 0.7, -0.1, ease.outExpo], [d1, 0.03]]), fov: 52,
      };
    }
    if (t < d2) {
      // low over the keyboard: hands typing, a truck right to left, a step in on the half-bar
      const mid = (d1 + d2) / 2;
      const step = prog(t, mid, mid + 0.1, ease.outExpo);
      return {
        P: [0.66 - 0.05 * step, 1.03 - 0.02 * step, lerp(-2.62, -2.86, ease.inOutQuad(prog(t, d1, d2)))],
        T: [lerp(0.02, -0.12, prog(t, d1, d2)), 0.86, -3.02], roll: lerp(0.06, -0.02, prog(t, d1, d2)), fov: 50,
      };
    }
    if (t < d3) {
      // "semicolon": the ; key, low and close; the final ; of "mine;" slams on the kick
      const slam = prog(t, semiK, semiK + 0.1, ease.outExpo);
      const back = prog(t, semiK + 0.2, d3, ease.inOutCubic);
      const k = this.keys[this.keyOf.get(';')!]!;
      return {
        P: [k.x + 0.28 - 0.06 * slam + 0.2 * back, 0.93 + 0.02 * slam + 0.12 * back, k.z + 0.28 - 0.05 * slam + 0.3 * back],
        T: [k.x - 0.02 + 0.05 * back, 0.86, k.z - 0.02], roll: 0.1 * (1 - slam) - 0.05 * back, fov: 48,
      };
    }
    if (t < d4) {
      // the mug in front ("20 YRS"), then the theatrical Tab: the camera ducks to the left end of the keyboard
      const k = this.keys[this.keyOf.get('\t')!]!;
      const hit = prog(t, tabsT - 0.02, tabsT + 0.1, ease.outExpo);
      return {
        P: kv([[d3, [-0.95, 0.98, -2.62]], [tabsT - 0.05, [-0.78, 0.95, -2.7], ease.inOutCubic], [tabsT + 0.1, [-0.6, 0.92, -2.78], ease.outExpo], [d4, [-0.66, 1.08, -2.62], ease.inOutCubic]]),
        T: kv([[d3, [-0.48, 0.9, -3.05]], [tabsT - 0.05, [k.x, 0.86, k.z], ease.inOutCubic], [d4, [-0.1, 0.95, -3.05], ease.inOutCubic]]),
        roll: -0.08 * hit + 0.04, fov: 50,
      };
    }
    if (t < d5) {
      // DEV's smug face lit by the screen ("never spaces – by design"), arcing round toward the CRT
      const u = ease.inOutCubic(prog(t, d4, d5));
      const a = lerp(-1.15, -0.45, u);
      return {
        P: [Math.sin(a) * 0.82, 1.36 - 0.06 * u, -2.44 - Math.cos(a) * 0.82], T: [0, 1.22 - 0.1 * u, -2.5 - 0.2 * u], roll: 0.04 * Math.sin(a), fov: 50,
      };
    }
    // the IM pops out of the CRT; then the dive into the screen
    const dive = prog(t, d6 - 0.5, d6, ease.inOutQuad);
    const from: V3 = [lerp(0.95, 0.7, prog(t, d5, d6 - 0.5)), 1.34, lerp(-2.25, -2.35, prog(t, d5, d6 - 0.5))];
    const P0: V3 = [lerp(from[0], SCREEN_FILL.P[0], dive), lerp(from[1], SCREEN_FILL.P[1], dive), lerp(from[2], SCREEN_FILL.P[2], dive)];
    const T0: V3 = [lerp(0.12, 0, dive), lerp(1.12, 1.08, dive), -3.2];
    const kick = this.K.find((k) => k >= d5 - 0.02) ?? d5;
    const bump = pulse(t, kick, 0.08) * 0.06;
    return { P: [P0[0], P0[1], P0[2] - bump], T: T0, roll: lerp(-0.05, 0, dive), fov: 52 };
  }

  // ---------------------------------------------------------------- render

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    this.begin();
    const t = f.t;
    const [d0, d1, d2, d3, d4, d5, d6] = this.D as [number, number, number, number, number, number, number];
    const beat = this.ctx.audio.beatAt(t);
    const blink = ((beat % 1) + 1) % 1 < 0.55;
    const tabsT = this.L2.words[3]!.start, semiT = this.L1.words[7]!.end - 0.02;

    // keys: each press dips its key; the two theatrical presses dip harder
    for (const k of this.keys) {
      let d = 0;
      for (const p of k.presses) if (t >= p && t < p + 0.3) d = Math.max(d, pulse(t, p, 0.05));
      k.mesh.position.y = 0.03 - 0.014 * d;
    }
    // DEV: hands on the keys (the hand on the pressed key's side dips), the Tab arm raised high
    const dev = this.dev;
    let lh = 0, rh = 0;
    for (const k of this.keys) for (const p of k.presses) if (t >= p && t < p + 0.2) { const v = pulse(t, p, 0.04); if (k.x < 0) lh = Math.max(lh, v); else rh = Math.max(rh, v); }
    const raise = (tt: number) => clamp(1 - Math.abs(t - (tt - 0.18)) / 0.2) * (t < tt ? 1 : 0);
    const tabUp = raise(tabsT), semiUp = Math.max(raise(semiT), raise(this.kickSemi));
    dev.armL.rotation.set(1.28 + 0.12 * lh - 1.9 * tabUp, 0, 0.18 - 0.2 * tabUp);
    dev.armR.rotation.set(1.28 + 0.12 * rh - 1.9 * semiUp, 0, -0.18 + 0.15 * semiUp);
    dev.head.rotation.x = 0.12 + 0.04 * Math.sin(beat * Math.PI);
    dev.head.rotation.y = t > d5 ? 0.2 * Math.sin((t - d5) * 5) * Math.exp(-(t - d5) * 2) : 0;
    const w1 = this.L1.words, w2 = this.L2.words, w3 = this.L3.words;
    dev.setFace(t >= w3[2]!.start && t < w3[6]!.start ? 'laugh' : (t >= w1[8]!.start && t < d3 + 0.3) || (t >= w2[4]!.start && t < d5) || t >= w3[6]!.start ? 'smug' : 'neutral');
    this.room.clock.second.rotation.z = -(30 / 60) * Math.PI * 2; // 10:10 forever

    // the two block glyphs jumping out of their keys
    const jump = (g: THREE.Group, t0: number, key: string, sc: number) => {
      const u = t - t0;
      g.visible = u >= 0 && u < 0.7;
      if (!g.visible) return;
      const k = this.keys[this.keyOf.get(key)!]!;
      const s = springStep(u, 3, 0.45);
      g.position.set(k.x, 0.86 + 0.16 * clamp(s, 0, 1.2), k.z - 0.04);
      g.rotation.set(-0.3, 0.4 * (1 - clamp(s)), 0);
      g.scale.setScalar(sc * clamp(s, 0, 1.15) * (1 - prog(u, 0.5, 0.7)));
    };
    jump(this.semi, this.kickSemi, ';', 0.16);
    jump(this.tab, tabsT, '\t', 0.07);
    if (t >= this.kickSemi && t < this.kickSemi + 0.08) this.shake(0.02);
    if (t >= tabsT && t < tabsT + 0.08) this.shake(0.025);

    // the editor window: open while lines 1–2 type, re-hung per shot
    const L1s = w1[0]!.start;
    const edHang = [
      { a: L1s - 0.2, b: d1, h: { ref: d1 - 0.35, x: 0.28, y: 0.42, frac: 0.64, yaw: -0.22, pitch: 0.06, follow: 0.06 } },
      { a: d1, b: d2, h: { ref: d1 + 0.7, x: 0.0, y: 0.48, frac: 0.66, yaw: 0.16, pitch: 0.18, D: 0.42 } },
      { a: d2, b: d3, h: { ref: d2 + 0.3, x: -0.02, y: 0.5, frac: 0.64, yaw: -0.2, pitch: 0.2, D: 0.3, follow: 0.1 } },
      { a: d3, b: d4, h: { ref: tabsT + 0.3, x: 0.08, y: 0.5, frac: 0.64, yaw: 0.2, pitch: 0.16, D: 0.4 } },
      { a: d4, b: w3[2]!.start - 0.05, h: { ref: d4 + 0.7, x: -0.3, y: -0.45, frac: 0.64, yaw: 0.26, pitch: -0.1, D: 0.55, follow: 0.1 } },
    ];
    const seg = edHang.find((s) => t >= s.a && t < s.b);
    this.editor.open = seg ? windowOpen(t, seg.a, seg.b, 0.12, seg.a !== L1s - 0.2, seg.b !== w3[2]!.start - 0.05) : 0;
    this.editor.hang = seg?.h ?? null;
    if (seg) this.editor.draw(editorKey(this.rows, t, blink), (c) => drawEditorWindow(c, this.rows, t, blink));

    // the IM popup: pops out of the CRT on "try", stays with the camera into the dive (continues in v1-hand)
    const imA = w3[2]!.start - 0.08;
    // it closes as the dive starts: the CRT's own IM (what the camera dives into) takes over
    this.imPanel.open = t >= imA ? windowOpen(t, imA, d6 - 0.24, 0.12) : 0;
    this.imPanel.hang = { ref: d6 - 0.8, x: 0.0, y: 0.1, frac: 0.7, yaw: -0.16, pitch: 0.04, D: 0.5 };
    if (t >= imA) this.imPanel.draw(imKey(this.im, t, false), (c) => drawIM(c, this.im, t, 1e9));

    // the CRT: the editor, then the IM app
    const sk = t < imA ? `e${editorKey(this.rows, t, blink)}` : `i${imKey(this.im, t, false)}`;
    if (sk !== this.screenKey) {
      this.screenKey = sk;
      const c = this.room.screen.ctx;
      if (t < imA) drawEditorScreen(c, this.rows, t, blink);
      else drawImScreen(c, this.im, t);
      this.room.screen.tex.needsUpdate = true;
    }
    void d0;
    return this.present(f, out);
  }
}

/** The IM app on the CRT (128x96): what the camera dives into. */
export function drawImScreen(c: CanvasRenderingContext2D, im: ReturnType<typeof imChars>, t: number, sent = false) {
  c.fillStyle = '#10162A'; c.fillRect(0, 0, 128, 96);
  c.fillStyle = '#2E4A8C'; c.fillRect(0, 0, 128, 10);
  pixText(c, 'IM: coworker', 3, 2, P.uiLine);
  const line = (cs: { ch: string; col: string; t: number }[], y: number, max: number) => {
    let x = 4, yy = y, n = 0;
    for (const ch of cs) { if (ch.t > t) continue; if (n >= max && ch.ch === ' ') { yy += 9; x = 4; n = 0; continue; } pixText(c, ch.ch, x, yy, ch.col); x += 6; n++; }
    return yy;
  };
  const y1 = line(im.msg, 16, 14);
  c.fillStyle = '#1B2A55'; c.fillRect(2, y1 + 14, 124, 40);
  pixText(c, 'DEV:', 4, y1 + 16, '#7FC98F');
  line(im.reply, y1 + 26, 16);
  if (sent) pixText(c, 'SENT ✓', 86, y1 + 16, P.fix);
  c.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 1; y < 96; y += 2) c.fillRect(0, y, 128, 1);
}
