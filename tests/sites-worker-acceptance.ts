/** Reproduce: pnpm --filter @hello-world/server exec tsx ../../tests/sites-worker-acceptance.ts
 * Node 22.13+ (node:sqlite). Uses the real engine and real SQLite behind a D1 API shim.
 * This verifies the adapter locally; it does not claim native D1 deployment or Twitch delivery.
 */
import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { WorldEvent, WorldSnapshot } from "@hello-world/contracts";
import worker from "../apps/server/src/sites-worker.ts";

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
    sqlite.exec(
      readFileSync(
        new URL(
          "../apps/server/sites-migrations/0001_world.sql",
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
      DIRECTOR_OWNER_EMAIL: "owner@example.test",
    };
    const send = async (
      path: string,
      user = "owner-test",
      message?: unknown,
      origin = "https://world.test",
    ) => {
      const request = new Request(`https://world.test${path}`, {
        method: message ? "POST" : "GET",
        headers: {
          ...(user ? { "oai-authenticated-user-id": user, "oai-authenticated-user-email": user === "owner-test" ? "owner@example.test" : "viewer@example.test" } : {}),
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
      headers: { "oai-authenticated-user-id": "owner-test", "oai-authenticated-user-email": "owner@example.test" },
    }), { ...env, DIRECTOR_OWNER_EMAIL: undefined });
    equal((await missingOwner.json() as Reply).authorized, false);
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
          "oai-authenticated-user-id": "ordinary-user",
          Origin: "https://world.test",
        },
        body: JSON.stringify(weather),
      }),
      env,
    );
    equal(denied.status, 403);
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
