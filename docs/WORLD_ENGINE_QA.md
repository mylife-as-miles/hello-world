# World engine QA

Branch `claude/world-engine` · package `packages/world-engine` (`@hello-world/world-engine`).
All results below were produced in the build container (4 vCPU, no GPU; Chromium + SwiftShader software WebGL).
Frame rates from SwiftShader are **not** representative of real GPUs and are not claimed as performance numbers.

## 0. Final handoff commit

**`b67ad69`**: all specialist passes complete, working tree clean. Verified in an isolated worktree, so in-flight edits are excluded:
- `tsc --noEmit -p .`: 0 errors
- `vitest run`: **50/50 passed across 9 files**
- `vite build`: OK

Additions since the first handoff `dc28c56`:
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

## Launch film

A 21.2 s, 1920×1080, 30 fps silent launch cut was made from real product renders by a separate agent pair: footage capture plus a director working from the [cinetic](https://github.com/Leonxlnx/cinetic) skill (MIT). Remotion was skipped for time and the film was assembled with ffmpeg. The film is delivered outside the repository and is not committed.

## 4. Performance findings (measured only)

- Simulation: ~1.0 ms per step with 50 residents including the runtime wrapper (vitest, Node 22, best of 6×100-step chunks).
- Renderer (critic, `renderer.info` under SwiftShader, quality=low, before the routed fixes): 254 draw calls, ~523 k triangles, 39 programs. Static town geometry is merged (~7 draw calls); the remaining calls are residents, vegetation and effects. Real-GPU frame rates were **not measured**.
- Bundle (harness build): main chunk 1.82 MB (538 kB gzip); VRM loader chunk 149 kB; realistic GLBs ~1 MB each, loaded on demand.
- Avatars: per-resident LOD (detailed within ~30 m, ≤ 20 detailed rigs), animator update throttling for far/off-screen residents; photoreal bodies share cached geometry and materials per body (LOD0 ~31 k verts, LOD1 ~11 k).

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
