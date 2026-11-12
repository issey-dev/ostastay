import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, getOstaEnterpriseId } from "@/lib/scope";
import { isCapabilityKey } from "@/lib/capabilities";
import { effectiveRoleCapabilities } from "@/lib/role-capabilities";

// "Who has this?" (Agent Portal plan §10, roles screen): the roles and active people of
// this enterprise that effectively hold one capability, after defaults and overrides.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "USERS", "view");
    const key = new URL(request.url).searchParams.get("capability");
    if (!isCapabilityKey(key)) {
      return NextResponse.json({ error: "Unknown capability" }, { status: 400 });
    }
    const ostaEnterpriseId = await getOstaEnterpriseId();
    const roles = await prisma.role.findMany({
      where: { OR: [{ enterpriseId: ctx.enterpriseId }, { enterpriseId: ostaEnterpriseId, isSystem: true }] },
      include: {
        permissions: true,
        capabilities: { select: { capability: true, granted: true } },
        users: {
          where: { user: { enterpriseId: ctx.enterpriseId, isSystem: false, isActive: true } },
          select: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
        },
      },
      orderBy: { name: "asc" },
    });
    const holding = roles.filter((r) => effectiveRoleCapabilities(r.permissions, r.capabilities).has(key));
    const people = new Map<string, { id: string; name: string; email: string; roles: string[] }>();
    for (const r of holding) {
      for (const { user } of r.users) {
        const p = people.get(user.id) ?? { id: user.id, name: `${user.firstName} ${user.lastName}`.trim(), email: user.email, roles: [] };
        p.roles.push(r.name);
        people.set(user.id, p);
      }
    }
    return NextResponse.json({
      capability: key,
      roles: holding.map((r) => ({ id: r.id, name: r.name, isSystem: r.isSystem })),
      people: [...people.values()].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)),
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
