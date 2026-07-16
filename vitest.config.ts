import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: "./vitest.global-setup.ts",
    // Tests share one test.db (better-sqlite3, no WAL) — parallel files opening separate
    // connections to the same file intermittently throws "database is locked".
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
