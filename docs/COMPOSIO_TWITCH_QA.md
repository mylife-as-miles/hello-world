# Managed Twitch investigation and hosted hardening evidence

Date: **2026-11-04**. Working baseline: GitHub `main` at `03d937d`. Latest engine branches were inspected; unfinished round-10 changes were not merged. Sites was public, saved version 6, source `60c4b51764b6a4e29c6b2b1d6729f348b94ce60f`; this update preserves that audience and the owner-only Director policy.

## Executed checks

| Command / check | Result | Evidence boundary |
| --- | --- | --- |
| `pnpm typecheck` | Pass, all packages | Real TypeScript compiler |
| `pnpm test` | **169/169** | 109 engine + 60 server; includes 6 mock Composio cases, 11 hosted profile/security cases and 3 SQLite subscription cases |
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

- The owner approved the basic-profile proof and configured `COMPOSIO_API_KEY` privately in Sites. Its value is unreadable through native settings and was not exported. No real metadata/profile read or connection has been verified yet; the hosted owner flow is ready for the owner to invoke.
- No actual enabled managed EventSub subscription or real Twitch event was observed. No real-event two-viewer acceptance, reconnect or provider revocation test can be claimed.
- Native OBS and an always-on managed WebSocket listener are unverified. This patch does not claim to solve 2FA.
- The new profile UI passed 9 checks in real Chromium at 390px with mocked HTTP responses: approval gate, private link, reload recovery, honest live label, revocation-review gate, scope failure stop and no page errors/overflow. This is not real consent or provider evidence. No fresh product score is assigned; prior application browser/critic records remain historical.

See [setup, pricing, scope plan and precise transport blockers](COMPOSIO_TWITCH.md). The existing custom-app adapter remains available. Demo actions retain `source: demo`; test Twitch events exist only in isolated test databases.

## Hosted proof follow-up

The unreadable Sites secret prompted adding an owner-only hosted SDK flow rather than exporting the key. Independent read-only review found consent-link recovery and missing provider deadlines; both were fixed before publishing. The short-lived link is encrypted and resumes for the same owner, expired/uncertain attempts require explicit revocation review before clearing, and each SDK operation receives a ten-second cancellation signal. The hosted SDK uses its documented `workerd` package imports; the initial default-platform bundle failed on Node built-ins and was corrected. No credential was used by those bundle checks.

The follow-up review caught a reset/creation race; a fresh `starting` row now blocks reset for two minutes and all completion writes compare a unique creation claim token. The regression test pauses persistent config creation and proves that a concurrent reset is rejected. Consent-link encryption, expiry, wrong-key rejection, owner isolation and explicit local-record cleanup are also tested.

The first hardening release was published as Sites version **7**, source `8204895ec324637619e541658e01c25cae184342`, deployment `appgdep_6aeae55ea4e88191adb66b761f133cb7` (succeeded). Production D1 confirmed the new subscription and ingress tables. Public snapshot/world/Director shell/overlay returned 200; all 13 resident IDs survived. Anonymous and forged-owner OAuth initiation returned 401; the application remained Demo Mode with `oauthConfigured:false`. Those checks preceded the hosted profile UI follow-up.

The hosted profile follow-up is published as Sites version **8**, GitHub code `0ce7bcbcbe99c7cf5b8a7cf391705ce651a90209`, source `995e57ea3b1cad59b8cf6b1644255f2c49c82890`, deployment `appgdep_6aeaea879f108191947857250f84d167` (succeeded, environment revision 4). Its sanitized source checkout passed typecheck and the Sites build using pnpm 10.28.2. Production D1 confirmed `composio_profile_proofs`; the public snapshot still contained the same 13 resident IDs. Anonymous status/connect and forged-owner connect requests all returned 401. Recent Worker error logs contained no errors. No proof row existed at verification time; an authenticated provider result is still pending. [Machine-readable release evidence](evidence/composio-hosted-release.json).
