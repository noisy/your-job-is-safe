// ASCII style: shaders. The 3D world renders into a small G-buffer (r = lit luminance, g = signal
// red, b = view depth, a = coverage); a fullscreen pass maps every character cell to a JetBrains
// Mono glyph: a density ramp for the shading, / \ | - _ where the depth or the light breaks.
import * as THREE from 'three';
import { GLSL_COMMON } from '../engine/glsl/common';
import { F, font } from '../engine/type';

/** The density ramp (dark → bright), then the edge glyphs. */
export const RAMP = ' .:-=+*#%@';
export const EDGES = '-|/\\_';
export const GLYPHS = RAMP + EDGES;
/** JetBrains Mono advance / cell height. */
export const CELL_ASPECT = 0.6;

export function glyphAtlas(): THREE.Texture {
  const gw = 72, gh = 120, n = GLYPHS.length;
  const cv = document.createElement('canvas');
  cv.width = gw * n; cv.height = gh;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#fff';
  g.font = font(F.mono(700), 100);
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  for (let i = 0; i < n; i++) g.fillText(GLYPHS[i]!, i * gw + gw / 2, gh * 0.76);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  return tex;
}

const VERT = /* glsl */ `
precision highp float;
in vec3 position; in vec3 normal;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vW; out vec3 vN; out vec3 vO; out vec3 vON; out float vDepth;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vO = position; vON = normal;
  vN = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
  vec4 v = viewMatrix * w;
  vDepth = -v.z;
  gl_Position = projectionMatrix * v;
}`;

export interface GOpts { mode?: number; sig?: number; gain?: number; side?: THREE.Side }

export class GShared {
  cam = { value: new THREE.Vector3() };
  light = { value: new THREE.Vector3(-0.4, 0.6, 0.75).normalize() };
}

/** mode 0 lit solid, 1 glass (max-blended fresnel rim), 2 floor grid, 3 emissive. */
export function gMaterial(sh: GShared, o: GOpts = {}) {
  const m = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: /* glsl */ `precision highp float;\n${GLSL_COMMON}
      in vec3 vW; in vec3 vN; in vec3 vO; in vec3 vON; in float vDepth;
      out vec4 fragColor;
      uniform vec3 uCam, uLight; uniform int uMode; uniform float uSig, uGain, uFlash;
      void main() {
        vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
        vec3 V = normalize(uCam - vW);
        float ndv = abs(dot(N, V));
        float depth = vDepth / 90.0;
        if (uMode == 2) {
          // the floor: a dim grid receding into the dark
          vec2 q = vW.xz / 2.0;
          vec2 gq = abs(fract(q) - 0.5) / fwidth(q);
          float line = 1.0 - smoothstep(0.5, 1.5, min(gq.x, gq.y));
          vec2 dots = abs(fract(vW.xz / 0.5) - 0.5);
          float fade = exp(-vDepth * 0.035);
          float lum = (0.02 + 0.16 * line) * fade;
          fragColor = vec4(lum, 0.0, depth, 0.0); // a = 0: the floor never draws edges
          return;
        }
        if (uMode == 1) {
          float rim = pow(1.0 - ndv, 2.2);
          float streak = smoothstep(0.9, 1.0, sin(atan(vO.z, vO.x) * 1.0 + 1.1)) * 0.6;
          fragColor = vec4((rim * 1.1 + streak * rim) * uGain, 0.0, 0.0, 0.0);
          return;
        }
        if (uMode == 3) { fragColor = vec4(uGain, uSig, depth, 1.0); return; }
        float seed = 0.0;
        if (uMode == 4) {
          // strawberry achenes: a staggered lattice of bright seeds on the red body
          float a = atan(vO.z, vO.x) / TAU * 13.0;
          float b = vO.y * 9.0;
          a += 0.5 * mod(floor(b), 2.0);
          vec2 q = fract(vec2(a, b)) - 0.5;
          seed = (1.0 - smoothstep(0.16, 0.24, length(q * vec2(1.0, 1.3)))) * smoothstep(0.93, 0.85, vO.y) * smoothstep(0.03, 0.1, vO.y);
        }
        float diff = max(dot(N, uLight), 0.0);
        float rim = pow(1.0 - ndv, 3.0);
        vec3 H = normalize(uLight + V);
        float spec = pow(max(dot(N, H), 0.0), 40.0);
        float lum = (0.16 + 0.8 * diff + 0.3 * rim + 0.35 * spec) * uGain + uFlash;
        fragColor = vec4(mix(lum, 1.35, seed), uSig * (1.0 - seed), depth, 1.0);
      }`,
    uniforms: {
      uCam: sh.cam, uLight: sh.light,
      uMode: { value: o.mode ?? 0 }, uSig: { value: o.sig ?? 0 }, uGain: { value: o.gain ?? 1 }, uFlash: { value: 0 },
    },
    side: o.side ?? THREE.FrontSide,
  });
  if (o.mode === 1) {
    m.transparent = true;
    m.depthWrite = false;
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.MaxEquation;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneFactor;
  }
  return m;
}

/** Cells → glyphs. uCell: cell height in logical px. */
export const ASCII_FRAG = /* glsl */ `
uniform sampler2D uG, uAtlas;
uniform float uCell, uNG, uNR, uEdgeGain, uTime;
uniform vec3 uPaper, uBg, uRed;
uniform vec2 uGridOff;
const float ASPECT = ${CELL_ASPECT.toFixed(2)};
vec4 G(vec2 px) { return texture(uG, px / vec2(1920.0, 1080.0)); }
float key(vec4 g) { return g.r * 0.9 + g.a * 0.25 + g.g * 0.3; }
void main() {
  vec2 px = FRAG_PX;
  vec2 cs = vec2(uCell * ASPECT, uCell);
  vec2 org = vec2(960.0, 540.0) + uGridOff;
  vec2 q = (px - org) / cs;
  vec2 c = floor(q);
  vec2 local = q - c;
  vec2 cc = (c + 0.5) * cs + org;
  // the cell's shade: four taps inside it
  vec2 d = cs * 0.25;
  vec4 g0 = G(cc + vec2(-d.x, -d.y)), g1 = G(cc + vec2(d.x, -d.y)), g2 = G(cc + vec2(-d.x, d.y)), g3 = G(cc + vec2(d.x, d.y));
  vec4 gm = (g0 + g1 + g2 + g3) * 0.25;
  // edges: gradient of shade and depth between the neighbouring cells
  vec4 gl = G(cc - vec2(cs.x, 0.0)), gr = G(cc + vec2(cs.x, 0.0)), gd = G(cc - vec2(0.0, cs.y)), gu = G(cc + vec2(0.0, cs.y));
  float kx = (key(gr) - key(gl)) * 0.6, ky = (key(gu) - key(gd)) * 0.6;
  float zx = (gr.b - gl.b), zy = (gu.b - gd.b);
  // depth breaks only count between objects (a > 0), so the receding floor stays quiet
  float objs = max(max(gl.a, gr.a), max(gu.a, gd.a));
  vec2 grad = (vec2(kx, ky) * 0.8 + vec2(zx, zy) * 6.0 * step(0.02, abs(vec2(zx, zy)))) * objs;
  float mag = length(grad) * uEdgeGain;
  float lum = gm.r;
  float sig = max(max(g0.g, g1.g), max(g2.g, g3.g));
  float idx;
  float bright;
  if (mag > 0.55) {
    float ang = atan(grad.y, grad.x) + PI * 0.5; // the edge runs across the gradient
    ang = mod(ang, PI);
    float e = ang < PI * 0.125 || ang > PI * 0.875 ? 0.0 : ang < PI * 0.375 ? 2.0 : ang < PI * 0.625 ? 1.0 : 3.0;
    if (e == 0.0 && local.y < 0.5 && gd.a < 0.5 && gm.a > 0.5) e = 4.0; // a floor-line edge: underscore
    idx = uNR + e;
    bright = clamp(0.85 + mag * 0.4, 0.0, 1.4);
  } else {
    float jitter = (hash12(c + 17.0) - 0.5) * 0.06;
    idx = floor(clamp(lum + jitter, 0.0, 1.0) * (uNR - 1.0) + 0.5);
    bright = 0.55 + 1.0 * clamp(lum, 0.0, 1.4);
  }
  // glyph coverage (textureGrad with the continuous coordinate: no mip seams at cell borders)
  vec2 auv = vec2((idx + local.x) / uNG, local.y);
  vec2 dq = vec2(dFdx(q.x), dFdy(q.y));
  float cov = textureGrad(uAtlas, auv, vec2(dq.x / uNG, 0.0), vec2(0.0, dq.y)).r;
  vec3 fg = mix(uPaper, uRed, smoothstep(0.3, 0.7, sig));
  vec3 col = uBg * (1.0 - 0.18 * length((px - vec2(960.0, 540.0)) / vec2(960.0, 540.0)));
  col = mix(col, fg * bright, cov);
  fragColor = vec4(col, 1.0);
}`;

/** A textured, premultiplied plane (terminal windows, labels) drawn into the final frame. */
export function planeMaterial(tex: THREE.Texture, uv: THREE.Vector4) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: /* glsl */ `precision highp float; in vec3 position; in vec2 uv; uniform mat4 modelMatrix, viewMatrix, projectionMatrix; out vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `precision highp float; in vec2 vUv; out vec4 fragColor; uniform sampler2D uTex; uniform vec4 uUV; uniform float uOpacity;
      void main() { vec4 c = texture(uTex, uUV.xy + vUv * uUV.zw); fragColor = vec4(c.rgb * c.a, c.a) * uOpacity; }`,
    uniforms: { uTex: { value: tex }, uUV: { value: uv }, uOpacity: { value: 1 } },
    transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
}
