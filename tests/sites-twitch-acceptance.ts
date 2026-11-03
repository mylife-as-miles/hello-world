/** Run: pnpm --filter @hello-world/server exec tsx ../../tests/sites-twitch-acceptance.ts
 * Real SQLite and world runtime; Twitch HTTP responses are mocked, not live delivery.
 */
import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../apps/server/src/sites-worker.ts";
let checks = 0;
const eq = (a: unknown, b: unknown) => {
  assert.deepEqual(a, b);
  checks++;
};
const ok = (a: unknown) => {
  assert.ok(a);
  checks++;
};
async function main() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of ["0001_world.sql", "0002_twitch.sql"])
    sqlite.exec(
      readFileSync(
        new URL("../apps/server/sites-migrations/" + name, import.meta.url),
        "utf8",
      ),
    );
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const s = {
        bind(...v: unknown[]) {
          args = v;
          return s;
        },
        async first<T>() {
          await Promise.resolve();
          return (sqlite.prepare(sql).get(...(args as SQLInputValue[])) ||
            null) as T | null;
        },
        async run() {
          await Promise.resolve();
          return {
            meta: {
              changes: Number(
                sqlite.prepare(sql).run(...(args as SQLInputValue[])).changes,
              ),
            },
          };
        },
      };
      return s;
    },
  };
  const env = {
    WORLD_DB: db,
    ASSETS: { fetch: async () => new Response("asset") },
    DIRECTOR_OWNER_EMAIL: "owner@example.test",
    TWITCH_CLIENT_ID: "test-app",
    TWITCH_CLIENT_SECRET: "test-secret",
    TWITCH_REDIRECT_URI: "https://world.test/api/twitch/callback",
    TWITCH_EVENTSUB_CALLBACK: "https://relay.test/api/twitch/webhook",
    TWITCH_WEBHOOK_SECRET: "a".repeat(64),
    TWITCH_TOKEN_ENCRYPTION_KEY: btoa("x".repeat(32)),
    TWITCH_BROADCASTER_ID: "123",
    TWITCH_BROADCASTER_NAME: "miles",
  };
  const originalFetch = globalThis.fetch;
  let wrongApp = false;
  let subscriptions: any[] = [];
  let validations = 0;
  let refreshes = 0;
  globalThis.fetch = async (input: any, init: any) => {
    const url = String(input);
    if (url.endsWith("/oauth2/token")) {
      const body = new URLSearchParams(init.body);
      if (body.get("grant_type") === "refresh_token") refreshes++;
      return Response.json(
        body.get("grant_type") === "client_credentials"
          ? { access_token: "test-app-access", expires_in: 3600 }
          : {
              access_token: "test-user-access",
              refresh_token: "test-user-refresh",
              expires_in: 3600,
              scope: [
                "user:read:chat",
                "user:bot",
                "channel:bot",
                "channel:read:subscriptions",
                "channel:read:redemptions",
              ],
            },
      );
    }
    if (url.endsWith("/oauth2/validate")) {
      validations++;
      return Response.json({
        client_id: wrongApp ? "wrong-app" : "test-app",
        user_id: "123",
        login: "miles",
        scopes: [
          "user:read:chat",
          "user:bot",
          "channel:bot",
          "channel:read:subscriptions",
          "channel:read:redemptions",
        ],
        expires_in: 3600,
      });
    }
    if (url.endsWith("/helix/eventsub/subscriptions")) {
      eq(init.headers.Authorization, "Bearer test-app-access");
      subscriptions.push(JSON.parse(init.body));
      return Response.json(
        { data: [{ status: "webhook_callback_verification_pending" }] },
        { status: 202 },
      );
    }
    throw new Error("Unexpected fetch " + url);
  };
  try {
    const request = async (path: string, user = "owner", body?: unknown) =>
      worker.fetch(
        new Request("https://world.test" + path, {
          method: body ? "POST" : "GET",
          headers: {
            ...(user ? { "oai-authenticated-user-id": user, "oai-authenticated-user-email": user === "owner" ? "owner@example.test" : "viewer@example.test" } : {}),
            ...(body
              ? {
                  Origin: "https://world.test",
                  "Content-Type": "application/json",
                }
              : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
        env,
      );
    let status = (await (await request("/api/status")).json()) as any;
    eq(status.oauthConfigured, true);
    eq(status.mode, "demo");
    eq((await request("/api/twitch/connect", "", { start: true })).status, 401);
    const start = await request("/api/twitch/connect", "owner", {
      start: true,
    });
    eq(start.status, 200);
    const startJSON = (await start.json()) as any;
    ok(!JSON.stringify(startJSON).includes("test-secret"));
    const authURL = new URL(startJSON.authorizeUrl);
    eq(authURL.origin, "https://id.twitch.tv");
    const state = authURL.searchParams.get("state")!;
    ok(authURL.searchParams.get("scope")!.includes("user:bot"));
    eq(
      (await request("/api/twitch/connect", "intruder", { start: true }))
        .status,
      403,
    );
    eq(
      (
        await request(
          "/api/twitch/callback?state=" + state + "&code=test-code",
          "intruder",
        )
      ).status,
      403,
    );
    eq(
      (await request("/api/messages", "intruder", { type: "reset" })).status,
      403,
    );
    const callback = await request(
      "/api/twitch/callback?state=" + state + "&code=test-code",
    );
    eq(callback.status, 303);
    eq(
      callback.headers.get("Location"),
      "https://world.test/director?twitch=connected",
    );
    eq(subscriptions.length, 6);
    eq(subscriptions.find((s) => s.type === "channel.chat.message").condition, {
      broadcaster_user_id: "123",
      user_id: "123",
    });
    const row = sqlite.prepare("SELECT * FROM twitch_accounts").get() as any;
    ok(!row.token_cipher.includes("test-user-access"));
    ok(!row.token_cipher.includes("test-user-refresh"));
    ok(
      !JSON.stringify(await (await request("/api/status")).json()).includes(
        "test-user-access",
      ),
    );
    eq(
      (await request("/api/twitch/callback?state=" + state + "&code=test-code"))
        .status,
      403,
    );
    const webhook = async (
      payload: any,
      type: string,
      id = crypto.randomUUID(),
      timestamp = new Date().toISOString(),
      tamper = false,
      rawPrefix = "",
    ) => {
      const raw = rawPrefix + JSON.stringify(payload);
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(env.TWITCH_WEBHOOK_SECRET),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const mac = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(id + timestamp + raw),
      );
      const signature = Array.from(new Uint8Array(mac), (n) =>
        n.toString(16).padStart(2, "0"),
      ).join("");
      return worker.fetch(
        new Request("https://world.test/api/twitch/webhook", {
          method: "POST",
          headers: {
            "Twitch-Eventsub-Message-Id": id,
            "Twitch-Eventsub-Message-Timestamp": timestamp,
            "Twitch-Eventsub-Message-Type": type,
            "Twitch-Eventsub-Message-Signature": "sha256=" + signature,
          },
          body: tamper ? raw + " " : raw,
        }),
        env,
      );
    };
    const subscription = {
      type: "channel.chat.message",
      condition: { broadcaster_user_id: "123", user_id: "123" },
      status: "enabled",
    };
    const bytePreserved = await webhook(
      { challenge: "raw-byte-proof", subscription },
      "webhook_callback_verification",
      crypto.randomUUID(),
      new Date().toISOString(),
      false,
      "\uFEFF",
    );
    eq(bytePreserved.status, 200);
    eq(await bytePreserved.text(), "raw-byte-proof");
    eq(
      (
        await webhook(
          { challenge: "x".repeat(70000), subscription },
          "webhook_callback_verification",
        )
      ).status,
      413,
    );
    const challengeId = crypto.randomUUID();
    const challenge = await webhook(
      { challenge: "challenge-exact", subscription },
      "webhook_callback_verification",
      challengeId,
    );
    eq(challenge.status, 200);
    eq(await challenge.text(), "challenge-exact");
    eq(
      await (
        await webhook(
          { challenge: "challenge-exact", subscription },
          "webhook_callback_verification",
          challengeId,
        )
      ).text(),
      "challenge-exact",
    );
    eq(
      (
        await webhook(
          { challenge: "bad", subscription },
          "webhook_callback_verification",
          crypto.randomUUID(),
          new Date().toISOString(),
          true,
        )
      ).status,
      403,
    );
    eq(
      (
        await webhook(
          { challenge: "stale", subscription },
          "webhook_callback_verification",
          crypto.randomUUID(),
          new Date(Date.now() - 700000).toISOString(),
        )
      ).status,
      403,
    );
    eq(
      (
        await webhook(
          { challenge: "future", subscription },
          "webhook_callback_verification",
          crypto.randomUUID(),
          new Date(Date.now() + 120000).toISOString(),
        )
      ).status,
      403,
    );
    const id = crypto.randomUUID();
    const payload = {
      subscription,
      event: {
        chatter_user_id: "42",
        chatter_user_name: "Ada",
        message: { text: "!join" },
      },
    };
    eq((await webhook(payload, "notification", id)).status, 204);
    eq((await webhook(payload, "notification", id)).status, 204);
    const snapshot = (await (await request("/api/snapshot")).json()) as any;
    eq(
      snapshot.snapshot.residents.filter((r: any) => r.id === "twitch:42")
        .length,
      1,
    );
    eq(
      snapshot.snapshot.eventHistory.filter(
        (e: any) => e.id === "twitch:webhook:" + id,
      ).length,
      1,
    );
    eq(snapshot.mode, "live");
    const concurrent = await Promise.all(
      ["44", "45"].map((user) =>
        webhook(
          {
            subscription,
            event: {
              chatter_user_id: user,
              chatter_user_name: "Guest" + user,
              message: { text: "!join" },
            },
          },
          "notification",
        ),
      ),
    );
    eq(
      concurrent.map((result) => result.status),
      [204, 204],
    );
    const shared = (await (await request("/api/snapshot")).json()) as any;
    eq(
      shared.snapshot.residents.filter((resident: any) =>
        ["twitch:42", "twitch:44", "twitch:45"].includes(resident.id),
      ).length,
      3,
    );
    eq(
      (
        await webhook(
          {
            subscription: {
              ...subscription,
              condition: { broadcaster_user_id: "999" },
            },
            event: payload.event,
          },
          "notification",
        )
      ).status,
      403,
    );
    eq(
      (
        await webhook(
          {
            subscription: { ...subscription, status: "authorization_revoked" },
          },
          "revocation",
        )
      ).status,
      204,
    );
    status = await (await request("/api/status")).json();
    eq(
      status.capabilities["channel.chat.message"],
      "revoked (authorization_revoked)",
    );
    eq(status.mode, "demo");
    const beforeCipher = (
      sqlite.prepare("SELECT token_cipher FROM twitch_accounts").get() as any
    ).token_cipher;
    const another = (await (
      await request("/api/twitch/connect", "owner", { start: true })
    ).json()) as any;
    wrongApp = true;
    eq(
      (
        await request(
          "/api/twitch/callback?state=" +
            new URL(another.authorizeUrl).searchParams.get("state") +
            "&code=wrong",
        )
      ).status,
      403,
    );
    eq(
      (sqlite.prepare("SELECT token_cipher FROM twitch_accounts").get() as any)
        .token_cipher,
      beforeCipher,
    );
    wrongApp = false;
    const beforeValidation = validations;
    sqlite
      .prepare("UPDATE twitch_accounts SET validated_at = ?")
      .run(Date.now() - 3600001);
    await request("/api/status");
    ok(validations > beforeValidation);
    const beforeRefresh = refreshes;
    sqlite
      .prepare("UPDATE twitch_accounts SET expires_at = ?, validated_at = ?")
      .run(Date.now() - 1000, Date.now() - 3600001);
    const refreshed = await Promise.all([
      request("/api/status"),
      request("/api/status"),
      request("/api/status"),
    ]);
    eq(
      refreshed.map((result) => result.status),
      [200, 200, 200],
    );
    eq(refreshes - beforeRefresh, 1);
    const expiredStart = (await (
      await request("/api/twitch/connect", "owner", { start: true })
    ).json()) as any;
    sqlite
      .prepare(
        "UPDATE twitch_oauth_states SET expires_at = ? WHERE consumed = 0",
      )
      .run(Date.now() - 1000);
    eq(
      (
        await request(
          "/api/twitch/callback?state=" +
            new URL(expiredStart.authorizeUrl).searchParams.get("state") +
            "&code=expired",
        )
      ).status,
      403,
    );
    const encrypted = JSON.parse(
      (sqlite.prepare("SELECT token_cipher FROM twitch_accounts").get() as any)
        .token_cipher,
    );
    encrypted.cipher = "A" + encrypted.cipher.slice(1);
    sqlite
      .prepare("UPDATE twitch_accounts SET token_cipher = ?, validated_at = ?")
      .run(JSON.stringify(encrypted), Date.now() - 3600001);
    const corrupted = (await (await request("/api/status")).json()) as any;
    eq(corrupted.mode, "demo");
    eq(
      corrupted.capabilities.authorization,
      "validation or refresh failed; reconnect required",
    );
    ok(!JSON.stringify(corrupted).includes("test-user-access"));
    const blockedId = crypto.randomUUID();
    eq(
      (
        await webhook(
          {
            subscription,
            event: {
              chatter_user_id: "999",
              chatter_user_name: "Blocked",
              message: { text: "!join" },
            },
          },
          "notification",
          blockedId,
        )
      ).status,
      403,
    );
    const afterBlocked = (await (await request("/api/snapshot")).json()) as any;
    eq(afterBlocked.mode, "demo");
    eq(
      afterBlocked.snapshot.residents.some(
        (resident: any) => resident.id === "twitch:999",
      ),
      false,
    );
    // Even a valid late challenge cannot revive a failed OAuth session.
    eq(
      (
        await webhook(
          { challenge: "late-challenge", subscription },
          "webhook_callback_verification",
        )
      ).status,
      200,
    );
    eq(((await (await request("/api/status")).json()) as any).mode, "demo");
    console.log(
      JSON.stringify({
        checks,
        subscriptions: subscriptions.length,
        encryptedTokens: true,
        ownerBoundOAuth: true,
        signedWebhookDispatch: true,
        persistentDedupe: true,
        wrongAccountPreservesToken: true,
      }),
    );
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
