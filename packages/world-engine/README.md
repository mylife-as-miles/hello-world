# @hello-world/world-engine

The living-neighborhood engine for HELLO WORLD: a 3D town (`WorldScene`), an
inZOI-inspired character studio (`AvatarCreator`), and a deterministic, Node-safe
life-simulation runtime (`createWorldRuntime`) implementing contract v1 from
`@hello-world/contracts`.

```tsx
import { WorldScene, AvatarCreator, createWorldRuntime } from '@hello-world/world-engine';
import { createWorldRuntime } from '@hello-world/world-engine/runtime'; // Node-safe: no React/DOM/three/Dexie

const runtime = createWorldRuntime({ worldId: 'hello-neighborhood', seedResidents: true, autoTick: true });
<WorldScene runtime={runtime} cameraMode="neighborhood" transparent={false} />
<AvatarCreator initialAppearance={appearance} displayName="Miles" onSave={saveAppearance} onCancel={close} />
```

## Package layout

| Path | Owner pass | What |
| --- | --- | --- |
| `src/runtime/` | coordinator | `createWorldRuntime` (contract `WorldRuntime`), validation, cooldowns, bounded queue/dedupe/history, `migrateSnapshot`. **Node-safe** (enforced by `test/node-safety.test.ts`). |
| `src/simulation/` | simulation | Deterministic needs/personality/utility-AI, navigation, relationships, memories, conversations, event semantics, optional dialogue provider. Node-safe. |
| `src/world/` | coordinator | Shared pure data: layout + nav graph (`layout.ts`), activity vocabulary (`activities.ts`), world clock (`time.ts`). Node-safe. |
| `src/avatars/` | character systems | `catalog.ts` (Node-safe ids/palettes/`normalizeAppearance`), procedural "Townie" rig, VRM adapter (`@pixiv/three-vrm`), `useAvatarRig`. |
| `src/creator/` | creator studio | `AvatarCreator`. |
| `src/scene/` | environment | `WorldScene`: town, lighting, day/night, weather, portal, confetti, cameras, overlay mode, HUD. |
| `src/interactions/` | animation & interaction | `AvatarAnimator` (procedural humanoid animation), `ResidentsLayer`, speech bubbles, emotes, `ResidentInspector`. |
| `src/core/` | coordinator | `SceneStore` — runtime snapshots → render loop without per-tick React renders. |
| `src/persistence/` | coordinator | Dexie snapshot storage + memory fallback, `createPersistentWorldRuntime`. Browser-only. |
| `dev/` | coordinator | Engine harness (not the product app). |

## Contract compatibility (v1)

* `createWorldRuntime(options?: WorldRuntimeOptions): WorldRuntime` — `dispatch` / `getSnapshot` / `subscribe`, plus `dispose()`.
  Snapshots are deep-frozen, plain JSON, new object per emission; `simulationTime` is elapsed simulation seconds; all other times are Unix ms.
  Duplicate event ids are ignored (bounded dedupe, 2000 ids); history ≤ 100; population ≤ 50; memories ≤ 10 per relationship.
  `initialSnapshot` restores everything with no duplicate seeds; `seedResidents` defaults to `true`; `autoTick` uses fixed `tickIntervalMs` steps (default **500 ms**).
* `WorldScene` implements `WorldSceneProps` exactly (`runtime`, `transparent`, `cameraMode` orbit/neighborhood/street/follow/cinematic, `selectedResidentId`, `onResidentSelect`, `quality`, `className`). It subscribes through the runtime and unsubscribes on unmount. It works with any `WorldRuntime`, including Codex's remote read-only snapshot adapter: the renderer uses only snapshot data + static layout.
* `AvatarCreator` implements `AvatarCreatorProps` exactly and always calls `onSave(appearance)` with a normalized `AvatarAppearance`.

### Optional extensions (all additive; safe to ignore)

| Where | Extension | Purpose |
| --- | --- | --- |
| `createWorldRuntime` options | `now`, `maxResidents`, `catchUpMaxSeconds`, `onReject`, `ingressCooldowns` | injectable clock, population cap, bounded offline catch-up (off by default), rejection diagnostics; `ingressCooldowns: false` disables the engine's defensive per-actor cooldowns when the server owns rate limits (validation, dedupe and queue bounds stay on) |
| runtime object | `tick(seconds?)`, `setPaused(bool)`, `isPaused()`, `stats` | manual stepping (tests, `autoTick:false`), director pause |
| `WorldScene` props | `viewerResidentId`, `onLocationSelect`, `showHud` | in-scene action buttons dispatch events as the viewer's resident; place picking; HUD toggle |
| `AvatarCreator` props | `initialPersonality`, `onSaveCharacter({appearance, personality, displayName})`, `className` | personality trait selection (send as `join` / `custom` `payload.personality`) |
| event payload | `destination` (POI id, with `custom`), `item` (gift), `channel` (raid source name), `sentiment` (simulation replies) | movement requests, gift labels, raid naming, reaction tone |

## Event semantics

| kind | world reaction |
| --- | --- |
| `join` | create/update resident `actorId` (name, appearance, personality); newcomers walk out of the raid portal and greet someone; re-join keeps relationships, updates appearance |
| `chat` | speech bubble + `chatting` activity; a nearby resident may reply |
| `wave` | actor waves at target (or nearest), friendly targets wave back |
| `dance` | actor dances; playful neighbours may join |
| `gift` | gift box arcs to the target, target thanks actor, friendship rises, memory written |
| `social` | `payload.action` greet / compliment / befriend / celebrate → gestures, dialogue, relationship change, memory |
| `weather` | `payload.weather` sunny / rain / snow / sunset → sky, particles, residents seek shelter or admire the sunset |
| `confetti` | confetti burst + nearby residents cheer |
| `raid` | portal opens dramatically, `payload.amount` scales visiting raiders who arrive, celebrate and later leave |
| `custom` | `payload.action: 'update-avatar'` updates appearance; `payload.destination` walks the actor to a place |

Actors that are not yet residents are auto-joined (so an active chatter becomes a persistent neighbour), subject to the population cap.

## Activity strings

`ResidentProfile.activity` is a human-readable phrase whose first word is a verb from `src/world/activities.ts`
(e.g. `walking to Sunbeam Café`, `chatting with Nova`, `dancing on the Dance Stage`). UIs can show it verbatim;
renderers map the verb to an animation and treat unknown strings as idle.

## Characters

| Base family | Ids | What the creator can change | Source / licence |
| --- | --- | --- | --- |
| Procedural "Townie" | `townie-classic/sporty/soft/tall/petite` | everything: body preset, height/build, skin, eyes, eye/nose/mouth size, 12 hair styles + colour, 8 tops / 7 bottoms / 5 shoes + colour, 11 accessories, expressions | original code |
| VRM guest skins | `vrm-polybot/astrodisco/coffee/chill` | height, head accessories, blink/visemes | CC0, 100Avatars by Polygonal Mind (`src/avatars/assets/CREDITS.md`) |
| Photoreal humans | `mh-elena/marco/amara/kenji` | height, outfit tint, head accessories | CARLA Simulator CC BY 4.0 **+ Epic MetaHuman licence** (no datasets / AI training) via Valdrada (`src/avatars/realistic/assets/NOTICE.md`) |
| Realistic humans | `rb-sofia/daniel/claire/james` | height, head accessories | Microsoft Rocketbox, MIT |

All bases share the canonical `HumanoidRig` (T-pose, +Z forward), so every procedural animation (idle, walk, run, talk, sit, sleep, dance ×3, celebrate, gestures) plays on every body. `getAppearanceSupport(baseModelId)` tells UIs which controls apply.

## Environment modules

| Module | What | Cost |
| --- | --- | --- |
| `src/scene/town.ts` + components | plaza, fountain, stage, café, arcade, park, homes, lamps, portal, weather, day/night | static town merged into ~8 draw calls |
| `src/scene/landscape` | terrain ring around the flat town from super-terrain's CPU height-field recipe (MIT), lake, rocks, forest layout | 3 draw calls |
| `src/scene/foliage` | 5 tree species baked offline with super-terrain's tree generator, instanced near/mid/impostor LOD | ~11–30 draw calls |
| `src/scene/district` | procedural downtown skyline with streets, lamps, night windows and a HELLO WORLD sign | 2–3 draw calls |

## Future engine modules

- **WebGPU renderer path** (super-terrain's native terrain/roads/lighting, TSL materials): requires porting the town's GLSL `onBeforeCompile`/`ShaderMaterial` effects and postprocessing to TSL; keep WebGL as the OBS-safe default with detected backend.
- **Facial rigs for photoreal bodies** (MPFB2/MakeHuman offline pipeline with shape keys, or ARKit-style blendshapes).
- **Raid crowds** (instanced extras beyond the 8 simulated visitors) and **server-side dialogue provider** (`registerDialogueProvider`).
- **Multiplayer scale-out** (Colyseus room owning the same runtime) and **navmesh** (recast-navigation-js) for free-roaming avatars.

## Dev harness & scripts

```bash
pnpm --filter @hello-world/world-engine dev        # http://localhost:5180/?view=world | creator | overlay
pnpm --filter @hello-world/world-engine typecheck
pnpm --filter @hello-world/world-engine test       # vitest (node): simulation, runtime, persistence, node-safety
pnpm --filter @hello-world/world-engine build      # typecheck + bundle the harness (verifies imports/assets)
```

Harness query params: `view=world|creator|overlay`, `camera=…`, `quality=low|high`, `fresh=1` (wipe the local save).
The harness keeps a local persistent runtime in IndexedDB (`createPersistentWorldRuntime`) and exposes it as `window.__world`.

## Integration notes for Codex

1. `apps/web/package.json`: add `"@hello-world/world-engine": "workspace:*"`; `apps/server/package.json`: same (server imports only `/runtime`). Run `pnpm install` to refresh the lockfile.
2. Server: `const runtime = createWorldRuntime({ worldId, initialSnapshot, seedResidents: true, autoTick: true, tickIntervalMs: 500, ingressCooldowns: false })` (the server already enforces Director cooldowns); broadcast on `runtime.subscribe`; persist `runtime.getSnapshot()` (plain JSON). Optional: `runtime.setPaused(settings.paused)`, `maxResidents: settings.maxResidents`.
3. Web: pass Codex's read-only adapter as `runtime` to `<WorldScene>`; for OBS use `<WorldScene transparent cameraMode="neighborhood" />` on `/overlay` with transparent html/body.
4. Avatar save: `onSave(appearance)` → dispatch `join` (first time) or `custom` with `payload: { action: 'update-avatar', appearance }`.
5. VRM assets are referenced with `new URL('./assets/…', import.meta.url)` so Vite serves/bundles them from this package without extra config.

Research notes (licences, VRM, navigation, AI, performance, future modules): [`docs/WORLD_ENGINE_RESEARCH.md`](docs/WORLD_ENGINE_RESEARCH.md). QA evidence: [`../../docs/WORLD_ENGINE_QA.md`](../../docs/WORLD_ENGINE_QA.md).
