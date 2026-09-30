# Phase 1 brief: ten style scenes of the same moment

Every style scene renders **the same 8.3 s of the song**, so the ten can be compared directly. Read
`../../prompt.md` (the quality bar), `../../handoff.md` (the story and the references) and `ENGINE.md`
(the engine API) before writing code. This brief is what all ten scenes share.

## The moment

The preview window is 6 bars at 172 BPM (bar = 1.39 s), from the downbeat a bar before the chorus
pickup to the downbeat after "wine" rings out. It is computed from the data (`previewWindow()` in
`src/styles/registry.ts`); `ctx.start` / `ctx.end` are its bounds. Current values (they move by a few ms
if the alignment is re-run, which is why scenes must look everything up):

| what | lookup | ≈ time |
|---|---|---|
| window start (downbeat) | `ctx.start` | 40.15 |
| pre-chorus tail "…try to do the simplest thing!" | `lyrics.get('Watch it try')` (first occurrence) | words 40.00–41.46, "thing!" held to ~42.2 |
| drum fill, three kicks | `audio.events('kick', …)` | 41.90, 42.06, 42.24 |
| line 1 "It can't count the R's in strawberry," | `lyrics.get("It can't count the R", 0)` | 42.28–44.68 |
| "R's" = **the chorus's first downbeat, the big hit** | `line1.words[4]` | 42.98 (downbeat 42.93) |
| "strawberry," (held note) | `line1.words[6]` | 43.50–44.68 |
| line 2 "It can't fill a glass of wine," | `lyrics.get("It can't fill a glass of wine", 0)` | 45.04–47.54 |
| "glass" on a downbeat | `line2.words[4]` | 45.66 (downbeat 45.71) |
| "wine," (held note) | `line2.words[6]` | 46.22–47.54 |
| downbeats | `audio.downbeats` | 40.15 41.54 42.93 44.32 45.71 47.10 48.49 |
| snares (beats 2 and 4) | `audio.events('snare', …)` / `f.a.snare` | 43.29 43.98 44.67 45.37 46.07 46.76 47.45 48.15 |
| window end (downbeat) | `ctx.end` | 48.49 |

Never hard-code a time. Anchor to words (`line.words[i].start/end`), to `audio.downbeats` / `audio.beats`
(`audio.timeOfBeat`, `audio.beatAt`, `f.beat`, `f.bar`) and to hits (`f.a.kick`, `f.a.snare`, `audio.events`).

## What the viewer must see (the storyboard every style follows)

The lyrics only wink at the fails; **the picture shows what actually happened**. Same beats in every
style, each told in the style's own idiom:

1. **Lead-in (window start → the "R's" downbeat).** "…try to do the simplest thing!" is on screen,
   word-synced. It sets up the narrator's test: the question `how many r's in "strawberry"?` is being
   typed / asked of a chatbot. On the three-kick fill the image winds up (anticipation: pull back, squash,
   dolly out, hold breath), and **everything snaps on the "R's" downbeat**.
2. **"It can't count the R's in strawberry,"**: the word STRAWBERRY is the hero object in 3D. The
   viewer can count its **three R's**; the chatbot's reply shows the real fail concretely:
   `There are 2 R's in "strawberry".` (a confident 2). Show the real cause as a small, readable
   detail: the model sees tokens, not letters (`straw` | `berry`). Dramatic irony: the viewer sees the
   third R the machine missed; the narrator enjoys the fail (a tiny smug reaction is fine, optional).
   Sub-cut or strong reframe on the next downbeat (≈44.32), e.g. onto the "2".
3. **"It can't fill a glass of wine,"**: the prompt `a wine glass filled to the brim` produces a glass
   that is **only half full**, with the model's cheerful claim (`Here's a wine glass filled to the brim!`)
   next to a visible gap between the wine and a BRIM mark. "glass" lands on a downbeat: the glass reveal.
   Another sub-cut / camera move on the downbeat ≈47.10.
4. **Out (after "wine," to window end)**: the held "wine" rings; end on a composition that could hand off
   to the next line (every clock says 10:10): e.g. the rim's circle, a round shape, a hand, left as a hook.

## Hard rules (from prompt.md, applied to this scene)

- **Deterministic**: a pure function of `f.t` (`mulberry32`, `hash`, `frameIdx` from `util.ts`). No
  `Math.random()`, no `Date.now()`, no `performance.now()`. Stateless (`stateful = false`).
- **3D first**: a real 3D world with a moving camera (dolly, crane, orbit, whip-pan, crash-zoom, roll).
  2D material (type, UI, drawings) lives on planes *inside* that world: tilted, parallaxed, flown past.
  Never a flat static card, never subtitles on top.
- **Nothing sits still**: no composition holds longer than ~one bar (1.39 s) without a sub-cut,
  reframing or strong camera move. Big changes land on downbeats; hits on kicks/snares; moves ease
  *into* the downbeat. Strong eases (anticipation → snap → settle: `ease.outExpo`, `springStep`,
  `ease.outBack`), never floaty drift. Hard cuts only on downbeats.
- **Lyrics, word by word, integrated with intention**: each word appears/highlights at its `start`,
  completes by its `end` (up to 0.4 s of dim anticipation allowed, never ahead of the voice). They are
  part of the image (typed, carved, printed, built, stamped…) in the style's idiom. Every line readable
  at 1080p. Held notes ("thing!", "strawberry,", "wine,") should visibly hold/stretch.
- **Original drawings only**: no real logos or product UIs (no ChatGPT/Gemini/etc. look). The chatbot is
  a generic, clearly original "chat" object; a plain text label like `chatbot` is fine. No real people.
  No purple/cyan neon, no glowing brains, no Matrix rain, no synthwave, no lens-flare soup.
- **One scene file you own**: `app/src/scenes/style-<id>.ts` (+ helpers named
  `app/src/scenes/style-<id>-*.ts`, shaders inline or in those helpers). Don't edit engine files,
  the registry, or other styles. If you need an engine change, say so in your final message.
- The module exports: `default` (the Scene class), `TITLE` (string) and `NOTE: StyleNote`
  (`technique, palette, typography, lyrics, cost, risks`; one or two sentences each; `cost` =
  measured ms/frame from `render.ts perf` and your estimate for the full 204 s song with motion blur).
- **Performance**: the whole song must render in about an hour with motion blur (≈12,000 frames,
  ~10–30 sub-frames each), so aim for **≤ 15 ms per sub-frame** (`perf` mode). Precompute in `init()`;
  at most 2–3 Canvas2D layers uploaded per frame; heavy raymarching at reduced resolution if needed.
- Palette: pick your style's own (define it locally in your file); linear colours in GL. The engine's
  post (bloom, grain, vignette, CA) is available; return overrides to tune or disable them per style.

## How to work and verify

- The dev server runs at http://localhost:5420 (no live reload; reload the page to pick up edits).
  Live preview: http://localhost:5420/?style=<id>. Do not start or kill servers on other ports.
- Stills (then LOOK at them with the Read tool):
  `cd app && bun scripts/render.ts stills --style <id> --t 41.0,42.1,42.95,43.6,44.5,45.8,46.8,48.2 --out ../../out/wip/<id>`
- Contact sheet of the window: `bun scripts/render.ts sheet --style <id> --n 24 --cols 6 --out ../../out/wip/<id>/sheet.png`
- Perf: `bun scripts/render.ts perf --style <id> --from 42 --to 47`
- Typecheck your files: `bunx tsc --noEmit -p tsconfig.json 2>&1 | grep style-<id>`
- A short clip to judge motion: `bun scripts/render.ts video --style <id> --from 42 --to 47 --samples 4 --preset veryfast --out ../../out/wip/<id>/clip.mp4`
  (then pull frames with ffmpeg if you want to inspect motion).
- Iterate until the sheet reads as a finished, intentional piece: check readability of every lyric
  line, that each storyboard beat is clearly shown, that nothing holds still, and that the hits land.
