# Verified delivery

Repository: https://github.com/mylife-as-miles/hello-world

Implementation started 2026-11-02 19:15:37 UTC. Core integrated source was verified before the original 21:15:37 UTC deadline. The user requested Sites hosting at 21:07; hosted deployment and the subsequent server-side Twitch request continued as additional work.

Genuine environment-reported Codex session/thread ID: `01a19db0-26bd-7783-a872-516b88a37070`.

## Integrated release

Claude v1 handoff `41c49ab` was reviewed (all171 files inside engine/QA ownership) and merged by Codex at `400db70`. Web/server workspace dependencies and lockfile are committed. Tested source `ae72dec058f7a78591f20078308b94725a281fcc` includes the game HUD, creator sizing/follow fixes, overlay framing and WebGPU world/studio/overlay compatibility.

## Actual verification

- Independent clean Node22.23.4 / pnpm10.28.2 frozen dependency installation, all workspace TypeScript checks,80automated tests and production builds pass.
-10actual-runtime checks pass on integrated main: character/personality updates, social memory, immutable normalized events, persistence, shared HTTP/WebSocket sessions, permissions and server restart identity/state restoration.
- Earlier real browser coreflow:10checks establish pointer customization, appearance reaching authoritative state, join, social/chat, refresh persistence and independent session synchronization.
- Final production HUD focused browser pass:8checks, zero uncaught pageerrors; actual private-key UI authorization, weather fanout, labeled demo celebration,390px layout and1920×1080 overlay. Overlay87.11%fully transparent, allfourcornersalpha0, visible content.
- Real software WebGPU renders world, character studio and overlay on production main; measured actualbackendWebGPU, nonblank coloredpixels, zero page/shader validationerrors. Unsupported-browser WebGL fallback also tested.
- Final independent weighted critic score:8.4/10. The target9was not claimed.

See [QA](QA.md), [release checks](RELEASE.md), [critique](CRITIQUE.md), [runtime acceptance](RUNTIME_ACCEPTANCE.md), [WebGPU evidence](WEBGPU.md) and [screenshots](screenshots/final-hud-world.png).

## Limits

No Twitch app credentials/authorization were available, so no live Twitch event reception is claimed. Browser-source rendering is verified; native OBS and hardware-GPU performance were not tested. Hosted CI was prevented from starting by GitHub's account billing lock. The complete corebrowserflow and finalfocusedHUDpass are separate recorded runs; a single complete final-HUDrun was interrupted by later deployment work.

The Node implementation uses real WebSockets/local-disk persistence. The Sites adapter uses real shared D1 snapshots/HTTPpolling and request-time bounded simulation advancement; it does not claim simulation while the site is idle or live Twitch connectivity.

## Hosted release

The owner-private Site was successfully published on 2026-11-02 at 21:37 UTC:
https://hello-world-miles-society.myles4miles.chatgpt.site

The hosted adapter runs the same engine with a provisioned D1 database and HTTP polling. No local Node process is required. Server OAuth and webhook support use encrypted D1 token storage, owner-bound single-use state, app-token EventSub subscriptions, signature verification, durable delivery receipts, approval checks and rate limits. An API-only public relay preserves the private world audience. Twitch app ID/secret and a real broadcaster grant remain unavailable; Demo Mode is accurate.

Hosted checks: all workspace TypeScript, 80 existing tests, 22 SQLite-backed shared-world assertions, 58 mocked-Twitch OAuth/webhook assertions and 31 relay security assertions pass. Native production D1 tables and protected API rejection were verified. These checks do not establish a live broadcaster grant, real Twitch delivery or a signed-in hosted browser acceptance pass. See [hosted Twitch setup](HOSTED_TWITCH.md) for exact callbacks.

The hosted Twitch release was successfully published at 21:43 UTC (GitHub runtime source `16b7f21`, Sites source `8f585570cbd6c080b2f101f325e4fda6bdf619ae`). The public relay is deployed at `https://hello-world-miles-events.myles4miles.chatgpt.site/api/twitch/eventsub`. Production protocol checks returned exact plaintext for a signed synthetic challenge and its retry (200), rejected a tampered body (403), and confirmed `/overlay` serves the app (200). These are real hosted HTTP/D1 checks, not real Twitch subscription delivery. [Native deployment evidence](evidence/sites-deployment.json).

Exact Twitch OAuth callback:
`https://hello-world-miles-society.myles4miles.chatgpt.site/api/twitch/callback`

The generated webhook and encryption secrets are configured server-side. `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` still require private configuration and broadcaster consent. All owner APIs retain private Sites identity checks. The public relay exposes no Director APIs.


## Current round-9 release — 2026-11-03

Verified engine `12d73f6` is integrated into main. Unfinished round-10 `ac0b9a4` remains on its existing branches. Integration fix `661cd57` preserves WebGPU support for photoreal hair; final TypeScript, 149 tests and both web/Sites production builds pass. The full round-9 browser flow passed 15 checks, the real-runtime suite passed 10 checks and all 111 hosted assertions passed. Actual software WebGPU world, creator and overlay rendering passed after the fix with zero browser errors.

Fresh production-build screenshots: [world](screenshots/round9/world-neighborhood.png), [Director Studio](screenshots/round9/director-studio.png), [transparent overlay](screenshots/round9/obs-overlay.png), [creator](screenshots/round9/avatar-creator.png). These were captured on a local production server; a signed-in hosted browser session and native OBS remain unverified. See the [round-9 QA record](QA.md) for exact revisions and retained limitations.

The final renderer fix was published successfully to the same private Site at 03:10:56 UTC, Sites version 4, preserving runtime environment revision 2 and the existing D1 world. [Native deployment result](evidence/sites-round9-deployment.json). OAuth and EventSub callback URLs remain unchanged.

Production HTTP verification confirms `/`, `/world`, `/director` and `/overlay` return the current built entry; the served JavaScript bytes match the local Sites artifact exactly. Identity-less service access to the owner API returns 401 as intended. [HTTP evidence](evidence/sites-round9-http.json).
