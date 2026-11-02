import { randomUUID } from "node:crypto";
import type {
  ClientMessage,
  DirectorSettings,
  ServerMessage,
  WorldEvent,
  WorldRuntime,
  WorldRuntimeOptions,
} from "@hello-world/contracts";
import { cleanText, parseClientMessage, parseEvent } from "./validation.js";
import { secretEquals, SlidingLimit } from "./security.js";
import type { SnapshotStore } from "./persistence.js";

export type RuntimeFactory = (
  options?: WorldRuntimeOptions,
) => WorldRuntime & { dispose?: () => void };
export interface Peer {
  id: string;
  viewerId: string;
  director: boolean;
  send(message: ServerMessage): void;
}
export interface RoomOptions {
  runtime: ReturnType<RuntimeFactory>;
  factory: RuntimeFactory;
  worldId: string;
  directorKey: string;
  settings: DirectorSettings;
  store?: SnapshotStore;
}
const PRIVILEGED = new Set(["weather", "confetti", "raid"]);
const APPROVAL = new Set(["chat", "wave", "dance", "gift", "social"]);
export class WorldRoom {
  readonly peers = new Map<string, Peer>();
  readonly pending = new Map<string, WorldEvent>();
  settings: DirectorSettings;
  mode: "demo" | "live" = "demo";
  twitch = "Demo Mode · Twitch credentials not configured";
  capabilities: Record<string, string> = {};
  private runtime: ReturnType<RuntimeFactory>;
  private unsubscribe: () => void;
  private eventLimit = new SlidingLimit(30, 60_000);
  private messageLimit = new SlidingLimit(120, 60_000);
  private authLimit = new SlidingLimit(5, 60_000);
  private cooldowns = new Map<string, number>();
  private eventIds = new Set<string>();
  private snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(private options: RoomOptions) {
    this.runtime = options.runtime;
    this.settings = { ...options.settings };
    this.unsubscribe = this.watch();
    options.store?.schedule(this.runtime.getSnapshot());
  }
  getSnapshot() {
    return this.runtime.getSnapshot();
  }
  status(): Extract<ServerMessage, { type: "status" }> {
    return {
      type: "status",
      mode: this.mode,
      twitch: this.twitch,
      clients: this.peers.size,
      settings: { ...this.settings },
      pending: [...this.pending.values()],
      capabilities: { ...this.capabilities },
    };
  }
  private watch() {
    return this.runtime.subscribe((snapshot) => {
      this.options.store?.schedule(snapshot);
      if (this.snapshotTimer) return;
      this.snapshotTimer = setTimeout(() => {
        this.snapshotTimer = undefined;
        this.broadcast({
          type: "snapshot",
          snapshot: this.runtime.getSnapshot(),
        });
      }, 50);
      this.snapshotTimer.unref();
    });
  }
  setConnection(
    mode: "demo" | "live",
    twitch: string,
    capabilities: Record<string, string> = {},
  ) {
    this.mode = mode;
    this.twitch = twitch;
    this.capabilities = { ...capabilities };
    this.broadcastStatus();
  }
  add(peer: Peer) {
    this.peers.set(peer.id, peer);
    peer.send({ type: "snapshot", snapshot: this.runtime.getSnapshot() });
    peer.send({ type: "director-auth", authorized: peer.director });
    this.broadcastStatus();
  }
  remove(id: string) {
    this.peers.delete(id);
    this.broadcastStatus();
  }
  private broadcast(message: ServerMessage) {
    for (const peer of this.peers.values()) peer.send(message);
  }
  private broadcastStatus() {
    // Pending viewer messages are moderation material, visible only to authenticated directors.
    const status = this.status();
    for (const peer of this.peers.values())
      peer.send({ ...status, pending: peer.director ? status.pending : [] });
  }
  receive(peer: Peer, input: unknown) {
    if (!this.messageLimit.allow(peer.viewerId))
      return this.fail(peer, "Too many requests. Try again in a minute.");
    let message: ClientMessage;
    try {
      message = parseClientMessage(input);
    } catch {
      return this.fail(
        peer,
        "Invalid request. Only approved world actions are accepted.",
      );
    }
    if (message.type === "director-auth") {
      if (!this.authLimit.allow(peer.viewerId))
        return this.fail(
          peer,
          "Too many Director login attempts. Try again in a minute.",
        );
      peer.director =
        peer.director || secretEquals(message.key, this.options.directorKey);
      peer.send({ type: "director-auth", authorized: peer.director });
      if (!peer.director) this.fail(peer, "Director key was not accepted.");
      this.broadcastStatus();
      return;
    }
    if (message.type !== "event" && !peer.director)
      return this.fail(peer, "Director access is required.");
    if (message.type === "director-settings") {
      this.settings = { ...this.settings, ...message.settings };
      this.broadcastStatus();
      return;
    }
    if (message.type === "reset") {
      this.reset();
      return;
    }
    if (message.type === "approve" || message.type === "reject") {
      const event = this.pending.get(message.eventId);
      if (!event)
        return this.fail(
          peer,
          "This interaction is no longer awaiting approval.",
        );
      this.pending.delete(message.eventId);
      if (message.type === "approve") {
        try {
          this.validateAction(event, false, true);
          this.commit(event);
        } catch (error) {
          this.fail(peer, (error as Error).message, event.id);
        }
      }
      this.broadcastStatus();
      return;
    }
    if (message.type !== "event") return;
    const inputEvent = message.event;
    const existing = this.runtime
      .getSnapshot()
      .residents.find((r) => r.id === peer.viewerId);
    const demoActor =
      peer.director &&
      inputEvent.source === "demo" &&
      /^demo:[\w-]{1,40}$/.test(inputEvent.actorId);
    const event: WorldEvent = {
      ...inputEvent,
      id: `browser:${randomUUID()}`,
      timestamp: Date.now(),
      source: peer.director && inputEvent.source === "demo" ? "demo" : "viewer",
      actorId: demoActor ? inputEvent.actorId : peer.viewerId,
      actorDisplayName: demoActor
        ? cleanText(inputEvent.actorDisplayName)
        : inputEvent.kind === "join"
          ? cleanText(inputEvent.actorDisplayName)
          : existing?.displayName || "Visitor",
      text:
        inputEvent.text === undefined ? undefined : cleanText(inputEvent.text),
    };
    try {
      if (!this.eventLimit.allow(peer.viewerId))
        throw new Error("Action rate limit reached. Try again in a minute.");
      if (PRIVILEGED.has(event.kind) && !peer.director)
        throw new Error("Director access is required for world events.");
      this.validateAction(event, peer.director);
      if (
        !peer.director &&
        this.settings.approvalRequired &&
        APPROVAL.has(event.kind)
      ) {
        if (this.pending.size >= 100)
          throw new Error("The approval queue is full. Please try later.");
        this.pending.set(event.id, event);
        this.broadcastStatus();
        return;
      }
      this.commit(event);
    } catch (error) {
      this.fail(peer, (error as Error).message, inputEvent.id);
    }
  }
  /** Only a server-side authenticated Twitch adapter may call this path. */
  dispatchTrusted(
    event: WorldEvent,
    systemEvent = false,
  ): { accepted: boolean; reason?: string } {
    try {
      const validated = parseEvent(event);
      if (validated.source !== "twitch" && validated.source !== "simulation")
        throw new Error("Untrusted server source");
      if (this.eventIds.has(validated.id) || this.pending.has(validated.id))
        return { accepted: true };
      if (!systemEvent && !this.eventLimit.allow(validated.actorId))
        throw new Error("Action rate limit reached");
      this.validateAction(validated, systemEvent);
      if (
        !systemEvent &&
        this.settings.approvalRequired &&
        APPROVAL.has(validated.kind)
      ) {
        if (this.pending.size >= 100) throw new Error("Approval queue full");
        this.pending.set(validated.id, validated);
        this.broadcastStatus();
      } else this.commit(validated);
      return { accepted: true };
    } catch (error) {
      return { accepted: false, reason: (error as Error).message };
    }
  }
  private validateAction(
    event: WorldEvent,
    director: boolean,
    approving = false,
  ) {
    const snapshot = this.runtime.getSnapshot();
    if (!event.actorDisplayName.trim())
      throw new Error("Choose a display name before joining.");
    const allowedPayload: Record<string, string[]> = {
      join: ["appearance", "personality"],
      chat: [],
      wave: [],
      dance: [],
      gift: ["amount"],
      social: ["action"],
      weather: ["weather"],
      confetti: ["action", "color", "amount"],
      raid: ["amount"],
      custom: ["action", "appearance"],
    };
    if (
      Object.keys(event.payload || {}).some(
        (key) => !allowedPayload[event.kind]?.includes(key),
      )
    )
      throw new Error("Payload does not match this world action.");
    if (
      event.kind === "confetti" &&
      event.payload?.action &&
      event.payload.action !== "celebrate"
    )
      throw new Error("Choose an approved celebration action.");
    const resident = snapshot.residents.find((r) => r.id === event.actorId);
    if (this.settings.paused && !director)
      throw new Error("Viewer interactions are paused by the Director.");
    if (event.kind === "join") {
      if (!resident && snapshot.residents.length >= this.settings.maxResidents)
        throw new Error("This neighborhood is full.");
    } else if (!PRIVILEGED.has(event.kind) && !resident)
      throw new Error("Join the neighborhood before interacting.");
    if (event.kind === "weather" && !event.payload?.weather)
      throw new Error("Choose an approved weather preset.");
    if (
      event.kind === "custom" &&
      (event.payload?.action !== "update-avatar" || !event.payload.appearance)
    )
      throw new Error("Only avatar updates are supported as custom actions.");
    if (event.kind === "chat" && !event.text)
      throw new Error("Say something before sending.");
    if (
      event.kind === "social" &&
      event.payload?.action &&
      !["greet", "compliment", "befriend"].includes(event.payload.action)
    )
      throw new Error("Choose an approved social action.");
    if (event.kind === "gift" && !event.targetId)
      throw new Error("Choose a resident to receive your gift.");
    if (
      event.targetId &&
      !snapshot.residents.some((r) => r.id === event.targetId)
    )
      throw new Error("That resident is no longer in this world.");
    if (event.targetId === event.actorId)
      throw new Error("Choose another resident.");
    if (
      !director &&
      !approving &&
      event.kind !== "join" &&
      event.kind !== "custom"
    ) {
      const now = Date.now();
      const last = this.cooldowns.get(event.actorId) || 0;
      if (now - last < this.settings.cooldownSeconds * 1000)
        throw new Error(
          `Take a breath — actions have a ${this.settings.cooldownSeconds}s cooldown.`,
        );
      this.cooldowns.set(event.actorId, now);
      if (this.cooldowns.size > 5000)
        for (const [id, at] of this.cooldowns)
          if (at < now - 60_000) this.cooldowns.delete(id);
    }
  }
  private commit(event: WorldEvent) {
    if (this.eventIds.has(event.id)) return;
    this.eventIds.add(event.id);
    if (this.eventIds.size > 2000)
      this.eventIds.delete(this.eventIds.values().next().value!);
    this.runtime.dispatch(event);
    this.broadcast({ type: "event", event });
  }
  private reset() {
    this.unsubscribe();
    this.runtime.dispose?.();
    this.runtime = this.options.factory({
      worldId: this.options.worldId,
      seedResidents: true,
      autoTick: true,
    });
    this.unsubscribe = this.watch();
    this.pending.clear();
    this.cooldowns.clear();
    this.eventIds.clear();
    this.options.store?.schedule(this.runtime.getSnapshot());
    this.broadcast({ type: "snapshot", snapshot: this.runtime.getSnapshot() });
    this.broadcastStatus();
  }
  private fail(peer: Peer, message: string, eventId?: string) {
    peer.send({ type: "error", message, eventId });
  }
  async close() {
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.unsubscribe();
    this.runtime.dispose?.();
    this.options.store?.schedule(this.runtime.getSnapshot());
    await this.options.store?.flush();
  }
}
