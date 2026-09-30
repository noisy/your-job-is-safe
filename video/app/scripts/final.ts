#!/usr/bin/env bun
// The final render: the whole song at 1920x1080, 60 fps, with motion blur, as K parallel segments
// (frame-exact boundaries), losslessly concatenated, muxed with the mp3, plus a ~16 Mbit/s web copy.
//   bun scripts/final.ts [--skin paper] [--jobs 2] [--samples auto] [--max-samples 36] [--shutter 0.2] [--crf 16]
//                        [--from 0] [--to <duration>] [--out ../../out/your-job-is-safe.mp4] [--keep]
// Needs the dev server (render.ts's --url, default http://localhost:5420).
import path from 'node:path';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const flag = (k: string) => argv.includes(`--${k}`);
const APP = path.resolve(import.meta.dir, '..');
const ROOT = path.resolve(APP, '..');
const SKIN = opt('skin', 'ps1')!;
const OUT = path.resolve(opt('out', path.join(ROOT, '..', 'out', SKIN === 'paper' ? 'your-job-is-safe-paper.mp4' : 'your-job-is-safe.mp4'))!);
const WEB = OUT.replace(/\.mp4$/, '-web.mp4');
const FPS = 60;
const jobs = +opt('jobs', '2')!;
const au = await Bun.file(path.join(ROOT, 'data/audio.json')).json();
// the video runs END_TAIL s past the song (src/timeline.ts): the end card over silence
const END_TAIL = 10.6; // keep in sync with src/timeline.ts
const from = +opt('from', '0')!, to = +opt('to', String(au.duration + END_TAIL))!;
const n0 = Math.round(from * FPS), n1 = Math.round(to * FPS);
const tmp = path.join(path.dirname(OUT), `.segments-${SKIN}`);
mkdirSync(tmp, { recursive: true });

// equal frame counts per job
const cuts = Array.from({ length: jobs + 1 }, (_, k) => n0 + Math.round(((n1 - n0) * k) / jobs));
const segs = cuts.slice(0, -1).map((a, k) => ({ a, b: cuts[k + 1]!, file: path.join(tmp, `seg${k}.mp4`) }));
console.log(`frames ${n0}–${n1} (${((n1 - n0) / FPS).toFixed(2)} s) in ${jobs} segments; samples ${opt('samples', 'auto')} max ${opt('max-samples', '36')} shutter ${opt('shutter', '0.2')}`);

const t0 = performance.now();
const runs = segs.map((s, k) => {
  if (existsSync(s.file) && flag('resume')) return Promise.resolve(0);
  const args = ['bun', 'scripts/render.ts', 'video', '--from', String(s.a / FPS), '--to', String(s.b / FPS), '--noaudio',
    '--samples', opt('samples', 'auto')!, '--max-samples', opt('max-samples', '36')!, '--shutter', opt('shutter', '0.2')!,
    '--crf', opt('crf', '16')!, '--preset', opt('preset', 'slow')!, '--out', s.file, ...(SKIN === 'paper' ? ['--skin', 'paper'] : [])];
  const p = Bun.spawn(args, { cwd: APP, stdout: 'pipe', stderr: 'pipe' });
  // stream progress lines with the segment's tag
  (async () => {
    const dec = new TextDecoder();
    for await (const chunk of p.stdout as ReadableStream<Uint8Array>) {
      const txt = dec.decode(chunk);
      const last = txt.split('\r').filter((x) => x.trim()).pop();
      if (last) process.stdout.write(`\n[seg${k}] ${last.trim()}`);
    }
  })();
  (async () => { for await (const chunk of p.stderr as ReadableStream<Uint8Array>) process.stderr.write(`[seg${k}] ${new TextDecoder().decode(chunk)}`); })();
  return p.exited;
});
const codes = await Promise.all(runs);
if (codes.some((c) => c !== 0)) { console.error(`\nsegment render failed: ${codes}`); process.exit(1); }
console.log(`\nrendered in ${((performance.now() - t0) / 60000).toFixed(1)} min`);

const ff = async (args: string[]) => {
  const p = Bun.spawn(['ffmpeg', '-y', '-loglevel', 'error', ...args], { stdout: 'inherit', stderr: 'inherit' });
  if ((await p.exited) !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
};
const list = path.join(tmp, 'list.txt');
writeFileSync(list, segs.map((s) => `file '${s.file}'`).join('\n'));
const audio = path.join(ROOT, 'audio/song.mp3');
// concat the video streams without re-encoding, add the song (AAC 320k), tag BT.709
await ff(['-f', 'concat', '-safe', '0', '-i', list, '-ss', String(from), '-t', String(to - from), '-i', audio,
  '-map', '0:v', '-map', '1:a', '-af', 'apad', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-shortest', '-movflags', '+faststart', OUT]);
console.log(`wrote ${OUT}`);
// the web copy: ~16 Mbit/s, two-pass-free constrained VBR
await ff(['-i', OUT, '-c:v', 'libx264', '-preset', 'slow', '-b:v', '16M', '-maxrate', '20M', '-bufsize', '32M', '-pix_fmt', 'yuv420p',
  '-x264-params', 'aq-mode=3', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
  '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', WEB]);
console.log(`wrote ${WEB}`);
if (!flag('keep')) rmSync(tmp, { recursive: true, force: true });
