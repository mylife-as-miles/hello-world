/**
 * Acceptance checks against the real engine + real server, never the unit fixture.
 * Run after the complete engine is integrated and pnpm install has linked it:
 * pnpm --filter @hello-world/server exec tsx ../../tests/runtime-acceptance.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  AvatarAppearance,
  ServerMessage,
  WorldEvent,
  WorldEventKind,
  WorldRuntime,
  WorldRuntimeOptions,
  WorldSnapshot,
} from "../packages/contracts/src/index.js";
import { createWorldServer } from "../apps/server/src/server.js";
import { readConfig } from "../apps/server/src/config.js";
import { SnapshotStore } from "../apps/server/src/persistence.js";
import type { RuntimeFactory } from "../apps/server/src/room.js";

async function main() {
  const serverRequire = createRequire(
    resolve(dirname(process.argv[1]), "../apps/server/package.json"),
  );
  const evidence = {
    startedAt: new Date().toISOString(),
    engineEntry: "",
    checks: [] as Array<{
      name: string;
      passed: true;
      detail?: Record<string, unknown>;
    }>,
    passed: false,
    failure: undefined as string | undefined,
    finishedAt: undefined as string | undefined,
  };
  const reportPath = resolve(
    process.env.RUNTIME_ACCEPTANCE_REPORT ||
      join(tmpdir(), "hello-world-runtime-acceptance-report.json"),
  );
  const directories: string[] = [];
  const runtimes = new Set<WorldRuntime & { dispose?: () => void }>();
  type App = Awaited<ReturnType<typeof createWorldServer>>;
  const servers = new Set<App>();
  const sockets = new Set<any>();
  const sleep = (ms: number) =>
    new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms));
  const check = (name: string, detail?: Record<string, unknown>) => {
    evidence.checks.push({ name, passed: true, ...(detail ? { detail } : {}) });
    console.log(`PASS ${name}`);
  };
  async function until(
    predicate: () => boolean | Promise<boolean>,
    label: string,
    timeoutMs = 6000,
  ) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await predicate()) return;
      await sleep(25);
    }
    throw new Error(`Timed out waiting for ${label}`);
  }
  function event(
    kind: WorldEventKind,
    actorId: string,
    name: string,
    extra: Partial<WorldEvent> = {},
  ): WorldEvent {
    return {
      id: `acceptance:${randomUUID()}`,
      kind,
      actorId,
      actorDisplayName: name,
      source: "viewer",
      timestamp: Date.now(),
      ...extra,
    };
  }
  function relation(snapshot: WorldSnapshot, a: string, b: string) {
    return snapshot.relationships.find(
      (r) =>
        [r.residentA, r.residentB].includes(a) &&
        [r.residentA, r.residentB].includes(b),
    );
  }
  function resident(snapshot: WorldSnapshot, id: string) {
    const found = snapshot.residents.find((r) => r.id === id);
    assert(found, `Missing resident ${id}`);
    return found;
  }
  const appearance: AvatarAppearance = {
    baseModelId: "townie-classic",
    skinTone: "#8f5838",
    hairStyle: "bob",
    hairColor: "#3b2417",
    outfit: {
      top: "sweater",
      bottom: "jeans",
      shoes: "sneakers",
      color: "#e36aa6",
    },
    accessories: ["glasses"],
    face: { eyeColor: "#2f6a8f", eyeSize: 0.65, noseSize: 0.4, mouthSize: 0.6 },
    body: { height: 0.7, build: 0.4 },
  };

  async function connect(base: string, cookie: string, WebSocket: any) {
    const ws = new WebSocket(`${base.replace(/^http/, "ws")}/ws`, {
      headers: { Origin: "http://localhost:5173", Cookie: cookie },
    });
    sockets.add(ws);
    const messages: ServerMessage[] = [];
    let snapshot: WorldSnapshot | undefined;
    ws.on("message", (data: { toString(): string }) => {
      const message = JSON.parse(data.toString()) as ServerMessage;
      messages.push(message);
      if (message.type === "snapshot") snapshot = message.snapshot;
    });
    ws.on("close", () => sockets.delete(ws));
    await new Promise<void>((resolveOpen, reject) => {
      ws.once("open", resolveOpen);
      ws.once("error", reject);
    });
    await until(
      () => snapshot !== undefined,
      "initial authoritative WebSocket snapshot",
    );
    return {
      ws,
      messages,
      snapshot: () => snapshot!,
      send: (value: unknown) => ws.send(JSON.stringify(value)),
    };
  }
  async function identity(base: string, cookie?: string) {
    const response = await fetch(`${base}/api/status`, {
      headers: cookie ? { Cookie: cookie } : {},
    });
    assert.equal(response.status, 200);
    const status = (await response.json()) as {
      viewerId: string;
      mode: string;
    };
    const nextCookie =
      cookie || response.headers.get("set-cookie")?.split(";")[0];
    assert(nextCookie, "Server did not issue a viewer session cookie");
    return { ...status, cookie: nextCookie };
  }
  async function closeApp(app: App) {
    await app.close();
    servers.delete(app);
  }

  try {
    assert.equal(
      typeof (globalThis as { window?: unknown }).window,
      "undefined",
      "Acceptance must run without browser globals",
    );
    assert.equal(
      typeof (globalThis as { document?: unknown }).document,
      "undefined",
      "Acceptance must run without a DOM",
    );
    let entry: string;
    try {
      entry = serverRequire.resolve("@hello-world/world-engine/runtime");
    } catch {
      throw new Error(
        "Real engine package is unavailable. Integrate the complete @hello-world/world-engine package, add its server workspace dependency and run pnpm install before this acceptance check.",
      );
    }
    evidence.engineEntry = entry;
    const engine = await import(pathToFileURL(entry).href);
    assert.equal(typeof engine.createWorldRuntime, "function");
    const createWorldRuntime = engine.createWorldRuntime as RuntimeFactory;
    check("Real engine runtime imports in Node without browser globals");

    const worldId = "runtime-acceptance-direct";
    const runtime = createWorldRuntime({
      worldId,
      seedResidents: false,
      autoTick: false,
    });
    runtimes.add(runtime);
    assert.equal(runtime.getSnapshot().schemaVersion, 1);
    assert.equal(runtime.getSnapshot().worldId, worldId);
    assert.equal(runtime.getSnapshot().residents.length, 0);
    const notifications: WorldSnapshot[] = [];
    const unsubscribe = runtime.subscribe((snapshot) =>
      notifications.push(snapshot),
    );
    const ava = "acceptance:ava";
    const noah = "acceptance:noah";
    const expectedAppearance: AvatarAppearance =
      typeof engine.normalizeAppearance === "function"
        ? engine.normalizeAppearance(appearance)
        : appearance;
    runtime.dispatch(
      event("join", ava, "Acceptance Ava", {
        payload: { appearance, personality: ["friendly", "curious"] },
      }),
    );
    runtime.dispatch(
      event("join", noah, "Acceptance Noah", {
        payload: {
          appearance: {
            ...appearance,
            outfit: { ...appearance.outfit, color: "#4aa3df" },
          },
          personality: ["kind", "playful"],
        },
      }),
    );
    await until(
      () => runtime.getSnapshot().residents.length === 2,
      "two real engine residents",
    );
    assert.deepEqual(
      resident(runtime.getSnapshot(), ava).appearance,
      expectedAppearance,
    );
    assert(
      resident(runtime.getSnapshot(), ava).personality.includes("friendly"),
    );
    assert(
      resident(runtime.getSnapshot(), ava).personality.includes("curious"),
    );
    assert.equal(
      runtime.getSnapshot().residents.filter((r) => r.id === ava).length,
      1,
    );
    check(
      "Real engine joins preserve stable identity, customized appearance and selected personality",
    );

    runtime.dispatch(
      event("social", ava, "Acceptance Ava", {
        targetId: noah,
        payload: { action: "befriend" },
      }),
    );
    await until(
      () => Boolean(relation(runtime.getSnapshot(), ava, noah)?.friendship),
      "real social relationship",
    );
    const social = relation(runtime.getSnapshot(), ava, noah)!;
    assert(social.friendship > 0);
    assert(
      social.memories.length > 0,
      "Social interaction must record an actual memory",
    );
    check("Real social action creates friendship and a saved memory", {
      friendship: social.friendship,
      memories: social.memories.length,
    });

    const events = [
      event("chat", ava, "Acceptance Ava", { text: "Hello, real runtime." }),
      event("wave", ava, "Acceptance Ava"),
      event("dance", ava, "Acceptance Ava"),
      event("gift", ava, "Acceptance Ava", {
        targetId: noah,
        payload: { amount: 1 },
      }),
      event("weather", ava, "Acceptance Ava", { payload: { weather: "snow" } }),
      event("confetti", ava, "Acceptance Ava", {
        payload: { action: "celebrate" },
      }),
      event("raid", ava, "Acceptance Ava", { payload: { amount: 3 } }),
    ];
    for (const action of events) runtime.dispatch(action);
    await until(
      () =>
        events.every((action) =>
          runtime
            .getSnapshot()
            .eventHistory.some((item) => item.id === action.id),
        ),
      "real normalized event history",
    );
    assert.equal(runtime.getSnapshot().weather, "snow");
    await until(
      () => notifications.length > 0,
      "runtime subscription notification",
    );
    const previousSnapshot = runtime.getSnapshot();
    runtime.dispatch(
      event("custom", ava, "Acceptance Ava", {
        payload: {
          action: "update-avatar",
          appearance: {
            ...appearance,
            outfit: { ...appearance.outfit, color: "#3fb39b" },
          },
        },
      }),
    );
    await until(
      () =>
        resident(runtime.getSnapshot(), ava).appearance.outfit.color ===
        "#3fb39b",
      "real appearance update",
    );
    assert.notEqual(
      runtime.getSnapshot(),
      previousSnapshot,
      "A changed world must publish a new snapshot",
    );
    assert.equal(
      resident(previousSnapshot, ava).appearance.outfit.color,
      expectedAppearance.outfit.color,
      "Previously published snapshot was mutated",
    );
    unsubscribe();
    check(
      "Chat, gesture, gift, weather, celebration, raid and appearance events enter real immutable snapshots",
    );

    // Exercise the product's full-character save path: join creates OR updates.
    // Real wall-clock pacing respects the engine's defensive default join cooldown.
    const beforeRejoin = runtime.getSnapshot();
    const retainedMemories = [
      ...(relation(beforeRejoin, ava, noah)?.memories || []),
    ];
    const retainedFriendship = relation(beforeRejoin, ava, noah)?.friendship;
    const editedAppearance: AvatarAppearance = {
      ...appearance,
      hairStyle: "long",
      outfit: { ...appearance.outfit, color: "#9b6ee1" },
    };
    const expectedEditedAppearance =
      typeof engine.normalizeAppearance === "function"
        ? engine.normalizeAppearance(editedAppearance)
        : editedAppearance;
    await sleep(1650);
    runtime.dispatch(
      event("join", ava, "Acceptance Ava Updated", {
        payload: {
          appearance: editedAppearance,
          personality: ["creative", "bookish"],
        },
      }),
    );
    await until(
      () =>
        resident(runtime.getSnapshot(), ava).appearance.outfit.color ===
          "#9b6ee1" &&
        resident(runtime.getSnapshot(), ava).personality.includes("bookish"),
      "full-character rejoin update",
    );
    assert.equal(
      runtime.getSnapshot().residents.filter((r) => r.id === ava).length,
      1,
    );
    assert.deepEqual(
      resident(runtime.getSnapshot(), ava).appearance,
      expectedEditedAppearance,
    );
    assert.deepEqual(resident(runtime.getSnapshot(), ava).personality, [
      "creative",
      "bookish",
    ]);
    assert.equal(
      resident(runtime.getSnapshot(), ava).displayName,
      "Acceptance Ava Updated",
    );
    assert.equal(
      relation(runtime.getSnapshot(), ava, noah)?.friendship,
      retainedFriendship,
    );
    assert(
      retainedMemories.every((memory) =>
        relation(runtime.getSnapshot(), ava, noah)?.memories.includes(memory),
      ),
      "Full-character save erased existing relationship memory",
    );
    check(
      "Stable-ID full-character save updates appearance/personality while preserving friendship and memories",
    );

    const directDataDir = await mkdtemp(
      join(tmpdir(), "hello-world-runtime-store-"),
    );
    directories.push(directDataDir);
    const store = new SnapshotStore(directDataDir, worldId);
    const savedSnapshot = runtime.getSnapshot();
    store.schedule(savedSnapshot);
    await store.flush();
    assert.equal(store.error, null);
    assert(store.lastSavedAt);
    const loaded = await store.load();
    assert(loaded);
    const restored = createWorldRuntime({
      worldId,
      initialSnapshot: loaded,
      seedResidents: false,
      autoTick: false,
    });
    runtimes.add(restored);
    assert.deepEqual(
      resident(restored.getSnapshot(), ava).appearance,
      resident(savedSnapshot, ava).appearance,
    );
    assert.deepEqual(
      resident(restored.getSnapshot(), ava).personality,
      resident(savedSnapshot, ava).personality,
    );
    assert.deepEqual(
      relation(restored.getSnapshot(), ava, noah)?.memories,
      relation(savedSnapshot, ava, noah)?.memories,
    );
    assert.equal(restored.getSnapshot().weather, savedSnapshot.weather);
    assert.equal(
      restored.getSnapshot().residents.filter((r) => r.id === ava).length,
      1,
    );
    check(
      "Actual SnapshotStore roundtrip restores real resident, personality, relationship memory and weather",
    );
    const ticking = createWorldRuntime({
      worldId,
      initialSnapshot: loaded,
      seedResidents: false,
      autoTick: true,
      tickIntervalMs: 100,
    });
    runtimes.add(ticking);
    const beforeTime = ticking.getSnapshot().simulationTime;
    await until(
      () => ticking.getSnapshot().simulationTime > beforeTime,
      "real autonomous simulation clock",
    );
    ticking.dispose?.();
    runtimes.delete(ticking);
    check("Real simulation advances while its Node runtime is running");

    const networkDataDir = await mkdtemp(
      join(tmpdir(), "hello-world-runtime-network-"),
    );
    directories.push(networkDataDir);
    const config = readConfig({
      PORT: "0",
      HOST: "127.0.0.1",
      DATA_DIR: networkDataDir,
      WORLD_ID: "runtime-acceptance-network",
      WEB_ORIGIN: "http://localhost:5173",
      DIRECTOR_KEY: "runtime-acceptance-private-key",
      ALLOW_LOCAL_DIRECTOR: "false",
    });
    const wsModule = await import(
      pathToFileURL(serverRequire.resolve("ws")).href
    );
    const WebSocket = wsModule.WebSocket || wsModule.default;
    const app = await createWorldServer(config, createWorldRuntime, {
      twitchEnv: {},
    });
    servers.add(app);
    const address = await app.start();
    assert(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const a = await identity(base);
    const b = await identity(base);
    assert.equal(a.mode, "demo");
    assert.notEqual(a.viewerId, b.viewerId);
    const one = await connect(base, a.cookie, WebSocket);
    const two = await connect(base, b.cookie, WebSocket);
    assert(
      one.messages.some((m) => m.type === "director-auth" && !m.authorized),
    );
    one.send({
      type: "event",
      event: event("join", "forged:actor", "Network Ava", {
        payload: { appearance, personality: ["friendly", "curious"] },
      }),
    });
    two.send({
      type: "event",
      event: event("join", "forged:second", "Network Noah", {
        payload: { appearance, personality: ["kind", "playful"] },
      }),
    });
    await until(
      () =>
        one.snapshot().residents.some((r) => r.id === a.viewerId) &&
        two.snapshot().residents.some((r) => r.id === a.viewerId) &&
        one.snapshot().residents.some((r) => r.id === b.viewerId),
      "real joins fanned out to independent sessions",
    );
    assert.deepEqual(
      resident(two.snapshot(), a.viewerId).appearance,
      expectedAppearance,
    );
    assert(!one.snapshot().residents.some((r) => r.id === "forged:actor"));
    check(
      "Two real HTTP/WebSocket sessions receive the same actual-engine resident with server-bound identity",
    );

    one.send({
      type: "event",
      event: event("social", "forged:actor", "Ignored", {
        targetId: b.viewerId,
        payload: { action: "befriend" },
      }),
    });
    await until(
      () =>
        Boolean(relation(one.snapshot(), a.viewerId, b.viewerId)?.friendship) &&
        Boolean(relation(two.snapshot(), a.viewerId, b.viewerId)?.friendship),
      "real social update reaches both sessions",
    );
    const networkRelationship = relation(
      two.snapshot(),
      a.viewerId,
      b.viewerId,
    )!;
    assert(networkRelationship.memories.length > 0);
    const remembered = [...networkRelationship.memories];
    const initialWeather = one.snapshot().weather;
    const deniedId = randomUUID();
    one.send({
      type: "event",
      event: event("weather", "forged:actor", "Ignored", {
        id: deniedId,
        payload: { weather: "snow" },
      }),
    });
    await until(
      () =>
        one.messages.some((m) => m.type === "error" && m.eventId === deniedId),
      "actual-engine server rejects unauthorized weather",
    );
    assert.equal(app.room.getSnapshot().weather, initialWeather);
    one.send({ type: "director-auth", key: "runtime-acceptance-private-key" });
    await until(
      () =>
        one.messages.some((m) => m.type === "director-auth" && m.authorized),
      "Director authentication",
    );
    one.send({
      type: "event",
      event: event("weather", "forged:actor", "Ignored", {
        source: "demo",
        payload: { weather: "sunset" },
      }),
    });
    await until(
      () =>
        one.snapshot().weather === "sunset" &&
        two.snapshot().weather === "sunset",
      "authenticated world weather fanout",
    );
    assert(
      two
        .snapshot()
        .eventHistory.some((e) => e.kind === "weather" && e.source === "demo"),
    );
    check(
      "Real-engine server permissions, relationship memory and labeled Director demo events work across sessions",
    );

    one.ws.terminate();
    two.ws.terminate();
    await closeApp(app);
    const disk = JSON.parse(
      await readFile(join(networkDataDir, "world.json"), "utf8"),
    ) as WorldSnapshot;
    assert.deepEqual(resident(disk, a.viewerId).appearance, expectedAppearance);
    assert(
      remembered.some((memory) =>
        relation(disk, a.viewerId, b.viewerId)?.memories.includes(memory),
      ),
      "Social memory missing from persisted real-engine world",
    );
    const restarted = await createWorldServer(config, createWorldRuntime, {
      twitchEnv: {},
    });
    servers.add(restarted);
    const nextAddress = await restarted.start();
    assert(nextAddress && typeof nextAddress === "object");
    const nextBase = `http://127.0.0.1:${nextAddress.port}`;
    const sameIdentity = await identity(nextBase, a.cookie);
    assert.equal(sameIdentity.viewerId, a.viewerId);
    const reconnected = await connect(nextBase, a.cookie, WebSocket);
    assert.deepEqual(
      resident(reconnected.snapshot(), a.viewerId).appearance,
      expectedAppearance,
    );
    assert.deepEqual(resident(reconnected.snapshot(), a.viewerId).personality, [
      "friendly",
      "curious",
    ]);
    assert(
      remembered.some((memory) =>
        relation(
          reconnected.snapshot(),
          a.viewerId,
          b.viewerId,
        )?.memories.includes(memory),
      ),
    );
    assert.equal(
      reconnected.snapshot().residents.filter((r) => r.id === a.viewerId)
        .length,
      1,
    );
    assert.equal(reconnected.snapshot().weather, "sunset");
    check(
      "Actual engine, saved social memory and signed viewer identity survive a real server restart",
    );
    evidence.passed = true;
  } catch (error) {
    evidence.failure =
      error instanceof Error ? error.stack || error.message : String(error);
    process.exitCode = 1;
    console.error(evidence.failure);
  } finally {
    for (const ws of sockets) ws.terminate();
    for (const app of servers)
      await app.close().catch((error) => {
        evidence.passed = false;
        evidence.failure = `Server cleanup failed: ${String(error)}`;
        console.error(evidence.failure);
        process.exitCode = 1;
      });
    for (const runtime of runtimes) runtime.dispose?.();
    for (const directory of directories)
      await rm(directory, { recursive: true, force: true });
    evidence.finishedAt = new Date().toISOString();
    await writeFile(reportPath, JSON.stringify(evidence, null, 2) + "\n");
    console.log(`Runtime acceptance report: ${reportPath}`);
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
