// Claymation style: the raymarched set. One fragment shader (run at reduced resolution) marches a
// plasticine world: a table in front of a backdrop sweep, the shot's props, and up to 12 lyric words
// extruded from the text atlas. Clay gets fingerprint whorls and tool marks on its normals, warm key /
// cool fill wrap lighting, soft contact shadows and AO; the resin glass refracts the set behind it.
// Output: linear rgb + view distance in alpha (for the DOF upscale).
import type { ClayAtlas, AtlasItem } from './style-clay-atlas';
import { ATLAS_W, ATLAS_H, SPREAD } from './style-clay-atlas';
import { SS_TAP_GLSL } from '../engine/gl';

export const MAX_WORDS = 12;
const f = (x: number) => x.toFixed(4);
const rect = (it: AtlasItem) => `vec4(${f(it.x)}, ${f(it.y)}, ${f(it.w)}, ${f(it.h)})`;

export function claySetFrag(A: ClayAtlas) {
  const hero = A.get('hero');
  const edges = hero.cx1.slice(0, 9).map((x, i) => f((x + hero.cx0[i + 1]!) / 2)).join(', ');
  const item = (k: string) => { const it = A.get(k); return `const vec4 R_${k.toUpperCase()} = ${rect(it)}; const float B_${k.toUpperCase()} = ${f(it.base)};`; };
  return /* glsl */ `
uniform sampler2D atlas;
uniform vec3 camPos; uniform mat3 camRot; uniform float tanF;
uniform int shot; uniform float boil; uniform vec3 keyDir; uniform vec2 rtRes;
${SS_TAP_GLSL}
uniform vec4 wA[${MAX_WORDS}]; uniform vec4 wB[${MAX_WORDS}]; uniform vec4 wC[${MAX_WORDS}]; uniform vec4 wD[${MAX_WORDS}];
uniform vec4 uBub; uniform vec4 uBot; uniform vec2 qReveal; uniform vec3 dots;
uniform vec4 uHero; uniform float heroB[10]; uniform vec4 uFruit; uniform float fruitRot; uniform vec4 uChip[3];
uniform vec4 uReply; uniform vec4 replyRev; uniform vec4 uRing; uniform vec4 uCutter; uniform vec4 uPrompt; uniform float promptReveal;
uniform vec4 uGlass; uniform float wineLvl; uniform vec4 uClaim; uniform vec2 claimReveal; uniform vec4 uTag; uniform vec4 uHands;

const vec2 ATLAS = vec2(${ATLAS_W}.0, ${ATLAS_H}.0);
const float SPREAD = ${SPREAD}.0;
${['q1', 'q2', 'chatbot', 'replyA', 'replyB', 'tok', 'prompt', 'claim1', 'claim2', 'brim', 'hero', 'n1', 'n2', 'n3'].map(item).join('\n')}
const float HERO_EDGE[9] = float[9](${edges});
const float HERO_SPLIT = ${f((hero.cx1[4]! + hero.cx0[5]!) / 2)};
const float WPP_HERO = ${f(4.3 / hero.w)};
const float WPP_UI = 0.0038;
const float WPP_TWO = 0.0105;

// materials
#define M_TABLE 1.0
#define M_BACK 2.0
#define M_CREAM 3.0
#define M_CHAR 4.0
#define M_RED 5.0
#define M_GREEN 6.0
#define M_SEED 7.0
#define M_WINE 8.0
#define M_MUSTARD 9.0
#define M_GLASS 10.0
#define M_WOOD 11.0
#define M_WIRE 12.0

vec2 U(vec2 a, float d, float m) { return d < a.x ? vec2(d, m) : a; }
float sdRBox(vec3 p, vec3 b, float r) { vec3 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r; }
float extrude(float d2, float z, float h, float r) { vec2 w = vec2(d2 + r, abs(z) - h + r); return min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - r; }

/** Distance (world) to an atlas item's glyphs; q in world units, origin at the text's baseline-left. */
float textSD(vec2 q, vec4 R, float base, float wpp) {
  vec2 px = vec2(q.x / wpp + SPREAD, base - q.y / wpp);
  vec2 cl = clamp(px, vec2(1.0), R.zw - 1.0);
  float d = (texture(atlas, (R.xy + cl) / ATLAS).r - 0.5) * 2.0 * SPREAD;
  return (d + length(px - cl)) * wpp;
}
float textW(vec4 R, float wpp) { return (R.z - 2.0 * SPREAD) * wpp; }

/** Raised type on a slab's front face: text centred at c (baseline at c.y). reveal: px from the text's left. */
float raised(vec3 p, vec3 c, vec4 R, float base, float wpp, float reveal) {
  vec3 q = p - c; q.x += textW(R, wpp) * 0.5;
  float d2 = textSD(q.xy, R, base, wpp);
  d2 = max(d2, (q.x - reveal * wpp));
  return extrude(d2, q.z, 0.022, 0.012);
}

/** A standing clay slab (a chat bubble) with a little tail at the bottom left or right. */
float bubble(vec3 p, vec3 c, vec3 hs, float tail) {
  float d = sdRBox(p - c, hs, 0.07);
  vec3 tp = c + vec3(tail * (hs.x - 0.22), -hs.y - 0.06, 0.0);
  return smin(d, sdCapsule(p, tp + vec3(-tail * 0.12, 0.1, 0.0), tp + vec3(tail * 0.06, -0.06, 0.0), 0.05), 0.06);
}

// ---------------------------------------------------------------- the glass (resin) and its wine
float bowlR(float u) { return 0.03 + 0.5 * pow(sin(min(1.0, u * 1.12) * 1.5708), 0.72) - 0.05 * smoothstep(0.72, 1.0, u); }
const float G_Y0 = 0.62; const float G_H = 1.0;
float glassSD(vec3 p) {
  vec3 q = p - uGlass.xyz;
  if (length(q.xz) > 0.75 || q.y > 1.9 || q.y < -0.1) return max(length(q.xz) - 0.6, max(q.y - 1.7, -0.05 - q.y));
  float r = length(q.xz);
  float foot = sdRBox(vec3(r - 0.21, q.y - 0.02, 0.0), vec3(0.21, 0.022, 1.0), 0.02);
  float stem = sdCapsule(q, vec3(0.0, 0.02, 0.0), vec3(0.0, G_Y0 + 0.02, 0.0), 0.034 + 0.02 * smoothstep(0.45, 0.62, q.y));
  float u = clamp((q.y - G_Y0) / G_H, 0.0, 1.0);
  float solid = (r - bowlR(u)) * 0.85;
  float shell = max(abs(solid) - 0.012, max(q.y - (G_Y0 + G_H), G_Y0 - 0.02 - q.y));
  return min(min(foot, stem), shell);
}
float wineSD(vec3 p) {
  vec3 q = p - uGlass.xyz;
  float r = length(q.xz);
  float u = clamp((q.y - G_Y0) / G_H, 0.0, 1.0);
  float lvl = G_Y0 + G_H * wineLvl;
  return max((r - bowlR(u) + 0.02) * 0.85, max(q.y - lvl, G_Y0 + 0.02 - q.y));
}

// ---------------------------------------------------------------- the strawberry
float fprof(float y) { return 0.5 * pow(sin(min(1.0, y * 1.22) * 1.5708), 0.85) * (1.0 - 0.5 * smoothstep(0.8, 1.0, y)); }
vec2 fruit(vec3 p, vec2 res) {
  float S = uFruit.w;
  vec3 q = (p - uFruit.xyz) / S;
  if (length(q - vec3(0.0, 0.55, 0.0)) > 0.95) return U(res, (length(q - vec3(0.0, 0.55, 0.0)) - 0.85) * S, M_RED);
  float c = cos(fruitRot), s = sin(fruitRot); q.xz = mat2(c, -s, s, c) * q.xz;
  // the fruit hangs tip-down on the table: its tip at y = 0, shoulders at 1
  float rr = length(q.xz), a = atan(q.z, q.x);
  float lobe = 1.0 + 0.05 * cos(3.0 * a + q.y * 2.0);
  float body = (rr - fprof(clamp(q.y, 0.0, 1.0)) * lobe) * 0.7;
  body = smax(body, -q.y + 0.02, 0.05);
  body = smax(body, q.y - 1.0, 0.08);
  // pressed seeds: dimples on a staggered grid, a grain in each
  float row = clamp(floor(q.y * 14.0), 1.0, 12.0);
  float yc = (row + 0.5) / 14.0;
  float n = max(5.0, floor(6.2832 * fprof(yc) / 0.11));
  float ac = (floor(a / 6.2832 * n + 0.5 * mod(row, 2.0)) + 0.5 - 0.5 * mod(row, 2.0)) / n * 6.2832;
  float rc = fprof(yc) * (1.0 + 0.05 * cos(3.0 * ac + yc * 2.0));
  vec3 sc = vec3(cos(ac) * rc, yc, sin(ac) * rc);
  float dim = length(q - sc) - 0.038;
  body = smax(body, -dim, 0.012);
  res = U(res, body * S, M_RED);
  res = U(res, (length((q - sc * 0.975) * vec3(1.0, 0.65, 1.0)) - 0.016) * S, M_SEED);
  // calyx: five leaves flopped over the shoulders, and the stem
  float sec = 6.2832 / 5.0, k = floor(a / sec + 0.5);
  vec2 lq = mat2(cos(k * sec), sin(k * sec), -sin(k * sec), cos(k * sec)) * q.xz;
  vec3 l = vec3(lq.x - 0.2, q.y - 1.0 + 0.12 * lq.x, lq.y);
  float leaf = length(l / vec3(0.22, 0.035, 0.085)) - 1.0;
  leaf *= 0.03;
  res = U(res, smin(leaf, sdCapsule(q, vec3(0.0, 0.96, 0.0), vec3(0.03, 1.2, 0.01), 0.035), 0.03) * S, M_GREEN);
  return res;
}

// ---------------------------------------------------------------- lyric words
vec2 words(vec3 p, vec2 res) {
  for (int i = 0; i < ${MAX_WORDS}; i++) {
    vec4 A = wA[i], B = wB[i], C = wC[i], D = wD[i];
    if (D.y < 0.5) continue;
    float wpp = A.w;
    vec3 q = p - A.xyz;
    if (C.w > 0.5) q = vec3(q.x, -q.z, q.y - D.z); // lying flat on the table (up = away)
    float sm = min(C.x, C.y);
    q.x /= C.x; q.y /= C.y;
    // bound: the item's box
    vec2 lo = vec2(-SPREAD * wpp, (C.z - B.w) * wpp), hi = vec2((B.z - SPREAD) * wpp, C.z * wpp);
    vec3 bc = vec3((lo + hi) * 0.5, 0.0), bh = vec3((hi - lo) * 0.5, D.z);
    float bd = sdBox3(q - bc, bh) * sm;
    if (bd > res.x) continue;
    if (bd > 0.08) { res = U(res, bd, 20.0 + D.x); continue; }
    float d2 = textSD(q.xy, B, C.z, wpp);
    float d = extrude(d2, q.z, D.z, D.z * 0.9) * sm * 0.9;
    res = U(res, d, 20.0 + D.x);
  }
  return res;
}

// ---------------------------------------------------------------- the set
vec2 setSD(vec3 p) {
  // backdrop sweep (floor 0.26 below the table, curving up into the wall)
  // the room is floor (y > -0.26) and wall (z > -6) with a radius-2 cove between them
  vec2 q = vec2(2.0 - (p.z + 6.0), 2.0 - (p.y + 0.26));
  float sweep = 2.0 - length(max(q, 0.0)) - min(max(q.x, q.y), 0.0);
  vec2 res = vec2(sweep, M_BACK);
  // the table: a thick clay-covered slab
  res = U(res, sdRBox(p - vec3(-1.0, -0.13, 1.0), vec3(10.0, 0.13, 3.3), 0.06), M_TABLE);
  return res;
}

vec2 map(vec3 p, bool withGlass) {
  vec2 res = setSD(p);
  res = words(p, res);
  if (shot == 0) {
    // the chat: the user's bubble with the question pressed out of it, the bot's bubble thinking
    vec3 bp = p; bp.y = uBub.y + (bp.y - uBub.y) / uBub.w;
    float d = bubble(bp, uBub.xyz, vec3(1.85, 0.62, 0.07), 1.0) * min(uBub.w, 1.0);
    res = U(res, d, M_CREAM);
    res = U(res, raised(bp, uBub.xyz + vec3(0.0, 0.14, 0.07), R_Q1, B_Q1, 0.0056, qReveal.x) * min(uBub.w, 1.0), M_CHAR);
    res = U(res, raised(bp, uBub.xyz + vec3(0.0, -0.36, 0.07), R_Q2, B_Q2, 0.0056, qReveal.y) * min(uBub.w, 1.0), M_CHAR);
    if (uBot.w > 0.01) {
      vec3 cp = (p - uBot.xyz) / uBot.w;
      res = U(res, bubble(cp, vec3(0.0), vec3(0.5, 0.2, 0.07), -1.0) * uBot.w, M_CREAM);
      res = U(res, raised(cp, vec3(-0.05, 0.3, -0.03), R_CHATBOT, B_CHATBOT, 0.0026, 1e4) * uBot.w, M_CHAR);
      for (int i = 0; i < 3; i++) res = U(res, (length(cp - vec3(-0.25 + 0.25 * float(i), -0.02 + dots[i], 0.08)) - 0.055) * uBot.w, M_RED);
    }
  } else if (shot == 1) {
    // the hero word, cut into tokens in the second half
    vec3 q = p - uHero.xyz;
    vec3 bc = vec3(2.15 + uHero.w * 0.0, 0.3, 0.0);
    float bd = sdBox3(q - bc, vec3(2.4 + uHero.w, 0.6, 0.2));
    if (bd < 0.1) {
      float dh = 1e3;
      for (int side = 0; side < 2; side++) {
        if (side == 1 && uHero.w < 0.001) break;
        vec3 hq = q;
        hq.x += uHero.w * (side == 0 ? 1.0 : -1.0);
        float px = hq.x / WPP_HERO + SPREAD;
        int li = 0;
        for (int k = 0; k < 9; k++) li += px > HERO_EDGE[k] ? 1 : 0;
        hq.y -= heroB[li];
        float d2 = textSD(hq.xy, R_HERO, B_HERO, WPP_HERO);
        if (uHero.w > 0.001) d2 = side == 0 ? max(d2, (px - HERO_SPLIT) * WPP_HERO) : max(d2, (HERO_SPLIT - px) * WPP_HERO);
        dh = min(dh, extrude(d2, hq.z, 0.13, 0.1) * 0.7);
      }
      res = U(res, dh, M_RED);
    } else res = U(res, bd, M_RED);
    if (uFruit.w > 0.01) res = fruit(p, res);
    // number chips on the R's
    for (int i = 0; i < 3; i++) {
      vec4 c = uChip[i];
      if (c.w < 0.01) continue;
      vec3 cq = (p - c.xyz) / c.w;
      float coin = extrude(length(cq.xy) - 0.15, cq.z, 0.035, 0.025);
      res = U(res, coin * c.w, M_MUSTARD);
      vec4 R = i == 0 ? R_N1 : (i == 1 ? R_N2 : R_N3);
      float B = i == 0 ? B_N1 : (i == 1 ? B_N2 : B_N3);
      res = U(res, raised(cq, vec3(0.0, -0.085, 0.04), R, B, 0.0024, 1e4) * c.w, M_CHAR);
    }
    if (uReply.w > 0.01) {
      vec3 rq = (p - uReply.xyz) / uReply.w;
      res = U(res, bubble(rq, vec3(0.0), vec3(2.95, 0.66, 0.07), -1.0) * uReply.w, M_CREAM);
      // "There are [2] R's in "strawberry"." with the 2 as a big rolled clay numeral standing on the slab
      float wA = textW(R_REPLYA, WPP_UI), wB = textW(R_REPLYB, WPP_UI), w2 = textW(R_N2, WPP_TWO), g = 0.13;
      float x0 = -(wA + wB + w2 + 2.0 * g) * 0.5;
      res = U(res, raised(rq, vec3(x0 + wA * 0.5, 0.02, 0.07), R_REPLYA, B_REPLYA, WPP_UI, replyRev.x) * uReply.w, M_CHAR);
      res = U(res, raised(rq, vec3(x0 + wA + 2.0 * g + w2 + wB * 0.5, 0.02, 0.07), R_REPLYB, B_REPLYB, WPP_UI, replyRev.z) * uReply.w, M_CHAR);
      if (replyRev.y > 0.01) {
        vec3 tq = (rq - vec3(x0 + wA + g, 0.02, 0.12)) / replyRev.y;
        float d2 = textSD(tq.xy, R_N2, B_N2, WPP_TWO);
        res = U(res, extrude(d2, tq.z, 0.09, 0.07) * replyRev.y * uReply.w * 0.9, M_RED);
      }
      res = U(res, raised(rq, vec3(0.0, -0.46, 0.07), R_TOK, B_TOK, 0.0031, replyRev.w) * uReply.w, M_CHAR);
      res = U(res, raised(rq, vec3(-2.4, 0.74, -0.03), R_CHATBOT, B_CHATBOT, 0.003, 1e4) * uReply.w, M_CHAR);
    }
    if (uRing.w > 0.01) {
      vec3 tq = (p - uRing.xyz) / uRing.w;
      res = U(res, sdTorus(vec3(tq.x * 1.25, tq.z, tq.y), vec2(0.33, 0.028)) * uRing.w * 0.8, M_MUSTARD);
    }
    if (uCutter.w > 0.01) {
      // a wire clay-cutter: the wire through the gap, a wooden toggle on top
      vec3 c = uCutter.xyz;
      res = U(res, sdCapsule(p, c, c + vec3(0.0, 1.2, 0.0), 0.006), M_WIRE);
      res = U(res, sdCapsule(p, c + vec3(-0.09, 1.2, 0.0), c + vec3(0.09, 1.2, 0.0), 0.035), M_WOOD);
    }
    if (uPrompt.w > 0.01) {
      vec3 pq = (p - uPrompt.xyz) / uPrompt.w;
      res = U(res, bubble(pq, vec3(0.0), vec3(2.15, 0.3, 0.07), 1.0) * uPrompt.w, M_CREAM);
      res = U(res, raised(pq, vec3(0.0, -0.085, 0.07), R_PROMPT, B_PROMPT, 0.0034, promptReveal) * uPrompt.w, M_CHAR);
    }
  } else {
    res = U(res, wineSD(p), M_WINE);
    if (withGlass) res = U(res, glassSD(p), M_GLASS);
    if (uClaim.w > 0.01) {
      vec3 cq = (p - uClaim.xyz) / uClaim.w;
      res = U(res, bubble(cq, vec3(0.0), vec3(1.72, 0.5, 0.07), -1.0) * uClaim.w, M_CREAM);
      res = U(res, raised(cq, vec3(0.0, 0.1, 0.07), R_CLAIM1, B_CLAIM1, WPP_UI, claimReveal.x) * uClaim.w, M_CHAR);
      res = U(res, raised(cq, vec3(0.0, -0.3, 0.07), R_CLAIM2, B_CLAIM2, WPP_UI, claimReveal.y) * uClaim.w, M_CHAR);
      res = U(res, raised(cq, vec3(-1.3, 0.58, -0.03), R_CHATBOT, B_CHATBOT, 0.003, 1e4) * uClaim.w, M_CHAR);
    }
    if (uTag.w > 0.01) {
      // BRIM: a flag on a toothpick at rim height, and a row of beads across to the rim
      vec3 tq = p - uTag.xyz;
      float top = (G_Y0 + G_H) * uTag.w;
      res = U(res, sdCapsule(tq, vec3(0.0), vec3(0.0, top + 0.12, 0.0), 0.012), M_WOOD);
      vec3 fc = vec3(-0.3, top + 0.0, 0.0);
      res = U(res, sdRBox(tq - fc, vec3(0.29, 0.11, 0.02), 0.025), M_MUSTARD);
      res = U(res, raised(tq, fc + vec3(0.0, -0.05, 0.022), R_BRIM, B_BRIM, 0.0026, 1e4), M_CHAR);
      for (int i = 0; i < 5; i++) {
        float x = 0.09 + 0.1 * float(i);
        if (x > uHands.w) break;
        res = U(res, length(tq - vec3(x, top, 0.0)) - 0.02, M_RED);
      }
    }
    if (uHands.z > 0.5 || uHands.x > 0.01) {
      // out: ticks on the rim and the hands at ten past ten, lying across the glass
      vec3 hq = p - uGlass.xyz - vec3(0.0, G_Y0 + G_H + 0.03, 0.0);
      float R = bowlR(1.0);
      float a = atan(hq.x, -hq.z), sec = 6.2832 / 12.0, k = floor(a / sec + 0.5);
      if (mod(k + 12.0, 12.0) < uHands.z) {
        vec2 c = vec2(sin(k * sec), -cos(k * sec)) * R;
        res = U(res, length(hq - vec3(c.x, 0.0, c.y)) - (mod(k, 3.0) == 0.0 ? 0.03 : 0.02), M_CREAM);
      }
      vec2 dm = vec2(sin(1.0472), -cos(1.0472)), dh = vec2(sin(5.3233), -cos(5.3233));
      if (uHands.x > 0.01) res = U(res, sdCapsule(hq, vec3(0.0), vec3(dm.x, 0.0, dm.y) * 0.4 * uHands.x, 0.02), M_CHAR);
      if (uHands.y > 0.01) res = U(res, sdCapsule(hq, vec3(0.0), vec3(dh.x, 0.0, dh.y) * 0.27 * uHands.y, 0.026), M_CHAR);
      if (uHands.x > 0.01) res = U(res, length(hq) - 0.04, M_RED);
    }
  }
  // hand-made: every piece of plasticine is a little lumpy, and the lumps re-form on every stop-motion step
  if (res.x < 0.2 && res.y != M_BACK && res.y != M_GLASS && res.y != M_WIRE && res.y != M_TABLE)
    res.x += (0.011 * snoise(p * 3.6 + vec3(boil * 0.37, boil * 0.21, 0.0)) + 0.004 * snoise(p * 11.0 - vec3(boil * 0.29))) * (res.y == M_WINE ? 0.3 : 1.0);
  return res;
}

vec3 calcN(vec3 p, bool g) {
  const vec2 k = vec2(1.0, -1.0); const float e = 0.0012;
  return normalize(k.xyy * map(p + k.xyy * e, g).x + k.yyx * map(p + k.yyx * e, g).x + k.yxy * map(p + k.yxy * e, g).x + k.xxx * map(p + k.xxx * e, g).x);
}

vec2 march(vec3 ro, vec3 rd, bool g, out float t) {
  t = 0.02;
  vec2 h = vec2(1.0, 0.0);
  for (int i = 0; i < 96; i++) {
    vec3 p = ro + rd * t;
    h = map(p, g);
    if (h.x < 0.0008 * t) return vec2(t, h.y);
    t += h.x * 0.92;
    if (t > 26.0) return vec2(-1.0, 0.0);
  }
  // out of steps (grazing the table): take where we got to
  return h.x < 0.08 ? vec2(t, h.y) : vec2(-1.0, 0.0);
}

float softShadow(vec3 ro, vec3 rd) {
  float r = 1.0, t = 0.03;
  for (int i = 0; i < 16; i++) {
    float h = map(ro + rd * t, false).x;
    r = min(r, 5.0 * h / t);
    t += clamp(h, 0.04, 0.4);
    if (r < 0.02 || t > 5.0) break;
  }
  return clamp(r, 0.0, 1.0);
}
float calcAO(vec3 p, vec3 n) {
  float o = 0.0, s = 1.0;
  for (int i = 1; i <= 4; i++) {
    float h = 0.045 * float(i) * float(i);
    o += (h - map(p + n * h, false).x) * s; s *= 0.6;
  }
  return clamp(1.0 - 2.2 * o, 0.0, 1.0);
}

// fingerprint whorls and tool marks: a height field on the clay, turned into normal perturbation
float clayH(vec3 p, float fp, float tool) {
  vec3 q = p * 2.6 + boil * 0.013;
  float n = snoise(q * 0.9), mask = snoise(q * 0.45 + 7.0);
  float whorl = sin(n * 26.0) * smoothstep(0.1, 0.6, mask);
  float streak = sin(dot(p, normalize(vec3(0.8, 0.35, 0.5))) * 150.0 + n * 5.0) * smoothstep(0.2, 0.7, -mask);
  return whorl * fp + streak * tool + snoise(p * 9.0 + boil * 0.02) * 0.6 * (fp + tool);
}
vec3 clayNormal(vec3 p, vec3 n, float fp, float tool) {
  const float e = 0.0025;
  float h0 = clayH(p, fp, tool);
  vec3 g = vec3(clayH(p + vec3(e, 0, 0), fp, tool) - h0, clayH(p + vec3(0, e, 0), fp, tool) - h0, clayH(p + vec3(0, 0, e), fp, tool) - h0) / e;
  g -= n * dot(n, g);
  return normalize(n - g * 0.009);
}

vec3 albedo(float m, vec3 p) {
  if (m >= 20.0) {
    float k = m - 20.0;
    return k < 0.5 ? vec3(0.86, 0.76, 0.56) : (k < 1.5 ? vec3(0.9, 0.7, 0.42) : (k < 2.5 ? vec3(0.8, 0.74, 0.62) : vec3(0.58, 0.035, 0.028)));
  }
  if (m == M_TABLE) return vec3(0.2, 0.13, 0.085) * (0.9 + 0.12 * snoise(p.xz * vec2(0.8, 6.0)));
  if (m == M_BACK) return mix(vec3(0.17, 0.26, 0.26), vec3(0.23, 0.33, 0.32), smoothstep(-0.2, 3.0, p.y));
  if (m == M_CREAM) return vec3(0.84, 0.74, 0.55);
  if (m == M_CHAR) return vec3(0.026, 0.022, 0.02);
  if (m == M_RED) return vec3(0.6, 0.035, 0.028);
  if (m == M_GREEN) return vec3(0.09, 0.2, 0.036);
  if (m == M_SEED) return vec3(0.82, 0.58, 0.12);
  if (m == M_WINE) return vec3(0.12, 0.006, 0.016);
  if (m == M_MUSTARD) return vec3(0.75, 0.42, 0.05);
  if (m == M_WOOD) return vec3(0.45, 0.27, 0.12);
  return vec3(0.6);
}

vec3 lightClay(vec3 p, vec3 n, vec3 rd, float m) {
  vec3 alb = albedo(m, p);
  // hand-mixed plasticine is never one flat colour: streaks of the mix and grime in the dents
  if (m != M_BACK && m != M_GLASS) alb *= 0.88 + 0.2 * snoise(p * vec3(7.0, 2.5, 7.0) + 3.1) + 0.06 * snoise(p * 30.0);
  bool clay = m != M_BACK && m != M_WIRE;
  float fp = m == M_BACK ? 0.0 : (m == M_TABLE ? 0.35 : 1.0), tool = m == M_TABLE ? 0.8 : 0.45;
  if (m == M_CHAR || m == M_SEED) { fp *= 0.4; tool *= 0.3; }
  if (m == M_WINE) { fp *= 0.25; tool *= 0.15; }
  vec3 nb = clay ? clayNormal(p, n, fp, tool) : n;
  float sh = softShadow(p + n * 0.004, keyDir);
  float ao = calcAO(p, n);
  float wrap = 0.55;
  float kd = max(0.0, (dot(nb, keyDir) + wrap) / (1.0 + wrap));
  vec3 fillDir = normalize(vec3(0.85, 0.3, 0.55));
  float fd = max(0.0, (dot(nb, fillDir) + 0.5) / 1.5);
  vec3 key = vec3(1.0, 0.74, 0.5) * 2.35, fill = vec3(0.36, 0.46, 0.62) * 0.9, sky = vec3(0.34, 0.37, 0.42) * 0.42;
  vec3 col = alb * (key * kd * mix(0.25, 1.0, sh) + fill * fd * ao + sky * (0.5 + 0.5 * nb.y) * ao);
  col += alb * vec3(0.3, 0.17, 0.09) * 0.55 * (0.5 - 0.5 * nb.y) * ao; // warm bounce off the table
  // subsurface-ish warmth in the shadow terminator of red clay
  if (m == M_RED || m >= 23.0) col += alb * vec3(0.9, 0.2, 0.1) * 0.35 * smoothstep(0.0, 0.5, 1.0 - kd) * ao;
  // slight sheen of handled plasticine (wet wine clay a little more)
  vec3 h = normalize(keyDir - rd);
  float gloss = m == M_WINE ? 0.35 : (m == M_WIRE ? 0.8 : 0.07);
  col += key * gloss * pow(max(dot(nb, h), 0.0), m == M_WINE ? 60.0 : 18.0) * sh;
  return col;
}

vec3 envC(vec3 d) { return mix(vec3(0.05, 0.07, 0.075), vec3(0.3, 0.33, 0.34), smoothstep(-0.2, 0.8, d.y)) + vec3(1.0, 0.85, 0.7) * 3.0 * smoothstep(0.93, 0.985, dot(d, keyDir)); }

void main() {
  // motion-blur sub-frames each take one rotated-grid tap: the export gets anti-aliasing for free
  vec2 jit = ssTap < 0 ? vec2(0.0) : rgss(ssTap) / rtRes;
  vec2 ndc = (vUv + jit) * 2.0 - 1.0;
  vec3 rd = normalize(camRot * vec3(ndc.x * (16.0 / 9.0) * tanF, ndc.y * tanF, -1.0));
  vec3 ro = camPos;
  float t;
  vec2 h = march(ro, rd, shot == 2, t);
  vec3 col = vec3(0.02, 0.025, 0.028);
  float depth = 30.0;
  if (h.x > 0.0) {
    vec3 p = ro + rd * h.x;
    depth = h.x;
    if (h.y == M_GLASS) {
      // resin: fresnel reflection of the studio, and the set seen through it, bent by the surface
      vec3 n = calcN(p, true);
      float fres = 0.05 + 0.95 * pow(1.0 - max(dot(n, -rd), 0.0), 4.0);
      vec3 rr = normalize(refract(rd, n, 0.8) * 0.35 + rd * 0.65);
      float t2;
      vec2 h2 = march(p + rr * 0.03, rr, false, t2);
      vec3 behind = vec3(0.03);
      if (h2.x > 0.0) { vec3 p2 = p + rr * 0.03 + rr * h2.x; behind = lightClay(p2, calcN(p2, false), rr, h2.y); }
      float edge = pow(1.0 - max(dot(n, -rd), 0.0), 2.0);
      // clear resin: the set shows through almost untouched, the walls darken and catch the light toward the silhouette
      col = behind * vec3(0.95, 0.93, 0.88) * (1.0 - 0.75 * smoothstep(0.35, 1.0, edge)) + envC(reflect(rd, n)) * fres * 0.3;
      vec3 hh = normalize(keyDir - rd);
      col += vec3(1.0, 0.85, 0.7) * 5.0 * pow(max(dot(n, hh), 0.0), 120.0);
    } else {
      col = lightClay(p, calcN(p, shot == 2), rd, h.y);
    }
  }
  fragColor = vec4(col, depth);
}`;
}

/** Upscale with a small depth-of-field: a disc blur whose radius follows the circle of confusion. */
export const CLAY_DOF_FRAG = /* glsl */ `
uniform sampler2D src; uniform vec2 texel; uniform float focus; uniform float aperture;
float coc(float d) { return clamp(abs(d - focus) / max(d, 0.1) * aperture, 0.0, 3.5); }
void main() {
  vec4 c0 = texture(src, vUv);
  float r0 = coc(c0.a);
  vec3 acc = c0.rgb; float wsum = 1.0;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 2.39996, rr = sqrt((float(i) + 0.5) / 12.0);
    vec2 o = vec2(cos(a), sin(a)) * rr;
    vec4 s = texture(src, vUv + o * texel * max(r0, 0.6));
    float w = smoothstep(0.0, 1.0, coc(s.a) + 0.3) * (s.a < c0.a + 0.3 ? 1.0 : smoothstep(0.0, 1.5, r0));
    acc += s.rgb * w; wsum += w;
  }
  fragColor = vec4(acc / wsum, 1.0);
}`;
