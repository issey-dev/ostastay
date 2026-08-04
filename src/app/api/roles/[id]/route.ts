import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError, MODULES } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    requirePermission(ctx, "USERS", "update");

    const role = await prisma.role.findUnique({ where: { id } });
    if (!role) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }
    if (role.isSystem) {
      throw new ForbiddenError("System roles cannot be edited");
    }
    if (role.enterpriseId !== ctx.enterpriseId) {
      throw new ForbiddenError("Not authorized for this role");
    }

    const body = await request.json();
    const permissions: Record<string, { canView?: boolean; canCreate?: boolean; canUpdate?: boolean; canDelete?: boolean }> =
      body.permissions ?? {};

    const updated = await prisma.$transaction(async (tx) => {
      if (body.name) {
        await tx.role.update({ where: { id }, data: { name: body.name } });
      }
      if (body.permissions) {
        for (const moduleName of MODULES) {
          const p = permissions[moduleName];
          await tx.rolePermission.upsert({
            where: { roleId_module: { roleId: id, module: moduleName } },
            update: {
              canView: !!p?.canView,
              canCreate: !!p?.canCreate,
              canUpdate: !!p?.canUpdate,
              canDelete: !!p?.canDelete,
            },
            create: {
              roleId: id,
              module: moduleName,
              canView: !!p?.canView,
              canCreate: !!p?.canCreate,
              canUpdate: !!p?.canUpdate,
              canDelete: !!p?.canDelete,
            },
          });
        }
      }
      return tx.role.findUnique({ where: { id }, include: { permissions: true } });
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "UPDATE",
      entityType: "Role",
      entityId: id,
      description: `Updated role "${updated?.name ?? role.name}"${body.permissions ? " — permission matrix changed" : ""}`,
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    if (error?.code === "P2002") {
      return NextResponse.json({ error: "A role with this name already exists" }, { status: 400 });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    requirePermission(ctx, "USERS", "delete");

    const role = await prisma.role.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
    if (!role) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }
    if (role.isSystem) {
      throw new ForbiddenError("System roles cannot be deleted");
    }
    if (role.enterpriseId !== ctx.enterpriseId) {
      throw new ForbiddenError("Not authorized for this role");
    }
    if (role._count.users > 0) {
      return NextResponse.json(
        { error: "This role is still assigned to one or more users. Reassign them first." },
        { status: 400 }
      );
    }

    await prisma.role.delete({ where: { id } });
    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "DELETE",
      entityType: "Role",
      entityId: id,
      description: `Deleted role "${role.name}"`,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
