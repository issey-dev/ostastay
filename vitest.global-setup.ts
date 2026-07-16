import { execSync } from "child_process";
import { existsSync, unlinkSync } from "fs";
import path from "path";

// Runs once before the whole test run: rebuilds a disposable test.db from the real
// migration files (never dev.db), so the schema under test can never drift from what
// dev/production actually run.
export default async function globalSetup() {
  const testDbPath = path.resolve(__dirname, "test.db");
  process.env.DATABASE_URL = `file:${testDbPath}`;

  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const p = testDbPath + suffix;
    if (existsSync(p)) unlinkSync(p);
  }

  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: `file:${testDbPath}` },
  });
}
