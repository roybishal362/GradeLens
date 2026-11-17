import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Evaluations on real data with the real free models. Run: npm run eval
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.eval.ts"],
    env: loadEnv("", process.cwd(), ""),
    testTimeout: 6 * 3600_000,
    fileParallelism: false,
  },
});
