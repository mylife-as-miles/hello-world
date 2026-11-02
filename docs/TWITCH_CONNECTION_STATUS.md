# Twitch connection readiness

Checked **2026-11-02**, during final integration. This document records environment readiness, not a claim that Twitch is connected. The application remains in **Demo Mode**.

## Observed status

| Requirement | Observed state |
| --- | --- |
| Connected Twitch tool/plugin | None available in the active tool catalog |
| Managed-environment Twitch secret bindings | None configured; current environment-status observations confirmed |
| `TWITCH_CLIENT_ID` | Absent from process and root `.env` |
| `TWITCH_CLIENT_SECRET` | Absent from process and root `.env` |
| `TWITCH_REDIRECT_URI` | Local-development example configured |
| Server access/refresh tokens | Absent from process and root `.env` |
| Saved `.data/twitch-token.json` | Absent; contents were not inspected |
| Optional broadcaster ID/login restriction | Absent |
| Running `/api/status` on ports 3001 and 5181 | `mode: demo`, `oauthConfigured: false`, no Twitch capabilities |
| Public Twitch OAuth discovery endpoint | HTTP 200 |
| Public token validation without authorization | Expected HTTP 401; not proof of authentication |
| Default Node `ws` public EventSub handshake | Timed out at five seconds; no authorization/subscription attempted |

Credential checks reported presence/absence only. No secret values, authorization codes, or session cookies were printed. All earlier GPU probe browsers were closed before this pass; no additional browser was launched.

The default Node WebSocket timeout is an additional environment-specific transport gap. Public HTTP requests used the inherited cloud proxy; the ordinary `ws` handshake did not complete. Before a live test in this cloud, validate a supported proxy-aware Node HTTP/WSS path. Do not infer that a desktop/local deployment has the same networking restriction, and do not bypass the environment proxy or change policy to conceal the gap.

## Exact remaining setup

1. Use the owner's existing Twitch account in the [Twitch developer console](https://dev.twitch.tv/console/apps). Twitch requires a verified email address and two-factor authentication to register an app. Register a separate HELLO WORLD application if one does not already exist; do not reuse another project's client credentials. [Official registration instructions](https://dev.twitch.tv/docs/authentication/register-app/).
2. Register the **exact browser-accessible callback** for the chosen run:
   - Local Vite development: `http://localhost:5173/api/twitch/callback`.
   - Local built server: `http://localhost:3001/api/twitch/callback`.
   - Remote/cloud deployment: `https://<actual-app-origin>/api/twitch/callback`, with `/api` routed to this server. `WEB_ORIGIN` must be that same public application origin.

   A cloud container's `localhost` is not the viewer's laptop. A public deployment/forwarded application origin must be selected before remote browser consent can return successfully. The QA port 5181 is not an automatically registered production callback.
3. Supply the app's Client ID and Client Secret through the **server's environment/secret settings**, or a private untracked root `.env` for a local run. Set `TWITCH_REDIRECT_URI` to the registered callback and restart the server. Keep secrets out of chat, Git, screenshots, frontend `VITE_` variables, and browser storage.
4. Configure a private `DIRECTOR_KEY` of at least 16 characters for remote access. Set the optional `TWITCH_BROADCASTER_ID` / `TWITCH_BROADCASTER_NAME` if this server must accept only a particular broadcaster.
5. Open the world using the same hostname as the callback. Unlock Director Studio and choose **Connect Twitch**. Log into and authorize the actual broadcaster account. This slice uses that authorized account for both chat and EventSub; a separate bot-account flow is not implemented. The server performs the authorization-code exchange and saves refreshed tokens privately.
6. For Channel Points, configure `TWITCH_REWARD_ACTIONS` with real reward IDs and approved actions. Subscription and Channel Points features also depend on the broadcaster's Twitch channel eligibility and available features; lack of these features does not justify claiming they were tested.

No account/application was created and no external app settings were changed in this session. An authenticated Twitch account and app credentials were not available to complete those steps.

## Permissions and protocol

The current implementation requests `chat:read`, `chat:edit`, `channel:read:subscriptions`, and `channel:read:redemptions`. These match the implemented Twurple IRC chat receiver/replies and the subscription/custom-reward EventSub receivers. Incoming raids need no event-specific scope, but EventSub WebSocket subscriptions still require an authenticated **user** token. An app/client-credentials token is insufficient. Modern EventSub chat's `user:read:chat` is a separate receiver and is not the implemented IRC path. [Scopes](https://dev.twitch.tv/docs/authentication/scopes/), [EventSub types](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/), [WebSocket protocol](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/).

The server uses random single-use session-bound OAuth state, validates app/user identity and actual granted scopes, validates maintained tokens at startup/hourly, persists refreshed tokens server-side, and reports capability failures. [Authorization-code flow](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#authorization-code-grant-flow), [validation requirement](https://dev.twitch.tv/docs/authentication/validate-tokens/).

## Evidence required before declaring live connection

After credentials and broadcaster consent are available, verify actual chat channel join and each successful EventSub subscription in the capability status. Send `!join`, `!wave`, `!dance`, and `!hello` from an authorized viewer and observe normalized source `twitch` events in the same world runtime. Exercise a configured real reward and a real subscription/raid when permitted; label individual unexercised features honestly. Verify a second session receives the authoritative world change and token refresh/reconnect reporting behaves correctly.

Public endpoint reachability, passing normalization tests, OAuth URL generation, a socket welcome, or a green application health response alone does not establish broadcaster authorization or real event delivery. See [TWITCH.md](./TWITCH.md) for operational setup and action mappings.
