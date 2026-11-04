import { describe, it, expect, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { sqliteD1 } from "../../../tests/helpers/sqlite-d1.js";
import { handleHostedComposio } from "../src/sites-composio.js";
import type { ManagedProfileClient } from "../src/composio-twitch-poc.js";

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../sites-migrations/0004_composio_profile.sql", import.meta.url), "utf8"));
  const client: ManagedProfileClient = {
    toolkit: vi.fn(async () => ({ slug: "twitch", composioManagedAuthSchemes: ["OAUTH2"], authConfigDetails: [{ mode: "OAUTH2", requiredScopes: [] }] })),
    createProfileConfig: vi.fn(async () => ({ id: "ac_profile" })),
    config: vi.fn(async () => ({ isComposioManaged: true, toolkit: { slug: "twitch" }, status: "ENABLED", credentials: { scopes: "" } })),
    authorize: vi.fn(async () => ({ id: "ca_profile", redirectUrl: "https://connect.composio.dev/link/private-consent" })),
    ownedAccounts: vi.fn(async () => ({ items: [{ id: "ca_profile", status: "ACTIVE", toolkit: { slug: "twitch" }, authConfig: { id: "ac_profile" } }] })),
    profile: vi.fn(async () => ({ status: 200, data: { data: [{ id: "123", login: "owner", display_name: "Owner" }] } })),
  };
  const factory = vi.fn(async () => client);
  const env = { WORLD_DB: sqliteD1(sqlite), COMPOSIO_API_KEY: "secret-never-return", TWITCH_TOKEN_ENCRYPTION_KEY: btoa("x".repeat(32)) };
  const request = (action: string, body?: unknown, origin = "https://world.test") => new Request(`https://world.test/api/composio/twitch/${action}`, {
    method: action === "status" ? "GET" : "POST", headers: { Origin: origin, "Content-Type": "application/json" },
    ...(action === "status" ? {} : { body: JSON.stringify(body || { approval: action === "connect" ? "connect-profile" : "read-only" }) }),
  });
  const run = (action: string, body?: unknown) => handleHostedComposio(request(action, body), env, "viewer:owner", true, factory);
  return { sqlite, client, factory, env, request, run };
}
describe("hosted owner-only Composio profile proof", () => {
  it("rejects anonymous/viewer/service callers before touching any project credential", async () => {
    const f = fixture();
    try {
      expect((await handleHostedComposio(f.request("inspect"), f.env, undefined, false, f.factory)).status).toBe(401);
      expect((await handleHostedComposio(f.request("connect"), f.env, "viewer:someone", false, f.factory)).status).toBe(403);
      expect(f.factory).not.toHaveBeenCalled();
    } finally { f.sqlite.close(); }
  });
  it("requires same-origin JSON plus the mode-specific explicit approval", async () => {
    const f = fixture();
    try {
      expect((await handleHostedComposio(f.request("connect", undefined, "https://evil.test"), f.env, "viewer:owner", true, f.factory)).status).toBe(403);
      expect((await f.run("connect", { approval: "read-only" })).status).toBe(400);
      expect(f.factory).not.toHaveBeenCalled();
    } finally { f.sqlite.close(); }
  });
  it("does not use the key on status reads or expose it in the owner response", async () => {
    const f = fixture();
    try {
      const status = await f.run("status"); expect(status.status).toBe(200);
      const raw = await status.text(); expect(raw).toContain('"configured":true'); expect(raw).not.toContain(f.env.COMPOSIO_API_KEY);
      expect(f.factory).not.toHaveBeenCalled();
    } finally { f.sqlite.close(); }
  });
  it("stops unknown/broad scope metadata before any persistent config/connection", async () => {
    const f = fixture();
    try {
      f.client.toolkit = async () => ({ slug: "twitch", composioManagedAuthSchemes: ["OAUTH2"] });
      expect((await f.run("connect")).status).toBe(400);
      expect(f.client.createProfileConfig).not.toHaveBeenCalled();
      expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM composio_profile_proofs").get()).toMatchObject({ n: 0 });
    } finally { f.sqlite.close(); }
  });
  it("atomically reserves one attempt across concurrent owner clicks and never stores plaintext consent URLs", async () => {
    const f = fixture();
    try {
      const results = await Promise.all([f.run("connect"), f.run("connect")]);
      expect(results.map(r => r.status).sort()).toEqual([200, 409]);
      expect(f.client.authorize).toHaveBeenCalledTimes(1);
      const row = f.sqlite.prepare("SELECT * FROM composio_profile_proofs").get();
      expect(JSON.stringify(row)).not.toMatch(/private-consent|secret-never-return|access_token/);
    } finally { f.sqlite.close(); }
  });
  it("resumes an encrypted unexpired consent link after the owner reloads", async () => {
    const f = fixture();
    try {
      const started = await (await f.run("connect")).json();
      const resumed = await (await f.run("status")).json();
      expect(resumed.connectUrl).toBe(started.connectUrl);
      f.env.TWITCH_TOKEN_ENCRYPTION_KEY = btoa("y".repeat(32));
      expect((await f.run("status")).status).toBe(503);
    } finally { f.sqlite.close(); }
  });
  it("does not return an expired link or silently start another persistent connection", async () => {
    const f = fixture();
    try {
      await f.run("connect");
      const row = f.sqlite.prepare("SELECT attempt_json FROM composio_profile_proofs").get() as { attempt_json: string };
      const attempt = JSON.parse(row.attempt_json); attempt.expiresAt = Date.now() - 1;
      f.sqlite.prepare("UPDATE composio_profile_proofs SET attempt_json=?").run(JSON.stringify(attempt));
      const status = await (await f.run("status")).json();
      expect(status.status).toBe("expired-review-required"); expect(status.connectUrl).toBeUndefined();
      expect((await f.run("connect")).status).toBe(409);
      expect(f.client.createProfileConfig).toHaveBeenCalledTimes(1);
    } finally { f.sqlite.close(); }
  });
  it("refuses reset while a persistent connection is being created", async () => {
    const f = fixture();
    try {
      let release!: () => void, entered!: () => void;
      const waiting = new Promise<void>(r => { release = r; });
      const started = new Promise<void>(r => { entered = r; });
      f.client.createProfileConfig = async () => { entered(); await waiting; return { id: "ac_profile" }; };
      const connecting = f.run("connect"); await started;
      const reset = await f.run("reset-proof", { approval: "reset-after-revocation" });
      expect(reset.status).toBe(409);
      expect(await reset.text()).toContain("CONNECTION_CREATION_IN_PROGRESS");
      release(); expect((await connecting).status).toBe(200);
      expect((await (await f.run("status")).json()).status).toBe("awaiting-consent");
    } finally { f.sqlite.close(); }
  });
  it("clears only the owner's local test after explicit revocation review, without provider calls", async () => {
    const f = fixture();
    try {
      await f.run("connect"); const before = f.factory.mock.calls.length;
      expect((await f.run("reset-proof")).status).toBe(400);
      const cleared = await (await f.run("reset-proof", { approval: "reset-after-revocation" })).json();
      expect(cleared.providerRevocationPerformed).toBe(false);
      expect((await (await f.run("status")).json()).status).toBe("not-started");
      expect(f.factory.mock.calls.length).toBe(before);
    } finally { f.sqlite.close(); }
  });
  it("reads only the initiating owner's active profile and always labels live events unverified", async () => {
    const f = fixture();
    try {
      expect((await f.run("connect")).status).toBe(200);
      const proof = await (await f.run("read")).json();
      expect(proof.profileReadVerified).toBe(true); expect(proof.liveEventsVerified).toBe(false);
      expect(f.client.profile).toHaveBeenCalledWith("viewer:owner", "ca_profile");
      const another = await handleHostedComposio(f.request("read"), f.env, "viewer:other-owner", true, f.factory);
      expect(another.status).toBe(409);
      expect(f.client.profile).toHaveBeenCalledTimes(1);
    } finally { f.sqlite.close(); }
  });
  it("hides SDK exception contents and stops automatic reconnection after an uncertain create", async () => {
    const f = fixture();
    try {
      f.client.authorize = async () => { throw new Error("secret-never-return provider-token"); };
      const failed = await f.run("connect");
      expect(await failed.text()).not.toMatch(/secret-never-return|provider-token/);
      expect((await f.run("connect")).status).toBe(409);
      expect(f.client.createProfileConfig).toHaveBeenCalledTimes(1);
    } finally { f.sqlite.close(); }
  });
});
