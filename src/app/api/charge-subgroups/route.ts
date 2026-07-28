import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// Level 2 of the charge hierarchy. A subgroup is purely a reporting sub-classification
// inside its group — it carries no bucket of its own, so a property can add as many as
// it likes without any risk to how revenue rolls up.

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "create");

    const body = await request.json();
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase().replace(/\s+/g, "_") : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";

    if (!code || !name || !body.chargeGroupId) {
      return NextResponse.json({ error: "Group, code and name are required" }, { status: 400 });
    }

    const group = await prisma.chargeGroup.findUnique({ where: { id: body.chargeGroupId } });
    if (!group || group.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Charge group not found" }, { status: 404 });
    }

    const clash = await prisma.chargeSubgroup.findUnique({
      where: { enterpriseId_code: { enterpriseId: ctx.enterpriseId, code } },
    });
    if (clash) {
      return NextResponse.json({ error: `A subgroup with the code ${code} already exists` }, { status: 400 });
    }

    const subgroup = await prisma.chargeSubgroup.create({
      data: {
        enterpriseId: ctx.enterpriseId,
        chargeGroupId: group.id,
        code,
        name,
        isSystem: false,
        sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 100,
      },
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "CREATE",
      entityType: "ChargeSubgroup",
      entityId: subgroup.id,
      description: `Created charge subgroup ${subgroup.code} — ${subgroup.name} under ${group.code}`,
    });

    return NextResponse.json(subgroup, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
