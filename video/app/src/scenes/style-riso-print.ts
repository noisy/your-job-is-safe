// Risograph print toolkit for style-riso: ink separations, halftone screens, drum grain, ink starvation
// and misregistration, applied in the paper's own UV space (the dots are printed ON the sheet and follow it
// through the 3D world) and in world space for props and the table (the world itself is a riso print).
//
// A sheet's content is two "plates" drawn with Canvas2D in separation space: channel R = red drum,
// G = blue drum, B = yellow drum (each 0..1 ink coverage, drawn additively on black):
//   - solid plate: type and line art, thresholded to crisp solid ink,
//   - tint plate: tints and ghosts (density-carrying), screened into halftone dots.
// A 3D render in separation space (the illustration) is screened like a tint.
import * as THREE from 'three';
import { GLSL_COMMON } from '../engine/glsl/common';
import { hexToLinear } from '../engine/util';

export const RISO = {
  paper: '#F3EEE3',
  red: '#F15060', // Bright Red
  blue: '#3D5588', // Federal Blue
  yellow: '#FFE800', // Yellow
} as const;

/** Canvas2D fill for separation plates: coverage of the red, blue and yellow drums (0..1). */
export const sep = (r: number, b: number, y = 0) =>
  `rgb(${Math.round(255 * clamp01(r))},${Math.round(255 * clamp01(b))},${Math.round(255 * clamp01(y))})`;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

const v3 = (hex: string) => new THREE.Vector3(...hexToLinear(hex));

/** Uniforms shared by every riso material (one object: updating it updates all of them). */
export const inkUniforms = {
  uInk: { value: [v3(RISO.red), v3(RISO.blue), v3(RISO.yellow)] },
  uInkA: { value: [0.9, 0.93, 0.85] },
  uPaper: { value: v3(RISO.paper) },
  uLight: { value: new THREE.Vector3(-0.35, 0.85, 0.4).normalize() },
  uAmb: { value: 0.72 },
  /** Drum misregistration in mm (red, blue, yellow): applied in paper space to every sheet. */
  uMis: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
};

// Halftone + ink model shared by sheets and props.
const RISO_GLSL = /* glsl */ `
uniform vec3 uInk[3];
uniform float uInkA[3];
uniform vec3 uPaper;
uniform vec3 uLight;
uniform float uAmb;
const float ANG[3] = float[3](0.2618, 1.309, 0.7854); // red 15deg, blue 75deg, yellow 45deg

/** Amplitude-modulated round-dot screen. p in screen cells; c coverage; rough shifts the threshold (grain). */
float halftone(vec2 p, float ang, float c, float rough) {
  vec2 q = rot2(ang) * p;
  float f = 0.5 + 0.25 * (cos(TAU * q.x) + cos(TAU * q.y));
  float w = fwidth(f) * 0.8 + 1e-4;
  float th = 1.0 - c;
  float ink = smoothstep(th - w, th + w, f + rough);
  // cells smaller than a few px would alias into moire: fade to the flat tone
  float cellPx = 1.0 / max(length(fwidth(p)) * 0.7071, 1e-6) / PX_SCALE;
  ink = mix(c, ink, smoothstep(3.0, 6.0, cellPx));
  return ink * smoothstep(0.0, 0.04, c);
}
/** Multiply one ink layer over the paper. */
vec3 overprint(vec3 col, int k, float a) { return col * mix(vec3(1.0), uInk[k], sat(a)); }
`;

const SHEET_VERT = /* glsl */ `
precision highp float;
in vec3 position; in vec2 uv;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform vec2 uSize;     // m
uniform float uBow;     // m, arc across the sheet's width
uniform float uCurl;    // m, lift of the top edge
uniform float uCurlL;   // m, lift of the left edge (a sheet peeling up / flying)
uniform float uWave;    // m, travelling ripple amplitude
uniform float uWaveP;   // ripple phase
out vec2 vUv; out vec3 vW;
void main() {
  vUv = uv;
  vec3 p = position;
  float u = uv.x, v = uv.y;
  p.z += uBow * (1.0 - (2.0 * u - 1.0) * (2.0 * u - 1.0));
  float cv = smoothstep(0.55, 1.0, v); p.z += uCurl * cv * cv;
  float cl = smoothstep(0.5, 0.0, u); p.z += uCurlL * cl * cl;
  p.z += uWave * sin(u * 7.0 - uWaveP) * (0.4 + 0.6 * u);
  vec4 w = modelMatrix * vec4(p, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const SHEET_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv; in vec3 vW;
out vec4 fragColor;
uniform vec3 cameraPosition;
${GLSL_COMMON}
${RISO_GLSL}
uniform sampler2D uSolid, uTint, uIllus;
uniform vec4 uIllusRect;   // x, y, w, h in plate uv (y up)
uniform float uIllusOn;
uniform vec3 uIllusWipe;   // per drum: how far its pass has rolled over the illustration (0..1, top down)
uniform vec2 uMis[3];      // mm
uniform vec2 uLocalMis[3]; // mm, this sheet only
uniform vec2 uSize;        // mm
uniform float uSeed, uStarve, uCell, uGhost;
void main() {
  vec2 mm = vUv * uSize;
  vec3 col = uPaper;
  // paper tooth and fibres
  float fib = snoise(mm * vec2(0.35, 1.4) + uSeed) * 0.6 + snoise(mm * 3.7 + uSeed * 1.7) * 0.4;
  col *= 1.0 + 0.022 * fib;
  if (gl_FrontFacing) {
    for (int k = 0; k < 3; k++) {
      vec2 off = (uMis[k] + uLocalMis[k]) / uSize;
      vec2 uv = vUv - off;
      float s = texture(uSolid, uv)[k];
      float tc = texture(uTint, uv)[k];
      if (uIllusOn > 0.5) {
        vec2 iu = (uv - uIllusRect.xy) / uIllusRect.zw;
        float wipe = smoothstep(0.0, 0.04, uIllusWipe[k] * 1.04 - (1.0 - iu.y));
        if (iu.x > 0.0 && iu.x < 1.0 && iu.y > 0.0 && iu.y < 1.0) tc = max(tc, texture(uIllus, iu)[k] * wipe);
      }
      float fk = float(k);
      // drum grain: rough dot and type edges
      float g = snoise(mm * 7.3 + fk * 13.1 + uSeed) * 0.6 + (hash12(floor(mm * 11.0) + fk * 31.0 + uSeed) - 0.5) * 0.5;
      float ws = max(fwidth(s), 0.02);
      float sol = smoothstep(0.5 - ws, 0.5 + ws, s + 0.07 * g);
      float ht = halftone(mm / uCell, ANG[k], tc, 0.07 * g);
      // ink starvation: streaks along the feed direction, a lighter side, blotchy solids
      float streak = snoise(vec2(mm.x * 0.045 + fk * 5.3 + uSeed, mm.y * 0.004));
      float starve = 1.0 - uStarve * (0.22 * smoothstep(-0.3, 0.9, streak) + 0.12 * vUv.x);
      float mottle = 1.0 - 0.16 * smoothstep(0.2, 1.0, snoise(mm * 0.22 + fk * 3.1 + uSeed * 2.3));
      float a = uInkA[k] * starve * mottle;
      col = overprint(col, k, sol * a);
      col = overprint(col, k, ht * a);
    }
  }
  // the sheet in the room's light (normal from the curled surface)
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
  if (dot(n, cameraPosition - vW) < 0.0) n = -n;
  float dif = max(dot(n, uLight), 0.0);
  col *= uAmb + (1.0 - uAmb) * dif * 1.25;
  if (!gl_FrontFacing) col *= 0.9;
  fragColor = vec4(col, 1.0);
}`;

export interface PlateSpec { w: number; h: number }

/** A printed sheet in the world: curled paper mesh + its solid/tint plates. */
export class RisoSheet {
  root = new THREE.Object3D();
  mesh: THREE.Mesh;
  mat: THREE.RawShaderMaterial;
  solid: HTMLCanvasElement; tint: HTMLCanvasElement;
  sc: CanvasRenderingContext2D; tc: CanvasRenderingContext2D;
  solidTex: THREE.CanvasTexture; tintTex: THREE.CanvasTexture;
  private sig = '';
  /** Plate px per mm (solid plate). The tint plate is half that. */
  readonly ppmm: number;
  constructor(
    public wm: number, public hm: number,
    public draw: (s: CanvasRenderingContext2D, t: CanvasRenderingContext2D, time: number) => void,
    public signature: (time: number) => string,
    opts: { ppmm?: number; seed?: number; anisotropy?: number } = {},
  ) {
    this.ppmm = opts.ppmm ?? 3.6;
    const mmW = wm * 1000, mmH = hm * 1000;
    const mk = (s: number) => { const c = document.createElement('canvas'); c.width = Math.round(mmW * s); c.height = Math.round(mmH * s); return c; };
    this.solid = mk(this.ppmm); this.tint = mk(this.ppmm / 2);
    this.sc = this.solid.getContext('2d')!; this.tc = this.tint.getContext('2d')!;
    this.sc.scale(this.ppmm, this.ppmm); this.tc.scale(this.ppmm / 2, this.ppmm / 2);
    const tex = (c: HTMLCanvasElement) => {
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.NoColorSpace;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = opts.anisotropy ?? 8;
      return t;
    };
    this.solidTex = tex(this.solid); this.tintTex = tex(this.tint);
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: SHEET_VERT,
      fragmentShader: SHEET_FRAG,
      side: THREE.DoubleSide,
      uniforms: {
        ...inkUniforms,
        uSolid: { value: this.solidTex }, uTint: { value: this.tintTex }, uIllus: { value: null },
        uIllusRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uIllusOn: { value: 0 }, uIllusWipe: { value: new THREE.Vector3(1, 1, 1) },
        uLocalMis: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
        uSize: { value: new THREE.Vector2(mmW, mmH) },
        uSeed: { value: (opts.seed ?? 1) * 7.31 }, uStarve: { value: 1 }, uCell: { value: 1.15 }, uGhost: { value: 0 },
        uBow: { value: 0 }, uCurl: { value: 0 }, uCurlL: { value: 0 }, uWave: { value: 0 }, uWaveP: { value: 0 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(wm, hm, 40, 28), this.mat);
    this.mesh.rotation.x = -Math.PI / 2; // lies on the table, top edge toward -z, printed side up
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
  }
  get u() { return this.mat.uniforms; }
  /** Redraw both plates if their content signature changed (deterministic: content depends on the signature only). */
  update(time: number) {
    const s = this.signature(time);
    if (s === this.sig) return;
    this.sig = s;
    const { sc, tc } = this;
    for (const c of [sc, tc]) {
      c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; c.fillStyle = '#000';
      c.fillRect(0, 0, c.canvas.width, c.canvas.height); c.restore();
      c.globalCompositeOperation = 'lighter';
    }
    this.draw(sc, tc, time);
    this.solidTex.needsUpdate = true; this.tintTex.needsUpdate = true;
  }
  setIllus(tex: THREE.Texture | null, rect?: [number, number, number, number]) {
    this.u.uIllus!.value = tex;
    this.u.uIllusOn!.value = tex ? 1 : 0;
    if (rect) (this.u.uIllusRect!.value as THREE.Vector4).set(...rect);
  }
  /** Pose: position of the sheet's centre, yaw about world up, plus tilt (pitch about the sheet's x, roll about its z). */
  pose(x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0) {
    this.root.position.set(x, y, z);
    this.root.rotation.set(pitch, yaw, roll, 'YXZ');
  }
}

const WORLD_VERT = /* glsl */ `
precision highp float;
in vec3 position; in vec3 normal;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vW; out vec3 vN;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const MAX_SHADOWS = 8;
const WORLD_FRAG = /* glsl */ `
precision highp float;
in vec3 vW; in vec3 vN;
out vec4 fragColor;
uniform vec3 cameraPosition;
${GLSL_COMMON}
${RISO_GLSL}
uniform vec3 uBase;     // ink coverage (red, blue, yellow) of the lit surface
uniform vec3 uShade;    // extra ink in shadow
uniform float uCellW;   // world screen cell (m)
uniform float uSeed;
uniform float uLines;   // cutting-mat grid (table only)
uniform vec4 uShA[${MAX_SHADOWS}]; // centre xz, half size
uniform vec4 uShB[${MAX_SHADOWS}]; // cos, sin of yaw, lift (m), strength
uniform int uShN;
uniform vec2 uMisW[3];  // m, world-space misregistration
float shadowAt(vec2 p) {
  float s = 0.0;
  for (int i = 0; i < ${MAX_SHADOWS}; i++) {
    if (i >= uShN) break;
    vec4 A = uShA[i], B = uShB[i];
    vec2 q = p - A.xy - uLight.xz * B.z * 0.9;
    q = mat2(B.x, -B.y, B.y, B.x) * q;
    float r = 0.003 + B.z * 0.5;
    float d = sdBox(q, A.zw - r * 0.3);
    s = max(s, B.w * (1.0 - smoothstep(-r, r, d)));
  }
  return s;
}
void main() {
  vec3 n = normalize(vN);
  float dif = max(dot(n, uLight), 0.0);
  vec3 an = abs(n);
  vec2 p = an.y > max(an.x, an.z) ? vW.xz : (an.x > an.z ? vW.zy : vW.xy);
  float sh = (1.0 - dif) * 0.8 + (an.y > 0.9 ? shadowAt(vW.xz) : 0.0);
  vec3 col = uPaper;
  col *= 1.0 + 0.03 * snoise(p * 180.0 + uSeed);
  for (int k = 0; k < 3; k++) {
    vec2 pk = p - uMisW[k];
    float c = uBase[k] + uShade[k] * sh;
    if (uLines > 0.0 && k == 1) {
      // cutting-mat grid: faint 1 cm lines, 5 cm lines knocked out of the solid
      vec2 g = abs(fract(pk / 0.01 + 0.5) - 0.5) * 0.01;
      vec2 g5 = abs(fract(pk / 0.05 + 0.5) - 0.5) * 0.05;
      float aa = max(fwidth(pk.x), fwidth(pk.y));
      float l1 = 1.0 - smoothstep(0.00025, 0.00025 + aa * 1.5, min(g.x, g.y));
      float l5 = 1.0 - smoothstep(0.0005, 0.0005 + aa * 1.5, min(g5.x, g5.y));
      // lines fade out in the distance (they would average into a grey haze)
      float near = 1.0 - smoothstep(0.0004, 0.0016, aa);
      c = mix(c, c * 0.72, l1 * uLines * near);
      c = mix(c, 0.12, l5 * uLines * near);
    }
    float g = snoise(pk * 900.0 + float(k) * 7.0 + uSeed) * 0.6;
    float ht = halftone(pk / uCellW, ANG[k], sat(c), 0.07 * g);
    float mottle = 1.0 - 0.1 * smoothstep(0.2, 1.0, snoise(pk * 55.0 + float(k) * 3.1 + uSeed));
    col = overprint(col, k, ht * uInkA[k] * mottle);
  }
  col *= 0.9 + 0.1 * dif;
  fragColor = vec4(col, 1.0);
}`;

/** Matte world material: its shading printed as halftone ink recipes in world space. */
export function worldMaterial(base: [number, number, number], shade: [number, number, number], opts: { cell?: number; lines?: number; seed?: number } = {}) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: WORLD_VERT,
    fragmentShader: WORLD_FRAG,
    uniforms: {
      ...inkUniforms,
      uBase: { value: new THREE.Vector3(...base) },
      uShade: { value: new THREE.Vector3(...shade) },
      uCellW: { value: opts.cell ?? 0.0022 },
      uSeed: { value: opts.seed ?? 3 },
      uLines: { value: opts.lines ?? 0 },
      uShA: { value: Array.from({ length: MAX_SHADOWS }, () => new THREE.Vector4()) },
      uShB: { value: Array.from({ length: MAX_SHADOWS }, () => new THREE.Vector4()) },
      uShN: { value: 0 },
      uMisW: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
    },
  });
}

// ---- separation-space materials for 3D illustrations (rendered into an RT, then screened on a sheet) ----

const SEP_VERT = /* glsl */ `
precision highp float;
in vec3 position; in vec3 normal; in vec2 uv;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vW; out vec3 vN; out vec2 vUv; out vec3 vO;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vO = position; vUv = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/**
 * A material that writes ink coverage (red, blue, yellow) instead of colour.
 * `body` is GLSL computing `vec3 ink` from n (normal), v (to camera), dif (lambert), vUv, vO (object pos).
 */
export function sepMaterial(body: string, opts: { blend?: 'max' | 'normal'; side?: THREE.Side; depthWrite?: boolean; uniforms?: Record<string, THREE.IUniform> } = {}) {
  const m = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: SEP_VERT,
    fragmentShader: /* glsl */ `
precision highp float;
in vec3 vW; in vec3 vN; in vec2 vUv; in vec3 vO;
out vec4 fragColor;
uniform vec3 cameraPosition;
${GLSL_COMMON}
uniform vec3 uL;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  if (dot(n, v) < 0.0) n = -n;
  float dif = max(dot(n, uL), 0.0);
  vec3 ink = vec3(0.0);
  ${body}
  fragColor = vec4(sat(ink), 1.0);
}`,
    uniforms: { uL: { value: new THREE.Vector3(-0.5, 0.7, 0.6).normalize() }, ...(opts.uniforms ?? {}) },
    side: opts.side ?? THREE.FrontSide,
    depthWrite: opts.depthWrite ?? true,
  });
  if (opts.blend === 'max') {
    m.transparent = true;
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.MaxEquation;
    m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneFactor;
  }
  return m;
}
