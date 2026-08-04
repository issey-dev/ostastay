import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import { SYSTEM_ROLE_DEFS, SUPPORT_ROLE_DEFS, ensureRoles } from "../../../../../prisma/rbac-seed-data";

export async function POST() {
  // Creates accounts with a well-known password ("password123") and zero auth of its
  // own — must never be reachable once real customer data exists.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    // 1. Ensure the Osta INTERNAL enterprise exists — exactly one row, type INTERNAL.
    const osta = await prisma.enterprise.upsert({
      where: { slug: "osta" },
      update: {},
      create: { name: "Osta", slug: "osta", type: "INTERNAL" },
    });

    // 2. Seed Osta-owned system roles (shared by every enterprise) + Osta's own support
    // roles, all isSystem = true so they can never collide with an enterprise's own
    // custom role names (see Role.@@unique([enterpriseId, name])).
    const systemRoleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const supportRoleIds = await ensureRoles(prisma, osta.id, SUPPORT_ROLE_DEFS, true);

    const passwordHash = await bcrypt.hash("password123", 10);

    // 3. One Osta support user, so the support-access request/approve flow has someone
    // to log in as.
    await prisma.user.upsert({
      where: { email: "support@osta.internal" },
      update: {},
      create: {
        enterpriseId: osta.id,
        email: "support@osta.internal",
        passwordHash,
        firstName: "Osta",
        lastName: "Support",
        roles: { create: { roleId: supportRoleIds["Osta Support Admin"] } },
        scope: "ENTERPRISE",
      },
    });

    // 4. Ensure a demo (STANDARD) Enterprise + license exists for everyday dev/testing.
    const demo = await prisma.enterprise.upsert({
      where: { slug: "demo" },
      update: {},
      create: { name: "Demo Guest House Co.", slug: "demo", type: "STANDARD" },
    });
    await prisma.enterpriseLicense.upsert({
      where: { enterpriseId: demo.id },
      update: {},
      create: { enterpriseId: demo.id, tier: "STANDARD", maxProperties: 3 },
    });

    // 5. Create Admin / Housekeeping / Front Desk users under the demo enterprise,
    // referencing Osta's shared system roles.
    const admin = await prisma.user.upsert({
      where: { email: "admin@hotel.com" },
      update: {},
      create: {
        enterpriseId: demo.id,
        email: "admin@hotel.com",
        passwordHash,
        firstName: "System",
        lastName: "Admin",
        roles: { create: { roleId: systemRoleIds["Admin"] } },
        scope: "ENTERPRISE",
      },
    });

    const housekeeper = await prisma.user.upsert({
      where: { email: "housekeeping@hotel.com" },
      update: {},
      create: {
        enterpriseId: demo.id,
        email: "housekeeping@hotel.com",
        passwordHash,
        firstName: "Maria",
        lastName: "Maid",
        roles: { create: { roleId: systemRoleIds["Housekeeping"] } },
        scope: "ENTERPRISE",
      },
    });

    const frontDesk = await prisma.user.upsert({
      where: { email: "frontdesk@hotel.com" },
      update: {},
      create: {
        enterpriseId: demo.id,
        email: "frontdesk@hotel.com",
        passwordHash,
        firstName: "Tom",
        lastName: "Desk",
        roles: { create: { roleId: systemRoleIds["Front Desk"] } },
        scope: "ENTERPRISE",
      },
    });

    return NextResponse.json({
      success: true,
      message: "Seed users created. Password is 'password123'",
      users: [admin.email, housekeeper.email, frontDesk.email, "support@osta.internal"],
    });
  } catch (error) {
    console.error("Seed error:", error);
    return NextResponse.json({ error: "Failed to seed users" }, { status: 500 });
  }
}
