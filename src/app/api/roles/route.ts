import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, getOstaEnterpriseId, MODULES } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// A role's own module rows are stored sparsely; MODULES is the canonical list so the UI
// always gets a full, ordered matrix (missing rows default to all-false).
function normalizePermissions(permissions: { module: string; canView: boolean; canCreate: boolean; canUpdate: boolean; canDelete: boolean }[]) {
  const byModule = new Map(permissions.map((p) => [p.module, p]));
  return MODULES.map((module) => byModule.get(module) ?? { module, canView: false, canCreate: false, canUpdate: false, canDelete: false });
}

export async function GET() {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "USERS", "view");

    const ostaEnterpriseId = await getOstaEnterpriseId();

    const roles = await prisma.role.findMany({
      where: { OR: [{ enterpriseId: ctx.enterpriseId }, { enterpriseId: ostaEnterpriseId, isSystem: true }] },
      include: { permissions: true, _count: { select: { users: true } } },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    });

    return NextResponse.json(
      roles.map((r) => ({ ...r, permissions: normalizePermissions(r.permissions) }))
    );
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
    if (!body.name || typeof body.name !== "string") {
      return NextResponse.json({ error: "Role name is required" }, { status: 400 });
    }
    const permissions: Record<string, { canView?: boolean; canCreate?: boolean; canUpdate?: boolean; canDelete?: boolean }> =
      body.permissions ?? {};

    const role = await prisma.role.create({
      data: {
        enterpriseId: ctx.enterpriseId,
        name: body.name,
        isSystem: false,
        permissions: {
          create: MODULES.map((module) => ({
            module,
            canView: !!permissions[module]?.canView,
            canCreate: !!permissions[module]?.canCreate,
            canUpdate: !!permissions[module]?.canUpdate,
            canDelete: !!permissions[module]?.canDelete,
          })),
        },
      },
      include: { permissions: true },
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "CREATE",
      entityType: "Role",
      entityId: role.id,
      description: `Created role "${body.name}"`,
    });

    return NextResponse.json(role, { status: 201 });
  } catch (error: any) {
    if (error?.code === "P2002") {
      return NextResponse.json({ error: "A role with this name already exists" }, { status: 400 });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
