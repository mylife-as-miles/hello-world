# Composio-managed Twitch investigation

Checked **2026-11-04**. The owner has supplied a Composio project key privately in Sites and approved a basic-profile proof. Its value is not readable through the Sites settings tool and has not been exported. No persistent connection, Twitch consent or real event has been verified. The public world remains Demo Mode. The profile proof is isolated from the world-event adapter.

## Findings and the remaining event-path blocker

The [current Twitch toolkit](https://docs.composio.dev/toolkits/twitch) explicitly advertises **Composio-managed OAuth**, 131 tools, **zero triggers**, and toolkit version `20261101_00`. Managed OAuth supplies Composio's app credentials, so it is a plausible route without registering an owner-owned Twitch developer app. The owner still signs into Twitch and grants consent. Neither these documents nor this code establish that Twitch will accept this account's present security/2FA state.

There is a documented event-path candidate: `TWITCH_CREATE_EVENTSUB_SUBSCRIPTION` creates **WebSocket** subscriptions using user OAuth. A continuously hosted listener could open Twitch's WebSocket, receive its session ID, and pass that ID plus an approved type/condition to the Composio tool. This may avoid exporting a Twitch token. `TWITCH_GET_EVENTSUB_SUBSCRIPTIONS` can inspect subscriptions associated with the managed user's token. Neither operation has been exercised with an authenticated account here.

Zero toolkit triggers means there is no documented Composio Twitch trigger delivering notifications to our webhook. It does **not** prove that the WebSocket approach cannot work. Our Sites deployment currently has an HTTP Worker, D1 and the webhook relay; a continuously available WebSocket listener with reconnect/session recovery has not been provisioned or verified. A Director browser tab is not an acceptable replacement for that service.

The existing webhook path requires an **app access token for the same client ID that received broadcaster consent**. Composio's managed-app client secret/app-token capability is not documented or verified as exposed to this project. Ordinary connected-account responses redact provider secrets; SDK token-shaped fields are not evidence of usable token export. Consequently, we cannot simply put a managed user grant into the current webhook adapter or claim managed webhooks work. See [Twitch authorization](https://dev.twitch.tv/docs/eventsub/manage-subscriptions/) and [Composio token custody](https://docs.composio.dev/docs/security/token-custody).

Keep the existing custom-app hosted adapter and its relay as the optional path if the owner later resolves developer registration. Its exact callback remains:

```text
https://hello-world-miles-society.myles4miles.chatgpt.site/api/twitch/callback
```

The managed proof uses Composio's own consent redirect, privately returned by its SDK. Do not register the HELLO WORLD callback against a managed app or invent a Composio callback URL.

## Hosted owner flow

The owner-only Twitch connection dialog includes a Composio profile test. Sign into [Director Studio](https://hello-world-miles-society.myles4miles.chatgpt.site/director), open **Connect Twitch**, and select **Check managed OAuth permissions**. This performs the first credential-backed metadata read in the hosted Worker; it creates no connection. If the scope metadata is unavailable or broad, the test stops with a precise code. That is an unverified permission contract, not proof that Composio cannot connect Twitch.

When inspection passes, review the persistent-access checkbox and select **Prepare private Twitch consent**, then **Review Twitch consent**. Approve only the reviewed basic-profile access. Return and select **Verify approved basic profile** within ten minutes. A successful read still explicitly says live events are not connected.

All `/api/composio/twitch/*` routes require the trusted owner identity; neither public visitors nor the relay service token can invoke them. POSTs additionally require same-origin JSON and explicit mode-specific approval. The UI sends no key/token. The fixed server-side SDK client can inspect Twitch auth, create the scope-limited proof, or read the authenticated profile; it cannot execute caller-supplied tools, URLs or scripts. Each provider operation has a ten-second cancellation deadline.

Migration `0004_composio_profile.sql` stores non-secret owner/config/account attempt IDs and the allowlisted basic-profile result separately from world data. A unique owner/world row prevents concurrent/repeated connection creation. The short-lived consent URL is encrypted with AES-GCM under the existing server-only `TWITCH_TOKEN_ENCRYPTION_KEY`, bound to this world and owner. It can resume after a dialog reload until expiry; it is deleted on verification and never returned after expiry. It is never stored in plaintext or logs.

For an expired/uncertain attempt, review and revoke/remove that test connection in the Composio dashboard first, then use **Clear local connection test** with the explicit review checkbox. This clears only the proof record; it does not revoke provider access or reset the world. No automatic retry creates another persistent grant. Project credentials stay in the existing `COMPOSIO_API_KEY` Site secret; `COMPOSIO_OWNER_ID` is needed only for the optional local CLI, since hosted identity is derived from trusted Sites sign-in.

## Approval-gated basic-profile proof

Requirements: Node **22.22.3+**, pnpm, and an existing Composio **Platform** project. SDK `@composio/core@0.28.0` is pinned as an operator development dependency and dynamically imported only in approved modes. It is not imported into the browser. The hosted Worker also uses the SDK, bundled with its `workerd` platform condition (the default Node build requires unsupported Node modules).

Default command performs **no network calls and reads no credentials**:

```sh
pnpm twitch:composio:poc --mode=plan
```

Before any other mode, obtain explicit owner approval to use the project credential. Before `connect`, also obtain approval for persistent managed access: Composio will hold and refresh the provider grant until revoked. Do not create an account, use an existing credential or initiate consent merely because an environment variable is present. The CLI approval flag records the operator's explicit decision; it does not itself obtain consent.

Configure `COMPOSIO_API_KEY` and a stable, non-email `COMPOSIO_OWNER_ID` through a private operator environment/secret manager. Do not paste values into chat, command arguments, a public issue, or a frontend variable. The CLI does not load `.env` automatically.

After approval, use these commands in order:

```sh
pnpm twitch:composio:poc --mode=inspect --approved=read-only
pnpm twitch:composio:poc --mode=connect --approved=connect-profile
# Owner privately opens .data/composio-poc/connect-url.txt and reviews Twitch consent.
pnpm twitch:composio:poc --mode=read --approved=read-only
```

The proof asks for an empty additional scope set and performs only `GET https://api.twitch.tv/helix/users` for the authenticated account's basic profile. It requests no email, chat, subscription, moderation, rewards or event permissions. It first checks managed-OAuth metadata, then creates an empty-scope auth config and verifies the effective config. Missing/masked scope metadata or unexpected required scopes **stop the proof before authorization**; they do not silently fall back to broad default scopes. The owner must stop if the actual Twitch consent screen asks for more than the reviewed basic-profile access. Resolving a provider-required broader scope set requires a new explicit review.

Connection attempts are bound to owner/config/account IDs, expire after ten minutes, and cannot be silently replaced by another connect invocation. Read mode verifies the private active account belongs to that owner/config. Private files are ignored under `.data/composio-poc/` with directory mode 0700 and file mode 0600. The consent link and profile result are not printed. Raw SDK errors and provider state are not logged. Tokens are never imported/exported. After the experiment, review/revoke the connection and remove private attempt files before trying again; deleting files alone does not revoke provider access.

Even a successful profile read returns `liveEventsVerified: false`. It only proves the authorized read, not a live world connection.

## Incremental live permission plan

These are candidate **WebSocket user-grant** permissions, not permissions requested by this proof. Confirm the connected account, exact event conditions and Composio's effective scopes before enabling each feature. Request new scopes only when enabling that feature, with renewed consent.

| Feature | Candidate Twitch scope | Status / eligibility |
| --- | --- | --- |
| Own basic profile | No additional scope | Isolated proof prepared; real read pending |
| `channel.chat.message` v1 | `user:read:chat` | Reader must match authorized user; managed delivery unverified |
| `channel.follow` v2 | `moderator:read:followers` | Authorized moderator/broadcaster condition required; not yet mapped |
| Subscriptions/gifts/resubs v1 | `channel:read:subscriptions` | Broadcaster permission and applicable channel eligibility |
| `channel.cheer` v1 | `bits:read` | Broadcaster permission; not yet mapped |
| Custom reward redemptions v1 | `channel:read:redemptions` | Eligible Affiliate/Partner channel; approved reward mapping required |
| Incoming raid v1 | No additional scope | Exact receiving broadcaster condition required |

The existing **custom-app webhook** chat flow has different authorization requirements (`user:read:chat`, `user:bot`, `channel:bot`); do not conflate it with this candidate WebSocket flow. The custom-app UI still requests its documented baseline feature bundle. See [event types/scopes](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/) and [existing adapter](TWITCH.md).

Before shipping managed live delivery, verify a real enabled subscription and a real event, reconnects, disconnects and revocation. Route accepted events through the existing trusted ingress into the authoritative world, using stable Twitch resident IDs, allowlisted actions, moderation, cooldowns and durable receipts. Verify the same `source: twitch` event and resident change from two sessions. Never relabel Demo events as Twitch or treat polling a profile endpoint as receiving events. No AI work belongs in the webhook acknowledgement path.

## Costs and limits observed

The [pricing page](https://composio.dev/pricing) advertises Hobby at $0 without a card, 100,000 overall tool calls/month, of which at most **20,000** can use managed apps; managed calls stop at the free allowance. The first 1,000 managed connected accounts are free. The overall trigger allowance is 50,000/month (10,000 managed), but the Twitch toolkit has zero documented triggers. Pro starts at **$29/month** with $29 credits; managed tool-call pricing varies by app and Twitch-specific paid rates were not established here. These prices can change; verify the project dashboard before creating paid usage.

[Rate limits](https://docs.composio.dev/reference/rate-limits) list 2,000 requests/minute on Hobby and 10,000 on Pro across the organization. Managed apps also share provider-side quotas. Honor `Retry-After`, avoid repeated reconnect/config creation, and monitor both providers. No account/project was created by this coding agent; the owner configured an existing project key privately.

## Documentation used

- [Managed OAuth](https://docs.composio.dev/toolkits/managed-auth)
- [Controlling scopes](https://docs.composio.dev/docs/authentication/controlling-scopes)
- [Proxy execution](https://docs.composio.dev/docs/extending-sessions/proxy-execute)
- [TypeScript SDK](https://docs.composio.dev/reference/sdk-reference/typescript/composio)
- [Twitch webhook handling](https://dev.twitch.tv/docs/eventsub/handling-webhook-events/)

## Verification boundary

Unit tests use mock Composio responses, never a project key. Hosted acceptance uses real SQLite transactions and the real world runtime with mocked Twitch HTTP/signatures, not a broadcaster grant. The network-free CLI plan has been run. Real consent, basic-profile read, managed EventSub, two-session real-event propagation and native OBS remain unverified. The owner must invoke the hosted inspection and complete Twitch consent; the managed-event transport proof is still a separate gate; this work does not fix or bypass Twitch 2FA.
