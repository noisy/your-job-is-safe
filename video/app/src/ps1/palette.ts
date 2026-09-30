// The PS1 palette (docs/TREATMENT.md, "Style bible"). sRGB hex, for Canvas2D textures and psMat colours.
export const P = {
  fog: '#141B2E', // night-blue fog and clear colour
  key: '#FFDBB3', // warm key light
  beige: '#C9BFA3', // CRT beige (the chatbot's casing, DEV's monitor)
  beigeDark: '#9A917A',
  hoodie: '#3F7A5A', // DEV
  hair: '#3A2A1E',
  skin: '#E0B08A',
  jeans: '#2B3350',
  uiBg: 'rgba(14,20,48,0.9)', // panels
  uiEdge: '#05070F',
  uiLine: '#E8E4D8', // bone-white pixel text
  uiDim: '#8C93B8',
  uiNavy: '#2E4A8C',
  key2: '#FFD84A', // key words in the dialogue
  title: '#FFD23F', // block-title caps
  titleSide: '#D9482B', // block-title sides
  fail: '#FF4B5C', // the AI's mistakes
  failSide: '#8E1A2A',
  fix: '#5BE37D', // the mistakes fixed
  fixSide: '#1E6B3A',
  bot: '#8CD3FF', // the chatbot's eyes and voice
  wood: '#7A5230',
  ink: '#1B1B2A',
} as const;
