/** Public, browser-bound Twitch sign-in through Composio. No Sites identity needed. */
import { ComposioPocError, createManagedProfileClient, inspectManagedTwitch, readManagedProfileProof,
  type ManagedProfileClient, type ProfileAttempt } from "./composio-twitch-poc.js";

interface Statement {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
export interface TwitchLoginEnv {
  WORLD_DB: { prepare(sql: string): Statement };
  COMPOSIO_API_KEY?: string;
  AUTH_SESSION_SECRET?: string;
  /** Operator attestation that this exact URL is enabled in Composio project settings. */
  COMPOSIO_OAUTH_VERIFIER_URL?: string;
}
export interface TwitchSession {
  actorId: string;
  twitchId: string;
  login: string;
  displayName: string;
}
interface LoginAttempt {
  browser_hash: string;
  provider_user_id: string;
  auth_config_id: string;
  connected_account_id: string | null;
  return_path: string;
  expires_at: number;
  consumed: number;
}
type ClientFactory = (key: string) => Promise<ManagedProfileClient>;
const LOGIN_COOKIE = "__Host-hw_twitch_login", SESSION_COOKIE = "__Host-hw_twitch";
const ATTEMPT_TTL = 600_000, SESSION_TTL = 30 * 86400_000;
const encoder = new TextEncoder();
const object = (v: unknown): Record<string, any> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, any> : {};
const id = (v: unknown): v is string => typeof v === "string" && /^[\w:-]{1,256}$/.test(v);
const hex = (v: Uint8Array) => Array.from(v, b => b.toString(16).padStart(2, "0")).join("");
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const digest = async (v: string) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(v))));
class LoginError extends Error { constructor(readonly code: string, readonly status = 400) { super(code); } }
function verifierConfigured(request: Request, env: TwitchLoginEnv) {
  return env.COMPOSIO_OAUTH_VERIFIER_URL === `${new URL(request.url).origin}/api/auth/twitch/verify`;
}
export async function publicTwitchLoginReady(request: Request, env: TwitchLoginEnv) {
  if (!env.COMPOSIO_API_KEY || !env.AUTH_SESSION_SECRET || env.AUTH_SESSION_SECRET.length < 32 || !verifierConfigured(request, env)) return false;
  const config = await env.WORLD_DB.prepare("SELECT status FROM twitch_login_config WHERE id='twitch-profile'").first<{ status: string }>();
  return config?.status !== "review-required";
}
function secret(env: TwitchLoginEnv) {
  if (!env.AUTH_SESSION_SECRET || env.AUTH_SESSION_SECRET.length < 32) throw new LoginError("TWITCH_LOGIN_NOT_CONFIGURED", 503);
  return env.AUTH_SESSION_SECRET;
}
async function signature(env: TwitchLoginEnv, purpose: string, value: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret(env)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${purpose}\0${value}`))));
}
async function validSignature(env: TwitchLoginEnv, purpose: string, value: string, mac: string) {
  if (!/^[a-f0-9]{64}$/.test(mac)) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret(env)), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = Uint8Array.from(mac.match(/../g)!, b => Number.parseInt(b, 16));
  return crypto.subtle.verify("HMAC", key, bytes, encoder.encode(`${purpose}\0${value}`));
}
function cookie(request: Request, name: string) {
  const values = (request.headers.get("Cookie") || "").split(";").map(v => v.trim()).filter(v => v.startsWith(`${name}=`));
  return values.length === 1 ? values[0].slice(name.length + 1) : "";
}
function setCookie(name: string, value: string, maxAge: number) {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}
function reply(value: unknown, status = 200, cookies: string[] = []) {
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
  for (const value of cookies) headers.append("Set-Cookie", value);
  if (status === 429 || status === 503) headers.set("Retry-After", "10");
  return new Response(JSON.stringify(value), { status, headers });
}
/** An allowlist, not a generic redirect sanitizer. All Director returns use the signed-in user's own world. */
function returnPath(body: Record<string, any>) {
  if (body.returnTo !== undefined) {
    if (typeof body.returnTo !== "string" || body.returnTo.length > 200 || !body.returnTo.startsWith("/") || body.returnTo.startsWith("//"))
      throw new LoginError("INVALID_LOGIN_RETURN_PATH");
    const target = new URL(body.returnTo, "https://return.invalid");
    if (target.origin !== "https://return.invalid" || target.hash || !["/world", "/director"].includes(target.pathname))
      throw new LoginError("INVALID_LOGIN_RETURN_PATH");
    if (Array.from(target.searchParams.keys()).some(k => k !== "world") || target.searchParams.getAll("world").length > 1)
      throw new LoginError("INVALID_LOGIN_RETURN_PATH");
    const world = target.searchParams.get("world");
    if (world && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(world)) throw new LoginError("INVALID_LOGIN_RETURN_PATH");
    return target.pathname === "/director" ? "/director" : `/world?world=${world || "hello-neighborhood"}`;
  }
  if (body.intent !== undefined && !["join", "create-world"].includes(body.intent)) throw new LoginError("INVALID_LOGIN_INTENT");
  if (body.worldId !== undefined && (typeof body.worldId !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(body.worldId)))
    throw new LoginError("INVALID_WORLD_ID");
  return body.intent === "create-world" ? "/director" : `/world?world=${body.worldId || "hello-neighborhood"}`;
}
async function readBody(request: Request) {
  if (request.headers.get("Origin") !== new URL(request.url).origin || !request.headers.get("Content-Type")?.startsWith("application/json"))
    throw new LoginError("SAME_ORIGIN_JSON_REQUIRED", 403);
  const reader = request.body?.getReader();
  if (!reader) throw new LoginError("JSON_BODY_REQUIRED");
  let size = 0, raw = ""; const decoder = new TextDecoder();
  while (true) {
    const next = await reader.read(); if (next.done) break;
    size += next.value.byteLength;
    if (size > 1024) { await reader.cancel(); throw new LoginError("LOGIN_REQUEST_TOO_LARGE", 413); }
    raw += decoder.decode(next.value, { stream: true });
  }
  raw += decoder.decode();
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new LoginError("INVALID_LOGIN_REQUEST"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new LoginError("INVALID_LOGIN_REQUEST");
  return object(value);
}
async function authRateLimit(env: TwitchLoginEnv, request: Request) {
  const now = Date.now();
  const buckets: Array<[string, number]> = [];
  // CF supplies this header at the edge. Keep no raw address or stable cross-app identifier.
  const peer = request.headers.get("CF-Connecting-IP");
  if (peer && /^[\da-f:.]{1,64}$/i.test(peer)) buckets.push([`ip:${await signature(env, "auth-rate", peer)}`, 20]);
  buckets.push(["global", 240]);
  for (const [bucket, maximum] of buckets) {
    const result = await env.WORLD_DB.prepare(`INSERT INTO twitch_auth_rate_limits (bucket,window_started,request_count) VALUES (?,?,1)
      ON CONFLICT(bucket) DO UPDATE SET request_count=CASE WHEN window_started<=? THEN 1 ELSE request_count+1 END,
      window_started=CASE WHEN window_started<=? THEN excluded.window_started ELSE window_started END
      WHERE window_started<=? OR request_count<?`)
      .bind(bucket, now, now - 60000, now - 60000, now - 60000, maximum).run();
    if (!result.meta?.changes) throw new LoginError("TWITCH_SIGN_IN_RATE_LIMIT", 429);
  }
}
async function profileConfig(client: ManagedProfileClient, configId: string) {
  const config = object(await client.config(configId));
  if (config.isComposioManaged !== true || config.toolkit?.slug?.toLowerCase() !== "twitch" || config.status !== "ENABLED")
    throw new LoginError("PROFILE_CONFIG_NOT_MANAGED_TWITCH");
  if (!(config.credentials?.scopes === "" || Array.isArray(config.credentials?.scopes) && config.credentials.scopes.length === 0))
    throw new LoginError("EMPTY_SCOPE_OVERRIDE_UNVERIFIED");
}
async function managedConfig(env: TwitchLoginEnv, client: ManagedProfileClient) {
  await inspectManagedTwitch(client);
  const saved = await env.WORLD_DB.prepare("SELECT status,auth_config_id,updated_at FROM twitch_login_config WHERE id='twitch-profile'")
    .first<{ status: string; auth_config_id: string | null; updated_at: number }>();
  if (saved?.status === "ready" && saved.auth_config_id) { await profileConfig(client, saved.auth_config_id); return saved.auth_config_id; }
  if (saved) {
    if (saved.status === "creating") throw new LoginError("TWITCH_LOGIN_INITIALIZING_RETRY", 503);
    // An earlier process may have created the remote config but failed before
    // saving its ID. Recover that exact named config through read-only API calls.
    if (saved.status === "review-required" && client.recoverProfileConfig) {
      let recovered: Record<string, any> | null = null;
      try { recovered = saved.auth_config_id ? { id: saved.auth_config_id } : object(await client.recoverProfileConfig()); }
      catch (error) {
        // A confirmed empty remote list permits a bounded retry after the
        // consistency window. All other recovery errors remain fail-closed.
        if (!(error instanceof ComposioPocError && error.code === "COMPOSIO_CONFIG_NOT_FOUND" && Date.now() - saved.updated_at > 60_000)) throw error;
      }
      if (recovered) {
        if (!id(recovered.id)) throw new LoginError("INVALID_AUTH_CONFIG");
        await env.WORLD_DB.prepare("UPDATE twitch_login_config SET auth_config_id=?,updated_at=? WHERE id='twitch-profile' AND status='review-required'")
          .bind(recovered.id, Date.now()).run();
        await profileConfig(client, recovered.id);
        await env.WORLD_DB.prepare("UPDATE twitch_login_config SET status='ready',updated_at=? WHERE id='twitch-profile' AND auth_config_id=?")
          .bind(Date.now(), recovered.id).run();
        return recovered.id as string;
      }
    } else {
      throw new LoginError("TWITCH_LOGIN_CONFIG_REVIEW_REQUIRED", 503);
    }
  }
  const claim = random();
  const inserted = saved ? await env.WORLD_DB.prepare("UPDATE twitch_login_config SET status='creating',claim_token=?,updated_at=? WHERE id='twitch-profile' AND status='review-required' AND updated_at=?")
    .bind(claim, Date.now(), saved.updated_at).run()
    : await env.WORLD_DB.prepare("INSERT OR IGNORE INTO twitch_login_config (id,status,claim_token,updated_at) VALUES ('twitch-profile','creating',?,?)")
      .bind(claim, Date.now()).run();
  if (!inserted.meta?.changes) throw new LoginError("TWITCH_LOGIN_INITIALIZING_RETRY", 503);
  try {
    const config = object(await client.createProfileConfig());
    if (!id(config.id)) throw new LoginError("INVALID_AUTH_CONFIG");
    await env.WORLD_DB.prepare("UPDATE twitch_login_config SET auth_config_id=?,updated_at=? WHERE id='twitch-profile' AND claim_token=?")
      .bind(config.id, Date.now(), claim).run();
    await profileConfig(client, config.id);
    const stored = await env.WORLD_DB.prepare("UPDATE twitch_login_config SET status='ready',auth_config_id=?,updated_at=? WHERE id='twitch-profile' AND claim_token=?")
      .bind(config.id, Date.now(), claim).run();
    if (!stored.meta?.changes) throw new LoginError("TWITCH_LOGIN_CONFIG_REVIEW_REQUIRED", 503);
    return config.id as string;
  } catch (error) {
    await env.WORLD_DB.prepare("UPDATE twitch_login_config SET status='review-required',updated_at=? WHERE id='twitch-profile' AND claim_token=?")
      .bind(Date.now(), claim).run();
    throw error;
  }
}
async function sessionToken(request: Request, env: TwitchLoginEnv) {
  if (!env.AUTH_SESSION_SECRET || env.AUTH_SESSION_SECRET.length < 32) return null;
  const value = cookie(request, SESSION_COOKIE), parts = value.split(".");
  if (parts.length !== 2 || !/^[a-f0-9]{64}$/.test(parts[0])) return null;
  return await validSignature(env, `twitch-session:${new URL(request.url).origin}`, parts[0], parts[1]) ? parts[0] : null;
}
export async function resolveTwitchSession(request: Request, env: TwitchLoginEnv): Promise<TwitchSession | null> {
  const token = await sessionToken(request, env);
  if (!token) return null;
  const user = await env.WORLD_DB.prepare(`SELECT u.id,u.login,u.display_name FROM twitch_auth_sessions s
    JOIN twitch_users u ON u.id=s.twitch_user_id WHERE s.token_hash=? AND s.expires_at>?`)
    .bind(await digest(token), Date.now()).first<{ id: string; login: string; display_name: string }>();
  return user ? { actorId: `twitch:${user.id}`, twitchId: user.id, login: user.login, displayName: user.display_name } : null;
}
export async function handleTwitchLogin(request: Request, env: TwitchLoginEnv, factory: ClientFactory = createManagedProfileClient): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (url.pathname === "/api/auth/session" && request.method === "GET") {
      const user = await resolveTwitchSession(request, env);
      return reply({ user: user ? { id: user.twitchId, login: user.login, displayName: user.displayName } : null,
        ownWorldId: user ? `twitch-${user.twitchId}` : null, loginConfigured: await publicTwitchLoginReady(request, env) });
    }
    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      await readBody(request);
      const token = await sessionToken(request, env);
      if (token) await env.WORLD_DB.prepare("DELETE FROM twitch_auth_sessions WHERE token_hash=?").bind(await digest(token)).run();
      return reply({ user: null, ownWorldId: null }, 200, [setCookie(SESSION_COOKIE, "", 0), setCookie(LOGIN_COOKIE, "", 0)]);
    }
    if (!["/api/auth/twitch/start", "/api/auth/twitch/callback", "/api/auth/twitch/verify"].includes(url.pathname)) throw new LoginError("AUTH_ROUTE_NOT_FOUND", 404);
    if (url.protocol !== "https:") throw new LoginError("HTTPS_SIGN_IN_REQUIRED", 400);
    secret(env);
    if (!env.COMPOSIO_API_KEY) throw new LoginError("TWITCH_LOGIN_NOT_CONFIGURED", 503);
    if (!verifierConfigured(request, env)) throw new LoginError("TWITCH_IDENTITY_VERIFIER_NOT_CONFIGURED", 503);
    if (url.pathname.endsWith("/start")) {
      if (request.method !== "POST") throw new LoginError("POST_REQUIRED", 405);
      const body = await readBody(request), destination = returnPath(body);
      if (Object.keys(body).some(k => !["returnTo", "intent", "worldId"].includes(k))) throw new LoginError("INVALID_LOGIN_REQUEST");
      await authRateLimit(env, request);
      const client = await factory(env.COMPOSIO_API_KEY), configId = await managedConfig(env, client);
      const state = random(), browser = random(), ownerId = `hello-login:${random()}`, now = Date.now();
      const expiresAt = now + ATTEMPT_TTL, stateHash = await digest(state);
      await env.WORLD_DB.prepare(`INSERT INTO twitch_login_attempts
        (state_hash,browser_hash,provider_user_id,auth_config_id,return_path,expires_at,created_at) VALUES (?,?,?,?,?,?,?)`)
        .bind(stateHash, await digest(browser), ownerId, configId, destination, expiresAt, now).run();
      // Composio's project verifier owns the return. Its fixed verifier receives
      // only session_uri; per-link callbackUrl is not used in this protected mode.
      const connection = await client.authorize(ownerId, configId);
      if (!id(connection.id)) throw new LoginError("INVALID_CONNECTION_ID");
      const connect = new URL(connection.redirectUrl || "");
      if (connect.protocol !== "https:" || connect.username || connect.password || connect.port || connect.hash || connect.href.length > 4096 || !["connect.composio.dev", "backend.composio.dev"].includes(connect.hostname))
        throw new LoginError("UNEXPECTED_CONNECT_DESTINATION");
      await env.WORLD_DB.prepare("UPDATE twitch_login_attempts SET connected_account_id=? WHERE state_hash=? AND consumed=0")
        .bind(connection.id, stateHash).run();
      const value = `${state}.${browser}.${await signature(env, `twitch-login:${url.origin}`, `${state}.${browser}`)}`;
      return reply({ authorizeUrl: connect.href, expiresAt }, 200, [setCookie(LOGIN_COOKIE, value, ATTEMPT_TTL / 1000)]);
    }
    if (request.method !== "GET") throw new LoginError("GET_REQUIRED", 405);
    // Never authenticate from ACTIVE/account-ID polling. The opaque URI is a
    // provider-completion secret, redeemable once and absent from the start link.
    if (url.pathname !== "/api/auth/twitch/verify") throw new LoginError("TWITCH_COMPLETION_PROOF_REQUIRED", 403);
    const sessionUri = url.searchParams.get("session_uri");
    if (!sessionUri || sessionUri.length > 4096 || /[\u0000-\u0020\u007f]/.test(sessionUri) || url.searchParams.getAll("session_uri").length !== 1 || Array.from(url.searchParams.keys()).some(k => k !== "session_uri"))
      throw new LoginError("TWITCH_COMPLETION_PROOF_REQUIRED", 403);
    const parts = cookie(request, LOGIN_COOKIE).split("."), state = parts[0];
    if (!state || !/^[a-f0-9]{64}$/.test(state) || parts.length !== 3 || !/^[a-f0-9]{64}$/.test(parts[1]) ||
      !await validSignature(env, `twitch-login:${url.origin}`, `${parts[0]}.${parts[1]}`, parts[2]))
      throw new LoginError("TWITCH_LOGIN_BROWSER_STATE_MISMATCH", 403);
    const stateHash = await digest(state);
    const attempt = await env.WORLD_DB.prepare("SELECT * FROM twitch_login_attempts WHERE state_hash=?").bind(stateHash).first<LoginAttempt>();
    if (!attempt || attempt.expires_at <= Date.now() || attempt.browser_hash !== await digest(parts[1]) || !attempt.connected_account_id)
      throw new LoginError("TWITCH_LOGIN_EXPIRED_OR_INVALID", 403);
    const claimed = await env.WORLD_DB.prepare("UPDATE twitch_login_attempts SET consumed=1 WHERE state_hash=? AND consumed=0 AND expires_at>?")
      .bind(stateHash, Date.now()).run();
    if (!claimed.meta?.changes) throw new LoginError("TWITCH_LOGIN_ALREADY_USED", 403);
    const client = await factory(env.COMPOSIO_API_KEY);
    if (!client.completeAuth) throw new LoginError("TWITCH_COMPLETION_REDEMPTION_UNAVAILABLE", 503);
    const completed = await client.completeAuth(attempt.provider_user_id, sessionUri);
    if (completed.connectedAccountId !== attempt.connected_account_id || completed.toolkitSlug.toLowerCase() !== "twitch")
      throw new LoginError("TWITCH_COMPLETION_ACCOUNT_MISMATCH", 403);
    const proofAttempt: ProfileAttempt = { ownerId: attempt.provider_user_id, authConfigId: attempt.auth_config_id, connectedAccountId: attempt.connected_account_id, expiresAt: attempt.expires_at };
    const proof = await readManagedProfileProof(client, proofAttempt, attempt.provider_user_id, "read-only");
    const twitchId = String(proof.profile.id), login = proof.profile.login;
    if (!/^\d{1,24}$/.test(twitchId) || !/^[a-z0-9_]{1,25}$/i.test(login)) throw new LoginError("TWITCH_PROFILE_INVALID");
    const displayName = typeof proof.profile.displayName === "string" ? proof.profile.displayName.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 50) || login : login;
    const now = Date.now(), worldId = `twitch-${twitchId}`;
    await env.WORLD_DB.prepare(`INSERT INTO twitch_users (id,login,display_name,composio_user_id,composio_account_id,auth_config_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET login=excluded.login,display_name=excluded.display_name,
      composio_user_id=excluded.composio_user_id,composio_account_id=excluded.composio_account_id,auth_config_id=excluded.auth_config_id,updated_at=excluded.updated_at`)
      .bind(twitchId, login, displayName, attempt.provider_user_id, attempt.connected_account_id, attempt.auth_config_id, now, now).run();
    await env.WORLD_DB.prepare(`INSERT INTO world_owners (world_id,twitch_user_id,login,display_name,created_at) VALUES (?,?,?,?,?)
      ON CONFLICT(world_id) DO UPDATE SET login=excluded.login,display_name=excluded.display_name WHERE world_owners.twitch_user_id=excluded.twitch_user_id`)
      .bind(worldId, twitchId, login, displayName, now).run();
    const ownership = await env.WORLD_DB.prepare("SELECT twitch_user_id FROM world_owners WHERE world_id=?").bind(worldId).first<{ twitch_user_id: string }>();
    if (ownership?.twitch_user_id !== twitchId) throw new LoginError("WORLD_OWNERSHIP_CONFLICT", 503);
    const token = random();
    await env.WORLD_DB.prepare("INSERT INTO twitch_auth_sessions (token_hash,twitch_user_id,expires_at,created_at) VALUES (?,?,?,?)")
      .bind(await digest(token), twitchId, now + SESSION_TTL, now).run();
    await env.WORLD_DB.prepare("UPDATE twitch_login_attempts SET consumed=2 WHERE state_hash=? AND consumed=1").bind(stateHash).run();
    const destination = attempt.return_path === "/director" ? `/director?world=${worldId}` : attempt.return_path;
    const headers = new Headers({ Location: destination, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
    headers.append("Set-Cookie", setCookie(LOGIN_COOKIE, "", 0));
    headers.append("Set-Cookie", setCookie(SESSION_COOKIE, `${token}.${await signature(env, `twitch-session:${url.origin}`, token)}`, SESSION_TTL / 1000));
    return new Response(null, { status: 303, headers });
  } catch (error) {
    return reply({ error: error instanceof LoginError ? error.code : error instanceof ComposioPocError ? error.code : "TWITCH_SIGN_IN_FAILED" }, error instanceof LoginError ? error.status : 400);
  }
}
