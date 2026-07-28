import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { GENERATE_METHODS, CALCULATE_ON, hasGenerateCycle, isTaxRoutingMethod } from "@/lib/posting/run-generates";
import { canGenerateTax, POSTING_TYPE_LABELS, type PostingType } from "@/lib/posting/charge-tree";

// Generates for one charge code (Controls > Cashiering > Charge Codes > Generates).
// Posting the parent code auto-posts each of these — the config that replaced the
// hardcoded "ROOM also posts GTX" branch in Night Audit.

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

const GENERATE_INCLUDE = {
  generatedCode: { select: { id: true, code: true, description: true, postingType: true, isActive: true } },
} as const;

async function loadOwnCode(enterpriseId: string, id: string) {
  const code = await prisma.chargeCode.findUnique({ where: { id } });
  return code && code.enterpriseId === enterpriseId ? code : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "view");

    const { id } = await params;
    if (!(await loadOwnCode(ctx.enterpriseId, id))) {
      return NextResponse.json({ error: "Charge code not found" }, { status: 404 });
    }

    const rows = await prisma.chargeCodeGenerate.findMany({
      where: { generatorCodeId: id },
      include: GENERATE_INCLUDE,
      orderBy: { sortOrder: "asc" },
    });
    return NextResponse.json(rows);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "create");

    const { id } = await params;
    const generator = await loadOwnCode(ctx.enterpriseId, id);
    if (!generator) return NextResponse.json({ error: "Charge code not found" }, { status: 404 });

    const body = await request.json();
    const method = typeof body.method === "string" ? body.method : "";
    const calculateOn = typeof body.calculateOn === "string" ? body.calculateOn : "NET";

    if (!body.generatedCodeId) {
      return NextResponse.json({ error: "A generated charge code is required" }, { status: 400 });
    }
    if (!GENERATE_METHODS.includes(method as (typeof GENERATE_METHODS)[number])) {
      return NextResponse.json({ error: "Invalid method" }, { status: 400 });
    }
    if (!CALCULATE_ON.includes(calculateOn as (typeof CALCULATE_ON)[number])) {
      return NextResponse.json({ error: "Invalid basis" }, { status: 400 });
    }

    const generated = await loadOwnCode(ctx.enterpriseId, body.generatedCodeId);
    if (!generated) return NextResponse.json({ error: "Generated charge code not found" }, { status: 404 });
    if (generated.id === generator.id) {
      return NextResponse.json({ error: "A charge code can't generate itself." }, { status: 400 });
    }
    const refusal = taxGenerateRefusal(generator, generated, method);
    if (refusal) return NextResponse.json({ error: refusal }, { status: 400 });

    const existing = await prisma.chargeCodeGenerate.findUnique({
      where: { generatorCodeId_generatedCodeId: { generatorCodeId: generator.id, generatedCodeId: generated.id } },
    });
    if (existing) {
      return NextResponse.json({ error: `${generator.code} already generates ${generated.code}.` }, { status: 400 });
    }

    // Cycle guard over the enterprise's whole generate graph WITH the proposed edge —
    // a cascade that loops would otherwise be a night-audit hang waiting to happen.
    const edges = await prisma.chargeCodeGenerate.findMany({
      where: { enterpriseId: ctx.enterpriseId },
      select: { generatorCodeId: true, generatedCodeId: true },
    });
    if (hasGenerateCycle([...edges, { generatorCodeId: generator.id, generatedCodeId: generated.id }])) {
      return NextResponse.json(
        { error: "That would create a loop — the generated code already generates this one, directly or indirectly." },
        { status: 400 }
      );
    }

    // A basis row must belong to the same generator, or the cascade references a bucket
    // that will never be in scope at posting time.
    let basisGenerateId: string | null = null;
    if (calculateOn === "ANOTHER_GENERATE") {
      if (!body.basisGenerateId) {
        return NextResponse.json({ error: "Pick which generate this one calculates on" }, { status: 400 });
      }
      const basis = await prisma.chargeCodeGenerate.findUnique({ where: { id: body.basisGenerateId } });
      if (!basis || basis.generatorCodeId !== generator.id) {
        return NextResponse.json({ error: "The basis generate must belong to this same charge code" }, { status: 400 });
      }
      basisGenerateId = basis.id;
    }

    const row = await prisma.chargeCodeGenerate.create({
      data: {
        enterpriseId: ctx.enterpriseId,
        generatorCodeId: generator.id,
        generatedCodeId: generated.id,
        method,
        // GREEN_TAX draws its rates from the enterprise's Maldives Tax config, so it
        // carries no value of its own — see src/lib/posting/run-generates.ts.
        value: method === "GREEN_TAX" ? 0 : Number(body.value) || 0,
        calculateOn,
        basisGenerateId,
        sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 10,
        isActive: body.isActive !== undefined ? !!body.isActive : true,
      },
      include: GENERATE_INCLUDE,
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "CREATE",
      entityType: "ChargeCodeGenerate",
      entityId: row.id,
      description: `${generator.code} now generates ${generated.code} (${method})`,
    });

    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
