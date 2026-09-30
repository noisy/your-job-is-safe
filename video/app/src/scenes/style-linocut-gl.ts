// Linocut style: shaders. The 3D world renders into a "plate" target whose channels are ink
// coverage (r = carbon black plate, g = vermilion plate); the composite pass then prints both plates
// on fibrous paper, the vermilion slightly off-register, with uneven ink take.
import * as THREE from 'three';
import { GLSL_COMMON } from '../engine/glsl/common';

const VERT = /* glsl */ `
precision highp float;
in vec3 position; in vec3 normal;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vW; out vec3 vN; out vec3 vO; out vec3 vON;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
  vO = position; vON = normal;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** Gouge strokes: white V-cuts (tapered, broken) across coordinate u, running along v; width from darkness. */
const GOUGE = /* glsl */ `
float gougeAt(float u, float v, float dark, float seed) {
  float row = floor(u);
  float f = abs(fract(u) - 0.5);
  float rnd = hash12(vec2(row, seed));
  float segLen = mix(3.0, 9.0, rnd);
  float vv = v / segLen + rnd * 7.3;
  float sv = fract(vv);
  float rs = hash12(vec2(row * 1.7 + floor(vv), seed + 3.1));
  float taper = pow(sin(PI * sv), 0.22 + 0.3 * rs);
  // the cut's half-width: wide in the light (fully carved in the highlights), gone in the dark
  float light = 1.0 - dark;
  float cut = 0.62 * sat(light * 1.12 + (rs - 0.5) * 0.18) * mix(1.0, taper, 0.85);
  cut = mix(cut, 0.6, smoothstep(0.78, 0.98, light));
  float aa = max(fwidth(u), 1e-4) * 0.8 * PX_SCALE;
  return smoothstep(cut - aa, cut + aa, f); // 1 = ink (uncarved), 0 = carved paper
}
/** Black strokes left standing on a carved-away ground: sparse short dashes in the light, full lines in shadow. */
float chatterAt(float u, float v, float dark, float seed) {
  float row = floor(u);
  float f = abs(fract(u) - 0.5);
  float rnd = hash12(vec2(row, seed));
  float vv = v / mix(2.0, 6.0, rnd) + rnd * 5.1;
  float sv = fract(vv);
  float rs = hash12(vec2(row * 3.1 + floor(vv), seed + 1.7));
  float present = step(rs, mix(0.03, 1.4, dark));
  float taper = pow(sin(PI * sv), 0.5);
  float hw = mix(0.06, 0.4, dark) * taper * present;
  float aa = max(fwidth(u), 1e-4) * 0.8 * PX_SCALE;
  return 1.0 - smoothstep(hw - aa, hw + aa, f);
}
float chatter(float u, float v, float dark, float seed) {
  float fw = max(fwidth(u), 1e-6) * PX_SCALE;
  float lr = log2(fw * 7.0);
  float lod = max(lr, 0.0) + min(lr + 2.0, 0.0);
  float l0 = floor(lod), lf = fract(lod);
  float s0 = exp2(-l0), s1 = exp2(-l0 - 1.0);
  return mix(chatterAt(u * s0, v * s0, dark, seed + l0), chatterAt(u * s1, v * s1, dark, seed + l0 + 1.0), smoothstep(0.0, 1.0, lf));
}
// keeps the cuts between ~5 and ~40 px apart on screen: fade to a coarser set when they would alias
float gouge(float u, float v, float dark, float seed) {
  float fw = max(fwidth(u), 1e-6) * PX_SCALE; // u per logical px
  float lr = log2(fw * 5.5);
  float lod = max(lr, 0.0) + min(lr + 2.5, 0.0);
  float l0 = floor(lod), lf = fract(lod);
  float s0 = exp2(-l0), s1 = exp2(-l0 - 1.0);
  float a = gougeAt(u * s0, v * s0, dark, seed + l0);
  float b = gougeAt(u * s1, v * s1, dark, seed + l0 + 1.0);
  return mix(a, b, smoothstep(0.0, 1.0, lf));
}`;

export interface PlateOpts {
  mode?: number; // 0 generic, 1 lathe bands, 2 ground, 3 wood block, 4 glass (contours only), 5 strawberry, 6 wine
  ink?: [number, number]; // black / red amount this object prints
  blackStart?: number; // darkness where the black gouge lines start (0 for black objects, ~0.5 for red ones)
  freq?: number; // gouge lines per world unit
  u?: [number, number, number]; v?: [number, number, number]; // object-space axes across / along the gouges
  bias?: number; contrast?: number;
  solidFace?: boolean; // faces whose object normal points +z print solid (the face of a type sort)
  seed?: number;
  side?: THREE.Side;
  transparent?: boolean; // glass: max-blended contour lines over what is behind
}

export class PlateShared {
  light = { value: new THREE.Vector3(-0.62, 1.0, -0.28).normalize() };
  cam = { value: new THREE.Vector3() };
  shadow = { value: null as THREE.Texture | null };
  shadowVP = { value: new THREE.Matrix4() };
  shadowTexel = { value: 1 / 2048 };
  face = { value: null as THREE.Texture | null };
}

export function plateMaterial(sh: PlateShared, o: PlateOpts = {}) {
  const u = (x: number[] | undefined, d: number[]) => new THREE.Vector3(...((x ?? d) as [number, number, number]));
  const m = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: /* glsl */ `precision highp float;\n${GLSL_COMMON}\n${GOUGE}
      in vec3 vW; in vec3 vN; in vec3 vO; in vec3 vON;
      out vec4 fragColor;
      uniform vec3 uCam, uLight; uniform int uMode; uniform vec2 uInk; uniform float uBlackStart, uFreq, uBias, uContrast, uSolid, uSeed;
      uniform vec3 uU, uV;
      uniform sampler2D uShadow; uniform mat4 uShadowVP; uniform float uShadowTexel;
      uniform sampler2D uFace; uniform float uFaceOn; uniform vec4 uFaceRect, uFaceUV; uniform float uReveal;
      uniform vec2 uFaceInk; // ink of a solid printing face
      uniform vec3 uHalf; // wood blocks: half size (box edges)
      uniform float uPress; // wood blocks: 0..1 while pressing (darkens the block)
      float shadowAt(vec3 w, vec3 n) {
        vec4 p = uShadowVP * vec4(w + n * 0.04, 1.0);
        vec3 s = p.xyz / p.w * 0.5 + 0.5;
        if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 || s.z > 1.0) return 1.0;
        float d = s.z - 0.002, sum = 0.0;
        for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) sum += d <= texture(uShadow, s.xy + vec2(i, j) * uShadowTexel * 1.5).r ? 1.0 : 0.0;
        return sum / 9.0;
      }
      void main() {
        vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
        vec3 V = normalize(uCam - vW);
        float sh = shadowAt(vW, N);
        float diff = max(dot(N, uLight), 0.0);
        float light = 0.16 + 0.84 * diff * sh;
        float dark = sat((1.0 - light - 0.5) * uContrast + 0.5 + uBias);
        float ndv = abs(dot(N, V));
        float rim = 1.0 - ndv;
        float black = 0.0, red = 0.0;
        // gouges run within the face: when the face is (nearly) perpendicular to an axis, swap in one that lies in it
        vec3 ua = uU, va = uV;
        if (abs(dot(vON, ua)) > 0.7) ua = normalize(cross(vON, va));
        if (abs(dot(vON, va)) > 0.7) va = normalize(cross(ua, vON));
        float u = dot(vO, ua) * uFreq, v = dot(vO, va) * uFreq;
        if (uMode == 1 || uMode == 5 || uMode == 6) { // lathe: bands around the circumference
          float r = length(vO.xz);
          u = vO.y * uFreq; v = atan(vO.z, vO.x) * max(r, 0.2) * uFreq;
        }
        if (uMode == 2) { u = vW.z * uFreq; v = vW.x * uFreq; }
        u += 0.35 * snoise(vec2(v * 0.045, u * 0.03 + uSeed));
        if (uMode == 2) {
          // the carved-away ground: sparse chatter strokes, denser in cast shadow
          float patchy = smoothstep(0.45, 0.8, snoise(vW.xz * 0.09 + uSeed) * 0.5 + 0.5);
          float dg = uBias + patchy * 0.22 + (1.0 - sh) * 0.72;
          black = chatter(u, v, sat(dg), uSeed);
        } else if (uMode == 4) {
          // glass: carved away but for its contours and a couple of reflections
          float c = smoothstep(0.62, 0.9, rim);
          float refl = smoothstep(0.93, 0.99, abs(sin(atan(vO.z, vO.x) * 1.0 + 0.9))) * smoothstep(0.6, 0.3, rim) * step(0.5, vO.y);
          black = c;
          // carved meridians on the shadow side of the bowl, following its form
          float mer = atan(vO.z, vO.x) * 11.0;
          float side = smoothstep(0.55, 0.85, dark) * step(0.5, vO.y) * smoothstep(0.1, 0.4, rim);
          black = max(black, chatter(mer, vO.y * 20.0, side * 0.35, uSeed) * side);
        } else {
          float edge = smoothstep(0.55, 0.85, rim) * (uMode == 3 ? 0.4 : 1.0);
          float dk = max(dark, edge);
          if (uMode == 3) {
            // a wood type block drawn in line: grain strokes on the carved-light faces, black box edges
            vec3 q = abs(vO) / uHalf;
            float m1 = max(q.x, max(q.y, q.z));
            float m2 = q.x + q.y + q.z - m1 - min(q.x, min(q.y, q.z));
            vec3 e = uHalf - abs(vO);
            float ed = (m1 == q.x) ? min(e.y, e.z) : (m1 == q.y) ? min(e.x, e.z) : min(e.x, e.y);
            float edge = 1.0 - smoothstep(0.035, 0.06, ed);
            float grain = snoise(vec2(dot(vO, va) * 0.9, dot(vO, ua) * 5.0 + uSeed));
            float db = sat(dk * 0.9 - 0.05 + uPress * 0.15);
            black = max(chatter(u + 0.6 * grain, v, db, uSeed), edge);
            fragColor = vec4(black, 0.0, 0.0, 1.0);
            return;
          }
          float db = sat((dk - uBlackStart) / max(1.0 - uBlackStart, 1e-3));
          black = uInk.x * gouge(u, v, db, uSeed);
          // the red plate: mostly solid, the highlights carved out along the same strokes
          red = uInk.y * gouge(u * 0.5 + 0.25, v * 0.5, sat(dk * 1.7 + 0.25), uSeed + 5.0);
          if (uMode == 5) {
            // strawberry achenes: a staggered lattice of small carved teardrops with a black tick
            float a = atan(vO.z, vO.x) / TAU * 22.0;
            float b = vO.y * 15.0;
            a += 0.5 * mod(floor(b), 2.0);
            vec2 q = fract(vec2(a, b)) - 0.5;
            vec2 qs = q * vec2(1.0, 1.35);
            float d = length(qs + vec2(0.0, 0.07 * sign(qs.y)));
            float cut = 1.0 - smoothstep(0.17, 0.2, d);
            float tick = 1.0 - smoothstep(0.045, 0.07, length(qs - vec2(0.0, 0.05)));
            float top = smoothstep(0.93, 0.86, vO.y) * smoothstep(0.03, 0.12, vO.y);
            red *= 1.0 - cut * top;
            black = max(black * (1.0 - cut * top), tick * top);
          }
          if (uMode == 6 && vON.y > 0.9) {
            // the wine's surface: concentric carved rings
            float rr = length(vO.xz) * uFreq * 1.4;
            red = uInk.y * gougeAt(rr, atan(vO.z, vO.x) * 6.0, 0.5 + 0.35 * smoothstep(-0.2, 0.9, -vO.x / max(length(vO.xz), 1e-3)), uSeed);
            black = uInk.x * gougeAt(rr + 0.5, atan(vO.z, vO.x) * 6.0, 0.15, uSeed) * 0.0;
          }
          if (uSolid > 0.5 && vON.z > 0.6) {
            // the printing face of a sort: solid, with a few stray nicks from the knife
            // the printing face: mostly ink, with gouges where the light catches it (carved, not flat)
            float fd = sat(0.93 - 0.35 * diff * sh);
            float cuts = gouge(vO.y * uFreq * 1.6 + 0.3 * snoise(vO.xy * 0.7 + uSeed), vO.x * uFreq * 1.6, fd, uSeed + 9.0);
            black = uFaceInk.x * cuts;
            red = uFaceInk.y * cuts;
          }
          if (uFaceOn > 0.5 && vON.z > 0.6) {
            vec2 fuv = (vO.xy - uFaceRect.xy) / uFaceRect.zw;
            if (fuv.x >= 0.0 && fuv.x <= 1.0 && fuv.y >= 0.0 && fuv.y <= 1.0) {
              vec4 t = texture(uFace, uFaceUV.xy + fuv * uFaceUV.zw);
              float rv = smoothstep(uReveal, uReveal - 0.012, fuv.x);
              black = t.r * rv; red = t.g * rv;
            }
          }
        }
        fragColor = vec4(black, red, 0.0, 1.0);
      }`,
    uniforms: {
      uCam: sh.cam, uLight: sh.light, uShadow: sh.shadow, uShadowVP: sh.shadowVP, uShadowTexel: sh.shadowTexel,
      uFace: sh.face,
      uMode: { value: o.mode ?? 0 },
      uInk: { value: new THREE.Vector2(...(o.ink ?? [1, 0])) },
      uBlackStart: { value: o.blackStart ?? 0 },
      uFreq: { value: o.freq ?? 6 },
      uU: { value: u(o.u, [0, 1, 0]) }, uV: { value: u(o.v, [1, 0, 0]) },
      uBias: { value: o.bias ?? 0 }, uContrast: { value: o.contrast ?? 1.2 },
      uSolid: { value: o.solidFace ? 1 : 0 },
      uSeed: { value: o.seed ?? 1 },
      uFaceOn: { value: 0 }, uFaceRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uFaceUV: { value: new THREE.Vector4(0, 0, 1, 1) }, uReveal: { value: 1 },
      uPress: { value: 0 },
    },
    side: o.side ?? THREE.FrontSide,
  });
  if (o.transparent) maxBlend(m);
  return m;
}

/** Ink accumulates as max(coverage) per plate (prints and glass contours over what is below). */
export function maxBlend(m: THREE.Material) {
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.MaxEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneFactor;
}

/** Depth from the light (the shadow map): writes gl_FragCoord.z. */
export function depthMaterial() {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: /* glsl */ `precision highp float; in vec3 position; uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
      void main() { gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `precision highp float; out vec4 fragColor; void main() { fragColor = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0); }`,
    side: THREE.DoubleSide,
  });
}

/**
 * A printed item (a stamped word or mark) lying on the bed: samples the print atlas (blurred glyph
 * masks: r = black, g = red), thresholded so pressure spreads the ink; a held stamp smears.
 */
export function printMaterial(atlas: THREE.Texture) {
  const m = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: /* glsl */ `precision highp float; in vec3 position; in vec2 uv; uniform mat4 modelMatrix, viewMatrix, projectionMatrix; out vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `precision highp float;\n${GLSL_COMMON}
      in vec2 vUv; out vec4 fragColor;
      uniform sampler2D uAtlas; uniform vec4 uUV; uniform float uInk, uPress, uSeed; uniform vec2 uSmear;
      vec2 cov(vec2 uv) { return texture(uAtlas, uUV.xy + clamp(uv, 0.0, 1.0) * uUV.zw).rg; }
      void main() {
        vec2 m = cov(vUv);
        // a held stamp slides: the ink drags along the slide, fading
        for (int k = 1; k <= 5; k++) { float s = float(k) / 5.0; m = max(m, cov(vUv - uSmear * s) * (1.0 - 0.45 * s)); }
        float th = mix(0.5, 0.3, uPress);
        vec2 w = fwidth(m) * 0.9 + 0.015;
        vec2 ink = smoothstep(th - w, th + w, m);
        // hard pressing squeezes a pale rim of ink out past the letter edge
        vec2 squeeze = smoothstep(th * 0.45 - w, th * 0.45 + w, m) * (1.0 - ink) * 0.5 * smoothstep(0.55, 1.0, uPress);
        vec2 o = (ink + squeeze) * uInk;
        // clean paper around the letters (premultiplied: the ground's chatter is wiped under the halo)
        float halo = smoothstep(0.03, 0.2, texture(uAtlas, uUV.xy + clamp(vUv, 0.0, 1.0) * uUV.zw).b) * uInk;
        halo *= smoothstep(0.0, 0.04, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
        float a = max(halo, max(o.x, o.y));
        fragColor = vec4(o, 0.0, a);
      }`,
    uniforms: {
      uAtlas: { value: atlas }, uUV: { value: new THREE.Vector4(0, 0, 1, 1) }, uInk: { value: 0 }, uPress: { value: 0.4 },
      uSmear: { value: new THREE.Vector2() }, uSeed: { value: 0 },
    },
  });
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.polygonOffsetUnits = -4;
  return m;
}

/** Composite: paper, then the vermilion plate (off-register), then the black plate, both with uneven ink take. */
export const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D uPlate; uniform vec2 uReg; uniform float uRegRot, uPull, uFlash;
uniform vec3 uPaper, uInkC, uRed;
float fibres(vec2 p) {
  // long thin fibres (anisotropic noise) + pulp flecks
  float a = snoise(vec2(p.x * 0.012, p.y * 0.19)) * 0.5 + snoise(vec2(p.x * 0.19, p.y * 0.012) + 7.0) * 0.5;
  float fl = smoothstep(0.72, 0.9, snoise(p * 0.06 + 3.0));
  return a * 0.5 + 0.5 - fl * 0.25;
}
void main() {
  vec2 px = FRAG_PX;
  vec2 res = vec2(1920.0, 1080.0);
  float pull = uPull; // each shot is a new pull: the paper and the ink take shift
  vec2 pp = px + vec2(pull * 173.0, pull * 91.0);
  vec4 pl = texture(uPlate, vUv);
  vec2 c = vUv - 0.5;
  vec2 ruv = rot2(uRegRot) * (c * res) / res + 0.5 + uReg / res;
  float redC = texture(uPlate, ruv).g;
  float blackC = pl.r;
  float fib = fibres(pp);
  float big = snoise(pp * 0.004 + pull) * 0.5 + 0.5;
  float fine = hash12(floor(pp * 0.9)) ;
  float med = snoise(pp * 0.05 + 11.0 + pull) * 0.5 + 0.5;
  // ink take: thins where the paper's tooth is high and the roller left less ink
  float salt = smoothstep(0.82, 0.9, snoise(pp * 0.31 + pull * 7.0)) * smoothstep(0.55, 0.9, med); // round specks where the ink skipped
  float takeK = sat(1.0 - 0.1 * smoothstep(0.6, 0.95, fib * 0.5 + med * 0.5 + big * 0.3 - 0.1) - 0.8 * salt);
  float takeR = sat(1.0 - 0.12 * smoothstep(0.55, 0.95, med * 0.6 + big * 0.5 + fib * 0.2 - 0.1) - 0.8 * step(0.99, hash12(floor(pp * 0.4) + 3.0)) * smoothstep(0.4, 0.8, big));
  vec3 paper = uPaper * (0.93 + 0.1 * fib + 0.03 * big);
  vec3 col = paper;
  col = mix(col, col * (uRed / uPaper), redC * takeR);
  col = mix(col, uInkC * (0.97 + 0.06 * big), blackC * takeK * 0.98);
  col += uFlash * vec3(0.06, 0.05, 0.04);
  fragColor = vec4(col, 1.0);
}`;
