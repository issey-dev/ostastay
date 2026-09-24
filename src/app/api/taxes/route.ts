import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertPropertyAccess, requirePropertySetup, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// Per property since 2026-09-23 (.agents/docs/HUB_SETUP_PLAN.md, Phase 2): each property keeps its own Custom Tax profiles.
// GET takes ?propertyId= and is readable by anyone working at that property; POST takes a
// body propertyId and is Property Setup for it.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const propertyId = new URL(request.url).searchParams.get("propertyId");
    if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    await assertPropertyAccess(ctx, propertyId);

    const taxProfiles = await prisma.taxProfile.findMany({
      where: { propertyId },
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
    const body = await request.json();
    const propertyId: string | undefined = body.propertyId;
    if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    await requirePropertySetup(ctx, propertyId, "CONTROLS", "create");

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
        propertyId,
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
