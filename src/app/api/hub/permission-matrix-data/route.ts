import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requireHubAccess, requirePermission, getOstaEnterpriseId, toErrorResponse } from "@/lib/scope";
import { MODULES, MODULE_LABELS, moduleScope, type Module } from "@/lib/modules";
import { resolveStationeryBrand } from "@/lib/stationery-brand";

// Data for the printable Permission Matrix — what each role grants, and who holds it.
//
// The "who holds it" half is the point. A matrix of roles against modules answers "what
// COULD this role do"; a hotel auditing its access needs "who actually has it", and since
// 2026-08-04 a person may hold several roles, so the answer isn't a lookup on one column.

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "USERS", "view");

    const ostaEnterpriseId = await getOstaEnterpriseId();

    // The enterprise's own roles plus Osta's shared system roles — the same union the
    // roles API and the assignment UI use, so the report can't disagree with the picker.
    const roles = await prisma.role.findMany({
      where: {
        OR: [{ enterpriseId: ctx.enterpriseId }, { enterpriseId: ostaEnterpriseId, isSystem: true }],
      },
      include: {
        permissions: true,
        users: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true, email: true, isActive: true, jobFunction: true },
            },
          },
        },
      },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    });

    // Only roles actually reachable in this enterprise carry meaning on the report, but a
    // system role with nobody in it is still worth showing — it explains what an admin
    // would be granting if they assigned it.
    const permissionByRole = roles.map((role) => {
      const byModule = new Map(role.permissions.map((p) => [p.module, p]));
      return {
        id: role.id,
        name: role.name,
        isSystem: role.isSystem,
        // Only users of THIS enterprise: a shared Osta system role is held across tenants,
        // and one tenant's report must never name another's staff.
        holders: role.users
          .map((ur) => ur.user)
          .filter((u) => u.isActive)
          .map((u) => ({
            id: u.id,
            name: `${u.firstName} ${u.lastName}`.trim(),
            email: u.email,
            jobFunction: u.jobFunction,
          })),
        grants: MODULES.map((m) => {
          const p = byModule.get(m);
          return {
            module: m,
            view: !!p?.canView,
            create: !!p?.canCreate,
            update: !!p?.canUpdate,
            delete: !!p?.canDelete,
          };
        }),
      };
    });

    // Holders are filtered to this enterprise separately, because the include above walks
    // the join table without knowing the tenant.
    const ownUserIds = new Set(
      (
        await prisma.user.findMany({
          where: { enterpriseId: ctx.enterpriseId },
          select: { id: true },
        })
      ).map((u) => u.id)
    );
    for (const r of permissionByRole) {
      r.holders = r.holders.filter((h) => ownUserIds.has(h.id));
    }

    const propertyId = ctx.sessionPropertyId;
    const property = propertyId
      ? await prisma.property.findUnique({ where: { id: propertyId } })
      : await prisma.property.findFirst({ where: { enterpriseId: ctx.enterpriseId }, orderBy: { createdAt: "asc" } });

    const enterprise = await prisma.enterprise.findUnique({
      where: { id: ctx.enterpriseId },
      select: { name: true },
    });

    return NextResponse.json({
      brand: property ? resolveStationeryBrand(property, null) : null,
      enterpriseName: enterprise?.name ?? "",
      modules: MODULES.map((m: Module) => ({
        code: m,
        label: MODULE_LABELS[m],
        scope: moduleScope(m),
      })),
      roles: permissionByRole,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
