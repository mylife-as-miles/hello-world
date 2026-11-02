# Hosted Twitch OAuth and EventSub webhooks

Verified against official Twitch documentation on **2026-11-02**. This describes the hosted connection contract and release checks. It is not evidence of a successful broadcaster grant or real Twitch delivery: Twitch app credentials were unavailable during research.

The hosted UI remains private. Twitch uses an API-only public ingress relay for one EventSub POST path; the relay forwards to the private application's fixed webhook path using a server-only service credential. Owner controls and OAuth initiation remain behind the private site's authenticated owner identity. Neither a local Node process nor an outgoing EventSub WebSocket is required.

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

Set `TWITCH_EVENTSUB_CALLBACK` to `https://hello-world-miles-events.myles4miles.chatgpt.site/api/twitch/eventsub`. This public callback is separate from the private OAuth callback above. The relay intentionally translates its public `/api/twitch/eventsub` path to the private receiver at `https://hello-world-miles-society.myles4miles.chatgpt.site/api/twitch/webhook`. Do not register the private receiver directly with Twitch: the private Site's access gate would block Twitch's anonymous POST before the handler runs. The shared secret must be 10–100 ASCII characters; 32 cryptographically random bytes encoded as 64 hex characters is suitable. It stays in hosted secrets. HTTPS port 443 is required, and Twitch does not follow callback redirects. [Create EventSub Subscription](https://dev.twitch.tv/docs/api/reference/#create-eventsub-subscription).

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

An HTTP 202 creation response initially means `webhook_callback_verification_pending`. Do not label it connected until a valid callback verification/confirmed enabled status exists. Save per-subscription IDs, type, condition, and status; report failures and revocations. Avoid duplicate subscriptions when reconnecting. [Subscription lifecycle](https://dev.twitch.tv/docs/eventsub/manage-subscriptions/).

## Public ingress and authenticated delivery

The relay accepts only POST to `/api/twitch/eventsub` with no query string, forwards to the fixed private `/api/twitch/webhook` upstream, and preserves the original body bytes and allowlisted Twitch EventSub headers. It validates the Twitch signature before forwarding, and the private receiver validates it again. It must not forward arbitrary paths, caller-selected destinations, client authorization headers, or private owner APIs. Keep the upstream service bearer only in the relay's server secrets. Do not expose it in a URL, response, log, HTML, or bundle. The relay sends the service credential as `OAI-Sites-Authorization: Bearer <token>` only to that fixed private Site, with redirects disabled. Sites consumes this credential; it supplies no visitor identity. The relay returns successful 200 challenge bytes or a 204 acknowledgement; upstream failures become a generic 502 without exposing private response bodies. OAuth initiation and callback remain browser routes requiring the owner's normal Sites identity, never this identity-less service credential.

The private receiver authenticates **every** EventSub message, including challenges and revocations, before acting:

1. Read the raw request body with a bounded size; retain its exact bytes.
2. Require message ID, timestamp, signature, and supported message type headers. Header names are case-insensitive.
3. Verify `sha256=` plus HMAC-SHA256 of the concatenation `message ID + original timestamp string + raw body`, using the subscription secret and constant-time/WebCrypto signature verification. Reject mismatches with 4xx.
4. Reject invalid timestamps and timestamps older than ten minutes. Bound future clock skew as an explicit application policy.
5. Validate the signed payload, subscription type/version/condition, configured broadcaster, and allowlisted action before any world change.

[Official verification procedure](https://dev.twitch.tv/docs/eventsub/handling-webhook-events/).

Twitch retries deliveries with the same message ID. Use a durable unique message-ID receipt in D1 and apply each accepted notification once; in-memory deduplication is insufficient across Worker instances. Acknowledge only after durable acceptance, and process quickly enough to avoid delivery-failure revocation. A previously accepted duplicate should receive a successful acknowledgement without another world action. [Duplicates and replay protection](https://dev.twitch.tv/docs/eventsub/).

For `webhook_callback_verification`, return HTTP 200 with the **raw challenge string only**, `text/plain`, and its correct byte Content-Length. For `notification`, return a quick successful 2xx after durable acceptance. For signed `revocation`, update the stored subscription status and return 204. The webhook handler must not require a browser cookie or owner login; its authority comes from the valid Twitch signature and configured subscription. This exception applies only to the webhook path, never to Director controls.

## Required release evidence

Before claiming live Twitch connectivity, verify the hosted OAuth redirect/owner binding, a real broadcaster grant, successful app-token subscription creation, Twitch's actual signed challenge, and enabled subscription status. Then send a real chat command and observe a normalized `source: twitch` event in the authoritative hosted world. Exercise subscription, redemption, and raid paths when available; report any unexercised feature individually.

A signed synthetic challenge test is useful protocol evidence but is not proof Twitch enabled a subscription. Public ingress availability does not establish OAuth consent, and no setup step should require the owner to paste secrets into chat.

## Deployed verification

Both Workers were successfully published on 2026-11-02. Production D1 contains the world, presence, OAuth state, encrypted-account and webhook-receipt tables. A signed **synthetic** challenge traversed the anonymous relay, Sites service access and private webhook and returned exact plaintext (200); retry returned the same challenge (200), and tampering was rejected (403). This does not establish an actual Twitch grant or subscription. The world remains labeled Demo Mode because Twitch app ID/secret and broadcaster consent are unavailable. See [deployment evidence](evidence/sites-deployment.json).

To enable live connection, configure `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` in the private world's Sites runtime settings, mark the secret sensitive, and redeploy the saved version to apply the environment revision. The exact redirect URI, public callback, generated webhook secret and token-encryption key are already configured server-side. Sign in to the private world, open Director Studio and connect Twitch. Confirm actual signed Twitch challenge/subscription status and real event delivery before calling it live. Do not paste app secrets into chat or add them to frontend variables.
