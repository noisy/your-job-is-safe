// Oscilloscope style: text written by the beam. A `Written` is a stroke-font string with a time for every
// char (from the vocal's word timings, or a typing rhythm). `at(t)` returns what the beam has written by
// t: the strokes, the pen head, and for held notes the "sustain": the last stroke trembles and the beam
// keeps tracing a waveform out of the word until the note ends.
import { strokeText, type StrokeText, type StrokeFontName } from '../engine/stroke';
import type { Word } from '../engine/lyrics';
import { clamp, hash, smoothstep, type V2 } from '../engine/util';
import { writtenStrokes } from './style-scope-beam';

/** A word counts as held when it is sung this long (s). */
const HELD = 0.55;
/** Held words are written in this share of their length (then they sustain). */
const HELD_WRITE = 0.42;
/** How fast the sustain trace runs out of a held word (px/s) and how long it gets at most (px). */
const SUSTAIN_SPEED = 300;
const SUSTAIN_MAX = 280;

interface Span { c0: number; c1: number; start: number; end: number; writeEnd: number; held: boolean; lastStroke: number; xEnd: number }
export interface WrittenStroke { pts: V2[]; ci: number; si: number; fresh: number }
export interface WrittenFrame { strokes: WrittenStroke[]; head: V2 | null; sustain: { pts: V2[]; I: number } | null }

export class Written {
  st: StrokeText;
  times: [number, number][];
  spans: Span[] = [];
  constructor(public text: string, font: StrokeFontName, public size: number, times: [number, number][], spans: Omit<Span, 'lastStroke' | 'xEnd'>[] = [], tracking = 0) {
    this.st = strokeText(text, font, size, tracking);
    this.times = times;
    for (const s of spans) {
      // the last letter (not the comma or the bang) carries the vibrato
      let last = s.c1 - 1;
      while (last > s.c0 && !/\p{L}/u.test(Array.from(text)[last] ?? '')) last--;
      let lastStroke = -1, xEnd = -Infinity;
      this.st.charOf.forEach((ci, si) => {
        if (ci === last) lastStroke = si;
        if (ci >= s.c0 && ci < s.c1) for (const p of this.st.strokes[si]!) xEnd = Math.max(xEnd, p.x);
      });
      this.spans.push({ ...s, lastStroke, xEnd });
    }
  }

  /** A sung line: every char is written while its word is sung (held words finish early and sustain). */
  static sung(words: Word[], font: StrokeFontName, size: number, tracking = 0) {
    const times: [number, number][] = [];
    const spans: Omit<Span, 'lastStroke' | 'xEnd'>[] = [];
    let text = '';
    words.forEach((w, wi) => {
      if (wi > 0) { const prev = words[wi - 1]!; text += ' '; times.push([prev.end, prev.end]); }
      const chars = Array.from(w.w), dur = w.end - w.start, held = dur > HELD;
      const writeEnd = held ? w.start + clamp(dur * HELD_WRITE, 0.22, 0.5) : w.end;
      const c0 = Array.from(text).length;
      chars.forEach((_, i) => times.push([w.start + ((writeEnd - w.start) * i) / chars.length, w.start + ((writeEnd - w.start) * (i + 1)) / chars.length]));
      text += w.w;
      spans.push({ c0, c1: c0 + chars.length, start: w.start, end: w.end, writeEnd, held });
    });
    return new Written(text, font, size, times, spans, tracking);
  }

  /** Typed text: chars land between t0 and t1 with a slightly uneven rhythm. */
  static typed(text: string, font: StrokeFontName, size: number, t0: number, t1: number, seed = 1, tracking = 0) {
    const n = Array.from(text).length;
    const gaps = Array.from({ length: n }, (_, i) => 0.6 + hash(i, seed) * 0.8);
    const sum = gaps.reduce((a, b) => a + b, 0);
    const times: [number, number][] = [];
    let acc = t0;
    for (let i = 0; i < n; i++) {
      const d = ((t1 - t0) * gaps[i]!) / sum;
      times.push([acc, acc + d * 0.7]);
      acc += d;
    }
    return new Written(text, font, size, times, [], tracking);
  }

  get width() { return this.st.width; }
  /** Right edge (px) of word `wi` (spans are words for sung lines). */
  lengthX(wi: number) { return this.spans[wi]?.xEnd ?? this.st.width; }

  /** Pen length at t (chars are written one after another in time order). */
  lengthAt(t: number) {
    const st = this.st;
    let len = 0;
    for (let i = 0; i < st.charRange.length; i++) {
      const [a, b] = st.charRange[i]!, [t0, t1] = this.times[i] ?? [Infinity, Infinity];
      if (t >= t1) len = b;
      else if (t > t0) { len = a + (b - a) * ((t - t0) / Math.max(1e-3, t1 - t0)); break; }
      else break;
    }
    return len;
  }

  /** What the beam has written by t. `vib` (0..1) scales the sustain (e.g. the vocal envelope). */
  at(t: number, vib = 1): WrittenFrame {
    const len = this.lengthAt(t);
    const parts = writtenStrokes(this.st, len);
    let head: V2 | null = null;
    const strokes: WrittenStroke[] = parts.map((p) => {
      const tc = this.times[p.ci]?.[1] ?? 0;
      if (!p.done) head = p.pts[p.pts.length - 1]!;
      return { pts: p.pts, ci: p.ci, si: p.si, fresh: t < tc ? 1 : Math.exp(-(t - tc) / 0.09) };
    });
    let sustain: WrittenFrame['sustain'] = null;
    for (const s of this.spans) {
      if (!s.held || t < s.writeEnd || t > s.end + 0.45) continue;
      const on = smoothstep(s.writeEnd, s.writeEnd + 0.12, t), off = 1 - smoothstep(s.end, s.end + 0.4, t);
      const amp = this.size * 0.045 * on * (0.55 + 0.45 * vib);
      // the last stroke trembles
      const k = strokes.findIndex((x) => x.si === s.lastStroke);
      if (k >= 0) {
        const pts = strokes[k]!.pts, n = pts.length;
        strokes[k] = {
          ...strokes[k]!,
          fresh: Math.max(strokes[k]!.fresh, 0.35 * on * off),
          pts: pts.map((p, i) => {
            const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(n - 1, i + 1)]!;
            const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1, u = i / Math.max(1, n - 1);
            const o = amp * 0.5 * off * u * Math.sin(t * 2 * Math.PI * 6.1 + u * 5);
            return { x: p.x - (dy / l) * o, y: p.y + (dx / l) * o };
          }),
        };
      }
      // and the beam keeps tracing: the note as a waveform running out of the word
      const L = Math.min(SUSTAIN_MAX, (Math.min(t, s.end) - s.writeEnd) * SUSTAIN_SPEED);
      const y0 = -this.size * 0.22, x0 = s.xEnd + this.size * 0.08, pts: V2[] = [];
      const wl = this.size * 0.34;
      for (let x = 0; x <= L; x += 3) {
        const env = smoothstep(0, 30, x) * (1 - 0.35 * (x / SUSTAIN_MAX));
        pts.push({ x: x0 + x, y: y0 + Math.sin((x / wl) * 2 * Math.PI - t * 2 * Math.PI * 5.2) * amp * 2.2 * env * off });
      }
      if (pts.length > 1) { sustain = { pts, I: off }; head = pts[pts.length - 1]!; }
    }
    return { strokes, head, sustain };
  }
}
