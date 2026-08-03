// Ensures the platform's own furniture exists: the single INTERNAL "Osta" enterprise
// (the admin side that manages customer enterprises and the channel-manager
// connections) plus its system and support roles.
//
// Runs on EVERY container start (see docker-entrypoint.sh), so a fresh deployment has
// the admin side by default — the only thing left for the operator is minting their own
// account with scripts/bootstrap-admin.ts, which reuses this and adds the user. No user
// is ever created here: an account needs a password, and a default password would be a
// well-known credential on every deployment, which is exactly what the bootstrap
// script's per-invocation ADMIN_PASSWORD exists to avoid.
//
// Idempotent (everything is an upsert) and safe under concurrent replicas: two
// containers booting at once can race the same upsert into a P2002 unique violation, in
// which case the other replica simply won and a retry sees its rows.

import { SYSTEM_ROLE_DEFS, SUPPORT_ROLE_DEFS, ensureRoles } from "../prisma/rbac-seed-data";

// The minimal structural client shape, for the same reason ensureRoles declares one: the
// generated Prisma client stays assignable without this file depending on generation.
type EnsureClient = {
  enterprise: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    upsert: (args: any) => Promise<{ id: string }>;
  };
  role: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    upsert: (args: any) => Promise<{ id: string; name: string }>;
  };
};

export async function ensurePlatform(
  prisma: EnsureClient,
  // Overridable ONLY so tests can target the shared test-database enterprise instead of
  // minting a second INTERNAL row (two INTERNAL enterprises would make every
  // isInternal resolution ambiguous). Production callers never pass this.
  opts?: { slug?: string; name?: string }
): Promise<{ ostaEnterpriseId: string; systemRoleIds: Record<string, string> }> {
  const slug = opts?.slug ?? "osta";
  const name = opts?.name ?? "Osta";

  const run = async () => {
    // Exactly one INTERNAL enterprise may exist; slug "osta" is what the rest of the
    // app and every seed script already assume.
    const osta = await prisma.enterprise.upsert({
      where: { slug },
      update: {},
      create: { name, slug, type: "INTERNAL" },
    });
    const systemRoleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    await ensureRoles(prisma, osta.id, SUPPORT_ROLE_DEFS, true);
    return { ostaEnterpriseId: osta.id, systemRoleIds };
  };

  try {
    return await run();
  } catch {
    // Most likely a P2002 from a concurrently-booting replica creating the same row
    // between our read and write — its rows are exactly the ones we wanted, so one
    // retry resolves it. Anything else genuinely wrong fails the retry too.
    return await run();
  }
}

// When executed directly (the entrypoint path: node dist-scripts/scripts/ensure-platform.js).
// Kept separate from the import path so tests can use ensurePlatform without side effects.
if (require.main === module) {
  // Deferred require so importing this module never constructs a client.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  ensurePlatform(prisma)
    .then(({ systemRoleIds }) => {
      console.log(`→ Osta platform enterprise ready (${Object.keys(systemRoleIds).length} system roles)`);
    })
    .catch((e: unknown) => {
      // Loud but NON-FATAL: the tenant-facing app must not crash-loop because the
      // platform-admin rows could not be written; bootstrap-admin.ts remains the
      // recovery path and the next container start retries anyway.
      console.error("✗ Could not ensure the Osta platform enterprise (continuing to boot):", e);
    })
    .finally(() => prisma.$disconnect());
}
