#!/usr/bin/env bun
// YouTube thumbnails from the staged 3D compositions in src/scenes/thumb.ts: renders each (?thumb=N) as a still,
// saves out/thumbs2/NN-<slug>.jpg (1280x720) and a contact sheet out/thumbs2/sheet.jpg.
//   bun scripts/thumbs3d.ts [--only 3,7,12] [--jobs 3]
// Needs the dev server (render.ts's --url, default http://localhost:5420).
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const APP = path.resolve(import.meta.dir, '..');
const OUT = path.resolve(APP, '../../out/thumbs2');
const SRC = path.join(OUT, 'src');
const JOBS = +opt('jobs', '3')!;
// the file names, in the order of the compositions in thumb.ts
const slugs = ['two-rs', 'safe', 'move-aside', 'how-many', 'brim', 'it-learned', 'ten-past-ten', 'six-fingers', 'replaced', 'plan-b-plumber',
  'game-over', 'absolutely-right', 'versus', 'oh-duck', 'slop', 'two-weeks', 'merged', 'v1-to-v6', 'new-hires', 'hand-coded',
  'deadline', 'its-2021', 'stop-nuggets', 'bloom-or-doom', 'just-a-toy', 'ai-is-slop', 'new-senior-dev', 'p-doom-1', 'sleep-tight', 'task-complete'];
const all = slugs.map((_, i) => i + 1);
const only = opt('only')?.split(',').map(Number) ?? all;

const run = async (cmd: string[]) => { const p = Bun.spawn(cmd, { cwd: APP, stdout: 'pipe', stderr: 'pipe' }); const code = await p.exited; if (code) throw new Error(`${cmd.join(' ')}: ${await new Response(p.stderr).text()}`); };
const png = (n: number) => path.join(SRC, String(n), 'f_0001.00.png');
const jpg = (n: number) => path.join(OUT, `${String(n).padStart(2, '0')}-${slugs[n - 1]}.jpg`);

mkdirSync(SRC, { recursive: true });
const queue = [...only];
await Promise.all(Array.from({ length: JOBS }, async () => {
  for (let n = queue.shift(); n; n = queue.shift()) {
    await run(['bun', 'scripts/render.ts', 'stills', '--q', `thumb=${n}`, '--t', '1', '--samples', '4', '--out', path.join(SRC, String(n))]);
    await run(['ffmpeg', '-y', '-loglevel', 'error', '-i', png(n), '-vf', 'scale=1280:720:flags=lanczos', '-q:v', '2', jpg(n)]);
    console.log(path.basename(jpg(n)));
  }
}));
// the contact sheet: 5 columns, every thumbnail
await run(['ffmpeg', '-y', '-loglevel', 'error', ...all.flatMap((n) => ['-i', png(n)]), '-filter_complex',
  all.map((n, i) => `[${i}]scale=480:270[s${i}]`).join(';') + ';' + all.map((_, i) => `[s${i}]`).join('') +
  `xstack=inputs=${all.length}:grid=5x${Math.ceil(all.length / 5)}:fill=black`, '-q:v', '3', path.join(OUT, 'sheet.jpg')]);
console.log(path.join(OUT, 'sheet.jpg'));
