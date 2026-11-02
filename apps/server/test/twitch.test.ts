import { describe, expect, it } from "vitest";
import {
  chatToEvent,
  parseRewardActions,
  TWITCH_SCOPES,
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
