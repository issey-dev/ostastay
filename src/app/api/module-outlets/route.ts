import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertPropertyAccess, requirePropertySetup, hasPermission, ForbiddenError, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// Module outlet links, per PROPERTY since 2026-09-23 (.agents/docs/HUB_SETUP_PLAN.md,
// Phase 2). Spa and Excursions each post through one of the property's OWN outlets —
// until 2026-09-23 one outlet served the whole enterprise, so a spa appointment at one
// property billed through an outlet belonging to another. While a module's link is null,
// folio posting FROM that module at this property is refused.

const MODULES = ["SPA", "EXCURSIONS"] as const;
type ModuleKey = (typeof MODULES)[number];

const OUTLET_SELECT = { id: true, name: true, outletType: true } as const;

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const propertyId = new URL(request.url).searchParams.get("propertyId");
    if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    // Readable by anyone who can see either module or Property Setup, at their property.
    if (!hasPermission(ctx, "SPA", "view") && !hasPermission(ctx, "EXCURSIONS", "view") && !hasPermission(ctx, "CONTROLS", "view")) {
      throw new ForbiddenError("Missing view permission");
    }
    await assertPropertyAccess(ctx, propertyId);

    const [settings, outlets] = await Promise.all([
      prisma.propertySettings.findUnique({
        where: { propertyId },
        select: { spaOutlet: { select: OUTLET_SELECT }, spaOutletId: true, excursionOutlet: { select: OUTLET_SELECT }, excursionOutletId: true },
      }),
      // This property's outlets only — the link never crosses properties.
      prisma.outlet.findMany({ where: { propertyId }, select: OUTLET_SELECT, orderBy: { name: "asc" } }),
    ]);

    return NextResponse.json({
      spaOutletId: settings?.spaOutletId ?? null,
      spaOutlet: settings?.spaOutlet ?? null,
      excursionOutletId: settings?.excursionOutletId ?? null,
      excursionOutlet: settings?.excursionOutlet ?? null,
      outlets,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireSession();
    const body = await request.json();
    const propertyId: string | undefined = body.propertyId;
    if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    await requirePropertySetup(ctx, propertyId, "CONTROLS", "update");

    const moduleKey: ModuleKey | undefined = MODULES.includes(body.module) ? body.module : undefined;
    if (!moduleKey) {
      return NextResponse.json({ error: `module must be one of ${MODULES.join(", ")}` }, { status: 400 });
    }

    // One of THIS property's outlets, or null to unlink.
    let outletId: string | null = null;
    if (body.outletId !== undefined && body.outletId !== null && body.outletId !== "") {
      const outlet = await prisma.outlet.findUnique({ where: { id: body.outletId }, select: { id: true, propertyId: true } });
      if (!outlet || outlet.propertyId !== propertyId) {
        return NextResponse.json({ error: "Outlet not found at this property" }, { status: 404 });
      }
      outletId = outlet.id;
    }

    const data = moduleKey === "SPA" ? { spaOutletId: outletId } : { excursionOutletId: outletId };
    const settings = await prisma.propertySettings.upsert({
      where: { propertyId },
      update: data,
      create: { propertyId, ...data },
    });

    await logActivity({
      ctx, module: "CONTROLS", action: "UPDATE", entityType: "PropertySettings", entityId: propertyId,
      description: `${moduleKey === "SPA" ? "Spa" : "Excursions"} outlet ${outletId ? "linked" : "unlinked"}`,
    });

    return NextResponse.json({
      spaOutletId: settings.spaOutletId,
      excursionOutletId: settings.excursionOutletId,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
