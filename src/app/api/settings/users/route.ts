import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import { getOstaEnterpriseId } from "@/lib/scope";

// TODO(Phase 1): this route still has no session/permission check at all — any caller
// can list/create/update/delete users for any enterpriseId they supply. Retrofitting
// this (requireSession + requirePermission(CONTROLS, action) + forcing enterpriseId from
// the session, never the client) is the highest-severity item in the approved plan.

// Accepts either a real Role id, or (for compatibility with the existing role-name
// dropdown in team-manager.tsx) a role name — resolved against the enterprise's own
// roles first, then Osta's shared system roles.
async function resolveRoleId(enterpriseId: string, roleNameOrId: string): Promise<string | null> {
  const byId = await prisma.role.findUnique({ where: { id: roleNameOrId } });
  if (byId) return byId.id;

  const ownRole = await prisma.role.findUnique({
    where: { enterpriseId_name: { enterpriseId, name: roleNameOrId } },
  });
  if (ownRole) return ownRole.id;

  const ostaEnterpriseId = await getOstaEnterpriseId();
  const systemRole = await prisma.role.findFirst({
    where: { enterpriseId: ostaEnterpriseId, name: roleNameOrId, isSystem: true },
  });
  return systemRole?.id ?? null;
}

const USER_SELECT = {
  id: true,
  enterpriseId: true,
  email: true,
  firstName: true,
  lastName: true,
  role: { select: { id: true, name: true } },
  scope: true,
  propertyId: true,
  isActive: true,
  createdAt: true,
} as const;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const enterpriseId = searchParams.get("enterpriseId");

    if (!enterpriseId) {
      return NextResponse.json({ error: "enterpriseId is required" }, { status: 400 });
    }

    const users = await prisma.user.findMany({
      where: { enterpriseId },
      orderBy: { firstName: "asc" },
      select: USER_SELECT,
    });

    return NextResponse.json(users);
  } catch (error) {
    console.error("Failed to fetch users:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { enterpriseId, email, password, firstName, lastName, role } = body;

    if (!enterpriseId || !email || !password || !firstName || !lastName || !role) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json({ error: "Email already exists" }, { status: 400 });
    }

    const roleId = await resolveRoleId(enterpriseId, role);
    if (!roleId) {
      return NextResponse.json({ error: "Unknown role" }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const newUser = await prisma.user.create({
      data: {
        enterpriseId,
        email,
        passwordHash,
        firstName,
        lastName,
        roleId,
      },
      select: USER_SELECT,
    });

    return NextResponse.json(newUser, { status: 201 });
  } catch (error) {
    console.error("Failed to create user:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, email, password, firstName, lastName, role, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: "User ID is required" }, { status: 400 });
    }

    const updateData: any = {};
    if (email) updateData.email = email;
    if (firstName) updateData.firstName = firstName;
    if (lastName) updateData.lastName = lastName;
    if (isActive !== undefined) updateData.isActive = isActive;

    if (role) {
      const existing = await prisma.user.findUnique({ where: { id }, select: { enterpriseId: true } });
      if (!existing) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      const roleId = await resolveRoleId(existing.enterpriseId, role);
      if (!roleId) {
        return NextResponse.json({ error: "Unknown role" }, { status: 400 });
      }
      updateData.roleId = roleId;
    }

    if (password) {
      updateData.passwordHash = await bcrypt.hash(password, 10);
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: updateData,
      select: USER_SELECT,
    });

    return NextResponse.json(updatedUser);
  } catch (error) {
    console.error("Failed to update user:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "User ID is required" }, { status: 400 });
    }

    // Since users might be tied to shifts or audit logs, a physical delete might fail due to foreign keys.
    // However, if they aren't, it will succeed.
    await prisma.user.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete user:", error);
    // If foreign key constraint fails, fallback to deactivation or just return error
    return NextResponse.json({
      error: "Could not delete user. They might be linked to existing records like cashier shifts. Try deactivating them instead."
    }, { status: 400 });
  }
}
