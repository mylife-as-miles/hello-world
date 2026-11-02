# Runtime, transport and persistence

One Node process owns one `@hello-world/world-engine/runtime` instance. The renderer and server share the contracts package. Browser actions and authenticated Twitch events enter one validation/permission pipeline before `runtime.dispatch`. The runtime's authoritative snapshots are broadcast to every connected browser; browsers never independently dispatch received events into another simulation.

## API and WebSocket

- GET `/api/health`: running status, mode, Twitch summary, persistence health.
- GET `/api/status`: a public status snapshot plus `viewerId`, `oauthConfigured`, `capabilities`, and `directorLocalAllowed`; creates a signed HttpOnly session cookie. Pending moderation text is omitted unless a valid `X-Director-Key` is supplied. Actual local Director authorization is reported on the WebSocket, since ordinary same-origin GET requests may not include an Origin header.
- WebSocket `/ws`: requires that cookie and an Origin exactly matching `WEB_ORIGIN`. Supports the shared `ClientMessage`/`ServerMessage` unions from contracts.
- POST `/api/twitch/connect`, GET `/api/twitch/callback`: see [Twitch setup](TWITCH.md).
- Other GET routes serve the built `apps/web/dist` application with SPA fallback, including `/overlay`. Missing asset/API files return errors; paths are constrained to the build directory.

A browser starts with GET status and then opens the socket. Initial messages are snapshot, Director authorization status, and public connection status. Ordinary sessions never receive pending moderation text. A Director sends `{ "type": "director-auth", "key": "..." }`; the server compares a configured secret without accepting query-string secrets. Director keys/tokens are never part of a snapshot.

The server assigns browser actor IDs from the signed session and replaces submitted source, event ID and timestamp. Names can be changed through join; later actions use the resident's bound name. A Director may create synthetic residents under `demo:` IDs. An untrusted browser cannot forge a Twitch resident or simulation source.

## Enforcement

- Strict Zod message/appearance schemas; unknown payload keys rejected, per-action payload allowlists.
- Maximum 8 KiB WebSocket frames; no binary actions; inbound frame and message limits.
- 30 accepted action attempts per actor per minute, configurable 0–60 second viewer cooldown.
- 120 messages per minute, five Director login attempts per minute, bounded HTTP/upgrade traffic.
- Maximum 100 connections, 100 pending approvals and 50 residents.
- Weather/confetti/raid, reset, settings and approval decisions require Director permission.
- Viewer interaction pause gates actions; it does not stop the engine's simulation clock.
- Optional approval holds chat/wave/dance/gift/social until a Director approves; joins and appearance edits remain available.
- Duplicate trusted event IDs are bounded/deduplicated before dispatch; renderer runtime also deduplicates.
- A heartbeat terminates dead sockets; slow clients with over 2 MiB queued output are disconnected and can reconnect to a fresh snapshot.

## What persists

The server writes complete engine snapshots to `.data/world.json` using a temporary file and atomic rename. Saves are coalesced over 750 ms and flushed during graceful SIGINT/SIGTERM shutdown. Resident appearances, relationships, weather, simulation time and bounded event history survive a browser refresh and a tested server restart. The `.data/session-key` keeps browser identities stable across server restarts. Keep these files together and back them up. Save failure is visible in `/api/health`; invalid/cross-world persisted snapshots stop startup instead of silently overwriting data.

The browser also caches the latest authoritative snapshot in IndexedDB/Dexie for startup/disconnection display. Cached snapshots are visual only; offline actions are not accepted or queued. Reconnection receives current server state.

This is local-disk persistence for a single server process. It is not a hosted always-on service, multi-region storage, historical replay archive, distributed simulation, or authenticated global account system. The simulation runs while the Node process runs; no offline catch-up claim is made. A sudden process/host crash can lose the current coalescing window. Director settings and unapproved interaction queues are transient.

## Running

```sh
cp .env.example .env
pnpm install
pnpm dev
```

Open the exact `WEB_ORIGIN` (default `http://localhost:5173`). For a built single-process run:

```sh
pnpm build
WEB_ORIGIN=http://localhost:3001 pnpm start
```

The environment variables on the command take precedence over `.env`. Keep server secrets out of every `VITE_` variable.

## Colyseus migration

[Colyseus](https://github.com/colyseus/colyseus) was researched, then a small `ws` adapter was chosen to preserve one existing runtime/snapshot model within the integration time box. To migrate, let a Colyseus Room own a `WorldRuntime`, move current signed-session/Director authentication into room authentication, route room messages through the same validation/policy boundary, broadcast or patch the shared snapshot, and persist on room lifecycle checkpoints. Contracts and renderer props can remain stable. Horizontal room allocation, shared storage and cross-process identity would need additional implementation and testing.

## Verification

`pnpm --filter @hello-world/server test` exercises actual local HTTP/WebSocket connections, stable signed identities, forged-source rejection, Director permissions, cooldown/approval, two-client fanout, snapshot persistence/restart, OAuth state binding and safe SPA serving using an isolated runtime fixture. Command normalization/reward allowlists are tested independently. These tests do not substitute for live Twitch credentials or OBS-host testing.
