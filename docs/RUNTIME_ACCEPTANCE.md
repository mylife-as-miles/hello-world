# Real engine runtime acceptance

Status: **prepared, not executed**. The engine branch is still in development. No passing integration result is claimed from the unit fixture or incomplete engine scaffold.

Run after the complete engine is integrated, declared as a server workspace dependency, and installed:

```sh
pnpm --filter @hello-world/server exec tsx ../../tests/runtime-acceptance.ts
```

The script fails explicitly when the real `@hello-world/world-engine/runtime` entry cannot be resolved. It creates isolated temporary data directories and ephemeral HTTP ports and cleans up its sockets, servers, and simulation timers.

Checks cover:

- Headless Node import without DOM globals.
- Real joins with stable IDs, selected appearance, and personality.
- Real social friendship and memory creation.
- Stable-ID full-character rejoin updates appearance/personality while preserving friendship and memories.
- Chat, gestures, gifts, weather, confetti, raid, and appearance events in authoritative snapshots.
- Immutable previously published snapshots and runtime notifications.
- Actual `SnapshotStore` roundtrip into the real runtime.
- Autonomous simulation clock while the process runs.
- Two independent signed HTTP/WebSocket sessions sharing actual engine state.
- Permission enforcement and labeled Director demo weather.
- Real server restart restoring resident appearance/personality, relationship memory, weather, and signed viewer identity.

The report defaults to `/tmp/hello-world-runtime-acceptance-report.json`; set `RUNTIME_ACCEPTANCE_REPORT` to select another path. These tests do not establish rendered appearance, OBS-host operation, live Twitch authorization/delivery, distributed persistence, or simulation while the server is stopped. Browser QA and the independent critique cover the rendered product separately.
