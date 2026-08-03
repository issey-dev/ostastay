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
    // Which date the range applies to (app-owner, 2026-08-03):
    //   stay      — stays OVERLAPPING the range (the old, and still default, behaviour)
    //   arrival   — arrivals falling inside it
    //   departure — departures falling inside it
    const dateMode = (searchParams.get("dateMode") ?? "stay").toLowerCase();
    const skip = Math.max(0, parseInt(searchParams.get("skip") ?? "0", 10) || 0);
    const take = Math.min(100, Math.max(1, parseInt(searchParams.get("take") ?? "100", 10) || 100));

    // Finished business is hidden unless it is explicitly asked for: a desk searching
    // "Smith" wants the live booking, not last season's checked-out ones. Asking for the
    // status directly (status=CHECKED_OUT) still returns it — the exclusion only applies
    // when the caller expressed no status preference at all.
    const FINISHED = ["CHECKED_OUT", "NO_SHOW"];
    const statusWhere = statuses
      ? { status: { in: statuses } }
      : { status: { notIn: FINISHED } };

    // Date filtering, per mode. `to` is treated as INCLUSIVE — a range ending 30 Sep
    // must include arrivals on 30 Sep, which a bare lte on a UTC-midnight column gives.
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    const dateWhere =
      dateMode === "arrival"
        ? { checkInDate: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } }
        : dateMode === "departure"
          ? { checkOutDate: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } }
          : {
              // Overlap: the stay starts on/before the range ends and ends on/after it starts.
              ...(toDate ? { checkInDate: { lte: toDate } } : {}),
              ...(fromDate ? { checkOutDate: { gte: fromDate } } : {}),
            };

    const reservations = await prisma.reservation.findMany({
      where: {
        propertyId,
        ...statusWhere,
        // ONE field, every piece of vital info a desk actually has to hand
        // (app-owner, 2026-08-03): confirmation number, the channel's own booking
        // reference, guest or company name, room number, and the guest's phone/email.
        // Accompanying guests are searched too — a call often comes from the second
        // name on the booking.
        ...(search
          ? {
              OR: [
                { confirmationNo: { contains: search, mode: "insensitive" as const } },
                { externalRef: { contains: search, mode: "insensitive" as const } },
                { primaryGuest: { firstName: { contains: search, mode: "insensitive" as const } } },
                { primaryGuest: { lastName: { contains: search, mode: "insensitive" as const } } },
                { primaryGuest: { companyName: { contains: search, mode: "insensitive" as const } } },
                // Contact details are rows in ProfileCommunication (EMAIL / MOBILE),
                // not columns on Profile — so a phone or email typed into the box
                // matches through that relation.
                { primaryGuest: { communications: { some: { value: { contains: search, mode: "insensitive" as const } } } } },
                { travelAgent: { companyName: { contains: search, mode: "insensitive" as const } } },
                { assignments: { some: { room: { roomNumber: { contains: search, mode: "insensitive" as const } } } } },
                { accompanyingGuests: { some: { profile: { firstName: { contains: search, mode: "insensitive" as const } } } } },
                { accompanyingGuests: { some: { profile: { lastName: { contains: search, mode: "insensitive" as const } } } } },
              ],
            }
          : {}),
        ...dateWhere,
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
