# Hosted Twitch OAuth and EventSub webhooks

Verified against official Twitch documentation on **2026-11-02**. This describes the hosted connection contract and release checks. It is not evidence of a successful broadcaster grant or real Twitch delivery: Twitch app credentials were unavailable during research.

Updated **2026-11-04** with durable subscription identity and transactional world-ingress receipts. [Composio-managed OAuth investigation and approval-gated proof](COMPOSIO_TWITCH.md) are separate from this optional custom-app path; no managed or custom-app live connection has been established.

The hosted world is public to watch. Resident writes require Twitch sign-in. Director controls and optional custom-app Twitch OAuth require the verified Twitch identity that owns the selected world. Public login is managed through Composio; see [public Twitch identity and ownership](PUBLIC_TWITCH.md). Twitch uses an API-only public ingress relay for one EventSub POST path; it forwards to the application’s fixed signed webhook using a server-only service credential. Neither a local Node process nor an outgoing EventSub WebSocket is required.

## OAuth callback and permissions

Register this exact OAuth redirect URI in the HELLO WORLD Twitch app:

```text
https://hello-world-miles-society.myles4miles.chatgpt.site/api/twitch/callback
```

The Twitch developer app's Client ID and Client Secret must be configured in hosted server secrets. An authenticated owner starts OAuth; the broadcaster consents in Twitch. Use authorization-code grant, single-use random state bound to the initiating owner/session, and an exact callback. Store the resulting user grant encrypted server-side, including refreshed token changes; never return tokens or encryption keys to the browser. [Official OAuth flow](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#authorization-code-grant-flow).

For the implemented receiver features, request:

```text
user:read:chat user:bot channel:bot channel:read:subscriptions channel:read:redemptions
```

This is the baseline set without relying on an existing moderator role. The broadcaster also acts as the authorized chat reader, so one consent can grant both reader and channel permissions. For app-token chat subscriptions, `user:read:chat` and `user:bot` come from the reader; the channel must grant `channel:bot` unless the reader has moderator status. The official subscription page does not document a broadcaster-equals-reader exemption, so this setup explicitly requests all three chat permissions. No `user:write:chat` is needed when chat API replies are omitted. The old IRC `chat:read` / `chat:edit` scopes do not implement this webhook receiver. [Chat authorization](https://dev.twitch.tv/docs/chat/authenticating/), [chat subscription authorization](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channelchatmessage).

## Subscription creation

Create webhook subscriptions with an **app access token obtained by client-credentials grant for the same Client ID**. The broadcaster must first grant the required user permissions to that Client ID. A user access token cannot create a webhook subscription. [Managing subscriptions](https://dev.twitch.tv/docs/eventsub/manage-subscriptions/#authorization).

Send `POST https://api.twitch.tv/helix/eventsub/subscriptions` with `Authorization: Bearer <app-token>`, matching `Client-Id`, and JSON body. Every request uses version `"1"` and transport:

```json
{
  "method": "webhook",
  "callback": "https://hello-world-miles-events.myles4miles.chatgpt.site/api/twitch/eventsub",
  "secret": "<server-generated-random-ASCII-secret>"
}
```

Set `TWITCH_EVENTSUB_CALLBACK` to `https://hello-world-miles-events.myles4miles.chatgpt.site/api/twitch/eventsub`. This public webhook callback is separate from the owner-authenticated OAuth callback above. The relay intentionally translates its public `/api/twitch/eventsub` path to the receiver at `https://hello-world-miles-society.myles4miles.chatgpt.site/api/twitch/webhook`. Keep this existing relay callback registered: it also preserves webhook delivery if the world is made private later. Twitch accepts 10–100 ASCII characters; this application requires 32–100 printable ASCII characters; 32 cryptographically random bytes encoded as 64 hex characters is suitable. It stays in hosted secrets. HTTPS port 443 is required, and Twitch does not follow callback redirects. [Create EventSub Subscription](https://dev.twitch.tv/docs/api/reference/#create-eventsub-subscription).

With `B` equal to the authenticated broadcaster's numeric Twitch ID:

| Type | Condition | Permission |
| --- | --- | --- |
| `channel.chat.message` | `{ "broadcaster_user_id": B, "user_id": B }` | Three chat grants above |
| `channel.subscribe` | `{ "broadcaster_user_id": B }` | `channel:read:subscriptions` |
| `channel.subscription.gift` | `{ "broadcaster_user_id": B }` | `channel:read:subscriptions` |
| `channel.subscription.message` | `{ "broadcaster_user_id": B }` | `channel:read:subscriptions` |
| `channel.channel_points_custom_reward_redemption.add` | `{ "broadcaster_user_id": B }` | `channel:read:redemptions` |
| `channel.raid` | `{ "to_broadcaster_user_id": B }` | No additional user scope |

A redemption condition can optionally include `reward_id`. Always retain the server's action allowlist. Incoming raid conditions must not also include `from_broadcaster_user_id`. New subscriptions do not include resubscriptions; the subscription-message receiver handles resub messages. [Subscription definitions](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/).

An HTTP 202 creation response initially means `webhook_callback_verification_pending`. Migration `0003_twitch_delivery.sql` adds a durable subscription registry. Creation records the exact type/version/condition/callback before the Helix call, binds the returned ID, and safely handles a challenge racing the creation response. A 409 requires matching the existing subscription from Helix; it does not establish connectivity by itself. 429/5xx records a bounded durable retry time honoring `Retry-After`/`Ratelimit-Reset`; reconnect attempts before it expires skip that subscription. Automatic retry scheduling is not configured. [Subscription lifecycle](https://dev.twitch.tv/docs/eventsub/manage-subscriptions/).

Live Mode now requires a fresh validated grant, an enabled registered subscription, **and an accepted signed notification that changed/queued an authoritative world action**. A challenge alone keeps the world in Demo Mode. This runtime signal is not a substitute for a human-reviewed real-event acceptance record.

## Public ingress and authenticated delivery

The relay accepts only POST to `/api/twitch/eventsub` with no query string, forwards to the fixed `/api/twitch/webhook` upstream, and preserves the original body bytes and allowlisted Twitch EventSub headers. It validates the Twitch signature before forwarding, and the receiver validates it again. It must not forward arbitrary paths, caller-selected destinations, client authorization headers, or private owner APIs. Keep the upstream service bearer only in the relay's server secrets. Do not expose it in a URL, response, log, HTML, or bundle. The relay sends the service credential as `OAI-Sites-Authorization: Bearer <token>` only to that fixed Site, with redirects disabled. Sites consumes this credential; it supplies no visitor identity. The relay returns successful 200 challenge bytes or a 204 acknowledgement; upstream failures become a generic 502 without exposing private response bodies. OAuth initiation and callback remain browser routes requiring the owner's normal Sites identity, never this identity-less service credential.

The receiver authenticates **every** EventSub message, including challenges and revocations, before acting:

1. Read the raw request body with a bounded size; retain its exact bytes.
2. Require message ID, timestamp, signature, and supported message type headers. Header names are case-insensitive.
3. Verify `sha256=` plus HMAC-SHA256 of the concatenation `message ID + original timestamp string + raw body`, using the subscription secret and constant-time/WebCrypto signature verification. Reject mismatches with 4xx.
4. Reject invalid timestamps and timestamps older than ten minutes. Bound future clock skew as an explicit application policy.
5. Require header/body type and version agreement, the registered subscription ID, exact canonical condition and callback, configured broadcaster in both subscription and notification, enabled status, and an allowlisted action before any world change. A signed challenge for an unknown/revoked subscription is rejected.

[Official verification procedure](https://dev.twitch.tv/docs/eventsub/handling-webhook-events/).

Twitch retries deliveries with the same message ID. A token-owned D1 message lease prevents overlapping handlers; each accepted normalized action also has a permanent `world_ingress` receipt committed **in the same D1 transaction as its world snapshot/settings/moderation state**. A lost revision comparison rolls the transaction back. A crash after commit but before acknowledgement cannot duplicate the action even after the bounded event history is cleared. Do not delete these ingress receipts while notifications can be replayed. Previously accepted duplicates receive 204 without another world action. No AI work runs in this path. [Duplicates and replay protection](https://dev.twitch.tv/docs/eventsub/).

Token validation/refresh no longer depends on a Director tab: public API traffic runs maintenance, and a notification with stale validation defers maintenance using `waitUntil` and returns 503 for Twitch to retry. There is also a scheduled Worker entrypoint for hosts with Cron support. **No hourly production Cron is currently configured**, so an entirely idle deployment is not claimed to validate every hour. Public-reader, scheduled-entrypoint and stale-webhook retries are tested with mocked Twitch responses; an always-idle production schedule and real refresh/revocation remain unverified.

For `webhook_callback_verification`, return HTTP 200 with the **raw challenge string only**, `text/plain`, and its correct byte Content-Length. For `notification`, return a quick successful 2xx after durable acceptance. For signed `revocation`, update the stored subscription status and return 204. The webhook handler must not require a browser cookie or owner login; its authority comes from the valid Twitch signature and configured subscription. This exception applies only to the webhook path, never to Director controls.

## Required release evidence

Before claiming live Twitch connectivity, verify the hosted OAuth redirect/owner binding, a real broadcaster grant, successful app-token subscription creation, Twitch's actual signed challenge, and enabled subscription status. Then send a real chat command and observe a normalized `source: twitch` event in the authoritative hosted world. Exercise subscription, redemption, and raid paths when available; report any unexercised feature individually.

A signed synthetic challenge test is useful protocol evidence but is not proof Twitch enabled a subscription. Public ingress availability does not establish OAuth consent, and no setup step should require the owner to paste secrets into chat.

## Deployed verification

Both Workers were successfully published on 2026-11-02. Production D1 initially contained the world, presence, OAuth state, encrypted-account and webhook-receipt tables. A signed **synthetic** challenge traversed the anonymous relay, Sites service access and private webhook and returned exact plaintext (200); retry returned the same challenge (200), and tampering was rejected (403). That historical test predates the stricter subscription registry: an unregistered synthetic challenge is now rejected. It does not establish an actual Twitch grant or subscription. The world remains labeled Demo Mode because Twitch app ID/secret and broadcaster consent are unavailable. See [deployment evidence](evidence/sites-deployment.json).

To enable live connection, configure `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` in the world's Sites runtime settings, mark the secret sensitive, and redeploy the saved version to apply the environment revision. The exact redirect URI, public callback, generated webhook secret and token-encryption key are already configured server-side. Sign in as the world owner, open Director Studio and connect Twitch. Confirm actual signed Twitch challenge/subscription status and real event delivery before calling it live. Do not paste app secrets into chat or add them to frontend variables.

Public access does not grant Director permissions. Viewer and service identities cannot start Twitch OAuth. The legacy `DEMO_DIRECTOR` audience shortcut was removed when public viewing was enabled. World ownership is recorded server-side and scoped to the selected world.
