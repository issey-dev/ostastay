import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

export async function GET() {
  try {
    const ctx = await requireSession();

    const taxProfiles = await prisma.taxProfile.findMany({
      where: { enterpriseId: ctx.enterpriseId },
      include: {
        rates: {
          orderBy: { order: 'asc' }
        }
      }
    });
    return NextResponse.json(taxProfiles);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

// A profile's `rates` are its tax lines applied together — e.g. "State Tax" (BASE, a
// flat % of the subtotal) plus "Local Fee" (COMPOUND, a % of subtotal + State Tax),
// applied in ascending `order`. At least one line is required.
export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "create");

    const body = await request.json();

    if (!body.name || !Array.isArray(body.rates) || body.rates.length === 0) {
      return NextResponse.json({ error: "A name and at least one tax line are required" }, { status: 400 });
    }
    if (body.rates.some((r: any) => !r.name || r.ratePercent === undefined || r.ratePercent === null)) {
      return NextResponse.json({ error: "Every tax line needs a name and a rate" }, { status: 400 });
    }

    const now = new Date();
    const newTaxProfile = await prisma.taxProfile.create({
      data: {
        enterpriseId: ctx.enterpriseId,
        name: body.name,
        description: body.description,
        rates: {
          create: body.rates.map((r: any, index: number) => ({
            name: r.name,
            ratePercent: parseFloat(r.ratePercent),
            calculateOn: r.calculateOn === "COMPOUND" ? "COMPOUND" : "BASE",
            order: index,
            effectiveFrom: now,
          }))
        }
      },
      include: {
        rates: { orderBy: { order: 'asc' } }
      }
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "CREATE",
      entityType: "TaxProfile",
      entityId: newTaxProfile.id,
      description: `Created tax profile "${newTaxProfile.name}" with ${newTaxProfile.rates.length} tax line(s)`,
    });

    return NextResponse.json(newTaxProfile, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
