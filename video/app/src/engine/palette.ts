import { hexToLinear } from './util';

// Master palette names shared by GLSL (C_INK, C_BONE, ...) and Canvas2D (rgba('signal')).
// Phase-1 style scenes may define their own local palettes; the chosen style's palette lands here.
export const HEX = {
  ink: '#12100E', // warm black
  ink2: '#1E1B18', // raised black
  graphite: '#5B5650', // dim lines, secondary text
  ash: '#A39C92', // mid grey
  bone: '#F3ECDF', // paper
  signal: '#E5322D', // strawberry red: the sung word, the missing R
  ember: '#FF7A45', // hot highlight
  blood: '#8E1A22', // wine
  acid: '#F2C230', // mustard: clocks, warnings
} as const;

export type PaletteKey = keyof typeof HEX;

/** Linear RGB triplets for GL uniforms. */
export const LIN: Record<PaletteKey, [number, number, number]> = Object.fromEntries(
  Object.entries(HEX).map(([k, v]) => [k, hexToLinear(v)]),
) as Record<PaletteKey, [number, number, number]>;

/** CSS rgba() for Canvas2D. Accepts a palette key or any #rrggbb. */
export function rgba(key: PaletteKey | string, a = 1): string {
  const hex = (HEX as Record<string, string>)[key] ?? key;
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
