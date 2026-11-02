# HELLO WORLD

A livestream-powered neighborhood where your community becomes the cast.

## Run
Node 22+ and pnpm 10+. `pnpm install`, then `pnpm dev`. Open http://localhost:5173. Build: `pnpm build`. Server: http://localhost:3001. Demo Mode is the default until real Twitch credentials are supplied server-side.

## Workspaces
- apps/web: React 19 + TypeScript + Vite application, Director Studio, OBS
- apps/server: Twitch + validated WebSocket event transport
- packages/contracts: shared v1 interfaces
- packages/world-engine: Claude-owned renderer, avatar creator, simulation

See [integration contract](docs/INTEGRATION_CONTRACT.md). This repository is independent; no source/assets from other personal projects.

Initial scaffold; feature verification and detailed operating instructions will be added at integration.
