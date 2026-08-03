import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { createReservation } from "@/lib/reservations/create-reservation";

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");

    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, propertyId);

    // Optional server-side filters — response stays a plain array for existing
    // callers; the list page pages through with skip/take (load-more style).
    const statusParam = searchParams.get("status");
    const statuses = statusParam ? statusParam.split(",").map((s) => s.trim()).filter(Boolean) : null;
    const search = searchParams.get("search")?.trim() || null;
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const skip = Math.max(0, parseInt(searchParams.get("skip") ?? "0", 10) || 0);
    const take = Math.min(100, Math.max(1, parseInt(searchParams.get("take") ?? "100", 10) || 100));

    const reservations = await prisma.reservation.findMany({
      where: {
        propertyId,
        ...(statuses ? { status: { in: statuses } } : {}),
        ...(search
          ? {
              OR: [
                { confirmationNo: { contains: search, mode: "insensitive" as const } },
                // The channel's own booking id (Beds24/OTA ref) — lets the desk paste a
                // reference from the channel manager straight into this search box.
                { externalRef: { contains: search, mode: "insensitive" as const } },
                { primaryGuest: { firstName: { contains: search, mode: "insensitive" as const } } },
                { primaryGuest: { lastName: { contains: search, mode: "insensitive" as const } } },
                { primaryGuest: { companyName: { contains: search, mode: "insensitive" as const } } },
              ],
            }
          : {}),
        // A date range filters to stays overlapping it, not just arrivals in it.
        ...(to ? { checkInDate: { lte: new Date(to) } } : {}),
        ...(from ? { checkOutDate: { gte: new Date(from) } } : {}),
      },
      include: {
        primaryGuest: true,
        travelAgent: true,
        accompanyingGuests: { include: { profile: true } },
        assignments: {
          include: {
            roomType: true,
            room: {
              include: {
                housekeepingTasks: {
                  where: { taskType: 'SPECIAL_REQUEST' },
                  orderBy: { createdAt: 'desc' }
                }
              }
            },
            ratePlan: true
          }
        },
        folios: { include: { payments: { select: { amount: true, isRefund: true } } } },
        allocations: {
          include: {
            allocation: {
              include: { rates: true, chargeCode: { select: { code: true } } },
            },
          },
        },
        specialRequests: true,
      },
      orderBy: { checkInDate: 'asc' },
      skip,
      take,
    });
    return NextResponse.json(reservations);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "create");

    const body = await request.json();
    const result = await createReservation(ctx, body);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, ...(result.requiresOverbookConfirm ? { requiresOverbookConfirm: true } : {}) },
        { status: result.status }
      );
    }
    if (result.allocationWarning !== undefined) {
      // The reservation itself is valid — surface the add-on problem without losing it.
      return NextResponse.json({ ...result.reservation, allocationWarning: result.allocationWarning }, { status: 201 });
    }
    return NextResponse.json(
      { ...result.reservation, capacityWarning: result.capacityWarning, overbookWarning: result.overbookWarning },
      { status: 201 }
    );
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
