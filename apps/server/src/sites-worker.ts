/** Sites/Cloudflare adapter. One shared engine, durable D1 state, HTTP polling.
 * Public reads; writes require Sites identity, and Director access requires the owner email.
 * Simulation advances during active requests; no always-on or live Twitch claim.
 */
import {
  handleHostedTwitch,
  hostedTwitchStatus,
  maintainHostedTwitch,
  twitchOwnerAllowed,
  type HostedTwitchEnv,
} from "./sites-twitch.js";
import { createWorldRuntime } from "@hello-world/world-engine/runtime";
import type {
  ClientMessage,
  DirectorSettings,
  ServerMessage,
  WorldEvent,
  WorldSnapshot,
} from "@hello-world/contracts";
import {
  cleanText,
  parseClientMessage,
  parseEvent,
  parseSnapshot,
} from "./validation.js";

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
interface D1Database {
  prepare(query: string): D1Statement;
}
interface WorkerEnv extends HostedTwitchEnv {
  WORLD_DB: D1Database;
  ASSETS: { fetch(request: Request): Promise<Response> };
  DIRECTOR_OWNER_EMAIL?: string;
  WORLD_ID?: string;
}
interface WorldRow {
  id: string;
  snapshot_json: string;
  settings_json: string;
  pending_json: string;
  limits_json: string;
  revision: number;
  updated_at: number;
}
interface ActorLimit {
  window: number;
  count: number;
  last: number;
}
interface WorldData {
  snapshot: WorldSnapshot;
  settings: DirectorSettings;
  pending: WorldEvent[];
  limits: Record<string, ActorLimit>;
}
const DEFAULT_SETTINGS: DirectorSettings = {
  approvalRequired: false,
  cooldownSeconds: 2,
  maxResidents: 50,
  paused: false,
};
const PRIVILEGED = new Set(["weather", "confetti", "raid"]);
const APPROVAL = new Set(["chat", "wave", "dance", "gift", "social"]);
const PAYLOADS: Record<string, string[]> = {
  join: ["appearance", "personality"],
  chat: [],
  wave: [],
  dance: [],
  gift: ["amount"],
  social: ["action"],
  weather: ["weather"],
  confetti: ["action", "color", "amount"],
  raid: ["amount"],
  custom: ["action", "appearance"],
};
class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
const json = (value: unknown, status = 200, cookie?: string) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...(cookie ? { "Set-Cookie": cookie } : {}),
    },
  });
async function siteIdentity(request: Request): Promise<string> {
  // Supplied/overwritten by the Sites access gateway; never trust actor IDs in JSON.
  const userId = request.headers.get("oai-authenticated-user-id");
  if (!userId || userId.length > 256)
    throw new ApiError(
      "Sign in with ChatGPT to join or change this world.",
      401,
    );
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId)),
  );
  return `viewer:site:${Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
async function isWorldDirector(request: Request, env: WorkerEnv, actor: string | null | undefined) {
  const owner = env.DIRECTOR_OWNER_EMAIL?.trim().toLowerCase();
  const signedInEmail = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  return Boolean(actor && owner && signedInEmail === owner && await twitchOwnerAllowed(env, actor));
}
async function getWorld(env: WorkerEnv): Promise<WorldRow> {
  const worldId = env.WORLD_ID || "hello-neighborhood";
  let row = await env.WORLD_DB.prepare("SELECT * FROM worlds WHERE id = ?")
    .bind(worldId)
    .first<WorldRow>();
  if (!row) {
    const runtime = createWorldRuntime({
      worldId,
      seedResidents: true,
      autoTick: false,
      ingressCooldowns: false,
    });
    const snapshot = runtime.getSnapshot();
    runtime.dispose();
    await env.WORLD_DB.prepare(
      "INSERT OR IGNORE INTO worlds (id, snapshot_json, settings_json, pending_json, limits_json, revision, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
    )
      .bind(
        worldId,
        JSON.stringify(snapshot),
        JSON.stringify(DEFAULT_SETTINGS),
        "[]",
        "{}",
        Date.now(),
      )
      .run();
    row = await env.WORLD_DB.prepare("SELECT * FROM worlds WHERE id = ?")
      .bind(worldId)
      .first<WorldRow>();
  }
  if (!row)
    throw new ApiError("The hosted world could not be initialized.", 503);
  return row;
}
async function requestLimit(
  env: WorkerEnv,
  worldId: string,
  viewerId: string,
  now: number,
) {
  const result = await env.WORLD_DB.prepare(
    `INSERT INTO world_sessions (world_id, id, last_seen, request_window, request_count) VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(world_id, id) DO UPDATE SET last_seen = excluded.last_seen,
      request_count = CASE WHEN world_sessions.request_window <= excluded.last_seen - 60000 THEN 1 ELSE world_sessions.request_count + 1 END,
      request_window = CASE WHEN world_sessions.request_window <= excluded.last_seen - 60000 THEN excluded.last_seen ELSE world_sessions.request_window END
    WHERE world_sessions.request_window <= excluded.last_seen - 60000 OR world_sessions.request_count < 120`,
  )
    .bind(worldId, viewerId, now, now)
    .run();
  if (!result.meta?.changes)
    throw new ApiError("Request limit reached. Try again in a minute.", 429);
}
function validateAction(event: WorldEvent, data: WorldData, director: boolean) {
  if (!event.actorDisplayName.trim())
    throw new ApiError("Choose a display name before joining.");
  if (PRIVILEGED.has(event.kind) && !director)
    throw new ApiError("Director access is required for world events.", 403);
  if (
    Object.keys(event.payload || {}).some(
      (key) => !PAYLOADS[event.kind]?.includes(key),
    )
  )
    throw new ApiError("Payload does not match this world action.");
  if (data.settings.paused && !director)
    throw new ApiError("Viewer interactions are paused by the Director.");
  const resident = data.snapshot.residents.find(
    (value) => value.id === event.actorId,
  );
  if (event.kind === "join") {
    if (
      !resident &&
      data.snapshot.residents.length >= Math.min(50, data.settings.maxResidents)
    )
      throw new ApiError("This neighborhood is full.");
  } else if (!PRIVILEGED.has(event.kind) && !resident)
    throw new ApiError("Join the neighborhood before interacting.");
  if (event.kind === "weather" && !event.payload?.weather)
    throw new ApiError("Choose an approved weather preset.");
  if (
    event.kind === "custom" &&
    (event.payload?.action !== "update-avatar" || !event.payload.appearance)
  )
    throw new ApiError("Only avatar updates are supported as custom actions.");
  if (event.kind === "chat" && !event.text)
    throw new ApiError("Say something before sending.");
  if (
    event.kind === "social" &&
    event.payload?.action &&
    !["greet", "compliment", "befriend"].includes(event.payload.action)
  )
    throw new ApiError("Choose an approved social action.");
  if (
    event.kind === "confetti" &&
    event.payload?.action &&
    event.payload.action !== "celebrate"
  )
    throw new ApiError("Choose an approved celebration action.");
  if (event.kind === "gift" && !event.targetId)
    throw new ApiError("Choose a resident to receive your gift.");
  if (
    event.targetId &&
    !data.snapshot.residents.some((value) => value.id === event.targetId)
  )
    throw new ApiError("That resident is no longer in this world.");
  if (event.targetId === event.actorId)
    throw new ApiError("Choose another resident.");
}
async function mutate(
  env: WorkerEnv,
  viewerId: string,
  director: boolean,
  message?: ClientMessage,
  trusted?: { event: WorldEvent; system: boolean },
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await getWorld(env);
    const now = Date.now();
    const data: WorldData = {
      snapshot: parseSnapshot(JSON.parse(row.snapshot_json)),
      settings: JSON.parse(row.settings_json),
      pending: JSON.parse(row.pending_json),
      limits: JSON.parse(row.limits_json),
    };
    let runtime = createWorldRuntime({
      worldId: row.id,
      initialSnapshot: data.snapshot,
      seedResidents: false,
      autoTick: false,
      ingressCooldowns: false,
    });
    let changed = false;
    let updatedAt = row.updated_at;
    try {
      if (now - row.updated_at >= 500) {
        runtime.tick(Math.min(2, Math.max(0, now - row.updated_at) / 1000));
        data.snapshot = runtime.getSnapshot();
        changed = true;
        updatedAt = now;
      }
      if (message) {
        if (
          message.type !== "event" &&
          message.type !== "director-auth" &&
          !director
        )
          throw new ApiError("Director access is required.", 403);
        if (message.type === "director-auth") {
          if (!director)
            throw new ApiError(
              "Hosted Director controls are disabled for this audience.",
              403,
            );
        } else if (message.type === "director-settings")
          data.settings = { ...data.settings, ...message.settings };
        else if (message.type === "reset") {
          runtime.dispose();
          runtime = createWorldRuntime({
            worldId: row.id,
            seedResidents: true,
            autoTick: false,
            ingressCooldowns: false,
          });
          data.pending = [];
          data.limits = {};
          data.snapshot = runtime.getSnapshot();
          updatedAt = now;
        } else if (message.type === "approve" || message.type === "reject") {
          const pending = data.pending.find(
            (value) => value.id === message.eventId,
          );
          if (!pending)
            throw new ApiError(
              "This interaction is no longer awaiting approval.",
            );
          data.pending = data.pending.filter(
            (value) => value.id !== message.eventId,
          );
          if (message.type === "approve") {
            validateAction(pending, data, false);
            runtime.dispatch(parseEvent(pending));
          }
        } else if (message.type === "event") {
          const submitted = message.event;
          const existing = data.snapshot.residents.find(
            (value) => value.id === viewerId,
          );
          const demoActor =
            director &&
            submitted.source === "demo" &&
            /^demo:[\w-]{1,40}$/.test(submitted.actorId);
          const event = trusted
            ? parseEvent(trusted.event)
            : parseEvent({
                ...submitted,
                id: `browser:${crypto.randomUUID()}`,
                timestamp: now,
                source:
                  director && submitted.source === "demo" ? "demo" : "viewer",
                actorId: demoActor ? submitted.actorId : viewerId,
                actorDisplayName:
                  demoActor || submitted.kind === "join"
                    ? cleanText(submitted.actorDisplayName)
                    : existing?.displayName || "Visitor",
                text:
                  submitted.text === undefined
                    ? undefined
                    : cleanText(submitted.text),
              });
          if (trusted && trusted.event.source !== "twitch")
            throw new ApiError("Untrusted adapter source.", 403);
          if (
            trusted &&
            (data.snapshot.eventHistory.some((item) => item.id === event.id) ||
              data.pending.some((item) => item.id === event.id))
          )
            return { row, data };
          const previous = data.limits[viewerId];
          const limit =
            previous && now - previous.window < 60000
              ? { ...previous }
              : { window: now, count: 0, last: previous?.last || 0 };
          if (limit.count >= 30)
            throw new ApiError(
              "Action rate limit reached. Try again in a minute.",
              429,
            );
          validateAction(event, data, director);
          if (
            !director &&
            event.kind !== "join" &&
            event.kind !== "custom" &&
            now - limit.last < data.settings.cooldownSeconds * 1000
          )
            throw new ApiError(
              `Actions have a ${data.settings.cooldownSeconds}s cooldown.`,
              429,
            );
          limit.count++;
          if (event.kind !== "join" && event.kind !== "custom")
            limit.last = now;
          data.limits[viewerId] = limit;
          for (const [id, entry] of Object.entries(data.limits))
            if (now - entry.window > 60000 && now - entry.last > 60000)
              delete data.limits[id];
          if (
            !director &&
            data.settings.approvalRequired &&
            APPROVAL.has(event.kind)
          ) {
            if (data.pending.length >= 100)
              throw new ApiError("The approval queue is full.");
            data.pending.push(event);
          } else runtime.dispatch(event);
        }
        changed = true;
      }
      data.snapshot = runtime.getSnapshot();
      if (!changed) return { row, data };
      const result = await env.WORLD_DB.prepare(
        "UPDATE worlds SET snapshot_json = ?, settings_json = ?, pending_json = ?, limits_json = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?",
      )
        .bind(
          JSON.stringify(data.snapshot),
          JSON.stringify(data.settings),
          JSON.stringify(data.pending),
          JSON.stringify(data.limits),
          updatedAt,
          row.id,
          row.revision,
        )
        .run();
      if (result.meta?.changes)
        return {
          row: { ...row, revision: row.revision + 1, updated_at: updatedAt },
          data,
        };
    } finally {
      runtime.dispose();
    }
  }
  throw new ApiError("The world is busy. Please try your action again.", 409);
}
export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      // Sites' asset host does not apply Vite's history fallback to deep links.
      // Serve the same app entry while retaining the browser's selected route.
      if (["/world", "/director", "/overlay"].includes(url.pathname.replace(/\/$/, ""))) {
        const entry = new URL(request.url);
        // Fetch the canonical asset root: /index.html can redirect to / on the
        // public asset host, which would otherwise discard the selected route.
        entry.pathname = "/";
        entry.search = "";
        return env.ASSETS.fetch(new Request(entry, request));
      }
      return env.ASSETS.fetch(request);
    }
    try {
      if (!env.WORLD_DB)
        throw new ApiError(
          "Hosted database binding WORLD_DB is unavailable.",
          503,
        );
      if (url.pathname.startsWith("/api/twitch/")) {
        const webhook = url.pathname === "/api/twitch/webhook";
        const actor = webhook ? undefined : await siteIdentity(request);
        if (actor)
          await requestLimit(
            env,
            env.WORLD_ID || "hello-neighborhood",
            actor,
            Date.now(),
          );
        return handleHostedTwitch(
          request,
          env,
          actor,
          await isWorldDirector(request, env, actor),
          {
            getSnapshot: async () =>
              parseSnapshot(JSON.parse((await getWorld(env)).snapshot_json)),
            dispatch: async (event, system) => {
              try {
                await mutate(
                  env,
                  event.actorId,
                  system,
                  { type: "event", event },
                  { event, system },
                );
              } catch (error) {
                if (
                  !(error instanceof ApiError) ||
                  error.status >= 500 ||
                  error.status === 409
                )
                  throw error;
              }
            },
          },
        );
      }
      const known = [
        "/api/status",
        "/api/snapshot",
        "/api/messages",
        "/api/health",
      ];
      if (!known.includes(url.pathname))
        throw new ApiError("API route not found.", 404);
      if (
        request.method !== "GET" &&
        !(request.method === "POST" && url.pathname === "/api/messages")
      )
        throw new ApiError("Method not allowed.", 405);
      if (url.pathname === "/api/messages" && request.method !== "POST")
        throw new ApiError("Use POST to send world actions.", 405);
      if (
        request.method === "POST" &&
        request.headers.get("Origin") !== url.origin
      )
        throw new ApiError("Origin is not allowed.", 403);
      const viewerId = request.headers.get("oai-authenticated-user-id")
        ? await siteIdentity(request)
        : null;
      if (request.method === "POST" && !viewerId)
        throw new ApiError("Sign in with ChatGPT to join or change this world.", 401);
      const initial = await getWorld(env);
      if (viewerId) await requestLimit(env, initial.id, viewerId, Date.now());
      let message: ClientMessage | undefined;
      if (request.method === "POST") {
        const body = await request.text();
        if (body.length > 8192)
          throw new ApiError("Request is too large.", 413);
        try {
          message = parseClientMessage(JSON.parse(body));
        } catch {
          throw new ApiError(
            "Invalid request. Only approved world actions are accepted.",
          );
        }
      }
      const director = await isWorldDirector(request, env, viewerId);
      if (director) await maintainHostedTwitch(env);
      const twitchStatus = await hostedTwitchStatus(env);
      const { row, data } =
        url.pathname === "/api/status" || url.pathname === "/api/health"
          ? {
              row: initial,
              data: {
                snapshot: parseSnapshot(JSON.parse(initial.snapshot_json)),
                settings: JSON.parse(initial.settings_json) as DirectorSettings,
                pending: JSON.parse(initial.pending_json) as WorldEvent[],
                limits: {},
              },
            }
          : await mutate(env, viewerId || "public:observer", director, message);
      const presence = await env.WORLD_DB.prepare(
        "SELECT COUNT(*) AS count FROM world_sessions WHERE world_id = ? AND last_seen > ?",
      )
        .bind(row.id, Date.now() - 15000)
        .first<{ count: number }>();
      const status: Extract<ServerMessage, { type: "status" }> = {
        type: "status",
        mode: twitchStatus.mode,
        twitch: twitchStatus.twitch,
        clients: presence?.count || 0,
        settings: data.settings,
        pending: director ? data.pending : [],
        capabilities: {
          transport: "D1-backed HTTP polling",
          ...twitchStatus.capabilities,
        },
      };
      const withSnapshot =
        url.pathname === "/api/snapshot" || url.pathname === "/api/messages";
      const messages: ServerMessage[] = [
        ...(withSnapshot
          ? [{ type: "snapshot" as const, snapshot: data.snapshot }]
          : []),
        status,
        { type: "director-auth", authorized: director },
      ];
      return json(
        {
          ...status,
          status,
          viewerId: viewerId,
          requiresSignIn: viewerId === null,
          authorized: director,
          directorLocalAllowed: director,
          oauthConfigured: director && twitchStatus.oauthConfigured,
          transport: "polling",
          revision: row.revision,
          ...(withSnapshot ? { snapshot: data.snapshot } : {}),
          messages,
          ...(url.pathname === "/api/health"
            ? {
                ok: true,
                persistence: "D1",
                simulation: "advances during active requests",
              }
            : {}),
        },
        200,
      );
    } catch (error) {
      const known = error instanceof ApiError;
      const message = known
        ? error.message
        : "The hosted world could not complete this request.";
      return json(
        { error: message, messages: [{ type: "error", message }] },
        known ? error.status : 503,
      );
    }
  },
};
