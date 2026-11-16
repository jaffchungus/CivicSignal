import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        // The API rejects unsafe requests whose Origin does not match the
        // request host. Without these headers the proxy's target (3001) looks
        // like a different site from the dev origin (5173), so every sign-in,
        // sign-up, and form submission would fail with CROSS_ORIGIN_REQUEST.
        xfwd: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    maxWorkers: 2,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
