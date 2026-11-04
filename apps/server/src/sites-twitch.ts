/** Hosted Twitch HTTP OAuth/EventSub adapter. All token handling stays inside Workers/D1. */
import { subscriptionIntent, subscriptionRecord, bindCreatedSubscription, checkWebhookSubscription, markSubscription, deferSubscription, conditionKey } from "./twitch-subscriptions.js";
import type {
  WorldEvent,
  WorldSnapshot,
  Weather,
} from "@hello-world/contracts";
interface Statement {
  bind(...args: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
export interface HostedTwitchEnv {
  WORLD_DB: { prepare(sql: string): Statement };
  WORLD_ID?: string;
  TWITCH_CLIENT_ID?: string;
  TWITCH_CLIENT_SECRET?: string;
  TWITCH_REDIRECT_URI?: string;
  TWITCH_EVENTSUB_CALLBACK?: string;
  TWITCH_WEBHOOK_SECRET?: string;
  TWITCH_TOKEN_ENCRYPTION_KEY?: string;
  TWITCH_BROADCASTER_ID?: string;
  TWITCH_BROADCASTER_NAME?: string;
  TWITCH_REWARD_ACTIONS?: string;
}
interface Account {
  world_id: string;
  owner_actor: string;
  broadcaster_id: string;
  broadcaster_login: string;
  token_cipher: string | null;
  expires_at: number;
  validated_at: number;
  refresh_lock: number;
  capabilities_json: string;
  last_event_at: number;
  last_event_id: string | null;
}
interface Token {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string[];
}
interface TokenInfo {
  client_id: string;
  user_id: string;
  login: string;
  scopes: string[];
  expires_in: number;
}
export interface TwitchDispatch {
  getSnapshot(): Promise<WorldSnapshot>;
  dispatch(event: WorldEvent, system: boolean): Promise<boolean>;
}
export const HOSTED_TWITCH_SCOPES = [
  "user:read:chat",
  "user:bot",
  "channel:bot",
  "channel:read:subscriptions",
  "channel:read:redemptions",
] as const;
const encoder = new TextEncoder();
const world = (env: HostedTwitchEnv) => env.WORLD_ID || "hello-neighborhood";
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const from64 = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (char) =>
    char.charCodeAt(0),
  );
const clean = (text: unknown, max = 180) =>
  typeof text === "string"
    ? text
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim()
        .slice(0, max)
    : "";
export class TwitchHttpError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
async function account(env: HostedTwitchEnv) {
  return env.WORLD_DB.prepare(
    "SELECT * FROM twitch_accounts WHERE world_id = ?",
  )
    .bind(world(env))
    .first<Account>();
}
export async function twitchOwnerAllowed(env: HostedTwitchEnv, actor: string) {
  try {
    const row = await account(env);
    return !row || row.owner_actor === actor;
  } catch (error) {
    // Legacy Demo databases may not yet have migration 0002. Other database
    // failures must not silently grant owner permissions.
    return /no such table.*twitch_accounts/i.test(String(error));
  }
}
function configured(env: HostedTwitchEnv) {
  try {
    const redirect = new URL(env.TWITCH_REDIRECT_URI || "");
    const callback = new URL(env.TWITCH_EVENTSUB_CALLBACK || "");
    const safeUrl = (url: URL) => url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && !url.port;
    return Boolean(
      env.TWITCH_CLIENT_ID &&
      env.TWITCH_CLIENT_SECRET &&
      env.TWITCH_REDIRECT_URI &&
      safeUrl(redirect) && redirect.pathname === "/api/twitch/callback" &&
      env.TWITCH_EVENTSUB_CALLBACK &&
      safeUrl(callback) &&
      env.TWITCH_WEBHOOK_SECRET &&
      env.TWITCH_WEBHOOK_SECRET.length >= 32 &&
      env.TWITCH_WEBHOOK_SECRET.length <= 100 &&
      env.TWITCH_TOKEN_ENCRYPTION_KEY &&
      from64(env.TWITCH_TOKEN_ENCRYPTION_KEY).length === 32,
    );
  } catch {
    return false;
  }
}
export async function hostedTwitchStatus(env: HostedTwitchEnv) {
  let row: Account | null = null;
  try {
    row = await account(env);
  } catch {
    /* Old Demo migration remains readable until hosted Twitch migration is applied. */
  }
  const capabilities: Record<string, string> = row
    ? JSON.parse(row.capabilities_json)
    : {};
  if (!configured(env))
    capabilities.authorization =
      "server app credentials, encryption key and public webhook callback required";
  capabilities["world-events"] = row?.last_event_at ? "A signed Twitch notification changed the authoritative world" : "No Twitch world event verified yet";
  let registered = 0;
  if (row?.broadcaster_id) {
    try {
      const count = await env.WORLD_DB.prepare("SELECT COUNT(*) AS count FROM twitch_subscriptions WHERE world_id = ? AND status = 'enabled' AND (json_extract(condition_json, '$.broadcaster_user_id') = ? OR json_extract(condition_json, '$.to_broadcaster_user_id') = ?)")
        .bind(world(env), row.broadcaster_id, row.broadcaster_id).first<{ count: number }>();
      registered = count?.count || 0;
    } catch { /* A missing migration never counts as live. */ }
  }
  const live = Boolean(
    row?.token_cipher &&
    capabilities.authorization?.startsWith("authorized ") &&
    Date.now() - row.validated_at < 3600000 && row.expires_at > Date.now() && registered > 0 && row.last_event_at > 0,
  );
  return {
    oauthConfigured: configured(env),
    mode: live ? ("live" as const) : ("demo" as const),
    twitch: live
      ? `Twitch · ${row?.broadcaster_login} · signed EventSub webhooks`
      : "Demo Mode · Twitch is not connected",
    capabilities,
  };
}
async function capability(env: HostedTwitchEnv, key: string, value: string) {
  await env.WORLD_DB.prepare(
    "UPDATE twitch_accounts SET capabilities_json = json_set(capabilities_json, ?, ?) WHERE world_id = ?",
  )
    .bind(`$."${key.replace(/[^\w.:-]/g, "")}"`, value, world(env))
    .run();
}
async function encrypt(
  env: HostedTwitchEnv,
  token: Token,
  broadcaster: string,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    from64(env.TWITCH_TOKEN_ENCRYPTION_KEY!),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(`${world(env)}:${broadcaster}`),
    },
    key,
    encoder.encode(JSON.stringify(token)),
  );
  return JSON.stringify({ iv: b64(iv), cipher: b64(new Uint8Array(cipher)) });
}
async function decrypt(env: HostedTwitchEnv, row: Account): Promise<Token> {
  const stored = JSON.parse(row.token_cipher!);
  const key = await crypto.subtle.importKey(
    "raw",
    from64(env.TWITCH_TOKEN_ENCRYPTION_KEY!),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  return JSON.parse(
    new TextDecoder().decode(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: from64(stored.iv),
          additionalData: encoder.encode(`${world(env)}:${row.broadcaster_id}`),
        },
        key,
        from64(stored.cipher),
      ),
    ),
  );
}
async function twitchFetch(url: string, init?: RequestInit) {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
}
async function tokenRequest(
  env: HostedTwitchEnv,
  values: Record<string, string>,
): Promise<Token> {
  const result = await twitchFetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID!,
      client_secret: env.TWITCH_CLIENT_SECRET!,
      ...values,
    }),
  });
  if (!result.ok)
    throw new TwitchHttpError(
      "Twitch token exchange failed. Reconnect the broadcaster account.",
      400,
    );
  return result.json() as Promise<Token>;
}
async function validate(
  env: HostedTwitchEnv,
  token: string,
): Promise<TokenInfo> {
  const result = await twitchFetch("https://id.twitch.tv/oauth2/validate", {
    headers: { Authorization: `OAuth ${token}` },
  });
  if (!result.ok)
    throw new TwitchHttpError(
      "Twitch authorization is no longer valid. Reconnect the broadcaster.",
      401,
    );
  const info = (await result.json()) as TokenInfo;
  if (
    info.client_id !== env.TWITCH_CLIENT_ID ||
    !info.user_id ||
    (env.TWITCH_BROADCASTER_ID && info.user_id !== env.TWITCH_BROADCASTER_ID) ||
    (env.TWITCH_BROADCASTER_NAME &&
      info.login.toLowerCase() !== env.TWITCH_BROADCASTER_NAME.toLowerCase())
  )
    throw new TwitchHttpError(
      "Authorize the configured Twitch broadcaster using this application.",
      403,
    );
  return info;
}
async function subscriptions(env: HostedTwitchEnv, info: TokenInfo) {
  const app = await tokenRequest(env, { grant_type: "client_credentials" });
  const scopes = new Set(info.scopes);
  const entries: Array<[string, Record<string, string>, string[]]> = [
    [
      "channel.chat.message",
      { broadcaster_user_id: info.user_id, user_id: info.user_id },
      ["user:read:chat", "user:bot", "channel:bot"],
    ],
    ...[
      "channel.subscribe",
      "channel.subscription.gift",
      "channel.subscription.message",
    ].map(
      (type) =>
        [
          type,
          { broadcaster_user_id: info.user_id },
          ["channel:read:subscriptions"],
        ] as [string, Record<string, string>, string[]],
    ),
    [
      "channel.channel_points_custom_reward_redemption.add",
      { broadcaster_user_id: info.user_id },
      ["channel:read:redemptions"],
    ],
    ["channel.raid", { to_broadcaster_user_id: info.user_id }, []],
  ];
  for (const [type, condition, required] of entries) {
    const missing = required.filter((scope) => !scopes.has(scope));
    if (missing.length) {
      await capability(env, type, `missing ${missing.join(", ")}`);
      await env.WORLD_DB.prepare("UPDATE twitch_subscriptions SET status='disabled', updated_at=? WHERE world_id=? AND type=?")
        .bind(Date.now(), world(env), type).run();
      continue;
    }
    if (!(await subscriptionIntent(env, type, condition))) continue;
    await capability(env, type, "pending verification");
    const result = await twitchFetch(
      "https://api.twitch.tv/helix/eventsub/subscriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${app.access_token}`,
          "Client-Id": env.TWITCH_CLIENT_ID!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type,
          version: "1",
          condition,
          transport: {
            method: "webhook",
            callback: env.TWITCH_EVENTSUB_CALLBACK,
            secret: env.TWITCH_WEBHOOK_SECRET,
          },
        }),
      },
    );
    if (result.status === 429 || result.status >= 500) {
      const retryAt = await deferSubscription(env, type, result);
      await capability(env, type, `subscription retry after ${new Date(retryAt).toISOString()}`);
      continue;
    }
    if (result.status === 409) {
      const existing = await twitchFetch(`https://api.twitch.tv/helix/eventsub/subscriptions?type=${encodeURIComponent(type)}`, {
        headers: { Authorization: `Bearer ${app.access_token}`, "Client-Id": env.TWITCH_CLIENT_ID! },
      });
      const body = existing.ok ? await existing.json() as { data?: any[] } : {};
      const match = body.data?.find(sub => sub.version === "1" && conditionKey(sub.condition) === conditionKey(condition) && sub.transport?.method === "webhook" && sub.transport.callback === env.TWITCH_EVENTSUB_CALLBACK);
      if (match) {
        const row = await bindCreatedSubscription(env, type, match);
        await capability(env, type, row.status === "enabled" ? "enabled" : "pending verification");
      } else await capability(env, type, "existing subscription could not be verified");
    } else if (result.ok) {
      const body = await result.json() as { data?: unknown[] };
      const row = await bindCreatedSubscription(env, type, body.data?.[0]);
      await capability(env, type, row.status === "enabled" ? "enabled" : "pending verification");
    } else await capability(env, type, `subscription failed (HTTP ${result.status})`);
  }
}
export async function maintainHostedTwitch(env: HostedTwitchEnv) {
  if (!configured(env)) return;
  const row = await account(env);
  if (
    !row?.token_cipher ||
    (Date.now() - row.validated_at < 3600000 &&
      row.expires_at - Date.now() > 120000)
  )
    return;
  const lock = await env.WORLD_DB.prepare(
    "UPDATE twitch_accounts SET refresh_lock = ? WHERE world_id = ? AND refresh_lock < ?",
  )
    .bind(Date.now() + 30000, world(env), Date.now())
    .run();
  if (!lock.meta?.changes) return;
  try {
    // Re-read after acquiring the lock: another request may have refreshed
    // between our first read and this lock, rotating the refresh token.
    const current = await account(env);
    if (
      !current?.token_cipher ||
      (Date.now() - current.validated_at < 3600000 &&
        current.expires_at - Date.now() > 120000)
    ) {
      await env.WORLD_DB.prepare(
        "UPDATE twitch_accounts SET refresh_lock = 0 WHERE world_id = ?",
      )
        .bind(world(env))
        .run();
      return;
    }
    let token = await decrypt(env, current);
    if (current.expires_at - Date.now() < 120000)
      token = await tokenRequest(env, {
        grant_type: "refresh_token",
        refresh_token: token.refresh_token,
      });
    const info = await validate(env, token.access_token);
    if (info.user_id !== current.broadcaster_id)
      throw new Error("Broadcaster identity changed");
    await env.WORLD_DB.prepare(
      "UPDATE twitch_accounts SET token_cipher = ?, expires_at = ?, validated_at = ?, refresh_lock = 0 WHERE world_id = ?",
    )
      .bind(
        await encrypt(env, token, info.user_id),
        Date.now() + info.expires_in * 1000,
        Date.now(),
        world(env),
      )
      .run();
  } catch {
    await env.WORLD_DB.prepare(
      "UPDATE twitch_accounts SET refresh_lock = ?, capabilities_json = ? WHERE world_id = ?",
    )
      .bind(
        Date.now() + 60000,
        JSON.stringify({
          authorization: "validation or refresh failed; reconnect required",
        }),
        world(env),
      )
      .run();
  }
}
async function reserveMessage(env: HostedTwitchEnv, id: string) {
  const now = Date.now();
  const claimToken = random();
  const inserted = await env.WORLD_DB.prepare(
    "INSERT OR IGNORE INTO twitch_webhook_messages (id, world_id, received_at, claimed_until, completed, claim_token) VALUES (?, ?, ?, ?, 0, ?)",
  )
    .bind(id, world(env), now, now + 10000, claimToken)
    .run();
  if (inserted.meta?.changes) return claimToken;
  const existing = await env.WORLD_DB.prepare(
    "SELECT completed, claimed_until FROM twitch_webhook_messages WHERE id = ?",
  )
    .bind(id)
    .first<{ completed: number; claimed_until: number }>();
  if (existing?.completed) return false;
  if (existing && existing.claimed_until > now)
    throw new TwitchHttpError(
      "Notification is being processed; retry shortly.",
      503,
    );
  const retry = await env.WORLD_DB.prepare(
    "UPDATE twitch_webhook_messages SET claimed_until = ?, claim_token = ? WHERE id = ? AND completed = 0 AND claimed_until <= ?",
  )
    .bind(now + 10000, claimToken, id, now)
    .run();
  if (!retry.meta?.changes)
    throw new TwitchHttpError(
      "Notification is being processed; retry shortly.",
      503,
    );
  return claimToken;
}
export async function verifyTwitchWebhook(
  request: Request,
  secret: string,
  raw: string | Uint8Array,
) {
  const id = request.headers.get("Twitch-Eventsub-Message-Id") || "";
  const timestamp =
    request.headers.get("Twitch-Eventsub-Message-Timestamp") || "";
  const signature =
    request.headers.get("Twitch-Eventsub-Message-Signature") || "";
  const time = Date.parse(timestamp);
  if (
    secret.length < 32 || secret.length > 100 || /[^\x20-\x7e]/.test(secret) ||
    id.length < 1 ||
    id.length > 128 ||
    !Number.isFinite(time) ||
    Date.now() - time > 600000 ||
    time - Date.now() > 60000 ||
    !/^sha256=[a-f0-9]{64}$/.test(signature)
  )
    return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const bytes = Uint8Array.from(signature.slice(7).match(/../g)!, (value) =>
    parseInt(value, 16),
  );
  const prefix = encoder.encode(id + timestamp);
  const body = typeof raw === "string" ? encoder.encode(raw) : raw;
  const signed = new Uint8Array(prefix.length + body.length);
  signed.set(prefix);
  signed.set(body, prefix.length);
  return crypto.subtle.verify("HMAC", key, bytes, signed);
}
async function normalized(
  env: HostedTwitchEnv,
  payload: any,
  id: string,
  dispatch: TwitchDispatch,
) {
  const type = payload.subscription?.type;
  const e = payload.event || {};
  const snapshot = await dispatch.getSnapshot();
  const actorId = `twitch:${clean(e.chatter_user_id || e.user_id || e.gifter_user_id || e.from_broadcaster_user_id || "anonymous", 40)}`;
  const actorDisplayName = clean(
    e.chatter_user_name ||
      e.user_name ||
      e.gifter_user_name ||
      e.from_broadcaster_user_name ||
      "A kind neighbor",
    32,
  );
  const base = {
    id: `twitch:webhook:${id}`,
    source: "twitch" as const,
    actorId,
    actorDisplayName,
    timestamp: Date.now(),
  };
  if (type === "channel.chat.message") {
    const text = clean(e.message?.text);
    const [cmd, ...args] = text.split(/\s+/);
    let event: WorldEvent | null = null;
    if (cmd?.toLowerCase() === "!join") event = { ...base, kind: "join" };
    else if (["!wave", "!dance"].includes(cmd?.toLowerCase()))
      event = { ...base, kind: cmd.toLowerCase().slice(1) as "wave" | "dance" };
    else if (cmd?.toLowerCase() === "!hello")
      event = {
        ...base,
        kind: "chat",
        text: args.join(" ") || "Hello, neighborhood!",
      };
    else if (cmd?.toLowerCase() === "!gift") {
      const target = snapshot.residents.find(
        (r) =>
          r.displayName.toLowerCase() ===
          args.join(" ").replace(/^@/, "").toLowerCase(),
      );
      if (target) event = { ...base, kind: "gift", targetId: target.id };
    } else if (
      text &&
      !text.startsWith("!") &&
      snapshot.residents.some((r) => r.id === actorId)
    )
      event = { ...base, kind: "chat", text };
    return event ? dispatch.dispatch(event, false) : false;
  }
  if (
    [
      "channel.subscribe",
      "channel.subscription.gift",
      "channel.subscription.message",
    ].includes(type)
  ) {
    return dispatch.dispatch(
      {
        ...base,
        kind: "confetti",
        text: `${actorDisplayName} celebrated a subscription`,
        payload: { action: "celebrate" },
      },
      true,
    );
  }
  if (type === "channel.raid") {
    return dispatch.dispatch(
      {
        ...base,
        kind: "raid",
        text: `Welcome ${actorDisplayName} and their community!`,
        payload: {
          amount: Math.max(1, Math.min(10000, Number(e.viewers) || 1)),
        },
      },
      true,
    );
  }
  if (type === "channel.channel_points_custom_reward_redemption.add") {
    let joined = false;
    let mappings: Record<string, string> = {};
    try {
      mappings = JSON.parse(env.TWITCH_REWARD_ACTIONS || "{}");
    } catch {
      return false;
    }
    const action = mappings[e.reward?.id];
    if (
      ![
        "wave",
        "dance",
        "confetti",
        "weather:sunny",
        "weather:rain",
        "weather:snow",
        "weather:sunset",
      ].includes(action)
    )
      return false;
    if (
      ["wave", "dance"].includes(action) &&
      !snapshot.residents.some((r) => r.id === actorId)
    )
      joined = await dispatch.dispatch(
        { ...base, id: `${base.id}:join`, kind: "join" },
        false,
      );
    const weather = action.startsWith("weather:")
      ? (action.slice(8) as Weather)
      : undefined;
    const changed = await dispatch.dispatch(
      {
        ...base,
        kind: weather ? "weather" : (action as "wave" | "dance" | "confetti"),
        payload: weather ? { weather } : undefined,
      },
      Boolean(weather) || action === "confetti",
    );
    return changed || joined;
  }
  return false;
}
export async function handleHostedTwitch(
  request: Request,
  env: HostedTwitchEnv,
  actor: string | undefined,
  director: boolean,
  dispatch: TwitchDispatch,
  schedule?: (task: Promise<unknown>) => void,
): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (url.pathname === "/api/twitch/webhook") {
      if (request.method !== "POST")
        throw new TwitchHttpError("Method not allowed.", 405);
      const reader = request.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (Number(request.headers.get("Content-Length") || 0) > 65536)
        throw new TwitchHttpError("Webhook body is too large.", 413);
      if (reader)
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > 65536) {
            await reader.cancel();
            throw new TwitchHttpError("Webhook body is too large.", 413);
          }
          chunks.push(chunk.value);
        }
      const raw = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        raw.set(chunk, offset);
        offset += chunk.length;
      }
      if (
        !(await verifyTwitchWebhook(
          request,
          env.TWITCH_WEBHOOK_SECRET || "",
          raw,
        ))
      )
        throw new TwitchHttpError(
          "Invalid EventSub signature or timestamp.",
          403,
        );
      let payload: any;
      try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
      catch { throw new TwitchHttpError("Malformed EventSub payload.", 400); }
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        throw new TwitchHttpError("Malformed EventSub envelope.", 400);
      const id = request.headers.get("Twitch-Eventsub-Message-Id")!;
      const kind = request.headers.get("Twitch-Eventsub-Message-Type");
      let row = await account(env);
      if (kind === "notification" && row?.token_cipher && (Date.now() - row.validated_at >= 3600000 || row.expires_at <= Date.now())) {
        const maintenance = maintainHostedTwitch(env);
        if (schedule) {
          schedule(maintenance);
          throw new TwitchHttpError("Authorization validation is in progress; retry this notification.", 503);
        }
        await maintenance;
        row = await account(env);
      }
      if (!row?.broadcaster_id || kind !== "revocation" && !JSON.parse(row.capabilities_json).authorization?.startsWith("authorized "))
        throw new TwitchHttpError("Broadcaster authorization requires reconnection.", 403);
      try { await checkWebhookSubscription(env, request, payload, kind || "", row.broadcaster_id); }
      catch { throw new TwitchHttpError("Subscription ID, version, condition or broadcaster is not registered for this world.", 403); }
      const claimToken = await reserveMessage(env, id);
      if (!claimToken) {
        if (
          kind === "webhook_callback_verification" &&
          typeof payload.challenge === "string" &&
          payload.challenge.length <= 2048
        )
          return new Response(payload.challenge, {
            headers: {
              "Content-Type": "text/plain",
              "Cache-Control": "no-store",
            },
          });
        return new Response(null, { status: 204 });
      }
      try {
        if (kind === "webhook_callback_verification") {
          if (
            typeof payload.challenge !== "string" ||
            payload.challenge.length > 2048
          )
            throw new TwitchHttpError("Invalid challenge.");
          await markSubscription(env, payload.subscription.type, payload.subscription.id, "enabled");
          await capability(env, payload.subscription.type, "enabled");
          await env.WORLD_DB.prepare(
            "UPDATE twitch_webhook_messages SET completed = 1 WHERE id = ? AND claim_token = ?",
          )
            .bind(id, claimToken)
            .run();
          return new Response(payload.challenge, {
            headers: {
              "Content-Type": "text/plain",
              "Cache-Control": "no-store",
            },
          });
        }
        if (kind === "revocation") {
          await markSubscription(env, payload.subscription.type, payload.subscription.id, "revoked");
          await capability(
            env,
            payload.subscription?.type || "eventsub",
            `revoked (${clean(payload.subscription?.status, 80)})`,
          );
        } else if (kind === "notification") {
          const row = await account(env);
          if (!row?.broadcaster_id)
            throw new TwitchHttpError(
              "Broadcaster authorization is unavailable.",
              503,
            );
          const authorization = JSON.parse(row.capabilities_json).authorization;
          if (
            typeof authorization !== "string" ||
            !authorization.startsWith("authorized ")
          )
            throw new TwitchHttpError(
              "Broadcaster authorization requires reconnection.",
              403,
            );
          const condition = payload.subscription?.condition || {};
          const broadcaster =
            payload.subscription.type === "channel.raid"
              ? condition.to_broadcaster_user_id
              : condition.broadcaster_user_id;
          if (
            broadcaster !== row.broadcaster_id ||
            (payload.subscription.type === "channel.chat.message" &&
              condition.user_id !== row.broadcaster_id)
          )
            throw new TwitchHttpError(
              "Event targets another broadcaster.",
              403,
            );
          const changed = await normalized(env, payload, id, dispatch);
          if (changed) await env.WORLD_DB.prepare("UPDATE twitch_accounts SET last_event_at=?, last_event_id=? WHERE world_id=?")
            .bind(Date.now(), id, world(env)).run();
          await capability(
            env,
            payload.subscription?.type || "eventsub",
            "enabled",
          );
        } else throw new TwitchHttpError("Unsupported EventSub message type.");
        await env.WORLD_DB.prepare(
          "UPDATE twitch_webhook_messages SET completed = 1 WHERE id = ? AND claim_token = ?",
        )
          .bind(id, claimToken)
          .run();
        return new Response(null, { status: 204 });
      } catch (error) {
        await env.WORLD_DB.prepare(
          "DELETE FROM twitch_webhook_messages WHERE id = ? AND completed = 0 AND claim_token = ?",
        )
          .bind(id, claimToken)
          .run();
        throw error;
      }
    }
    if (!actor || !director || !(await twitchOwnerAllowed(env, actor)))
      throw new TwitchHttpError(
        "Only the signed-in world owner can connect Twitch.",
        403,
      );
    if (url.pathname === "/api/twitch/connect") {
      if (
        request.method !== "POST" ||
        request.headers.get("Origin") !== url.origin
      )
        throw new TwitchHttpError("Origin or method is not allowed.", 403);
      if (!configured(env))
        throw new TwitchHttpError(
          "Configure server-side Twitch app credentials, exact callback, token encryption key, webhook secret and public EventSub relay first.",
          503,
        );
      await env.WORLD_DB.prepare(
        "INSERT OR IGNORE INTO twitch_accounts (world_id, owner_actor) VALUES (?, ?)",
      )
        .bind(world(env), actor)
        .run();
      if (!(await twitchOwnerAllowed(env, actor)))
        throw new TwitchHttpError("Another world owner is already bound.", 403);
      await env.WORLD_DB.prepare(
        "DELETE FROM twitch_oauth_states WHERE expires_at < ?",
      )
        .bind(Date.now())
        .run();
      const attempts = await env.WORLD_DB.prepare(
        "SELECT COUNT(*) AS count FROM twitch_oauth_states WHERE owner_actor = ? AND expires_at > ?",
      )
        .bind(actor, Date.now() + 540000)
        .first<{ count: number }>();
      if ((attempts?.count || 0) >= 5)
        throw new TwitchHttpError(
          "Too many Twitch authorization attempts. Try again in a minute.",
          429,
        );
      const state = random();
      const hash = hex(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", encoder.encode(state)),
        ),
      );
      await env.WORLD_DB.prepare(
        "INSERT INTO twitch_oauth_states (state_hash, world_id, owner_actor, expires_at) VALUES (?, ?, ?, ?)",
      )
        .bind(hash, world(env), actor, Date.now() + 600000)
        .run();
      const authorize = new URL("https://id.twitch.tv/oauth2/authorize");
      authorize.search = new URLSearchParams({
        client_id: env.TWITCH_CLIENT_ID!,
        redirect_uri: env.TWITCH_REDIRECT_URI!,
        response_type: "code",
        scope: HOSTED_TWITCH_SCOPES.join(" "),
        state,
        force_verify: "true",
      }).toString();
      return response({ authorizeUrl: authorize.toString() });
    }
    if (url.pathname === "/api/twitch/callback") {
      if (request.method !== "GET")
        throw new TwitchHttpError("Method not allowed.", 405);
      const state = url.searchParams.get("state") || "";
      if (state.length > 128)
        throw new TwitchHttpError("Invalid OAuth state.", 403);
      const hash = hex(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", encoder.encode(state)),
        ),
      );
      const claimed = await env.WORLD_DB.prepare(
        "UPDATE twitch_oauth_states SET consumed = 1 WHERE state_hash = ? AND consumed = 0 AND expires_at > ? AND owner_actor = ? AND world_id = ?",
      )
        .bind(hash, Date.now(), actor, world(env))
        .run();
      if (!claimed.meta?.changes)
        throw new TwitchHttpError(
          "OAuth state expired or did not match this owner.",
          403,
        );
      const code = url.searchParams.get("code");
      if (!code || code.length > 2048 || url.searchParams.has("error"))
        throw new TwitchHttpError("Twitch authorization was declined.");
      const token = await tokenRequest(env, {
        grant_type: "authorization_code",
        code,
        redirect_uri: env.TWITCH_REDIRECT_URI!,
      });
      const info = await validate(env, token.access_token);
      if (actor?.startsWith("twitch:") && actor !== `twitch:${info.user_id}`)
        throw new TwitchHttpError("Connect the Twitch account that owns this world.", 403);
      await env.WORLD_DB.prepare(
        "UPDATE twitch_accounts SET broadcaster_id = ?, broadcaster_login = ?, token_cipher = ?, expires_at = ?, validated_at = ?, capabilities_json = ?, last_event_at=0, last_event_id=NULL WHERE world_id = ? AND owner_actor = ?",
      )
        .bind(
          info.user_id,
          info.login,
          await encrypt(env, token, info.user_id),
          Date.now() + info.expires_in * 1000,
          Date.now(),
          JSON.stringify({ authorization: `authorized ${info.login}` }),
          world(env),
          actor,
        )
        .run();
      await subscriptions(env, info);
      return new Response(null, {
        status: 303,
        headers: {
          Location: `${url.origin}/director?twitch=connected&world=${encodeURIComponent(world(env))}`,
          "Cache-Control": "no-store",
        },
      });
    }
    throw new TwitchHttpError("Twitch route not found.", 404);
  } catch (error) {
    const known = error instanceof TwitchHttpError;
    return response(
      {
        error: known
          ? error.message
          : "Twitch request could not be completed. Check server configuration.",
        messages: [
          {
            type: "error",
            message: known
              ? error.message
              : "Twitch request could not be completed.",
          },
        ],
      },
      known ? error.status : 503,
    );
  }
}
