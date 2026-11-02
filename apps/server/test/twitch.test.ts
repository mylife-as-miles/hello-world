import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exchangeCode, getTokenInfo } from "@twurple/auth";
import type { TokenInfo } from "@twurple/auth";
import type { WorldRoom } from "../src/room.js";
vi.mock("@twurple/auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("@twurple/auth")>();
  return { ...original, exchangeCode: vi.fn(), getTokenInfo: vi.fn() };
});
import {
  chatToEvent,
  parseRewardActions,
  TWITCH_SCOPES,
  TwitchAdapter,
} from "../src/twitch.js";
import { testFactory, event } from "./fixture.js";
describe("Twitch normalization", () => {
  const identity = { id: "123", displayName: "Miles", messageId: "msg1" };
  it("maps allowed commands to shared WorldEvents with stable Twitch identities", () => {
    const snapshot = testFactory().getSnapshot();
    expect(chatToEvent("!join", identity, snapshot)).toMatchObject({
      id: "twitch:chat:msg1",
      kind: "join",
      source: "twitch",
      actorId: "twitch:123",
    });
    expect(chatToEvent("!wave", identity, snapshot)?.kind).toBe("wave");
    expect(chatToEvent("!dance", identity, snapshot)?.kind).toBe("dance");
    expect(chatToEvent("!hello neighbors", identity, snapshot)).toMatchObject({
      kind: "chat",
      text: "neighbors",
    });
    expect(chatToEvent("!eval doBadThings()", identity, snapshot)).toBeNull();
  });
  it("resolves gifts only to existing residents and receives ordinary chat only after joining", () => {
    const runtime = testFactory();
    expect(chatToEvent("hello", identity, runtime.getSnapshot())).toBeNull();
    runtime.dispatch(event("join", { actorId: "twitch:123" }));
    runtime.dispatch(
      event("join", { actorId: "viewer:456", actorDisplayName: "Luna" }),
    );
    expect(
      chatToEvent("!gift @Luna", identity, runtime.getSnapshot()),
    ).toMatchObject({ kind: "gift", targetId: "viewer:456" });
    expect(
      chatToEvent("!gift unknown", identity, runtime.getSnapshot()),
    ).toBeNull();
    expect(
      chatToEvent("hello\u0000 world", identity, runtime.getSnapshot())?.text,
    ).toBe("hello world");
  });
  it("accepts only explicitly configured reward IDs and approved action values", () => {
    expect(
      parseRewardActions(
        '{"reward-id":"dance","weather-id":"weather:rain"}',
      ).get("reward-id"),
    ).toBe("dance");
    expect(() => parseRewardActions('{"reward-id":"execute"}')).toThrow();
    expect(() => parseRewardActions('["dance"]')).toThrow();
    expect(TWITCH_SCOPES).toContain("chat:read");
    expect(TWITCH_SCOPES).not.toContain("user:read:chat");
  });
});

const temporaryDirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirs
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
describe("Twitch authorization readiness (mocked HTTP, not live reception)", () => {
  const environment = {
    TWITCH_CLIENT_ID: "test-application",
    TWITCH_CLIENT_SECRET: "test-secret-not-a-credential",
    TWITCH_REDIRECT_URI: "http://localhost:5173/api/twitch/callback",
    TWITCH_BROADCASTER_ID: "123",
    TWITCH_BROADCASTER_NAME: "miles",
  };
  it.each([
    ["http://localhost:5173/api/twitch/callback", true],
    ["https://world.example/api/twitch/callback", true],
    ["http://world.example/api/twitch/callback", false],
    ["https://world.example/incorrect-route", false],
    ["javascript:alert(1)", false],
    ["not a URL", false],
  ])("reports callback configuration readiness for %s", (uri, expected) => {
    const adapter = new TwitchAdapter({} as WorldRoom, "/unused-test-dir", {
      ...environment,
      TWITCH_REDIRECT_URI: String(uri),
    });
    expect(adapter.oauthConfigured).toBe(expected);
  });
  it.each([
    { clientId: "wrong-application", userId: "123", userName: "miles" },
    { clientId: "test-application", userId: "456", userName: "someoneelse" },
    { clientId: "test-application", userId: "123", userName: "wronglogin" },
  ])(
    "rejects a mismatched OAuth grant without stopping or replacing saved authorization (%j)",
    async (info) => {
      const dir = await mkdtemp(join(tmpdir(), "hello-world-oauth-grant-"));
      temporaryDirs.push(dir);
      const tokenPath = join(dir, "twitch-token.json");
      const previous = JSON.stringify({
        clientId: "test-application",
        token: { accessToken: "previous-test-token" },
      });
      await writeFile(tokenPath, previous);
      vi.mocked(exchangeCode).mockResolvedValue({
        accessToken: "new-test-token",
        refreshToken: "test-refresh",
        scope: [],
        expiresIn: 3600,
        obtainmentTimestamp: Date.now(),
      });
      vi.mocked(getTokenInfo).mockResolvedValue(info as TokenInfo);
      const adapter = new TwitchAdapter({} as WorldRoom, dir, environment);
      const stop = vi.spyOn(adapter, "stop");
      await expect(adapter.authorize("test-code")).rejects.toThrow(
        "configured broadcaster",
      );
      expect(stop).not.toHaveBeenCalled();
      expect(await readFile(tokenPath, "utf8")).toBe(previous);
    },
  );
  it("keeps credential-free startup explicitly in Demo Mode", async () => {
    const status = vi.fn();
    const adapter = new TwitchAdapter(
      { setConnection: status } as unknown as WorldRoom,
      "/unused-test-dir",
      {},
    );
    await adapter.start();
    expect(adapter.oauthConfigured).toBe(false);
    expect(status).toHaveBeenCalledWith(
      "demo",
      expect.stringContaining("credentials not configured"),
      {},
    );
    await adapter.stop();
  });
});
