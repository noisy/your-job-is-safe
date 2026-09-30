// The render skin, read once from the page URL: `?skin=paper` renders the same scenes as colourful
// low-poly paper craft (full resolution, faceted folded paper, cut-paper lettering) instead of the PS1
// look (384x216, vertex snapping, 15-bit dither, 5x7 bitmap font). Scenes normally don't need to know;
// they can branch on SKIN for small per-skin tweaks.
export type Skin = 'ps1' | 'paper';
function readSkin(): Skin {
  if (typeof location === 'undefined') return 'ps1';
  return new URLSearchParams(location.search).get('skin') === 'paper' ? 'paper' : 'ps1';
}
export const SKIN: Skin = readSkin();
export const PAPER = SKIN === 'paper';
