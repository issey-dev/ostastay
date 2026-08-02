// First-run bootstrap for a PRODUCTION deployment.
//
// A freshly migrated database is empty, and empty is not merely inconvenient — it is
// broken: getOstaEnterpriseId() (src/lib/scope.ts) throws "No INTERNAL (Osta) enterprise
// found" on every authenticated request, and there is no user to sign in as. The two
// existing seeding paths cannot fill that gap in production:
//
//   - POST /api/auth/seed hard-404s when NODE_ENV=production, deliberately: it mints
//     well-known "password123" accounts.
//   - `npm run seed` runs through vite-node (a devDependency, absent from the runtime
//     image) and loads the Veyo demo tenant — fake reservations, folios, and guests.
//
// So this script creates the minimum a real deployment needs and nothing else: the Osta
// INTERNAL enterprise, its system/support roles, and ONE operator account whose password
// comes from the environment rather than from source. Customer enterprises, properties,
// and their users are then created through the app itself (POST /api/enterprises,
// /api/properties), which is where those flows already live.
//
// Idempotent: safe to re-run. Re-running with a different ADMIN_PASSWORD resets that
// account's password, which is also the intended password-recovery path for an operator
// locked out of a live deployment.
//
// Usage (see DEPLOY.md — the password is passed per-invocation so it never has to live
// in .env or in the image):
//   docker compose exec -e ADMIN_EMAIL=you@example.com -e ADMIN_PASSWORD='...' \
//     app node dist-scripts/scripts/bootstrap-admin.js

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { SYSTEM_ROLE_DEFS, SUPPORT_ROLE_DEFS, ensureRoles } from "../prisma/rbac-seed-data";

const prisma = new PrismaClient();

// Matches the cost factor every other password in this codebase is hashed with
// (scripts/seed/*, src/app/api/auth/seed/route.ts) — a lower value here would silently
// make the operator account the weakest credential in the system.
const BCRYPT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 12;

function fail(message: string): never {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  const firstName = (process.env.ADMIN_FIRST_NAME ?? "Osta").trim();
  const lastName = (process.env.ADMIN_LAST_NAME ?? "Admin").trim();

  if (!email || !email.includes("@")) {
    fail("ADMIN_EMAIL must be set to a valid email address.");
  }
  // Length only — this account is the root of the whole deployment, and a rejected weak
  // password is a far cheaper failure than a compromised one. Deliberately not a
  // composition rule (no "must contain a symbol"): length is what actually helps.
  if (password.length < MIN_PASSWORD_LENGTH) {
    fail(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters (got ${password.length}).`);
  }

  // Exactly one INTERNAL enterprise may exist; slug "osta" is what the rest of the app
  // and every seed script already assume.
  const osta = await prisma.enterprise.upsert({
    where: { slug: "osta" },
    update: {},
    create: { name: "Osta", slug: "osta", type: "INTERNAL" },
  });

  // System roles are shared across enterprises and cannot be edited through Controls, so
  // they must exist before any user can be attached to one. ensureRoles is itself an
  // upsert per role — re-running adds only what is missing.
  const systemRoleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
  await ensureRoles(prisma, osta.id, SUPPORT_ROLE_DEFS, true);

  const adminRoleId = systemRoleIds["Admin"];
  if (!adminRoleId) {
    fail('No "Admin" role was produced by the system role definitions — prisma/rbac-seed-data.ts may have changed.');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const existing = await prisma.user.findUnique({ where: { email } });

  const user = await prisma.user.upsert({
    where: { email },
    // Re-running resets the password and re-enables the account; it deliberately does
    // NOT touch enterpriseId or roleId, so this can never quietly move an existing
    // customer user into the Osta enterprise.
    update: { passwordHash, isActive: true },
    create: {
      enterpriseId: osta.id,
      email,
      passwordHash,
      firstName,
      lastName,
      roleId: adminRoleId,
      scope: "ENTERPRISE",
    },
  });

  console.log(`
  ✓ Osta enterprise ready        (slug: osta)
  ✓ System + support roles ready (${Object.keys(SYSTEM_ROLE_DEFS).length + Object.keys(SUPPORT_ROLE_DEFS).length} roles)
  ✓ ${existing ? "Password reset for existing user" : "Admin user created"}: ${user.email}

  Sign in with enterprise code "osta" and that email.
  Next: create your hotel's enterprise and property from the Osta admin area.
`);
}

main()
  .catch((error) => {
    console.error("\n  ✗ Bootstrap failed:\n", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
