import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerConfig } from "./config.js";

export function secretEquals(actual: string, expected: string): boolean {
  if (!expected || !actual) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function isLocalDirector(
  req: IncomingMessage,
  config: ServerConfig,
): boolean {
  if (!config.allowLocalDirector || config.directorKey) return false;
  const address = req.socket.remoteAddress;
  const loopbacks = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
  if (!loopbacks.includes(address || "")) return false;
  // The development proxy must overwrite this header with its real peer address.
  const forwardedPeer = req.headers["x-hw-peer-address"];
  if (
    forwardedPeer !== undefined &&
    (typeof forwardedPeer !== "string" || !loopbacks.includes(forwardedPeer))
  )
    return false;
  if (req.headers.origin !== config.webOrigin) return false;
  const hostname = new URL(config.webOrigin).hostname;
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}
export function allowedOrigin(
  req: IncomingMessage,
  config: ServerConfig,
): boolean {
  return req.headers.origin === config.webOrigin;
}
export class SessionStore {
  private key: Buffer;
  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const path = join(dataDir, "session-key");
    if (!existsSync(path))
      writeFileSync(path, randomBytes(32), { mode: 0o600, flag: "wx" });
    this.key = readFileSync(path);
  }
  private sign(id: string): string {
    return createHmac("sha256", this.key).update(id).digest("base64url");
  }
  read(req: IncomingMessage): string | null {
    const value = req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("hw_session="))
      ?.slice(11);
    if (!value) return null;
    const [id, signature, extra] = value.split(".");
    if (extra || !/^[a-f0-9]{32}$/.test(id || "") || !signature) return null;
    return secretEquals(signature, this.sign(id)) ? `viewer:${id}` : null;
  }
  ensure(req: IncomingMessage, res: ServerResponse): string {
    const old = this.read(req);
    if (old) return old;
    const id = randomBytes(16).toString("hex");
    const secure =
      req.headers.origin?.startsWith("https:") ||
      req.headers["x-forwarded-proto"] === "https";
    res.setHeader(
      "Set-Cookie",
      `hw_session=${id}.${this.sign(id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure ? "; Secure" : ""}`,
    );
    return `viewer:${id}`;
  }
}
export class SlidingLimit {
  private timestamps = new Map<string, number[]>();
  constructor(
    private maximum: number,
    private windowMs: number,
  ) {}
  allow(key: string, now = Date.now()): boolean {
    const recent = (this.timestamps.get(key) || []).filter(
      (t) => t > now - this.windowMs,
    );
    if (recent.length >= this.maximum) return false;
    recent.push(now);
    this.timestamps.set(key, recent);
    if (this.timestamps.size > 5000) this.prune(now);
    return true;
  }
  private prune(now: number) {
    for (const [key, values] of this.timestamps)
      if (!values.some((v) => v > now - this.windowMs))
        this.timestamps.delete(key);
  }
}
