// Xerox punk zine: the cut-out material. Every scrap is a polygon (scissor-cut or torn) in world units
// plus a Canvas2D texture of what was printed on it, drawn once in init(). The scene extrudes the
// polygon into a sheet with thickness; the texture maps onto its top face.
import * as THREE from 'three';
import { F, font, layout } from '../engine/type';
import { SCALE } from '../engine/gl';
import { type V2, clamp, lerp } from '../engine/util';

export type Rng = () => number;

/** Texture px per world unit (world units are roughly centimetres of the zine). */
export const TEX_D = 96 * Math.min(SCALE, 2);
const MAX_TEX = 2048;

export const INK = '#101010';
export const PAPER = '#f1eee6';
export const NEWS = '#d2cec3';
/** The fluorescent spot colour (the fail marks) as a Canvas2D colour and as linear RGB for GL. */
export const SPOT_CSS = '#ff2d78';
export const SPOT_LIN: [number, number, number] = [1.0, 0.03, 0.2];

/** The ransom-note type cases: every letter is cut from a different source. */
export const RANSOM_FONTS = [
  // (only cuts with sturdy strokes: hairline serifs don't survive the toner threshold)
  F.display(100, 800), F.anton(), F.bodoni(800), F.bodoni(800, true), F.typewriter(), F.rubik(),
  F.display(75, 800), F.mono(800), F.display(100, 600), F.display(75, 600),
];

export interface Cut {
  w: number;
  h: number;
  /** Outline in world units, centred on the scrap, y up, counter-clockwise. */
  poly: V2[];
  canvas: HTMLCanvasElement;
}

export const pick = <T>(rng: Rng, xs: readonly T[]) => xs[Math.floor(rng() * xs.length) % xs.length]!;
const rr = (rng: Rng, a: number, b: number) => lerp(a, b, rng());

// ---------------------------------------------------------------- outlines

/** A scissor cut: four slightly skewed corners, sometimes a clipped corner (two quick snips). */
export function cutPoly(w: number, h: number, rng: Rng, skew = 0.05, clip = 0.35): V2[] {
  const j = () => rr(rng, -skew, skew) * Math.min(w, h);
  const c: V2[] = [
    { x: -w / 2 + j(), y: -h / 2 + j() }, { x: w / 2 + j(), y: -h / 2 + j() },
    { x: w / 2 + j(), y: h / 2 + j() }, { x: -w / 2 + j(), y: h / 2 + j() },
  ];
  if (rng() < clip) {
    const k = Math.floor(rng() * 4), a = c[k]!, b = c[(k + 1) % 4]!, p = c[(k + 3) % 4]!;
    const s = rr(rng, 0.08, clip > 0.3 ? 0.25 : 0.12);
    const q1 = { x: lerp(a.x, p.x, s), y: lerp(a.y, p.y, s) }, q2 = { x: lerp(a.x, b.x, s), y: lerp(a.y, b.y, s) };
    c.splice(k, 1, q1, q2);
  }
  return c;
}

/** A torn edge: every side subdivided and pushed in and out at two scales (the rip and the fibres). */
export function tornPoly(w: number, h: number, rng: Rng, amp = 0.12, step = 0.18, sides = [true, true, true, true]): V2[] {
  const out: V2[] = [];
  const corners: V2[] = [{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 }];
  for (let s = 0; s < 4; s++) {
    const a = corners[s]!, b = corners[(s + 1) % 4]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = sides[s] ? Math.max(2, Math.round(len / step)) : 1;
    const nx = (b.y - a.y) / len, ny = -(b.x - a.x) / len; // outward normal (ccw polygon)
    let drift = 0;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      let d = 0;
      if (sides[s] && i > 0) {
        drift = clamp(drift + rr(rng, -1, 1) * amp * 0.6, -amp, amp);
        d = drift + rr(rng, -1, 1) * amp * 0.35;
      }
      out.push({ x: lerp(a.x, b.x, u) + nx * d, y: lerp(a.y, b.y, u) + ny * d });
    }
  }
  return out;
}

/** An outline around an arbitrary shape: a polygon offset outwards by `m`, with scissor wobble. */
export function roughOutline(pts: V2[], m: number, rng: Rng): V2[] {
  const n = pts.length;
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n]!, c = pts[i]!, q = pts[(i + 1) % n]!;
    let tx = q.x - p.x, ty = q.y - p.y;
    const l = Math.hypot(tx, ty) || 1;
    tx /= l; ty /= l;
    const mm = m * (1 + rr(rng, -0.25, 0.25));
    out.push({ x: c.x + ty * mm, y: c.y - tx * mm });
  }
  return out;
}

// ---------------------------------------------------------------- canvas plumbing

export interface Sheet { c: CanvasRenderingContext2D; canvas: HTMLCanvasElement; w: number; h: number }

/** A canvas for a w x h scrap; drawing coordinates are world units, origin at the scrap's top-left, y down. */
export function sheet(w: number, h: number): Sheet {
  const canvas = document.createElement('canvas');
  const k = Math.min(TEX_D, MAX_TEX / Math.max(w, h));
  canvas.width = Math.max(4, Math.round(w * k));
  canvas.height = Math.max(4, Math.round(h * k));
  const c = canvas.getContext('2d')!;
  c.scale(canvas.width / w, canvas.height / h);
  return { c, canvas, w, h };
}

/** Trace a scrap outline (centred world coords, y up) in sheet coordinates. */
export function tracePoly(s: Sheet, poly: V2[], grow = 0) {
  const { c } = s;
  c.beginPath();
  poly.forEach((p, i) => {
    const x = s.w / 2 + p.x * (1 + grow), y = s.h / 2 - p.y * (1 + grow);
    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
  });
  c.closePath();
}

/** Newsprint dot screen over a rectangle (a magazine's halftone). */
export function halftone(s: Sheet, x0: number, y0: number, x1: number, y1: number, cell: number, dens: (x: number, y: number) => number, color = INK) {
  const { c } = s;
  c.fillStyle = color;
  const a = 0.4, ca = Math.cos(a), sa = Math.sin(a);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, R = Math.hypot(x1 - x0, y1 - y0) / 2;
  for (let v = -R; v <= R; v += cell) {
    for (let u = -R; u <= R; u += cell) {
      const x = cx + u * ca - v * sa, y = cy + u * sa + v * ca;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const d = clamp(dens(x, y));
      if (d < 0.02) continue;
      c.beginPath();
      c.arc(x, y, cell * 0.62 * Math.sqrt(d), 0, Math.PI * 2);
      c.fill();
    }
  }
}

/** Fake body copy: lines of small type (the zine's columns), clipped to a box. */
export function bodyCopy(s: Sheet, text: string, x: number, y: number, w: number, h: number, size: number, fam = F.bodoni(400), color = INK) {
  const { c } = s;
  c.save();
  c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.fillStyle = color;
  c.font = font(fam, size);
  c.textBaseline = 'alphabetic';
  const words = text.split(/\s+/);
  let line = '', yy = y + size;
  let i = 0;
  while (yy < y + h + size) {
    const wd = words[i++ % words.length]!;
    const test = line ? `${line} ${wd}` : wd;
    if (c.measureText(test).width > w && line) {
      c.fillText(line, x, yy);
      yy += size * 1.22;
      line = wd;
    } else line = test;
  }
  c.restore();
}

// ---------------------------------------------------------------- the pieces

export type LetterStyle = 'paper' | 'black' | 'news' | 'dots' | 'box' | 'grey';
const LETTER_STYLES: LetterStyle[] = ['paper', 'paper', 'paper', 'black', 'black', 'news', 'dots', 'box', 'grey'];

/**
 * One cut-out letter for the ransom note. `h` is the word's nominal letter (cap) height in world units.
 * `seed` style picks vary per letter; `force` pins the font/style (the hero word's R's).
 */
export function letterScrap(ch: string, h: number, rng: Rng, force: { font?: string; style?: LetterStyle; lower?: boolean } = {}): Cut & { style: LetterStyle } {
  // (Bodoni's hairlines only survive the toner on big letters whose shape doesn't hang on them)
  let fam = force.font ?? pick(rng, RANSOM_FONTS);
  if (!force.font && fam.startsWith('Bodoni') && (h < 6 || /[NHMUAVWKXZ]/.test(ch))) fam = pick(rng, [F.anton(), F.display(100, 800), F.typewriter(), F.rubik()]);
  // (lowercase only where it can't be misread: an l would pass for an I)
  const lower = force.lower ?? (/[AEGHMNQRTY]/.test(ch) && rng() < 0.18 && fam !== F.rubik() && fam !== F.anton());
  const g = lower ? ch.toLowerCase() : ch;
  // (halftone and grey stock only for big letters: at small sizes the toner swallows a white letter on them)
  let style = force.style ?? pick(rng, LETTER_STYLES);
  if (!force.style && h < 4 && (style === 'dots' || style === 'grey')) style = 'black';
  // size the font so a cap H is ~0.72 h (x0.85..1.15): letters of one word vary like real clippings
  const m = document.createElement('canvas').getContext('2d')!;
  m.font = font(fam, 100);
  const H = m.measureText('H');
  const capH = (H.actualBoundingBoxAscent + H.actualBoundingBoxDescent) / 100;
  const size = (h * 0.72 * rr(rng, 0.85, 1.15)) / capH;
  m.font = font(fam, size);
  const gm = m.measureText(g);
  const inkL = gm.actualBoundingBoxLeft, inkR = gm.actualBoundingBoxRight;
  const inkA = gm.actualBoundingBoxAscent, inkD = gm.actualBoundingBoxDescent;
  const inkW = Math.max(inkR + inkL, h * 0.12), inkH = Math.max(inkA + inkD, h * 0.12);
  const pl = h * rr(rng, 0.07, 0.2), pr = h * rr(rng, 0.07, 0.2), pt = h * rr(rng, 0.06, 0.18), pb = h * rr(rng, 0.06, 0.18);
  const w = Math.max(inkW + pl + pr, h * 0.42), hh = Math.max(inkH + pt + pb, h * 0.5);
  const poly = cutPoly(w, hh, rng, 0.05, 0);
  const s = sheet(w, hh);
  const { c } = s;
  const bg = style === 'black' ? '#141414' : style === 'news' ? NEWS : style === 'grey' ? '#5a5751' : PAPER;
  const fg = style === 'black' || style === 'dots' || style === 'grey' ? '#f7f5ef' : INK;
  c.fillStyle = style === 'dots' ? PAPER : bg;
  c.fillRect(0, 0, w, hh);
  if (style === 'dots') halftone(s, 0, 0, w, hh, h * 0.07, () => 0.62);
  if (style === 'news') {
    // the clipping's neighbouring column of body copy peeks in at the edge
    bodyCopy(s, 'code by hand every semicolon mine twenty years of tabs never spaces by design', 0, 0, w * 0.2, hh, h * 0.09);
  }
  if (style === 'box') { c.strokeStyle = INK; c.lineWidth = h * 0.05; c.strokeRect(h * 0.04, h * 0.04, w - h * 0.08, hh - h * 0.08); }
  // a sliver of the neighbouring letter from the source word, cut through by the scissors
  if (rng() < 0.4 && style !== 'box') {
    c.fillStyle = fg;
    c.font = font(fam, size);
    const nb = pick(rng, ['E', 'A', 'N', 'O', 'S', 'T', 'M']);
    const left = rng() < 0.5;
    const nm = c.measureText(nb);
    c.fillText(nb, left ? -nm.width * 0.82 : w - nm.width * 0.12, pt + inkA);
  }
  c.fillStyle = fg;
  c.font = font(fam, size);
  c.textBaseline = 'alphabetic';
  const ox = (w - inkW) / 2 + inkL, oy = (hh - inkH) / 2 + inkA;
  c.fillText(g, ox, oy);
  return { w, h: hh, poly, canvas: s.canvas, style };
}

/** A typed strip (typewriter or printout): background sheet + a separate transparent text canvas for typing reveals. */
export interface Strip extends Cut {
  text: HTMLCanvasElement;
  /** Text box within the strip (world units, relative to the strip centre) and each char's right edge as a 0..1 fraction. */
  tx: number; ty: number; tw: number; th: number;
  edges: number[];
}
export function typedStrip(str: string, fam: string, size: number, rng: Rng, o: { bg?: string; fg?: string; padX?: number; padY?: number; torn?: boolean; tracking?: number } = {}): Strip {
  const lay = layout(str, fam, size, o.tracking ?? 0);
  const padX = o.padX ?? size * 0.6, padY = o.padY ?? size * 0.45;
  const tw = lay.width + size * 0.1, th = size * 1.3;
  const w = tw + padX * 2, h = th + padY * 2;
  const poly = o.torn ? tornPoly(w, h, rng, size * 0.08, size * 0.25, [false, true, false, true]) : cutPoly(w, h, rng, 0.03);
  const s = sheet(w, h);
  s.c.fillStyle = o.bg ?? PAPER;
  s.c.fillRect(0, 0, w, h);
  const t = sheet(tw, th);
  t.c.fillStyle = o.fg ?? INK;
  t.c.font = font(fam, size);
  t.c.textBaseline = 'alphabetic';
  for (const g of lay.glyphs) {
    // typewriter strikes: every character a hair off its line and a little uneven in ink
    t.c.globalAlpha = 0.82 + 0.18 * rng();
    t.c.fillText(g.ch, g.x, size * 1.0 + (rng() - 0.5) * size * 0.05);
  }
  const edges = lay.glyphs.map((g) => (g.x + g.w) / tw);
  return { w, h, poly, canvas: s.canvas, text: t.canvas, tx: -w / 2 + padX, ty: h / 2 - padY - th, tw, th, edges };
}

/** A printout of a chat window, cut out of the page: header strip with a (made-up) bot face and name. */
export function chatCard(w: number, h: number, rng: Rng, who: string, note: string): Cut {
  const poly = cutPoly(w, h, rng, 0.02);
  const s = sheet(w, h);
  const { c } = s;
  c.fillStyle = PAPER;
  c.fillRect(0, 0, w, h);
  const hh = h * 0.24;
  c.fillStyle = INK;
  c.fillRect(0, 0, w, hh);
  // the bot's face: a rounded square with two eyes and an antenna (an original doodle, no brand)
  const fx = hh * 0.9, fy = hh * 0.5, fr = hh * 0.3;
  c.fillStyle = PAPER;
  c.beginPath(); c.roundRect(fx - fr, fy - fr * 0.85, fr * 2, fr * 1.7, fr * 0.4); c.fill();
  c.fillStyle = INK;
  c.beginPath(); c.arc(fx - fr * 0.4, fy - fr * 0.05, fr * 0.2, 0, Math.PI * 2); c.arc(fx + fr * 0.4, fy - fr * 0.05, fr * 0.2, 0, Math.PI * 2); c.fill();
  c.fillRect(fx - fr * 0.35, fy + fr * 0.4, fr * 0.7, fr * 0.1);
  c.fillStyle = PAPER;
  c.font = font(F.mono(700), hh * 0.5);
  c.textBaseline = 'middle';
  c.fillText(who, fx + fr * 1.8, fy + hh * 0.02);
  c.font = font(F.mono(400), hh * 0.3);
  c.textAlign = 'right';
  c.fillText(note, w - hh * 0.5, fy + hh * 0.02);
  c.textAlign = 'left';
  // the message bubble's outline (the text itself is typed on its own plane)
  c.strokeStyle = INK;
  c.lineWidth = h * 0.018;
  c.beginPath(); c.roundRect(w * 0.035, hh + h * 0.1, w * 0.93, h - hh - h * 0.2, h * 0.08); c.stroke();
  return { w, h, poly, canvas: s.canvas };
}

/** A strip of masking tape: translucent, crinkled, with serrated torn ends. */
export function tapeScrap(len: number, wid: number, rng: Rng): Cut {
  const pts: V2[] = [];
  const teeth = 7;
  for (let i = 0; i <= teeth; i++) pts.push({ x: len / 2 + (i % 2 ? wid * 0.06 : -wid * 0.02) * (0.6 + rng()), y: -wid / 2 + (wid * i) / teeth });
  for (let i = 0; i <= teeth; i++) pts.push({ x: -len / 2 + (i % 2 ? -wid * 0.06 : wid * 0.02) * (0.6 + rng()), y: wid / 2 - (wid * i) / teeth });
  const s = sheet(len, wid);
  const { c } = s;
  c.fillStyle = '#d9d2bf';
  c.fillRect(0, 0, len, wid);
  c.globalAlpha = 0.18;
  c.strokeStyle = '#6d6553';
  c.lineWidth = wid * 0.02;
  for (let i = 0; i < 26; i++) {
    const x = rng() * len;
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x + (rng() - 0.5) * wid * 0.6, wid); c.stroke();
  }
  c.globalAlpha = 1;
  return { w: len, h: wid, poly: pts, canvas: s.canvas };
}

/** A newspaper clipping of body copy with a headline, torn out. */
export function clipping(w: number, h: number, rng: Rng, head: string, body: string, headFam = F.bodoni(800)): Cut {
  const poly = tornPoly(w, h, rng, Math.min(w, h) * 0.035, Math.min(w, h) * 0.07);
  const s = sheet(w, h);
  const { c } = s;
  c.fillStyle = NEWS;
  c.fillRect(0, 0, w, h);
  const hs = Math.min(h * 0.16, (w * 0.9) / Math.max(4, head.length * 0.55));
  c.fillStyle = INK;
  c.font = font(headFam, hs);
  c.textBaseline = 'alphabetic';
  c.fillText(head, w * 0.06, h * 0.06 + hs);
  const cols = w > h ? 3 : 2, gut = w * 0.04, cw = (w * 0.88 - gut * (cols - 1)) / cols;
  for (let k = 0; k < cols; k++) bodyCopy(s, body, w * 0.06 + k * (cw + gut), h * 0.1 + hs * 1.3, cw, h * 0.86 - hs * 1.4, Math.min(w, h) * 0.035);
  return { w, h, poly, canvas: s.canvas };
}

/** A reversed masthead block: the zine's name knocked out of solid black. */
export function masthead(w: number, h: number, rng: Rng, title: string, sub: string): Cut {
  const poly = cutPoly(w, h, rng, 0.015);
  const s = sheet(w, h);
  const { c } = s;
  c.fillStyle = '#121212';
  c.fillRect(0, 0, w, h);
  c.fillStyle = PAPER;
  const size = h * 0.62;
  c.font = font(F.anton(), size);
  c.textBaseline = 'alphabetic';
  const tw = c.measureText(title).width;
  c.save(); c.translate(w * 0.05, h * 0.74); c.scale(Math.min(1, (w * 0.9) / tw), 1); c.fillText(title, 0, 0); c.restore();
  c.font = font(F.mono(700), h * 0.1);
  c.fillText(sub, w * 0.05, h * 0.92);
  return { w, h, poly, canvas: s.canvas };
}

/** A halftone catalogue photo of a mechanical keyboard (tabs, never spaces), torn out. */
export function keyboardPhoto(w: number, h: number, rng: Rng): Cut {
  const poly = tornPoly(w, h, rng, Math.min(w, h) * 0.04, Math.min(w, h) * 0.08);
  const s = sheet(w, h);
  const { c } = s;
  c.fillStyle = PAPER;
  c.fillRect(0, 0, w, h);
  halftone(s, 0, 0, w, h, h * 0.03, (x, y) => 0.25 + 0.5 * (y / h) + 0.1 * Math.sin(x * 2));
  const k = w / 15.5;
  for (let row = 0; row < 5; row++) {
    for (let i = 0; i < 15; i++) {
      const x = k * 0.3 + i * k, y = h * 0.12 + row * k * 1.05;
      if (y + k > h * 0.95) continue;
      const wide = row === 1 && i === 0 ? 1.5 : 1;
      c.fillStyle = PAPER;
      c.beginPath(); c.roundRect(x, y, k * 0.86 * wide, k * 0.86, k * 0.12); c.fill();
      c.strokeStyle = INK; c.lineWidth = k * 0.05; c.stroke();
      if (row === 1 && i === 0) { c.fillStyle = INK; c.font = font(F.display(100, 800), k * 0.3); c.fillText('TAB', x + k * 0.15, y + k * 0.5); i += 0.5; }
    }
  }
  return { w, h, poly, canvas: s.canvas };
}

/** A halftone produce-catalogue photo of a strawberry, torn out (the fruit, not the word). */
export function strawberryPhoto(w: number, h: number, rng: Rng): Cut {
  const poly = tornPoly(w, h, rng, Math.min(w, h) * 0.04, Math.min(w, h) * 0.08);
  const s = sheet(w, h);
  const { c } = s;
  c.fillStyle = PAPER;
  c.fillRect(0, 0, w, h);
  halftone(s, 0, 0, w, h, w * 0.03, (x, y) => 0.12 + 0.18 * (y / h));
  const cx = w * 0.5, cy = h * 0.56, R = w * 0.33;
  // the berry: a rounded cone, shaded dark on the right in halftone
  const berry = new Path2D();
  berry.moveTo(cx, cy + R * 1.25);
  berry.bezierCurveTo(cx - R * 0.5, cy + R * 0.9, cx - R * 1.2, cy + R * 0.1, cx - R * 1.0, cy - R * 0.55);
  berry.bezierCurveTo(cx - R * 0.8, cy - R * 1.05, cx + R * 0.8, cy - R * 1.05, cx + R * 1.0, cy - R * 0.55);
  berry.bezierCurveTo(cx + R * 1.2, cy + R * 0.1, cx + R * 0.5, cy + R * 0.9, cx, cy + R * 1.25);
  c.fillStyle = PAPER;
  c.fill(berry);
  c.save();
  c.clip(berry);
  halftone(s, 0, 0, w, h, w * 0.022, (x, y) => 0.45 + 0.5 * ((x - cx) / R) * 0.6 + 0.25 * ((y - cy) / R));
  // seeds: little light pits in rows
  c.fillStyle = PAPER;
  for (let row = -4; row <= 5; row++) {
    for (let k = -5; k <= 5; k++) {
      const x = cx + k * R * 0.28 + (row % 2) * R * 0.14, y = cy + row * R * 0.24;
      c.beginPath(); c.ellipse(x, y, R * 0.05, R * 0.08, 0.2, 0, Math.PI * 2); c.fill();
    }
  }
  c.restore();
  c.strokeStyle = INK; c.lineWidth = w * 0.012; c.stroke(berry);
  // the leaves
  c.fillStyle = INK;
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i - 2.5) * 0.45;
    c.beginPath();
    c.moveTo(cx, cy - R * 0.85);
    c.quadraticCurveTo(cx + Math.cos(a - 0.3) * R * 0.5, cy - R * 0.85 + Math.sin(a - 0.3) * R * 0.3, cx + Math.cos(a) * R * 0.75, cy - R * 0.9 + Math.sin(a) * R * 0.35);
    c.quadraticCurveTo(cx + Math.cos(a + 0.3) * R * 0.5, cy - R * 0.85 + Math.sin(a + 0.3) * R * 0.3, cx, cy - R * 0.85);
    c.fill();
  }
  c.fillRect(cx - w * 0.012, cy - R * 1.3, w * 0.024, R * 0.45);
  return { w, h, poly, canvas: s.canvas };
}

/** The wine-glass catalogue photo (glass on a light seamless backdrop), silhouette-cut. */
export interface GlassPhoto extends Cut {
  /** In scrap-local world coords (centred, y up): the rim's centre y and half-width, the wine surface y and half-width. */
  rimY: number; rimR: number; wineY: number; wineR: number; cx: number;
}
export function glassPhoto(w: number, h: number, rng: Rng): GlassPhoto {
  const s = sheet(w, h);
  const { c } = s;
  // bowl profile (canvas coords, y down): r(yy) for yy from rim to the bottom of the bowl
  const cx = w * 0.5;
  const rimYc = h * 0.12, bowlBot = h * 0.56, stemBot = h * 0.86, baseY = h * 0.9;
  const R = w * 0.3;
  const prof = (u: number) => R * (0.8 + 0.3 * Math.sin(Math.PI * Math.min(1, u * 1.15)) * (1 - u * 0.2)) * Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, u - 0.55) / 0.45, 2)));
  const yAt = (u: number) => lerp(rimYc, bowlBot, u);
  const wineU = 0.5;
  // backdrop: light seamless paper with a soft halftone falloff and the glass's cast shadow
  c.fillStyle = PAPER;
  c.fillRect(0, 0, w, h);
  halftone(s, 0, 0, w, h, w * 0.022, (x, y) => 0.08 + 0.3 * Math.pow(y / h, 2) + 0.35 * Math.exp(-Math.pow((x - cx - w * 0.2) / (w * 0.12), 2) - Math.pow((y - baseY) / (h * 0.03), 2)));
  // wine: solid ink from its surface down to the bowl's bottom
  c.fillStyle = INK;
  c.beginPath();
  const N = 40;
  for (let i = 0; i <= N; i++) { const u = lerp(wineU, 1, i / N); c.lineTo(cx + prof(u), yAt(u)); }
  for (let i = N; i >= 0; i--) { const u = lerp(wineU, 1, i / N); c.lineTo(cx - prof(u), yAt(u)); }
  c.closePath(); c.fill();
  // the wine's surface ellipse, a little lighter at the far side (a meniscus highlight)
  const wr = prof(wineU), wy = yAt(wineU);
  c.fillStyle = '#3a3a3a';
  c.beginPath(); c.ellipse(cx, wy, wr, wr * 0.16, 0, 0, Math.PI * 2); c.fill();
  c.strokeStyle = PAPER; c.lineWidth = w * 0.008;
  c.beginPath(); c.ellipse(cx, wy, wr * 0.92, wr * 0.13, 0, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
  // glass outline
  c.strokeStyle = INK;
  c.lineWidth = w * 0.014;
  c.beginPath();
  for (let i = 0; i <= N; i++) { const u = i / N; c.lineTo(cx - prof(u), yAt(u)); }
  c.stroke();
  c.beginPath();
  for (let i = 0; i <= N; i++) { const u = i / N; c.lineTo(cx + prof(u), yAt(u)); }
  c.stroke();
  c.beginPath(); c.ellipse(cx, rimYc, prof(0), prof(0) * 0.16, 0, 0, Math.PI * 2); c.stroke();
  // stem and foot
  c.lineWidth = w * 0.02;
  c.beginPath(); c.moveTo(cx, bowlBot); c.lineTo(cx, stemBot); c.stroke();
  c.fillStyle = '#2a2a2a';
  c.beginPath(); c.ellipse(cx, baseY, R * 0.8, R * 0.12, 0, 0, Math.PI * 2); c.fill();
  // highlights on the glass (the catalogue photographer's strip light)
  c.strokeStyle = '#ffffff'; c.lineWidth = w * 0.02; c.lineCap = 'round';
  c.beginPath();
  for (let i = 0; i <= 12; i++) { const u = lerp(0.08, 0.42, i / 12); c.lineTo(cx - prof(u) * 0.72, yAt(u)); }
  c.stroke();
  c.lineWidth = w * 0.01;
  c.beginPath();
  for (let i = 0; i <= 12; i++) { const u = lerp(0.62, 0.9, i / 12); c.lineTo(cx - prof(u) * 0.6, yAt(u)); }
  c.stroke();
  c.lineCap = 'butt';
  // silhouette cut: around the glass, a scissor margin
  const outline: V2[] = [];
  const toW = (x: number, y: number): V2 => ({ x: x - w / 2, y: h / 2 - y });
  const m = w * 0.06;
  outline.push(toW(cx - R * 0.95 - m, baseY + m));
  outline.push(toW(cx + R * 0.95 + m, baseY + m));
  outline.push(toW(cx + R * 0.95 + m, baseY - m * 1.2));
  outline.push(toW(cx + m * 0.9, stemBot - m));
  for (let i = 12; i >= 0; i--) { const u = i / 12; outline.push(toW(cx + prof(u) + m, yAt(u))); }
  outline.push(toW(cx + prof(0) + m, rimYc - m * 1.5));
  outline.push(toW(cx - prof(0) - m, rimYc - m * 1.5));
  for (let i = 0; i <= 12; i++) { const u = i / 12; outline.push(toW(cx - prof(u) - m, yAt(u))); }
  outline.push(toW(cx - m * 0.9, stemBot - m));
  outline.push(toW(cx - R * 0.95 - m, baseY - m * 1.2));
  const poly = roughOutline(outline, m * 0.1, rng);
  return {
    w, h, poly, canvas: s.canvas,
    rimY: h / 2 - rimYc, rimR: prof(0), wineY: h / 2 - wy, wineR: wr, cx: 0,
  };
}

/** Texture from a canvas: sRGB, mipmapped (the camera looks at scraps at grazing angles). */
export function tex(canvas: HTMLCanvasElement, aniso: number) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = aniso;
  return t;
}
