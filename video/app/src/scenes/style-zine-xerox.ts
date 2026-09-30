// Xerox punk zine: the photocopy. The lit 3D collage is rendered to a texture and "copied": luminance
// thresholded into black toner (stippled where the original was grey), uneven toner density, dust and
// dropouts, and one spot colour laid over by a second, slightly
// misregistered pass. The copier's light bar can sweep across as a wipe between two renders.
import * as THREE from 'three';
import { FSPass } from '../engine/gl';

export const XEROX_FRAG = /* glsl */ `
uniform sampler2D srcA;
uniform sampler2D srcB;
uniform float wipe;      // light-bar position across the frame (0..1; it travels right to left, the new shot is behind it); < 0: no sweep
uniform float barGlow;   // light-bar brightness
uniform float gen;       // generation seed (changes on twos: every re-copy is a new copy)
uniform float contrast;  // threshold sharpness multiplier
uniform float flip;      // 1: toner and paper swap (the hit)
uniform vec3 paperC;
uniform vec3 tonerC;
uniform vec3 spotC;
uniform vec2 res;

vec3 src(vec2 uv) {
  if (wipe >= 0.0 && uv.x > wipe) return texture(srcB, uv).rgb;
  return texture(srcA, uv).rgb;
}
float spotOf(vec3 c) { return smoothstep(0.1, 0.32, c.r - max(c.g, c.b * 0.6)); }

void main() {
  vec2 uv = vUv;
  vec2 px = FRAG_PX;
  vec3 c = src(uv);
  float spotHere = spotOf(c);
  float L = pow(max(luma(c), 0.0), 1.0 / 2.2);
  // the spot-coloured ink reads as paper for the toner pass (it is printed by its own pass below)
  L = mix(L, 1.0, spotHere);

  // uneven toner: a low-frequency density drift plus the stipple that turns greys into specks
  float lf = fbm(px / 420.0 + vec2(gen * 0.137, gen * 0.071), 3);
  float st = hash12(floor(px / 1.35) + gen * 13.1);
  float st2 = snoise(px / 2.6 + gen * 7.3) * 0.5 + 0.5;
  float th = 0.5 + 0.07 * lf + (mix(st, st2, 0.55) - 0.5) * 0.34;
  float soft = 0.03 / contrast;
  float ink = 1.0 - smoothstep(th - soft, th + soft, L);

  // toner dust on the white, dropouts in the black
  vec2 dc = floor(px / 2.0);
  float dust = step(0.9975, hash12(dc + gen * 3.7));
  float clump = smoothstep(0.72, 0.8, snoise(px / 9.0 + gen * 1.9)) * step(0.83, hash12(floor(px / 23.0) + gen));
  float drop = step(0.994, hash12(dc + gen * 5.3 + 17.0)) + smoothstep(0.75, 0.85, snoise(px / 5.0 - gen * 2.3)) * 0.8;
  ink = max(ink, max(dust, clump * 0.9));
  ink *= 1.0 - clamp(drop, 0.0, 1.0) * 0.9;

  // (streaks, the lid's shadow and edge darkening are printed on the sheets in 3D, not on the frame)

  ink = mix(ink, 1.0 - ink, flip);
  vec3 col = mix(paperC, tonerC, clamp(ink, 0.0, 1.0));

  // the spot pass, misregistered by a couple of px, with its own speckle
  vec2 off = vec2(2.2, -1.6) / res;
  float spot = spotOf(src(uv + off));
  spot *= 0.9 + 0.1 * hash12(floor(px / 1.5) + gen * 2.0);
  spot *= 1.0 - step(0.996, hash12(dc + gen * 9.1));
  vec3 spotMix = mix(spotC, spotC * tonerC * 8.0, clamp(ink, 0.0, 1.0));
  col = mix(col, spotMix, clamp(spot, 0.0, 1.0));

  // the copier's light bar: a hot band with a green-white core sweeping across
  if (wipe >= 0.0) {
    float d = (uv.x - wipe) * res.x / res.y;
    float core = exp(-pow(d / 0.012, 2.0));
    float halo = exp(-abs(d) / 0.06);
    col = col + vec3(0.8, 1.0, 0.85) * (core * 3.0 + halo * 0.6) * barGlow;
  }
  fragColor = vec4(col, 1.0);
}`;

export function makeXerox() {
  return new FSPass(XEROX_FRAG, {
    srcA: { value: null }, srcB: { value: null },
    wipe: { value: -1 }, barGlow: { value: 1 }, gen: { value: 0 }, flip: { value: 0 }, contrast: { value: 1 },
    paperC: { value: new THREE.Vector3(0.84, 0.83, 0.79) },
    tonerC: { value: new THREE.Vector3(0.012, 0.012, 0.014) },
    spotC: { value: new THREE.Vector3(1.0, 0.04, 0.22) },
    res: { value: new THREE.Vector2(1920, 1080) },
  });
}
