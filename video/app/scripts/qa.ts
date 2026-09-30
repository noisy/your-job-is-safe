#!/usr/bin/env bun
// QA renders for the whole edit, into out/qa/:
//   song-NN.png   contact sheets of the whole song (one frame every --step s, 48 per sheet)
//   cuts-NN.png   the frames just before and just after every timeline boundary (the handoffs)
//   sync-NN.png   lyric sync spot checks: for every Nth word, the frame 60 ms before its start and 120 ms
//                 after it (the word must be absent/dim, then present); sync.txt lists the words per cell
//   bun scripts/qa.ts [--skin paper] [--step 1.0] [--every 9] [--only song,cuts,sync]
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const APP = path.resolve(import.meta.dir, '..');
const ROOT = path.resolve(APP, '..');
const SKIN = opt('skin', 'ps1')!;
const OUT = path.resolve(ROOT, '..', 'out', SKIN === 'paper' ? 'qa-paper' : 'qa');
mkdirSync(OUT, { recursive: true });
const parts = (opt('only', 'song,cuts,sync')!).split(',');
const au = await Bun.file(path.join(ROOT, 'data/audio.json')).json();
const ly = await Bun.file(path.join(ROOT, 'data/lyrics.json')).json();

async function sheet(times: number[], out: string, cols = 8) {
  const p = Bun.spawn(['bun', 'scripts/render.ts', 'sheet', '--times', times.map((t) => t.toFixed(3)).join(','), '--cols', String(cols), '--out', out, ...(SKIN === 'paper' ? ['--skin', 'paper'] : [])], { cwd: APP, stdout: 'pipe', stderr: 'pipe' });
  const o = await new Response(p.stdout).text() + await new Response(p.stderr).text();
  await p.exited;
  const errs = o.split('\n').filter((l) => /SCENE ERRORS|pageerror|failed/.test(l));
  console.log(out, errs.length ? `\n  ${errs.slice(0, 5).join('\n  ')}` : '');
}
const chunks = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

if (parts.includes('song')) {
  const step = +opt('step', '1.0')!;
  const ts = Array.from({ length: Math.floor(au.duration / step) }, (_, i) => i * step + (i === 0 ? 0 : 0.01));
  for (const [i, c] of chunks(ts, 48).entries()) await sheet(c, path.join(OUT, `song-${String(i + 1).padStart(2, '0')}.png`));
}
if (parts.includes('cuts')) {
  // boundaries from the running app's timeline
  const tl: { id: string; start: number }[] = await (async () => {
    const p = Bun.spawn(['bun', '-e', `
      import { chromium } from 'playwright-core';
      const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] });
      const pg = await b.newPage(); await pg.goto('http://localhost:5420/?export=1');
      await pg.waitForFunction(() => (window as any).__yjis?.ready || (window as any).__yjis?.error, null, { timeout: 120000 });
      console.log(JSON.stringify(await pg.evaluate(() => (window as any).__yjis.timeline))); await b.close();`], { cwd: APP, stdout: 'pipe' });
    const o = await new Response(p.stdout).text(); await p.exited;
    return JSON.parse(o.trim().split('\n').pop()!);
  })();
  const ts = tl.slice(1).flatMap((e) => [e.start - 1 / 60, e.start + 1 / 60]);
  writeFileSync(path.join(OUT, 'cuts.txt'), tl.map((e) => `${e.start.toFixed(3)}  ${e.id}`).join('\n'));
  for (const [i, c] of chunks(ts, 32).entries()) await sheet(c, path.join(OUT, `cuts-${String(i + 1).padStart(2, '0')}.png`), 8);
}
if (parts.includes('sync')) {
  const every = +opt('every', '9')!;
  const words = ly.lines.flatMap((l: any) => l.words.map((w: any) => ({ ...w, line: l.text })));
  const picks = words.filter((_: unknown, i: number) => i % every === 4);
  const ts = picks.flatMap((w: any) => [w.start - 0.06, w.start + 0.12]);
  writeFileSync(path.join(OUT, 'sync.txt'), picks.map((w: any, i: number) => `cells ${2 * i}/${2 * i + 1}  ${w.start.toFixed(2)}  "${w.w}"  in: ${w.line}`).join('\n'));
  for (const [i, c] of chunks(ts, 32).entries()) await sheet(c, path.join(OUT, `sync-${String(i + 1).padStart(2, '0')}.png`), 8);
}
