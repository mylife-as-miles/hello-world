import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import type { ServerMessage } from "@hello-world/contracts";
import { createWorldServer } from "../src/server.js";
import { readConfig } from "../src/config.js";
import { event, testFactory } from "./fixture.js";

type App = Awaited<ReturnType<typeof createWorldServer>>;
const apps: App[] = [];
const dirs: string[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  sockets.splice(0).forEach((ws) => ws.terminate());
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
async function setup(env: NodeJS.ProcessEnv = {}, dataDir?: string) {
  dataDir ||= await mkdtemp(join(tmpdir(), "hello-world-test-"));
  if (!dirs.includes(dataDir)) dirs.push(dataDir);
  const config = readConfig({
    PORT: "0",
    HOST: "127.0.0.1",
    DATA_DIR: dataDir,
    WORLD_ID: "test",
    WEB_ORIGIN: "http://localhost:5173",
    DIRECTOR_KEY: "private-director-key-123",
    ...env,
  });
  const webDir = join(dataDir, "web");
  await mkdir(webDir, { recursive: true });
  await writeFile(
    join(webDir, "index.html"),
    "<html><body>HELLO WORLD</body></html>",
  );
  const app = await createWorldServer(config, testFactory, {
    twitchEnv: env,
    webDir,
  });
  apps.push(app);
  const address = await app.start();
  const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  return { app, base, dataDir };
}
async function identity(base: string) {
  const response = await fetch(`${base}/api/status`);
  const status = (await response.json()) as {
    viewerId: string;
    mode: string;
    pending: unknown[];
  };
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  return { status, cookie };
}
async function connect(
  base: string,
  cookie: string,
  origin = "http://localhost:5173",
  extraHeaders: Record<string, string> = {},
) {
  const ws = new WebSocket(`${base.replace("http:", "ws:")}/ws`, {
    headers: { Cookie: cookie, Origin: origin, ...extraHeaders },
  });
  sockets.push(ws);
  const messages: ServerMessage[] = [];
  ws.on("message", (data) =>
    messages.push(JSON.parse(data.toString()) as ServerMessage),
  );
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  const waitFor = async (predicate: (message: ServerMessage) => boolean) => {
    const start = Date.now();
    while (Date.now() - start < 2500) {
      const found = messages.find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(
      `Timed out waiting for message: ${JSON.stringify(messages)}`,
    );
  };
  const send = (value: unknown) => ws.send(JSON.stringify(value));
  return { ws, messages, waitFor, send };
}
describe("HTTP/WebSocket adapter", () => {
  it("provides stable signed sessions and reports honest Demo Mode", async () => {
    const { base } = await setup();
    const first = await identity(base);
    expect(first.status.mode).toBe("demo");
    expect(first.status.viewerId).toMatch(/^viewer:/);
    const second = await fetch(`${base}/api/status`, {
      headers: { Cookie: first.cookie },
    });
    expect(((await second.json()) as { viewerId: string }).viewerId).toBe(
      first.status.viewerId,
    );
    const forged = await fetch(`${base}/api/status`, {
      headers: { Cookie: first.cookie.replace(/.$/, "x") },
    });
    expect(((await forged.json()) as { viewerId: string }).viewerId).not.toBe(
      first.status.viewerId,
    );
    expect(first.status.pending).toEqual([]);
  });
  it("rejects unapproved WebSocket origins and sessions", async () => {
    const { base } = await setup();
    const viewer = await identity(base);
    await expect(
      connect(base, viewer.cookie, "https://attacker.example"),
    ).rejects.toThrow("403");
    await expect(connect(base, "", "http://localhost:5173")).rejects.toThrow(
      "401",
    );
  });
  it("fans the same authoritative resident to two sessions, persists it, and restores on restart", async () => {
    const { app, base, dataDir } = await setup();
    const a = await identity(base);
    const b = await identity(base);
    const one = await connect(base, a.cookie);
    const two = await connect(base, b.cookie);
    one.send({
      type: "event",
      event: event("join", { actorId: "twitch:spoofed", source: "twitch" }),
    });
    await two.waitFor(
      (m) =>
        m.type === "snapshot" &&
        m.snapshot.residents.some((r) => r.id === a.status.viewerId),
    );
    expect(app.room.getSnapshot().residents[0].id).toBe(a.status.viewerId);
    one.ws.terminate();
    two.ws.terminate();
    await app.close();
    apps.splice(apps.indexOf(app), 1);
    const saved = JSON.parse(
      await readFile(join(dataDir, "world.json"), "utf8"),
    );
    expect(saved.residents[0].id).toBe(a.status.viewerId);
    const restarted = await setup({}, dataDir);
    expect(restarted.app.room.getSnapshot().residents[0].id).toBe(
      a.status.viewerId,
    );
    const sameIdentity = await fetch(`${restarted.base}/api/status`, {
      headers: { Cookie: a.cookie },
    });
    expect(((await sameIdentity.json()) as { viewerId: string }).viewerId).toBe(
      a.status.viewerId,
    );
  });
  it("requires Director authentication for world changes and approves queued actions", async () => {
    const { base, app } = await setup();
    const viewer = await identity(base);
    const director = await identity(base);
    const one = await connect(base, viewer.cookie);
    const two = await connect(base, director.cookie);
    one.send({
      type: "event",
      event: event("weather", { payload: { weather: "snow" } }),
    });
    await one.waitFor(
      (m) => m.type === "error" && m.message.includes("Director"),
    );
    expect(app.room.getSnapshot().weather).toBe("sunny");
    two.send({ type: "director-auth", key: "private-director-key-123" });
    await two.waitFor((m) => m.type === "director-auth" && m.authorized);
    two.send({
      type: "director-settings",
      settings: { approvalRequired: true, cooldownSeconds: 0 },
    });
    one.send({ type: "event", event: event("join") });
    await two.waitFor(
      (m) => m.type === "snapshot" && m.snapshot.residents.length === 1,
    );
    one.send({ type: "event", event: event("dance") });
    const status = await two.waitFor(
      (m) => m.type === "status" && m.pending.length === 1,
    );
    expect(status.type).toBe("status");
    if (status.type !== "status") return;
    expect(app.room.getSnapshot().eventHistory).toHaveLength(1);
    const publicStatus = await fetch(`${base}/api/status`);
    expect(
      ((await publicStatus.json()) as { pending: unknown[] }).pending,
    ).toEqual([]);
    two.send({ type: "approve", eventId: status.pending[0].id });
    await one.waitFor(
      (m) =>
        m.type === "snapshot" &&
        m.snapshot.eventHistory.some((e) => e.kind === "dance"),
    );
  });
  it("serves built SPA routes and does not expose paths outside its web directory", async () => {
    const { base, dataDir } = await setup();
    await writeFile(join(dataDir, "private.txt"), "SECRET");
    const response = await fetch(`${base}/overlay?camera=street`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("HELLO WORLD");
    const escaped = await fetch(`${base}/%2e%2e/private.txt`);
    expect(await escaped.text()).not.toContain("SECRET");
    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
    expect((await fetch(`${base}/api/unknown`)).status).toBe(404);
  });
  it("protects OAuth start and binds single-use authorization state to the initiating session", async () => {
    const { base } = await setup({
      TWITCH_CLIENT_ID: "example-app",
      TWITCH_CLIENT_SECRET: "secret-for-test",
      TWITCH_REDIRECT_URI: "http://localhost:5173/api/twitch/callback",
    });
    const viewer = await identity(base);
    const other = await identity(base);
    const post = (cookie: string, key = "") =>
      fetch(`${base}/api/twitch/connect`, {
        method: "POST",
        headers: {
          Origin: "http://localhost:5173",
          Cookie: cookie,
          "X-Director-Key": key,
        },
      });
    expect((await post(viewer.cookie)).status).toBe(403);
    const start = await post(viewer.cookie, "private-director-key-123");
    expect(start.status).toBe(200);
    const { authorizeUrl } = (await start.json()) as { authorizeUrl: string };
    const authorize = new URL(authorizeUrl);
    expect(authorize.origin).toBe("https://id.twitch.tv");
    expect(authorize.searchParams.get("scope")).toContain(
      "channel:read:redemptions",
    );
    const state = authorize.searchParams.get("state")!;
    const wrong = await fetch(`${base}/api/twitch/callback?state=${state}`, {
      headers: { Cookie: other.cookie },
    });
    expect(wrong.status).toBe(403);
    const replay = await fetch(`${base}/api/twitch/callback?state=${state}`, {
      headers: { Cookie: viewer.cookie },
    });
    expect(replay.status).toBe(403);
  });
  it("enables opt-in local Demo Director only for loopback configured origin", async () => {
    const { base } = await setup({
      ALLOW_LOCAL_DIRECTOR: "true",
      DIRECTOR_KEY: "",
    });
    const viewer = await identity(base);
    const local = await connect(base, viewer.cookie);
    expect((await local.waitFor((m) => m.type === "director-auth")).type).toBe(
      "director-auth",
    );
    expect(local.messages.find((m) => m.type === "director-auth")).toEqual({
      type: "director-auth",
      authorized: true,
    });
    const proxiedRemote = await connect(
      base,
      viewer.cookie,
      "http://localhost:5173",
      { "x-hw-peer-address": "203.0.113.50" },
    );
    expect(
      await proxiedRemote.waitFor((m) => m.type === "director-auth"),
    ).toEqual({ type: "director-auth", authorized: false });
  });
});
