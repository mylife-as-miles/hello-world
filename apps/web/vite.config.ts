import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

// Preserve the actual dev browser peer for the server's local-only Director check.
// Always overwrite the header; never forward a client-provided value.
const markProxyPeer: NonNullable<ProxyOptions["configure"]> = (proxy) => {
  proxy.on("proxyReq", (outgoing, incoming) =>
    outgoing.setHeader(
      "x-hw-peer-address",
      incoming.socket.remoteAddress || "unknown",
    ),
  );
  proxy.on("proxyReqWs", (outgoing, incoming) =>
    outgoing.setHeader(
      "x-hw-peer-address",
      incoming.socket.remoteAddress || "unknown",
    ),
  );
};
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    fs: {
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/.data/**"],
    },
    proxy: {
      "/api": { target: "http://localhost:3001", configure: markProxyPeer },
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
        configure: markProxyPeer,
      },
    },
  },
  build: { chunkSizeWarningLimit: 1100 },
});
