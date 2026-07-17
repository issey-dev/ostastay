import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError, getOstaEnterpriseId, type AuthContext } from "@/lib/scope";

// Accepts either a real Role id, or (for compatibility with the existing role-name
// dropdown in team-manager.tsx) a role name — resolved against the enterprise's own
// roles first, then Osta's shared system roles. Never resolves a role belonging to a
// *different* enterprise, so a role id can't be used to smuggle in escalated access.
async function resolveRoleId(enterpriseId: string, roleNameOrId: string): Promise<string | null> {
  const ostaEnterpriseId = await getOstaEnterpriseId();

  const byId = await prisma.role.findUnique({ where: { id: roleNameOrId } });
  if (byId && (byId.enterpriseId === enterpriseId || (byId.isSystem && byId.enterpriseId === ostaEnterpriseId))) {
    return byId.id;
  }

  const ownRole = await prisma.role.findUnique({
    where: { enterpriseId_name: { enterpriseId, name: roleNameOrId } },
  });
  if (ownRole) return ownRole.id;

  const systemRole = await prisma.role.findFirst({
    where: { enterpriseId: ostaEnterpriseId, name: roleNameOrId, isSystem: true },
  });
  return systemRole?.id ?? null;
}

async function assertPropertyInEnterprise(propertyId: string, enterpriseId: string) {
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property || property.enterpriseId !== enterpriseId) {
    throw new ForbiddenError("Property not found");
  }
}

// A PROPERTY-scoped user (e.g. a property manager) can only ever create/edit/delete
// other PROPERTY-scoped users at their own work location — never an enterprise-wide
// user, and never a user at a different property. An ENTERPRISE-scoped user is
// unrestricted (any property in the enterprise, or enterprise-wide) — this is the
// concrete rule behind "property users can't create users for a different property."
function assertWithinActorPropertyScope(ctx: AuthContext, targetScope: "ENTERPRISE" | "PROPERTY", targetPropertyId: string | null) {
  if (ctx.scope !== "PROPERTY") return;
  if (targetScope !== "PROPERTY" || targetPropertyId !== ctx.propertyId) {
    throw new ForbiddenError("You can only manage users at your own property");
  }
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

export async function GET() {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "view");

    // A property-scoped user only sees their own property's roster — an enterprise-wide
    // staff list isn't theirs to browse.
    const users = await prisma.user.findMany({
      where:
        ctx.scope === "PROPERTY"
          ? { enterpriseId: ctx.enterpriseId, scope: "PROPERTY", propertyId: ctx.propertyId }
          : { enterpriseId: ctx.enterpriseId },
      orderBy: { firstName: "asc" },
      select: USER_SELECT,
    });

    return NextResponse.json(users);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "create");

    const body = await request.json();
    const { email, password, firstName, lastName, role, scope, propertyId } = body;
    const enterpriseId = ctx.enterpriseId; // never client-supplied

    if (!email || !password || !firstName || !lastName || !role) {
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

    // A property-scoped actor can only ever create a user at their own property —
    // whatever scope/propertyId they submitted is overridden, not just validated.
    const userScope = ctx.scope === "PROPERTY" ? "PROPERTY" : scope === "PROPERTY" ? "PROPERTY" : "ENTERPRISE";
    const targetPropertyId = ctx.scope === "PROPERTY" ? ctx.propertyId : userScope === "PROPERTY" ? propertyId : null;

    if (userScope === "PROPERTY") {
      if (!targetPropertyId) {
        return NextResponse.json({ error: "A work-location property is required for a property-scoped user" }, { status: 400 });
      }
      await assertPropertyInEnterprise(targetPropertyId, enterpriseId);
    }
    assertWithinActorPropertyScope(ctx, userScope, targetPropertyId);

    const passwordHash = await bcrypt.hash(password, 10);

    const newUser = await prisma.user.create({
      data: {
        enterpriseId,
        email,
        passwordHash,
        firstName,
        lastName,
        roleId,
        scope: userScope,
        propertyId: targetPropertyId,
      },
      select: USER_SELECT,
    });

    return NextResponse.json(newUser, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "update");

    const body = await request.json();
    const { id, email, password, firstName, lastName, role, isActive, scope, propertyId } = body;

    if (!id) {
      return NextResponse.json({ error: "User ID is required" }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing || existing.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    // A property-scoped actor can't touch a user outside their own property, even to
    // just rename them — checked against the user's *current* scope/property first.
    assertWithinActorPropertyScope(ctx, existing.scope as "ENTERPRISE" | "PROPERTY", existing.propertyId);

    const updateData: any = {};
    if (email) updateData.email = email;
    if (firstName) updateData.firstName = firstName;
    if (lastName) updateData.lastName = lastName;
    if (isActive !== undefined) updateData.isActive = isActive;

    if (role) {
      const roleId = await resolveRoleId(ctx.enterpriseId, role);
      if (!roleId) {
        return NextResponse.json({ error: "Unknown role" }, { status: 400 });
      }
      updateData.roleId = roleId;
    }

    if (scope) {
      const nextScope = ctx.scope === "PROPERTY" ? "PROPERTY" : scope === "PROPERTY" ? "PROPERTY" : "ENTERPRISE";
      const nextPropertyId = ctx.scope === "PROPERTY" ? ctx.propertyId : nextScope === "PROPERTY" ? (propertyId ?? existing.propertyId) : null;

      if (nextScope === "PROPERTY") {
        if (!nextPropertyId) {
          return NextResponse.json({ error: "A work-location property is required for a property-scoped user" }, { status: 400 });
        }
        await assertPropertyInEnterprise(nextPropertyId, ctx.enterpriseId);
      }
      assertWithinActorPropertyScope(ctx, nextScope, nextPropertyId);

      updateData.scope = nextScope;
      updateData.propertyId = nextPropertyId;
    } else if (propertyId !== undefined) {
      if (propertyId === null) {
        assertWithinActorPropertyScope(ctx, existing.scope as "ENTERPRISE" | "PROPERTY", null);
        updateData.propertyId = null;
      } else {
        await assertPropertyInEnterprise(propertyId, ctx.enterpriseId);
        assertWithinActorPropertyScope(ctx, existing.scope as "ENTERPRISE" | "PROPERTY", propertyId);
        updateData.propertyId = propertyId;
      }
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
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "delete");

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "User ID is required" }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing || existing.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    assertWithinActorPropertyScope(ctx, existing.scope as "ENTERPRISE" | "PROPERTY", existing.propertyId);

    // Since users might be tied to shifts or audit logs, a physical delete might fail due to foreign keys.
    // However, if they aren't, it will succeed.
    await prisma.user.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      const { status, body } = toErrorResponse(error);
      return NextResponse.json(body, { status });
    }
    console.error("Failed to delete user:", error);
    // If foreign key constraint fails, fallback to deactivation or just return error
    return NextResponse.json({
      error: "Could not delete user. They might be linked to existing records like cashier shifts. Try deactivating them instead."
    }, { status: 400 });
  }
}
