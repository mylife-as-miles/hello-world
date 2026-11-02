/** Hosted HTTP transport. All simulation and durable state remain on the server. */
import { useSyncExternalStore } from "react";
import type {
  ClientMessage,
  DirectorSettings,
  ServerMessage,
  WorldEvent,
  WorldEventKind,
  WorldEventPayload,
  WorldRuntime,
  WorldSnapshot,
} from "@hello-world/contracts";

type StatusMessage = Extract<ServerMessage, { type: "status" }>;
interface HttpEnvelope {
  snapshot?: WorldSnapshot;
  status?: StatusMessage;
  authorized?: boolean;
  viewerId?: string;
  oauthConfigured?: boolean;
  capabilities?: Record<string, string>;
  messages?: ServerMessage[];
  error?: string;
  mode?: "demo" | "live";
  twitch?: string;
  clients?: number;
  settings?: DirectorSettings;
  pending?: WorldEvent[];
}
interface HttpWorldState {
  snapshot: WorldSnapshot;
  connection: "connecting" | "online" | "offline";
  mode: "demo" | "live";
  twitch: string;
  clients: number;
  settings: DirectorSettings;
  pending: WorldEvent[];
  isDirector: boolean;
  error: string | null;
  residentId: string | null;
  oauthConfigured: boolean;
  capabilities: Record<string, string>;
}
function eventId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}
class HttpWorldConnection {
  private state: HttpWorldState = {
    snapshot: {
      schemaVersion: 1,
      worldId: "hello-neighborhood",
      residents: [],
      relationships: [],
      weather: "sunny",
      eventHistory: [],
      simulationTime: 0,
    },
    connection: "connecting",
    mode: "demo",
    twitch: "Checking hosted world connection…",
    clients: 0,
    settings: {
      approvalRequired: false,
      cooldownSeconds: 3,
      maxResidents: 30,
      paused: false,
    },
    pending: [],
    isDirector: false,
    error: null,
    residentId: null,
    oauthConfigured: false,
    capabilities: {},
  };
  private listeners = new Set<() => void>();
  private snapshotListeners = new Set<(snapshot: WorldSnapshot) => void>();
  private started = false;
  private refreshing = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private directorKey = "";
  private mutations = Promise.resolve();
  private requestSequence = 0;
  private latestAppliedSequence = 0;
  readonly runtime: WorldRuntime = {
    getSnapshot: () => this.state.snapshot,
    subscribe: (listener) => {
      this.snapshotListeners.add(listener);
      return () => {
        this.snapshotListeners.delete(listener);
      };
    },
    dispatch: (event) => {
      this.send({ type: "event", event });
    },
  };
  getState = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    this.start();
    return () => {
      this.listeners.delete(listener);
    };
  };
  private patch(next: Partial<HttpWorldState>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((listener) => listener());
    if (next.snapshot)
      this.snapshotListeners.forEach((listener) => listener(next.snapshot!));
  }
  private baseUrl() {
    return new URL(import.meta.env.VITE_SERVER_URL || window.location.origin);
  }
  private headers(json = false) {
    const headers: Record<string, string> = {};
    if (json) headers["Content-Type"] = "application/json";
    if (this.directorKey) headers["X-Director-Key"] = this.directorKey;
    return headers;
  }
  private start() {
    if (this.started) return;
    this.started = true;
    void this.refresh(true);
    window.addEventListener("online", () => {
      clearTimeout(this.timer);
      void this.refresh();
    });
  }
  private async request(path: string, message?: ClientMessage) {
    const sequence = ++this.requestSequence;
    const response = await fetch(new URL(path, this.baseUrl()), {
      method: message ? "POST" : "GET",
      credentials: "include",
      cache: "no-store",
      headers: this.headers(Boolean(message)),
      ...(message ? { body: JSON.stringify(message) } : {}),
      signal: AbortSignal.timeout(8000),
    });
    const envelope = (await response.json()) as HttpEnvelope;
    // A slow poll must not replace the newer authoritative result of a completed action.
    if (sequence < this.latestAppliedSequence)
      return { ok: true, envelope: {} as HttpEnvelope };
    this.latestAppliedSequence = sequence;
    this.receiveEnvelope(envelope);
    if (
      !response.ok &&
      !envelope.error &&
      !envelope.messages?.some((item) => item.type === "error")
    ) {
      this.patch({ error: `World server returned ${response.status}.` });
    }
    return { ok: response.ok, envelope };
  }
  private async refresh(initial = false) {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      // Resolve the authenticated viewer first; the hosting gateway supplies session identity.
      if (initial || !this.state.residentId) {
        const status = await this.request("/api/status");
        if (!status.ok)
          throw new Error(
            status.envelope.error ||
              "The hosted world could not resolve your signed-in viewer session.",
          );
      }
      const update = await this.request("/api/snapshot");
      if (!update.ok)
        throw new Error(
          update.envelope.error ||
            "The hosted world could not load its saved snapshot.",
        );
    } catch (error) {
      this.patch({
        connection: "offline",
        isDirector: false,
        error:
          error instanceof Error
            ? error.message
            : "Hosted world connection interrupted. Retrying automatically.",
      });
    } finally {
      this.refreshing = false;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        void this.refresh();
      }, 1000);
    }
  }
  private receiveEnvelope(envelope: HttpEnvelope) {
    this.patch({
      ...(typeof envelope.viewerId === "string"
        ? { residentId: envelope.viewerId }
        : {}),
      ...(typeof envelope.oauthConfigured === "boolean"
        ? { oauthConfigured: envelope.oauthConfigured }
        : {}),
      ...(envelope.capabilities ? { capabilities: envelope.capabilities } : {}),
    });
    const messages = Array.isArray(envelope.messages) ? envelope.messages : [];
    messages.forEach((message) => this.receive(message));
    if (
      envelope.snapshot &&
      !messages.some((message) => message.type === "snapshot")
    )
      this.receive({ type: "snapshot", snapshot: envelope.snapshot });
    if (
      envelope.status &&
      !messages.some((message) => message.type === "status")
    )
      this.receive(envelope.status);
    else if (
      !messages.some((message) => message.type === "status") &&
      envelope.mode &&
      envelope.settings &&
      envelope.pending &&
      typeof envelope.clients === "number"
    ) {
      this.receive({
        type: "status",
        mode: envelope.mode,
        twitch: envelope.twitch || "",
        clients: envelope.clients,
        settings: envelope.settings,
        pending: envelope.pending,
        capabilities: envelope.capabilities,
      });
    }
    if (
      typeof envelope.authorized === "boolean" &&
      !messages.some((message) => message.type === "director-auth")
    )
      this.receive({ type: "director-auth", authorized: envelope.authorized });
    if (envelope.error && !messages.some((message) => message.type === "error"))
      this.patch({ error: envelope.error });
  }
  private receive(message: ServerMessage) {
    switch (message.type) {
      case "snapshot": {
        if (
          message.snapshot.schemaVersion !== 1 ||
          !Array.isArray(message.snapshot.residents) ||
          !Array.isArray(message.snapshot.relationships) ||
          !Array.isArray(message.snapshot.eventHistory)
        )
          throw new Error("Unsupported hosted world snapshot.");
        const recovered = this.state.connection !== "online";
        this.patch({
          snapshot: message.snapshot,
          connection: "online",
          ...(recovered ? { error: null } : {}),
        });
        break;
      }
      case "status":
        this.patch({
          mode: message.mode,
          twitch: message.twitch,
          clients: message.clients,
          settings: message.settings,
          pending: message.pending,
          capabilities: message.capabilities || this.state.capabilities,
        });
        break;
      case "director-auth":
        this.patch({ isDirector: message.authorized });
        break;
      case "error":
        this.patch({ error: message.message });
        break;
      case "event":
        break; // Authoritative snapshots contain accepted events; never double-dispatch.
    }
  }
  private send(message: ClientMessage) {
    if (this.state.connection !== "online") {
      this.patch({
        error: "You are offline. Reconnect before sending an action.",
      });
      return;
    }
    this.patch({ error: null });
    // Preserve viewer action ordering even when several buttons are pressed quickly.
    this.mutations = this.mutations.then(async () => {
      try {
        await this.request("/api/messages", message);
      } catch {
        this.patch({
          connection: "offline",
          isDirector: false,
          error:
            "The action could not reach the hosted world. Reconnecting automatically.",
        });
      }
    });
  }
  sendEvent = (
    kind: WorldEventKind,
    payload?: WorldEventPayload,
    extras?: { targetId?: string; text?: string; displayName?: string },
  ) => {
    this.send({
      type: "event",
      event: {
        id: eventId(),
        kind,
        source:
          this.state.isDirector &&
          ["weather", "confetti", "raid"].includes(kind)
            ? "demo"
            : "viewer",
        actorId: this.state.residentId || "viewer",
        actorDisplayName:
          extras?.displayName ||
          this.state.snapshot.residents.find(
            (resident) => resident.id === this.state.residentId,
          )?.displayName ||
          "Neighbor",
        timestamp: Date.now(),
        ...(payload ? { payload } : {}),
        ...(extras?.targetId ? { targetId: extras.targetId } : {}),
        ...(extras?.text ? { text: extras.text } : {}),
      },
    });
  };
  spawnDemoResident = () => {
    const names = [
      "Juniper",
      "Atlas",
      "Cleo",
      "River",
      "Sage",
      "Indigo",
      "Finn",
      "Luna",
    ];
    this.send({
      type: "event",
      event: {
        id: eventId(),
        kind: "join",
        source: "demo",
        actorId: `demo:${eventId()}`,
        actorDisplayName: `${names[Math.floor(Math.random() * names.length)]} ${Math.floor(100 + Math.random() * 900)}`,
        timestamp: Date.now(),
        payload: { personality: ["curious", "friendly"] },
      },
    });
  };
  authenticateDirector = (key: string) => {
    this.directorKey = key;
    this.send({ type: "director-auth", key });
  };
  connectTwitch = async () => {
    if (!this.state.isDirector) {
      this.patch({ error: "Unlock Director Studio before connecting Twitch." });
      return;
    }
    if (!this.state.oauthConfigured) {
      this.patch({
        error:
          "Live Twitch is unavailable on this hosted Demo Mode world. Use the Node server to connect Twitch.",
      });
      return;
    }
    try {
      const response = await fetch(
        new URL("/api/twitch/connect", this.baseUrl()),
        {
          method: "POST",
          credentials: "include",
          headers: this.headers(),
          signal: AbortSignal.timeout(8000),
        },
      );
      const result = (await response.json()) as {
        authorizeUrl?: string;
        error?: string;
      };
      if (!response.ok || !result.authorizeUrl)
        throw new Error(
          result.error || "Twitch authorization could not start.",
        );
      const target = new URL(result.authorizeUrl);
      if (target.protocol !== "https:" || target.hostname !== "id.twitch.tv")
        throw new Error("Unexpected Twitch authorization destination.");
      window.location.assign(target.href);
    } catch (error) {
      this.patch({
        error:
          error instanceof Error
            ? error.message
            : "Twitch authorization could not start.",
      });
    }
  };
  updateSettings = (settings: Partial<DirectorSettings>) =>
    this.send({ type: "director-settings", settings });
  approve = (eventId: string) => this.send({ type: "approve", eventId });
  reject = (eventId: string) => this.send({ type: "reject", eventId });
  reset = () => this.send({ type: "reset" });
  clearError = () => this.patch({ error: null });
}
const world = new HttpWorldConnection();
export function useHttpWorld() {
  const state = useSyncExternalStore(
    world.subscribe,
    world.getState,
    world.getState,
  );
  return {
    ...state,
    runtime: world.runtime,
    sendEvent: world.sendEvent,
    authenticateDirector: world.authenticateDirector,
    spawnDemoResident: world.spawnDemoResident,
    connectTwitch: world.connectTwitch,
    updateSettings: world.updateSettings,
    approve: world.approve,
    reject: world.reject,
    reset: world.reset,
    clearError: world.clearError,
  };
}
