# Integration research

Verified 2026-11-02 against primary documentation and npm metadata. No Twitch app credentials or broadcaster authorization were available in this build environment. These findings establish implementation constraints; they are not evidence of a live Twitch connection.

## Twitch

Use server-side OAuth authorization-code grant with an exact registered callback URI, unpredictable single-use `state`, and server-only client secret, access token, and refresh token. Request only the scopes the implemented adapter needs. [Authentication](https://dev.twitch.tv/docs/authentication/), [OAuth flows](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/), [scope reference](https://dev.twitch.tv/docs/authentication/scopes/).

Validate a maintained OAuth session at startup and hourly with `https://id.twitch.tv/oauth2/validate`. End the Twitch session on invalid authorization. Persist refreshed token data outside source control and avoid logging it. [Token validation](https://dev.twitch.tv/docs/authentication/validate-tokens/).

EventSub WebSocket subscriptions use a **user access token**; webhook subscriptions use an app access token. A lost WebSocket connection requires new subscriptions, and events lost during the outage are not replayed. Twurple should own reconnect handling; report real subscription failures instead of calling an initialized adapter connected. [WebSocket handling](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/).

| Feature | Event / transport | Authorization |
| --- | --- | --- |
| Viewer commands through IRC | Twurple ChatClient | User token: `chat:read`; replies also need `chat:edit` |
| Alternative modern chat receiver | `channel.chat.message` v1 | `user:read:chat`; app-token bot configurations have additional bot permissions |
| New subscription celebration | `channel.subscribe` v1 | Broadcaster `channel:read:subscriptions` |
| Gift/resub celebrations | `channel.subscription.gift` / `.message` v1 | Broadcaster `channel:read:subscriptions` |
| Approved custom reward | `channel.channel_points_custom_reward_redemption.add` v1 | Broadcaster `channel:read:redemptions` or `channel:manage:redemptions` |
| Incoming raid | `channel.raid` v1, `to_broadcaster_user_id` | No event-specific scope; authenticated EventSub transport still required |

A new-subscription event does not include resubscriptions. Restrict Channel Points mapping to configured reward IDs and an action allowlist. Do not interpret reward text or chat as code. [EventSub subscription types](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/).

The IRC and EventSub chat scope names are distinct. Twitch currently recommends EventSub/API for full chat functionality; authenticated IRC remains documented. [IRC concepts](https://dev.twitch.tv/docs/chat/irc/).

### Twurple API compatibility

npm metadata returned version **8.2.0** for `@twurple/auth`, `@twurple/chat`, and `@twurple/eventsub-ws` during research. Keep Twurple package versions aligned. [Repository](https://github.com/twurple/twurple).

- `RefreshingAuthProvider({ clientId, clientSecret })`; register `onRefresh` persistence and call `addUserForToken(tokenData, ['chat'])` for the IRC identity. [Official bot example](https://twurple.js.org/docs/examples/chat/basic-bot.html).
- `new EventSubWsListener({ apiClient })`; `onChannelSubscription(broadcasterId, handler)`, `onChannelRedemptionAdd(broadcasterId, handler)`, and `onChannelRaidTo(broadcasterId, handler)`. These arguments are Twitch **user IDs**, not login names. Resolve names through the API first if necessary. [Listener reference](https://twurple.js.org/reference/eventsub-ws/classes/EventSubWsListener.html), [configuration](https://twurple.js.org/reference/eventsub-ws/interfaces/EventSubWsConfig.html).

## OBS

Use an OBS Browser Source pointed at the running application's `/overlay` route. Set its viewport to 1920 × 1080 and 30 FPS to start. Browser Source loads URLs and supplies transparent body CSS by default. The application's HTML/root backgrounds and WebGL canvas must also preserve alpha; a Three scene background must be absent in transparent mode. Validate using an alpha screenshot or a colored background behind the source. [OBS Browser Source](https://obsproject.com/kb/browser-source).

OBS WebSocket is remote control, not required to render a browser source. The 5.x server defaults to port 4455 and has an authentication protocol. Leave direct controls out of this slice unless the streamer explicitly opts in. [Official repository and protocol](https://github.com/obsproject/obs-websocket).

## Real-time transport decision

Colyseus provides rooms, authentication, lifecycle handling, and synchronized schema state. Its current docs describe v0.18. It is a good migration destination for sharded worlds, matchmaking, and efficient state patches. [Repository](https://github.com/colyseus/colyseus), [documentation](https://docs.colyseus.io/).

**Recommendation for this time box:** a small `ws` adapter around one authoritative `WorldRuntime`, with validated allowlisted messages, server-side permissions/cooldowns, event IDs, bounded history, snapshot delivery on reconnect, and heartbeat/backpressure handling. This avoids adding a second state schema while integrating an independently developed engine. This is a project-specific judgment, not a Colyseus limitation. [ws repository](https://github.com/websockets/ws).

Keep normalized `WorldEvent` and `WorldSnapshot` independent of the transport. A future Colyseus room can own the same runtime: authenticate on join, dispatch validated events on message, broadcast authoritative snapshots/state patches, and persist on room lifecycle checkpoints. Do not claim horizontal scalability, durable always-on service, or multiplayer persistence until deployed and tested.

## 3D package compatibility

React Three Fiber **9** pairs with React **19**; Fiber 8 pairs with React 18. [Official installation guide](https://r3f.docs.pmnd.rs/getting-started/installation).

npm `@react-three/rapier@2` peer metadata requires React `^19`, Fiber `^9.0.4`, and Three `>=0.159.0`. Pin compatible major versions together and verify the actual lockfile install. Physics is optional for this society slice; avoid introducing WASM startup cost without a concrete interaction that needs it. [Rapier integration repository](https://github.com/pmndrs/react-three-rapier).
