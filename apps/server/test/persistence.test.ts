import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SnapshotStore } from "../src/persistence.js";
import { parseClientMessage, parseSnapshot } from "../src/validation.js";
import { appearance, event, testFactory } from "./fixture.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("engine snapshot compatibility without loosening ingress", () => {
  it("saves and restores generated history with contract payload extensions and engine-sized text/identities", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hello-world-generated-history-"));
    dirs.push(dir);
    const runtime = testFactory({ worldId: "test" });
    runtime.dispatch(
      event("join", {
        actorId: "r".repeat(128),
        actorDisplayName: "N".repeat(40),
        payload: { appearance },
      }),
    );
    const snapshot = runtime.getSnapshot();
    snapshot.eventHistory.push(
      event("social", {
        id: "e".repeat(128),
        actorId: "r".repeat(128),
        targetId: "t".repeat(128),
        actorDisplayName: "N".repeat(40),
        source: "simulation",
        text: "A".repeat(200),
        payload: {
          action: "befriend",
          destination: "Moonlight cafe",
          item: "lemonade",
          sentiment: 0.8,
          reaction: "delighted",
          line: "A new memory",
          raider: "Juniper",
          channel: "neighbors",
          visitors: 12,
          friendly: true,
          highlights: ["first hello", "shared a gift"],
        },
      }),
    );
    const store = new SnapshotStore(dir, "test");
    store.schedule(snapshot);
    await store.flush();
    const restored = await new SnapshotStore(dir, "test").load();
    expect(restored).toEqual(snapshot);
    expect(
      JSON.parse(
        await readFile(join(dir, "world.json"), "utf8"),
      ).eventHistory.at(-1).payload.destination,
    ).toBe("Moonlight cafe");
    expect(restored?.residents[0].appearance).toEqual(appearance);
  });

  it("keeps unknown script and engine-only metadata out of incoming client actions", () => {
    for (const payload of [
      { SCRIPT: "alert('unsafe')" },
      { destination: "Moonlight cafe" },
      { reaction: "happy" },
    ]) {
      expect(() =>
        parseClientMessage({
          type: "event",
          event: event("join", { payload }),
        }),
      ).toThrow();
    }
  });

  it("rejects unbounded or nested stored metadata instead of accepting arbitrary state", () => {
    const snapshot = testFactory({ worldId: "test" }).getSnapshot();
    const invalidPayloads = [
      { destination: { x: 1, y: 2, script: "no" } },
      { line: "x".repeat(501) },
      { visits: Number.POSITIVE_INFINITY },
      { reaction: Array.from({ length: 17 }, () => "hello") },
      Object.fromEntries(
        Array.from({ length: 25 }, (_, index) => [`key${index}`, true]),
      ),
    ];
    for (const payload of invalidPayloads) {
      const invalid = {
        ...snapshot,
        eventHistory: [event("social", { payload: payload as never })],
      };
      expect(() => parseSnapshot(invalid)).toThrow();
    }
  });
});
