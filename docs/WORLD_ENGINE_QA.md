# World engine QA

Branch `claude/world-engine` · package `packages/world-engine` (`@hello-world/world-engine`).
All results below were produced in the build container (4 vCPU, no GPU; Chromium + SwiftShader software WebGL).
Frame rates from SwiftShader are **not** representative of real GPUs and are not claimed as performance numbers.

## 0. Final handoff commit

**`b67ad69`**: all specialist passes complete, working tree clean. Verified in an isolated worktree, so in-flight edits are excluded:
- `tsc --noEmit -p .`: 0 errors
- `vitest run`: **50/50 passed across 9 files**
- `vite build`: OK

Round 4 (after the first handoff `dc28c56`) is verified at `68e92e2`: tsc 0 errors, vitest **53/53**, `vite build` OK. Additions since `dc28c56`:
- **Camera and events:** event cuts in every broadcast camera, an always-on event banner (raid count-up, join, gift, confetti; also shown in OBS overlay), an establishing shot, and a street camera aimed at residents.
- **World:** the super-terrain-derived landscape, generated forest and downtown skyline are mounted.
- **Avatars and creator:** 8 photoreal/realistic bodies, with a fixed-look card for them in the creator.
- **Simulation:** dialogue variety with a 3-minute no-repeat rule, need and friendship balance, and evening tiredness.
- **Interactions:** minimum on-screen sizes for bubbles and nameplates, local cheering, and overlay seating.

## 1. Verification commands and results

| Check | Command | Result |
| --- | --- | --- |
| Typecheck (package) | `npx tsc --noEmit -p .` | 0 errors at each integration commit (agents' in-flight edits excluded) |
| Typecheck as Codex's web app compiles it (`src` only, `types: ["vite/client"]`, no Node types) | temporary tsconfig extending `tsconfig.base.json` | 0 errors |
| Unit / integration tests (Node) | `npx vitest run` | **40/40 passed, 7 files** at handoff commit `dc28c56` (simulation incl. needs-range, low-need states, 13 seeds, raids; runtime guards incl. `ingressCooldowns:false` and auto-tick catch-up; runtime; persistence; node-safety; scene-store) |
| Bundle | `npx vite build` (harness) | built in 39 s; VRM + photoreal GLB/WebP assets emitted via `new URL(..., import.meta.url)`; VRM and realistic loaders code-split |
| Node-safety of `./runtime` | `test/node-safety.test.ts` | import graph contains only `@hello-world/contracts` + pure engine modules; runs headless |
| Codex runtime preflight (Codex-owned `tests/runtime-acceptance.ts` against engine `854b5af`) | see `docs/RUNTIME_ACCEPTANCE.md` on main | **10/10 passed** incl. server restart restoring identity, appearance, personality, social memory, weather |

## 2. Browser acceptance (frozen production build, `test/browser/acceptance.mjs`, quality=low)

Run 1 (20:29–20:35 UTC) against `vite preview` of commit `850e73e`:

| # | Acceptance test | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Neighborhood renders | PASS | `01-world.png`, 1 canvas, 0 page errors |
| 2 | Licensed rigged avatar loads | PASS | `__HW_AVATAR_STATS` `{vrmLoaded: 2, vrmFailed: 0, proceduralBuilt: 14}` (CC0 100Avatars VRMs); photoreal CARLA/MetaHuman bodies: `realisticLoaded: 8, failed: 0` in the realistic lab and `1/0` in the creator |
| 3 | Creator changes visible appearance | PASS (run 3, `dc28c56`) | `acceptance-3/03a-creator.png` → `03b-creator-changed.png`: outfit swatch click turns the top green; rig rebuilds once |
| 4 | Saved appearance survives reload | PASS (run 3, `dc28c56`) | after Save → reload, `viewer:me` restored from IndexedDB with `outfit.color: #7bd389`; also `test/persistence.test.ts` (IndexedDB + memory) |
| 5 | Multiple residents present | PASS | 7 seeded residents |
| 6 | Residents act autonomously | PASS | 5/7 changed position/activity in 12 s (café, arcade pinball, pond bench reading, stage, fountain) |
| 7 | Two residents interact → relationship changes | PASS | Nova→PixelCat friendship 72 → 79.3 |
| 8 | Memory record written | PASS | `Day 1 10:02 · Nova greeted PixelCat at Pixel Arcade — PixelCat smiled from ear to ear.` |
| 9 | `join` brings a resident in | PASS | `AcceptanceViewer @ (0.8, -18.2) arriving through the portal` |
| 10 | raid / confetti visible reaction | PASS | 5 raid visitors spawned; `10a-before-raid.png` vs `10b-after-raid.png` |
| 11 | Normal + transparent overlay render | PASS (run 3, `dc28c56`) | WebGL context `alpha: true`, body background `rgba(0,0,0,0)`; `11-overlay.png` shows residents, seats, café tables, stage and a live speech bubble in a lower band over a transparent frame |
| 12 | Package typecheck / test / build | PASS | section 1 |

Run 1's creator/overlay section timed out on navigation (30 s) under software rendering; run 2 hit a harness bug (`s` undeclared when skipping the world section); run 3 (20:49–20:52 UTC, frozen build of handoff commit `dc28c56`) completed with 120 s navigation timeouts.

**Result: 12/12 acceptance checks pass** (1, 2, 5–10 in run 1 at `850e73e`; 3, 4, 11 in run 3 at `dc28c56`; 12 verified at `dc28c56` in an isolated worktree: tsc 0 errors, vitest 40/40, vite build OK).

## 3. Independent critic cycles

### Cycle 1 (20:09–20:24 UTC, read-only critic agent, screenshots + code + tests) — **6.9 / 10**

| Category | Weight | Score |
| --- | ---: | ---: |
| 3D world & visual quality | 20 % | 6.5 |
| Character creator & avatar quality | 20 % | 6.5 |
| Sims-like life simulation | 20 % | 7.5 |
| Interactions & social behaviour | 20 % | 7.0 |
| Performance & technical reliability | 10 % | 7.0 |
| Persistence & memory | 10 % | 7.0 |

Most damaging problem: **cameras did not show the residents** (specks in the neighborhood shot, follow camera occluded by fountain/stage).
Top three improvements routed to owners: (1) resident-centric camera director (scene); (2) density and tension — more seeds, raid scaling, needs that don't saturate (simulation); (3) avatar close-up quality — pose, shoulders/hands, hair shells, accessory/hair resolution (avatars). Also routed: readable bubbles + distance-limited cheering + overlay standing poses (interactions); `WorldScene` memoization and per-frame allocation fixes (scene); low-quality draw-call budget (scene). Fixed by the coordinator: sim clock drift (bounded auto-tick catch-up + test).
Verified working by the critic: autonomy (7/7 residents moved, relationships 3→11, memories 5→14, 23 simulation events in ~3 game hours); gift/greet → memories and relationship tiers; weather changes behaviour; creator sliders change geometry (9 edits → 9 rebuilds); mobile bottom sheet.

### Cycle 2 (20:50–21:04 UTC, frozen build of handoff commit `dc28c56`) — **7.2 / 10 (+0.3)**

| Category | Weight | Cycle 1 | Cycle 2 |
| --- | ---: | ---: | ---: |
| 3D world & visual quality | 20 % | 6.5 | 7.0 |
| Character creator & avatar quality | 20 % | 6.5 | 6.8 |
| Sims-like life simulation | 20 % | 7.5 | 7.7 |
| Interactions & social behaviour | 20 % | 7.0 | 7.2 |
| Performance & technical reliability | 10 % | 7.0 | 7.3 |
| Persistence & memory | 10 % | 7.0 | 7.4 |

Measured by projecting every resident group to screen space (720p):
- **Neighborhood shot:** 12–13 of 13 residents on screen, median 52–54 px tall. In cycle 1 they were specks.
- **Follow:** subject unobstructed at 162 px.
- **Overlay:** 95.4 % of pixels transparent; all content sits in the lower band, with seats drawn.

Confirmed fixed:
- bubble legibility (14 px minimum)
- distance-limited reactions
- density (13 seeds: Townie, VRM and photoreal)
- `WorldScene` memoization and per-frame allocations
- backstory timestamps

Simulation over 10 game hours: relationships 9 → 39, memories 12 → 53, all 13 residents switched activities within 30 s, evening home routines.

Still open:
- **Most damaging:** events don't pay off in the default `neighborhood` view (no cuts, raid size not drawn).
- Street camera often empty.
- Cinematic framing cluttered by lamp posts and string lights.
- Repetitive intro dialogue.
- Social need and friendship drift high.
- Realistic bodies read as a body picker (no facial rig, waxy faces, stringy hair cards, default tint overrides their outfits).
- Low quality is still 116–338 draw calls.

Fixes routed to the owning agents at 21:05 UTC, with a 21:55 freeze:
- scene: event cuts in all modes, always-on event banner, street/cinematic composition
- simulation: dialogue variety, need/friendship balance
- realistic: hair alpha, softer tint, labels
- creator: realistic UX
- interactions: smaller greeting glyph, larger nameplates

### Cycle 3, final (21:25–21:34 UTC, frozen build of final commit `b67ad69`): **7.4 / 10** (+0.5 vs cycle 1, +0.2 vs cycle 2)

| Category | Weight | Cycle 1 | Cycle 2 | Cycle 3 |
| --- | ---: | ---: | ---: | ---: |
| 3D world & visual quality | 20 % | 6.5 | 7.0 | 7.4 |
| Character creator & avatar quality | 20 % | 6.5 | 6.8 | 7.0 |
| Sims-like life simulation | 20 % | 7.5 | 7.7 | 7.6 |
| Interactions & social behaviour | 20 % | 7.0 | 7.2 | 7.8 |
| Performance & technical reliability | 10 % | 7.0 | 7.3 | 6.8 |
| Persistence & memory | 10 % | 7.0 | 7.4 | 7.3 |

**The 9/10 target was not reached.** The final weighted score is 7.4.

Fixed:
- Events pay off in the default camera:
  - raid: cut to the portal, beam, and the banner "RAID! 40 viewers from CozyStreamer" counting up; 7 raiders arrive
  - gift: cut to the giver
- Street camera shows 6 residents at 149–227 px.
- Dialogue repetition is gone: 170 lines over 12 game hours, 156 exactly unique, none used more than twice.
- Friendship no longer saturates: peak 93.3, median about 50.
- The "!" glyph is gone.
- Nameplates are 11–12.5 px.

Partial:
- Cinematic composition: string lights and props still cross the orbit shot.
- Social need still drifts high (median 60 → 74) and never drops below 36.
- Photoreal bodies read as mid-quality NPCs: no facial rig, stiff idle, and a style clash next to the cartoon residents.

Not fixed:
- Draw-call budget at quality=low: 139 calls in the default view, 173–186 after a raid, 291–385 in cinematic. High is 349 calls and 724k triangles.

Most damaging remaining problem: **foreground props block close camera shots**: the umbrella in follow, a tree in street, string lights in cinematic, a lamp post in front of the raiders.

Recommended next steps:
1. Raycast-based occluder fading in the camera director.
2. Raid polish:
   - banner lifetime matched to the 9 s raid shot
   - name the gift recipient
   - collapse raider nameplates into one chip
   - let a join cut through the grouping window
3. Merge or instance static props and use earlier foliage impostors, targeting ≤ 120 draw calls and ~250k triangles at low.
4. Needs that occasionally become critical, and more autonomous gifts and compliments.

Evidence: `scratchpad/critic/c3/*` (screenshots, metrics JSON, dialogue sample, logs). `tsc` reported 0 errors and `vitest` 50/50.

### Cycle 4 (22:41–22:55 UTC, frozen build of round-4 commit `68e92e2`): **7.6 / 10** (+0.2)

| Category | Weight | C1 | C2 | C3 | C4 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 3D world & visual quality | 20 % | 6.5 | 7.0 | 7.4 | 7.4 |
| Character creator & avatar quality | 20 % | 6.5 | 6.8 | 7.0 | 7.4 |
| Sims-like life simulation | 20 % | 7.5 | 7.7 | 7.6 | 7.6 |
| Interactions & social behaviour | 20 % | 7.0 | 7.2 | 7.8 | 7.8 |
| Performance & technical reliability | 10 % | 7.0 | 7.3 | 6.8 | 7.5 |
| Persistence & memory | 10 % | 7.0 | 7.4 | 7.3 | 7.8 |

Round 4 changes:
- dithered occluder fading and orbit swing
- banner lifetimes, gift recipient and join cuts
- nameplate declutter and raid chips
- gift arc and memory on arrival
- need dips and social progression
- staggered raid arcs
- one draw call per low-detail resident, with real shadows only from the nearest 3
- lighter forest at low quality, alpha-to-coverage leaves, weather tint
- grounded overlay furniture

Default-view cost at quality=low went from 171–181 to **123–124 draw calls and 291–292k triangles**. The coordinator and the critic measured independently, both with the in-scene renderer.info probe. Across cameras at low quality the range is now 89–185, down from 139–385.

Fixed:
- Raid banner held for 12.7 s.
- Gift banner names the recipient.
- Join cuts no longer get swallowed by the coalescing window.
- Raider nameplates collapse into chips.
- Gift memory is written on arrival.
- Overlay furniture is grounded and the beam is slim.

Partial:
- Close-camera composition: cinematic C shows a lamp post, orbit shows a café wall, and follow framing is blocked by a planter.
- Low-need distress is visible only some of the time: 12 % of samples are below 25, but only a few show it.
- Low-quality foliage dithering.

Most damaging remaining problem: **the raid shot in the world view**. The full-height beam washes out the centre, the banner covers the raiders, and a lamp post stands in front of them.

New bug: the raid count-up starts at "0 viewers".

### Cycle 5 (23:13–23:27 UTC, frozen build of round-5 commit `8c0e483`): **7.7 / 10** (+0.1)

Scores: world 7.8 · creator/avatars 7.5 · simulation 7.7 · interactions 7.6 · performance 8.1 · persistence 7.8. History: 6.9 → 7.2 → 7.4 → 7.6 → 7.7.

Verified at `8c0e483`: tsc 0 errors, vitest 55/55, build OK.

Draw calls and triangles at quality=low:

| View | Draw calls | Triangles |
| --- | ---: | ---: |
| Default | 124–125 | 331k |
| Cinematic | 132 | |
| Follow | 129 | |
| Orbit | 140 | |
| Street | 162 | |
| Raid | 83 | |

Fixed:
- **Raid payoff in the world view.** Slim, fading beam. The portal sits top-centre with raiders in the upper-middle third and no prop in front. The banner is at the top, reads "40 viewers" and never shows 0.
- **Orbit and follow framing.** Orbit no longer clips into the café; follow keeps the subject in the central 80 %.
- **Visible low-need behaviour.** Shown about 56 % of the time a need is low.
- **Personality clashes.** About one clash every 2.3 game hours, with accepted and refused apologies.
- **Need-based inspector moods.**
- **Low-poly far forest.**
- **Creator tab jumps and the characterful default character.**
- **Name tags without a body (likely fixed).** Every resident's meshes sit at its position.

Remaining:
- **Most damaging: speech bubbles overlap in busy chat**, worst in the overlay.
- **The see-through dither (new regression).** The near-camera screen-door pattern reads as a glitch, and the camera-to-subject cone can dissolve benches under other seated residents.
- **Distress mostly shows as "looking for fun".** Residents low on energy sometimes choose fun over rest.
- **Repeated apologies between the same pair.**
- **The default creator face looks drowsy.**
- **Photoreal and Townie style clash (design trade-off).** The optional `?realisticStylize=1` warms the scans but doesn't close the gap, so it stays off by default.

### Cycle 6 (23:37–23:51 UTC, frozen build of round-6 commit `a2f9557`): **7.7 / 10** (7.74 weighted; flat vs cycle 5)

Scores: world 7.7 · creator/avatars 7.6 · simulation 7.8 · interactions 8.0 · performance 7.4 · persistence 7.8. History: 6.9 → 7.2 → 7.4 → 7.6 → 7.7 → 7.7.

Verified at `a2f9557`: tsc 0 errors, vitest 56/56, build OK.

Fixed:
- **Overlapping speech bubbles (cycle 5's worst problem).** In an 8-event burst the world view showed 4 bubbles with zero overlap and the rest collapsed into "Name …" tags. The overlay showed exactly 3, stacked with stems.
- **Seats dissolving under residents, and the coarse screen-door pattern.**
- **Raid payoff.** Measured with a slowed clock: 7 raiders at 16–20 % of frame height, the fountain out of frame, and the banner showing from +0.3 s to at least +5 s.
- **Distress.** Residents use at least 8 distinct distress lines, tired residents rest rather than chase fun, and apologies no longer repeat.
- **The default creator face.** It now reads friendly instead of drowsy.

Remaining:
- **Most damaging: the camera frames subjects through props.** In follow mode a lamp post sits between the camera and a seated resident. Cause: `centralClutter` ignores props within 1.2 m of the subject. The cinematic drift and the speaker push-in don't use the clutter test at all.
- **Bubble safe area.** Bubbles can cover the HUD pill and get clipped at the screen edge.
- **Raids feel small.** 40 viewers spawn only 7 avatars.
- **Label placement.** Labels can draw through buildings, and occasionally drift away from bodies in cinematic.
- **Street view cost.** 187 draw calls on low.
- **Style clash between photoreal humans and Townies.** A design trade-off.

Gains are plateauing around 7.7. The remaining items are composition-heavy camera work and crowd scale.

### Cycle 7 (00:03–00:17 UTC, frozen build of round-7 commit `11e48c5`): **7.7 / 10** (7.68 weighted; flat vs cycle 6)

Scores: world 7.6 · creator/avatars 7.5 · simulation 7.7 · interactions 7.9 · performance 7.6 · persistence 7.8. History: 6.9 → 7.2 → 7.4 → 7.6 → 7.7 → 7.7 → 7.7.

Verified at `11e48c5`:
- Isolated worktree: tsc 0 errors, vitest **61/61**, build OK.
- The CI workflow's four steps on a clean worktree all exited 0:
  - `pnpm install --frozen-lockfile`
  - `pnpm typecheck`: all 4 workspaces
  - `pnpm test`: world-engine 61/61, server 40/40
  - `pnpm build`: world-engine and web bundles built
- GitHub Actions: every "Verify" job on this repository ends about 3 s after it starts without running a single step. This happens on `main`'s own pushes as well as on this branch, so the red check is not caused by the code.

Draw calls at quality=low (coordinator probe, frozen build, 1280×720):

| View | Draw calls | Triangles |
| --- | ---: | ---: |
| Default | 127 | 329k |
| Follow | 126 | 329k |
| Cinematic | 113–131 | 315–354k |
| Street | 198–252 | 404–447k |

The critic measured street view at 139 and 175 at other moments. A per-object attribution probe (wrapping `renderBufferDirect`) shows about 70 % of street-view calls come from detailed Townie avatars, at 27–31 calls each: one mesh per body material slot plus about 16 face meshes.

Fixed (checked by the critic):
- **Bubbles and the safe area.** No bubble covered the HUD pill or was clipped at a screen edge in any capture.
- **Raid scale.** A 40-viewer raid brings 14 visitors (13 → 27 residents), with a portal close-up, a "+9 raiders" chip and the banner.
- **Lamp posts.** None stands in front of a follow subject any more.
- **Label drift.** Labels no longer drift off bodies; each plate is a child of its resident.

Remaining:
- **Most damaging: residents are tiny on the OBS overlay.** They are 20–30 px tall at 720p, and the camera never cuts in. The exact all-resident overlay fit, which keeps everyone in frame, frames the whole town, and overlay mode takes no directed shots.
- **Event shots.**
  - A gift shot shows the giver but not the receiver.
  - The confetti shot shows the actor from behind.
  - A chat push-in can leave the speaker past the frame edge for about 2 s.
- **Props in frame.**
  - Cinematic shots look through the stage string lights and posts, with see-through dither visible on the stage floor.
  - A seated follow shot is about 40 % arcade wall.
  - A planter fills the street foreground.
- **Names through props.** Names draw through the portal, the fountain and tree canopies, and some bubbles cover names.
- **The town barely sleeps.** Only 10–23 % of residents are asleep between 22:00 and 04:00, and some dance at 1–4 AM.
- **Mobile creator (390×844).** The expression strip is clipped, the preview is only about 250 px tall, and 52 tap targets are under 32 px.
- **Photoreal and Townie style clash.** Kept by design: the MetaHuman-derived bodies were an explicit product request, so they stay in the town.

### Round 8 (verified at `b98c2fc`)

Changes routed from cycle 7, each built by its own specialist agent:
- **Overlay readability (camera).**
  - The resting overlay now exact-fits the drawn residents' points, and the portal is included only around raids and joins or when someone is near it.
  - New subject-only event shots for raid, join, gift, social, wave, dance, confetti and chat: about 6 s (raid about 9 s), then a glide back. They can be turned off with `overlayEventShots={false}`.
  - The guarantee from the integration review still holds: nobody visible is clipped in the resting frame.
- **Event shots (camera).**
  - Two-shots frame both actor and target, roughly perpendicular to the line between them.
  - Shot timing uses the render clock, and the hold starts only once the subjects are in frame.
  - A subject who leaves the central 60 % of the frame for 0.6 s triggers a re-cut.
  - Single-actor shots start from the actor's front three-quarter.
- **Clutter (camera).** The pose tests now cover the stage string lights and posts, the portal ring, café planters, arcade cabinets and yard fences. A near-lens prop anywhere in the frame is rejected, and so is a side wall covering more than 30 % of the frame. The see-through dither is off during close event shots.
- **Labels and bubbles (interactions).**
  - Labels hide behind the fountain, the stage, the portal and big props (tree canopies, umbrellas).
  - Bubbles are laid out in the same frame by a collision-free slot search, so they avoid each other, the HUD, the toasts and protected labels.
  - In an 8-chat burst the agent measured 0 bubble–bubble, 0 bubble–label and 0 bubble–HUD overlaps in neighborhood, cinematic and overlay.
- **Night routine (simulation).**
  - Each resident gets personal bed and wake times. A calm night watch keeps 2–3 residents up, there is no tired or late dancing, and wake-ups are staggered.
  - Over 2 days with the default seeds, the share of residents asleep between 23:00 and 05:00 went from 16.6 % to 66.3 %, and 85 % are awake at 10:00.
  - Sleepers go inside: they are hidden once they reach their porch, with a Zzz at the door.
- **Avatar cost (avatars).**
  - New `mid` LOD.
  - Every Townie LOD is one merged mesh with per-vertex finishes. A `high` Townie costs 14 calls, down from 27–31; `mid` and `low` cost 1 each.
- **Mobile creator.**
  - The bottom sheet has three states, and expressions and animations sit in side rails.
  - At 390×844, tap targets under 40 px went from 89 to 0, and the avatar now fills 43 % of the screen height (24.5 % before).
- **Persistence.** Routine ticks save at most every 5 s; dispatched viewer actions are saved within 300 ms, and the world is also saved when the page is hidden.

Verified at `b98c2fc` in an isolated worktree: tsc 0 errors, vitest **83/83** (11 files), build OK.

Measured on the frozen build of `b98c2fc` at quality=low, 1280×720:

| View | Draw calls (`11e48c5` → `b98c2fc`) | Triangles at `b98c2fc` |
| --- | --- | ---: |
| Default (neighborhood) | 127 → **76–86** | 313–331k |
| Street | 198–252 → **69–78** | 406–456k |
| Cinematic | 113–131 → **67–75** | 365–450k |
| Follow | 126 → **75–86** | 309–326k |

Every view is now within the ≤ 120 draw-call target. The ~250k triangle target is not met, because the `mid` LOD keeps full tessellation.

Overlay readability, measured by projecting each resident at 720p (the same probe on both builds):

| | `11e48c5` | `b98c2fc` |
| --- | --- | --- |
| Resting frame, median (range) | 27 px (24–31) | **50 px (38–66)** |
| Clipped residents | 0 | 0 |
| Fully transparent pixels | 97.2 % | 91 % |
| Gift from Nova to PixelCat, +1.5 s / +2.5 s | 27 / 29 px, no cut | median 98 / 89 px, up to 150 / 169 px, both subjects in frame |
| After the shot | | eases back out to 42 px, all 13 in frame |

At 01:45 on day 2 (fast-forwarded), 9 of 13 residents were asleep, and exactly those 9 were hidden indoors. The other 4 were having a café drink, sitting on the pond bench or walking. The world and overlay pages logged 0 page errors.

### Cycle 8 (00:59–01:20 UTC, frozen build of round-8 commit `b98c2fc`): **7.9 / 10** (7.85 weighted; +0.17)

Scores: world 7.7 · creator/avatars 7.7 · simulation 8.0 · interactions 8.0 · performance 7.9 · persistence 7.8. History: 6.9 → 7.2 → 7.4 → 7.6 → 7.7 → 7.7 → 7.7 → **7.85**. This is the first gain after three flat cycles.

The critic's own runs: tsc 0 errors, vitest 83/83, 0 page or console errors.

Confirmed by the critic:
- **Overlay.**
  - The resting median rose from 20–30 px to 50 px, with a max of 66–77 px.
  - Events now get their own overlay shots. Raid: 145–149 px. Gift receiver: 115–178 px. Confetti actor: 155 px. Greet: 105–153 px. Chat burst: median 87 px.
  - Transparency holds: 83–85 % of pixels are fully transparent and all corners are at alpha 0.
- **Event shots.** The gift receiver is framed front-on at 207–221 px, and the speaker push-in stays in frame at 229–285 px.
- **Bubbles.** In bursts, no bubble overlapped another bubble or a nameplate, and none was off screen.
- **Nights.** 64–82 % of residents are asleep between 00:00 and 06:00, with no dancing in those hours, and wake-ups are staggered.
- **Mobile creator.** The preview is 390×490 and the expression buttons are 40×40.
- **Draw calls at quality=low:**

  | View | Cycle 8 | Cycle 7 |
  | --- | --- | --- |
  | Default | 74–86 | 99–127 |
  | Street | 66–82 | 139–175 |
  | Follow | 72–99 | 108–152 |
  | Night | 93–108 | — |
  | Raid spike | 134 | — |

- **Persistence.** A reload restored all 27 residents, 23 of 23 relationships (within ±6), the memories and the weather.

Remaining:
- **Most damaging: overlay events are only half shown.**
  - In a gift between distant residents, the giver (the paying viewer) is off screen for 3–4 s.
  - A greet's target never enters the shot.
  - Overlay confetti is shot from behind, and the confetti starts above the frame.
  - Weather draws nothing on the overlay (`<WeatherFx>` is skipped when transparent), and there is no weather toast.
- **World camera modes.**
  - Follow loses a seated or sulking subject.
  - Street mode covers about half the frame with a stippled canopy, because the see-through dither still runs there.
  - In cinematic, labels can sit 75–100 px from their owners.
- **Overlay composition.** The opaque stage disc and the café furniture are heavy, subjects and bubbles get pushed to the top edge, and the "+N raiders" chip count jumps around.
- **Simulation.**
  - About a third of residents are up at 1–4 AM (the deliberate night watch).
  - One stage line ("tearing up the stage") is said while the stage is empty.
- **Avatars.**
  - Photoreal faces are flat-lit and can't emote.
  - "Afro" reads as a beret.
- **Tooling.** Playwright can't click Save because of an actionability timeout; a DOM click works.
- **Triangles.** 300–450k normally, and 661k during a raid.

### Round 9 (verified at `12d73f6`)

Routed from cycle 8, one specialist agent per area:
- **Simulation.**
  - **Viewer social actions and gifts now meet in person.** The actor walks to a target more than 5 m away, jogs past 12 m, and the two meet halfway past 25 m. The payoff (reply, friendship, memory, hand-over) always lands within 9 s; if that cap is hit, it happens at the distance reached. A wave stays a wave across distance.
  - **Grounded dialogue.** Lines claiming someone is dancing or on stage are re-checked when spoken. Across 4 worlds × 24 game hours, false claims went from 3 of 6 dancer lines and 9 of 35 stale "watching X dance" samples to 0.
  - **Night watch.** Between 01:00 and 05:00, 2–3 locals are awake (3–6 before), with no dancing or arcade.
- **Camera.**
  - **Two-beat event shots in the world view and the overlay:**
    - open on the actor, front three-quarter;
    - follow the approach;
    - cut to a two-shot once the pair is within 10 m;
    - hold it for 2.4 s with both in frame.
  - **Far pairs.** A pair still more than 26 m apart ends on the actor rather than a tiny wide shot.
  - **Overlay framing.** Overlay shots favour the actor's front, and an asymmetric safe band leaves headroom for bubbles.
  - **Follow framing guard.** Head and feet stay within ±0.8 NDC, with a minimum down-angle.
  - **Street mode.** No see-through stipple, and poses avoid wide canopies near the lens.
- **Effects.**
  - **Confetti.** Actor confetti now pops at about 3.2 m, so it falls through close shots; the raid shower is unchanged.
  - **Overlay weather.** Rain and snow now render on the overlay without breaking alpha, and sunset warms the light.
  - **Weather toasts.**
  - **Overlay furniture.** The stage is a faint decal, and furniture is drawn only while someone sits on it.
- **Interactions.**
  - **Edge bubbles.** A viewer chat from a speaker who is off screen, behind the camera or indoors is pinned to the screen edge as "NAME: text", with a chevron pointing toward the speaker. At most 2 show at once.
  - **Raid chip.** It shows one stable number per raid, the same as the banner.
  - **Label and bubble projection.** Labels and bubbles are projected with the camera the frame is actually drawn with (`scene.onBeforeRender`), which removes the one-frame drift.
  - **LOD cleanup.** `LodBus` entries of departed residents are removed.
- **Avatars.**
  - **Afro.** The Afro is now a coiled, clustered volume at every LOD and works with hats.
  - **Photoreal faces.** Skin and eye shading are better, and the outfit tint is consistent (no white collar).
  - **Photoreal gestures.** Photoreal bodies gesture with the head and neck from `setExpression`. In the creator the strip reads "Gesture" for them, and Blink is hidden.

Verified at `12d73f6` in an isolated worktree: tsc 0 errors, vitest **108/108** (12 files), build OK.

Measured on the frozen build of `12d73f6` at quality=low, 1280×720:

| View | Draw calls | Triangles |
| --- | ---: | ---: |
| Default | 75 | 328k |
| Street | 70 | 429k |
| Cinematic | 65 | 371k |
| Follow | 76 | 328k |

Overlay, with the same probe as before:

| Moment | Median (range) | Clipped | Transparent |
| --- | --- | --- | --- |
| At rest | 47 px (37–60) | 0 | 93.2 % |
| Gift Nova→PixelCat, +1.5 s / +2.5 s | 82 / 94 px, up to 238 px | 0 subjects; two bystanders partly in frame at +1.5 s | |
| After the shot | 43 px | 0 | |

In the gift frame, Nova is walking over to PixelCat with both in shot, under the banner "Nova gave PixelCat cupcake".

A viewer chat burst right after a 40-viewer raid:
- From +3.5 s, all 5 chats were visible with no overlaps, one first shown as an edge bubble.
- The earlier empty readings at +2 s are SwiftShader's slow first frames.

### Cycle 9 (01:58–02:24 UTC, frozen build of round-9 commit `12d73f6`): **8.0 / 10** (8.04 weighted; +0.19)

Scores: world 7.9 · creator/avatars 7.9 · simulation 8.2 · interactions 8.3 · performance 7.9 · persistence 7.9. History: 6.9 → 7.2 → 7.4 → 7.6 → 7.7 → 7.7 → 7.7 → 7.85 → **8.04**.

The critic's own runs: tsc 0 errors, vitest 108/108, 0 page or console errors in 12 browser runs. Its event conclusions come from unfrozen runs, because the render-clock freeze does not stop the simulation.

Confirmed fixed:
- **Overlay events.**
  - Gift at 10 m: both at 138–146 px.
  - Gift at 25 m: actor first, then both at 158–166 px for the payoff.
  - Far greet at 32 m: the actor seen front-on at 126–151 px, then both at 154–173 px.
  - Confetti falls inside the frame.
  - Rain and snow show on the overlay, corners stay at alpha 0, and weather toasts appear.
  - The raid chip reads "+40", matching the banner.
  - Furniture appears only while someone sits on it.
- **Camera and labels.** Street mode has no stipple, and the worst label drift is 9 px (69 px in cycle 8). Edge bubbles keep viewer chats visible with 0 overlaps.
- **Simulation.**
  - At night, about 80 % of residents are asleep from 00:00 to 05:00, with no dancing.
  - Meetings pay off at 1.1–1.3 m within 3–8.5 s.
- **Avatars.** The Afro has a coiled silhouette, and the photoreal outfit tint is consistent; the strip reads "Gesture" without Blink.
- **Leaks.** The stale-map leaks are fixed.
- **Persistence.** 27 of 27 residents and 28 of 28 relationships survive a reload.

Remaining:
- **Most damaging: the payoff in the main world view.** A gift or greet does not reliably show both people at the payoff.
  - Gift at 10 m: the giver is off screen while the receiver thanks them.
  - Gift at 26 m: the payoff appears only in a 42 px wide shot.
  - Far greet: the target is off screen at the meeting.
  - Part of this is avatar lag. Motion integrates `min(delta, 0.1)` per frame, so below about 10 fps avatars trail the simulation by metres, and the camera frames those lagging positions.
- **Composition.**
  - Follow mode is high-angle, with one overhead sample, and the subject can sit under the inspector panel.
  - A café umbrella covers about 35 % of a street shot.
  - Cinematic holds on an empty stage, and a nameplate is drawn over the HUD clock.
  - When the overlay is crowded after a raid, the median resident is 26 px.
  - Bystanders dominate some event shots.
- **Simulation.**
  - Sunset weather never expires: residents "admire the sunset" at night and at 10 AM.
  - One dialogue template has a plural slip.
- **Avatars and creator.**
  - Photoreal emotes move only the head and neck, the eyes are dull, and the header thumbnail shows a Townie for photoreal bases.
  - At maximum height, the creator's "Full body" view crops at the knees.
- **Performance.** A raid spike now reaches 203 draw calls and 835k triangles (134 and 661k in cycle 8). Other views run 57–99 calls.

## Launch film

A 21.2 s, 1920×1080, 30 fps silent launch cut was made from real product renders by a separate agent pair: footage capture plus a director working from the [cinetic](https://github.com/Leonxlnx/cinetic) skill (MIT). Remotion was skipped for time and the film was assembled with ffmpeg. The film is delivered outside the repository and is not committed.

## 4. Performance findings (measured only)

- Simulation: ~1.0 ms per step with 50 residents including the runtime wrapper (vitest, Node 22, best of 6×100-step chunks).
- Renderer (critic, `renderer.info` under SwiftShader, quality=low, before the routed fixes): 254 draw calls, ~523 k triangles, 39 programs. Static town geometry is merged (~7 draw calls); the remaining calls are residents, vegetation and effects. Real-GPU frame rates were **not measured**.
- Round 8, frozen `b98c2fc`, quality=low, 1280×720:
  - Draw calls: default 76–86, street 69–78, cinematic 67–75, follow 75–86.
  - Triangles: 309–456k.
- Bundle (harness build): main chunk 1.82 MB (538 kB gzip); VRM loader chunk 149 kB; realistic GLBs ~1 MB each, loaded on demand.
- Avatars:
  - Three LODs per resident:
    - `high`, live face: 3 within 9 m at low quality, 8 within 14 m at high quality.
    - `mid`, baked face: the next 10 within 18 m at low quality, the next 20 within 30 m at high quality.
    - `low`, everyone else.
  - Every Townie LOD is a single merged mesh; `high` is 14 draw calls, `mid` and `low` are 1.
  - Animation updates are throttled for far and off-screen residents.
  - Photoreal bodies share cached geometry and materials per body (LOD0 ~31k verts, LOD1 ~11k).

## 5. Licences of shipped assets

| Asset | Location | Licence |
| --- | --- | --- |
| 4 VRM guest avatars (100Avatars R1, Polygonal Mind) | `src/avatars/assets/` | CC0 (registry + embedded VRM meta), `CREDITS.md` with sha256 |
| 4 photoreal bodies + 26 WebP textures (CARLA 0.10 walkers via Valdrada) | `src/avatars/realistic/assets/` | CC BY 4.0 (attribution "CARLA Simulator (carla.org)") **and Epic MetaHuman licence**: interactive use allowed; **must not** be used to build datasets or train/test AI. `NOTICE.md` with sources + sha256 |
| Town, characters (Townie), effects, UI art | code-generated | original (no third-party art) |

## 6. Known limitations (honest)

- Renderer is WebGL (OBS-compatible). super-terrain's terrain/roads/lighting are WebGPU-only and are **not** adopted; its CPU terrain and tree generators are being ported to WebGL as optional modules (see README "Future engine modules").
- Photoreal bodies have no morph targets, so facial expressions/blink are unavailable for them (body language, emotes and bubbles still work).
- VRM guest skins honour height, accessories and outfit tint only.
- Contract needs are limited to energy/social/fun; mood is derived.
- Offline catch-up is bounded and opt-in; the world does not run while no runtime is hosting it.
