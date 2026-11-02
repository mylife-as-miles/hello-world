import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DirectorSettings } from "@hello-world/contracts";

export interface ServerConfig {
  port: number;
  host: string;
  webOrigin: string;
  worldId: string;
  dataDir: string;
  directorKey: string;
  allowLocalDirector: boolean;
  maxConnections: number;
  settings: DirectorSettings;
}
export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.PORT || 3001);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("PORT must be 0–65535");
  const originUrl = new URL(env.WEB_ORIGIN || "http://localhost:5173");
  if (!["http:", "https:"].includes(originUrl.protocol))
    throw new Error("WEB_ORIGIN must use http or https");
  const webOrigin = originUrl.origin;
  const directorKey = env.DIRECTOR_KEY || "";
  if (directorKey && directorKey.length < 16)
    throw new Error("DIRECTOR_KEY must contain at least 16 characters");
  return {
    port,
    host: env.HOST || "0.0.0.0",
    webOrigin,
    worldId: env.WORLD_ID || "hello-neighborhood",
    dataDir: resolve(
      env.DATA_DIR || fileURLToPath(new URL("../../../.data", import.meta.url)),
    ),
    directorKey,
    allowLocalDirector: env.ALLOW_LOCAL_DIRECTOR === "true",
    maxConnections: 100,
    settings: {
      approvalRequired: false,
      cooldownSeconds: 2,
      maxResidents: 50,
      paused: false,
    },
  };
}
