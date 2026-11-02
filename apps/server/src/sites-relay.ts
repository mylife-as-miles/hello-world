/** Public Twitch ingress only. The world UI remains owner-private on its own Site. */
import { verifyTwitchWebhook } from "./sites-twitch.js";
interface RelayEnv {
  TWITCH_WEBHOOK_SECRET?: string;
  PRIVATE_SITE_SERVICE_TOKEN?: string;
}
const UPSTREAM =
  "https://hello-world-miles-society.myles4miles.chatgpt.site/api/twitch/webhook";
const MAX_BODY = 65536;
const HEADERS = [
  "Twitch-Eventsub-Message-Id",
  "Twitch-Eventsub-Message-Timestamp",
  "Twitch-Eventsub-Message-Signature",
  "Twitch-Eventsub-Message-Type",
  "Twitch-Eventsub-Message-Retry",
  "Twitch-Eventsub-Subscription-Type",
  "Twitch-Eventsub-Subscription-Version",
] as const;
function fail(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
async function bounded(
  request: { body: ReadableStream<Uint8Array> | null },
  maximum: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (reader)
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > maximum) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk.value);
    }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
export default {
  async fetch(request: Request, env: RelayEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/api/twitch/eventsub" || url.search)
      return fail(404, "Not found.");
    if (request.method !== "POST") return fail(405, "Method not allowed.");
    if (!env.TWITCH_WEBHOOK_SECRET || !env.PRIVATE_SITE_SERVICE_TOKEN)
      return fail(503, "Webhook ingress is not configured.");
    if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY)
      return fail(413, "Request is too large.");
    try {
      const raw = await bounded(request, MAX_BODY);
      if (!raw) return fail(413, "Request is too large.");
      if (!(await verifyTwitchWebhook(request, env.TWITCH_WEBHOOK_SECRET, raw)))
        return fail(403, "Invalid EventSub signature or timestamp.");
      const kind = request.headers.get("Twitch-Eventsub-Message-Type");
      if (
        ![
          "webhook_callback_verification",
          "notification",
          "revocation",
        ].includes(kind || "")
      )
        return fail(400, "Unsupported EventSub message type.");
      // Parse only for envelope checks; signed raw bytes are forwarded unchanged.
      let body: {
        challenge?: unknown;
        event?: unknown;
        subscription?: { status?: string };
      };
      try {
        body = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(raw),
        );
      } catch {
        return fail(400, "Invalid EventSub body.");
      }
      if (!body || typeof body !== "object")
        return fail(400, "Invalid EventSub body.");
      if (
        kind === "webhook_callback_verification" &&
        typeof body.challenge !== "string"
      )
        return fail(400, "Invalid EventSub challenge.");
      if (
        kind === "notification" &&
        (!body.event || typeof body.event !== "object")
      )
        return fail(400, "Invalid EventSub notification.");
      if (
        kind === "revocation" &&
        (!body.subscription?.status ||
          body.subscription.status === "enabled" ||
          body.event)
      )
        return fail(400, "Invalid EventSub revocation.");
      const headers = new Headers({
        "Content-Type": "application/json",
        "OAI-Sites-Authorization": `Bearer ${env.PRIVATE_SITE_SERVICE_TOKEN}`,
      });
      for (const name of HEADERS) {
        const value = request.headers.get(name);
        if (value !== null) headers.set(name, value);
      }
      const upstream = await fetch(UPSTREAM, {
        method: "POST",
        headers,
        body: raw,
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
      });
      if (upstream.status !== 200 && upstream.status !== 204) {
        await upstream.body?.cancel();
        return fail(502, "Webhook delivery is temporarily unavailable.");
      }
      if (upstream.status === 204)
        return new Response(null, {
          status: 204,
          headers: { "Cache-Control": "no-store" },
        });
      const reply = await bounded(upstream, 4096);
      if (!reply)
        return fail(502, "Webhook delivery is temporarily unavailable.");
      return new Response(reply, {
        status: 200,
        headers: {
          "Content-Type": "text/plain",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return fail(502, "Webhook delivery is temporarily unavailable.");
    }
  },
};
