import type {
  WorldEvent,
  WorldRuntimeOptions,
  WorldSnapshot,
} from "@hello-world/contracts";
import type { RuntimeFactory } from "../src/room.js";
export const appearance = {
  baseModelId: "resident-v1",
  skinTone: "#c99270",
  hairStyle: "short",
  hairColor: "#33251f",
  outfit: {
    top: "tee",
    bottom: "trousers",
    shoes: "sneakers",
    color: "#a4df72",
  },
  accessories: [],
  face: { eyeColor: "#362d24", eyeSize: 0.5, noseSize: 0.5, mouthSize: 0.5 },
  body: { height: 0.5, build: 0.5 },
};
/** Minimal fixture for transport/policy isolation; never shipped as the world runtime. */
export const testFactory: RuntimeFactory = (
  options: WorldRuntimeOptions = {},
) => {
  let snapshot: WorldSnapshot = options.initialSnapshot || {
    schemaVersion: 1,
    worldId: options.worldId || "test",
    residents: [],
    relationships: [],
    weather: "sunny",
    eventHistory: [],
    simulationTime: 0,
  };
  const listeners = new Set<(snapshot: WorldSnapshot) => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    dispatch(event: WorldEvent) {
      snapshot = structuredClone(snapshot);
      if (event.kind === "join") {
        const existing = snapshot.residents.find((r) => r.id === event.actorId);
        if (existing) {
          existing.displayName = event.actorDisplayName;
          existing.appearance =
            event.payload?.appearance || existing.appearance;
        } else
          snapshot.residents.push({
            id: event.actorId,
            displayName: event.actorDisplayName,
            appearance: event.payload?.appearance || appearance,
            personality: [],
            needs: { energy: 80, fun: 80, social: 80 },
            location: { x: 0, y: 0, z: 0, zone: "plaza" },
            activity: "arriving",
            joinedAt: event.timestamp,
            lastActiveAt: event.timestamp,
          });
      }
      if (event.kind === "weather") snapshot.weather = event.payload!.weather!;
      snapshot.eventHistory = [...snapshot.eventHistory, event].slice(-100);
      for (const callback of listeners) callback(snapshot);
    },
  };
};
export function event(
  kind: WorldEvent["kind"],
  overrides: Partial<WorldEvent> = {},
): WorldEvent {
  return {
    id: crypto.randomUUID(),
    kind,
    source: "viewer",
    actorId: "claimed-id",
    actorDisplayName: "Miles",
    timestamp: Date.now(),
    ...overrides,
  };
}
