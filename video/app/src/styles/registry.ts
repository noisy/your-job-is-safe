// Phase 1: ten candidate visual styles, each a real scene rendering the same moment of the song
// (first chorus, "It can't count the R's in strawberry / It can't fill a glass of wine").
// Scene modules live in src/scenes/style-<id>.ts. Notes are shown in Storybook and the report.
import type { TimelineEntry } from '../engine/engine';
import type { SceneClass } from '../engine/scene';
import type { Lyrics } from '../engine/lyrics';
import type { AudioData } from '../engine/audio';

export interface StyleNote {
  technique: string;
  palette: string;
  typography: string;
  lyrics: string;
  cost: string;
  risks: string;
}
export interface StyleDef { id: string; title: string; note: StyleNote }

type StyleModule = { default: SceneClass; NOTE?: StyleNote; TITLE?: string };
const modules = import.meta.glob<StyleModule>('../scenes/style-*.ts');
/**
 * The scene module of a style. The glob is fixed when the dev server starts (and, with HMR off, never
 * sees files created later), so fall back to a direct dynamic import, which Vite dev resolves fresh.
 */
const styleModule = (id: string): (() => Promise<StyleModule>) =>
  modules[`../scenes/style-${id}.ts`] ?? (() => import(/* @vite-ignore */ `/src/scenes/style-${id}.ts`));

/** The ten styles in presentation order (ids match src/scenes/style-<id>.ts). */
export const STYLE_IDS = ['linocut', 'riso', 'clay', 'patent', 'ascii', 'popup', 'ps1', 'scope', 'zine', 'pencil'] as const;
export type StyleId = (typeof STYLE_IDS)[number];

export async function loadStyleDefs(): Promise<StyleDef[]> {
  const out: StyleDef[] = [];
  for (const id of STYLE_IDS) {
    try {
      const mod = await styleModule(id)();
      out.push({ id, title: mod.TITLE ?? id, note: mod.NOTE ?? ({} as StyleNote) });
    } catch { /* not written yet */ }
  }
  return out;
}

/**
 * The shared preview window (6 bars, ~8.3 s): from the downbeat a bar before the chorus pickup (the
 * pre-chorus's "…the simplest thing!" and the drum fill lead in) to the first downbeat after
 * "…glass of wine" has rung out. ("R's" lands on the chorus's first downbeat.)
 */
export function previewWindow(ly: Lyrics, au: AudioData): [number, number] {
  const l1 = ly.get("It can't count the R", 0);
  const l2 = ly.get("It can't fill a glass of wine", 0);
  const before = au.downbeats.filter((d) => d <= l1.words[0]!.start);
  const a = before[before.length - 2] ?? before[0] ?? l1.start - 2;
  const b = au.downbeats.find((d) => d > l2.end - 0.05) ?? l2.end + 0.5;
  return [a, b];
}

export function styleTimeline(id: string) {
  return (ly: Lyrics, au: AudioData): TimelineEntry[] => {
    const [a, b] = previewWindow(ly, au);
    return [{
      id: `style-${id}`,
      load: styleModule(id),
      start: a,
      end: b,
    }];
  };
}
