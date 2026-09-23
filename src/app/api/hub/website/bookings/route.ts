import { NextResponse } from "next/server";
import { requireSession, requireEnterpriseHub, requirePermission, toErrorResponse } from "@/lib/scope";
import { listOnlineBookings, type OnlineBookingModule, type OnlineBookingStatus } from "@/lib/website-api/online-bookings";

const MODULES = ["ROOMS", "EXCURSIONS", "SPA"];
const STATUSES = ["CONFIRMED", "CANCELLED", "FAILED", "HELD", "EXPIRED", "COMPLETED", "NO_SHOW"];

// Every Booking API booking and attempt for the enterprise — see
// src/lib/website-api/online-bookings.ts. Hub + INTEGRATIONS, like the rest of the page.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requireEnterpriseHub(ctx);
    requirePermission(ctx, "INTEGRATIONS", "view");

    const s = new URL(request.url).searchParams;
    const mod = s.get("module");
    const status = s.get("status");
    const rows = await listOnlineBookings(ctx.enterpriseId, {
      module: mod && MODULES.includes(mod) ? (mod as OnlineBookingModule) : null,
      status: status && STATUSES.includes(status) ? (status as OnlineBookingStatus) : null,
      propertyId: s.get("propertyId"),
    });
    return NextResponse.json({ bookings: rows });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
