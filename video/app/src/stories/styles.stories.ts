// Phase 1: one story per candidate style. Every story renders the same moment of the song (the first
// chorus's first two lines) with its audio, a play/scrub control, and the style's note.
import type { Meta, StoryObj } from '@storybook/html-vite';
import { Engine } from '../engine/engine';
import { PW, PH } from '../engine/gl';
import { styleTimeline, previewWindow, loadStyleDefs } from '../styles/registry';
import { mountPlayer } from '../player';

let current: { engine: Engine; destroy: () => void } | null = null;

function teardown() {
  if (!current) return;
  current.destroy();
  current.engine.renderer.dispose();
  current.engine.renderer.forceContextLoss();
  current = null;
}

function renderStyle(id: string) {
  teardown();
  const root = document.createElement('div');
  root.style.cssText = 'display:grid;grid-template-rows:minmax(0,1fr) auto;height:100vh;background:#070707;color:#e8e2d6;font:13px/1.45 ui-sans-serif,system-ui';
  const stage = document.createElement('div');
  stage.style.cssText = 'min-height:0';
  const notes = document.createElement('div');
  notes.style.cssText = 'padding:10px 16px 14px;border-top:1px solid #2a2724;max-height:34vh;overflow:auto';
  root.append(stage, notes);
  const canvas = document.createElement('canvas');
  canvas.width = PW;
  canvas.height = PH;
  const engine = new Engine(canvas, styleTimeline(id));
  void (async () => {
    await engine.init();
    const range = previewWindow(engine.lyrics, engine.audio);
    const p = mountPlayer(stage, engine, 'audio/song.mp3', { range, loop: true });
    current = { engine, destroy: p.destroy };
    const def = (await loadStyleDefs()).find((d) => d.id === id);
    if (def) {
      const n = def.note;
      const row = (k: string, v: string) => `<div style="display:grid;grid-template-columns:110px 1fr;gap:10px;margin:2px 0"><b style="color:#9c968c;font-weight:500">${k}</b><span>${v ?? ''}</span></div>`;
      notes.innerHTML = `<div style="font-size:16px;margin-bottom:6px"><b>${def.title}</b> <span style="color:#9c968c">(${id}) · segment ${range[0].toFixed(2)}–${range[1].toFixed(2)} s</span></div>`
        + row('technique', n.technique) + row('palette', n.palette) + row('typography', n.typography)
        + row('lyrics', n.lyrics) + row('render cost', n.cost) + row('risks', n.risks);
    }
  })();
  return root;
}

const meta: Meta = { title: 'Phase 1 · Styles' };
export default meta;
type Story = StoryObj;

// (plain object literals: Storybook indexes story names statically)
export const S01_Linocut: Story = { name: '01 · Linocut relief print', render: () => renderStyle('linocut') };
export const S02_Riso: Story = { name: '02 · Risograph two-colour', render: () => renderStyle('riso') };
export const S03_Clay: Story = { name: '03 · Claymation SDF', render: () => renderStyle('clay') };
export const S04_Patent: Story = { name: '04 · Patent drawing', render: () => renderStyle('patent') };
export const S05_Ascii: Story = { name: '05 · Terminal ASCII-on-3D', render: () => renderStyle('ascii') };
export const S06_Popup: Story = { name: '06 · Pop-up paper book', render: () => renderStyle('popup') };
export const S07_PS1: Story = { name: '07 · PS1 low-poly', render: () => renderStyle('ps1') };
export const S08_Scope: Story = { name: '08 · Oscilloscope vector', render: () => renderStyle('scope') };
export const S09_Zine: Story = { name: '09 · Xerox punk zine', render: () => renderStyle('zine') };
export const S10_Pencil: Story = { name: '10 · Pencil animatic', render: () => renderStyle('pencil') };
