// Clean, self-contained seed for the "Osta" platform-admin enterprise.
//
// Run with:
//   npx tsx scripts/seed/seed-osta.ts
//
// Unlike scripts/seed/seed-veyo-beach-house.ts, this script NEVER deletes anything.
// Osta's own Role rows (SYSTEM_ROLE_DEFS) are shared/referenced by every OTHER
// enterprise's Users (a tenant User.roleId points at a Role literally owned by
// Osta's enterpriseId — see prisma/rbac-seed-data.ts) — deleting or recreating the
// Osta enterprise would cascade-delete those Role rows and break every tenant's
// login. This script is pure upsert, safe to run on a fresh database or repeatedly
// on top of an existing one (including one seeded by seed-veyo.ts, which also
// upserts the same "osta" enterprise/roles as a prerequisite for Veyo's own users).
//
// Creates:
//   - The Osta enterprise itself (type: "INTERNAL", slug "osta")
//   - Every SYSTEM_ROLE_DEFS role (Admin, Manager, Front Desk, Housekeeping,
//     Maintenance, Cashier, Reservations) — these are the shared role templates
//     every tenant enterprise's Users reference, not Osta-specific roles
//   - Both SUPPORT_ROLE_DEFS roles (Osta Support: view-only Controls; Osta Support
//     Admin: full access) — Osta's own internal roles
//   - One clean login: admin@osta.internal (role Admin — full access to the
//     /osta platform-admin console: Enterprises, Property Approvals, Licensing,
//     Support Access, DB Health)

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { SYSTEM_ROLE_DEFS, SUPPORT_ROLE_DEFS, ensureRoles } from "../../prisma/rbac-seed-data";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  const osta = await prisma.enterprise.upsert({
    where: { slug: "osta" },
    update: {},
    create: { name: "Osta", slug: "osta", type: "INTERNAL" },
  });

  const systemRoleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
  await ensureRoles(prisma, osta.id, SUPPORT_ROLE_DEFS, true);

  await prisma.user.upsert({
    where: { email: "admin@osta.internal" },
    update: {},
    create: {
      enterpriseId: osta.id,
      email: "admin@osta.internal",
      passwordHash,
      firstName: "Osta",
      lastName: "Admin",
      roleId: systemRoleIds["Admin"],
      scope: "ENTERPRISE",
    },
  });

  console.log("\nOsta enterprise seeded successfully.");
  console.log(`Login URL: /e/${osta.slug}/login (or generic /login with Enterprise Code "${osta.slug}")`);
  console.log("User (password: password123):");
  console.log("  admin@osta.internal (Admin — redirected straight to /osta after signing in)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
