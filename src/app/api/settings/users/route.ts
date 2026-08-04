import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError, getOstaEnterpriseId, type AuthContext } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { revokeAllForUser } from "@/lib/session-store";

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

// Plural form. Returns null if ANY entry fails to resolve — a partial assignment would
// silently give a user less access than the admin just chose, which is worse than an error.
async function resolveRoleIds(enterpriseId: string, roles: unknown): Promise<string[] | null> {
  const list = Array.isArray(roles) ? roles : [roles];
  const cleaned = list.filter((r): r is string => typeof r === "string" && r.length > 0);
  if (cleaned.length === 0) return null;
  const ids: string[] = [];
  for (const r of cleaned) {
    const id = await resolveRoleId(enterpriseId, r);
    if (!id) return null;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

// The onboarding account is the floor that stops a tenant locking itself out of its own
// Hub: it can never be deleted, deactivated, stripped of its roles, or demoted to
// property scope. See .agents/docs/USER_MANAGEMENT_PLAN.md decision 9.
const PROTECTED_USER_MESSAGE =
  "This is the account created during onboarding. It cannot be deleted, deactivated, moved to a single property, or have its access reduced — it is what guarantees someone can always administer this enterprise.";

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
  roles: { select: { role: { select: { id: true, name: true, isSystem: true } } } },
  isProtected: true,
  scope: true,
  propertyId: true,
  isActive: true,
  // The user's post. The housekeeping and maintenance boards filter on this — they used
  // to match role.name, which conflated access with job (see src/lib/job-functions.ts).
  jobFunction: true,
  createdAt: true,
} as const;

export async function GET() {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "USERS", "view");

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
    requirePermission(ctx, "USERS", "create");

    const body = await request.json();
    const { email, password, firstName, lastName, role, scope, propertyId, jobFunction } = body;
    const enterpriseId = ctx.enterpriseId; // never client-supplied

    if (!email || !password || !firstName || !lastName || !role) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json({ error: "Email already exists" }, { status: 400 });
    }

    const roleIds = await resolveRoleIds(enterpriseId, body.roles ?? role);
    if (!roleIds) {
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
        roles: { create: roleIds.map((roleId) => ({ roleId })) },
        scope: userScope,
        propertyId: targetPropertyId,
        // Free-form against the tenant's JOB_FUNCTION list — not validated against it on
        // purpose: the list is editable, and refusing a code a tenant just renamed would
        // be worse than storing one that no longer resolves to a label.
        jobFunction: jobFunction || null,
      },
      select: USER_SELECT,
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "CREATE",
      entityType: "User",
      entityId: newUser.id,
      description: `Created user ${firstName} ${lastName} (${email}) with role(s) ${newUser.roles.map((ur) => ur.role.name).join(", ")}`,
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
    requirePermission(ctx, "USERS", "update");

    const body = await request.json();
    const { id, email, password, firstName, lastName, role, isActive, scope, propertyId, jobFunction } = body;

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

    // The onboarding account may be renamed and have its password reset — everything that
    // could strand the enterprise is refused.
    if (existing.isProtected) {
      const wouldDeactivate = isActive === false;
      const wouldDemote = scope === "PROPERTY";
      const wouldChangeRoles = body.roles !== undefined || role !== undefined;
      if (wouldDeactivate || wouldDemote || wouldChangeRoles) {
        return NextResponse.json({ error: PROTECTED_USER_MESSAGE, protectedUser: true }, { status: 400 });
      }
    }

    const updateData: any = {};
    if (email) updateData.email = email;
    if (firstName) updateData.firstName = firstName;
    if (lastName) updateData.lastName = lastName;
    if (isActive !== undefined) updateData.isActive = isActive;
    // `undefined` leaves it alone; an empty string clears the post.
    if (jobFunction !== undefined) updateData.jobFunction = jobFunction || null;

    // Roles are REPLACED wholesale, not merged: the UI sends the full set the admin
    // chose, so a removed role must actually go.
    let nextRoleIds: string[] | null = null;
    if (body.roles !== undefined || role !== undefined) {
      nextRoleIds = await resolveRoleIds(ctx.enterpriseId, body.roles ?? role);
      if (!nextRoleIds) {
        return NextResponse.json({ error: "Unknown role" }, { status: 400 });
      }
      updateData.roles = {
        deleteMany: {},
        create: nextRoleIds.map((roleId) => ({ roleId })),
      };
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

    // Deactivating ends the account's live sessions immediately. requireSession would
    // refuse them anyway on the next request, but leaving the rows "live" would make the
    // Sessions list lie about who is signed in.
    if (updateData.isActive === false) {
      await revokeAllForUser(id, "ADMIN", ctx.userId);
    }

    const sensitive: string[] = [];
    if (nextRoleIds) sensitive.push(`roles → ${updatedUser.roles.map((ur) => ur.role.name).join(", ")}`);
    if (updateData.passwordHash) sensitive.push("password changed");
    if (updateData.isActive === false) sensitive.push("deactivated");
    if (updateData.isActive === true && !existing.isActive) sensitive.push("reactivated");
    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "UPDATE",
      entityType: "User",
      entityId: id,
      description: `Updated user ${updatedUser.email}${sensitive.length ? ` — ${sensitive.join(", ")}` : ""}`,
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
    requirePermission(ctx, "USERS", "delete");

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

    if (existing.isProtected) {
      return NextResponse.json({ error: PROTECTED_USER_MESSAGE, protectedUser: true }, { status: 400 });
    }

    // Since users might be tied to shifts or audit logs, a physical delete might fail due to foreign keys.
    // However, if they aren't, it will succeed.
    await prisma.user.delete({
      where: { id },
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "DELETE",
      entityType: "User",
      entityId: id,
      description: `Deleted user ${existing.email}`,
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
