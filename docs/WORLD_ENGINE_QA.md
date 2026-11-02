# World engine QA

Status: **in progress** — this file is updated with real evidence at handoff.

Branch: `claude/world-engine` · Package: `packages/world-engine` (`@hello-world/world-engine`)

## Verification commands

```bash
cd packages/world-engine
npx tsc --noEmit -p .          # typecheck
npx vitest run                 # node tests
npx vite build                 # bundle the harness
npx vite --port 5190 --strictPort &   # harness
node test/browser/acceptance.mjs http://localhost:5190 ./acceptance-out
```

## Acceptance checklist

_Filled in at handoff with the actual run output._
