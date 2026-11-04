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
interface TwitchUser {
  id: string;
  login: string;
  displayName: string;
}
interface HttpEnvelope {
  snapshot?: WorldSnapshot;
  status?: StatusMessage;
  authorized?: boolean;
  viewerId?: string | null;
  requiresSignIn?: boolean;
  oauthConfigured?: boolean;
  capabilities?: Record<string, string>;
  messages?: ServerMessage[];
  error?: string;
  mode?: "demo" | "live";
  twitch?: string;
  clients?: number;
  settings?: DirectorSettings;
  pending?: WorldEvent[];
  user?: TwitchUser | null;
  ownWorldId?: string | null;
  loginConfigured?: boolean;
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
  requiresSignIn: boolean;
  oauthConfigured: boolean;
  capabilities: Record<string, string>;
  user: TwitchUser | null;
  ownWorldId: string | null;
  signingIn: boolean;
  loginConfigured: boolean;
}
function selectedWorldId() {
  const value = new URLSearchParams(window.location.search).get("world");
  return value && /^twitch-\d{1,32}$/.test(value) ? value : null;
}
function eventId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}
function validatedTwitchAuthorizeUrl(value: string): string {
  const target = new URL(value);
  if (
    target.protocol !== "https:" ||
    target.hostname !== "id.twitch.tv" ||
    target.pathname !== "/oauth2/authorize" ||
    target.username ||
    target.password ||
    target.port ||
    target.hash
  )
    throw new Error("Unexpected Twitch authorization destination.");
  return target.href;
}
function validatedManagedAuthorizeUrl(value: string): string {
  const target = new URL(value);
  if (target.protocol !== "https:" || !["connect.composio.dev", "backend.composio.dev"].includes(target.hostname) || target.username || target.password || target.port || target.hash)
    throw new Error("Twitch sign-in could not start safely. Please try again.");
  return target.href;
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
    requiresSignIn: true,
    oauthConfigured: false,
    capabilities: {},
    user: null,
    ownWorldId: null,
    signingIn: false,
    loginConfigured: false,
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
  private selectedWorld = selectedWorldId();
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
  private worldUrl(path: string) {
    const url = new URL(path, this.baseUrl());
    const worldId = selectedWorldId();
    if (worldId) url.searchParams.set("world", worldId);
    return url;
  }
  private syncSelectedWorld() {
    const next = selectedWorldId();
    if (next === this.selectedWorld) return;
    this.selectedWorld = next;
    this.latestAppliedSequence = ++this.requestSequence;
    this.patch({ isDirector: false, connection: "connecting", snapshot: { ...this.state.snapshot, worldId: next || "hello-neighborhood", residents: [], relationships: [], eventHistory: [] } });
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
    window.addEventListener("popstate", () => {
      this.syncSelectedWorld();
      clearTimeout(this.timer);
      void this.refresh(true);
    });
  }
  private async request(path: string, message?: ClientMessage) {
    this.syncSelectedWorld();
    const requestWorld = this.selectedWorld;
    const sequence = ++this.requestSequence;
    const response = await fetch(this.worldUrl(path), {
      method: message ? "POST" : "GET",
      credentials: "include",
      cache: "no-store",
      headers: this.headers(Boolean(message)),
      ...(message ? { body: JSON.stringify(message) } : {}),
      signal: AbortSignal.timeout(8000),
    });
    const envelope = (await response.json()) as HttpEnvelope;
    // A slow poll must not replace the newer authoritative result of a completed action.
    if (sequence < this.latestAppliedSequence || requestWorld !== selectedWorldId())
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
      // Resolve the Twitch session before applying this world's snapshot/permissions.
      if (initial || !this.state.residentId) {
        const status = await this.request("/api/status");
        if (!status.ok)
          throw new Error(
            status.envelope.error ||
              "Your Twitch session could not be checked. Please try again.",
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
      ...(envelope.viewerId === null || typeof envelope.viewerId === "string"
        ? { residentId: envelope.viewerId }
        : {}),
      ...(typeof envelope.requiresSignIn === "boolean"
        ? { requiresSignIn: envelope.requiresSignIn }
        : {}),
      ...(typeof envelope.oauthConfigured === "boolean"
        ? { oauthConfigured: envelope.oauthConfigured }
        : {}),
      ...(envelope.capabilities ? { capabilities: envelope.capabilities } : {}),
      ...(envelope.user === null || envelope.user && typeof envelope.user.id === "string" && typeof envelope.user.displayName === "string" ? { user: envelope.user } : {}),
      ...(envelope.ownWorldId === null || typeof envelope.ownWorldId === "string" ? { ownWorldId: envelope.ownWorldId } : {}),
      ...(typeof envelope.loginConfigured === "boolean" ? { loginConfigured: envelope.loginConfigured } : {}),
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
  signInTwitch = async (returnTo?: string) => {
    if (this.state.signingIn) return;
    if (!this.state.loginConfigured) {
      this.patch({ error: "Twitch sign-in is being enabled. You can explore the public world meanwhile." });
      return;
    }
    this.patch({ signingIn: true, error: null });
    try {
      const chosenWorld = selectedWorldId();
      const destination = returnTo || (window.location.pathname.startsWith("/director") ? "/director" : `/world${chosenWorld ? `?world=${encodeURIComponent(chosenWorld)}` : ""}`);
      const response = await fetch(new URL("/api/auth/twitch/start", this.baseUrl()), {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnTo: destination }),
        signal: AbortSignal.timeout(65_000),
      });
      const result = await response.json() as { authorizeUrl?: string; error?: string };
      if (!response.ok || !result.authorizeUrl) {
        const detail = result.error || "";
        throw new Error(/scope|permission/i.test(detail) ? "Twitch sign-in permissions could not be verified. Please try again later." : "Twitch sign-in could not start. Please try again shortly.");
      }
      window.location.assign(validatedManagedAuthorizeUrl(result.authorizeUrl));
    } catch (error) {
      this.patch({ signingIn: false, error: error instanceof Error ? error.message : "Twitch sign-in could not start. Please try again." });
    }
  };
  signOut = async () => {
    try {
      const response = await fetch(new URL("/api/auth/logout", this.baseUrl()), { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error();
      this.latestAppliedSequence = ++this.requestSequence;
      this.patch({ user: null, ownWorldId: null, residentId: null, requiresSignIn: true, isDirector: false, connection: "connecting" });
      window.location.assign(`${window.location.pathname}${window.location.search}`);
    } catch { this.patch({ error: "Sign-out could not finish. Please try again." }); }
  };
  openOwnWorld = () => {
    if (!this.state.user || !this.state.ownWorldId) { void this.signInTwitch("/director"); return; }
    if (!/^twitch-\d{1,32}$/.test(this.state.ownWorldId)) { this.patch({ error: "Your world is not ready yet. Please try signing in again." }); return; }
    this.patch({ isDirector: false, connection: "connecting" });
    window.location.assign(`/director?world=${encodeURIComponent(this.state.ownWorldId)}`);
  };
  connectTwitch = async () => {
    if (!this.state.isDirector) {
      this.patch({ error: "Unlock Director Studio before connecting Twitch." });
      return;
    }
    if (!this.state.oauthConfigured) {
      this.patch({
        error:
          "Twitch is not configured for this world yet. Add the Twitch app credentials to the hosted server to enable connection.",
      });
      return;
    }
    try {
      const response = await fetch(
        this.worldUrl("/api/twitch/connect"),
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
      window.location.assign(validatedTwitchAuthorizeUrl(result.authorizeUrl));
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
    hosted: true as const,
    runtime: world.runtime,
    sendEvent: world.sendEvent,
    authenticateDirector: world.authenticateDirector,
    spawnDemoResident: world.spawnDemoResident,
    connectTwitch: world.connectTwitch,
    signInTwitch: world.signInTwitch,
    signOut: world.signOut,
    openOwnWorld: world.openOwnWorld,
    updateSettings: world.updateSettings,
    approve: world.approve,
    reject: world.reject,
    reset: world.reset,
    clearError: world.clearError,
  };
}
