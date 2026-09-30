#!/usr/bin/env bun
// Phase-1 deliverables into out/styles/: for every style a still (PNG) and a 5-second MP4 clip with the
// song's audio and motion blur, plus one contact sheet comparing all ten at the same six moments.
//   bun scripts/styles.ts [--only linocut,riso] [--skip-clips] [--skip-sheet] [--samples 12]
// Times are derived from the lyrics (same for every style), so the ten are directly comparable.
import path from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const flag = (k: string) => argv.includes(`--${k}`);
const APP = path.resolve(import.meta.dir, '..');
const ROOT = path.resolve(APP, '..');
const OUT = path.resolve(ROOT, '..', 'out', 'styles');
const IDS = ['linocut', 'riso', 'clay', 'patent', 'ascii', 'popup', 'ps1', 'scope', 'zine', 'pencil'];
const only = opt('only')?.split(',');
const ids = IDS.filter((id) => !only || only.includes(id));
const samples = opt('samples', '12')!;

const lyr = await Bun.file(path.join(ROOT, 'data/lyrics.json')).json();
const au = await Bun.file(path.join(ROOT, 'data/audio.json')).json();
const line = (q: string) => lyr.lines.find((l: any) => l.text.includes(q));
const l0 = line('Watch it try'), l1 = line("It can't count the R"), l2 = line("It can't fill a glass");
const w = (l: any, i: number) => l.words[i];
// six comparison moments: "simplest", the fill, "R's" hit, "strawberry" held, "glass" reveal, "wine" held
const times = [
  w(l0, 6).start + 0.15,
  (au.onsets.kick as [number, number][]).filter(([t]) => t > w(l0, 7).start && t < w(l1, 0).start).at(-1)![0],
  w(l1, 4).start + 0.12,
  (w(l1, 6).start + w(l1, 6).end) / 2,
  w(l2, 4).start + 0.2,
  (w(l2, 6).start + w(l2, 6).end) / 2 + 0.3,
].map((t) => Math.round(t * 1000) / 1000);
const labels = ['simplest thing', 'fill', "R's (downbeat)", 'strawberry (held)', 'glass (downbeat)', 'wine (held)'];
const STILL_T = times[3]!;
// the 5-second clip: from just before the chorus pickup through "glass of wine"
const clipFrom = Math.round((w(l1, 0).start - 0.6) * 1000) / 1000, clipTo = clipFrom + 5;

async function run(args: string[]) {
  const p = Bun.spawn(['bun', 'scripts/render.ts', ...args], { cwd: APP, stdout: 'pipe', stderr: 'pipe' });
  const [o, e] = [await new Response(p.stdout).text(), await new Response(p.stderr).text()];
  await p.exited;
  if (p.exitCode !== 0 || /SCENE ERRORS/.test(o + e)) console.error(o + e);
  return o;
}
async function ff(args: string[]) {
  const p = Bun.spawn(['ffmpeg', '-y', '-loglevel', 'error', ...args], { stdout: 'inherit', stderr: 'inherit' });
  await p.exited;
  if (p.exitCode !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
}

mkdirSync(path.join(OUT, 'frames'), { recursive: true });
console.log('moments', times.map((t, i) => `${labels[i]}@${t}`).join('  '), `| clip ${clipFrom}–${clipTo}`);
for (const [i, id] of ids.entries()) {
  const n = String(IDS.indexOf(id) + 1).padStart(2, '0');
  const fdir = path.join(OUT, 'frames', id);
  console.log(`[${n} ${id}] stills`);
  await run(['stills', '--style', id, '--t', [...times, STILL_T].join(','), '--samples', samples, '--shutter', '0.5', '--out', fdir]);
  const still = path.join(fdir, `f_${STILL_T.toFixed(2).padStart(7, '0')}.png`);
  if (existsSync(still)) await ff(['-i', still, path.join(OUT, `${n}-${id}.png`)]);
  if (!flag('skip-clips')) {
    console.log(`[${n} ${id}] clip`);
    const out = await run(['video', '--style', id, '--from', String(clipFrom), '--to', String(clipTo), '--samples', samples, '--shutter', '0.5', '--crf', '18', '--preset', 'medium', '--out', path.join(OUT, `${n}-${id}.mp4`)]);
    console.log(out.split('\n').filter((l) => /wrote|sub-frames/.test(l)).join('\n'));
  }
  void i;
}

if (!flag('skip-sheet')) {
  const rows: [string, string[]][] = [];
  for (const id of IDS) {
    const fdir = path.join(OUT, 'frames', id);
    const cells = times.map((t) => path.join(fdir, `f_${t.toFixed(2).padStart(7, '0')}.png`));
    if (cells.every((c) => existsSync(c))) rows.push([`${String(IDS.indexOf(id) + 1).padStart(2, '0')} ${id}`, cells]);
  }
  const py = path.join(ROOT, 'analysis/.venv/bin/python');
  const p = Bun.spawn([py, path.join(APP, 'scripts/contact_sheet.py'), path.join(OUT, 'contact-sheet.png'), path.join(APP, 'public/fonts'),
    JSON.stringify(labels.map((l, k) => [l, times[k]])), JSON.stringify(rows)], { stdout: 'inherit', stderr: 'inherit' });
  await p.exited;
}
