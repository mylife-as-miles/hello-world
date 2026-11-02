# World engine QA

Branch `claude/world-engine` · package `packages/world-engine` (`@hello-world/world-engine`).
All results below were produced in the build container (4 vCPU, no GPU; Chromium + SwiftShader software WebGL).
Frame rates from SwiftShader are **not** representative of real GPUs and are not claimed as performance numbers.

## 1. Verification commands and results

| Check | Command | Result |
| --- | --- | --- |
| Typecheck (package) | `npx tsc --noEmit -p .` | 0 errors at each integration commit (agents' in-flight edits excluded) |
| Typecheck as Codex's web app compiles it (`src` only, `types: ["vite/client"]`, no Node types) | temporary tsconfig extending `tsconfig.base.json` | 0 errors |
| Unit / integration tests (Node) | `npx vitest run` | **32/32 passed, 6 files**: simulation 16, wrapper-guards 6, runtime 3, persistence 3, node-safety 2, scene-store 2 |
| Bundle | `npx vite build` (harness) | built in 39 s; VRM + photoreal GLB/WebP assets emitted via `new URL(..., import.meta.url)`; VRM and realistic loaders code-split |
| Node-safety of `./runtime` | `test/node-safety.test.ts` | import graph contains only `@hello-world/contracts` + pure engine modules; runs headless |
| Codex runtime preflight (Codex-owned `tests/runtime-acceptance.ts` against engine `854b5af`) | see `docs/RUNTIME_ACCEPTANCE.md` on main | **10/10 passed** incl. server restart restoring identity, appearance, personality, social memory, weather |

## 2. Browser acceptance (frozen production build, `test/browser/acceptance.mjs`, quality=low)

Run 1 (20:29–20:35 UTC) against `vite preview` of commit `850e73e`:

| # | Acceptance test | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Neighborhood renders | PASS | `01-world.png`, 1 canvas, 0 page errors |
| 2 | Licensed rigged avatar loads | PASS | `__HW_AVATAR_STATS` `{vrmLoaded: 2, vrmFailed: 0, proceduralBuilt: 14}` (CC0 100Avatars VRMs); photoreal CARLA/MetaHuman bodies: `realisticLoaded: 8, failed: 0` in the realistic lab and `1/0` in the creator |
| 3 | Creator changes visible appearance | see run 2 | |
| 4 | Saved appearance survives reload | see run 2 (also covered by `test/persistence.test.ts`, IndexedDB + memory) | |
| 5 | Multiple residents present | PASS | 7 seeded residents |
| 6 | Residents act autonomously | PASS | 5/7 changed position/activity in 12 s (café, arcade pinball, pond bench reading, stage, fountain) |
| 7 | Two residents interact → relationship changes | PASS | Nova→PixelCat friendship 72 → 79.3 |
| 8 | Memory record written | PASS | `Day 1 10:02 · Nova greeted PixelCat at Pixel Arcade — PixelCat smiled from ear to ear.` |
| 9 | `join` brings a resident in | PASS | `AcceptanceViewer @ (0.8, -18.2) arriving through the portal` |
| 10 | raid / confetti visible reaction | PASS | 5 raid visitors spawned; `10a-before-raid.png` vs `10b-after-raid.png` |
| 11 | Normal + transparent overlay render | see run 2 (critic cycle 1 measured 93.8 % fully transparent pixels in overlay mode) | |
| 12 | Package typecheck / test / build | PASS | section 1 |

Run 1's creator/overlay section timed out on navigation (30 s) because the software renderer was saturating the CPU; run 2 uses fresh pages with 120 s navigation timeouts.

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

_Cycle 2 results are appended below when available._

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
