import { NextResponse } from "next/server";
import { requireSession, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { buildDashboardOverview } from "@/lib/dashboard/overview";

// The Operations Dashboard feed. Deliberately has NO requirePermission() of its own:
// the dashboard is a composite of many modules, so a single module gate would either
// lock out users who legitimately hold one of its parts, or let one permission unlock
// all of them. Instead every SECTION is gated individually inside
// buildDashboardOverview() — a caller only ever receives the sections they hold
// `canView` on, and a caller holding none receives a payload with nothing but the
// property header. See src/lib/dashboard/overview.ts.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    if (!propertyId) {
      return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, propertyId);

    const trendDaysParam = Number(searchParams.get("trendDays"));
    const overview = await buildDashboardOverview(ctx, propertyId, {
      trendDays: Number.isFinite(trendDaysParam) && trendDaysParam > 0 ? trendDaysParam : undefined,
    });

    return NextResponse.json(overview);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
