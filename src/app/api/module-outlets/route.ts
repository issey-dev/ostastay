import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, hasPermission, ForbiddenError, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// Hub-wide module outlet links (owner ruling 2026-07-30): Spa and Excursions each post
// through ONE outlet shared across every property in the enterprise. The outlet may be
// homed at any property — a spa appointment at property A legitimately bills through an
// outlet at property B — and while a module's link is null, folio posting FROM that
// module is refused (see spa/appointments and excursions/bookings).

const MODULES = ["SPA", "EXCURSIONS"] as const;
type ModuleKey = (typeof MODULES)[number];

const OUTLET_SELECT = {
  id: true,
  name: true,
  outletType: true,
  property: { select: { id: true, name: true } },
} as const;

export async function GET() {
  try {
    const ctx = await requireSession();
    // Readable by anyone who can see either module or Controls.
    if (!hasPermission(ctx, "SPA", "view") && !hasPermission(ctx, "EXCURSIONS", "view") && !hasPermission(ctx, "CONTROLS", "view")) {
      throw new ForbiddenError("Missing view permission");
    }

    const [settings, outlets] = await Promise.all([
      prisma.enterpriseSettings.findUnique({
        where: { enterpriseId: ctx.enterpriseId },
        select: { spaOutlet: { select: OUTLET_SELECT }, spaOutletId: true, excursionOutlet: { select: OUTLET_SELECT }, excursionOutletId: true },
      }),
      // Every outlet across the whole enterprise — the link is deliberately
      // cross-property, so the picker must not be scoped to the current property.
      prisma.outlet.findMany({
        where: { property: { enterpriseId: ctx.enterpriseId } },
        select: OUTLET_SELECT,
        orderBy: [{ property: { name: "asc" } }, { name: "asc" }],
      }),
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
    requirePermission(ctx, "CONTROLS", "update");

    const body = await request.json();
    const moduleKey: ModuleKey | undefined = MODULES.includes(body.module) ? body.module : undefined;
    if (!moduleKey) {
      return NextResponse.json({ error: `module must be one of ${MODULES.join(", ")}` }, { status: 400 });
    }

    // Any outlet of the enterprise — any property — or null to unlink.
    let outletId: string | null = null;
    if (body.outletId !== undefined && body.outletId !== null && body.outletId !== "") {
      const outlet = await prisma.outlet.findUnique({ where: { id: body.outletId }, include: { property: true } });
      if (!outlet || outlet.property.enterpriseId !== ctx.enterpriseId) {
        return NextResponse.json({ error: "Outlet not found" }, { status: 404 });
      }
      outletId = outlet.id;
    }

    const data = moduleKey === "SPA" ? { spaOutletId: outletId } : { excursionOutletId: outletId };
    const settings = await prisma.enterpriseSettings.upsert({
      where: { enterpriseId: ctx.enterpriseId },
      update: data,
      create: { enterpriseId: ctx.enterpriseId, resConfirmPrefix: "", resConfirmLength: 6, ...data },
    });

    await logActivity({
      ctx, module: "CONTROLS", action: "UPDATE", entityType: "EnterpriseSettings", entityId: settings.id,
      description: `${moduleKey === "SPA" ? "Spa" : "Excursions"} outlet ${outletId ? "linked" : "unlinked"} (hub-wide)`,
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
