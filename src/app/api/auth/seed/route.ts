import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";

export async function POST() {
  try {
    // 1. Ensure a Tenant exists
    let tenant = await prisma.tenant.findFirst();
    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: { name: "Default Tenant" }
      });
    }

    // 2. Hash default password
    const passwordHash = await bcrypt.hash("password123", 10);

    // 3. Create Admin
    const admin = await prisma.user.upsert({
      where: { email: "admin@hotel.com" },
      update: {},
      create: {
        tenantId: tenant.id,
        email: "admin@hotel.com",
        passwordHash,
        firstName: "System",
        lastName: "Admin",
        role: "ADMIN"
      }
    });

    // 4. Create Housekeeper
    const housekeeper = await prisma.user.upsert({
      where: { email: "housekeeping@hotel.com" },
      update: {},
      create: {
        tenantId: tenant.id,
        email: "housekeeping@hotel.com",
        passwordHash,
        firstName: "Maria",
        lastName: "Maid",
        role: "HOUSEKEEPING"
      }
    });

    // 5. Create Front Desk
    const frontDesk = await prisma.user.upsert({
      where: { email: "frontdesk@hotel.com" },
      update: {},
      create: {
        tenantId: tenant.id,
        email: "frontdesk@hotel.com",
        passwordHash,
        firstName: "Tom",
        lastName: "Desk",
        role: "FRONT_DESK"
      }
    });

    return NextResponse.json({
      success: true,
      message: "Seed users created. Password is 'password123'",
      users: [admin.email, housekeeper.email, frontDesk.email]
    });
  } catch (error) {
    console.error("Seed error:", error);
    return NextResponse.json({ error: "Failed to seed users" }, { status: 500 });
  }
}
