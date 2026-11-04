/** Sites/Cloudflare adapter. One shared engine, durable D1 state, HTTP polling.
 * Public reads; viewers authenticate with Twitch and each streamer owns a world.
 * Simulation advances during active requests; no always-on or live Twitch claim.
 */
import {
  handleHostedTwitch,
  hostedTwitchStatus,
  maintainHostedTwitch,
  twitchOwnerAllowed,
  verifyTwitchWebhook,
  type HostedTwitchEnv,
} from "./sites-twitch.js";
import { createWorldRuntime } from "@hello-world/world-engine/runtime";
import { handleHostedComposio, type HostedComposioEnv } from "./sites-composio.js";
import { handleTwitchLogin, resolveTwitchSession, publicTwitchLoginReady, type TwitchLoginEnv } from "./twitch-login.js";
import { conditionKey } from "./twitch-subscriptions.js";
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
  batch?(statements: D1Statement[]): Promise<Array<{ meta?: { changes?: number } }>>;
}
interface WorkerEnv extends HostedTwitchEnv, HostedComposioEnv, TwitchLoginEnv {
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
async function authEnvironment(env: WorkerEnv): Promise<WorkerEnv> {
  if (env.AUTH_SESSION_SECRET || !env.TWITCH_TOKEN_ENCRYPTION_KEY) return env;
  // A distinct derived key keeps browser sessions independent of token encryption.
  try {
    const raw = Uint8Array.from(atob(env.TWITCH_TOKEN_ENCRYPTION_KEY), c => c.charCodeAt(0));
    if (raw.length !== 32) return env;
    const key = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("hello-world-auth"), info: new TextEncoder().encode("public-twitch-session-v1") }, key, 256);
    return { ...env, AUTH_SESSION_SECRET: Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, "0")).join("") };
  } catch { return env; }
}
async function isWorldDirector(env: WorkerEnv, actor: string | null | undefined) {
  if (!actor?.startsWith("twitch:")) return false;
  const owner = await env.WORLD_DB.prepare("SELECT twitch_user_id FROM world_owners WHERE world_id=?")
    .bind(env.WORLD_ID || "hello-neighborhood").first<{ twitch_user_id: string }>();
  return Boolean(owner && actor === `twitch:${owner.twitch_user_id}` && await twitchOwnerAllowed(env, actor));
}
async function selectedWorld(request: Request, env: WorkerEnv): Promise<WorkerEnv> {
  const url = new URL(request.url);
  let selected = url.searchParams.get("world") || env.WORLD_ID || "hello-neighborhood";
  if (url.pathname === "/api/twitch/callback") {
    const state = url.searchParams.get("state") || "";
    if (state.length <= 128) {
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state)));
      const hash = Array.from(digest, b => b.toString(16).padStart(2, "0")).join("");
      const row = await env.WORLD_DB.prepare("SELECT world_id FROM twitch_oauth_states WHERE state_hash=?")
        .bind(hash).first<{ world_id: string }>();
      if (row) selected = row.world_id;
    }
  }
  if (selected !== (env.WORLD_ID || "hello-neighborhood")) {
    if (!/^twitch-\d{1,24}$/.test(selected)) throw new ApiError("World not found.", 404);
    const known = await env.WORLD_DB.prepare("SELECT world_id FROM world_owners WHERE world_id=?").bind(selected).first();
    if (!known) throw new ApiError("This streamer has not opened a world yet.", 404);
  }
  return { ...env, WORLD_ID: selected };
}
async function routeWebhook(request: Request, env: WorkerEnv) {
  const reader = request.body?.getReader(), chunks: Uint8Array[] = []; let size = 0;
  if (reader) while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length;
    if (size > 65536) { await reader.cancel(); throw new ApiError("Webhook body is too large.", 413); } chunks.push(part.value); }
  const raw = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.length; }
  if (!await verifyTwitchWebhook(request, env.TWITCH_WEBHOOK_SECRET || "", raw)) throw new ApiError("Invalid EventSub signature or timestamp.", 403);
  let payload: any; try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
  catch { throw new ApiError("Malformed EventSub payload.", 400); }
  const sub = payload?.subscription;
  const match = await env.WORLD_DB.prepare(`SELECT COUNT(*) AS matches, MIN(world_id) AS world_id FROM twitch_subscriptions
    WHERE subscription_id=? OR (subscription_id IS NULL AND type=? AND version=? AND condition_json=?)`)
    .bind(typeof sub?.id === "string" ? sub.id : "", typeof sub?.type === "string" ? sub.type : "", typeof sub?.version === "string" ? sub.version : "", conditionKey(sub?.condition))
    .first<{ matches: number; world_id: string | null }>();
  if (match?.matches !== 1 || !match.world_id) throw new ApiError("EventSub subscription is not registered for one world.", 403);
  return { request: new Request(request, { body: raw }), env: { ...env, WORLD_ID: match.world_id } };
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
    if (trusted) {
      const receipt = await env.WORLD_DB.prepare("SELECT applied_revision FROM world_ingress WHERE world_id = ? AND event_id = ?")
        .bind(row.id, trusted.event.id).first<{ applied_revision: number }>();
      if (receipt?.applied_revision) return { row, data };
    }
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
      const values = [
          JSON.stringify(data.snapshot),
          JSON.stringify(data.settings),
          JSON.stringify(data.pending),
          JSON.stringify(data.limits),
          updatedAt,
          row.id,
          row.revision,
        ];
      let result: { meta?: { changes?: number } };
      if (trusted) {
        if (!env.WORLD_DB.batch) throw new ApiError("Atomic event storage is unavailable.", 503);
        const token = crypto.randomUUID();
        try {
          // D1 executes a batch in one transaction. The CHECK constraint rolls
          // back the receipt as well as the world if this revision lost its CAS.
          // Thus a crash after commit cannot replay an action after history eviction.
          const results = await env.WORLD_DB.batch([
            env.WORLD_DB.prepare("INSERT OR IGNORE INTO world_ingress (world_id, event_id, commit_token, applied_revision, received_at) VALUES (?, ?, ?, 0, ?)").bind(row.id, trusted.event.id, token, now),
            env.WORLD_DB.prepare("UPDATE worlds SET snapshot_json = ?, settings_json = ?, pending_json = ?, limits_json = ?, revision = revision + 1, updated_at = ?, last_ingress_token = ? WHERE id = ? AND revision = ? AND EXISTS (SELECT 1 FROM world_ingress WHERE world_id = ? AND event_id = ? AND commit_token = ?)")
              .bind(...values.slice(0, 5), token, row.id, row.revision, row.id, trusted.event.id, token),
            env.WORLD_DB.prepare("UPDATE world_ingress SET applied_revision = CASE WHEN (SELECT last_ingress_token FROM worlds WHERE id = ?) = ? THEN ? ELSE -1 END WHERE world_id = ? AND event_id = ? AND commit_token = ?")
              .bind(row.id, token, row.revision + 1, row.id, trusted.event.id, token),
          ]);
          result = results[1];
          if (!result.meta?.changes) {
            const current = await getWorld(env);
            return { row: current, data: { snapshot: parseSnapshot(JSON.parse(current.snapshot_json)), settings: JSON.parse(current.settings_json), pending: JSON.parse(current.pending_json), limits: JSON.parse(current.limits_json) } };
          }
        } catch (error) {
          if (/CHECK constraint failed.*applied_revision/i.test(String(error))) continue;
          throw error;
        }
      } else result = await env.WORLD_DB.prepare(
        "UPDATE worlds SET snapshot_json = ?, settings_json = ?, pending_json = ?, limits_json = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?",
      ).bind(...values).run();
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
  // Hosts with Cron support can invoke this without any Director tab open.
  async scheduled(_controller: unknown, env: WorkerEnv) { await maintainHostedTwitch(env); },
  async fetch(request: Request, env: WorkerEnv, context?: { waitUntil(task: Promise<unknown>): void }): Promise<Response> {
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
      env = await authEnvironment(env);
      if (url.pathname.startsWith("/api/auth/")) return handleTwitchLogin(request, env);
      if (url.pathname === "/api/twitch/webhook" && request.method === "POST") {
        const routed = await routeWebhook(request, env); request = routed.request; env = routed.env;
      } else env = await selectedWorld(request, env);
      const viewer = await resolveTwitchSession(request, env);
      if (url.pathname.startsWith("/api/composio/twitch/")) {
        const actor = viewer?.actorId;
        if (!actor) throw new ApiError("Sign in with Twitch to manage your world.", 401);
        await requestLimit(env, env.WORLD_ID || "hello-neighborhood", actor, Date.now());
        return handleHostedComposio(request, env, actor, await isWorldDirector(env, actor));
      }
      if (url.pathname.startsWith("/api/twitch/")) {
        const webhook = url.pathname === "/api/twitch/webhook";
        const actor = webhook ? undefined : viewer?.actorId;
        if (!webhook && !actor) throw new ApiError("Sign in with Twitch to connect your channel.", 401);
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
          await isWorldDirector(env, actor),
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
                return true;
              } catch (error) {
                if (
                  !(error instanceof ApiError) ||
                  error.status >= 500 ||
                  error.status === 409
                )
                  throw error;
                return false;
              }
            },
          },
          context ? task => context.waitUntil(task) : undefined,
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
      const viewerId = viewer?.actorId || null;
      if (request.method === "POST" && !viewerId)
        throw new ApiError("Sign in with Twitch to create or control your resident.", 401);
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
      const director = await isWorldDirector(env, viewerId);
      // Token health is independent of who is viewing the world.
      await maintainHostedTwitch(env);
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
      const loginConfigured = await publicTwitchLoginReady(request, env);
      const status: Extract<ServerMessage, { type: "status" }> = {
        type: "status",
        mode: twitchStatus.mode,
        twitch: twitchStatus.mode === "live" ? twitchStatus.twitch : viewer ? `Twitch account: ${viewer.displayName} · live channel events not enabled` : "Simulation preview · sign in with Twitch to join or create a world",
        clients: presence?.count || 0,
        settings: data.settings,
        pending: director ? data.pending : [],
        capabilities: {
          transport: "D1-backed HTTP polling",
          ...(twitchStatus.oauthConfigured ? twitchStatus.capabilities : { "channel-events": "Live channel events are not enabled" }),
          "twitch-sign-in": viewer ? `Signed in as ${viewer.login}` : loginConfigured ? "Sign in with Twitch is available" : "Twitch sign-in is being configured",
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
          user: viewer ? { id: viewer.twitchId, login: viewer.login, displayName: viewer.displayName } : null,
          ownWorldId: viewer ? `twitch-${viewer.twitchId}` : null,
          loginConfigured,
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
