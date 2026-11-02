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

Pending complete engine integration. The release engineer will append actual clean-checkout and production-route observations here; no full-application pass is claimed yet. See [QA](QA.md), [independent critique](CRITIQUE.md), and [delivery evidence](DELIVERY.md).
