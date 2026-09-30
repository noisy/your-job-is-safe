// ASCII style: the two terminal windows (the narrator's shell, where the sung lyric is typed, and the
// chatbot session), drawn into one Canvas2D layer each frame. Pure functions of t.
import { F, font, plain } from '../engine/type';
import { Lyrics, type Line, type Word } from '../engine/lyrics';
import { clamp, hash, prog } from '../engine/util';

export const TERM = {
  paper: '#EDE6D6', dim: '#8C857A', faint: '#4A453F', red: '#E5322D', panel: 'rgba(30,28,25,0.93)', border: '#5E574E', title: '#26231F',
};
/** Canvas regions (logical px) of the two windows inside the layer, and their world size (px per unit). */
export const REGION = { L: { x: 0, y: 0, w: 1600, h: 300 }, C: { x: 0, y: 330, w: 1300, h: 470 } };
export const PX_PER_UNIT = 200;

const HELD = 0.7; // a word sung longer than this stretches on screen
const REP = 0.11; // one repeated glyph per this many seconds of the held note

/** Index of the glyph a held word stretches: its last sung vowel (a trailing silent e is skipped). */
function stretchIndex(s: string): number {
  const letters = s.replace(/[^a-z]+$/i, '');
  let end = letters.length;
  if (/[^aeiouy]e$/i.test(letters)) end -= 1;
  for (let i = end - 1; i >= 0; i--) if ('aeiouy'.includes(letters[i]!.toLowerCase())) return i;
  return Math.max(0, letters.length - 1);
}

/** The word as typed by t: per character with the voice; a held note repeats its vowel while it rings. */
export function typedWord(w: Word, t: number): string {
  const s = plain(w.w);
  if (t < w.start) return '';
  const dur = w.end - w.start;
  if (dur <= HELD) return s.slice(0, Math.ceil(Lyrics.wordProgress(w, t) * s.length - 1e-6));
  const k = stretchIndex(s);
  const pre = s.slice(0, k + 1), suf = s.slice(k + 1);
  const tPre = w.start + 0.2, tSuf = w.end - 0.14;
  if (t < tPre) return pre.slice(0, Math.ceil(prog(t, w.start, tPre) * pre.length));
  const maxRep = Math.min(5, Math.max(0, Math.floor((tSuf - tPre) / REP)));
  const reps = Math.min(maxRep, Math.floor((t - tPre) / REP));
  const held = pre + s[k]!.repeat(reps);
  if (t < tSuf) return held;
  return held + suf.slice(0, Math.ceil(prog(t, tSuf, w.end) * suf.length));
}

/** A lyric line as typed by t (words joined with spaces once complete). */
export function typedLine(l: Line, t: number): string {
  let out = '';
  for (const w of l.words) {
    if (t < w.start) break;
    out += typedWord(w, t);
    if (t >= w.end) out += ' ';
    else break;
  }
  return out.replace(/ $/, '');
}

/** Text typed by a person at a steady, slightly uneven pace between t0 and t1. */
export function typedPlain(s: string, t: number, t0: number, t1: number, seed = 1): string {
  if (t <= t0) return '';
  const n = s.length;
  // uneven key timing: cumulative random gaps normalised to the span
  let acc = 0;
  const gaps: number[] = [];
  for (let i = 0; i < n; i++) { acc += 0.6 + hash(i, seed) * 0.8 + (s[i] === ' ' ? 0.5 : 0); gaps.push(acc); }
  const u = clamp((t - t0) / (t1 - t0)) * acc;
  let k = 0;
  while (k < n && gaps[k]! <= u) k++;
  return s.slice(0, k);
}

export interface ChatLine { who: 'you' | 'bot' | 'note'; text: string; tokens?: boolean; red?: string; caret?: boolean; spinner?: string }

type Seg = { s: string; col: string; box?: string };
/** Wrap a line of coloured segments at `maxCh` characters (breaking at spaces), continuation rows indented. */
function wrap(segs: Seg[], maxCh: number, indent: number): Seg[][] {
  const chars: { ch: string; col: string; box?: string }[] = [];
  for (const g of segs) for (const ch of g.s) chars.push({ ch, col: g.col, box: g.box });
  const rows: typeof chars[] = [];
  let i = 0, first = true;
  while (i < chars.length) {
    const room = maxCh - (first ? 0 : indent);
    let end = Math.min(chars.length, i + room);
    if (end < chars.length) { let k = end; while (k > i + 4 && chars[k]!.ch !== ' ') k--; if (k > i + 4) end = k + 1; }
    rows.push(chars.slice(i, end));
    i = end; first = false;
  }
  if (!rows.length) rows.push([]);
  return rows.map((r, ri) => {
    const out: Seg[] = ri ? [{ s: ' '.repeat(indent), col: TERM.dim }] : [];
    for (const c of r) { const l = out[out.length - 1]; if (l && l.col === c.col && l.box === c.box) l.s += c.ch; else out.push({ s: c.ch, col: c.col, box: c.box }); }
    return out;
  });
}

/** Draw one terminal window: title bar, then lines from the bottom up (the latest at the prompt), wrapped to the width. */
export function drawWindow(c: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number }, title: string, lines: { segs: Seg[]; caret?: boolean; dim?: boolean }[], opt: { size: number; beatOn: boolean; indent?: number }) {
  c.save();
  c.translate(r.x, r.y);
  const rad = 22;
  c.fillStyle = TERM.panel;
  c.beginPath(); c.roundRect(0, 0, r.w, r.h, rad); c.fill();
  c.fillStyle = TERM.title;
  c.beginPath(); c.roundRect(0, 0, r.w, 54, [rad, rad, 0, 0]); c.fill();
  c.strokeStyle = TERM.border; c.lineWidth = 3;
  c.beginPath(); c.roundRect(1.5, 1.5, r.w - 3, r.h - 3, rad); c.stroke();
  c.fillStyle = TERM.dim;
  c.font = font(F.mono(400), 28);
  c.textBaseline = 'middle';
  c.fillText(title, 28, 28);
  for (let i = 0; i < 3; i++) { c.fillStyle = TERM.faint; c.fillRect(r.w - 40 - i * 34, 20, 16, 16); }
  const size = opt.size, lh = size * 1.25, adv = size * 0.6;
  const maxCh = Math.floor((r.w - 60) / adv);
  c.font = font(F.mono(500), size);
  c.textBaseline = 'alphabetic';
  const rows: { segs: Seg[]; caret: boolean; dim: boolean }[] = [];
  for (const ln of lines) {
    const w = wrap(ln.segs, maxCh, opt.indent ?? 4);
    w.forEach((segs, i) => rows.push({ segs, caret: !!ln.caret && i === w.length - 1, dim: !!ln.dim }));
  }
  const maxRows = Math.max(1, Math.floor((r.h - 54 - size * 0.5) / lh));
  const shown = rows.slice(-maxRows);
  shown.forEach((ln, i) => {
    let x = 30;
    const y = 54 + size * 0.35 + lh * (i + 1) - lh * 0.22;
    c.globalAlpha = ln.dim ? 0.45 : 1;
    for (const seg of ln.segs) {
      if (seg.box) { c.fillStyle = seg.box; c.fillRect(x - 2, y - size * 0.86, adv * seg.s.length + 4, size * 1.12); }
      c.fillStyle = seg.col;
      c.fillText(seg.s, x, y);
      x += adv * seg.s.length;
    }
    c.globalAlpha = 1;
    if (ln.caret && opt.beatOn) { c.fillStyle = TERM.paper; c.fillRect(x + 2, y - size * 0.8, adv * 0.9, size * 1.0); }
  });
  c.restore();
}
