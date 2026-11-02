import { config as dotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { readConfig } from "./config.js";
import { createWorldServer } from "./server.js";
import type { RuntimeFactory } from "./room.js";
import { createWorldRuntime } from "@hello-world/world-engine/runtime";

dotenv({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
} as Parameters<typeof dotenv>[0]);
dotenv({ quiet: true } as Parameters<typeof dotenv>[0]);
const config = readConfig();
const runtimeFactory: RuntimeFactory = (options) =>
  createWorldRuntime({ ...options, ingressCooldowns: false });
const app = await createWorldServer(config, runtimeFactory);
const address = await app.start();
console.info(
  `HELLO WORLD server listening on ${typeof address === "object" && address ? address.port : config.port}; web origin ${config.webOrigin}`,
);
if (!process.env.TWITCH_CLIENT_ID)
  console.info("Demo Mode: Twitch credentials are not configured.");
if (config.allowLocalDirector && !config.directorKey)
  console.info(
    "Local Demo Director enabled for loopback-origin browser sessions only.",
  );
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    void app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
