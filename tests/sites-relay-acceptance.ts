/** Run: pnpm --filter @hello-world/server exec tsx ../../tests/sites-relay-acceptance.ts
 * Mocked fixed-upstream HTTP; this does not claim deployment or live Twitch delivery.
 */
import assert from "node:assert/strict";
import relay from "../apps/server/src/sites-relay.ts";
let checks = 0;
const eq = (a: unknown, b: unknown) => {
  assert.deepEqual(a, b);
  checks++;
};
const ok = (a: unknown) => {
  assert.ok(a);
  checks++;
};
const env = {
  TWITCH_WEBHOOK_SECRET: "a".repeat(64),
  PRIVATE_SITE_SERVICE_TOKEN: "test-private-service-token",
};
async function signed(
  raw: string,
  kind = "webhook_callback_verification",
  timestamp = new Date().toISOString(),
  path = "/api/twitch/eventsub",
) {
  const id = crypto.randomUUID();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.TWITCH_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(id + timestamp + raw),
  );
  const signature = Array.from(new Uint8Array(mac), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return new Request("https://relay.test" + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Twitch-Eventsub-Message-Id": id,
      "Twitch-Eventsub-Message-Timestamp": timestamp,
      "Twitch-Eventsub-Message-Signature": "sha256=" + signature,
      "Twitch-Eventsub-Message-Type": kind,
      "OAI-Sites-Authorization": "Bearer attacker",
      "oai-authenticated-user-id": "spoof",
      Cookie: "evil-cookie",
      "X-Forwarded-Host": "evil.test",
    },
    body: raw,
  });
}
async function main() {
  const original = globalThis.fetch;
  let calls = 0;
  let received: any;
  let status = 200;
  let body = "exact-challenge";
  let networkError = false;
  globalThis.fetch = async (url: any, init: any) => {
    calls++;
    received = { url, init };
    if (networkError) throw new Error("secret-error");
    return new Response(status === 204 ? null : body, {
      status,
      headers: {
        Location: "https://attacker.test",
        "Set-Cookie": "upstream-secret-cookie",
        "X-Secret": "private",
        "Content-Type": "text/plain",
      },
    });
  };
  try {
    eq(
      (await relay.fetch(new Request("https://relay.test/"), env)).status,
      404,
    );
    eq(
      (
        await relay.fetch(
          new Request("https://relay.test/api/twitch/eventsub"),
          env,
        )
      ).status,
      405,
    );
    eq(
      (
        await relay.fetch(
          new Request("https://relay.test/api/twitch/eventsub", {
            method: "POST",
            body: "{}",
          }),
          {},
        )
      ).status,
      503,
    );
    eq(
      (
        await relay.fetch(
          new Request("https://relay.test/api/twitch/eventsub", {
            method: "POST",
            body: "{}",
          }),
          env,
        )
      ).status,
      403,
    );
    const raw =
      "\uFEFF" +
      JSON.stringify({
        challenge: "exact-challenge",
        subscription: { status: "webhook_callback_verification_pending" },
      });
    eq(
      (
        await relay.fetch(
          await signed(
            raw,
            "webhook_callback_verification",
            new Date(Date.now() - 700000).toISOString(),
          ),
          env,
        )
      ).status,
      403,
    );
    eq(
      (
        await relay.fetch(
          await signed(
            raw,
            "webhook_callback_verification",
            new Date(Date.now() + 120000).toISOString(),
          ),
          env,
        )
      ).status,
      403,
    );
    const tampered = await signed(raw);
    const bad = new Request(tampered.url, {
      method: "POST",
      headers: tampered.headers,
      body: raw + " ",
    });
    eq((await relay.fetch(bad, env)).status, 403);
    eq(
      (
        await relay.fetch(
          await signed(JSON.stringify({ challenge: "x".repeat(70000) })),
          env,
        )
      ).status,
      413,
    );
    eq(calls, 0);
    const answer = await relay.fetch(await signed(raw), env);
    eq(answer.status, 200);
    eq(await answer.text(), "exact-challenge");
    eq(
      received.url,
      "https://hello-world-miles-society.myles4miles.chatgpt.site/api/twitch/webhook",
    );
    eq(received.init.redirect, "manual");
    eq(
      received.init.headers.get("OAI-Sites-Authorization"),
      "Bearer test-private-service-token",
    );
    eq(received.init.headers.get("oai-authenticated-user-id"), null);
    eq(received.init.headers.get("Cookie"), null);
    eq(received.init.headers.get("X-Forwarded-Host"), null);
    eq(
      Array.from(received.init.body),
      Array.from(new TextEncoder().encode(raw)),
    );
    eq(answer.headers.get("Set-Cookie"), null);
    eq(answer.headers.get("X-Secret"), null);
    ok(answer.headers.get("Content-Type")?.startsWith("text/plain"));
    status = 302;
    body = "upstream-error-secret";
    const before = calls;
    const redirected = await relay.fetch(await signed(raw), env);
    eq(redirected.status, 502);
    eq(calls - before, 1);
    ok(!(await redirected.text()).includes("upstream-error-secret"));
    eq(redirected.headers.get("Location"), null);
    status = 403;
    const forbidden = await relay.fetch(await signed(raw), env);
    eq(forbidden.status, 502);
    ok(!(await forbidden.text()).includes("upstream-error-secret"));
    status = 200;
    body = "x".repeat(5000);
    eq((await relay.fetch(await signed(raw), env)).status, 502);
    status = 204;
    const notification = JSON.stringify({
      event: { user_id: "123" },
      subscription: { status: "enabled" },
    });
    eq(
      (await relay.fetch(await signed(notification, "notification"), env))
        .status,
      204,
    );
    networkError = true;
    const failed = await relay.fetch(await signed(raw), env);
    eq(failed.status, 502);
    ok(!(await failed.text()).includes("secret-error"));
    console.log(
      JSON.stringify({
        checks,
        fixedUpstream: true,
        serverOnlyServiceHeader: true,
        rawBytesPreserved: true,
        invalidHmacBlocked: true,
        redirectNotFollowed: true,
        upstreamDetailsHidden: true,
      }),
    );
  } finally {
    globalThis.fetch = original;
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
