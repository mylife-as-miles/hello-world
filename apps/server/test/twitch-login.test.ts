import { describe, it, expect, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { sqliteD1 } from "../../../tests/helpers/sqlite-d1.js";
import { handleTwitchLogin, resolveTwitchSession } from "../src/twitch-login.js";
import type { ManagedProfileClient } from "../src/composio-twitch-poc.js";

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../sites-migrations/0005_twitch_users.sql", import.meta.url), "utf8"));
  let count = 0, userId = "123", active = true;
  const accounts = new Map<string, { id: string; userId: string; sessionUri: string }>();
  const completionCodes = new Map<string, { owner: string; accountId: string }>();
  const client: ManagedProfileClient = {
    toolkit: vi.fn(async () => ({ slug: "twitch", composioManagedAuthSchemes: ["OAUTH2"], authConfigDetails: [{ mode: "OAUTH2", requiredScopes: [] }] })),
    createProfileConfig: vi.fn(async () => ({ id: "ac_login" })),
    config: vi.fn(async () => ({ isComposioManaged: true, toolkit: { slug: "twitch" }, status: "ENABLED", credentials: { scopes: "" } })),
    authorize: vi.fn(async (owner: string) => {
      const id = `ca_login_${++count}`, sessionUri = `opaque-completion-${count}`;
      accounts.set(owner, { id, userId, sessionUri }); completionCodes.set(sessionUri, { owner, accountId: id });
      return { id, redirectUrl: `https://connect.composio.dev/link/test-${count}` };
    }),
    completeAuth: vi.fn(async (owner: string, sessionUri: string) => {
      const code = completionCodes.get(sessionUri); completionCodes.delete(sessionUri);
      if (!code || code.owner !== owner) throw new Error("Unknown, mismatched or spent completion proof");
      return { connectedAccountId: code.accountId, toolkitSlug: "twitch" };
    }),
    ownedAccounts: vi.fn(async owner => ({ items: accounts.has(owner) ? [{ id: accounts.get(owner)!.id, status: active ? "ACTIVE" : "INITIATED", toolkit: { slug: "twitch" }, authConfig: { id: "ac_login" } }] : [] })),
    profile: vi.fn(async (owner, account) => {
      const saved = accounts.get(owner);
      return { status: saved?.id === account ? 200 : 403, data: { data: [{ id: saved?.userId, login: `streamer${saved?.userId}`, display_name: `Streamer ${saved?.userId}`, email: "must-not-store@example.test", access_token: "must-not-store-token" }] } };
    }),
  };
  const env = { WORLD_DB: sqliteD1(sqlite), COMPOSIO_API_KEY: "server-only-composio-key", AUTH_SESSION_SECRET: "server-only-session-secret-1234567890", COMPOSIO_OAUTH_VERIFIER_URL: "https://world.test/api/auth/twitch/verify" };
  const factory = vi.fn(async () => client);
  const request = (path: string, body?: unknown, cookie = "", origin = "https://world.test", ip = "203.0.113.1") => new Request(`https://world.test${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { Origin: origin, "Content-Type": "application/json" }), "CF-Connecting-IP": ip },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const run = (path: string, body?: unknown, cookie = "", origin = "https://world.test", ip = "203.0.113.1") => handleTwitchLogin(request(path, body, cookie, origin, ip), env, factory);
  async function start(returnTo = "/director") {
    const response = await run("/api/auth/twitch/start", { returnTo });
    expect(response.status).toBe(200);
    const entry = Array.from(accounts.values()).at(-1)!;
    const cookie = response.headers.get("Set-Cookie")!.split(";")[0];
    return { response, cookie, callback: `/api/auth/twitch/verify?session_uri=${entry.sessionUri}`, state: cookie.split("=")[1].split(".")[0], sessionUri: entry.sessionUri };
  }
  async function login(returnTo = "/director") {
    const started = await start(returnTo), response = await run(started.callback, undefined, started.cookie);
    expect(response.status).toBe(303);
    const cookie = response.headers.getSetCookie().find(c => c.startsWith("__Host-hw_twitch="))!.split(";")[0];
    return { ...started, response, sessionCookie: cookie };
  }
  return { sqlite, client, env, factory, request, run, start, login, accounts,
    completionCodes, setUser: (id: string) => { userId = id; }, setActive: (value: boolean) => { active = value; } };
}
describe("public Twitch login through Composio", () => {
  it("reports a public anonymous session without Sites identity or credential use", async () => {
    const f = fixture(); try {
      const result = await f.run("/api/auth/session");
      expect(result.status).toBe(200); expect(await result.json()).toEqual({ user: null, ownWorldId: null, loginConfigured: true });
      expect(f.factory).not.toHaveBeenCalled();
    } finally { f.sqlite.close(); }
  });
  it("issues an HttpOnly browser-bound state and creates only one shared scope-limited config", async () => {
    const f = fixture(); try {
      const first = await f.start(), second = await f.start();
      expect(first.cookie).not.toBe(second.cookie);
      expect(first.response.headers.get("Set-Cookie")).toMatch(/Secure; HttpOnly; SameSite=Lax/);
      expect(f.client.createProfileConfig).toHaveBeenCalledTimes(1);
      const args = vi.mocked(f.client.authorize).mock.calls;
      expect(args[0][0]).not.toBe(args[1][0]);
      expect(args[0].length).toBe(2); // Project verifier replaces per-link callback URLs.
      expect(await first.response.text()).not.toContain(f.env.COMPOSIO_API_KEY);
    } finally { f.sqlite.close(); }
  });
  it("requires same-origin POST and blocks unknown payload fields before using a key", async () => {
    const f = fixture(); try {
      expect((await f.run("/api/auth/twitch/start")).status).toBe(405);
      expect((await f.run("/api/auth/twitch/start", {}, "", "https://attacker.test")).status).toBe(403);
      expect((await f.run("/api/auth/twitch/start", { scopes: "chat:edit" })).status).toBe(400);
      expect(f.factory).not.toHaveBeenCalled();
    } finally { f.sqlite.close(); }
  });
  it.each(["https://evil.test/world", "//evil.test/world", "/world?world=x&return=https://evil.test", "/director/anything", "/world?world=x&world=y", "/world#token", "/world?world=../../admin"])("refuses untrusted returnTo %s", async returnTo => {
    const f = fixture(); try {
      expect((await f.run("/api/auth/twitch/start", { returnTo })).status).toBe(400);
      expect(f.factory).not.toHaveBeenCalled();
    } finally { f.sqlite.close(); }
  });
  it("rejects missing, tampered, expired and reused browser state", async () => {
    const f = fixture(); try {
      const one = await f.start(), two = await f.start();
      expect((await f.run(one.callback)).status).toBe(403);
      expect((await f.run(one.callback, undefined, one.cookie.slice(0, -1) + (one.cookie.endsWith("a") ? "b" : "a"))).status).toBe(403);
      f.sqlite.prepare("UPDATE twitch_login_attempts SET expires_at=? WHERE connected_account_id='ca_login_1'").run(Date.now() - 1);
      expect((await f.run(one.callback, undefined, one.cookie)).status).toBe(403);
      expect((await f.run(two.callback, undefined, two.cookie)).status).toBe(303);
      expect((await f.run(two.callback, undefined, two.cookie)).status).toBe(403);
      expect(f.client.profile).toHaveBeenCalledTimes(1);
    } finally { f.sqlite.close(); }
  });
  it("rejects a completion URI redeemed under another browser's stored Composio user", async () => {
    const f = fixture(); try {
      const one = await f.start(), two = await f.start();
      expect((await f.run(one.callback, undefined, two.cookie)).status).toBe(400);
      expect(f.client.profile).not.toHaveBeenCalled();
      expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM twitch_auth_sessions").get()).toMatchObject({ n: 0 });
    } finally { f.sqlite.close(); }
  });
  it("does not authenticate a transferred-link initiator from ACTIVE status or known state alone", async () => {
    const f = fixture(); try {
      const started = await f.start(); f.setActive(true);
      // Victim returns with real completion URI but has no initiating-browser cookie.
      expect((await f.run(started.callback)).status).toBe(403);
      // Initiator owns the cookie/state/account ID, but not the completion-only URI.
      expect((await f.run(`/api/auth/twitch/callback?state=${started.state}&status=success&connected_account_id=ca_login_1`, undefined, started.cookie)).status).toBe(403);
      expect((await f.run("/api/auth/twitch/verify", undefined, started.cookie)).status).toBe(403);
      expect(f.client.completeAuth).not.toHaveBeenCalled(); expect(f.client.profile).not.toHaveBeenCalled();
      expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM twitch_auth_sessions").get()).toMatchObject({ n: 0 });
      expect((await f.run(`/api/auth/twitch/verify?session_uri=${started.state}`, undefined, started.cookie)).status).toBe(400);
      expect(f.client.profile).not.toHaveBeenCalled();
      expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM twitch_auth_sessions").get()).toMatchObject({ n: 0 });
    } finally { f.sqlite.close(); }
  });
  it("does not reuse a spent completion URI in another otherwise valid active-account attempt", async () => {
    const f = fixture(); try {
      const one = await f.login(), two = await f.start();
      expect((await f.run(one.callback, undefined, two.cookie)).status).toBe(400);
      expect(f.client.completeAuth).toHaveBeenCalledTimes(2);
      expect(f.client.profile).toHaveBeenCalledTimes(1);
      expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM twitch_auth_sessions").get()).toMatchObject({ n: 1 });
    } finally { f.sqlite.close(); }
  });
  it("checks the redeemed account and toolkit before reading any profile", async () => {
    for (const result of [{ connectedAccountId: "ca_attacker", toolkitSlug: "twitch" }, { connectedAccountId: "ca_login_1", toolkitSlug: "github" }]) {
      const f = fixture(); try {
        const started = await f.start(); f.client.completeAuth = vi.fn(async () => result);
        expect((await f.run(started.callback, undefined, started.cookie)).status).toBe(403);
        expect(f.client.profile).not.toHaveBeenCalled();
        expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM twitch_auth_sessions").get()).toMatchObject({ n: 0 });
      } finally { f.sqlite.close(); }
    }
  });
  it("requires the configured fixed project verifier before anonymous starts", async () => {
    const f = fixture(); try {
      f.env.COMPOSIO_OAUTH_VERIFIER_URL = "https://wrong.example/verify";
      expect((await f.run("/api/auth/twitch/start", {})).status).toBe(503);
      expect((await (await f.run("/api/auth/session")).json()).loginConfigured).toBe(false);
      expect(f.factory).not.toHaveBeenCalled();
    } finally { f.sqlite.close(); }
  });
  it("accepts only the expected active account and rejects callback-supplied account IDs", async () => {
    const f = fixture(); try {
      const one = await f.start(); f.setActive(false);
      const rejected = await f.run(one.callback, undefined, one.cookie);
      expect(rejected.status).toBe(400); expect(f.client.profile).not.toHaveBeenCalled();
      expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM twitch_auth_sessions").get()).toMatchObject({ n: 0 });
      f.setActive(true); const two = await f.start();
      expect((await f.run(two.callback + "&connected_account_id=ca_attacker", undefined, two.cookie)).status).toBe(403);
      expect((await f.run(two.callback, undefined, two.cookie)).status).toBe(303);
      expect(f.client.profile).toHaveBeenCalledWith(Array.from(f.accounts.keys()).at(-1), "ca_login_2");
    } finally { f.sqlite.close(); }
  });
  it("establishes verified stable Twitch identity and owns only that user's world", async () => {
    const f = fixture(); try {
      const one = await f.login("/director?world=twitch-999");
      expect(one.response.headers.get("Location")).toBe("/director?world=twitch-123");
      const session = await resolveTwitchSession(f.request("/api/auth/session", undefined, one.sessionCookie), f.env);
      expect(session).toEqual({ actorId: "twitch:123", twitchId: "123", login: "streamer123", displayName: "Streamer 123" });
      const publicStatus = await (await f.run("/api/auth/session", undefined, one.sessionCookie)).json();
      expect(publicStatus.ownWorldId).toBe("twitch-123"); expect(publicStatus.user.id).toBe("123");
      const rows = f.sqlite.prepare("SELECT * FROM twitch_users").all();
      expect(JSON.stringify(rows)).not.toMatch(/must-not-store-token|must-not-store@example/);
      expect(f.sqlite.prepare("SELECT world_id,twitch_user_id FROM world_owners").all()).toEqual([{ world_id: "twitch-123", twitch_user_id: "123" }]);
      const token = one.sessionCookie.split("=")[1].split(".")[0];
      expect(JSON.stringify(f.sqlite.prepare("SELECT * FROM twitch_auth_sessions").all())).not.toContain(token);
    } finally { f.sqlite.close(); }
  });
  it("keeps a viewer on the requested streamer world while preserving their own separate world", async () => {
    const f = fixture(); try {
      const viewer = await f.login("/world?world=twitch-999");
      expect(viewer.response.headers.get("Location")).toBe("/world?world=twitch-999");
      expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM world_owners WHERE world_id='twitch-999'").get()).toMatchObject({ n: 0 });
    } finally { f.sqlite.close(); }
  });
  it("keeps separate Twitch users and logs out only the caller's signed session", async () => {
    const f = fixture(); try {
      const one = await f.login(); f.setUser("456"); const two = await f.login();
      const loggedOut = await f.run("/api/auth/logout", {}, one.sessionCookie);
      expect(loggedOut.status).toBe(200); expect(loggedOut.headers.getSetCookie().every(v => v.includes("Max-Age=0"))).toBe(true);
      expect(await resolveTwitchSession(f.request("/api/auth/session", undefined, one.sessionCookie), f.env)).toBeNull();
      expect((await resolveTwitchSession(f.request("/api/auth/session", undefined, two.sessionCookie), f.env))?.twitchId).toBe("456");
      expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM world_owners").get()).toMatchObject({ n: 2 });
    } finally { f.sqlite.close(); }
  });
  it("rejects forged/expired sessions without provider calls or trusting identity headers", async () => {
    const f = fixture(); try {
      const signed = await f.login(); const before = f.factory.mock.calls.length;
      const forged = signed.sessionCookie.slice(0, -1) + (signed.sessionCookie.endsWith("a") ? "b" : "a");
      expect(await resolveTwitchSession(f.request("/api/auth/session", undefined, forged), f.env)).toBeNull();
      f.sqlite.prepare("UPDATE twitch_auth_sessions SET expires_at=?").run(Date.now() - 1);
      expect(await resolveTwitchSession(f.request("/api/auth/session", undefined, signed.sessionCookie), f.env)).toBeNull();
      expect(f.factory.mock.calls.length).toBe(before);
    } finally { f.sqlite.close(); }
  });
  it("stops broad/unverifiable scope configuration before persistent login authorization", async () => {
    const f = fixture(); try {
      f.client.config = async () => ({ isComposioManaged: true, status: "ENABLED", toolkit: { slug: "twitch" }, credentials: { scopes: "user:read:email" } });
      expect((await f.run("/api/auth/twitch/start", {})).status).toBe(400);
      expect(f.client.authorize).not.toHaveBeenCalled();
      expect((await f.run("/api/auth/twitch/start", {})).status).toBe(503);
      expect(f.client.createProfileConfig).toHaveBeenCalledTimes(1);
    } finally { f.sqlite.close(); }
  });
  it("bounds anonymous connection issuance by a privacy-hashed per-IP rate bucket", async () => {
    const f = fixture(); try {
      for (let i = 0; i < 20; i++) expect((await f.run("/api/auth/twitch/start", {})).status).toBe(200);
      expect((await f.run("/api/auth/twitch/start", {})).status).toBe(429);
      expect(f.client.authorize).toHaveBeenCalledTimes(20);
      expect(JSON.stringify(f.sqlite.prepare("SELECT * FROM twitch_auth_rate_limits").all())).not.toContain("203.0.113.1");
    } finally { f.sqlite.close(); }
  });
  it("sanitizes provider exceptions and never falls back to client credentials", async () => {
    const f = fixture(); try {
      f.client.toolkit = async () => { throw new Error("server-only-composio-key access_token super-private"); };
      const failed = await f.run("/api/auth/twitch/start", {});
      expect(await failed.json()).toEqual({ error: "TWITCH_SIGN_IN_FAILED" });
      expect(f.client.createProfileConfig).not.toHaveBeenCalled();
    } finally { f.sqlite.close(); }
  });
  it("reserves shared config creation across concurrent anonymous starts", async () => {
    const f = fixture(); try {
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>(r => { entered = r; }), blocked = new Promise<void>(r => { release = r; });
      f.client.createProfileConfig = vi.fn(async () => { entered(); await blocked; return { id: "ac_login" }; });
      const first = f.run("/api/auth/twitch/start", {}); await started;
      const second = await f.run("/api/auth/twitch/start", {});
      expect(second.status).toBe(503); expect(await second.json()).toEqual({ error: "TWITCH_LOGIN_INITIALIZING_RETRY" });
      release(); expect((await first).status).toBe(200); expect(f.client.createProfileConfig).toHaveBeenCalledTimes(1);
    } finally { f.sqlite.close(); }
  });
  it("allows exactly one session when callback deliveries overlap", async () => {
    const f = fixture(); try {
      const start = await f.start();
      const results = await Promise.all([f.run(start.callback, undefined, start.cookie), f.run(start.callback, undefined, start.cookie)]);
      expect(results.map(r => r.status).sort()).toEqual([303, 403]);
      expect(f.client.profile).toHaveBeenCalledTimes(1);
      expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM twitch_auth_sessions").get()).toMatchObject({ n: 1 });
    } finally { f.sqlite.close(); }
  });
  it("applies a global issuance limit even when an edge IP is unavailable", async () => {
    const f = fixture(); try {
      f.sqlite.prepare("INSERT INTO twitch_auth_rate_limits VALUES ('global',?,240)").run(Date.now());
      expect((await f.run("/api/auth/twitch/start", {}, "", "https://world.test", "")).status).toBe(429);
      expect(f.factory).not.toHaveBeenCalled();
    } finally { f.sqlite.close(); }
  });
  it("bounds request bodies before config creation and prevents cross-origin logout", async () => {
    const f = fixture(); try {
      expect((await f.run("/api/auth/twitch/start", { returnTo: "/world?world=" + "x".repeat(2000) })).status).toBe(413);
      expect(f.factory).not.toHaveBeenCalled();
      const signed = await f.login();
      expect((await f.run("/api/auth/logout", {}, signed.sessionCookie, "https://evil.test")).status).toBe(403);
      expect((await resolveTwitchSession(f.request("/api/auth/session", undefined, signed.sessionCookie), f.env))?.twitchId).toBe("123");
    } finally { f.sqlite.close(); }
  });
});
