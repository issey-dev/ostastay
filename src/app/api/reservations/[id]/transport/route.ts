import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

const transportSchema = z.object({
  direction: z.enum(["PICKUP", "DROPOFF"]),
  transportType: z.string().max(64).optional().nullable(),
  carrierCode: z.string().max(64).optional().nullable(),
  carrierTime: z.string().optional().nullable(), // datetime-local
  transportNo: z.string().max(64).optional().nullable(),
  transportTime: z.string().optional().nullable(), // datetime-local
  remarks: z.string().max(500).optional().nullable(),
  chargeToGuest: z.boolean().optional(),
  chargeCodeId: z.string().optional().nullable(),
  chargeAmount: z.number().finite().nonnegative().optional().nullable(),
});

const bodySchema = z.object({ transports: z.array(transportSchema).max(2) });

const isEmptyLeg = (t: z.infer<typeof transportSchema>) =>
  !t.transportType && !t.carrierCode && !t.carrierTime && !t.transportNo && !t.transportTime &&
  !t.remarks && !(t.chargeAmount && t.chargeAmount > 0);

// Upsert a reservation's pickup/dropoff transport (one row per direction). A leg with
// every field empty is deleted, so clearing it in the editor removes the row. Charges
// aren't posted here — that's the dedicated /transport/[direction]/charge route.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");

    const { id } = await params;
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid transport payload", details: parsed.error.flatten() }, { status: 400 });
    }

    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: { transports: true },
    });
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, reservation.propertyId);

    // Transport time must fall within the stay (its charge realizes on that date, so it
    // has to land inside the reservation); carrier/flight time may be earlier but not
    // after check-out. Bounds are date-only: [check-in 00:00, check-out end-of-day].
    const stayStart = new Date(`${reservation.checkInDate.toISOString().slice(0, 10)}T00:00:00.000Z`);
    const stayEnd = new Date(`${reservation.checkOutDate.toISOString().slice(0, 10)}T23:59:59.999Z`);
    for (const leg of parsed.data.transports) {
      if (leg.transportTime) {
        const t = new Date(leg.transportTime);
        if (t < stayStart || t > stayEnd) {
          return NextResponse.json(
            { error: `${leg.direction === "PICKUP" ? "Pickup" : "Dropoff"} transport time must fall between check-in and check-out.` },
            { status: 400 }
          );
        }
      }
      if (leg.carrierTime && new Date(leg.carrierTime) > stayEnd) {
        return NextResponse.json(
          { error: `${leg.direction === "PICKUP" ? "Pickup" : "Dropoff"} carrier time cannot be after check-out.` },
          { status: 400 }
        );
      }
    }

    for (const leg of parsed.data.transports) {
      const existing = reservation.transports.find((t) => t.direction === leg.direction);
      if (isEmptyLeg(leg)) {
        if (existing) {
          await prisma.reservationTransport.delete({ where: { id: existing.id } });
        }
        continue;
      }
      const data = {
        transportType: leg.transportType || null,
        carrierCode: leg.carrierCode || null,
        carrierTime: leg.carrierTime ? new Date(leg.carrierTime) : null,
        transportNo: leg.transportNo || null,
        transportTime: leg.transportTime ? new Date(leg.transportTime) : null,
        remarks: leg.remarks || null,
        chargeToGuest: leg.chargeToGuest ?? false,
        chargeCodeId: leg.chargeCodeId || null,
        chargeAmount: leg.chargeAmount ?? null,
      };
      await prisma.reservationTransport.upsert({
        where: { reservationId_direction: { reservationId: id, direction: leg.direction } },
        create: { reservationId: id, direction: leg.direction, ...data },
        // Never clobber an already-posted charge link on edit.
        update: data,
      });
    }

    await logActivity({
      ctx,
      module: "RESERVATIONS",
      action: "UPDATE",
      entityType: "Reservation",
      entityId: id,
      description: `Updated transport for reservation ${reservation.confirmationNo}`,
    });

    const transports = await prisma.reservationTransport.findMany({ where: { reservationId: id } });
    return NextResponse.json({ transports });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
