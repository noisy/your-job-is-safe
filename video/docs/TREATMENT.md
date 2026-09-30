# YOUR JOB IS SAFE! — treatment, style bible and scene plan (Phase 2)

Chosen style: **PS1-era low-poly** (Phase 1 story `07`, `src/scenes/style-ps1.ts`). Read this whole file, then
`ENGINE.md`, `STORY.md`, `../../handoff.md` (the facts behind every reference) and `../../prompt.md` (the
quality bar). This file is the shared contract for every scene author.

## The idea in one paragraph

The video *is* a forgotten PS1 game called **YOUR JOB IS SAFE!** Frame 0 is its title screen; the song plays
as the game's cutscenes; it ends on GAME OVER. The player character is **DEV**, a smug programmer in a green
hoodie. His opponent is **the chatbot**: always the same beige CRT head with two square blue eyes and a
line mouth, and a **version badge** on its casing (`v1.0` in verse 1, climbing through the video to `v6.0`
on the robot plumber). Each AI fail from the lyrics is a level with its own set. The viewer sees what DEV
refuses to see: the chatbot keeps getting bodies (grandma, toy, mech, drive-thru speaker, robotaxi) and
upgrades (the badge, the patch notes in the solo, the fixes creeping into chorus 2), until the final chorus
turns every chorus-1 image against him and the chatbot, finally, shows up at his door as a plumber.

## Style bible (one identity, every scene)

- **Finish.** Every scene renders its 3D world at **384×216** (exactly 1/5 of 1080p) and upscales with
  nearest filtering; vertices snap to that grid (polygon jitter), textures warp affinely, Gouraud lighting,
  per-vertex fog, 15-bit colour with the 4×4 ordered dither (`PS_OUT_FRAG`). No bloom, grain or CA from
  the engine's post (the kit's defaults turn them off; a scene may add a flash or shake). Textures are
  hand-made pixel art (Canvas2D, ≤128 px, nearest), models are low-poly and built in code.
- **Palette.** Night-blue fog `#141B2E`, warm key light, CRT beige `#C9BFA3`, DEV's hoodie green
  `#3F7A5A`, UI navy `rgba(14,20,48,0.9)` with bone-white `#E8E4D8` pixel text, title yellow `#FFD23F` on
  orange-red sides `#D9482B`, **fail red** `#FF4B5C` (the AI's mistakes), **fix green** `#5BE37D` (the
  mistakes fixed: rare in chorus 2, everywhere in the final chorus), chatbot blue `#8CD3FF`. Each set may add
  its own local colours (wood, grass, stage red), always dithered and fogged.
- **Type system.** One family: the kit's original **5×7 bitmap font** (`pixText`, drawn at 1×–4×, with
  the 1-px drop shadow) for every UI, sign, screen and label; **Rubik Mono One extruded block letters**
  (`blockTitle`) for big 3D title words. Nothing else. The lyric text must be readable at 1080p: in the
  384×216 grid that means ≥ 2× bitmap on a panel filling ≥ 55% of the frame width, or block letters.
- **Camera language.** A game cutscene camera: sweeping arcs, stepped push-ins on kicks (one step per
  kick, `ease.outExpo`), crash zooms and hard cuts on downbeats, whip pans between set pieces, low hero
  angles on reveals, a slow crane to a top-down "map" view to end a shot. Nothing holds longer than ~1 bar
  (1.39 s) without a sub-cut, a reframing or a strong move. Moves ease *into* the downbeat.
- **Panels.** Dialogue windows, menus and HUD elements are **textured quads in the 3D world** (`Panel`,
  hung in front of a reference camera pose with a tilt, snapped and warped like the set), never a flat
  screen overlay. They open/close like JRPG windows (0.12 s) between camera stretches.
- **The cast.** DEV (`makeDev`: green hoodie, brown hair, faces: neutral, smug, laugh, shock, sleep, sad,
  scared) and the chatbot (`makeBot`: the CRT head on different bodies, with `setVersion('v2.0')`). Both
  come from `src/ps1/cast.ts` so they look identical in every scene. DEV's room (`makeRoom`: desk, CRT with
  a live 128×96 screen canvas, lamp, chair, window) is the home set the story keeps returning to.
- **The CRT portal.** The recurring morph: the camera dives into DEV's CRT screen (it fills the frame) and
  the next set is what the screen shows, or pulls back out of a screen into the next set.
- **Taste.** Deadpan, specific, funny. Real people and brands only as plain text labels, never logos or
  likenesses. No real game UI (no PlayStation logo, no controller face symbols △○✕□, no real game's menus).
  No Nazi symbols (the Grok beat: a mech with a tiny mustache and nothing more). The jokes target the AI,
  never people or groups.

## The second skin: paper craft (`?skin=paper`)

The user asked for a parallel version in a colourful low-poly paper-craft style. It is the same edit,
story, choreography and lyric idioms rendered through a second kit skin (`src/ps1/skin.ts`, `PAPER`):
full 1080p with 4× MSAA instead of 384×216; faceted folded-paper materials (flat facet normals, a warm
key, per-facet tone, paper fibre and flecks in world space) with a lifted, more saturated palette; the
same pixel-art textures drawn crisp at up to 8× (they read as printed cubecraft paper toys); the bitmap
font's cells set in Bricolage (kerned, tracked to the same widths) so every layout still fits; dot-matrix
displays stay dot-matrix (`glyphRows`, `pixText({ bitmap: true })`); and a depth-based out pass adding
contact shadows between layers and dark cut edges. Rules for scenes: psMat for every material; never read
pixels back from a canvasTex; branch on `PAPER` only for small tweaks. Output: `out/your-job-is-safe-paper.mp4`.

## Lyric rules (all scenes)

- Every sung word appears/highlights at its `start` and completes by its `end` (up to 0.4 s of dim
  anticipation; never ahead of the voice). Held notes visibly hold (wave, stretch, keep printing).
- Lyrics are part of the world, and **every scene uses a different idiom** (the table below). A scene
  must show every word that overlaps its window, including a previous line's held tail at its start.
- Look everything up (`lyrics.get('…')`, `audio.downbeats`, `audio.events('kick', …)`); never hard-code
  a time. Window bounds are `ctx.start` / `ctx.end` (from `src/timeline.ts`, cut on downbeats).

## Scene plan

Windows are cut on downbeats: `cut(line)` = the last downbeat at or before the line's first word;
`after(line)` = the first downbeat after the line's end. Approximate times in brackets. Owner = the agent
that builds the module (`src/scenes/<module>.ts` + `src/scenes/<module>-*.ts` helpers).

| # | module (params) | window | lines | what we see | lyric idiom | out → next (the morph) | owner |
|---|---|---|---|---|---|---|---|
| 1 | `intro` | 0 → cut(I write my code) [0–8.20] | spoken: "AI will replace…", laugh, "Yeah. They said that last year too." | **Frame 0 = the game's title screen**: YOUR JOB IS SAFE! in 3D block letters, a spinning low-poly thumbs-up, "PRESS START" blinking, a deadpan `©1999 DEV SOFT` line. On "AI will…" the title flips away into a TV newsroom-style montage of three front pages spinning in (paraphrased headlines with years and speakers as plain text: "Don't learn to code" — Nvidia CEO, 2024; "AI mid-level engineer this year" — Meta CEO, 2025; "90% of code in 3–6 months" — Anthropic CEO, 2025), each stamped NEXT YEAR. The laugh: DEV at his desk, laughing (face `laugh`), HA HA HA block letters bouncing on the laugh. "They said that last year too": a tear-off calendar flips 2023→2024→2025→2026, each year's leaf stamped "next year". Music starts at `musicStart` (8.18): the first hit. | Headline words stamped onto the spinning front page, one per word (letterpress slam); line 2: one word per calendar leaf flip. | The last calendar leaf flies at the camera and lands on DEV's desk as the CRT's frame → `v1-desk` opens pulling back from the CRT. | C |
| 2 | `v1-desk` | cut(I write my code) → cut(Drew a hand) [8.20–16.53] | code by hand / tabs, never spaces / "try the robot, bro" / "show me the proof" | DEV's room at night. Close-ups of the keyboard: every semicolon key press; a theatrical Tab press (tabs shown as → marks, never · spaces; "20 YRS" on a mug); the CRT's code editor; a coworker's IM window pops up "try the robot, bro" with the chatbot's `v1.0` icon; DEV types "show me the proof". | Per-character typing into the CRT's code editor (syntax colours, → tab marks, blinking caret), in sync with the vocal; the coworker's line arrives as an IM popup. | "show me the proof" is sent; the camera dives into the CRT → `v1-hand-spaghetti` starts inside the screen's image generator. | A |
| 3 | `v1-hand-spaghetti` | cut(Drew a hand) → cut(Told it "be my grandma") [16.53–24.86] | six-fingered hand / "what a goof!" / Fresh Prince + spaghetti / face melting, fork flying | An image generator (an original UI on the CRT, "img gen v1.0") renders a giant low-poly hand that rises into the room; its fingers are counted 1…6 in fail red; DEV points and laughs ("what a goof!"). Then the 2023 AI-video nightmare, restaged as an original non-photoreal low-poly diner guy (not a likeness; plain-text caption `"Will Smith eating spaghetti" (2023)`): face vertices melting into the sauce, the fork fused to his hand, noodles teleporting between frames, the fork spinning like confetti. | Line 1: glyph wipe, the words revealed by the generator's render scanline (top to bottom). Lines 2–3: the words **ride along a noodle** (text on a 3D spaghetti curve, each word sliding along as sung). | A noodle whips across the lens → `v1-grandma-calendar` opens on grandma's knitting yarn (same curve). | A |
| 4 | `v1-grandma-calendar` | cut(Told it "be my grandma") → cut(So go ahead and hype it) [24.86–30.44] | grandma reads Windows keys / "twenty twenty-one, please!" | A cozy bedroom: the chatbot as a grandma (CRT head, reading glasses, shawl, rocking chair) reads a bedtime storybook to little DEV in bed; the book's pages are generic key blocks (`XXXXX-XXXXX-XXXXX…`), with a plain text caption "the grandma exploit (2023)". Then the tear-off calendar on the wall stuck at 2021 ("As of my knowledge cutoff in September 2021…" on the chatbot's speech panel) while today's newspaper on the bed says 2026. | Words printed on the storybook's pages, revealed word by word as grandma reads (a pointer follows them); line 2 on the calendar leaf. | The calendar leaf peels off and becomes the first post card of the feed → `pre`. | A |
| 5 | `pre` {n:1} | cut(So go ahead and hype it) → cut(Watch it try to do the simplest thing) [30.44–38.76] | hype it, genius, smart / hand-typing, craft, art / slop machine | A 3D social feed: an endless vertical column of post cards the camera flies up along (hype posts, slop images: six-fingered selfies, melting food), DEV scrolling with pity. "I'll be over here hand-typing": DEV as a craftsman at a workbench-desk, a CRAFT/ART plaque. "It's slop, it's slop, it's a slop machine": the SLOP MACHINE, a chunky factory contraption with the chatbot's face, extruding goo; footnote `Merriam-Webster Word of the Year 2025: slop`. | Each word of line 1 is its own post card popping into the feed; line 2 typed on a brass workbench plaque; line 3: each word is **extruded as goo letters** out of the machine's nozzle (one word per hit). | The machine's conveyor carries the last goo word onto DEV's desk → `chorus-count` (DEV at his CRT). | C |
| 6 | `chorus-count` {v:1} | cut(Watch it try to do the simplest thing) → after(It can't fill a glass of wine) [38.76–48.49] | "Watch it try…" / strawberry / glass of wine | The Phase-1 scene, extended by one bar at the start: the prompt `how many r's in "strawberry"?` typed; the kick-fill wind-up; the strawberry slams down on "R's"; STRAWBERRY with its three R's counted, the bot's confident "2", straw\|berry tokens; the half-full "filled to the brim!" glass with BRIM/GAP. | The DEV dialogue panel typing per character + 3D block titles on the hits (the Phase-1 idiom). | Crane up to the rim circle → it becomes a clock face → `chorus-clocks`. | B |
| 7 | `chorus-clocks` {v:1} | after(glass of wine) → cut(Nah, I'm not losing sleep) [48.49–55.44] | every clock says ten past ten / plenty of time / six fingers waving hi | A clock shop wall of dozens of low-poly clocks, every one at 10:10 (the chatbot's drawings); DEV lounges in a hammock between them ("plenty of time", a 10:10 hourglass that never empties); the six-fingered hand waves hi from the CRT. | Words **are the clock numerals**: each sung word lights up in place of an hour numeral around a giant clock face; line 3: one word per finger (the hand has exactly six: "Six fingers waving hi at me,"). | The waving hand's palm fills the frame, goes dark → `chorus-sleep` in DEV's dark bedroom. | D |
| 8 | `chorus-sleep` {v:1} | cut(Nah, I'm not losing sleep) → cut(Asked for the Founding Fathers) [55.44–66.56] | not losing sleep / toy, joke, party trick / my job is mine to keep | DEV asleep, smug, a dream bubble; a toy robot (the chatbot head on a wind-up body) doing a party trick on a table; DEV's office desk with his name plate, a MINE trophy; the instrumental bar after "keep!" pulls out wide over the office. | Line 1: letters float up out of DEV's head as **Zzz dream letters**; line 2: wooden **alphabet toy blocks** that stack up word by word; line 3: engraved on the name plate / trophy, hammered in per word. | Pull back: the office is a stage set; the curtain rises → `v2-stage`. | D |
| 9 | `v2-stage` | cut(Asked for the Founding Fathers) → cut(Then Grok) [66.56–72.12] | Founding Fathers → Hamilton cast / misgender or apocalypse → the blast | DEV asks the chatbot (v2.0) for a history painting; instead a spotlit Broadway stage with a cast in colonial coats under a marquee (plain caption "Gemini, Feb 2024: image generation of people paused"); affectionate to the musical, the joke is the overcorrection. Then the chatbot's answer "No." to the misgender-or-apocalypse question while a mushroom cloud rises outside the window (the chatbot's logic is the joke; no person is mocked). | Line 1: **marquee light bulbs** spelling each word as sung; line 2: an **RPG choice menu** (`▶ misgender` / `▶ the apocalypse`), the cursor ticking to "the apocalypse" and selecting it on "blast!". | The blast's white flash → `v2-grok` opens in the flash. | E |
| 10 | `v2-grok` | cut(Then Grok) → cut(Drive-thru bot) [72.12–77.69] | Grok drops its filters, veers the other way / grows a funny little mustache | A boss-intro: the chatbot's head on a chunky mech suit (plain label "Grok, July 2025"), its "safety filters" (literal plate-glass filters) dropping off and shattering; the mech veers the other way like a car swerving; it grows a tiny mustache and the camera cuts away awkwardly. No symbols, no names beyond the label. | A fighting-game **boss-intro banner**: each word slams in on its hit across a diagonal strip; "and that's all I'm gonna say." is **cut off**: a black censor block slams over the rest and the banner snaps shut. | The censor block fills the frame → `v2-roads` opens on the black of a drive-thru speaker grille. | E |
| 11 | `v2-roads` | cut(Drive-thru bot) → cut(So go ahead and tweet it) [77.69–83.24] | drive-thru bot ignored "stop!" / nuggets pouring down like rain / robotaxi to the flight / circled like a plane | A drive-thru at night: the speaker post has the chatbot face; DEV yells STOP; the order counter climbs to 260 NUGGETS (TikTok 2024, McDonald's AI test ended June 2024, as plain text) while nuggets rain from the sky. Then a robotaxi (a generic white car with a roof sensor dome, label "robotaxi, Dec 2024") circling a parking-lot roundabout eight times, DEV inside checking his watch, a plane circling above in a holding pattern. | Line 1: the drive-thru **LED dot-matrix menu board** scrolling the words; line 2: an airport **split-flap departures board**, each word flipping in letter by letter (FLIGHT… DELAYED). | Top-down: the roundabout ring → a scroll wheel → `pre` {n:2} opens on the feed. | E |
| 12 | `pre` {n:2} | cut(So go ahead and tweet it) → cut(Watch it try…, 2nd) [83.24–91.59] | tweet it, TikTok, trend / hand-typing like it's 2010 / slop machine | Same template as pre 1, faster and more crowded: short-video frames in the feed; a 2010 desktop nostalgia beat (an original old-OS desktop on the CRT, not a real one); the SLOP MACHINE bigger, now `v3.0`. | As pre 1 (post cards / plaque / goo), the goo now in fail red. | As pre 1 → `chorus-count` {v:2}. | C |
| 13 | `chorus-count` {v:2} | cut(Watch it try…, 2nd) → after(glass of wine, 2nd) [91.59–101.31] | as #6 | As #6 with the irony growing: the bot's reply flickers "3" for two frames before "2"; the glass is a little fuller; the chatbot badge `v3.0`. DEV doesn't look. | As #6. | As #6. | B |
| 14 | `chorus-clocks` {v:2} | → cut(Nah, I'm not losing sleep, 2nd) [101.31–108.27] | as #7 | As #7; one clock's second hand twitches; the hand has five fingers for a single frame. | As #7. | As #7. | D |
| 15 | `chorus-sleep` {v:2} | → after(And my job is mine to keep!, 2nd) [108.27–119.40] | as #8 | As #8; the toy robot's trick is suddenly competent; DEV sleeps through it. | As #8. | Pull back into the CRT showing PATCH NOTES → `solo`. | D |
| 16 | `solo` | after(job is mine to keep, 2nd) → cut(Monday morning) [119.40–127.74] | (guitar solo) | The fails get patched while DEV isn't looking: the chatbot's patch notes as a PS1 menu screen/inventory list in 3D, each fail from the video (with its icon: strawberry, wine glass, clock, hand, grandma's book, 2021 calendar, drive-thru bag, robotaxi) ticked **FIXED** in fix green on the beats, version counter climbing `v3.2 → v5.0`; DEV air-guitars on his keyboard in the background. | No lyrics: the patch-note lines type in per beat (the solo's own idiom). | The last line "v5.0: can now do your job" → cut to the Monday ticket board → `breakdown`. | C |
| 17 | `breakdown` | cut(Monday morning) → cut(And lately) [127.74–141.68] | Monday ticket / "two weeks" / typed it in to watch it choke / coffee → masterstroke / Oh… duck! | Half-time, uneasy: a kanban board on the office wall; DEV estimates "2 WEEKS (maybe more)"; types the ticket into the chatbot to watch it choke; walks to the coffee machine (time-lapse); comes back to a finished pull request, every test green ✓✓✓, MERGED. "Oh…": a speech bubble with a grawlix `@#$%&!` gets autocorrected into "duck", and the rubber duck on his desk stares back (push-in on the duck). | Words **handwritten on sticky notes** slapped on the board as sung (line 1–2); line 3 typed in the chatbot's prompt box; line 4 on the PR screen; "Oh… duck!" as the autocorrect bubble. | The duck's eye → darkness → `bridge`. | C |
| 18 | `bridge` | cut(And lately) → cut(Now it always finds) [141.68–164.96] | something's weird / grandma's out of keys / Tesla drives me / wine drips / Will Smith smooth and slow / can't tell it's fake / …Oh no. | Whispered, instruments drop out, thick fog, slow drifting camera (the one place moves may be slow, but still never static): grandma's storybook with blank pages ("out of keys"); a one-second flash of a car smashing through a painted-road wall (plain text: "a camera-only Autopilot vs a painted wall, Mar 2025"), then DEV riding in a driverless car, hands on his knees; the wine glass overflowing and dripping on him; the spaghetti diner guy again but smooth, calm, high-poly, perfectly shaded (the one model that does not wobble: "can't tell it's fake"); "…Oh no." | **Thin whisper letters** that glyph-wipe in out of the fog, held notes stretching the glyphs wider; each line drifts past the camera like a floating sign. | The fog wipes to white on the downbeat → `chorus-count` {v:'final'}. | A |
| 19 | `chorus-count` {v:'final'} | cut(Now it always finds) → cut(Every clock is ticking fine) [164.96–170.52] | now it always finds the missing R / wine drips down my spine | The mirror: the strawberry again; the bot (v5.0) counts **1-2-3** and replies `There are 3 R's` in fix green; the third R lights up. The glass fills to the brim, overflows and the wine runs down DEV's back (a chill). | The dialogue panel + block titles again, but the titles now arrive **correct** (green ✓). | The overflowing wine drips on a clock face → `chorus-clocks` {v:'final'}. | B |
| 20 | `chorus-clocks` {v:'final'} | cut(Every clock is ticking fine) → cut(Now my job's not mine to keep) [170.52–178.89] | clocks ticking fine → counting down to my deadline / five fingers waving bye | The 10:10 clock wall starts ticking; the hands sweep into a giant countdown `DEADLINE 00:00:03…`; the hand, now with five correct fingers, waves him bye. | Clock-numeral words again, now ticking; "Five fingers waving bye to me,": one word per finger and the sixth word on the palm. | The waving hand closes into a grip on a cardboard box → `chorus-sleep` {v:'final'}. | D |
| 21 | `chorus-sleep` {v:'final'} | cut(Now my job's not mine to keep) → cut(Fine! I'll be a plumber) [178.89–181.68] | now my job's not mine to keep | The chatbot (on a humanoid body) packs DEV's desk into a cardboard box; the name plate goes in last; the MINE trophy gets a "NOT" sticker. | Engraving again, but the plate is **scratched out** word by word. | The box lid closes → `plumber`. | D |
| 22 | `plumber` | cut(Fine! I'll be a plumber) → `splice` [181.68–192.45] | Fine! I'll be a plumber, fix your sink / AI can't hold a wrench | DEV in overalls under a kitchen sink, wrench in hand, confident; plain text footnote `"train to be a plumber": Geoffrey Hinton, June 2025`. The held "think!" is a proud hero pose. | Letters **assembled from pipe segments**, water flowing through each word as it's sung. | The doorbell (the guitar at `splice`, 192.45) → `robot`. | B |
| 23 | `robot` | `splice` → end [192.45–204.17] | "You're absolutely right." / "Move aside, human. I have a task to complete." | The doorbell rings exactly at 192.45: DEV opens the front door to a humanoid robot plumber (the chatbot head, `v6.0`, cap, toolbox). "You're absolutely right." on its face screen; it steps in, knocking DEV over (a visual: no "obstacle" line), and walks straight to the sink. "I have a task to complete" as its HUD objective banner (the robot's POV). End: **GAME OVER** — `CONTINUE? ▶YES NO` — the cursor can't move; then the meta reveal: "This song was generated by an AI. Its lyrics were co-written with one." and the title again. | Line 1 on the robot's **LED face** (dot matrix); line 2 as a **quest/objective banner** in the robot's POV HUD; then the end card. | — | B |

## Transitions

- Hard cuts only on downbeats (the window boundaries already are). Every boundary is also a **match**: the
  outgoing scene's last frames and the incoming scene's first frames share a shape, object or colour field
  (the "out → next" column). The owner of the *incoming* scene designs its first frame to match the
  outgoing scene's last frame; check both sides with `render.ts sheet --cuts`.
- A scene may overlap its predecessor (set `handlesTransition = true`, composite `f.under`) for a flash or
  a wipe; ask the lead before changing a window in `src/timeline.ts`.

## Recurring motifs

1. The CRT portal (dive in / pull out of DEV's screen).
2. The chatbot face and its version badge: v1.0 (verse 1) → v2.0 (verse 2) → v3.0 (pre 2 / chorus 2) → v3.2…v5.0 (solo) → v5.0 (breakdown, final chorus) → v6.0 (the plumber robot).
3. Fail red vs fix green: red marks every fail through chorus 2; from the solo on, green ticks replace them.
4. The rubber duck lives on DEV's desk from `v1-desk` on (a small yellow cube duck), so its stare in the breakdown pays off.
5. The 10:10 clock appears in DEV's room from verse 1 on (never moving) until the final chorus.

## Technical conventions

- Build on the kit in `src/ps1/` (`stage.ts`, `cast.ts`, `gfx.ts`, `palette.ts`); don't copy it. Kit
  changes: ask the lead (B maintains it).
- Deterministic, stateless, a pure function of `f.t`. Performance ≤ ~8 ms per sub-frame (the 3D pass is
  only 384×216; the cost is Canvas2D panel uploads: keep them ≤ 3 per frame and only re-draw when the
  content changes).
- Verify with stills, sheets (`--only <entry ids>`), `--cuts`, and `perf`; look at every render.
