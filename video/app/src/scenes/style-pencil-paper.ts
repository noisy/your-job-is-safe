// Pencil animatic: paper and graphite. The pen accumulates coverage per channel (graphite, non-photo
// blue, red pencil; negative graphite = the eraser) into a float target; this pass lays it onto drawing
// paper. Light strokes catch only the tooth of the paper, heavy ones fill it in and get a graphite sheen.
// The sheet is re-drawn on twos, so its tooth is re-seeded with every drawing (a pencil test's boil).
import * as THREE from 'three';
import { FSPass } from '../engine/gl';

const FRAG = /* glsl */ `
uniform sampler2D lines;
uniform float draw;     // drawing index (on twos)
uniform float tone;     // overall paper tone (the sheet vs. inside a panel)
uniform vec3 paperC;
uniform vec3 graphC;
uniform vec3 blueC;
uniform vec3 redC;

void main() {
  vec2 px = FRAG_PX;
  vec4 L = texture(lines, vUv);
  vec2 o = vec2(hash11(draw * 1.31 + 0.2), hash11(draw * 2.77 + 0.9)) * 700.0;
  vec2 q = px + o;
  // tooth: the fine grain a pencil skips over; fibres: long faint streaks in the sheet
  float tooth = snoise(q / 1.4) * 0.5 + 0.5;
  float tooth2 = snoise(q / 3.3 + 17.0) * 0.5 + 0.5;
  float th = mix(tooth, tooth2, 0.45);
  float fib = snoise(vec2(q.x / 90.0, q.y / 6.0)) * 0.5 + 0.5;
  float blot = fbm(px / 500.0 + draw * 0.003, 3);
  vec3 paper = paperC * (0.975 + 0.03 * fib + 0.025 * blot) * tone;

  float gr = max(L.r, 0.0);
  float er = max(-L.r, 0.0);
  float g = 1.0 - exp(-3.2 * gr);
  // light pressure: only the peaks of the tooth take graphite; heavy: filled in
  float take = smoothstep(0.2, 0.75, th + g * 0.7 - 0.28);
  float gi = g * mix(0.12, 1.0, take);
  vec3 col = mix(paper, graphC, gi * 0.96);
  // burnished sheen where graphite is heavy
  col += vec3(0.02, 0.022, 0.025) * smoothstep(0.7, 1.0, g) * tooth;

  float b = 1.0 - exp(-2.2 * max(L.g, 0.0));
  b *= mix(0.45, 1.0, smoothstep(0.1, 0.8, th + b * 0.5));
  col = mix(col, col * blueC, b);
  float r = 1.0 - exp(-2.4 * max(L.b, 0.0));
  r *= mix(0.5, 1.0, smoothstep(0.1, 0.8, th + r * 0.6));
  col = mix(col, col * redC, r);

  // the eraser: rubbed paper, a little brighter and smeared grey
  col = mix(col, paper * 1.03 - vec3(0.05) * fib, clamp(er * 0.6, 0.0, 0.7));
  fragColor = vec4(col, 1.0);
}`;

export function makePaper() {
  return new FSPass(FRAG, {
    lines: { value: null }, draw: { value: 0 }, tone: { value: 1 },
    paperC: { value: new THREE.Vector3(0.86, 0.83, 0.76) },
    graphC: { value: new THREE.Vector3(0.03, 0.03, 0.036) },
    blueC: { value: new THREE.Vector3(0.22, 0.52, 0.98) },
    redC: { value: new THREE.Vector3(0.95, 0.22, 0.14) },
  });
}
