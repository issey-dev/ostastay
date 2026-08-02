import { execSync } from "child_process";

// Runs once before the whole test run: rebuilds a disposable test database from the real
// migration files, so the schema under test can never drift from what dev/production run.
//
// Postgres since 2026-08-02 (was a throwaway SQLite file). This needs a server to be
// running — `docker compose -f docker-compose.dev.yml up -d` starts one and creates both
// the dev and test databases. CI can point elsewhere with TEST_DATABASE_URL.
//
// The test database is SEPARATE from the dev one on purpose: this setup wipes it on every
// run, and doing that to a developer's working data would be an unpleasant surprise.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://osta:devpass@localhost:55432/ostastay_test";

export default async function globalSetup() {
  process.env.DATABASE_URL = TEST_DATABASE_URL;

  // Dropping and recreating the schema is the Postgres equivalent of deleting test.db:
  // it guarantees the run starts from the migration files rather than from whatever the
  // previous run left behind. CASCADE clears the tables and their foreign keys together.
  try {
    execSync(`npx prisma db execute --url "${TEST_DATABASE_URL}" --stdin`, {
      input: "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;",
      stdio: ["pipe", "inherit", "inherit"],
    });
  } catch {
    throw new Error(
      `Could not reach the test database at ${TEST_DATABASE_URL}.\n` +
        `Start it with:  docker compose -f docker-compose.dev.yml up -d\n` +
        `(or set TEST_DATABASE_URL to point at your own Postgres.)`
    );
  }

  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
