// Entry: preview player (default) or export mode (?export=1, driven by scripts/render.ts).
//   ?style=<id>  renders one Phase-1 style scene over its preview window instead of the full edit
//   ?only=a,b    loads only those timeline entries    ?t=12.3  starts the preview there
import { Engine, type AdaptiveSampling } from './engine/engine';
import { PW, PH, SCALE } from './engine/gl';
import { makeTimeline } from './timeline';
import { styleTimeline, previewWindow } from './styles/registry';
import { mountPlayer } from './player';

const params = new URLSearchParams(location.search);
const EXPORT = params.has('export');
const ONLY = params.get('only');
const STYLE = params.get('style');
const FROM = params.get('t') ? parseFloat(params.get('t')!) : undefined;

const canvas = document.createElement('canvas');
canvas.id = 'c'; // render.ts's sheet mode draws from #c
canvas.width = PW;
canvas.height = PH;
const THUMB = params.get('thumb');
// ?thumb=N: one of the composed YouTube thumbnails (src/scenes/thumb.ts), a single still scene
const thumbTimeline = () => [{ id: 'thumb', load: () => import('./scenes/thumb'), start: 0, end: 10, params: { n: Number(THUMB) } }];
const engine = new Engine(canvas, THUMB ? thumbTimeline : STYLE ? styleTimeline(STYLE) : makeTimeline);

declare global {
  interface Window { __yjis: any }
}

async function boot() {
  const onlySet = ONLY ? new Set(ONLY.split(',')) : null;
  await engine.init(onlySet ? (e) => onlySet.has(e.id) : undefined);
  if (EXPORT) setupExport();
  else {
    const range = STYLE ? previewWindow(engine.lyrics, engine.audio) : undefined;
    mountPlayer(document.body, engine, 'audio/song.mp3', { range, from: FROM, marks: !STYLE });
  }
}

function setupExport() {
  document.body.classList.add('export');
  document.body.appendChild(canvas);
  window.__yjis = {
    engine,
    duration: engine.duration,
    errors: engine.errors,
    scale: SCALE,
    width: PW,
    height: PH,
    timeline: engine.timeline.map(({ id, start, end }) => ({ id, start, end })),
    window: STYLE ? previewWindow(engine.lyrics, engine.audio) : [0, engine.duration],
    /** Render a single frame at t (seeks as needed). */
    still(t: number, samples: number | AdaptiveSampling = 1, shutter = 0.5) { return engine.render(t, 1 / 60, true, samples, shutter); },
    /** The last rendered frame as a full-resolution PNG, base64 (for stills at scale > 1). */
    async png() {
      const px = await engine.readPixelsAsync(), row = PW * 4;
      const img = new ImageData(PW, PH);
      for (let y = 0; y < PH; y++) img.data.set(px.subarray((PH - 1 - y) * row, (PH - y) * row), y * row);
      const oc = new OffscreenCanvas(PW, PH);
      oc.getContext('2d')!.putImageData(img, 0, 0);
      const b = new Uint8Array(await (await oc.convertToBlob({ type: 'image/png' })).arrayBuffer());
      let s = '';
      for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
      return btoa(s);
    },
    /**
     * Render [from, to) at fps and stream raw RGBA frames (bottom-up) over a WebSocket, with at most
     * `inflight` unacknowledged frames (backpressure from the encoder). Returns a histogram of sub-frames per frame.
     */
    async stream(opts: { from: number; to: number; fps: number; ws: string; samples?: number | AdaptiveSampling; shutter?: number; inflight?: number }) {
      const ws = new WebSocket(opts.ws);
      ws.binaryType = 'arraybuffer';
      let acked = 0;
      ws.onmessage = (e) => { if (typeof e.data === 'string') acked = Math.max(acked, +e.data || 0); };
      await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = (e) => rej(e); });
      const dt = 1 / opts.fps;
      const n0 = Math.round(opts.from * opts.fps), n1 = Math.round(opts.to * opts.fps);
      const buf = new Uint8Array(PW * PH * 4);
      const S = opts.samples ?? 1, SH = opts.shutter ?? 0.5;
      if (n0 > 0) engine.render((n0 - 1) * dt, dt, false, typeof S === 'number' ? S : 1, SH);
      const used: Record<number, number> = {};
      for (let n = n0; n < n1; n++) {
        const k = engine.render(n * dt, dt, false, S, SH);
        used[k] = (used[k] ?? 0) + 1;
        await engine.readPixelsAsync(buf);
        if (opts.inflight) while (n - n0 - acked >= opts.inflight) await new Promise((r) => setTimeout(r, 2));
        while (ws.bufferedAmount > 64 * 1024 * 1024) await new Promise((r) => setTimeout(r, 2));
        ws.send(buf);
        if (n % 30 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      while (ws.bufferedAmount > 0) await new Promise((r) => setTimeout(r, 5));
      ws.close();
      return used;
    },
  };
  window.__yjis.ready = true;
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f55;position:fixed;top:0;left:0">${String(e?.stack ?? e)}</pre>`);
  window.__yjis = { error: String(e?.stack ?? e) };
});
