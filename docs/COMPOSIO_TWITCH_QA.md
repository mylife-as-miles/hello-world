# Managed Twitch investigation and hosted hardening evidence

Date: **2026-11-04**. Working baseline: GitHub `main` at `03d937d`. Latest engine branches were inspected; unfinished round-10 changes were not merged. Sites was public, saved version 6, source `60c4b51764b6a4e29c6b2b1d6729f348b94ce60f`; this update preserves that audience and the owner-only Director policy.

## Executed checks

| Command / check | Result | Evidence boundary |
| --- | --- | --- |
| `pnpm typecheck` | Pass, all packages | Real TypeScript compiler |
| `pnpm test` | **158/158** | 109 engine + 49 server; includes 6 mock Composio cases and 3 SQLite subscription cases |
| `pnpm build` | Pass | Real app/engine builds; existing large-chunk/dynamic-import warnings remain |
| `pnpm build:sites` | Pass | Real bundled HTTP frontend/Worker; includes migration 0003 |
| `pnpm test:runtime` | **10/10** | Real engine/server, two WebSocket sessions, disk persistence and restart |
| `pnpm --filter @hello-world/server exec tsx ../../tests/sites-worker-acceptance.ts` | **34 checks** | Real SQLite/world runtime; shared persistence, identity rewriting, owner-only writes |
| `pnpm --filter @hello-world/server exec tsx ../../tests/sites-twitch-acceptance.ts` | **76 checks** | Real SQLite transactions/runtime; mocked provider HTTP, synthetic signed messages |
| `pnpm --filter @hello-world/server exec tsx ../../tests/sites-relay-acceptance.ts` | **31 checks** | Mock upstream; real request/signature/relay code |
| `pnpm twitch:composio:poc --mode=plan` | Pass, no network/credential reads | Plan only, not an authenticated profile read |
| `pnpm twitch:composio:poc --mode=inspect` without approval | Expected `OWNER_APPROVAL_REQUIRED`, exit 1 | Refuses before reading credentials/initializing SDK |
| `npx --yes pnpm@10.28.2 install --lockfile-only --ignore-scripts --frozen-lockfile` | Pass | Lockfile compatible with declared package manager; not a clean reinstall |

The Twitch acceptance run tests exact raw challenge bytes (including whitespace), HMAC/timestamps, oversized input, owner-bound single-use OAuth state, encrypted grants, wrong-app rejection, enabled subscription ID/version/condition/callback/header checks, notification broadcaster checks, duplicate delivery, concurrent joins with transactional revision conflict, revocation, locked refresh and corrupted ciphertext. It verifies that challenge alone remains Demo Mode.

Maintenance is exercised with a public reader and the scheduled entrypoint while no Director tab is open. A stale notification returns 503, runs validation through `waitUntil`, then succeeds on retry. Production hourly scheduling is **not configured**.

Fault injection commits a Twitch resident/world update and fails the acknowledgement. After clearing event history, retry does not append/reapply that action; `world_ingress` contains one applied receipt and the notification is subsequently acknowledged. This checks the crash window that bounded event-history deduplication could not protect.

## Not verified

- No Composio/Twitch credential was used, account created, connection authorized or real profile read performed. Owner approval and private project configuration are pending.
- No actual enabled managed EventSub subscription or real Twitch event was observed. No real-event two-viewer acceptance, reconnect or provider revocation test can be claimed.
- Native OBS and an always-on managed WebSocket listener are unverified. This patch does not claim to solve 2FA.
- No fresh browser/visual score is assigned for this server/tooling change. Prior application browser/critic records remain historical.

See [setup, pricing, scope plan and precise transport blockers](COMPOSIO_TWITCH.md). The existing custom-app adapter remains available. Demo actions retain `source: demo`; test Twitch events exist only in isolated test databases.
