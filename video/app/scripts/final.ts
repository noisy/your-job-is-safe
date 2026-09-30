#!/usr/bin/env bun
// The final render: the whole video at 1920x1080, 60 fps, with motion blur, as one cached segment per timeline
// entry (frame-exact boundaries at the entries' starts), losslessly concatenated, muxed with the mp3, plus a
// ~16 Mbit/s web copy.
//
// Segments are cached in out/.segments-<skin>/ under a fingerprint of everything that can change their pixels:
// the entry's window, its scene module and every source file it imports (recursively: the kit, the engine),
// the data files, the timeline, and the render options. A re-run renders only the entries whose fingerprint
// changed (or that failed / were interrupted), so a fix to one scene re-renders only that scene.
//
//   bun scripts/final.ts [--skin paper] [--jobs 2] [--gentle] [--only id1,id2] [--force]
//                        [--samples auto] [--max-samples 36] [--shutter 0.2] [--crf 16] [--preset slow]
//   --gentle   low priority: macOS background QoS (efficiency cores, throttled I/O) and nice 20
//   --only     re-render these entries even if cached (the rest still comes from the cache)
//   --force    ignore the cache
// Progress: out/.segments-<skin>/progress.txt (per segment: cached / done / rendering n/N frames / queued).
// Needs the dev server (render.ts's --url, default http://localhost:5420).
import path from 'node:path';
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync, renameSync } from 'node:fs';
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const flag = (k: string) => argv.includes(`--${k}`);
const APP = path.resolve(import.meta.dir, '..');
const ROOT = path.resolve(APP, '..');
const SKIN = opt('skin', 'ps1')!;
const OUT = path.resolve(opt('out', path.join(ROOT, '..', 'out', SKIN === 'paper' ? 'your-job-is-safe-paper.mp4' : 'your-job-is-safe.mp4'))!);
const WEB = OUT.replace(/\.mp4$/, '-web.mp4');
const FPS = 60;
const JOBS = +opt('jobs', '2')!;
const URL = opt('url', process.env.YJIS_URL ?? 'http://localhost:5420')!;
const RENDER_OPTS = ['--samples', opt('samples', 'auto')!, '--max-samples', opt('max-samples', '36')!, '--shutter', opt('shutter', '0.2')!,
  '--crf', opt('crf', '16')!, '--preset', opt('preset', 'slow')!, ...(SKIN === 'paper' ? ['--skin', 'paper'] : [])];
const SEG = path.join(path.dirname(OUT), `.segments-${SKIN}`);
mkdirSync(SEG, { recursive: true });

// ---------------------------------------------------------------- the timeline (from the running app) and its modules
async function timeline(): Promise<{ id: string; start: number; end: number }[]> {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] });
  const p = await b.newPage();
  await p.goto(`${URL}/?export=1${SKIN === 'paper' ? '&skin=paper' : ''}`);
  await p.waitForFunction(() => (window as any).__yjis?.ready || (window as any).__yjis?.error, null, { timeout: 120000 });
  const tl = await p.evaluate(() => (window as any).__yjis.timeline);
  await b.close();
  return tl;
}
const tlSrc = readFileSync(path.join(APP, 'src/timeline.ts'), 'utf8');
const moduleOf = new Map<string, string>();
for (const m of tlSrc.matchAll(/E\('([^']+)',\s*'([^']+)'/g)) moduleOf.set(m[1]!, m[2]!);

/** A module and everything it imports, recursively (relative imports under src/). */
function deps(file: string, seen = new Set<string>()) {
  if (seen.has(file) || !existsSync(file)) return seen;
  seen.add(file);
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    let f = path.resolve(path.dirname(file), m[1]!);
    if (!f.endsWith('.ts')) f += '.ts';
    deps(f, seen);
  }
  return seen;
}
const COMMON = [path.join(ROOT, 'data/audio.json'), path.join(ROOT, 'data/lyrics.json'), path.join(APP, 'src/timeline.ts'), path.join(APP, 'src/main.ts'),
  path.join(APP, 'index.html'), path.join(APP, 'scripts/render.ts'), ...deps(path.join(APP, 'src/main.ts'))];
function fingerprint(id: string, start: number, end: number) {
  const mod = moduleOf.get(id);
  const files = new Set([...COMMON, ...(mod ? deps(path.join(APP, `src/scenes/${mod}.ts`)) : [])]);
  let h = `${id}|${Math.round(start * FPS)}|${Math.round(end * FPS)}|${RENDER_OPTS.join(' ')}`;
  for (const f of [...files].sort()) h += `|${f}:${Bun.hash(readFileSync(f)).toString(36)}`;
  return Bun.hash(h).toString(36);
}

// ---------------------------------------------------------------- plan
const tl = await timeline();
const only = new Set((opt('only') ?? '').split(',').filter(Boolean));
const segs = tl.map((e, k) => {
  const fp = fingerprint(e.id, e.start, e.end);
  const file = path.join(SEG, `${String(k).padStart(2, '0')}-${e.id}-${fp}.mp4`);
  const cached = existsSync(file) && !flag('force') && !only.has(e.id);
  return { ...e, k, file, cached, state: cached ? 'cached' : 'queued', progress: '' };
});
// drop stale segment files (older fingerprints, partial files)
const keep = new Set(segs.map((s) => path.basename(s.file)));
for (const f of readdirSync(SEG)) if (/\.mp4$/.test(f) && !keep.has(f)) rmSync(path.join(SEG, f), { force: true });
const todo = segs.filter((s) => !s.cached);
const dur = (s: { start: number; end: number }) => s.end - s.start;
console.log(`${segs.length} segments; cached ${segs.length - todo.length}; to render ${todo.length} (${todo.reduce((a, s) => a + dur(s), 0).toFixed(1)} s of video): ${todo.map((s) => s.id).join(', ') || '—'}`);

const status = () => writeFileSync(path.join(SEG, 'progress.txt'),
  `${new Date().toISOString()}\n` + segs.map((s) => `${String(s.k).padStart(2)} ${s.id.padEnd(22)} ${dur(s).toFixed(2).padStart(6)} s  ${s.state}${s.progress ? '  ' + s.progress : ''}`).join('\n') + '\n');
status();

// ---------------------------------------------------------------- render (a queue of JOBS workers, one retry per segment)
async function renderSeg(s: (typeof segs)[number], attempt: number): Promise<boolean> {
  const part = s.file.replace(/\.mp4$/, '.part.mp4');
  const cmd = ['bun', 'scripts/render.ts', 'video', '--from', String(s.start), '--to', String(s.end), '--noaudio', ...RENDER_OPTS, '--out', part];
  const full = flag('gentle') ? ['taskpolicy', '-b', 'nice', '-n', '20', ...cmd] : cmd;
  s.state = attempt > 0 ? `rendering (retry ${attempt})` : 'rendering'; status();
  const p = Bun.spawn(full, { cwd: APP, stdout: 'pipe', stderr: 'pipe' });
  const logf = path.join(SEG, `${String(s.k).padStart(2, '0')}-${s.id}.log`);
  let log = '';
  const dec = new TextDecoder();
  const rd = (async () => {
    for await (const ch of p.stdout as ReadableStream<Uint8Array>) {
      const x = dec.decode(ch); log += x;
      const last = x.split('\r').filter((l) => l.trim()).pop();
      if (last) { s.progress = last.trim(); status(); }
    }
  })();
  const re = (async () => { for await (const ch of p.stderr as ReadableStream<Uint8Array>) log += dec.decode(ch); })();
  const code = await p.exited; await rd; await re;
  writeFileSync(logf, log);
  if (code !== 0 || !existsSync(part)) { s.state = `FAILED (exit ${code}, see ${path.basename(logf)})`; status(); return false; }
  renameSync(part, s.file);
  s.state = 'done'; s.progress = ''; status();
  return true;
}
const t0 = performance.now();
const queue = [...todo];
let failed = false;
await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
  for (let s = queue.shift(); s; s = queue.shift()) {
    if (!(await renderSeg(s, 0)) && !(await renderSeg(s, 1))) failed = true;
    console.log(`[${s.k} ${s.id}] ${s.state}  (${((performance.now() - t0) / 60000).toFixed(1)} min)`);
  }
}));
if (failed) { console.error('some segments failed; re-run to resume (finished segments are kept)'); process.exit(1); }
console.log(`rendered in ${((performance.now() - t0) / 60000).toFixed(1)} min`);

// ---------------------------------------------------------------- concat, mux, web copy
const ff = async (args: string[]) => {
  const p = Bun.spawn(['ffmpeg', '-y', '-loglevel', 'error', ...args], { stdout: 'inherit', stderr: 'inherit' });
  if ((await p.exited) !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
};
const list = path.join(SEG, 'list.txt');
writeFileSync(list, segs.map((s) => `file '${s.file}'`).join('\n'));
const audio = path.join(ROOT, 'audio/song.mp3');
const total = segs[segs.length - 1]!.end - segs[0]!.start;
// the video runs past the mp3 (the silent end screen): pad the audio with silence to the video's length
await ff(['-f', 'concat', '-safe', '0', '-i', list, '-i', audio, '-map', '0:v', '-map', '1:a', '-af', 'apad', '-t', String(total),
  '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-movflags', '+faststart', OUT]);
console.log(`wrote ${OUT}`);
await ff(['-i', OUT, '-c:v', 'libx264', '-preset', 'slow', '-b:v', '16M', '-maxrate', '20M', '-bufsize', '32M', '-pix_fmt', 'yuv420p',
  '-x264-params', 'aq-mode=3', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
  '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', WEB]);
console.log(`wrote ${WEB}`);
