# Release verification

This checklist separates local evidence from external service readiness. A checked source file or a passing transport fixture is not proof of a completed 3D application.

## Commands

Use Node.js 22+ and the repository's declared pnpm **10.28.2**. A clean checkout must accept the committed lockfile:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

For local development:

```sh
cp .env.example .env
pnpm dev
```

Open `http://localhost:5173`. For the built app and API in one process:

```sh
WEB_ORIGIN=http://localhost:3001 pnpm start
```

Open that exact origin. The server checks the WebSocket Origin. `WEB_ORIGIN` set on the command takes precedence over `.env`. The browser/API should share one origin; arbitrary split-origin hosting is not supported by the current adapter.

The Node process must stay running. Persistent state, the browser-session signing key, and server-only Twitch token data live in the configured `DATA_DIR`, defaulting to the repository-root `.data` directory. Keep that directory private and on persistent disk. The static server serves only `apps/web/dist`.

## Final release gate

- Complete engine reviewed for allowed file ownership and merged by Codex only.
- `@hello-world/world-engine` declared in web/server dependencies; committed lockfile updated.
- Node-safe runtime import succeeds without loading DOM/React/Three modules.
- Frozen install, workspace TypeScript, automated tests, and production build pass.
- Production `/`, `/world`, `/director`, and `/overlay` return application HTML; referenced scripts/assets have correct content types and no missing requests.
- Browser verifies join, changed appearance, visible resident, social interaction, shared demo events, Director control, and refresh persistence.
- Independent browser sessions receive the same authoritative state.
- OBS route has hidden chrome, nonblank characters/effects, configurable framing, and transparent composited pixels.
- Critic records evidence, weighted scores, defects, highest-impact fixes, and retest results.
- Final commit pushed to `main`; evidence identifies the tested revision and remaining limitations.

Browser command, with the app running:

```sh
pnpm test:browser
```

The test uses system Chromium where available. Otherwise install its browser with `pnpm exec playwright install chromium`; `QA_BROWSER_PATH` selects a different executable. Set `QA_DIRECTOR_KEY` for a key-protected server and `QA_REQUIRE_VIEWER=true` to require that the initial session has viewer-only permissions. Browser evidence must be inspected before it is described as a complete pass.

## External readiness and limits

Twitch credentials and authorized broadcaster permissions were unavailable at the initial release review. Until real events are received, Demo Mode and adapter/permission tests are the verified scope. The application must not call an initialized socket or requested subscription a successful live connection. See [Twitch setup](TWITCH.md).

Chromium alpha testing can verify the browser-source route; it does not prove operation inside the OBS application. Direct OBS WebSocket control is not part of this slice. There is no fabricated deployment URL, recording, or always-on service claim.

## CI observation — 2026-11-02

[Verify run 41515378124](https://github.com/mylife-as-miles/hello-world/actions/runs/41515378124), for commit `e402440867afa9f6ec9a419d156eb393c06a6f72`, failed before any step ran. The GitHub check annotation states:

> The job was not started because your account is locked due to a billing issue.

This is not a test failure and cannot be fixed in workflow code. GitHub-hosted CI is therefore **not verified** at this checkpoint. Local checks must be reported separately. The workflow uses Node 22, the `packageManager` pnpm version, a frozen lockfile, and stable Ubuntu 24.04; it can be rerun after the account issue is resolved.

## Integration verification record

The engine handoff was merged in `400db70`; the wired application was published at `2aefca1`. Actual isolated preflight and clean-checkout observations are recorded below. Browser and visual evidence remain separate from source/build verification. See [QA](QA.md), [independent critique](CRITIQUE.md), and [delivery evidence](DELIVERY.md).

## Isolated integration preflight — 20:17 UTC

The detached preflight checkout combined engine snapshot `854b5af` with the current Codex-owned application/server files. No Claude-owned source was edited. This was a WIP compatibility check, not the final merged-main release gate.

Observed commands and results, under the managed environment’s Node 24.19.0 and pnpm 11.25.0 (the declared Node 22 / pnpm 10 clean check is still pending):

- `pnpm typecheck`: contracts, engine, web and server all passed.
- `pnpm build`: all workspaces passed. Web main script 1,764,577 bytes (515.30 kB gzip), CSS 59,786 bytes (12.43 kB gzip), dynamic VRM rig 194.56 kB (50.25 kB gzip). A nonfatal large-chunk warning remains.
- Built server launched on port 3012 with exact `WEB_ORIGIN=http://localhost:3012` and a dedicated temporary `DATA_DIR`.
- `/`, `/world`, `/director`, `/overlay?camera=neighborhood&quality=low`: HTTP 200, `text/html`.
- Generated index JS and CSS: HTTP 200, correct `text/javascript` / `text/css` content types, nonempty bodies.
- Missing JS, `/package.json`, unknown API: HTTP 404.
- `/api/health`: `ok=true`, `mode=demo`, no persistence error, a completed save timestamp.
- Correct-origin WebSocket with signed session: authoritative snapshot received with seven seeded residents.
- Wrong WebSocket Origin: HTTP 403. Missing session: HTTP 401.

The isolated port-3012 process was stopped after verification. Existing development/QA servers were not changed. This check does not establish visual quality, live Twitch event delivery, OBS-host operation, or a clean install of the final merged revision.


## Clean integrated-main check — 20:54 UTC

Tested revision: `2aefca1a196b3bf0156c4d4f24abc0b350332dad`, in a fresh detached worktree with no preexisting `node_modules` or `.env`. Verification did not mutate the primary workspace. The checkout remained clean after the checks.

Actual tools, printed by the check process: **Node v22.23.4**, **pnpm 10.28.2**. The verification command explicitly selected them with `npx -p node@22 -p pnpm@10.28.2 -c ...`.

| Gate | Observed result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed; 215 packages installed; esbuild postinstall completed |
| `pnpm typecheck` | Passed for contracts, engine, server, and web |
| `pnpm test` | Passed: 40 engine tests and 40 server tests, 80 total |
| `pnpm build` | Passed for all workspaces |

The web build emitted a 1,793.80 kB main script (525.90 kB gzip), 97.19 kB CSS (19.01 kB gzip), and a separate optional WebGPU chunk. The only reported build warning was the main chunk exceeding the configured size threshold. This warning does not establish runtime performance; browser testing is recorded separately.

[Hosted run 41522930508](https://github.com/mylife-as-miles/hello-world/actions/runs/41522930508), for this same commit, also never started a step. Its exact failure annotation remains: “The job was not started because your account is locked due to a billing issue.” The local pass above must not be represented as a hosted CI pass.

The first-frame renderer compatibility follow-up was finalized afterward and checked at the source revision below.


## Latest tested source — 21:02 UTC

**`ae72dec058f7a78591f20078308b94725a281fcc`** is the latest source revision independently verified by the release engineer. It includes the post-merge camera fitting, creator renderer support, and first-frame renderer compatibility fixes.

The same isolated clean worktree advanced to this commit. The lockfile is byte-for-byte unchanged from the successful fresh frozen install. Under printed **Node v22.23.4 / pnpm 10.28.2**, the release engineer reran:

- `pnpm typecheck`: passed across all workspaces.
- `pnpm test`: passed, **80 tests** total (40 engine + 40 server).
- `pnpm build`: passed across all workspaces.

The final web main script is 1,796.31 kB (526.90 kB gzip), CSS 97.19 kB (19.01 kB gzip), and optional WebGPU code remains a separate chunk. The only build warning is the configured main-chunk size threshold. The verification checkout remained clean, and the primary workspace’s dependencies/source were not changed by this check.

This establishes source, dependency, type, test, and production-build compatibility on the declared toolchain. It does not turn the separate browser/core-flow checks into a complete browser-suite pass, or establish live Twitch/OBS-host behavior. See the latest [QA record](QA.md) and [critic review](CRITIQUE.md) for those practical limits.
