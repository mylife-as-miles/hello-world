/** Durable allowlist for subscriptions created by this world/application. */
interface Statement {
  bind(...args: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
export interface SubscriptionEnv {
  WORLD_DB: { prepare(sql: string): Statement };
  WORLD_ID?: string;
  TWITCH_EVENTSUB_CALLBACK?: string;
}
export const TWITCH_SUBSCRIPTION_TYPES = new Set([
  "channel.chat.message", "channel.subscribe", "channel.subscription.gift",
  "channel.subscription.message", "channel.channel_points_custom_reward_redemption.add", "channel.raid",
]);
interface RegistryRow {
  type: string; version: string; condition_json: string; callback: string;
  subscription_id: string | null; status: string; retry_at: number;
}
const world = (env: SubscriptionEnv) => env.WORLD_ID || "hello-neighborhood";
export function conditionKey(condition: unknown): string {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) return "invalid";
  const entries = Object.entries(condition).filter(([, value]) => value !== "" && value !== null);
  if (entries.some(([, value]) => typeof value !== "string")) return "invalid";
  return JSON.stringify(Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b))));
}
export async function subscriptionRecord(env: SubscriptionEnv, type: string) {
  return env.WORLD_DB.prepare("SELECT * FROM twitch_subscriptions WHERE world_id = ? AND type = ?")
    .bind(world(env), type).first<RegistryRow>();
}
export async function subscriptionIntent(env: SubscriptionEnv, type: string, condition: Record<string, string>) {
  const existing = await subscriptionRecord(env, type);
  if (existing && existing.retry_at > Date.now()) return false;
  const same = existing?.version === "1" && existing.condition_json === conditionKey(condition) && existing.callback === env.TWITCH_EVENTSUB_CALLBACK;
  const reusable = same && ["creating", "pending", "enabled"].includes(existing!.status);
  await env.WORLD_DB.prepare(`INSERT INTO twitch_subscriptions
    (world_id,type,version,condition_json,callback,subscription_id,status,retry_at,updated_at) VALUES (?,?,'1',?,?,?,?,0,?)
    ON CONFLICT(world_id,type) DO UPDATE SET version=excluded.version, condition_json=excluded.condition_json,
    callback=excluded.callback, subscription_id=excluded.subscription_id, status=excluded.status, retry_at=0, updated_at=excluded.updated_at`)
    .bind(world(env), type, conditionKey(condition), env.TWITCH_EVENTSUB_CALLBACK, reusable ? existing!.subscription_id : null,
      reusable && existing!.status === "enabled" ? "enabled" : "creating", Date.now()).run();
  return true;
}
export function matchesSubscription(row: RegistryRow, subscription: any) {
  return typeof subscription?.id === "string" && /^[\w-]{1,128}$/.test(subscription.id) &&
    subscription.type === row.type && subscription.version === row.version && conditionKey(subscription.condition) === row.condition_json &&
    subscription.transport?.method === "webhook" && subscription.transport.callback === row.callback;
}
export async function bindCreatedSubscription(env: SubscriptionEnv, type: string, subscription: unknown) {
  const row = await subscriptionRecord(env, type);
  if (!row || !matchesSubscription(row, subscription)) throw new Error("Subscription response does not match this world");
  const sub = subscription as { id: string; status: string };
  if (!["enabled", "webhook_callback_verification_pending"].includes(sub.status)) throw new Error("Subscription was not accepted");
  const result = await env.WORLD_DB.prepare(`UPDATE twitch_subscriptions SET subscription_id=?,
    status=CASE WHEN status='enabled' OR ?='enabled' THEN 'enabled' ELSE 'pending' END, retry_at=0, updated_at=?
    WHERE world_id=? AND type=? AND (subscription_id IS NULL OR subscription_id=?)`)
    .bind(sub.id, sub.status, Date.now(), world(env), type, sub.id).run();
  if (!result.meta?.changes) throw new Error("Subscription identity changed while creating it");
  return (await subscriptionRecord(env, type))!;
}
export async function checkWebhookSubscription(env: SubscriptionEnv, request: Request, payload: any, kind: string, broadcaster: string) {
  const sub = payload.subscription;
  if (!sub || !TWITCH_SUBSCRIPTION_TYPES.has(sub.type)) throw new Error("Unsupported subscription type");
  if (request.headers.get("Twitch-Eventsub-Subscription-Type") !== sub.type || request.headers.get("Twitch-Eventsub-Subscription-Version") !== sub.version)
    throw new Error("Subscription headers do not match the payload");
  const row = await subscriptionRecord(env, sub.type);
  if (!row || !matchesSubscription(row, sub)) throw new Error("Unknown subscription, version, condition or callback");
  const expectedBroadcaster = sub.type === "channel.raid" ? sub.condition.to_broadcaster_user_id : sub.condition.broadcaster_user_id;
  if (expectedBroadcaster !== broadcaster || sub.type === "channel.chat.message" && sub.condition.user_id !== broadcaster)
    throw new Error("Subscription belongs to another broadcaster");
  if (kind === "webhook_callback_verification") {
    if (sub.status !== "webhook_callback_verification_pending" || !["creating", "pending", "enabled"].includes(row.status) || row.subscription_id && row.subscription_id !== sub.id)
      throw new Error("Unexpected subscription challenge");
  } else if (row.subscription_id !== sub.id) throw new Error("Subscription ID is not registered");
  if (kind === "notification") {
    if (row.status !== "enabled" || sub.status !== "enabled") throw new Error("Subscription is not enabled");
    const eventBroadcaster = sub.type === "channel.raid" ? payload.event?.to_broadcaster_user_id : payload.event?.broadcaster_user_id;
    if (eventBroadcaster !== broadcaster) throw new Error("Event belongs to another broadcaster");
  }
  if (kind === "revocation" && (typeof sub.status !== "string" || ["enabled", "webhook_callback_verification_pending"].includes(sub.status)))
    throw new Error("Invalid revocation status");
  return row;
}
export async function markSubscription(env: SubscriptionEnv, type: string, id: string, status: string, retryAt = 0) {
  const result = await env.WORLD_DB.prepare(`UPDATE twitch_subscriptions SET subscription_id=?, status=?, retry_at=?, updated_at=?
    WHERE world_id=? AND type=? AND (subscription_id IS NULL OR subscription_id=?)`)
    .bind(id, status, retryAt, Date.now(), world(env), type, id).run();
  if (!result.meta?.changes) throw new Error("Subscription identity was replaced");
}
export async function deferSubscription(env: SubscriptionEnv, type: string, response: Response) {
  const retry = response.headers.get("Retry-After"), reset = Number(response.headers.get("Ratelimit-Reset"));
  const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? Math.ceil((Date.parse(retry) - Date.now()) / 1000) : reset ? reset - Date.now() / 1000 : 60;
  const retryAt = Date.now() + Math.min(3600, Math.max(1, Number.isFinite(seconds) ? seconds : 60)) * 1000;
  await env.WORLD_DB.prepare("UPDATE twitch_subscriptions SET status='retry', retry_at=?, updated_at=? WHERE world_id=? AND type=?")
    .bind(retryAt, Date.now(), world(env), type).run();
  return retryAt;
}
