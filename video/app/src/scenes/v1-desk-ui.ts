// Verse 1, DEV's desk: the code editor document (the sung lyric typed character by character, with
// syntax colours and → tab marks) and the coworker's IM window. Shared by v1-desk and the first bar of
// v1-hand-spaghetti (the IM reply "show me the proof" is typed across the cut).
import type { Line, Word } from '../engine/lyrics';
import { clamp } from '../engine/util';
import { ADV, pixText, textW } from '../ps1/gfx';
import { P } from '../ps1/palette';
import { uiBox, uiTab, uiPortrait } from '../ps1/stage';

export const ED = { cmt: '#7FC98F', txt: P.uiLine, key: P.key2, tab: '#F28C28', dim: P.uiDim, num: '#5C6690' } as const;

/** One typed character: it appears at `t`. */
export interface Ch { ch: string; col: string; t: number }

/** The characters of a sung word, each at its moment (a word types over ≤0.22 s from its start). */
export function wordChars(w: Word, col: string, text = w.w): Ch[] {
  const s = Array.from(text);
  const dur = Math.min(0.22, (w.end - w.start) * 0.8);
  return s.map((ch, i) => ({ ch, col, t: w.start + (i / s.length) * dur }));
}
/** Literal characters typed quickly from t0 (one per `dt`). */
export function litChars(s: string, col: string, t0: number, dt = 0.03): Ch[] {
  return Array.from(s).map((ch, i) => ({ ch, col, t: t0 + i * dt }));
}
/** Words of a line joined by spaces (the space appears with the next word). */
export function phrase(ws: Word[], col: (w: Word, i: number) => string, text?: (w: Word) => string): Ch[] {
  const out: Ch[] = [];
  ws.forEach((w, i) => {
    const cs = wordChars(w, col(w, i), text?.(w) ?? w.w);
    if (i > 0) out.push({ ch: ' ', col: ED.txt, t: cs[0]!.t });
    out.push(...cs);
  });
  return out;
}

/** An editor row: its characters and, optionally, an indent prefix that jumps in at its own time. */
export interface Row { chars: Ch[]; indent?: Ch[] }

/** Every typed moment of the document (for key presses on the keyboard). */
export function allChars(rows: Row[]): Ch[] {
  return rows.flatMap((r) => [...(r.indent ?? []), ...r.chars]).sort((a, b) => a.t - b.t);
}

/** The editor document of verse 1, lines 1–3 ("They said" as a comment; the quote goes to the IM). */
export function editorRows(L1: Line, L2: Line, L3: Line, kickSemi: number): Row[] {
  const w1 = L1.words, w2 = L2.words, w3 = L3.words;
  const semi = w1[7]!, mine = w1[8]!;
  const tabs = w2[3]!;
  const arrows = (t0: number): Ch[] => [{ ch: '→', col: ED.tab, t: t0 }, { ch: '→', col: ED.tab, t: t0 + 0.06 }];
  const rows: Row[] = [
    { chars: [...litChars('// ', ED.cmt, w1[0]!.start - 0.14, 0.04), ...phrase(w1.slice(0, 4), () => ED.cmt)] },
    { chars: phrase(w1.slice(4, 7), () => ED.txt) },
    {
      chars: [
        ...wordChars(semi, ED.key), { ch: ';', col: ED.key, t: semi.end - 0.02 },
        { ch: ' ', col: ED.txt, t: mine.start }, ...wordChars(mine, ED.txt, 'mine'), { ch: ';', col: ED.key, t: kickSemi },
      ],
    },
    // "tabs,": the Tab key slams and the whole line jumps right behind two → marks
    { indent: arrows(tabs.start), chars: phrase(w2.slice(0, 3), () => ED.txt) },
    { indent: arrows(tabs.start + 0.02), chars: phrase(w2.slice(3, 5), (w) => (w === tabs ? ED.tab : ED.txt)) },
    {
      indent: arrows(w2[5]!.start - 0.08),
      chars: [...wordChars(w2[5]!, ED.dim), { ch: ' ', col: ED.txt, t: w2[5]!.end }, { ch: '-', col: ED.txt, t: w2[5]!.end }, { ch: ' ', col: ED.txt, t: w2[6]!.start }, ...wordChars(w2[6]!, ED.txt)],
    },
    { indent: arrows(w2[7]!.start - 0.1), chars: wordChars(w2[7]!, ED.txt) },
    { chars: [...litChars('// ', ED.cmt, w3[0]!.start - 0.1, 0.03), ...phrase(w3.slice(0, 2), () => ED.cmt)] },
  ];
  return rows;
}

/** Visible slice of the document at t: the last `n` rows that have begun. */
export function visibleRows(rows: Row[], t: number, n: number) {
  let last = -1;
  rows.forEach((r, i) => { if ([...(r.indent ?? []), ...r.chars].some((c) => c.t <= t)) last = i; });
  const first = Math.max(0, last - n + 1);
  return { first, last, rows: rows.slice(first, last + 1) };
}

/** Draw editor rows (scale 1 or 2) with a line-number gutter; returns the caret position and a content key. */
export function drawRows(c: CanvasRenderingContext2D | null, rows: Row[], firstNo: number, t: number, x: number, y: number, scale: number, rowH: number, gutter: number) {
  let key = '', cx = x + gutter, cy = y;
  rows.forEach((r, ri) => {
    const yy = y + ri * rowH;
    if (c) pixText(c, String(firstNo + ri + 1).padStart(2, ' '), x, yy + (scale - 1) * 3, ED.num, 1);
    let xx = x + gutter;
    for (const ch of [...(r.indent ?? []), ...r.chars]) {
      if (ch.t > t) continue;
      const pop = t - ch.t < 0.05 ? -1 : 0;
      if (c) pixText(c, ch.ch, xx, yy + pop, ch.col, scale, { shadow: P.uiEdge });
      xx += ADV * scale;
      key += ch.ch;
    }
    key += '|';
    cx = xx; cy = yy;
  });
  return { key, caret: [cx, cy] as [number, number] };
}

/** The editor window (a panel texture): title bar, gutter, 2x rows, blinking caret. */
export const EDW = 240, EDH = 98;
export function drawEditorWindow(c: CanvasRenderingContext2D, rows: Row[], t: number, blink: boolean) {
  const v = visibleRows(rows, t, 4);
  uiBox(c, 0, 8, EDW, EDH - 8);
  uiTab(c, 8, 0, 'hand_written.c', '#2E4A8C');
  pixText(c, 'DEV EDIT', EDW - 56, 1, P.uiDim);
  const r = drawRows(c, v.rows, v.first, t, 8, 20, 2, 19, 16);
  if (blink) { c.fillStyle = P.key2; c.fillRect(r.caret[0] + 1, r.caret[1] - 1, 10, 15); }
  return `${v.first}:${r.key}:${blink ? 1 : 0}`;
}
export function editorKey(rows: Row[], t: number, blink: boolean) {
  const v = visibleRows(rows, t, 4);
  return `${v.first}:${drawRows(null, v.rows, v.first, t, 0, 0, 2, 19, 16).key}:${blink ? 1 : 0}`;
}

/** The same document on the CRT screen (128x96, 1x). */
export function drawEditorScreen(c: CanvasRenderingContext2D, rows: Row[], t: number, blink: boolean) {
  c.fillStyle = '#10162A'; c.fillRect(0, 0, 128, 96);
  c.fillStyle = '#2E4A8C'; c.fillRect(0, 0, 128, 10);
  pixText(c, 'hand_written.c', 3, 2, P.uiLine);
  const v = visibleRows(rows, t, 8);
  const r = drawRows(c, v.rows, v.first, t, 2, 14, 1, 10, 14);
  if (blink) { c.fillStyle = P.key2; c.fillRect(r.caret[0], r.caret[1] - 1, 5, 8); }
  c.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 1; y < 96; y += 2) c.fillRect(0, y, 128, 1);
}

// ---------------------------------------------------------------- the IM window

export const IMW = 244, IMH = 104;
/** The coworker's message ("try the robot, bro", with the chatbot's v1.0 icon) and DEV's reply. */
export function imChars(L3: Line) {
  const w = L3.words;
  const msg = [{ ch: '"', col: P.uiLine, t: w[2]!.start - 0.02 }, ...phrase(w.slice(2, 6), (x) => (/robot/.test(x.w) ? P.bot : P.uiLine))];
  const reply = [...phrase(w.slice(6, 8), () => P.uiLine), { ch: ' ', col: P.uiLine, t: w[8]!.start }, { ch: '"', col: P.uiLine, t: w[8]!.start },
    ...phrase(w.slice(8, 12), (x) => (/proof/.test(x.w) ? P.key2 : P.uiLine))];
  return { msg, reply };
}
/** Break a character run into rows of at most `max` characters at spaces. */
function wrapChars(cs: Ch[], max: number): Ch[][] {
  const rows: Ch[][] = [[]];
  let word: Ch[] = [];
  const flush = () => {
    const row = rows[rows.length - 1]!;
    const lead = row.length ? 1 : 0;
    if (row.length + lead + word.length > max && row.length) rows.push([]);
    rows[rows.length - 1]!.push(...word);
    word = [];
  };
  for (const ch of cs) {
    if (ch.ch === ' ') { flush(); rows[rows.length - 1]!.push(ch); } else word.push(ch);
  }
  flush();
  return rows.map((r) => (r[0]?.ch === ' ' ? r.slice(1) : r));
}
export function imKey(m: ReturnType<typeof imChars>, t: number, sent: boolean) {
  return `${m.msg.filter((c) => c.t <= t).length}:${m.reply.filter((c) => c.t <= t).length}:${sent ? 1 : 0}`;
}
export function drawIM(c: CanvasRenderingContext2D, m: ReturnType<typeof imChars>, t: number, sentAt: number) {
  uiBox(c, 0, 8, IMW, IMH - 8);
  uiTab(c, 8, 0, 'IM: coworker', '#2E4A8C');
  // the attachment: the chatbot, v1.0
  uiPortrait(c, 8, 18, 'bot', 'v1.0');
  const row = (cs: Ch[], x: number, y: number) => {
    let xx = x;
    for (const ch of cs) { if (ch.t <= t) pixText(c, ch.ch, xx, y + (t - ch.t < 0.05 ? -1 : 0), ch.col, 2, { shadow: P.uiEdge }); xx += ADV * 2; }
  };
  wrapChars(m.msg, 15).forEach((r, i) => row(r, 44, 17 + i * 17));
  // DEV's reply field
  const ry = 56;
  c.fillStyle = P.uiEdge; c.fillRect(6, ry, IMW - 12, 42);
  c.fillStyle = '#1B2A55'; c.fillRect(7, ry + 1, IMW - 14, 40);
  pixText(c, 'DEV:', 10, ry + 3, P.hoodie === '#3F7A5A' ? '#7FC98F' : P.uiDim);
  const rr = wrapChars(m.reply, 18);
  rr.forEach((r, i) => row(r, 10, ry + 12 + i * 15));
  if (t >= sentAt) { const w = textW('SENT ✓') + 6; c.fillStyle = '#1E6B3A'; c.fillRect(IMW - 12 - w, ry + 2, w, 9); pixText(c, 'SENT ✓', IMW - 9 - w, ry + 3, P.fix); }
  void clamp;
}
