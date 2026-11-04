/** Reproduce: pnpm --filter @hello-world/server exec tsx ../../tests/sites-worker-acceptance.ts
 * Node 22.13+ (node:sqlite). Uses the real engine and real SQLite behind a D1 API shim.
 * This verifies the adapter locally; it does not claim native D1 deployment or Twitch delivery.
 */
import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { WorldEvent, WorldSnapshot } from "@hello-world/contracts";
import worker from "../apps/server/src/sites-worker.ts";
import { fixtureTwitchCookie } from "./helpers/twitch-login.ts";

interface Reply {
  authorized: boolean;
  mode: string;
  viewerId: string;
  clients: number;
  snapshot: WorldSnapshot;
}
let checks = 0;
function equal(actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected);
  checks++;
}
function ok(condition: unknown) {
  assert.ok(condition);
  checks++;
}

async function main() {
  const sqlite = new DatabaseSync(":memory:");
  try {
    for (const name of ["0001_world.sql", "0002_twitch.sql", "0003_twitch_delivery.sql", "0004_composio_profile.sql", "0005_twitch_users.sql"]) sqlite.exec(
      readFileSync(
        new URL(
          "../apps/server/sites-migrations/" + name,
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const db = {
      prepare(sql: string) {
        let values: unknown[] = [];
        const statement = {
          bind(...bound: unknown[]) {
            values = bound;
            return statement;
          },
          async first<T>() {
            // Yield so concurrent fetches can observe the same revision and exercise CAS retries.
            await Promise.resolve();
            return (sqlite.prepare(sql).get(...(values as SQLInputValue[])) ||
              null) as T | null;
          },
          async run() {
            await Promise.resolve();
            const result = sqlite
              .prepare(sql)
              .run(...(values as SQLInputValue[]));
            return { meta: { changes: Number(result.changes) } };
          },
        };
        return statement;
      },
    };
    const env = {
      WORLD_DB: db,
      ASSETS: { fetch: async () => new Response("asset") },
      AUTH_SESSION_SECRET: "fixture-auth-secret-over-32-characters",
      COMPOSIO_OAUTH_VERIFIER_URL: "https://world.test/api/auth/twitch/verify",
      COMPOSIO_API_KEY: "fixture-composio-key",
      WORLD_ID: "twitch-123",
      DIRECTOR_OWNER_EMAIL: "owner@example.test",
    };
    const cookies = new Map<string, string>();
    const userIds: Record<string, string> = { "owner-test": "123", "ordinary-user": "456", "user-a": "42", "user-b": "43", observer: "44" };
    async function signedCookie(user: string) {
      if (!user) return "";
      if (!cookies.has(user)) cookies.set(user, await fixtureTwitchCookie(env, userIds[user] || "999"));
      return cookies.get(user)!;
    }
    const send = async (
      path: string,
      user = "owner-test",
      message?: unknown,
      origin = "https://world.test",
    ) => {
      const request = new Request(`https://world.test${path}`, {
        method: message ? "POST" : "GET",
        headers: {
          ...(user ? { Cookie: await signedCookie(user) } : {}),
          ...(message
            ? { "Content-Type": "application/json", Origin: origin }
            : {}),
        },
        ...(message ? { body: JSON.stringify(message) } : {}),
      });
      const response = await worker.fetch(request, env);
      return {
        status: response.status,
        data: (await response.json()) as Reply,
      };
    };
    const event = (name: string): { type: "event"; event: WorldEvent } => ({
      type: "event",
      event: {
        id: crypto.randomUUID(),
        kind: "join",
        source: "twitch",
        actorId: "forged-twitch-id",
        actorDisplayName: name,
        timestamp: 1,
      },
    });
    for (const path of ["/world", "/director", "/overlay?camera=wide&renderer=webgpu"]) {
      let assetPath = "";
      const response = await worker.fetch(new Request(`https://world.test${path}`), {
        ...env,
        ASSETS: { fetch: async (request: Request) => {
          assetPath = new URL(request.url).pathname;
          return new Response("app entry");
        } },
      });
      equal(response.status, 200);
      equal(assetPath, "/");
    }
    const publicView = await send("/api/snapshot", "");
    equal(publicView.status, 200);
    equal(publicView.data.authorized, false);
    ok(publicView.data.snapshot.residents.length > 0);
    equal((await send("/api/messages", "", event("Anonymous"))).status, 401);
    equal((await send("/api/messages", "", { type: "reset" })).status, 401);
    const viewerStatus = await send("/api/status", "ordinary-user");
    equal(viewerStatus.status, 200);
    equal(viewerStatus.data.authorized, false);
    for (const message of [
      { type: "reset" },
      { type: "director-settings", settings: { maxResidents: 1 } },
      { type: "approve", eventId: "anything" },
      { type: "director-auth", key: "pretend-owner" },
    ]) equal((await send("/api/messages", "ordinary-user", message)).status, 403);
    const missingOwner = await worker.fetch(new Request("https://world.test/api/status", {
      headers: { Cookie: await signedCookie("owner-test") },
    }), { ...env, DIRECTOR_OWNER_EMAIL: undefined });
    // Twitch world ownership is independent of any ChatGPT account/email.
    equal((await missingOwner.json() as Reply).authorized, true);
    const emailWithoutIdentity = await worker.fetch(new Request("https://world.test/api/status", {
      headers: { "oai-authenticated-user-email": "owner@example.test" },
    }), env);
    equal((await emailWithoutIdentity.json() as Reply).authorized, false);
    const initial = await send("/api/snapshot");
    equal(initial.status, 200);
    equal(initial.data.authorized, true);
    equal(initial.data.mode, "demo");
    const seedCount = initial.data.snapshot.residents.length;
    ok(seedCount > 0);
    const joined = await send("/api/messages", "owner-test", event("Owner"));
    equal(joined.status, 200);
    equal(joined.data.snapshot.residents.length, seedCount + 1);
    equal(joined.data.snapshot.residents.at(-1)?.id, initial.data.viewerId);
    equal(joined.data.snapshot.eventHistory.at(-1)?.source, "viewer");
    const sameUser = await send("/api/status", "owner-test");
    equal(sameUser.data.viewerId, initial.data.viewerId);
    const concurrent = await Promise.all([
      send("/api/messages", "user-a", event("A")),
      send("/api/messages", "user-b", event("B")),
    ]);
    equal(
      concurrent.map((result) => result.status),
      [200, 200],
    );
    const final = await send("/api/snapshot", "observer");
    equal(final.data.snapshot.residents.length, seedCount + 3);
    ok(final.data.clients >= 4);
    const invalid = event("Script");
    invalid.event.payload = { SCRIPT: "no" };
    equal((await send("/api/messages", "owner-test", invalid)).status, 400);
    equal(
      (
        await send(
          "/api/messages",
          "owner-test",
          event("Evil"),
          "https://evil.test",
        )
      ).status,
      403,
    );
    const weather = {
      type: "event",
      event: {
        ...event("Owner").event,
        kind: "weather",
        payload: { weather: "snow" },
      },
    };
    const denied = await worker.fetch(
      new Request("https://world.test/api/messages", {
        method: "POST",
        headers: {
          Cookie: await signedCookie("ordinary-user"),
          Origin: "https://world.test",
        },
        body: JSON.stringify(weather),
      }),
      env,
    );
    equal(denied.status, 403);
    // Every streamer owns a separate world; viewers retain only their own actor.
    const otherWorld = await send("/api/status?world=twitch-42", "user-a");
    equal(otherWorld.data.authorized, true);
    equal((await send("/api/status?world=twitch-42", "owner-test")).data.authorized, false);
    equal((await send("/api/messages?world=twitch-42", "owner-test", { type: "reset" })).status, 403);
    equal((await send("/api/messages?world=twitch-42", "user-a", { type: "director-settings", settings: { maxResidents: 25 } })).status, 200);
    const untouched = await send("/api/status?world=twitch-123", "owner-test");
    equal((untouched.data as any).settings.maxResidents, 50);
    const otherJoin = await send("/api/messages?world=twitch-42", "user-a", event("My own world"));
    equal(otherJoin.data.snapshot.worldId, "twitch-42");
    equal(otherJoin.data.snapshot.residents.at(-1)?.id, "twitch:42");
    equal(otherJoin.data.snapshot.residents.length, seedCount + 1);
    equal((await send("/api/snapshot?world=twitch-123", "owner-test")).data.snapshot.residents.length, seedCount + 3);
    equal((await send("/api/snapshot?world=twitch-987654", "owner-test")).status, 404);
    console.log(
      JSON.stringify({
        checks,
        seedResidents: seedCount,
        afterConcurrentJoins: final.data.snapshot.residents.length,
        activeIdentities: final.data.clients,
        sharedPersistence: true,
        forgedIdentityRewritten: true,
        invalidPayloadRejected: true,
        unauthorizedWorldEventRejected: true,
      }),
    );
  } finally {
    sqlite.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
