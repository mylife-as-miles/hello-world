# HELLO WORLD integration contract v1

Published 2026-11-02. Source of truth: `packages/contracts/src/index.ts`.

## Ownership
Codex alone integrates and pushes main. Claude branches from main as `claude/world-engine` and owns ONLY `packages/world-engine/**` and `docs/WORLD_ENGINE_QA.md`. Codex owns `apps/web/**`, `apps/server/**`, `packages/contracts/**`, root setup and other docs. No external project source/assets.

## Required engine package
Create `@hello-world/world-engine` (private workspace package). Export:

```tsx
import { WorldScene, AvatarCreator, createWorldRuntime } from '@hello-world/world-engine';
import { createWorldRuntime } from '@hello-world/world-engine/runtime'; // Node-safe subpath; NO React/DOM/Three imports
import type { WorldSceneProps, AvatarCreatorProps, WorldRuntime, WorldRuntimeOptions } from '@hello-world/contracts';
const runtime = createWorldRuntime({ worldId: 'hello-neighborhood', seedResidents: true, autoTick: true });
<WorldScene runtime={runtime} cameraMode="neighborhood" transparent={false} />;
<AvatarCreator initialAppearance={appearance} displayName="Miles" onSave={saveAppearance} onCancel={close} />;
```

`WorldScene` and `AvatarCreator` implement the exact props exported by contracts. WorldScene subscribes to runtime, cleans up subscription, and supports transparent overlay mode (transparent WebGL clear color; hide sky/opaque full-frame backgrounds; keep characters/effects visible). Camera modes: orbit, neighborhood, street, follow, cinematic. Desktop/mobile container 100% size; avoid fixed global CSS. Scene includes lighting, neighborhood and animated residents. Component is the only 3D implementation.

`createWorldRuntime(options?: WorldRuntimeOptions): WorldRuntime` implements dispatch/getSnapshot/subscribe. Snapshot is immutable per emission, arrays plain JSON, times Unix ms except simulationTime (elapsed simulation seconds). Runtime is Node-safe and deterministic with respect to events. Ignore duplicate event IDs (bounded dedupe), keep bounded history (100), population (50), and memories. Provide optional dispose() if timers need cleanup. On server use autoTick true; browser scene consumes a remote read-only snapshot adapter. Runtime default seedResidents true, with several visible demonstration residents. initialSnapshot restores all saved state without adding duplicate seeds.

## Event semantics
All event/source/payload structures live in contracts. `join` creates or updates resident id = actorId, display name = actorDisplayName, appearance/personality from payload if supplied. Re-join preserves existing relationships and updates appearance. `custom` payload action update-avatar also updates actor appearance. `chat` sets speech/activity; wave/dance/gift/social animate and update needs or relationships; social action greet/compliment/befriend, targetId optional. weather accepts payload.weather sunny/rain/snow/sunset. confetti celebrates, raid payload.amount indicates visitors and opens portal/celebration. No arbitrary code or unconstrained world state updates. Source demo is visibly labeled demo in UI; live events source twitch. Source is assigned at trusted adapter boundary, never trusted from browser.

Numbers: needs and friendship 0–100; body/face scalar parameters 0–1, colors CSS hex. location uses x/y/z world coordinates and zone string. Accessories/hair/outfit string identifiers are renderer-owned; renderer must handle unknown strings gracefully with default appearance. Public world IDs and resident IDs are stable, non-secret strings.

## Transport and persistence
Codex implements a small WebSocket adapter using shared ClientMessage/ServerMessage. Server runs the SAME engine runtime and persists snapshots to local disk, fans authoritative snapshots to connected browsers. Browser uses a WorldRuntime-compatible adapter and Dexie cache for reconnection/startup. All viewer actions pass server validation, rate limits and optional approval. Director authentication is server-side. No claim of distributed simulation. Colyseus migration: replace ws room/journal adapter while preserving WorldEvents, snapshots, runtime, and UI.

## Package setup and integration
Use React 19 + R3F v9 / Rapier v2 if selected. Claude can add dependencies ONLY to packages/world-engine/package.json and include its own tsconfig/scripts; root pnpm lockfile is resolved by Codex at merge. Do not change contracts or app files. Run package typecheck/build and document real browser/runtime tests in WORLD_ENGINE_QA. Push complete commits to claude/world-engine; no main push. Codex fetches/reviews ownership and merges only complete implementation. Contract changes require issue communication or explicit version. Early delivery welcomed; target integration 90 minutes after initial kickoff.

## Additive transport clarification — 2026-11-02

Server status messages may include optional `capabilities: Record<string, string>` so connected clients receive current Twitch scope/subscription failures and revocations. This is an additive transport field; all engine interfaces and v1 snapshots/events are unchanged. Older clients may ignore it.
