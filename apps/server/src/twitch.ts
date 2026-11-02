import { randomUUID } from "node:crypto";
import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ApiClient } from "@twurple/api";
import {
  getTokenInfo,
  RefreshingAuthProvider,
  exchangeCode,
} from "@twurple/auth";
import type { AccessToken } from "@twurple/auth";
import { ChatClient } from "@twurple/chat";
import { EventSubWsListener } from "@twurple/eventsub-ws";
import type {
  WorldEvent,
  WorldSnapshot,
  Weather,
} from "@hello-world/contracts";
import { cleanText } from "./validation.js";
import { SlidingLimit } from "./security.js";
import type { WorldRoom } from "./room.js";

export const TWITCH_SCOPES = [
  "chat:read",
  "chat:edit",
  "channel:read:subscriptions",
  "channel:read:redemptions",
] as const;
export interface TwitchIdentity {
  id: string;
  displayName: string;
  messageId: string;
}
export function chatToEvent(
  text: string,
  actor: TwitchIdentity,
  snapshot: WorldSnapshot,
): WorldEvent | null {
  const normalized = cleanText(text).slice(0, 180);
  const [command, ...args] = normalized.split(/\s+/);
  const base = {
    id: `twitch:chat:${actor.messageId}`,
    source: "twitch" as const,
    actorId: `twitch:${actor.id}`,
    actorDisplayName: actor.displayName.slice(0, 32),
    timestamp: Date.now(),
  };
  switch (command?.toLowerCase()) {
    case "!join":
      return { ...base, kind: "join" };
    case "!wave":
      return { ...base, kind: "wave" };
    case "!dance":
      return { ...base, kind: "dance" };
    case "!hello":
      return {
        ...base,
        kind: "chat",
        text: args.join(" ") || "Hello, neighborhood!",
      };
    case "!gift": {
      const name = args.join(" ").replace(/^@/, "").toLowerCase();
      const target = snapshot.residents.find(
        (r) => r.displayName.toLowerCase() === name,
      );
      return target ? { ...base, kind: "gift", targetId: target.id } : null;
    }
    default:
      return normalized &&
        !normalized.startsWith("!") &&
        snapshot.residents.some((r) => r.id === base.actorId)
        ? { ...base, kind: "chat", text: normalized }
        : null;
  }
}

type RewardAction =
  | "wave"
  | "dance"
  | "confetti"
  | "weather:sunny"
  | "weather:rain"
  | "weather:snow"
  | "weather:sunset";
const REWARD_ACTIONS = new Set<RewardAction>([
  "wave",
  "dance",
  "confetti",
  "weather:sunny",
  "weather:rain",
  "weather:snow",
  "weather:sunset",
]);
export function parseRewardActions(raw?: string): Map<string, RewardAction> {
  if (!raw) return new Map();
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("TWITCH_REWARD_ACTIONS must be a JSON object");
  const result = new Map<string, RewardAction>();
  for (const [id, action] of Object.entries(parsed)) {
    if (
      id.length > 100 ||
      !id ||
      typeof action !== "string" ||
      !REWARD_ACTIONS.has(action as RewardAction)
    )
      throw new Error(
        "TWITCH_REWARD_ACTIONS contains an unsupported reward action",
      );
    result.set(id, action as RewardAction);
  }
  if (result.size > 20)
    throw new Error("At most 20 reward mappings are supported");
  return result;
}
interface StoredToken {
  clientId: string;
  token: AccessToken;
}
export class TwitchAdapter {
  private chat?: ChatClient;
  private listener?: EventSubWsListener;
  private auth?: RefreshingAuthProvider;
  private validationTimer?: ReturnType<typeof setInterval>;
  private token?: AccessToken;
  private userId?: string;
  private chatReady = false;
  private eventsubReady = false;
  private activeSubscriptions = new Map<string, string>();
  private capabilities: Record<string, string> = {};
  private tokenWrite = Promise.resolve();
  private replies = new SlidingLimit(8, 30_000);
  private replyUsers = new SlidingLimit(1, 5_000);
  private started = false;
  private authorizationValidated = false;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  private tokenPath: string;
  private rewards: Map<string, RewardAction>;
  constructor(
    private room: WorldRoom,
    private dataDir: string,
    private env: NodeJS.ProcessEnv = process.env,
  ) {
    this.clientId = env.TWITCH_CLIENT_ID || "";
    this.clientSecret = env.TWITCH_CLIENT_SECRET || "";
    this.redirectUri = env.TWITCH_REDIRECT_URI || "";
    this.tokenPath = join(dataDir, "twitch-token.json");
    this.rewards = parseRewardActions(env.TWITCH_REWARD_ACTIONS);
  }
  get oauthConfigured() {
    if (!this.clientId || !this.clientSecret || !this.redirectUri) return false;
    try {
      const uri = new URL(this.redirectUri);
      const localHttp =
        uri.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(uri.hostname);
      return (
        (uri.protocol === "https:" || localHttp) &&
        uri.pathname === "/api/twitch/callback" &&
        !uri.search &&
        !uri.hash &&
        !uri.username &&
        !uri.password
      );
    } catch {
      return false;
    }
  }
  private status() {
    const live = this.chatReady || this.eventsubReady;
    const details = Object.entries(this.capabilities)
      .map(([name, state]) => `${name}: ${state}`)
      .join(" · ");
    this.room.setConnection(
      live ? "live" : "demo",
      `${live ? "Twitch" : "Demo Mode"}${details ? ` · ${details}` : " · credentials not configured"}`,
      this.capabilities,
    );
  }
  private persist(token: AccessToken) {
    this.token = token;
    this.tokenWrite = this.tokenWrite.then(async () => {
      try {
        await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
        await writeFile(
          `${this.tokenPath}.tmp`,
          JSON.stringify({ clientId: this.clientId, token }),
          { mode: 0o600 },
        );
        await rename(`${this.tokenPath}.tmp`, this.tokenPath);
      } catch {
        this.capabilities.authorization = "token save failed";
        this.status();
      }
    });
  }
  async authorize(code: string): Promise<void> {
    if (!this.oauthConfigured)
      throw new Error("Twitch OAuth application is not configured");
    const token = await exchangeCode(
      this.clientId,
      this.clientSecret,
      code,
      this.redirectUri,
    );
    // Validate the new grant before stopping a healthy connection or replacing
    // saved credentials. An accidental login to the wrong Twitch account must
    // not destroy the streamer's existing authorization.
    const info = await getTokenInfo(token.accessToken, this.clientId);
    if (
      info.clientId !== this.clientId ||
      !info.userId ||
      (this.env.TWITCH_BROADCASTER_ID &&
        info.userId !== this.env.TWITCH_BROADCASTER_ID) ||
      (this.env.TWITCH_BROADCASTER_NAME &&
        info.userName?.toLowerCase() !==
          this.env.TWITCH_BROADCASTER_NAME.toLowerCase())
    )
      throw new Error(
        "Authorize the configured broadcaster account using this Twitch application",
      );
    await this.stop();
    await this.start(token);
    if (!this.capabilities.authorization?.startsWith("authorized "))
      throw new Error("Broadcaster authorization was not accepted");
    await this.tokenWrite;
  }
  async start(providedToken?: AccessToken): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.authorizationValidated = false;
    this.capabilities = {};
    if (!this.clientId || !this.clientSecret) {
      this.status();
      return;
    }
    try {
      let token = providedToken;
      if (!token) {
        try {
          const stored = JSON.parse(
            await readFile(this.tokenPath, "utf8"),
          ) as StoredToken;
          if (stored.clientId === this.clientId && stored.token?.refreshToken)
            token = stored.token;
        } catch {
          /* No saved token: use explicitly configured server credentials. */
        }
      }
      if (
        !token &&
        (this.env.TWITCH_ACCESS_TOKEN || this.env.TWITCH_REFRESH_TOKEN)
      )
        token = {
          accessToken: this.env.TWITCH_ACCESS_TOKEN || "",
          refreshToken: this.env.TWITCH_REFRESH_TOKEN || null,
          expiresIn: null,
          obtainmentTimestamp: Date.now(),
          scope: [],
        };
      if (!token) {
        this.capabilities.authorization = "connect broadcaster account";
        this.status();
        return;
      }
      this.auth = new RefreshingAuthProvider({
        clientId: this.clientId,
        clientSecret: this.clientSecret,
      });
      this.auth.onRefresh((_id, refreshed) => {
        this.token = refreshed;
        if (this.authorizationValidated) this.persist(refreshed);
      });
      this.auth.onRefreshFailure(() => {
        this.capabilities.authorization = "refresh failed; reconnect required";
        void this.failClosed();
      });
      // Omit scope here so Twurple discovers actual permissions; never trust environment declarations.
      const { scope: _scope, ...withoutClaimedScopes } = token;
      const userId = await this.auth.addUserForToken(withoutClaimedScopes, [
        "chat",
      ]);
      this.userId = userId;
      this.token = (await this.auth.getAccessTokenForUser(userId)) || undefined;
      if (!this.token) throw new Error("No user token available");
      const info = await getTokenInfo(this.token.accessToken, this.clientId);
      if (
        info.clientId !== this.clientId ||
        info.userId !== userId ||
        (this.env.TWITCH_BROADCASTER_ID &&
          this.env.TWITCH_BROADCASTER_ID !== userId)
      )
        throw new Error(
          "Token must belong to the configured app and broadcaster",
        );
      const scopes = new Set(info.scopes);
      const api = new ApiClient({ authProvider: this.auth });
      const broadcaster = await api.users.getUserById(userId);
      if (!broadcaster) throw new Error("Broadcaster account was not found");
      if (
        this.env.TWITCH_BROADCASTER_NAME &&
        this.env.TWITCH_BROADCASTER_NAME.toLowerCase() !==
          broadcaster.name.toLowerCase()
      )
        throw new Error("Broadcaster login does not match authorized account");
      this.authorizationValidated = true;
      this.persist(this.token);
      this.capabilities.authorization = `authorized ${broadcaster.name}`;
      if (scopes.has("chat:read")) {
        this.capabilities.chat = "connecting";
        this.chat = new ChatClient({
          authProvider: this.auth,
          channels: [broadcaster.name],
          logger: { minLevel: "critical" },
        });
        this.chat.onJoin((channel, user) => {
          if (user.toLowerCase() === broadcaster.name.toLowerCase()) {
            this.chatReady = true;
            this.capabilities.chat = "connected";
            this.status();
          }
        });
        this.chat.onJoinFailure(() => {
          this.chatReady = false;
          this.capabilities.chat = "channel join failed";
          this.status();
        });
        this.chat.onAuthenticationFailure(() => {
          this.chatReady = false;
          this.capabilities.chat = "authentication failed";
          this.status();
        });
        this.chat.onTokenFetchFailure(() => {
          this.chatReady = false;
          this.capabilities.chat = "token unavailable";
          this.status();
        });
        this.chat.onDisconnect(() => {
          this.chatReady = false;
          this.capabilities.chat = "disconnected";
          this.status();
        });
        this.chat.onMessage((_channel, user, text, message) => {
          const identity = {
            id: message.userInfo.userId,
            displayName: message.userInfo.displayName || user,
            messageId: message.id,
          };
          if (!identity.id) return;
          const event = chatToEvent(text, identity, this.room.getSnapshot());
          if (!event) return;
          const result = this.room.dispatchTrusted(event);
          if (
            scopes.has("chat:edit") &&
            this.replies.allow("channel") &&
            this.replyUsers.allow(identity.id)
          ) {
            const reply =
              result.accepted && event.kind === "join"
                ? `@${user} welcome home! Your resident is in HELLO WORLD. Try !wave, !dance, !hello or !gift username.`
                : !result.accepted
                  ? `@${user} ${result.reason}`
                  : "";
            if (reply)
              void this.chat?.say(broadcaster.name, reply).catch(() => {
                /* Delivery can fail independently of the world action. */
              });
          }
        });
        this.chat.connect();
      } else this.capabilities.chat = "missing chat:read scope";
      this.listener = new EventSubWsListener({
        apiClient: api,
        logger: { minLevel: "critical" },
      });
      this.listener.onSubscriptionCreateSuccess((subscription, remote) => {
        this.activeSubscriptions.set(subscription.id, remote.type);
        this.eventsubReady = this.activeSubscriptions.size > 0;
        this.capabilities[remote.type] = "subscribed";
        this.status();
      });
      this.listener.onSubscriptionCreateFailure((subscription) => {
        const type =
          this.activeSubscriptions.get(subscription.id) ||
          `subscription:${subscription.id}`;
        this.activeSubscriptions.delete(subscription.id);
        this.eventsubReady = this.activeSubscriptions.size > 0;
        this.capabilities[type] = "failed";
        this.status();
      });
      this.listener.onRevoke((subscription, reason) => {
        const type =
          this.activeSubscriptions.get(subscription.id) ||
          `subscription:${subscription.id}`;
        this.activeSubscriptions.delete(subscription.id);
        this.eventsubReady = this.activeSubscriptions.size > 0;
        this.capabilities[type] = `revoked (${reason})`;
        this.status();
      });
      this.listener.onUserSocketDisconnect(() => {
        for (const type of this.activeSubscriptions.values())
          this.capabilities[type] = "disconnected";
        this.activeSubscriptions.clear();
        this.eventsubReady = false;
        this.capabilities.eventsub = "disconnected";
        this.status();
      });
      this.listener.onUserSocketReady(() => {
        this.capabilities.eventsub = "socket ready";
        this.status();
      });
      if (scopes.has("channel:read:subscriptions")) {
        this.listener.onChannelSubscription(userId, (event) =>
          this.celebrate(
            event.userId,
            event.userDisplayName,
            "joined the subscriber family",
          ),
        );
        this.listener.onChannelSubscriptionMessage(userId, (event) =>
          this.celebrate(
            event.userId,
            event.userDisplayName,
            "renewed their subscription",
          ),
        );
        this.listener.onChannelSubscriptionGift(userId, (event) =>
          this.celebrate(
            event.gifterId || "anonymous",
            event.gifterDisplayName || "A kind stranger",
            `gifted ${event.amount} subscriptions`,
          ),
        );
      } else
        this.capabilities.subscriptions =
          "missing channel:read:subscriptions scope";
      if (
        scopes.has("channel:read:redemptions") ||
        scopes.has("channel:manage:redemptions")
      ) {
        if (this.rewards.size)
          this.listener.onChannelRedemptionAdd(userId, (event) => {
            const action = this.rewards.get(event.rewardId);
            if (!action) return;
            const actor = {
              actorId: `twitch:${event.userId}`,
              actorDisplayName: event.userDisplayName.slice(0, 32),
            };
            const weather = action.startsWith("weather:")
              ? (action.slice(8) as Weather)
              : undefined;
            const kind = weather
              ? "weather"
              : (action as "wave" | "dance" | "confetti");
            if (
              ["wave", "dance"].includes(kind) &&
              !this.room
                .getSnapshot()
                .residents.some((r) => r.id === actor.actorId)
            )
              this.room.dispatchTrusted({
                id: `twitch:redemption:${event.id}:join`,
                source: "twitch",
                kind: "join",
                ...actor,
                timestamp: Date.now(),
              });
            this.room.dispatchTrusted(
              {
                id: `twitch:redemption:${event.id}`,
                source: "twitch",
                kind,
                ...actor,
                timestamp: Date.now(),
                payload: weather ? { weather } : undefined,
                text: `${actor.actorDisplayName} redeemed a world action`,
              },
              kind === "weather" || kind === "confetti",
            );
          });
        else this.capabilities.redemptions = "no reward IDs configured";
      } else
        this.capabilities.redemptions =
          "missing channel:read:redemptions scope";
      this.listener.onChannelRaidTo(userId, (event) => {
        this.room.dispatchTrusted(
          {
            id: `twitch:raid:${randomUUID()}`,
            source: "twitch",
            kind: "raid",
            actorId: `twitch:${event.raidingBroadcasterId}`,
            actorDisplayName: event.raidingBroadcasterDisplayName.slice(0, 32),
            timestamp: Date.now(),
            text: `Welcome ${event.raidingBroadcasterDisplayName} and their community!`,
            payload: { amount: Math.max(1, Math.min(10000, event.viewers)) },
          },
          true,
        );
      });
      this.listener.start();
      this.validationTimer = setInterval(
        () => {
          void this.validateSession();
        },
        60 * 60 * 1000,
      );
      this.validationTimer.unref();
      this.status();
    } catch {
      this.capabilities.authorization =
        "connection failed; check server app/token/broadcaster settings";
      await this.failClosed();
    }
  }
  private celebrate(id: string, displayName: string, reason: string) {
    this.room.dispatchTrusted(
      {
        id: `twitch:subscription:${randomUUID()}`,
        kind: "confetti",
        source: "twitch",
        actorId: `twitch:${id}`,
        actorDisplayName: displayName.slice(0, 32),
        timestamp: Date.now(),
        text: `${displayName} ${reason}`,
        payload: { action: "celebrate" },
      },
      true,
    );
  }
  private async validateSession() {
    try {
      if (!this.auth || !this.userId) throw new Error("No authorization");
      const token = await this.auth.getAccessTokenForUser(this.userId);
      if (!token) throw new Error("Token unavailable");
      const info = await getTokenInfo(token.accessToken, this.clientId);
      if (info.userId !== this.userId || info.clientId !== this.clientId)
        throw new Error("Authorization changed");
    } catch {
      this.capabilities.authorization = "validation failed; reconnect required";
      await this.failClosed();
    }
  }
  private async failClosed() {
    await this.stop();
    this.status();
  }
  async stop() {
    if (this.validationTimer) clearInterval(this.validationTimer);
    this.validationTimer = undefined;
    this.authorizationValidated = false;
    this.chat?.quit();
    this.listener?.stop();
    this.chat = undefined;
    this.listener = undefined;
    this.chatReady = false;
    this.eventsubReady = false;
    this.activeSubscriptions.clear();
    for (const [feature, state] of Object.entries(this.capabilities))
      if (
        ["subscribed", "connected", "connecting", "socket ready"].includes(
          state,
        )
      )
        this.capabilities[feature] = "disconnected";
    this.started = false;
    await this.tokenWrite;
  }
}
