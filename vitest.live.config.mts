import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Live tests call the real (free) AI models with the keys in .env.local. Run: npm run test:live
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.live.test.ts"],
    env: loadEnv("", process.cwd(), ""),
    testTimeout: 600_000,
    fileParallelism: false,
  },
});
