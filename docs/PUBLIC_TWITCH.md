# Public Twitch app: streamers, worlds and viewers

HELLO WORLD is a public app for Twitch communities. Its hosted flow does not require ChatGPT sign-in or a separate developer app/API key from each streamer or viewer.

- A streamer signs in with Twitch through the app's server-side Composio project and opens `/director?world=twitch-<their numeric Twitch ID>`.
- Viewers follow that streamer's `/world?world=twitch-<streamer ID>` link, sign in with Twitch and create/control their own resident.
- The server derives `twitch:<verified numeric ID>` from the authenticated provider profile. Submitted actor IDs, event sources and role claims cannot replace it.
- A world’s Director authority comes from `world_owners`, scoped to that world. A user who directs their own world is a viewer in another streamer's world.
- Snapshots, settings, approval queues, limits, event receipts and OBS URLs preserve the selected world. Public viewing and OBS require no login.

The legacy default neighborhood remains a public demo. A Twitch login can open a separate world without resetting that demo or another community. Clearing browser cookies logs a user out; their hosted residents and worlds stay in D1 and can be recovered by signing into the same Twitch account.

## One-time operator setup

The HELLO WORLD operator already stores `COMPOSIO_API_KEY` privately in Sites. Never put it in frontend code, visitor forms, logs, a public repo or chat. End users do not configure this key.

Composio's ordinary connected-account link is not by itself a secure identity login. Public login uses its documented **OAuth callback verifier**, which supplies a completion-only, single-use credential after Twitch authorization.

In the existing Composio project's [Settings → General](https://dashboard.composio.dev/~/project/settings/general), open **Configuration** and set **OAuth callback verifier URL** to exactly:

```text
https://hello-world-miles-society.myles4miles.chatgpt.site/api/auth/twitch/verify
```

Then set the same URL in the Site's server variable `COMPOSIO_OAUTH_VERIFIER_URL` and redeploy the saved version. The application reports setup pending until its server configuration is present. Do not enable the application flag before configuring the Composio project; ordinary callbacks never authenticate a user.

The documented project-key API does not expose an update/readback for this existing-project setting; Composio directs configuration changes to the dashboard. No new account or broader organization key is necessary. This setting affects every OAuth provider-redirect connection in that Composio project. Test from HELLO WORLD; dashboard-created OAuth connections cannot complete while the verifier is enabled because they have no app browser state.

`AUTH_SESSION_SECRET` can optionally provide a separate 32+ character random server secret. On the hosted deployment, the Worker derives a domain-separated auth key from the existing private `TWITCH_TOKEN_ENCRYPTION_KEY` using HKDF, so no secret needs exporting or copying into chat. Keep that existing encryption key stable across deployments. No auth secret is returned to the browser.

## Login protocol

1. A same-origin JSON POST to `/api/auth/twitch/start` selects either joining a validated world or creating/opening the user's own world. Public issuance has durable global and privacy-hashed per-IP limits.
2. The server checks managed Twitch OAuth and a verifiable empty additional scope set. It creates/reuses one managed auth config with a durable creation lock. A random server-side Composio user ID and exact expected connected account bind each attempt.
3. The browser receives a short-lived Composio Connect Link and a signed Secure/HttpOnly/SameSite=Lax host-only state cookie. The key and provider tokens stay server-side/with Composio.
4. After Twitch consent, Composio redirects to `/api/auth/twitch/verify` with **only `session_uri`**. The original per-link `callback_url` is not used in this protected flow.
5. The server requires the initiating browser cookie, a fresh one-time attempt and the completion URI. It calls `connectedAccounts.completeAuth` with the stored expected Composio user ID, checks the returned exact account and Twitch toolkit, then verifies config/account ownership and reads the account's basic Twitch profile.
6. Only then does it create a signed 30-day browser session backed by a hashed D1 session token and a stable per-Twitch-user world owner record. A Director return always chooses that verified user's own world.

An account becoming `ACTIVE`, a caller-provided account ID, or a known state value never substitutes for the completion proof. The legacy `/api/auth/twitch/callback` always rejects. A copied Connect Link, guessed URI, wrong browser, wrong account/toolkit and URI replay do not issue a session. The URI expires after ten minutes and every redemption consumes it. No AI work runs in this path.

Logout removes only the caller's app session. It does not delete world data or silently revoke the provider grant. Repeated consent attempts can create extra Composio managed-connection records; account cleanup and production quota monitoring remain operator work.

## Permissions and live events

The identity flow asks only for the basic Twitch profile with no additional Twitch scope. Missing/broad/hidden scope metadata stops setup; it does not silently request a broad managed-app default. A successful login is not evidence that chat, subscriptions, redemptions or raids are being delivered.

Live channel features require separate, explicitly enabled permissions and a verified hosted event transport. The current custom-app webhook adapter remains optional. Its signed notifications are routed by the durable subscription registry to the owning world before strict validation; a browser cannot choose the destination world. The Composio EventSub WebSocket candidate still needs a continuously hosted listener and real delivery verification. Native OBS remains unverified.

## Evidence and limits

The new login suite passes **28 tests** with mocked provider replies and real SQLite/session cryptography. The full unit suite passes **197 tests**. Hosted acceptance passes **44 world/identity checks**, **76 Twitch/webhook checks** and **31 relay checks**. The real Node runtime/restart suite passes 10 checks. The new frontend passes 13 browser assertions with mocked HTTP and a stubbed WorldScene; these are not real OAuth or fresh 3D evidence.

Independent security review rejected an early ACTIVE-only prototype; it was never published. The deferred-verifier implementation passes the reviewed completion/tenant boundaries. Actual Composio project configuration, Twitch consent, real event delivery and native OBS must still be verified before claiming those worked.

The local Node/Twurple adapter remains a single-world development path with its existing private Director key. The public multi-world Twitch identity flow described here is implemented in the hosted Sites Worker/D1 adapter.

References: [Composio callback identity verification](https://docs.composio.dev/reference/api-reference/connected-accounts#callback-identity-verification), [project settings](https://docs.composio.dev/reference/api-reference/projects#project-settings), [completeAuth SDK](https://docs.composio.dev/reference/sdk-reference/typescript/connected-accounts#completeauth), [Twitch integration research](COMPOSIO_TWITCH.md).
