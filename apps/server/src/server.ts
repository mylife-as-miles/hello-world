import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { ServerMessage } from "@hello-world/contracts";
import type { ServerConfig } from "./config.js";
import {
  SessionStore,
  SlidingLimit,
  allowedOrigin,
  isLocalDirector,
  secretEquals,
} from "./security.js";
import { SnapshotStore } from "./persistence.js";
import { WorldRoom } from "./room.js";
import type { Peer, RuntimeFactory } from "./room.js";
import { TwitchAdapter, TWITCH_SCOPES } from "./twitch.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".wasm": "application/wasm",
};
const DEFAULT_WEB_DIR = fileURLToPath(
  new URL("../../web/dist", import.meta.url),
);
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}
export interface AppOptions {
  twitchEnv?: NodeJS.ProcessEnv;
  webDir?: string;
}
export async function createWorldServer(
  config: ServerConfig,
  factory: RuntimeFactory,
  options: AppOptions = {},
) {
  const sessions = new SessionStore(config.dataDir);
  const store = new SnapshotStore(config.dataDir, config.worldId);
  const restored = await store.load();
  const runtime = factory({
    worldId: config.worldId,
    initialSnapshot: restored,
    seedResidents: !restored,
    autoTick: true,
  });
  const room = new WorldRoom({
    runtime,
    factory,
    worldId: config.worldId,
    directorKey: config.directorKey,
    settings: config.settings,
    store,
  });
  const twitch = new TwitchAdapter(room, config.dataDir, options.twitchEnv);
  const httpLimit = new SlidingLimit(120, 60_000);
  const authLimit = new SlidingLimit(5, 60_000);
  const states = new Map<string, { viewerId: string; createdAt: number }>();
  const webDir = resolve(options.webDir || DEFAULT_WEB_DIR);
  const server = createServer((req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    void handleHttp(req, res).catch(() => {
      if (!res.headersSent)
        json(res, 500, { error: "Request could not be completed" });
      else res.end();
    });
  });
  async function handleHttp(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url || "/", "http://localhost");
    const address = req.socket.remoteAddress || "unknown";
    if (url.pathname.startsWith("/api/")) {
      if (!httpLimit.allow(address))
        return json(res, 429, { error: "Request limit reached" });
      if (req.method === "GET" && url.pathname === "/api/health")
        return json(res, 200, {
          ok: true,
          mode: room.mode,
          twitch: room.twitch,
          persistence: { lastSavedAt: store.lastSavedAt, error: store.error },
        });
      if (req.method === "GET" && url.pathname === "/api/status") {
        const viewerId = sessions.ensure(req, res);
        const header = req.headers["x-director-key"];
        const isDirector =
          typeof header === "string" &&
          secretEquals(header, config.directorKey);
        return json(res, 200, {
          ...room.status(),
          pending: isDirector ? room.status().pending : [],
          viewerId,
          directorLocalAllowed: isLocalDirector(req, config),
          capabilities: room.capabilities,
          oauthConfigured: twitch.oauthConfigured,
        });
      }
      if (req.method === "POST" && url.pathname === "/api/twitch/connect") {
        if (!allowedOrigin(req, config))
          return json(res, 403, { error: "Origin is not allowed" });
        const viewerId = sessions.read(req);
        if (!viewerId || !authLimit.allow(viewerId))
          return json(res, 429, {
            error: "Open the world first, or try again in a minute",
          });
        const header = req.headers["x-director-key"];
        if (
          !isLocalDirector(req, config) &&
          !(
            typeof header === "string" &&
            secretEquals(header, config.directorKey)
          )
        )
          return json(res, 403, {
            error: "Director authentication is required to connect Twitch",
          });
        if (!twitch.oauthConfigured)
          return json(res, 503, {
            error:
              "Configure TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET and a registered TWITCH_REDIRECT_URI ending /api/twitch/callback (HTTPS, or HTTP localhost) on the server first",
          });
        for (const [state, value] of states)
          if (Date.now() - value.createdAt > 10 * 60_000) states.delete(state);
        if (states.size >= 100)
          return json(res, 429, {
            error: "Too many pending authorization attempts",
          });
        const state = randomBytes(32).toString("base64url");
        states.set(state, { viewerId, createdAt: Date.now() });
        const authorize = new URL("https://id.twitch.tv/oauth2/authorize");
        authorize.search = new URLSearchParams({
          client_id: twitch.clientId,
          redirect_uri: twitch.redirectUri,
          response_type: "code",
          scope: TWITCH_SCOPES.join(" "),
          state,
          force_verify: "true",
        }).toString();
        return json(res, 200, { authorizeUrl: authorize.toString() });
      }
      if (req.method === "GET" && url.pathname === "/api/twitch/callback") {
        const state = url.searchParams.get("state") || "";
        const attempt = states.get(state);
        states.delete(state);
        if (
          !attempt ||
          attempt.viewerId !== sessions.read(req) ||
          Date.now() - attempt.createdAt > 10 * 60_000
        )
          return json(res, 403, {
            error:
              "Authorization expired or state did not match. Start again from Director Studio.",
          });
        const code = url.searchParams.get("code");
        if (!code || code.length > 2048 || url.searchParams.has("error"))
          return json(res, 400, { error: "Twitch authorization was declined" });
        try {
          await twitch.authorize(code);
          res.writeHead(303, {
            Location: `${config.webOrigin}/director?twitch=connected`,
            "Cache-Control": "no-store",
          });
          res.end();
        } catch {
          json(res, 400, {
            error:
              "Twitch connection failed. Check registered callback and broadcaster settings.",
          });
        }
        return;
      }
      return json(res, 404, { error: "API route not found" });
    }
    if (!["GET", "HEAD"].includes(req.method || ""))
      return json(res, 405, { error: "Method not allowed" });
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return json(res, 400, { error: "Invalid path" });
    }
    if (pathname.includes("\0") || pathname.includes("\\"))
      return json(res, 400, { error: "Invalid path" });
    let target = resolve(webDir, `.${pathname}`);
    if (target !== webDir && !target.startsWith(`${webDir}${sep}`))
      return json(res, 403, { error: "Invalid path" });
    let file;
    try {
      file = await stat(target);
    } catch {
      /* SPA route below. */
    }
    if (!file?.isFile()) {
      if (extname(pathname) && pathname !== "/")
        return json(res, 404, { error: "File not found" });
      target = resolve(webDir, "index.html");
      try {
        file = await stat(target);
      } catch {
        return json(res, 503, {
          error:
            "Web build unavailable. Run pnpm build, or use Vite on port 5173.",
        });
      }
    }
    const type = MIME[extname(target)] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": file.size,
      "Cache-Control": type.startsWith("text/html")
        ? "no-store"
        : "public, max-age=3600",
    });
    if (req.method === "HEAD") res.end();
    else
      createReadStream(target)
        .on("error", () => res.destroy())
        .pipe(res);
  }
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 8192,
    perMessageDeflate: false,
  });
  const peers = new Map<WebSocket, Peer>();
  const alive = new WeakSet<WebSocket>();
  const ingressLimit = new SlidingLimit(120, 60_000);
  server.on("upgrade", (req, socket, head) => {
    const reject = (code: number, reason: string) => {
      socket.end(`HTTP/1.1 ${code} ${reason}\r\nConnection: close\r\n\r\n`);
    };
    if (new URL(req.url || "/", "http://localhost").pathname !== "/ws")
      return reject(404, "Not Found");
    if (!allowedOrigin(req, config)) return reject(403, "Forbidden");
    const viewerId = sessions.read(req);
    if (!viewerId) return reject(401, "Open World First");
    if (
      wss.clients.size >= config.maxConnections ||
      !httpLimit.allow(req.socket.remoteAddress || "unknown")
    )
      return reject(429, "Too Many Requests");
    wss.handleUpgrade(req, socket, head, (ws) => {
      alive.add(ws);
      const peer: Peer = {
        id: randomUUID(),
        viewerId,
        director: isLocalDirector(req, config),
        send(message: ServerMessage) {
          if (ws.readyState !== WebSocket.OPEN) return;
          if (ws.bufferedAmount > 2 * 1024 * 1024) {
            ws.close(1013, "Connection is too slow");
            return;
          }
          ws.send(JSON.stringify(message));
        },
      };
      peers.set(ws, peer);
      room.add(peer);
      ws.on("pong", () => alive.add(ws));
      ws.on("message", (data, isBinary) => {
        if (!ingressLimit.allow(peer.id)) {
          ws.close(1008, "Request rate limit reached");
          return;
        }
        if (isBinary) {
          peer.send({
            type: "error",
            message: "Only JSON text requests are accepted",
          });
          return;
        }
        try {
          room.receive(peer, JSON.parse(data.toString()));
        } catch {
          peer.send({ type: "error", message: "Invalid JSON request" });
        }
      });
      ws.on("error", () => {
        /* Close handler removes peer; never log user payloads. */
      });
      ws.on("close", () => {
        peers.delete(ws);
        room.remove(peer.id);
      });
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, 30_000);
  heartbeat.unref();
  return {
    server,
    wss,
    room,
    store,
    twitch,
    async start() {
      await new Promise<void>((resolveStart, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => {
          server.removeListener("error", reject);
          resolveStart();
        });
      });
      void twitch.start();
      return server.address();
    },
    async close() {
      clearInterval(heartbeat);
      await twitch.stop();
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolveClose) =>
        wss.close(() => resolveClose()),
      );
      await room.close();
      if (server.listening)
        await new Promise<void>((resolveClose, reject) =>
          server.close((error) => (error ? reject(error) : resolveClose())),
        );
    },
  };
}
