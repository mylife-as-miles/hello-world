import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { sqliteD1 } from "../../../tests/helpers/sqlite-d1.js";
import { bindCreatedSubscription, checkWebhookSubscription, deferSubscription, markSubscription, subscriptionIntent, subscriptionRecord } from "../src/twitch-subscriptions.js";

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of ["0001_world.sql", "0002_twitch.sql", "0003_twitch_delivery.sql"])
    sqlite.exec(readFileSync(new URL(`../sites-migrations/${name}`, import.meta.url), "utf8"));
  const env = { WORLD_DB: sqliteD1(sqlite), TWITCH_EVENTSUB_CALLBACK: "https://relay.test/api/twitch/eventsub" };
  const sub = { id: "sub-chat", type: "channel.chat.message", version: "1", condition: { broadcaster_user_id: "123", user_id: "123" },
    transport: { method: "webhook", callback: env.TWITCH_EVENTSUB_CALLBACK }, status: "webhook_callback_verification_pending" };
  const request = new Request("https://world.test/api/twitch/webhook", { headers: { "Twitch-Eventsub-Subscription-Type": sub.type, "Twitch-Eventsub-Subscription-Version": "1" } });
  return { sqlite, env, sub, request };
}
describe("durable subscription allowlist", () => {
  it("handles a challenge racing the Helix creation response without losing enabled state", async () => {
    const f = fixture();
    try {
      await subscriptionIntent(f.env, f.sub.type, f.sub.condition);
      await checkWebhookSubscription(f.env, f.request, { subscription: f.sub }, "webhook_callback_verification", "123");
      await markSubscription(f.env, f.sub.type, f.sub.id, "enabled");
      const row = await bindCreatedSubscription(f.env, f.sub.type, f.sub);
      expect(row.status).toBe("enabled");
      expect(row.subscription_id).toBe(f.sub.id);
    } finally { f.sqlite.close(); }
  });
  it("does not accept notifications until the exact registered subscription is enabled", async () => {
    const f = fixture();
    try {
      await subscriptionIntent(f.env, f.sub.type, f.sub.condition);
      await bindCreatedSubscription(f.env, f.sub.type, f.sub);
      const payload = { subscription: { ...f.sub, status: "enabled" }, event: { broadcaster_user_id: "123" } };
      await expect(checkWebhookSubscription(f.env, f.request, payload, "notification", "123")).rejects.toThrow("not enabled");
      await markSubscription(f.env, f.sub.type, f.sub.id, "enabled");
      await expect(checkWebhookSubscription(f.env, f.request, payload, "notification", "123")).resolves.toMatchObject({ subscription_id: f.sub.id });
      await markSubscription(f.env, f.sub.type, f.sub.id, "revoked");
      await expect(checkWebhookSubscription(f.env, f.request, { subscription: f.sub }, "webhook_callback_verification", "123")).rejects.toThrow("Unexpected");
    } finally { f.sqlite.close(); }
  });
  it("honors Retry-After durably instead of creating tight retry loops", async () => {
    const f = fixture();
    try {
      await subscriptionIntent(f.env, f.sub.type, f.sub.condition);
      const now = Date.now();
      const retryAt = await deferSubscription(f.env, f.sub.type, new Response(null, { status: 429, headers: { "Retry-After": "120" } }));
      expect(retryAt).toBeGreaterThanOrEqual(now + 120000);
      expect(retryAt).toBeLessThan(now + 121000);
      expect((await subscriptionRecord(f.env, f.sub.type))?.status).toBe("retry");
      expect(await subscriptionIntent(f.env, f.sub.type, f.sub.condition)).toBe(false);
    } finally { f.sqlite.close(); }
  });
});
