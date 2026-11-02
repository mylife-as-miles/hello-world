# Twitch connection

The shipped default is **Demo Mode**. No Twitch app credentials, broadcaster OAuth authorization, live chat connection, or live EventSub delivery were available in this build environment. The adapter is implemented and typechecked against Twurple 8.2; normalized commands, permissions and reward mappings have automated tests. A live broadcaster must complete the setup below before live functionality can be claimed.

## Server setup

1. Register an application in the [Twitch developer console](https://dev.twitch.tv/console/apps).
2. Register the exact callback URI. For local development use `http://localhost:5173/api/twitch/callback`. For a built single-server run, use `http://localhost:3001/api/twitch/callback`. Hosted callbacks must use HTTPS.
3. Copy `.env.example` to `.env` in the repository root. The server loads this file even when pnpm runs it from `apps/server`.
4. Set `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, and `TWITCH_REDIRECT_URI`. Set `TWITCH_BROADCASTER_ID` and `TWITCH_BROADCASTER_NAME` if you want the server to enforce a specific authorized broadcaster; IDs are numeric Twitch IDs and names are Twitch login names.
5. Set a private `DIRECTOR_KEY` with at least 16 characters for remote use. The key is entered in Director Studio and kept in browser memory only. Restart the server after changing `.env`.
6. Unlock Director Studio, select Connect Twitch, and authorize the broadcaster account. Tokens stay on the server. The browser receives an authorization URL, never the client secret/access token/refresh token.

The authorization-code flow uses 256-bit random, single-use, ten-minute `state` bound to the initiating signed browser session. POST `/api/twitch/connect` requires the configured Origin and Director permission. The callback consumes `state` even when denied or mismatched. Avoid changing hostnames between `localhost` and `127.0.0.1` during authorization because the session cookie is host-specific.

For headless provisioning, server-only `TWITCH_ACCESS_TOKEN` and `TWITCH_REFRESH_TOKEN` may be supplied instead. Use a user token issued to this application and broadcaster. A client-credentials/app access token cannot receive EventSub WebSocket events. Refreshed token data is saved privately in `.data/twitch-token.json`; that current token takes precedence over stale environment token values. The server validates token identity, app ID and actual scopes at startup, and validates maintained sessions hourly. Twurple refreshes tokens; validation or refresh failure stops the Twitch connection and reports it as disconnected.

## Connection readiness checked in this environment

At the 2026-11-02 connection pass, a presence-only check found no configured app ID, client secret, access token, refresh token, broadcaster identity, or saved token file. The example redirect URI was present. The running application correctly reported `mode: demo` and `oauthConfigured: false`. An authenticated Connect request returned HTTP 503 with setup instructions; an unissued callback state returned HTTP 403. These checks did not attempt a fabricated OAuth grant or subscription.

A real connection requires the streamer's own registered Twitch application and normal broadcaster consent. Configure the values privately in the server `.env`; do not paste secrets or tokens into chat. Register the callback for the exact app instance you open: default development `http://localhost:5173/api/twitch/callback`, built server `http://localhost:3001/api/twitch/callback`, or the equivalent HTTPS URL on your host. An isolated QA instance on port 5181 must use its own `http://localhost:5181/api/twitch/callback`, rather than returning authorization to another running server. Restart after changing server configuration, unlock Director Studio, select Connect Twitch, and complete Twitch's consent screen. Initial access/refresh tokens are not necessary when using this flow.

`oauthConfigured` checks credentials are present and the callback is a valid HTTPS URL (or HTTP on a loopback hostname), has path `/api/twitch/callback`, and contains no query, fragment or user-info. It does not prove the URL is registered in Twitch. The exact URL must still match the developer-console registration. The adapter validates a new OAuth grant against configured application/broadcaster identity before stopping an existing connection or replacing its saved token; an accidental login to another account leaves saved credentials intact.

The host must allow outbound HTTPS to Twitch OAuth/Helix and WSS to Twitch EventSub (and the IRC transport used by Twurple chat). In this managed cloud, official OAuth discovery through the supplied HTTP proxy succeeded, but a direct Node EventSub WSS handshake probe timed out after five seconds. That is an observed transport limitation requiring host/proxy diagnosis before live use; it is not a verified authenticated subscription. No TLS checks or network policies were bypassed. An ordinary host with working outbound Twitch connectivity is the straightforward deployment target. Proxy-specific Twurple transport adaptation remains unverified here.

Mocked authorization tests cover mismatched app/account grants preserving existing authorization, callback configuration validation and credential-free Demo Mode. They are regression tests, not evidence of real Twitch delivery.

## Requested permissions

| Feature                                       | Exact authorization                                                              | Implementation                                                              |
| --------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| IRC command/chat reception                    | `chat:read`                                                                      | Twurple `ChatClient`                                                        |
| Greetings/rejection replies                   | `chat:edit`                                                                      | Bounded bot replies                                                         |
| New subscriptions, resubs, subscription gifts | `channel:read:subscriptions`                                                     | EventSub `channel.subscribe`, `.subscription.message`, `.subscription.gift` |
| Custom Channel Points rewards                 | `channel:read:redemptions` (existing `channel:manage:redemptions` also accepted) | EventSub `channel.channel_points_custom_reward_redemption.add`              |
| Incoming raids                                | No event-specific scope; authenticated user transport required                   | EventSub `channel.raid` with receiving broadcaster ID                       |

The IRC scopes are deliberate. The separate modern EventSub `channel.chat.message` event uses `user:read:chat`; it is not implemented here. The app never claims chat reception without `chat:read`, and only sends replies with `chat:edit`. It skips unsupported EventSub features and reports missing scopes. Live mode begins only when chat has joined or an EventSub subscription has actually succeeded. Failed, revoked and disconnected subscriptions update reported capabilities. Socket initialization alone does not count as a live subscription.

## Viewer commands

- `!join`: create/update a resident under the authenticated Twitch user ID.
- `!wave`, `!dance`: perform the matching resident action after joining.
- `!hello` or `!hello your greeting`: speak in the neighborhood.
- `!gift username`: give a gift to an existing resident by display name.
- Ordinary chat from a joined resident becomes a bounded text event; unknown commands are ignored.

All of these become the same `WorldEvent` structures used by browser interactions and Director demonstration events. Names/messages are text, never executable code. Actions pass the same population, cooldown, pause and optional moderation rules. Twitch identities use stable `twitch:<user-id>` IDs; browser identities use signed `viewer:<id>` sessions. These identities are separate in this slice; Twitch-to-browser account linking is not implemented.

## Channel Points allowlist

Set `TWITCH_REWARD_ACTIONS` to a JSON object mapping **reward IDs**, not titles, to approved actions:

```dotenv
TWITCH_REWARD_ACTIONS={"your-dance-reward-id":"dance","your-party-reward-id":"confetti","your-rain-reward-id":"weather:rain"}
```

Supported values: `wave`, `dance`, `confetti`, `weather:sunny`, `weather:rain`, `weather:snow`, `weather:sunset`. At most 20 reward mappings are accepted. Other reward IDs are ignored. Redemption user input cannot change the action. Dance/wave redemptions join a resident when needed and pass viewer interaction rules; preapproved global weather/confetti rewards are server-trusted system celebrations. Reward fulfillment/cancellation is not implemented, so do not promise refunds or automatic fulfillment in the reward description.

Subscriptions create confetti celebrations. Incoming raids dispatch a raid event with the raiding broadcaster and bounded viewer count; the renderer owns the visual portal/arrival. These events do not grant viewers Director permissions.

## Local demonstration controls

`ALLOW_LOCAL_DIRECTOR=true` enables Director controls without a key only when no `DIRECTOR_KEY` is configured, the server peer is loopback, the configured web Origin is a loopback hostname, and the WebSocket Origin exactly matches it. The Vite proxy overwrites `x-hw-peer-address` with its actual incoming peer so a proxied remote client cannot receive local permission. Do not enable this option behind an arbitrary reverse proxy that hides original client addresses. Production/remote sessions should always use `DIRECTOR_KEY` and HTTPS.

Demo weather, confetti, raid and synthetic resident creation are explicitly sent with source `demo`. The server accepts this source only from an authenticated Director, and synthetic actor IDs must start with `demo:`. All events enter the actual world runtime; there is no separate fake game.

## Official references

Checked 2026-11-02:

- [Twitch authentication](https://dev.twitch.tv/docs/authentication/)
- [Authorization-code grant](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#authorization-code-grant-flow)
- [Token validation requirement](https://dev.twitch.tv/docs/authentication/validate-tokens/)
- [OAuth scopes](https://dev.twitch.tv/docs/authentication/scopes/)
- [EventSub overview](https://dev.twitch.tv/docs/eventsub/)
- [EventSub subscription types](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/)
- [EventSub WebSocket handling](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/)
- [Twurple](https://github.com/twurple/twurple)

EventSub events lost during a disconnection are not replayed by Twitch. This application does not claim guaranteed delivery or zero downtime.
