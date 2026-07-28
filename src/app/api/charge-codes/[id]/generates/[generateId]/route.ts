import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { GENERATE_METHODS, CALCULATE_ON, isTaxRoutingMethod } from "@/lib/posting/run-generates";
import { canGenerateTax, POSTING_TYPE_LABELS, type PostingType } from "@/lib/posting/charge-tree";

const GENERATE_INCLUDE = {
  generatedCode: { select: { id: true, code: true, description: true, postingType: true, isActive: true } },
} as const;

// Tax never generates on anything that isn't a sale — see canGenerateTax() in
// charge-tree.ts. Rejected here so the configuration can't exist, and again inside
// postCharge so a row that somehow does exist still can't produce tax.
function taxGenerateRefusal(
  generator: { code: string; postingType: string },
  generated: { code: string; postingType: string },
  method: string
): string | null {
  const producesTax = isTaxRoutingMethod(method) || method === "GREEN_TAX" || generated.postingType === "TAX";
  if (!producesTax) return null;
  if (canGenerateTax(generator.postingType)) return null;
  return `${generator.code} is a ${POSTING_TYPE_LABELS[generator.postingType as PostingType] ?? generator.postingType} code, not a sale. Tax can't be generated on payments, refunds, deposits, commissions or adjustments — that money has already been taxed.`;
}

async function loadOwnRow(enterpriseId: string, codeId: string, generateId: string) {
  const row = await prisma.chargeCodeGenerate.findUnique({
    where: { id: generateId },
    include: {
      generatorCode: { select: { id: true, code: true, postingType: true, enterpriseId: true } },
      generatedCode: { select: { id: true, code: true, postingType: true } },
    },
  });
  if (!row || row.enterpriseId !== enterpriseId || row.generatorCodeId !== codeId) return null;
  return row;
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string; generateId: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "update");

    const { id, generateId } = await params;
    const row = await loadOwnRow(ctx.enterpriseId, id, generateId);
    if (!row) return NextResponse.json({ error: "Generate rule not found" }, { status: 404 });

    const body = await request.json();
    const method = typeof body.method === "string" ? body.method : row.method;
    const calculateOn = typeof body.calculateOn === "string" ? body.calculateOn : row.calculateOn;

    if (!GENERATE_METHODS.includes(method as (typeof GENERATE_METHODS)[number])) {
      return NextResponse.json({ error: "Invalid method" }, { status: 400 });
    }
    if (!CALCULATE_ON.includes(calculateOn as (typeof CALCULATE_ON)[number])) {
      return NextResponse.json({ error: "Invalid basis" }, { status: 400 });
    }
    const refusal = taxGenerateRefusal(row.generatorCode, row.generatedCode, method);
    if (refusal) return NextResponse.json({ error: refusal }, { status: 400 });

    // The generated code is not editable here — changing it is a different rule, so the
    // UI deletes and re-adds. That keeps the cycle check on the create path only.
    let basisGenerateId: string | null = null;
    if (calculateOn === "ANOTHER_GENERATE") {
      const candidateId = body.basisGenerateId ?? row.basisGenerateId;
      if (!candidateId) {
        return NextResponse.json({ error: "Pick which generate this one calculates on" }, { status: 400 });
      }
      if (candidateId === row.id) {
        return NextResponse.json({ error: "A generate can't calculate on itself." }, { status: 400 });
      }
      const basis = await prisma.chargeCodeGenerate.findUnique({ where: { id: candidateId } });
      if (!basis || basis.generatorCodeId !== row.generatorCodeId) {
        return NextResponse.json({ error: "The basis generate must belong to this same charge code" }, { status: 400 });
      }
      basisGenerateId = basis.id;
    }

    const updated = await prisma.chargeCodeGenerate.update({
      where: { id: generateId },
      data: {
        method,
        value: method === "GREEN_TAX" ? 0 : (body.value !== undefined ? Number(body.value) || 0 : row.value),
        calculateOn,
        basisGenerateId,
        sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : row.sortOrder,
        isActive: body.isActive !== undefined ? !!body.isActive : row.isActive,
      },
      include: GENERATE_INCLUDE,
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "UPDATE",
      entityType: "ChargeCodeGenerate",
      entityId: updated.id,
      description: `Updated generate ${row.generatorCode.code} → ${updated.generatedCode.code} (${method})`,
    });

    return NextResponse.json(updated);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; generateId: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "delete");

    const { id, generateId } = await params;
    const row = await loadOwnRow(ctx.enterpriseId, id, generateId);
    if (!row) return NextResponse.json({ error: "Generate rule not found" }, { status: 404 });

    // Anything compounding on this row would silently fall back to a zero basis, so the
    // dependants are cleared with it rather than left pointing at nothing.
    await prisma.$transaction(async (tx) => {
      await tx.chargeCodeGenerate.updateMany({
        where: { basisGenerateId: generateId },
        data: { basisGenerateId: null, calculateOn: "NET" },
      });
      await tx.chargeCodeGenerate.delete({ where: { id: generateId } });
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "DELETE",
      entityType: "ChargeCodeGenerate",
      entityId: generateId,
      description: `Removed generate from ${row.generatorCode.code}`,
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
