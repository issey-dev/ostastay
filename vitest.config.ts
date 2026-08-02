import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: "./vitest.global-setup.ts",
    // Raised from the 5s default when the database moved to Postgres (2026-08-02). The
    // old default was tuned for in-process SQLite, where a query costs a function call;
    // every query now crosses a TCP connection, and the bulk suites (price-calendar over
    // a 10-year range, night-audit posting) write thousands of rows per test. Those were
    // landing at 5001-5031ms — timing out on transport cost, not on any regression.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Kept sequential after the 2026-08-02 move to Postgres, but for a DIFFERENT reason
    // than before. The original one is gone: SQLite threw "database is locked" when
    // parallel files opened separate connections to the same file, which Postgres
    // handles natively. What remains is that every file shares ONE ostastay_test
    // database (globalSetup wipes it once, not per file), so suites currently rely on
    // nothing else mutating rows underneath them mid-test. Enabling parallelism is a
    // worthwhile speed-up but needs per-file isolation first — a schema or database per
    // worker — so it is deliberately a separate change.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
