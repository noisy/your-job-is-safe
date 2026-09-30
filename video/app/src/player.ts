// Interactive player (preview page and Storybook): canvas, play/pause, scrub, beat/lyric readout.
// Audio is the song mp3 played in sync with the engine's time; `range` limits playback to a window
// (a style story loops its segment).
import type { Engine } from './engine/engine';

export interface PlayerOpts {
  range?: [number, number];
  loop?: boolean;
  from?: number;
  /** Show the engine's timeline entries as clickable marks above the scrubber. */
  marks?: boolean;
}

const CSS = `
.yp { position: relative; width: 100%; height: 100%; display: flex; flex-direction: column; background: #070707; color: #e8e2d6; font: 12px/1.4 ui-monospace, Menlo, monospace; }
.yp-wrap { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
.yp-wrap canvas { max-width: 100%; max-height: 100%; aspect-ratio: 16/9; background: #000; cursor: pointer; }
.yp-ui { flex: 0 0 auto; padding: 6px 12px 8px; background: #0e0e0f; }
.yp-row { display: flex; gap: 10px; align-items: center; }
.yp-btn { background: #1d1b19; color: #e8e2d6; border: 1px solid #3a3733; border-radius: 3px; padding: 3px 10px; font: inherit; cursor: pointer; }
.yp-scrub { flex: 1; accent-color: #e5322d; }
.yp-info { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #9c968c; margin-top: 4px; }
.yp-marks { position: relative; height: 15px; }
.yp-mark { position: absolute; top: 0; height: 13px; border-left: 1px solid #e5322d; color: #9c968c; font-size: 9px; overflow: hidden; white-space: nowrap; padding-left: 2px; cursor: pointer; box-sizing: border-box; }
.yp-errs { display: none; position: absolute; top: 8px; left: 8px; right: 8px; max-height: 40%; overflow: auto; background: #300; color: #fbb; padding: 8px; white-space: pre-wrap; z-index: 9; }
`;

export function mountPlayer(root: HTMLElement, engine: Engine, audioUrl: string, o: PlayerOpts = {}) {
  if (!document.getElementById('yp-css')) {
    const st = document.createElement('style');
    st.id = 'yp-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const range: [number, number] = o.range ?? [0, engine.duration];
  const el = document.createElement('div');
  el.className = 'yp';
  el.innerHTML = `<div class="yp-wrap"></div><div class="yp-ui">${o.marks ? '<div class="yp-marks"></div>' : ''}
    <div class="yp-row"><button class="yp-btn" data-k="play">play</button><button class="yp-btn" data-k="start">|&lt;</button>
    <input class="yp-scrub" type="range" step="0.001"/><span class="yp-time"></span></div><div class="yp-info"></div></div><pre class="yp-errs"></pre>`;
  root.appendChild(el);
  el.querySelector('.yp-wrap')!.appendChild(engine.canvas);
  const scrub = el.querySelector('.yp-scrub') as HTMLInputElement;
  const info = el.querySelector('.yp-info') as HTMLElement;
  const time = el.querySelector('.yp-time') as HTMLElement;
  const playBtn = el.querySelector('[data-k=play]') as HTMLButtonElement;
  const errs = el.querySelector('.yp-errs') as HTMLElement;
  scrub.min = String(range[0]);
  scrub.max = String(range[1]);
  if (engine.errors.length) { errs.textContent = engine.errors.join('\n\n'); errs.style.display = 'block'; }

  const audio = new Audio(audioUrl);
  audio.preload = 'auto';
  let t = o.from ?? range[0];
  let playing = false;
  let lastAudioT = -1, lastPerf = 0;
  let alive = true;
  // Past the end of the mp3 (the silent end card and end screen) the clock is performance.now(): `silent` holds
  // where that clock started (song time, wall time), or null while the audio drives time.
  let silent: { t: number; perf: number } | null = null;
  const audioEnd = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Infinity);
  const startAudio = () => {
    if (t < audioEnd() - 0.02) { silent = null; audio.currentTime = t; void audio.play(); }
    else { audio.pause(); silent = { t, perf: performance.now() }; }
  };
  const seek = (x: number) => {
    t = Math.max(range[0], Math.min(range[1] - 0.001, x));
    audio.currentTime = Math.min(t, audioEnd());
    lastAudioT = -1;
    if (playing) startAudio(); else silent = null;
  };
  const toggle = () => {
    playing = !playing;
    playBtn.textContent = playing ? 'pause' : 'play';
    if (playing) startAudio(); else { audio.pause(); silent = null; }
  };
  seek(t);
  engine.canvas.onclick = toggle;
  playBtn.onclick = toggle;
  (el.querySelector('[data-k=start]') as HTMLButtonElement).onclick = () => seek(range[0]);
  scrub.oninput = () => seek(parseFloat(scrub.value));

  if (o.marks) {
    const marks = el.querySelector('.yp-marks') as HTMLElement;
    const span = range[1] - range[0];
    for (const e of engine.timeline) {
      const m = document.createElement('div');
      m.className = 'yp-mark';
      m.style.left = `${((e.start - range[0]) / span) * 100}%`;
      m.style.width = `${((e.end - e.start) / span) * 100}%`;
      m.title = `${e.id} ${e.start.toFixed(2)}–${e.end.toFixed(2)}`;
      m.textContent = e.id;
      m.onclick = () => seek(e.start);
      marks.appendChild(m);
    }
  }

  const onKey = (ev: KeyboardEvent) => {
    if ((ev.target as HTMLElement)?.tagName === 'INPUT' && ev.key !== ' ') return;
    if (ev.key === ' ') { ev.preventDefault(); toggle(); }
    if (ev.key === 'ArrowRight') seek(t + (ev.shiftKey ? 5 : 1));
    if (ev.key === 'ArrowLeft') seek(t - (ev.shiftKey ? 5 : 1));
    if (ev.key === '.') seek(t + 1 / 60);
    if (ev.key === ',') seek(t - 1 / 60);
    if (ev.key === ']') { const e = engine.timeline.find((x) => x.start > t + 0.01); if (e) seek(e.start); }
    if (ev.key === '[') { const es = engine.timeline.filter((x) => x.start < t - 0.3); const e = es[es.length - 1]; if (e) seek(e.start); }
  };
  window.addEventListener('keydown', onKey);

  let frames = 0, fpsT = performance.now(), fps = 0;
  const tick = () => {
    if (!alive) return;
    if (playing) {
      // smooth the coarse audio clock with performance.now()
      const now = performance.now();
      if (!silent && (audio.ended || t >= audioEnd() - 0.02)) silent = { t: Math.max(t, Math.min(audioEnd(), range[1])), perf: now };
      if (silent) t = silent.t + (now - silent.perf) / 1000;
      else {
        if (audio.currentTime !== lastAudioT) { lastAudioT = audio.currentTime; lastPerf = now; }
        t = lastAudioT + (audio.paused ? 0 : (now - lastPerf) / 1000);
      }
      if (t >= range[1]) {
        if (o.loop ?? true) seek(range[0]);
        else { playing = false; audio.pause(); silent = null; playBtn.textContent = 'play'; }
      }
    }
    engine.render(t, 1 / 60);
    scrub.value = String(t);
    frames++;
    const now = performance.now();
    if (now - fpsT > 500) { fps = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now; }
    const e = engine.timeline.find((x) => t >= x.start && t < x.end);
    const l = engine.lyrics.lineAt(t);
    time.textContent = `${t.toFixed(2)}s`;
    info.textContent = `beat ${engine.audio.beatAt(t).toFixed(2)}  bar ${engine.audio.barAt(t).toFixed(2)}  [${e?.id ?? '—'}]  ${fps.toFixed(0)} fps   ${l ? '“' + l.text + '”' : ''}`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  return {
    el,
    seek,
    destroy() {
      alive = false;
      audio.pause();
      window.removeEventListener('keydown', onKey);
      el.remove();
    },
  };
}
