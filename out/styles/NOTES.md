# Phase 1: ten styles, the same moment

Every style renders the same 8.3 s of the song (first chorus: "…the simplest thing! / It can't count the R's in strawberry, / It can't fill a glass of wine,", 40.15–48.49 s), word-synced and beat-synced.

- `NN-<id>.png`: a still at the held "strawberry" (44.11 s); `NN-<id>.mp4`: 5 s, 41.68–46.68 s, 1080p60, 12 sub-frame motion blur, with the song's audio.
- `contact-sheet.png`: all ten at the same six moments (simplest thing, the fill, the "R's" downbeat, held "strawberry", the "glass" downbeat, held "wine").
- Storybook with audio and scrub: `cd video/app && bun run storybook` → http://localhost:6006.

Render cost is per sub-frame on this M3 Pro; the full-song estimates assume adaptive motion blur (~12–36 sub-frames per frame).

## 01 · Linocut relief print in 3D (`linocut`)

- **technique**: A real three.js relief world rendered into two ink "plates" (MSAA target: r = black, g = vermilion) by one gouge shader: light becomes tapered, broken V-cut strokes that follow each surface, with a shadow map from the key light; a composite pass prints the plates on fibrous paper with uneven ink take and the vermilion off-register.
- **palette**: Cream paper #EFE6D2, carbon ink #1A1714, vermilion #D8401F (overprint gives a maroon third tone). No tones outside the two inks and the paper.
- **typography**: Anton caps as wood type for the lyrics and the hero STRAWBERRY (extruded from the font outlines); JetBrains Mono carved into the chat slabs as the machine voice.
- **lyrics**: One word per hit: every word is a wood-type block that slams onto the bed at the word's start, lifts and leaves its print; on held notes (thing!, strawberry, wine) the print keeps pressing after the block lifts: the ink spreads, a pale rim squeezes out and the letters drag along the row while the note rings. Annotations (the 1-2-3 count, the straw | berry tokens, the clock dial) are hand-stamped pops.
- **cost**: Measured (perf, 1080p, machine shared with other renders): 12.7–16.5 ms/frame at 1 sample incl. readback, ~5.7 ms per sub-frame at 12 samples (shadow map + MSAA plate + composite). Full 204 s song with motion blur at ~24 sub-frames/frame: about 30 min.
- **risks**: Gouge density needs its LOD fade to stay clean in wide shots; lots of printed text on an oblique bed must stay readable, so the camera stays high on lyric beats. Two-plate look depends on the composite; overdoing ink take makes the type crumble.

## 02 · Risograph overprint (`riso`)

- **technique**: A 3D print room in three.js; every sheet is a curled paper mesh whose plates (solid + tint, Canvas2D in separation space) and a live 3D render in ink separations are screened in the paper’s own UV space: per-drum halftone angles, drum grain, starvation streaks, mottled solids, multiply overprint, misregistration that jumps on snares. The table and the duplicator are printed too (world-space screens).
- **palette**: Riso drum inks Bright Red #F15060, Federal Blue #3D5588 and Yellow #FFE800 on #F3EEE3 paper; red + blue overprint is the “black”, blue + yellow the green. Matte, no bloom.
- **typography**: Bricolage Grotesque condensed 800 for the poster headlines, JetBrains Mono for the chatbot and the prompt, Caveat for the proofreader’s red-pencil marks.
- **lyrics**: Each word is printed by the second drum: a faint doubled, offset ghost arrives up to 0.35 s early and snaps into registration exactly on the word’s start; held notes (“thing!”, “strawberry,”, “wine,”) keep printing, so a second impression darkens and spreads the ink.
- **cost**: Measured (render.ts perf, 42–47 s): 13.3 ms/frame at 1 sample, 24.6 ms at 4 (≈3.8 ms per extra sub-frame; the plates re-upload once per output frame). Full 204 s song with motion blur: ≈17 min at ~20 sub-frames, ≈30 min at 36.
- **risks**: Plate uploads (one or two 1.5k canvases per frame) dominate; halftone detail can moiré at far framings (screened out below ~3 px cells). Must keep the camera moving so the print look does not become a flat poster.

## 03 · Claymation, raymarched (`clay`)

- **technique**: A raymarched SDF plasticine set (table, backdrop sweep, props, extruded letters from a distance-field text atlas) at half resolution with a depth-of-field upscale: fingerprint whorls and tool marks on the normals, wrap lighting, soft shadows, AO, a resin glass with fake refraction. Everything moves in stop-motion, the camera included: time is quantised to 12 fps on twos (aligned to output frames) with a per-step boil: the plasticine lumps re-form, lights and puppets jitter.
- **palette**: Studio plasticine: dusty teal-grey sweep, warm brown clay table, cream letters and bubbles, charcoal type, strawberry red, leaf green, mustard chips, near-black wine red; a warm key and a cool fill.
- **typography**: Rolled clay words in Bricolage Grotesque ExtraBold (the narrator), raised JetBrains Mono Bold on the chat slabs (the chatbot), a big red Bricolage STRAWBERRY.
- **lyrics**: Each word is a rolled clay word that drops onto the table at its start, squashes, overshoots and settles (stop-motion steps); held notes pull the word sideways like taffy and let it snap back; finished lines squash flat and vanish.
- **cost**: perf mode (1 sub-frame, incl. post + readback; the smoke scene alone is 8.9 ms): 17.7 ms avg, p95 23 ms. Puppets and camera step at 12 fps, so a frame’s sub-frames only differ by their AA tap and the adaptive sampler stops at ~12: the full song is about 45 min.
- **risks**: Raymarching is the costliest style here; small type on the slabs softens at half resolution; 12 fps stepping of the camera can feel choppy on long moves; too much boil reads as noise.

## 04 · Patent drawing (`patent`)

- **technique**: Real 3D solids drawn as a US-patent sheet: per-frame silhouette + crease extraction on the meshes, inked as depth-tested GPU capsule lines over hatch/stipple-shaded paper surfaces; exploded views, a quarter-cutaway section, dimension and centre lines, reference numerals with curved leaders, all in 3D on sheets lying on a drafting desk.
- **palette**: Warm white paper, near-black technical-pen ink, a grey desk, and one accent: the examiner’s red pencil (circles, tallies, the BRIM dimension, strikes).
- **typography**: Single-stroke engineering lettering (EMS Tech) for the sung words, figure labels, numerals and claims; a clean single-line sans for the chatbot’s typed text; Hershey script for the red-pencil notes; Bricolage 800 extruded for the STRAWBERRY solid.
- **lyrics**: Each word is lettered stroke by stroke by a 3D technical pen on the sheet, synced to its sung span (writtenLength); held notes are written early and then a dimension-style underline keeps growing under the word until the note ends.
- **cost**: perf (42–47 s, 1 sample, incl. readback) on a quiet GPU: avg 15.5 ms, p95 18 ms per frame, of which ~8.5 ms is the engine’s post + readback (the empty smoke scene); the scene itself is ~0.6 ms CPU (silhouette extraction, lettering, title-safe fit) + ~6–7 ms GPU. Measured again while other renders shared the GPU: 16–26 ms (smoke 8–11 ms). Full 204 s song with adaptive motion blur (~12k frames × ~20 sub-frames × ~7 ms) ≈ 30–40 min.
- **risks**: Line art lives or dies by line weight and clutter: every new element needs a clear spot on the sheet. Silhouette extraction needs closed, welded meshes; thin parts can show z-fighting ticks. The look is monochrome, so colour-driven story beats must use the red pencil sparingly.

## 05 · Terminal ASCII-on-3D (`ascii`)

- **technique**: A real three.js world (extruded STRAWBERRY, fruit, a bubble with a red "2", a lathe wine glass) rendered to a 960x540 luminance/signal/depth buffer; a fullscreen pass maps each character cell to a JetBrains Mono glyph atlas: density ramp for shade, / \\ | - _ along depth and light breaks. Cell size pulses on kicks and grows with each kick of the fill (the wind-up), snapping back on the downbeat. Two crisp terminal windows are planes in the same camera.
- **palette**: Warm charcoal #1B1916, paper-white glyphs #EDE6D6 (brightness from the light), one signal red #E5322D for the R's, the "2" and the wine. No green, no rain.
- **typography**: JetBrains Mono everywhere: the glyph atlas the world is made of, the extruded hero letters and the "2", and the two terminal windows.
- **lyrics**: Per-character typing: the sung line is typed at the shell prompt in sync with the voice (Lyrics word progress), with a beat-blinking caret; held notes repeat their vowel while they ring (thiiing!, strawberryyy, wiiine). The chatbot's replies stream token by token.
- **cost**: Measured (perf, 1080p, machine shared with other renders): 9–13.5 ms/frame at 1 sample incl. readback, ~3 ms per sub-frame at 12 samples (G-buffer + glyph pass + one 1600x1380 Canvas2D window layer per sub-frame). Full 204 s song with motion blur at ~24 sub-frames/frame: about 15 min.
- **risks**: ASCII 3D reads only when objects are big on screen (a few cells are noise), so the camera stays close; the cell grid swims under camera motion (it is the look, but motion blur softens it). Two text layers (ASCII world + crisp windows) must not fight: the windows are kept to one side of the hero.

## 06 · Pop-up paper book (`popup`)

- **technique**: A pop-up book built as real 3D cardstock: die-cut solids with printed Canvas2D fronts, blank backs and cut edges, hinged mechanisms (tabs, a V-fold, layered cards, slide-out strips, a pull-tab, a wheel) and a real page turn, lit by one key light with PCF soft shadow maps plus a fibre bump; MSAA, rendered by three.js.
- **palette**: Cream cardstock and warm walnut, printed in ink black, tomato red, leaf green, mustard and wine; soft daylight key with warm fill.
- **typography**: Bricolage Grotesque 800 for the word tabs and the STRAW|BERRY V-fold, JetBrains Mono for the chat strips (the machine’s voice), Bodoni italic for chapter heads and the clock wheel, Caveat for margin notes.
- **lyrics**: Each sung word is printed on its own paper tab that unfolds up out of the page at the word’s start (spring overshoot) and folds back down when its line is over; held notes (“thing!”, “strawberry,”, “wine,”) keep the tab flexing; a line broken by the page turn continues on the next spread.
- **cost**: perf (42–47 s, 1 sample, incl. readback) on a quiet GPU: avg 13.4 ms, p95 17.4 ms per frame, of which ~8.3 ms is the engine’s post + readback (the empty smoke scene); the scene itself is ~0.3 ms CPU + ~5 ms GPU (shadow pass + MSAA lit pass, ~80 card solids, zero per-frame Canvas uploads). Measured again while other renders shared the GPU: 18–23 ms (smoke 8–11 ms). Full 204 s song with adaptive motion blur (~12k frames × ~20 sub-frames × ~6 ms) ≈ 25–35 min.
- **risks**: Shadow maps and many small solids make it the heaviest of the paper looks; kinematics are hand-eased rather than solved, so a fold seen from a bad angle can look stiff. Legibility depends on the tabs facing the camera, which constrains camera orbits to the front half of the book.

## 07 · PS1 low-poly cutscene (`ps1`)

- **technique**: three.js at an internal 384×216 (1/5 of 1080p), nearest-upscaled: vertices snapped to that grid in the vertex shader (polygon jitter), affine texture mapping (uv·w trick), per-vertex Gouraud light and fog, nearest 64 px textures without mipmaps, then 15-bit colour with the PS1 4×4 ordered dither. Low-poly models built in code; game-cutscene camera with hard cuts on downbeats.
- **palette**: Night-blue fog #141B2E, warm desk-lamp key light, CRT beige, strawberry red #D8283C with seed yellow, title yellow #FFD23F on orange-red sides; UI navy panels with bone-white pixel text.
- **typography**: An original hand-built 5×7 bitmap font (drawn at 2× in the dialogue box, 1× in the chat box and on the CRT); block titles extruded from Rubik Mono One with 2 curve segments per glyph.
- **lyrics**: Both dialogue windows are textured quads hung in the 3D set (vertex-snapped and affine-warped like the walls), anchored per camera stretch so the camera moves around them; on the kick fill the lyric window recoils with each push-in. Bottom window, speaker “DEV”: each character types as the word is sung (a word types over ≤0.22 s from its start), held notes wave, a ▼ blinks when the line is done; key words also drop in as 3D block titles on their hits. The chatbot’s lines type in a second window with its own portrait.
- **cost**: Measured (render.ts perf, 42–47 s): 11.2 ms/frame at 1 sample, 18.2 ms at 4 (≈2.3 ms per extra sub-frame; the 3D pass is only 384×216). Full 204 s song with motion blur: ≈11 min at ~20 sub-frames, ≈19 min at 36.
- **risks**: The pixel grid makes small text depend on the bitmap font (fine at 1×/2×); vertex jitter plus motion blur can smear rather than jitter, so the export may want fewer sub-frames for this style. Keeping it original (no real game UI) is a design constraint on the boxes.

## 08 · Oscilloscope vector display (`scope`)

- **technique**: One electron beam draws everything: wireframe 3D (a lathe-turned glass, a strawberry mesh, extruded single-stroke letters) projected through an inner camera into additive GPU beam vectors; the afterglow is the display re-evaluated at 6 past times over 0.2 s, and long vectors dim like a constant-time vector generator. The tube itself is a small analytic ray-traced object (curved face, etched graticule with parallax, bezel, knobs) seen by an outer camera.
- **palette**: P3-style amber phosphor on warm black: faint traces fall to deep orange, strong ones saturate to white-hot. Amber rather than green or cyan: it belongs to the video’s warm ink / signal-red / mustard family, reads as 1980s instrument rather than “hacker”, and its orange afterglow gives the wine a colour without a second gun.
- **typography**: Single-stroke plotter fonts: EMS Allure script for the narrator (the lyrics), EMS Tech for the chatbot and the UI, Hershey Sans capitals for the hero word; the panel print is condensed Bricolage.
- **lyrics**: Pen-written: the beam head writes each word while it is sung (stroke length synced to the word timings); held notes finish early, then the last stroke trembles and the beam keeps tracing the note as a waveform out of the word.
- **cost**: perf mode (1 sub-frame, incl. post + readback; the smoke scene alone is 8.9 ms): 9.7–11 ms avg, p95 14–18 ms (6 afterglow evaluations, ~30k beam vectors). Full song with motion blur at ~24 sub-frames/frame: about 50 min.
- **risks**: Wireframe clutter when objects overlap (hidden lines are dimmed, not removed); the thin script needs size to stay readable; a whole video of amber lines could get monotonous without the tube/knob shots to break it up.

## 09 · Xerox punk zine (`zine`)

- **technique**: A real 3D collage (extruded paper scraps, tape and staples with shadow-mapped light on a zine spread) flown through by the camera, then photocopied in a shader: toner threshold with stipple, generation noise on twos, dust and dropouts, a misregistered spot pass, and the copier light bar as a wipe; toner edge darkening and drum streaks are printed on the sheets themselves.
- **palette**: Copier paper and black toner only, plus one fluorescent spot pink for the fail marks (the circled R’s, the wrong “2”, the BRIM line and the gap).
- **typography**: Ransom-note letters cut from Anton, Bricolage, Special Elite, Rubik Mono, JetBrains Mono and (only on big letters, whose hairlines survive the toner) Bodoni; chat printouts in JetBrains Mono, typed prompts in Special Elite; marker scrawls in single-stroke brush and print hands.
- **lyrics**: One slap per word at its start: the word’s letter scraps fall and land in a 0.1 s cascade with small spins (shadows shrink as they land); held notes get extra tape strips slapped on the beat; STRAWBERRY is the hero word and gets its R’s circled and counted.
- **cost**: Measured on a shared, loaded machine: 22 ms/frame at 1 sample (perf, incl. readback) and 9.7 ms per sub-frame at 12 samples (a 3D pass with a 2048 shadow map and MSAA 4x, one xerox pass, a second 3D pass only during the 0.2 s light-bar sweep). Full 204 s song with motion blur (about 20 sub-frames average): roughly 40 min.
- **risks**: The threshold look can swallow thin type at a distance (every lyric line is framed large); many small meshes and shadow maps are cheap, but a full-song version needs a layout tool for the collage; the lid edge and stipple must not flicker too much at 60 fps (they boil on twos).

## 10 · Pencil animatic (`pencil`)

- **technique**: Storyboard sheet in 3D whose panels are windows into their own 3D worlds, all drawn as pencil lines on the CPU (contours and silhouettes from each camera, visible sides only, hatching by shade) into a float coverage buffer, then laid onto re-seeded paper tooth in one pass. Line boil on twos (12 fps).
- **palette**: Warm drawing paper, graphite (light pressure catches only the tooth, heavy fills it with sheen), non-photo-blue construction, red pencil for the director’s notes and the fails.
- **typography**: Single-stroke hand fonts only: the lyrics hand-lettered in Hershey Script, notes and screen text in EMS Readability, shot numbers in the technical hand, the director’s camera moves in red.
- **lyrics**: Each word is written as sung with the pencil tip in shot (writtenLength against the word timings), blue guidelines ruled up to 0.4 s before; held notes are re-traced heavier; the hit word R’s gets its own big line after a CRASH IN (zoom lines, blocked-in hero boxes); STRAWBERRY is the lyric drawn as 3D block letters, one letter after another; the caption boxes under the panels are written as sung too.
- **cost**: Measured on a shared, loaded machine: 11-14 ms/frame at 1 sample (perf) and 4.6 ms per sub-frame at 12 samples: all CPU line generation (projection, silhouettes, hatching) into one LineBatch plus one paper pass; sheet views with four panels peak near 25 ms. Full song with motion blur: roughly 20 min.
- **risks**: Line counts climb when several panels are on the sheet at once (each panel re-draws its whole world); stroke-font text at small panel size needs framing care; a full song needs many drawn worlds, but they are cheap to author (polylines, no assets).

## Recommendation

**09 · Xerox punk zine**, optionally combined with **04 · Patent drawing**.

- It is the narrator's own voice: a smug programmer's hand-made zine ("YOUR JOB IS SAFE! issue #1"), with the pop-punk DIY energy of the track. Ransom-note lyrics are the most distinctive karaoke idiom of the ten, and they vary naturally from scene to scene (slapped, taped, cut, xeroxed, stapled).
- Anything can enter the world cheaply: 3D objects go through the toner shader, so the song's dozen cases (hands, spaghetti, grandma, stage, mech, nuggets, robotaxi, clocks, desk, plumber, robot) need no new rendering technique.
- The single spot pink gives the story a colour code: pink marks the AI's fail in the first chorus and its fix in the final one, so the mirror reads at a glance.
- Combination: the machine's side drawn as patent figures photocopied into the zine ("FIG. 3 — apparatus for counting R's"; the robot plumber as "FIG. 1, plumbing apparatus" stepping off the sheet). Both are ink on paper with one accent, so the identity stays single while the narrator (collage) and the AI (technical drawing) get distinct voices.
- Risk: black-and-white for 3:24 can get monotonous; the scenes must vary their idiom and use the page-flip and copier-light-bar transitions for rhythm. Estimated render: ~40–60 min with motion blur.

Runner-up as a single style: **06 · Pop-up paper book**: the most readable and the warmest, with a lovely storybook irony, but softer energy and heavier authoring (every scene needs its own paper mechanism).
