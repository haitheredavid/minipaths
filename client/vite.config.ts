import { defineConfig } from "npm:vite@6";
import react from "npm:@vitejs/plugin-react@4";

export default defineConfig({
  plugins: [react()],
  root: "./client",
  server: {
    allowedHosts: ["host.docker.internal", "localhost"],
    proxy: {
      "/api": "http://localhost:8000",
      "/ws": {
        target: "ws://localhost:8000",
        ws: true,
      },
    },
  },
  build: {
    outDir: "../dist",
  },
});
