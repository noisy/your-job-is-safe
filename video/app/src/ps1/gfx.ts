// PS1-era toolkit (the chosen style, shared by every scene; first written for Phase-1 style-ps1): an original 5x7 bitmap font, the PS1 material (vertex snapping to the
// low-res grid, perspective-correct textures, Gouraud lighting, per-vertex fog), pixel-art canvas textures,
// chunky extruded block letters and the 15-bit dither/quantise pass.
import * as THREE from 'three';
import { plain, textPathCommands, F } from '../engine/type';
import { PAPER } from './skin';

/** Internal render resolution: 16:9, exactly 5x smaller than 1920x1080 (nearest upscale). */
export const LW = 384, LH = 216;

// ---------------------------------------------------------------- bitmap font (5 wide, 7 high + 1 descender)
// rows top to bottom, 5 bits each (MSB = left column)
const G: Record<string, number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [28, 18, 17, 17, 17, 18, 28],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  a: [0, 0, 14, 1, 15, 17, 15, 0], b: [16, 16, 22, 25, 17, 17, 30, 0], c: [0, 0, 14, 16, 16, 17, 14, 0], d: [1, 1, 13, 19, 17, 17, 15, 0],
  e: [0, 0, 14, 17, 31, 16, 14, 0], f: [6, 9, 8, 28, 8, 8, 8, 0], g: [0, 0, 15, 17, 17, 15, 1, 14], h: [16, 16, 22, 25, 17, 17, 17, 0],
  i: [4, 0, 12, 4, 4, 4, 14, 0], j: [2, 0, 6, 2, 2, 2, 18, 12], k: [16, 16, 18, 20, 24, 20, 18, 0], l: [12, 4, 4, 4, 4, 4, 14, 0],
  m: [0, 0, 26, 21, 21, 17, 17, 0], n: [0, 0, 22, 25, 17, 17, 17, 0], o: [0, 0, 14, 17, 17, 17, 14, 0], p: [0, 0, 30, 17, 17, 30, 16, 16],
  q: [0, 0, 15, 17, 17, 15, 1, 1], r: [0, 0, 22, 25, 16, 16, 16, 0], s: [0, 0, 15, 16, 14, 1, 30, 0], t: [8, 8, 28, 8, 8, 9, 6, 0],
  u: [0, 0, 17, 17, 17, 19, 13, 0], v: [0, 0, 17, 17, 17, 10, 4, 0], w: [0, 0, 17, 17, 21, 21, 10, 0], x: [0, 0, 17, 10, 4, 10, 17, 0],
  y: [0, 0, 17, 17, 17, 15, 1, 14], z: [0, 0, 31, 2, 4, 8, 31, 0],
  '0': [14, 17, 19, 21, 25, 17, 14], '1': [4, 12, 4, 4, 4, 4, 14], '2': [14, 17, 1, 2, 4, 8, 31], '3': [31, 2, 4, 2, 1, 17, 14],
  '4': [2, 6, 10, 18, 31, 2, 2], '5': [31, 16, 30, 1, 1, 17, 14], '6': [6, 8, 16, 30, 17, 17, 14], '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14], '9': [14, 17, 17, 15, 1, 2, 12],
  ' ': [0, 0, 0, 0, 0, 0, 0], '.': [0, 0, 0, 0, 0, 12, 12], ',': [0, 0, 0, 0, 12, 4, 8], '!': [4, 4, 4, 4, 4, 0, 4],
  '?': [14, 17, 1, 2, 4, 0, 4], "'": [4, 4, 8, 0, 0, 0, 0], '"': [10, 10, 0, 0, 0, 0, 0], ':': [0, 12, 12, 0, 12, 12, 0],
  '-': [0, 0, 0, 31, 0, 0, 0], '>': [8, 4, 2, 1, 2, 4, 8], '<': [2, 4, 8, 16, 8, 4, 2], '/': [1, 1, 2, 4, 8, 16, 16],
  '(': [2, 4, 8, 8, 8, 4, 2], ')': [8, 4, 2, 2, 2, 4, 8], '_': [0, 0, 0, 0, 0, 0, 31], '|': [4, 4, 4, 4, 4, 4, 4],
  '%': [24, 25, 2, 4, 8, 19, 3], '+': [0, 4, 4, 31, 4, 4, 0], '=': [0, 0, 31, 0, 31, 0, 0], '#': [10, 10, 31, 10, 31, 10, 10],
  ';': [0, 12, 12, 0, 12, 4, 8], '@': [14, 17, 23, 21, 23, 16, 14], '&': [12, 18, 20, 8, 21, 18, 13], '$': [4, 15, 20, 14, 5, 30, 4],
  '*': [0, 4, 21, 14, 21, 4, 0], '[': [14, 8, 8, 8, 8, 8, 14], ']': [14, 2, 2, 2, 2, 2, 14], '~': [0, 0, 8, 21, 2, 0, 0],
  '^': [4, 10, 17, 0, 0, 0, 0], '{': [6, 8, 8, 16, 8, 8, 6], '}': [12, 2, 2, 1, 2, 2, 12], '°': [12, 18, 12, 0, 0, 0, 0],
  // symbols (drawn, not from any font): check mark, triangles, tab arrow, middle dot, copyright
  '✓': [0, 1, 1, 2, 18, 12, 4], '✗': [0, 17, 10, 4, 10, 17, 0], '▶': [16, 24, 28, 30, 28, 24, 16], '◀': [1, 3, 7, 15, 7, 3, 1],
  '▼': [0, 31, 31, 14, 14, 4, 0], '▲': [0, 4, 14, 14, 31, 31, 0], '→': [0, 4, 2, 31, 2, 4, 0], '·': [0, 0, 0, 12, 12, 0, 0],
  '©': [14, 17, 23, 25, 23, 17, 14], '█': [31, 31, 31, 31, 31, 31, 31], '♪': [6, 5, 4, 4, 12, 28, 8],
};
export const ADV = 6;
const norm = (s: string) => plain(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-');
/** Characters the bitmap font can draw (anything else draws as '?'). */
export const hasGlyph = (ch: string) => ch in G;
export const textW = (s: string, scale = 1) => norm(s).length * ADV * scale - scale;

/**
 * Draw bitmap text with its top-left at (x, y). `each(i)` may return a per-character pixel offset
 * (wavy/shaky text) or null to skip the character (typewriter). A 1-px drop shadow is optional.
 */
/** The 5x7 bitmap rows of a character (5 bits per row, MSB = left column), for dot-matrix and bulb signs. */
export const glyphRows = (ch: string): number[] => G[norm(ch)] ?? G['?']!;

/**
 * Draw bitmap text with its top-left at (x, y). `each(i)` may return a per-character pixel offset
 * (wavy/shaky text) or null to skip the character (typewriter). A 1-px drop shadow is optional.
 * In the paper skin the same cells are set in cut-paper lettering (Bricolage condensed), unless
 * `bitmap: true` (dot-matrix displays stay dot-matrix in both skins).
 */
export function pixText(c: CanvasRenderingContext2D, str: string, x: number, y: number, color: string, scale = 1,
  opts: { shadow?: string; each?: (i: number) => [number, number] | null; colorAt?: (i: number) => string; bitmap?: boolean } = {}) {
  const s = norm(str);
  if (PAPER && !opts.bitmap) return paperText(c, s, x, y, color, scale, opts);
  for (let i = 0; i < s.length; i++) {
    const g = G[s[i]!] ?? G['?']!;
    const off = opts.each ? opts.each(i) : [0, 0];
    if (!off) continue;
    const gx = Math.round(x + i * ADV * scale + off[0]), gy = Math.round(y + off[1]);
    for (const [pass, col] of (opts.shadow ? [[1, opts.shadow], [0, opts.colorAt?.(i) ?? color]] : [[0, opts.colorAt?.(i) ?? color]]) as [number, string][]) {
      c.fillStyle = col;
      for (let r = 0; r < g.length; r++) {
        const bits = g[r]!;
        for (let b = 0; b < 5; b++) if (bits & (16 >> b)) c.fillRect(gx + b * scale + pass * scale, gy + r * scale + pass * scale, scale, scale);
      }
    }
  }
}

/**
 * Cut-paper lettering in the bitmap font's layout: the run is set in Bricolage (its own kerning), then
 * tracked evenly so it spans exactly the bitmap run's width (textW), so every scene's layout still fits;
 * per-character offsets/skips (typing, waves) still apply per glyph.
 */
const paperAdv = new Map<string, number[]>();
function paperText(c: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, scale: number,
  opts: { shadow?: string; each?: (i: number) => [number, number] | null; colorAt?: (i: number) => string }) {
  const size = 10.2 * scale;
  c.save();
  c.font = `${size}px "${F.display(100, 800)}"`;
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  // natural glyph starts (prefix widths, so kerning is kept), per font size and string
  const key = `${size}|${s}`;
  let xs = paperAdv.get(key);
  if (!xs) {
    xs = [];
    for (let i = 0; i <= s.length; i++) xs.push(c.measureText(s.slice(0, i)).width);
    paperAdv.set(key, xs);
  }
  const nat = xs[s.length]!, target = s.length * ADV * scale - scale;
  // a little tracking when the natural run is narrower (capped, or short words gape), the rest split
  // evenly on both sides so the run stays centred in its cell span; squeeze (scale x) when wider
  const track = s.length > 1 ? Math.min(0.7 * scale, Math.max(0, (target - nat) / (s.length - 1))) : 0;
  const squeeze = nat > target && nat > 0 ? target / nat : 1;
  x += Math.max(0, target - nat - track * (s.length - 1)) / 2;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === ' ') continue;
    const off = opts.each ? opts.each(i) : [0, 0];
    if (!off) continue;
    const gx = x + (xs[i]! * squeeze + i * track) + off[0], by = y + 7 * scale + off[1];
    // drawn symbols (check, arrows, triangles…) keep their bitmap shapes, as paper cut-outs
    if (/[✓✗▶◀▼▲→·█♪©]/.test(ch)) {
      const g = G[ch]!, cx = x + i * ADV * scale + off[0];
      for (const [pass, col] of (opts.shadow ? [[1, opts.shadow], [0, opts.colorAt?.(i) ?? color]] : [[0, opts.colorAt?.(i) ?? color]]) as [number, string][]) {
        c.fillStyle = col;
        for (let r = 0; r < 7; r++) for (let b = 0; b < 5; b++) if (g[r]! & (16 >> b)) c.fillRect(cx + b * scale + pass * scale * 0.6, y + off[1] + r * scale + pass * scale * 0.6, scale, scale);
      }
      continue;
    }
    if (squeeze !== 1) { c.save(); c.translate(gx, by); c.scale(squeeze, 1); }
    const px = squeeze !== 1 ? 0 : gx, py = squeeze !== 1 ? 0 : by;
    if (opts.shadow) { c.fillStyle = opts.shadow; c.fillText(ch, px + scale * 0.6, py + scale * 0.6); }
    c.fillStyle = opts.colorAt?.(i) ?? color;
    c.fillText(ch, px, py);
    if (squeeze !== 1) c.restore();
  }
  c.restore();
}

// ---------------------------------------------------------------- PS1 material
/** Shared uniforms for every PS1 material (fog, light, the snapping grid). */
export const psGlobals = {
  uRes: { value: new THREE.Vector2(LW, LH) },
  uFogColor: { value: new THREE.Color() },
  uFogNear: { value: 4 },
  uFogFar: { value: 16 },
  uLightDir: { value: new THREE.Vector3(0.4, 0.8, 0.45).normalize() },
  uLightCol: { value: new THREE.Color(1.0, 0.86, 0.7) },
  uAmb: { value: new THREE.Color(0.22, 0.25, 0.36) },
  uSnap: { value: 1 },
};

const PS_VERT = /* glsl */ `
precision highp float;
in vec3 position; in vec3 normal; in vec2 uv;
uniform mat4 modelMatrix, modelViewMatrix, projectionMatrix;
uniform vec2 uRes; uniform float uSnap;
uniform float uFogNear, uFogFar;
uniform vec3 uLightDir, uLightCol, uAmb, uColor, uEmit;
uniform float uUnlit;
out vec3 vUvW; out vec3 vCol; out float vFog;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec4 clip = projectionMatrix * mv;
  // wobble: vertices snap to the low-res pixel grid (no sub-pixel precision)
  if (uSnap > 0.5 && clip.w > 0.0) {
    vec2 hr = uRes * 0.5;
    clip.xy = floor(clip.xy / clip.w * hr + 0.5) / hr * clip.w;
  }
  gl_Position = clip;
  // (the PS1's affine texture warp is off: on big floor and wall polygons it bent every tile and plank
  // line, which read as broken rather than retro. Vertex snapping, fog and the dither keep the look.)
  vUvW = vec3(uv, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * normal);
  float d = max(dot(n, uLightDir), 0.0);
  vCol = uColor * (uUnlit > 0.5 ? vec3(1.0) : uAmb + uLightCol * d) + uEmit;
  vFog = clamp((-mv.z - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
}`;
const PS_FRAG = /* glsl */ `
precision highp float;
in vec3 vUvW; in vec3 vCol; in float vFog;
out vec4 fragColor;
uniform sampler2D uMap; uniform float uHasMap; uniform vec3 uFogColor; uniform float uOpacity; uniform float uFogAmt;
void main() {
  vec2 uv = vUvW.xy / vUvW.z;
  vec4 tx = uHasMap > 0.5 ? texture(uMap, uv) : vec4(1.0);
  if (tx.a < 0.5) discard;
  vec3 c = tx.rgb * vCol;
  c = mix(c, uFogColor, vFog * uFogAmt);
  fragColor = vec4(c, uOpacity);
}`;

// ---------------------------------------------------------------- the paper skin's material (same uniforms)
// Folded low-poly paper: flat facets (the normal from screen-space derivatives), a warm key and soft
// ambient, a per-facet tone, paper fibre grain, a brighter, more saturated "paperized" palette, light haze.
const PAPER_VERT = /* glsl */ `
precision highp float;
in vec3 position; in vec3 normal; in vec2 uv;
uniform mat4 modelMatrix, modelViewMatrix, projectionMatrix;
uniform float uFogNear, uFogFar;
out vec2 vUv; out vec3 vW; out float vFog;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFog = clamp((-mv.z - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  vUv = uv;
  gl_Position = projectionMatrix * mv;
}`;
export const PAPERIZE_GLSL = /* glsl */ `
vec3 pToS(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
vec3 pToL(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
/** Lift the darks and push saturation: night-blue becomes dusk-blue card, black becomes charcoal paper. */
vec3 paperize(vec3 lin) {
  vec3 s = 0.16 + 0.84 * pToS(lin);
  float l = dot(s, vec3(0.299, 0.587, 0.114));
  return pToL(clamp(mix(vec3(l), s, 1.45), 0.0, 1.0));
}`;
const PAPER_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv; in vec3 vW; in float vFog;
out vec4 fragColor;
uniform sampler2D uMap; uniform float uHasMap;
uniform vec3 uColor, uEmit, uFogColor, uLightDir, uLightCol, uAmb;
uniform float uUnlit, uOpacity, uFogAmt;
uniform vec3 cameraPosition;
float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
${PAPERIZE_GLSL}
void main() {
  vec4 tx = uHasMap > 0.5 ? texture(uMap, vUv) : vec4(1.0);
  if (tx.a < 0.5) discard;
  vec3 base = paperize(tx.rgb * uColor);
  vec3 fn = normalize(cross(dFdx(vW), dFdy(vW)));
  if (dot(fn, cameraPosition - vW) < 0.0) fn = -fn;
  float d = max(dot(fn, normalize(uLightDir)), 0.0);
  float facet = h3(floor(fn * 7.0 + 0.5)) * 0.14 - 0.07;
  // paper fibre: soft mottling, fine grain and sparse darker flecks (in world space: it sticks to the card)
  float fib = vn(vW * 38.0) * 0.5 + vn(vW * 140.0) * 0.35 + vn(vW * 420.0) * 0.15;
  float fleck = step(0.985, h3(floor(vW * 260.0)));
  vec3 c = uUnlit > 0.5 ? base : base * (0.46 + 0.7 * uAmb + 0.72 * uLightCol * d);
  c *= 1.0 + (uUnlit > 0.5 ? 0.0 : facet) + (fib - 0.5) * 0.16 - fleck * 0.08;
  c += uEmit * 0.35;
  c = mix(c, paperize(uFogColor), vFog * uFogAmt * 0.5);
  fragColor = vec4(c, uOpacity);
}`;

export interface PsMatOpts { map?: THREE.Texture | null; color?: string | THREE.Color; emit?: string; unlit?: boolean; opacity?: number; side?: THREE.Side; additive?: boolean; fog?: number; depthWrite?: boolean }
export function psMat(o: PsMatOpts = {}) {
  const col = o.color instanceof THREE.Color ? o.color : new THREE.Color(o.color ?? '#ffffff');
  const m = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: PAPER ? PAPER_VERT : PS_VERT,
    fragmentShader: PAPER ? PAPER_FRAG : PS_FRAG,
    uniforms: {
      ...psGlobals,
      uMap: { value: o.map ?? null }, uHasMap: { value: o.map ? 1 : 0 },
      uColor: { value: col }, uEmit: { value: new THREE.Color(o.emit ?? '#000000') },
      uUnlit: { value: o.unlit ? 1 : 0 }, uOpacity: { value: o.opacity ?? 1 }, uFogAmt: { value: o.fog ?? 1 },
    },
    side: o.side ?? THREE.FrontSide,
    transparent: (o.opacity ?? 1) < 1 || !!o.additive,
    depthWrite: o.depthWrite ?? !((o.opacity ?? 1) < 1 || o.additive),
  });
  if (o.additive) { m.blending = THREE.AdditiveBlending; }
  return m;
}

// ---------------------------------------------------------------- flow material (a fill travelling along a mesh)
const FLOW_VERT = /* glsl */ `
precision highp float;
in vec3 position; in vec3 normal; in float aFlow;
uniform mat4 modelMatrix, modelViewMatrix, projectionMatrix;
uniform vec2 uRes; uniform float uSnap;
uniform float uFogNear, uFogFar;
uniform vec3 uLightDir, uLightCol, uAmb;
out vec3 vLit; out float vFog; out float vFlow;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec4 clip = projectionMatrix * mv;
  if (uSnap > 0.5 && clip.w > 0.0) { vec2 hr = uRes * 0.5; clip.xy = floor(clip.xy / clip.w * hr + 0.5) / hr * clip.w; }
  gl_Position = clip;
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vLit = uAmb + uLightCol * max(dot(n, uLightDir), 0.0);
  vFog = clamp((-mv.z - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  vFlow = aFlow;
}`;
const FLOW_FRAG = /* glsl */ `
precision highp float;
in vec3 vLit; in float vFog; in float vFlow;
out vec4 fragColor;
uniform vec3 uColor, uFill, uHead, uFogColor; uniform float uFlow, uBuild, uFogAmt;
void main() {
  if (vFlow > uBuild) discard;
  float filled = step(vFlow, uFlow);
  float head = filled * step(uFlow - 0.035, vFlow) * step(uFlow, 0.999);
  vec3 c = mix(uColor * vLit, uFill * (0.55 + 0.45 * vLit), filled);
  c = mix(c, uHead, head);
  fragColor = vec4(mix(c, uFogColor, vFog * uFogAmt), 1.0);
}`;
/**
 * A PS1 material whose `fill` colour travels along the mesh: the geometry carries a per-vertex `aFlow`
 * (0..1, e.g. arc length along a pipe); everything with aFlow <= `uniforms.uFlow` shows `fill` (water in a
 * pipe, paint in a groove), with a bright `head` band at the front. `uniforms.uBuild` (0..1) hides everything
 * beyond it (the mesh assembling itself along the same path).
 */
export function psFlowMat(o: { color?: string; fill?: string; head?: string; fog?: number } = {}) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: FLOW_VERT,
    fragmentShader: FLOW_FRAG,
    uniforms: {
      ...psGlobals,
      uColor: { value: new THREE.Color(o.color ?? '#8A93A8') }, uFill: { value: new THREE.Color(o.fill ?? '#4FA8FF') },
      uHead: { value: new THREE.Color(o.head ?? '#E8F6FF') }, uFlow: { value: 0 }, uBuild: { value: 1 }, uFogAmt: { value: o.fog ?? 1 },
    },
  });
}

// ---------------------------------------------------------------- pixel-art textures
/**
 * A Canvas2D texture drawn in texels (w x h). In the paper skin the canvas is `texScale` times larger with
 * the context pre-scaled (the same drawing code comes out crisp at full resolution, filtered linearly);
 * `canvas.width` is then physical, so never read pixels back from it (use glyphRows for dot matrices).
 */
export function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, repeat = false) {
  const k = texScale(w, h);
  const cv = document.createElement('canvas'); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  if (k !== 1) c.scale(k, k);
  draw(c);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  const f = PAPER ? THREE.LinearFilter : THREE.NearestFilter;
  t.magFilter = f; t.minFilter = f; t.generateMipmaps = false;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return { tex: t, canvas: cv, ctx: c };
}
/** Canvas upscale in the paper skin: up to 8x, keeping the long side ≤ 2048 px (1 in the PS1 skin). */
export const texScale = (w: number, h: number) => (PAPER ? Math.max(1, Math.min(8, Math.floor(2048 / Math.max(w, h)))) : 1);
/** Deterministic pixel noise helper for textures. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function shade(hex: string, k: number) {
  const c = new THREE.Color(hex); c.multiplyScalar(k);
  return `#${c.getHexString()}`;
}

// ---------------------------------------------------------------- block letters (chunky extrusions)
/** One extruded glyph, centred on x, baseline at y=0, height ~1 unit. Returns the geometry and its advance. */
export function blockGlyph(ch: string, family: string, depth = 0.34) {
  const S = 100;
  const cmds = textPathCommands(ch, family, S, 0, 0);
  const sp = new THREE.ShapePath();
  for (const c of cmds as any[]) {
    if (c.type === 'M') sp.moveTo(c.x / S, -c.y / S);
    else if (c.type === 'L') sp.lineTo(c.x / S, -c.y / S);
    else if (c.type === 'Q') sp.quadraticCurveTo(c.x1 / S, -c.y1 / S, c.x / S, -c.y / S);
    else if (c.type === 'C') sp.bezierCurveTo(c.x1 / S, -c.y1 / S, c.x2 / S, -c.y2 / S, c.x / S, -c.y / S);
  }
  const shapes = sp.toShapes();
  const g = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false, curveSegments: 2 });
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const cx = (bb.min.x + bb.max.x) / 2;
  g.translate(-cx, 0, -depth / 2);
  g.computeVertexNormals();
  return { geo: g, width: bb.max.x - bb.min.x };
}

// ---------------------------------------------------------------- the final pass: 15-bit colour with the PS1 ordered dither
export const PS_OUT_FRAG = /* glsl */ `
uniform sampler2D src; uniform vec2 res; uniform float dither;
const float DM[16] = float[16](-4.0, 0.0, -3.0, 1.0, 2.0, -2.0, 3.0, -1.0, -3.0, 1.0, -4.0, 0.0, 3.0, -1.0, 2.0, -2.0);
void main() {
  vec2 px = floor(vUv * res);
  vec3 c = texture(src, (px + 0.5) / res).rgb;
  vec3 s = toSRGB(sat(c)) * 255.0;
  int i = int(mod(px.x, 4.0)) + 4 * int(mod(px.y, 4.0));
  s += DM[i] * dither;
  s = floor(clamp(s, 0.0, 255.0) / 8.0) / 31.0;
  fragColor = vec4(toLinear(s), 1.0);
}`;

// ---------------------------------------------------------------- the paper skin's final pass
// Paper craft reads through two cues the material alone can't give: layers of card casting soft contact
// shadows on each other, and dark cut edges where one layer ends in front of another. Both come from the
// depth buffer: a small screen-space AO (12 taps, radius shrinking with distance) and a depth-jump edge.
export const PAPER_OUT_FRAG = /* glsl */ `
uniform sampler2D src; uniform sampler2D depth; uniform vec2 res; uniform float dither;
uniform float near, far, aoAmt, edgeAmt;
float lin(float d) { float z = d * 2.0 - 1.0; return 2.0 * near * far / (far + near - z * (far - near)); }
void main() {
  vec3 c = texture(src, vUv).rgb;
  float d0 = texture(depth, vUv).r;
  if (d0 >= 1.0) { fragColor = vec4(c, 1.0); return; }
  float z0 = lin(d0);
  vec2 px = 1.0 / res;
  // contact shadows: how much nearer geometry surrounds this point (within a world-ish radius)
  float r = clamp(26.0 / z0, 3.0, 40.0);
  float occ = 0.0;
  for (int k = 0; k < 12; k++) {
    float a = float(k) * 2.39996 + 0.5, rr = r * sqrt((float(k) + 0.5) / 12.0);
    float zs = lin(texture(depth, vUv + vec2(cos(a), sin(a)) * rr * px).r);
    float dz = z0 - zs;
    occ += smoothstep(0.02, 0.25, dz) * (1.0 - smoothstep(0.6, 1.4, dz));
  }
  float ao = 1.0 - aoAmt * occ / 12.0;
  // cut edges: a depth jump to a farther layer right next to this pixel
  float zr = lin(texture(depth, vUv + vec2(px.x * 1.5, 0.0)).r), zu = lin(texture(depth, vUv + vec2(0.0, px.y * 1.5)).r);
  float zl = lin(texture(depth, vUv - vec2(px.x * 1.5, 0.0)).r), zd = lin(texture(depth, vUv - vec2(0.0, px.y * 1.5)).r);
  float jump = max(max(zr, zl), max(zu, zd)) - z0;
  float edge = smoothstep(0.04 * z0, 0.12 * z0, jump) * edgeAmt;
  c *= ao * (1.0 - edge);
  fragColor = vec4(c, 1.0);
}`;
