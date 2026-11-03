# Integration QA evidence

Run date: 2026-11-02 UTC. Only observed results count as passes. Unchecked items remain unverified.

Final browser status: **10 real core-flow checks passed during engine preflight**, followed by **8 focused checks passed on the frozen production build `ae72dec`**. The latter run did not repeat the earlier creation/social/refresh journey. Live Twitch delivery and an installed OBS application were not tested. Source/build verification is tracked separately in [RELEASE.md](RELEASE.md).

## Environment preparation

- Browser executable: `/usr/bin/chromium`, version 154.0.8037.57.
- Automation: Playwright; installed runtime available. QA scripts initially isolated under `/tmp/hello-world-qa`.
- Headless browser launched successfully and created a WebGL2 context. Reported renderer `WebKit WebGL`, maximum texture size 8192. This verifies test capability, not application rendering or production performance.
- WebGL debug renderer: `ANGLE / Vulkan / SwiftShader Device (Subzero)`, a software renderer. Headless frame rates are not representative of a hardware GPU or OBS performance.
- Shared integration contract reviewed: Node-safe runtime subpath, authoritative snapshots, bounded event history, browser/server shared event schema, transparent rendering and camera modes are explicitly specified.

## Initial acceptance checklist

This was the initial checklist; observed results and their limits are recorded in the later checkpoint sections.

| Check | Required evidence | Status |
| --- | --- | --- |
| Open world | Landing and visible 3D neighborhood without console errors | Pending |
| Join | New stable resident ID appears in authoritative snapshot and rendered world | Pending |
| Customize | Saved appearance visibly changes resident; survives reload | Pending |
| Social interaction | Gesture or relationship/memory change appears in snapshot/UI | Pending |
| Demo event | Clearly labeled demo sends same normalized event path as viewer/Twitch | Pending |
| Director controls | Weather/event/approval controls affect authoritative world | Pending |
| Persistence | Resident and relationship survive reload; server restart if implemented | Pending |
| Multiplayer | Two browser contexts receive same authoritative event/snapshot | Pending |
| OBS overlay | Hidden chrome, transparent HTML and canvas alpha, visible characters/effects | Pending |
| Security | Unauthenticated privileged messages blocked; identity/source cannot be spoofed | Pending |
| Limits | Cooldown, invalid payload, population and approval behavior enforced | Pending |
| Mobile | Core controls fit and can be operated at phone viewport | Pending |
| Build | Workspace typecheck/build and meaningful automated tests pass | Pending |

## Limits on claims

A headless test of `/overlay` can verify alpha rendering and layout but cannot establish operation inside a real OBS installation. Live Twitch delivery requires real server-side credentials, correct broadcaster scopes and actual events; absent credentials, only the demo adapter and permission behavior can be verified. Local server disk persistence is not managed production durability or a distributed always-on simulation.

## Server checkpoint — 19:25 UTC

Command: `pnpm --filter @hello-world/server test`.

Observed result: **17 tests passed across 3 files**, duration 1.11 seconds. Tests exercise the real HTTP/WebSocket adapter against an injected contract-compatible test runtime. They establish transport and boundary behavior; they do **not** verify the external world engine, rendering, actual Twitch delivery or engine persistence semantics.

Verified by the server suite:

- Stable signed viewer sessions; modified signatures do not retain identity.
- Wrong WebSocket Origin rejected (403); missing session rejected (401).
- Server replaces forged browser actor/source/timestamp/event IDs.
- Unauthorized weather/reset/settings/approval requests rejected.
- Invalid payload keys and unrestricted custom actions rejected.
- Viewer membership, cooldown, population limits and interaction pause enforced.
- Viewer actions can be queued privately and approved once by a Director.
- Two real WebSocket clients receive the same authoritative test-runtime resident.
- Test snapshot and viewer session survive server shutdown/restart on local disk.
- OAuth start requires Director authentication; state is single-use and session-bound.
- Built SPA routes served; static traversal did not disclose an outside test file.
- Chat commands map to normalized shared events; reward actions are explicitly allowlisted.

Live broadcaster credentials remain absent. No live Twitch event delivery has been tested.

## Development file-access checkpoint — 19:37 UTC

Black-box requests against the running Vite server at `http://localhost:5173` verified:

| Requested path | Observed HTTP status |
| --- | --- |
| `/@fs/workspace/hello-world/.data/qa-sentinel.txt` | 403 |
| Same sentinel with `?raw` | 403 |
| Same sentinel with percent-encoded `.data` path | 403 |
| `/@fs/workspace/hello-world/.env` | 403 |
| `/@fs/workspace/hello-world/.git/config` | 403 |
| Ordinary contract TypeScript source under workspace | 200 |

The sentinel contained public QA text and was removed after the check. Secret file bodies were not read or printed. This establishes actual development-server file denial rather than a missing-file response. The application itself still awaited the world-engine package at this checkpoint; no UI pass is implied.

## Real-engine browser preflight — component integration defect

Target: isolated `http://localhost:5181`, genuine world engine checkpoint `854b5af`, Codex app/server, viewer-only initial session and private test Director key. This is a read-only integration preflight, not a merged release claim.

Initial real browser passes: authoritative snapshot connection, honest Demo Mode, viewer-only permission status, neighborhood canvas, actual name dialog entry and creator component mounting. Browser screenshot/actionability waits were slow under SwiftShader; the driver uses explicit SwiftShader WebGL flags and real pointer clicks with `force`/`noWaitAfter` to avoid animation polling. These automation timeouts alone did not establish broken user buttons.

A separate, **real blocking layout defect** was confirmed by Chromium geometry and hit-testing: the app host `.creator-content` had only a minimum height, while the engine creator required a definite height. The engine root/layout computed to **0px**, panel to **2px**, and clicking the preset's apparent coordinates hit the host div. This made actual customization inaccessible despite controls existing in the DOM. Root applied a definite responsive host height in app CSS; the acceptance suite now asserts a noncollapsed creator and an actual loaded avatar rig. Subsequent full-flow results are recorded below when observed.

## Real browser core flow — observed after host-height fix

Target remained genuine engine `854b5af` plus app/server and the targeted creator CSS fix, at `http://localhost:5181`. The first session was explicitly viewer-only. The browser used real pointer input, with `force`/`noWaitAfter` to bypass unstable automation polling; no JavaScript world-state mutations or fake game were used.

Observed passes from the acceptance run:

- Actual creator had a usable height and a loaded 3D avatar rig.
- Viewer selected the Atlas appearance preset, saved, and the authoritative resident retained the exact selected outfit color.
- Stable `viewer:` resident ID appeared in the real engine; own resident was selectable.
- All five camera controls accepted their values without runtime errors. This verifies control wiring, **not** independent camera-framing quality.
- Viewer social action created a real relationship; chat reached the shared event runtime.
- A genuine page reload retained the resident appearance and the same relationship/social memory.
- A separate browser context received the same authoritative resident and relationship.

The run then stopped on a **test selector error**: at the tested responsive width, the header's `Unlock studio` entry was hidden and the visible side-panel entry was `Unlock controls`. The selector was corrected. This run is not recorded as a complete suite pass. Focused Director/mobile/overlay results follow separately when observed.

Machine-readable core result (including the final selector failure) was saved under `/tmp/hello-world-qa/browser-preflight/browser-results.json`; optional screenshots were disabled for this pass because the root agent had already captured the actual scene, Director and overlay while software rendering was slow.


## Focused Director follow-up boundary

A separate real `/director?quality=low` attempt confirmed viewer-only initial authority, then hit a 15-second Playwright bounding-box timeout while the visible `Unlock controls` button was awaiting software-renderer layout. This is recorded as a failed automation attempt, not a passed UI login and not proof that a normal user click fails. No uncaught application error was observed. The GPU/browser was closed for the next specialist’s verification window.

The root agent independently captured authenticated Director controls through the real validated WebSocket path and measured the actual transparent overlay composite at approximately 94.5% clear pixels with nonblank rendered content. That is browser/transport and PNG-alpha evidence; it is not a test inside an installed OBS application.


## Final frozen production browser pass — 21:02–21:04 UTC

Target: `http://localhost:3011`, committed source `ae72dec`, built production app/server. Command:

```sh
QA_BASE_URL=http://localhost:3011 \
QA_DIRECTOR_KEY='<private test key>' \
QA_REQUIRE_VIEWER=true \
QA_DIRECTOR_ONLY=true \
QA_ACTION_TIMEOUT_MS=45000 \
QA_EVIDENCE_DIR=/tmp/hello-world-qa/final-browser \
node tests/browser-smoke.mjs
```

Observed result: **8 checks passed**, zero uncaught browser errors. One console resource 404 was observed. This was explicitly a focused follow-up; the machine-readable result does not claim a full core-flow rerun.

- Initial browser had viewer-only permissions and received the genuine 13-resident world in labeled Demo Mode.
- A second independent browser session received authoritative snapshots through the actual WebSocket protocol. It avoided rendering a second expensive software WebGL canvas during this follow-up.
- The actual private-key form authenticated the Director using real pointer/input events. Director weather changed from sunny to snow and reached both sessions.
- A new celebration event had source `demo` and reached the same authoritative runtime.
- The actual game HUD fit a 390px viewport without horizontal overflow; full-page mobile evidence was captured.
- The 1920 × 1080 overlay hid app chrome and contained real rendered characters/props. Its composited PNG had **1,806,257 clear pixels (87.11%)**, **190,409 opaque pixels**, and **76,934 translucent pixels**, out of **2,073,600 total**. All four corner alpha values were zero. The image was nonblank.
- No uncaught page errors occurred across the tested routes. Browser/software-renderer limitations still apply; these are not hardware frame-rate measurements or a test inside OBS.

Actual production screenshots and JSON were saved at `/tmp/hello-world-qa/final-browser/`: `landing-desktop.png`, `director-studio.png`, `world-mobile.png`, `obs-overlay.png`, and `browser-results.json`. All four images were visually inspected. Repository artifacts: [world HUD](screenshots/final-hud-world.png), [Director](screenshots/final-director.png), [mobile](screenshots/final-mobile.png), [transparent overlay](screenshots/final-overlay.png), and [machine-readable result](screenshots/final-browser-results.json). The follow-camera overlay keeps its selected resident visible; nearby residents can be cropped at the edges in this close framing.

## Repeatable browser verification

Run `pnpm test:browser` against a running app. The default full flow includes actual creation, a changed preset, social/chat actions, reload persistence, Director controls and overlay alpha. Provide `QA_DIRECTOR_KEY` for a protected server; `QA_REQUIRE_VIEWER=true` verifies that the first session has viewer-only permissions. `QA_DIRECTOR_ONLY=true` explicitly selects the focused follow-up scope. `QA_SKIP_OPTIONAL_SCREENSHOTS=true` omits optional images while preserving the required overlay PNG/alpha check. `QA_BROWSER_PATH` selects Chromium. A complete default full-flow pass is not claimed by the focused final report.


## Round 9 integrated release — 2026-11-03

The coordinator reviewed all 120 changed files from `4b63266` to `12d73f6`; every change was inside the engine/engine QA ownership. The verified round-9 commit was fast-forwarded into main. Unfinished round-10 `ac0b9a4` was excluded. There were no contract, application or server changes in the handoff.

Actual checks on the integrated source:

- Workspace TypeScript passed; 108 engine + 40 server tests passed; complete production and Sites builds passed.
- All 111 hosted assertions passed: 22 shared-world, 58 OAuth/EventSub and 31 relay security checks.
- All 10 actual-engine/runtime acceptance checks passed, including a real server restart and stable signed identity. [Report](evidence/runtime-round9-results.json).
- The full production-build browser flow passed 15 checks: real pointer customization/save, join, five camera modes, friendship/social memory, chat, refresh persistence, independent-session synchronization, private-key Director authorization, weather fanout, demo celebration, 390px layout, and transparent 1920×1080 overlay. Zero uncaught page errors. One console resource 404 was recorded and is retained in the report. [Browser report](screenshots/round9/browser-results.json).
- Overlay: 1,953,850 of 2,073,600 pixels fully transparent (94.22%); all four corner alpha values were zero; visible residents were present.

A genuine software WebGPU retest found a round-9 photoreal-hair render hook calling WebGL-only `state.buffers` and `colorMask`. A focused integration fix, `661cd57`, guards that hook by the actual renderer backend. A regression test checks both the preserved WebGL alpha-mask sequence and a GPU backend without WebGL APIs. Final workspace TypeScript, 109 engine + 40 server tests, web production build and Sites build passed. The final actual-WebGPU world, studio and overlay checks all pass with zero page/console errors. [Before-fix report](webgpu-evidence/round9/before-fix-results.json) · [Final report](webgpu-evidence/round9/results.json).

Screenshots are fresh captures of the locally served production build with software WebGL, not a signed-in browser session on the hosted Site. Native Sites deployment and production HTTP checks are separate evidence. Native OBS, hardware performance and authenticated Twitch delivery remain unverified.

Visual review: the neighborhood, Director and transparent overlay render clearly. One follow-camera capture is obstructed by playground props; the wide neighborhood capture is supplied alongside that unedited evidence. The user handoff reported a round-9 independent score of 8.04/10. No new independent critic score or 9/10 claim is made here.

[World screenshot](screenshots/round9/world-neighborhood.png) · [Director screenshot](screenshots/round9/director-studio.png) · [Overlay screenshot](screenshots/round9/obs-overlay.png) · [Creator screenshot](screenshots/round9/avatar-creator.png).
