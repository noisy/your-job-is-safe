// The edit: which scene plays when (docs/TREATMENT.md, "Scene plan"). Boundaries are anchored to lyric
// lines and snapped to the downbeat grid, so they follow the aligned data (data/lyrics.json,
// data/audio.json). Never hard-code times here or in scenes.
import type { TimelineEntry } from './engine/engine';
import type { SceneClass } from './engine/scene';
import type { Lyrics } from './engine/lyrics';
import type { AudioData } from './engine/audio';

const modules = import.meta.glob<{ default: SceneClass }>('./scenes/*.ts');
export const scene = (name: string) => () => {
  // (the glob is fixed at server start; a scene file created later still loads via a direct import)
  const m = modules[`./scenes/${name}.ts`];
  return m ? m() : import(/* @vite-ignore */ `/src/scenes/${name}.ts`);
};

/**
 * Silence after the song (final.ts pads the audio to match): the credits hold for CREDITS_TAIL s, then the
 * YouTube end screen (two fixed video tiles) runs for the rest (YouTube end screens are 5–20 s long).
 */
export const CREDITS_TAIL = 0.6;
export const END_TAIL = 10.6;

export function makeTimeline(ly: Lyrics, au: AudioData): TimelineEntry[] {
  const db = au.downbeats;
  /** The last downbeat at or before the first word of the nth line matching q. */
  const cut = (q: string, nth = 0) => {
    const s = ly.get(q, nth).words[0]!.start;
    let best = 0;
    for (const d of db) if (d <= s + 0.02) best = d;
    return best;
  };
  /** The first downbeat after the end of the nth line matching q. */
  const after = (q: string, nth = 0) => {
    const e = ly.get(q, nth).end;
    return db.find((d) => d > e - 0.05) ?? e;
  };

  const b = {
    v1desk: cut('I write my code'),
    v1hand: cut('Drew a hand'),
    v1gran: cut('be my grandma'),
    pre1: cut('So go ahead and hype it'),
    count1: cut('Watch it try', 0),
    clocks1: after("It can't fill a glass of wine", 0),
    sleep1: cut("Nah, I'm not losing sleep", 0),
    stage: cut('Asked for the Founding Fathers'),
    grok: cut('Then Grok'),
    roads: cut('Drive-thru bot'),
    pre2: cut('So go ahead and tweet it'),
    count2: cut('Watch it try', 1),
    clocks2: after("It can't fill a glass of wine", 1),
    sleep2: cut("Nah, I'm not losing sleep", 1),
    solo: after('And my job is mine to keep', 1),
    breakdown: cut('Monday morning'),
    bridge: cut('And lately'),
    countF: cut('Now it always finds'),
    clocksF: cut('Every clock is ticking fine'),
    sleepF: cut("Now my job's not mine"),
    plumber: cut("Fine! I'll be a plumber"),
    robot: au.splice,
    credits: au.duration + CREDITS_TAIL,
    end: au.duration + END_TAIL,
  };

  const E = (id: string, file: string, start: number, end: number, params?: Record<string, unknown>): TimelineEntry =>
    ({ id, load: scene(file), start, end, params });

  return [
    E('intro', 'intro', 0, b.v1desk),
    E('v1-desk', 'v1-desk', b.v1desk, b.v1hand),
    E('v1-hand-spaghetti', 'v1-hand-spaghetti', b.v1hand, b.v1gran),
    E('v1-grandma-calendar', 'v1-grandma-calendar', b.v1gran, b.pre1),
    E('pre1', 'pre', b.pre1, b.count1, { n: 1 }),
    E('count1', 'chorus-count', b.count1, b.clocks1, { v: 1 }),
    E('clocks1', 'chorus-clocks', b.clocks1, b.sleep1, { v: 1 }),
    E('sleep1', 'chorus-sleep', b.sleep1, b.stage, { v: 1 }),
    E('v2-stage', 'v2-stage', b.stage, b.grok),
    E('v2-grok', 'v2-grok', b.grok, b.roads),
    E('v2-roads', 'v2-roads', b.roads, b.pre2),
    E('pre2', 'pre', b.pre2, b.count2, { n: 2 }),
    E('count2', 'chorus-count', b.count2, b.clocks2, { v: 2 }),
    E('clocks2', 'chorus-clocks', b.clocks2, b.sleep2, { v: 2 }),
    E('sleep2', 'chorus-sleep', b.sleep2, b.solo, { v: 2 }),
    E('solo', 'solo', b.solo, b.breakdown),
    E('breakdown', 'breakdown', b.breakdown, b.bridge),
    E('bridge', 'bridge', b.bridge, b.countF),
    E('countF', 'chorus-count', b.countF, b.clocksF, { v: 'final' }),
    E('clocksF', 'chorus-clocks', b.clocksF, b.sleepF, { v: 'final' }),
    E('sleepF', 'chorus-sleep', b.sleepF, b.plumber, { v: 'final' }),
    E('plumber', 'plumber', b.plumber, b.robot),
    E('robot', 'robot', b.robot, b.credits),
    E('endscreen', 'endscreen', b.credits, b.end),
  ];
}
