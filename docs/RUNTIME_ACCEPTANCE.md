# Real engine runtime acceptance

**Isolated preflight: 10/10 checks passed.** This is evidence from an isolated complete-scene/runtime snapshot, not a merged-main release result. Final main verification remains pending integration.

- Engine checkout SHA: `854b5afcced1b1e010d45dad621262876d5c98f0`.
- Checkout: `/workspace/hello-world-engine-preflight`.
- Executed: 2026-11-02, **20:15:53–20:15:55 UTC**.
- Actual runtime entry: `packages/world-engine/src/runtime/index.ts`.
- Report: `/tmp/hello-world-runtime-preflight-854b5af.json`.
- The engine source was not edited. Codex-owned server/test files were copied into the isolated checkout for this preflight; no engine WIP was merged or cherry-picked into main.

Command used:

```sh
RUNTIME_ACCEPTANCE_REPORT=/tmp/hello-world-runtime-preflight-854b5af.json \
  pnpm --dir /workspace/hello-world-engine-preflight \
  --filter @hello-world/server exec tsx ../../tests/runtime-acceptance.ts
```

## Observed checks

| Actual check                                                                                               | Result                                     |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Real runtime imports in headless Node without browser globals                                              | Pass                                       |
| Stable resident identity, customized appearance and selected personality on join                           | Pass                                       |
| Real social friendship and saved memory                                                                    | Pass — friendship 70.9, one initial memory |
| Chat, wave, dance, gift, weather, confetti, raid and appearance events in new immutable snapshots          | Pass                                       |
| Full-character stable-ID rejoin updates appearance/personality/name without erasing friendship or memories | Pass                                       |
| Actual SnapshotStore roundtrip into the real runtime                                                       | Pass                                       |
| Simulation clock advances while its Node runtime runs                                                      | Pass                                       |
| Two real signed HTTP/WebSocket sessions share the same actual-engine resident                              | Pass                                       |
| Unauthorized world change rejected; authenticated labeled demo weather reaches both sessions               | Pass                                       |
| Actual server restart restores signed identity, appearance/personality, social memory and weather          | Pass                                       |

The script uses isolated temporary data directories and ephemeral HTTP ports. Its sockets, servers, runtime timers and temporary state were cleaned up after the run. The initial test harness needed an async wrapper because root `.ts` files are interpreted as CommonJS by `tsx`; that harness issue was fixed before the successful run. It required no engine change.

## Repeat after main integration

After the complete engine is integrated, declared as a server workspace dependency, and installed:

```sh
pnpm --filter @hello-world/server exec tsx ../../tests/runtime-acceptance.ts
```

The script fails explicitly if the real `@hello-world/world-engine/runtime` entry cannot be resolved. The report defaults to `/tmp/hello-world-runtime-acceptance-report.json`; set `RUNTIME_ACCEPTANCE_REPORT` to select another path.

These checks do not establish rendered appearance, OBS-host operation, live Twitch authorization/delivery, distributed persistence, or simulation while the server is stopped. Browser QA and the independent critique cover the rendered product separately.
