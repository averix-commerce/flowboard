import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const agentTarget = process.env.VITE_AGENT_PROXY_TARGET ?? "http://localhost:8101";
const agentWsTarget =
  process.env.VITE_AGENT_PROXY_WS_TARGET ?? agentTarget.replace(/^http/, "ws");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": agentTarget,
      "/media": agentTarget,
      "/ws": {
        target: agentWsTarget,
        ws: true,
      },
    },
  },
});
