import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { POSTING_TYPES, groupTaxCodesForSubgroup, type PostingType } from "@/lib/posting/charge-tree";
import { resolveChargeCode } from "@/lib/posting/resolve-charge-code";

// Level 3 of the charge hierarchy. Classification is a ChargeSubgroup FK — the
// free-text `category` string it replaced (three mutually contradictory "authoritative"
// lists, CHARGE_CODE_PLAN.md §1.4) was dropped in phase 4 once every reader was migrated.

export const CHARGE_CODE_INCLUDE = {
  taxProfile: { include: { rates: { orderBy: { effectiveFrom: "desc" as const }, take: 1 } } },
  chargeSubgroup: { include: { chargeGroup: true } },
  generatesFrom: { include: { generatedCode: { select: { id: true, code: true, description: true } } }, orderBy: { sortOrder: "asc" as const } },
} as const;

export async function GET() {
  try {
    const ctx = await requireSession();

    const chargeCodes = await prisma.chargeCode.findMany({
      where: { enterpriseId: ctx.enterpriseId },
      include: CHARGE_CODE_INCLUDE,
      orderBy: { code: "asc" },
    });
    return NextResponse.json(chargeCodes);
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

    if (!body.code || !body.description) {
      return NextResponse.json({ error: "Code and description are required" }, { status: 400 });
    }
    if (!body.chargeSubgroupId) {
      return NextResponse.json({ error: "A charge subgroup is required" }, { status: 400 });
    }

    const subgroup = await prisma.chargeSubgroup.findUnique({
      where: { id: body.chargeSubgroupId },
      include: { chargeGroup: true },
    });
    if (!subgroup || subgroup.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Charge subgroup not found" }, { status: 404 });
    }

    const postingType: PostingType = POSTING_TYPES.includes(body.postingType) ? body.postingType : "CHARGE";

    const code = String(body.code).trim().toUpperCase();
    const clash = await prisma.chargeCode.findUnique({
      where: { enterpriseId_code: { enterpriseId: ctx.enterpriseId, code } },
    });
    if (clash) {
      return NextResponse.json({ error: `A charge code ${code} already exists` }, { status: 400 });
    }

    const useDefaultTax = body.useDefaultTax !== undefined ? !!body.useDefaultTax : true;
    let taxProfileId: string | null = null;
    if (!useDefaultTax && postingType !== "TAX") {
      // A levy posts at face value and never runs the tax engine, so it needs no profile.
      if (!body.taxProfileId) {
        return NextResponse.json({ error: "A Custom Tax profile is required when not using the default tax" }, { status: 400 });
      }
      const taxProfile = await prisma.taxProfile.findUnique({ where: { id: body.taxProfileId } });
      if (!taxProfile || taxProfile.enterpriseId !== ctx.enterpriseId) {
        return NextResponse.json({ error: "Tax profile not found" }, { status: 404 });
      }
      taxProfileId = body.taxProfileId;
    }

    const newChargeCode = await prisma.$transaction(async (tx) => {
      const created = await tx.chargeCode.create({
        data: {
          enterpriseId: ctx.enterpriseId,
          code,
          description: body.description,
          chargeSubgroupId: subgroup.id,
          postingType,
          isActive: body.isActive !== undefined ? !!body.isActive : true,
          isSystem: false,
          useDefaultTax,
          taxProfileId,
        },
      });

      // Tax is attached at GROUP level: a new revenue code inherits its group's own
      // Service Charge and GST codes automatically, so it can never be added and
      // silently post untaxed. Nothing is calculated here — the generate only routes
      // whatever the default Maldives rule resolves (see run-generates.ts).
      if (postingType === "CHARGE") {
        const taxCodes = groupTaxCodesForSubgroup(subgroup.code);
        const wanted: Array<{ code: string; method: string; sortOrder: number }> = [];
        if (taxCodes) {
          wanted.push({ code: taxCodes.serviceCharge, method: "SERVICE_CHARGE", sortOrder: 10 });
          wanted.push({ code: taxCodes.gst, method: "GST", sortOrder: 20 });
        }
        for (const w of wanted) {
          const target = await tx.chargeCode.findUnique({
            where: { enterpriseId_code: { enterpriseId: ctx.enterpriseId, code: w.code } },
          });
          if (!target || target.id === created.id) continue;
          await tx.chargeCodeGenerate.create({
            data: {
              enterpriseId: ctx.enterpriseId,
              generatorCodeId: created.id,
              generatedCodeId: target.id,
              method: w.method,
              value: 0,
              calculateOn: "NET",
              sortOrder: w.sortOrder,
            },
          });
        }

        // Green Tax is a rule about ACCOMMODATION, not about one code: a property that
        // adds a second room charge code (say, per rate plan) must keep levying it.
        if (subgroup.chargeGroup.reportBucket === "ROOM") {
          const gtx = await resolveChargeCode(ctx.enterpriseId, "GREEN_TAX", { client: tx });
          if (gtx && gtx.id !== created.id) {
            await tx.chargeCodeGenerate.create({
              data: {
                enterpriseId: ctx.enterpriseId,
                generatorCodeId: created.id,
                generatedCodeId: gtx.id,
                method: "GREEN_TAX",
                value: 0,
                calculateOn: "NET",
                sortOrder: 30,
              },
            });
          }
        }
      }

      return tx.chargeCode.findUniqueOrThrow({ where: { id: created.id }, include: CHARGE_CODE_INCLUDE });
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "CREATE",
      entityType: "ChargeCode",
      entityId: newChargeCode.id,
      description: `Created charge code ${newChargeCode.code} — ${newChargeCode.description} (${subgroup.chargeGroup.code} / ${subgroup.code})`,
    });

    return NextResponse.json(newChargeCode, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
