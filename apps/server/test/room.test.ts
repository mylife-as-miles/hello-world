import { afterEach, describe, expect, it } from "vitest";
import type { ServerMessage } from "@hello-world/contracts";
import { WorldRoom } from "../src/room.js";
import type { Peer } from "../src/room.js";
import { appearance, event, testFactory } from "./fixture.js";

const rooms: WorldRoom[] = [];
afterEach(async () => {
  await Promise.all(rooms.splice(0).map((room) => room.close()));
});
function setup() {
  const room = new WorldRoom({
    runtime: testFactory({ worldId: "test" }),
    factory: testFactory,
    worldId: "test",
    directorKey: "a-private-director-key",
    settings: {
      approvalRequired: false,
      cooldownSeconds: 2,
      maxResidents: 2,
      paused: false,
    },
  });
  rooms.push(room);
  const messages: ServerMessage[] = [];
  const peer: Peer = {
    id: "peer",
    viewerId: "viewer:real-id",
    director: false,
    send: (message) => messages.push(message),
  };
  room.add(peer);
  const send = (
    kind: Parameters<typeof event>[0],
    overrides: Parameters<typeof event>[1] = {},
  ) => room.receive(peer, { type: "event", event: event(kind, overrides) });
  return { room, peer, messages, send };
}
describe("authoritative world permissions", () => {
  it("replaces forged browser identity, source, event ID and timestamp", () => {
    const { room, send } = setup();
    send("join", {
      source: "twitch",
      actorId: "twitch:broadcaster",
      timestamp: 1,
      payload: { appearance },
    });
    const join = room.getSnapshot().eventHistory[0];
    expect(join.actorId).toBe("viewer:real-id");
    expect(join.source).toBe("viewer");
    expect(join.id).toMatch(/^browser:/);
    expect(join.timestamp).toBeGreaterThan(1);
    expect(room.getSnapshot().residents[0].appearance).toEqual(appearance);
  });
  it("rejects viewer world events, reset, settings and invalid payload keys", () => {
    const { room, peer, messages, send } = setup();
    send("weather", { payload: { weather: "rain" } });
    room.receive(peer, { type: "reset" });
    room.receive(peer, {
      type: "director-settings",
      settings: { paused: true },
    });
    send("join", { payload: { script: "process.exit()" } as never });
    expect(room.getSnapshot().weather).toBe("sunny");
    expect(room.getSnapshot().residents).toHaveLength(0);
    expect(messages.filter((m) => m.type === "error")).toHaveLength(4);
  });
  it("requires resident membership and applies viewer cooldowns", () => {
    const { room, messages, send } = setup();
    send("wave");
    send("join");
    send("wave");
    send("dance");
    expect(room.getSnapshot().eventHistory.map((e) => e.kind)).toEqual([
      "join",
      "wave",
    ]);
    expect(
      messages
        .filter((m) => m.type === "error")
        .map((m) => m.message)
        .join(" "),
    ).toContain("cooldown");
  });
  it("queues viewer actions privately and accepts an authenticated approval once", () => {
    const { room, peer, messages, send } = setup();
    send("join");
    const directorMessages: ServerMessage[] = [];
    const director: Peer = {
      id: "director",
      viewerId: "viewer:director",
      director: true,
      send: (m) => directorMessages.push(m),
    };
    room.add(director);
    room.receive(director, {
      type: "director-settings",
      settings: { approvalRequired: true },
    });
    send("wave");
    expect(room.getSnapshot().eventHistory).toHaveLength(1);
    expect(room.pending.size).toBe(1);
    expect(messages.filter((m) => m.type === "status").at(-1)?.pending).toEqual(
      [],
    );
    const pending = [...room.pending.values()][0];
    expect(
      directorMessages.filter((m) => m.type === "status").at(-1)?.pending,
    ).toHaveLength(1);
    room.receive(peer, { type: "approve", eventId: pending.id });
    expect(room.pending.size).toBe(1);
    room.receive(director, { type: "approve", eventId: pending.id });
    expect(room.pending.size).toBe(0);
    expect(room.getSnapshot().eventHistory.at(-1)?.actorId).toBe(peer.viewerId);
    room.receive(director, { type: "approve", eventId: pending.id });
    expect(room.getSnapshot().eventHistory).toHaveLength(2);
  });
  it("only authenticated directors can create separate demo residents, respecting the population cap", () => {
    const { room, peer, send } = setup();
    send("join", { source: "demo", actorId: "demo:first" });
    expect(room.getSnapshot().residents[0].id).toBe(peer.viewerId);
    room.receive(peer, {
      type: "director-auth",
      key: "a-private-director-key",
    });
    send("join", {
      source: "demo",
      actorId: "demo:second",
      actorDisplayName: "Luna",
    });
    send("join", {
      source: "demo",
      actorId: "demo:third",
      actorDisplayName: "No room",
    });
    expect(room.getSnapshot().residents.map((r) => r.id)).toEqual([
      peer.viewerId,
      "demo:second",
    ]);
  });
  it("rejects unrestricted custom actions and mismatched event payloads", () => {
    const { room, send } = setup();
    send("join");
    send("custom", { payload: { action: "celebrate" } });
    send("wave", { payload: { weather: "snow" } });
    send("custom", { payload: { action: "update-avatar", appearance } });
    expect(room.getSnapshot().eventHistory.map((e) => e.kind)).toEqual([
      "join",
      "custom",
    ]);
  });
  it("deduplicates trusted Twitch event IDs and honors interaction pause", () => {
    const { room, peer, send } = setup();
    const join = event("join", {
      id: "twitch:chat:unique",
      actorId: "twitch:123",
      source: "twitch",
    });
    expect(room.dispatchTrusted(join).accepted).toBe(true);
    expect(room.dispatchTrusted(join).accepted).toBe(true);
    expect(room.getSnapshot().residents).toHaveLength(1);
    peer.director = true;
    room.receive(peer, {
      type: "director-settings",
      settings: { paused: true },
    });
    peer.director = false;
    send("join");
    expect(room.getSnapshot().residents).toHaveLength(1);
    expect(
      room.dispatchTrusted(
        event("wave", { source: "twitch", actorId: "twitch:123" }),
      ).accepted,
    ).toBe(false);
  });
});
