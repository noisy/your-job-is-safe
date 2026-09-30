// The bridge's lyric idiom: thin "whisper" letters. The kit's 5x7 bitmap font drawn at 3x as separated
// 2x2 dots (a light, whispered weight); each word is wiped in column by column as it is sung, and held
// notes stretch the glyphs wider while they ring. One sign per line, drawn into a panel texture.
import type { Line, Word } from '../engine/lyrics';
import { clamp } from '../engine/util';
import { glyphRows } from '../ps1/gfx';
import { plain } from '../engine/type';
/** What the bitmap font draws for a word (… → ..., curly quotes straight). */
const chars = (w: Word) => Array.from(plain(w.w));

export const SGW = 432, SGH = 118;
const S = 4, ADV3 = 6 * S; // 4x cell, 24 px advance

/** How far a word is revealed (0..1) and how wide its glyphs are stretched at t. */
function wordState(w: Word, t: number) {
  const dur = w.end - w.start;
  const wipe = clamp((t - w.start) / Math.max(0.12, Math.min(0.34, dur * 0.8)));
  const held = dur > 0.45 ? clamp((t - w.start - 0.15) / Math.max(0.1, dur - 0.15)) : 0;
  const stretch = 1 + 0.55 * held;
  return { wipe, stretch };
}

/** Rows of a line (greedy, `max` characters). */
export function rowsOf(L: Line, max = 17): Word[][] {
  const rows: Word[][] = [[]];
  let n = 0;
  for (const w of L.words) {
    const len = chars(w).length;
    if (n > 0 && n + 1 + len > max) { rows.push([]); n = 0; }
    rows[rows.length - 1]!.push(w); n += (n > 0 ? 1 : 0) + len;
  }
  return rows;
}

export function whisperKey(L: Line, t: number) {
  return L.words.map((w) => { const s = wordState(w, t); return `${Math.round(s.wipe * 30)}.${Math.round(s.stretch * 20)}`; }).join(',');
}

/** Draw the sign: dotted 3x letters, centred rows, each word wiped in and stretched on its hold. */
export function drawWhisper(c: CanvasRenderingContext2D, L: Line, t: number, ink = '#F3EEE2', glow = '#8FA3BF') {
  const rows = rowsOf(L);
  rows.forEach((row, ri) => {
    const states = row.map((w) => wordState(w, t));
    let widths = row.map((w, i) => chars(w).length * ADV3 * states[i]!.stretch);
    let total = widths.reduce((a, b) => a + b, 0) + (row.length - 1) * ADV3;
    // a stretching held note never pushes the row off the sign: the stretch is capped to what fits
    if (total > SGW - 8) {
      const room = SGW - 8 - (row.length - 1) * ADV3, base = row.reduce((a, w) => a + chars(w).length * ADV3, 0);
      const extra = widths.reduce((a, b) => a + b, 0) - base, k = Math.max(0, (room - base) / Math.max(1e-3, extra));
      states.forEach((st) => { st.stretch = 1 + (st.stretch - 1) * k; });
      widths = row.map((w, i) => chars(w).length * ADV3 * states[i]!.stretch);
      total = widths.reduce((a, b) => a + b, 0) + (row.length - 1) * ADV3;
    }
    let x = Math.round((SGW - total) / 2);
    const y = 5 + ri * 38;
    // a dark band behind the row (sized to the whole row, so it doesn't jump as words arrive)
    if (states.some((st) => st.wipe > 0)) {
      c.fillStyle = 'rgba(8,11,24,0.66)';
      c.beginPath(); c.roundRect(x - 12, y - 5, total + 24, 7 * S + 10, 6); c.fill();
    }
    row.forEach((w, i) => {
      const st = states[i]!;
      if (st.wipe > 0) {
        const cs = chars(w);
        const shown = st.wipe * cs.length;
        cs.forEach((ch, k) => {
          if (k >= Math.ceil(shown)) return;
          const cx = x + k * ADV3 * st.stretch;
          const frac = clamp(shown - k); // the leading glyph is still coming in: its columns wipe left to right
          plotGlyph(c, ch, cx, y, st.stretch, frac, ink, glow);
        });
      }
      x += widths[i]! + ADV3;
    });
  });
}

function plotGlyph(c: CanvasRenderingContext2D, ch: string, x: number, y: number, sx: number, frac: number, ink: string, glow: string) {
  const rows = glyphRows(ch);
  const cols = Math.ceil(frac * 5);
  rows.forEach((bits, py) => {
    for (let px = 0; px < cols; px++) {
      if (!(bits & (16 >> px))) continue;
      const edge = px === cols - 1 && frac < 1;
      c.fillStyle = edge ? glow : ink;
      c.fillRect(Math.round(x + px * S * sx), y + py * S, Math.max(3, Math.round(3 * sx)), 3);
    }
  });
}
