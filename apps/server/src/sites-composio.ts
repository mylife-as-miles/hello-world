/** Owner-only, isolated profile proof. Never dispatches WorldEvents or exports tokens. */
import { beginManagedProfileProof, ComposioPocError, createManagedProfileClient, inspectManagedTwitch, readManagedProfileProof, type ManagedProfileClient, type ProfileAttempt } from "./composio-twitch-poc.js";
interface Statement {
  bind(...args: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
export interface HostedComposioEnv {
  COMPOSIO_API_KEY?: string;
  TWITCH_TOKEN_ENCRYPTION_KEY?: string;
  WORLD_ID?: string;
  WORLD_DB: { prepare(sql: string): Statement };
}
type ProofRow = { status: string; claim_token: string; updated_at: number; attempt_json: string | null; result_json: string | null; link_cipher: string | null };
async function linkKey(env: HostedComposioEnv) {
  const bytes = Uint8Array.from(atob(env.TWITCH_TOKEN_ENCRYPTION_KEY || ""), c => c.charCodeAt(0));
  if (bytes.length !== 32) throw new ComposioPocError("PRIVATE_PROOF_ENCRYPTION_UNAVAILABLE");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}
const b64 = (v: Uint8Array) => btoa(String.fromCharCode(...v));
const un64 = (v: string) => Uint8Array.from(atob(v), c => c.charCodeAt(0));
async function sealLink(env: HostedComposioEnv, scope: string, link: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(scope) }, await linkKey(env), new TextEncoder().encode(link));
  return JSON.stringify({ iv: b64(iv), data: b64(new Uint8Array(bytes)) });
}
async function openLink(env: HostedComposioEnv, scope: string, cipher: string) {
  const v = JSON.parse(cipher);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: un64(v.iv), additionalData: new TextEncoder().encode(scope) }, await linkKey(env), un64(v.data)));
}
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" },
});
export async function handleHostedComposio(request: Request, env: HostedComposioEnv, actor: string | undefined, director: boolean,
  factory: (key: string) => Promise<ManagedProfileClient> = createManagedProfileClient) {
  if (!actor) return reply({ error: "SIGN_IN_REQUIRED" }, 401);
  if (!director) return reply({ error: "WORLD_OWNER_REQUIRED" }, 403);
  const path = new URL(request.url).pathname, world = env.WORLD_ID || "hello-neighborhood";
  const scope = `composio-profile:${world}:${actor}`;
  const row = () => env.WORLD_DB.prepare("SELECT status,claim_token,updated_at,attempt_json,result_json,link_cipher FROM composio_profile_proofs WHERE world_id=? AND owner_actor=?")
    .bind(world, actor).first<ProofRow>();
  if (request.method === "GET" && path === "/api/composio/twitch/status") {
    const saved = await row();
    let connectUrl: string | undefined, expired = false;
    if (saved?.status === "awaiting-consent" && saved.attempt_json) {
      const attempt = JSON.parse(saved.attempt_json) as ProfileAttempt;
      expired = attempt.expiresAt < Date.now();
      if (!expired && saved.link_cipher) {
        try { connectUrl = await openLink(env, scope, saved.link_cipher); }
        catch { return reply({ error: "PRIVATE_PROOF_ENCRYPTION_UNAVAILABLE" }, 503); }
      }
    }
    return reply({ configured: Boolean(env.COMPOSIO_API_KEY && env.TWITCH_TOKEN_ENCRYPTION_KEY), status: expired ? "expired-review-required" : saved?.status || "not-started", connectUrl, profileReadVerified: saved?.status === "verified", liveEventsVerified: false });
  }
  if (request.method !== "POST" || !["inspect", "connect", "read", "reset-proof"].some(a => path === `/api/composio/twitch/${a}`))
    return reply({ error: "PROOF_ROUTE_NOT_FOUND" }, 404);
  if (request.headers.get("Origin") !== new URL(request.url).origin || !request.headers.get("Content-Type")?.startsWith("application/json"))
    return reply({ error: "SAME_ORIGIN_JSON_REQUIRED" }, 403);
  try {
    const reader = request.body?.getReader(); let bytes = 0, chunks = "";
    if (!reader) return reply({ error: "APPROVAL_REQUIRED" }, 400);
    const decoder = new TextDecoder();
    while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength;
      if (bytes > 1024) { await reader.cancel(); return reply({ error: "PROOF_REQUEST_TOO_LARGE" }, 413); }
      chunks += decoder.decode(next.value, { stream: true }); }
    chunks += decoder.decode();
    const body = JSON.parse(chunks), connecting = path.endsWith("/connect"), reset = path.endsWith("/reset-proof");
    if (body?.approval !== (reset ? "reset-after-revocation" : connecting ? "connect-profile" : "read-only")) return reply({ error: "OWNER_APPROVAL_REQUIRED" }, 400);
    if (reset) {
      const saved = await row();
      if (saved?.status === "starting" && Date.now() - saved.updated_at < 120_000)
        return reply({ error: "CONNECTION_CREATION_IN_PROGRESS" }, 409);
      if (saved) await env.WORLD_DB.prepare("DELETE FROM composio_profile_proofs WHERE world_id=? AND owner_actor=? AND claim_token=?")
        .bind(world, actor, saved.claim_token).run();
      return reply({ status: "not-started", liveEventsVerified: false, providerRevocationPerformed: false });
    }
    if (!env.COMPOSIO_API_KEY) return reply({ error: "PRIVATE_COMPOSIO_CONFIGURATION_REQUIRED" }, 503);
    const client = await factory(env.COMPOSIO_API_KEY);
    if (path.endsWith("/inspect")) return reply({ ...await inspectManagedTwitch(client), profileProofReady: true });
    if (connecting) {
      await linkKey(env); // Check private storage before creating a persistent config.
      // Fail before creating any persistent config if scope metadata isn't safe.
      await inspectManagedTwitch(client);
      const claimToken = crypto.randomUUID();
      const claim = await env.WORLD_DB.prepare("INSERT OR IGNORE INTO composio_profile_proofs (world_id,owner_actor,status,claim_token,updated_at) VALUES (?,?,'starting',?,?)")
        .bind(world, actor, claimToken, Date.now()).run();
      if (!claim.meta?.changes) return reply({ error: "EXISTING_PRIVATE_ATTEMPT_REQUIRES_REVIEW" }, 409);
      try {
        const proof = await beginManagedProfileProof(client, actor, "connect-profile");
        const updated = await env.WORLD_DB.prepare("UPDATE composio_profile_proofs SET status='awaiting-consent',attempt_json=?,link_cipher=?,updated_at=? WHERE world_id=? AND owner_actor=? AND claim_token=? AND status='starting'")
          .bind(JSON.stringify(proof.attempt), await sealLink(env, scope, proof.connectUrl), Date.now(), world, actor, claimToken).run();
        if (!updated.meta?.changes) throw new ComposioPocError("PROOF_ATTEMPT_REPLACED");
        // Short-lived consent link goes only to the authenticated owner; encrypted at rest.
        return reply({ connectUrl: proof.connectUrl, expiresAt: proof.attempt.expiresAt, liveEventsVerified: false });
      } catch (error) {
        await env.WORLD_DB.prepare("UPDATE composio_profile_proofs SET status='review-required',updated_at=? WHERE world_id=? AND owner_actor=? AND claim_token=?")
          .bind(Date.now(), world, actor, claimToken).run();
        throw error;
      }
    }
    const saved = await row();
    if (!saved?.attempt_json) return reply({ error: "OWNER_CONNECTION_NOT_STARTED" }, 409);
    if (saved.status === "verified") return reply({ profileReadVerified: true, liveEventsVerified: false });
    const proof = await readManagedProfileProof(client, JSON.parse(saved.attempt_json) as ProfileAttempt, actor, "read-only");
    const updated = await env.WORLD_DB.prepare("UPDATE composio_profile_proofs SET status='verified',result_json=?,link_cipher=NULL,updated_at=? WHERE world_id=? AND owner_actor=? AND claim_token=?")
      .bind(JSON.stringify(proof), Date.now(), world, actor, saved.claim_token).run();
    if (!updated.meta?.changes) throw new ComposioPocError("PROOF_ATTEMPT_REPLACED");
    return reply(proof);
  } catch (error) {
    return reply({ error: error instanceof ComposioPocError ? error.code : "PROFILE_PROOF_FAILED", liveEventsVerified: false }, 400);
  }
}
