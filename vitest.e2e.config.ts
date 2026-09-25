import { defineConfig } from "vitest/config";
import path from "path";

// npm run test:e2e — browser click-through tests (tests/e2e/**/*.e2e.ts). Separate from
// vitest.config.ts on purpose:
//   - the files are *.e2e.ts, so `npm test` (and the deploy pipeline) never pick them up;
//   - NO globalSetup: they do not wipe or migrate a test database. They drive the RUNNING
//     app (E2E_BASE_URL, default http://localhost:3000) and arrange data in that app's
//     own database (DATABASE_URL from .env), inside the isolated "e2e" enterprise that
//     tests/e2e/fixtures.ts creates. The Veyo and Coral Bay demos are never touched.
// Local development only — tests/e2e/fixtures.ts refuses NODE_ENV=production and any
// base URL that isn't localhost.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/e2e/**/*.e2e.ts"],
    // One file at a time: every spec shares the one e2e property (and Night Audit moves
    // its business date), so they must not interleave.
    fileParallelism: false,
    // A cold dev server compiles each route on first request — tens of seconds.
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
