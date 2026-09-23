import { NextResponse } from "next/server";
import { requireSession, requirePropertySetup, toErrorResponse } from "@/lib/scope";
import { listOnlineBookings, type OnlineBookingModule, type OnlineBookingStatus } from "@/lib/website-api/online-bookings";

const MODULES = ["ROOMS", "EXCURSIONS", "SPA"];
const STATUSES = ["CONFIRMED", "CANCELLED", "FAILED", "HELD", "EXPIRED", "COMPLETED", "NO_SHOW"];

// One property's Booking API bookings and attempts — see
// src/lib/website-api/online-bookings.ts. ?propertyId= is required: Property Setup for that
// property, INTEGRATIONS (Hub > the property > Online Booking).
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const s = new URL(request.url).searchParams;
    const propertyId = s.get("propertyId");
    if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    await requirePropertySetup(ctx, propertyId, "INTEGRATIONS", "view");

    const mod = s.get("module");
    const status = s.get("status");
    const rows = await listOnlineBookings(ctx.enterpriseId, {
      module: mod && MODULES.includes(mod) ? (mod as OnlineBookingModule) : null,
      status: status && STATUSES.includes(status) ? (status as OnlineBookingStatus) : null,
      propertyId,
    });
    return NextResponse.json({ bookings: rows });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
