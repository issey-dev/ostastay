import { prisma } from "@/lib/db";

// Hub → Booking API → Online bookings: every booking attempt the Booking API received,
// across Rooms (WebsiteBooking) and Excursions/Spa (ApiActivityBooking) — including the
// FAILED ones and expired holds, which appear nowhere else. Closes the Website API's "no
// Hub list of website bookings" open item (WEBSITE_API_PLAN.md).

export type OnlineBookingModule = "ROOMS" | "EXCURSIONS" | "SPA";
export type OnlineBookingStatus = "CONFIRMED" | "CANCELLED" | "FAILED" | "HELD" | "EXPIRED" | "COMPLETED" | "NO_SHOW" | "OTHER";

export type OnlineBookingRow = {
  id: string;
  createdAt: string;
  module: OnlineBookingModule;
  reference: string | null;
  property: { id: string; name: string };
  keyName: string;
  guest: { name: string | null; email: string | null };
  /** What was booked, in a line. */
  summary: string;
  total: number | null;
  currency: string | null;
  payment: string | null;
  paymentFlagged: boolean;
  status: OnlineBookingStatus;
  problem: string | null;
};

const day = (d: Date) => d.toISOString().slice(0, 10);

function party(a: number, c: number, i: number) {
  return [a ? `${a}A` : null, c ? `${c}C` : null, i ? `${i}I` : null].filter(Boolean).join(" ");
}

function liveStatus(s: string): OnlineBookingStatus {
  if (s === "CONFIRMED" || s === "CHECKED_IN" || s === "IN_TREATMENT" || s === "RESERVED" || s === "IN_HOUSE") return "CONFIRMED";
  if (s === "CANCELLED") return "CANCELLED";
  if (s === "COMPLETED" || s === "CHECKED_OUT") return "COMPLETED";
  if (s === "NO_SHOW") return "NO_SHOW";
  return "OTHER";
}

export async function listOnlineBookings(
  enterpriseId: string,
  filter: { module?: OnlineBookingModule | null; status?: OnlineBookingStatus | null; propertyId?: string | null; limit?: number }
): Promise<OnlineBookingRow[]> {
  const limit = Math.min(filter.limit ?? 200, 500);
  const now = new Date();
  const rows: OnlineBookingRow[] = [];

  if (!filter.module || filter.module === "ROOMS") {
    const web = await prisma.websiteBooking.findMany({
      where: { enterpriseId, ...(filter.propertyId ? { propertyId: filter.propertyId } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        property: { select: { id: true, name: true } },
        key: { select: { name: true } },
        reservation: { select: { confirmationNo: true, status: true } },
      },
    });
    const roomTypes = new Map(
      (await prisma.roomType.findMany({ where: { id: { in: [...new Set(web.map((w) => w.roomTypeId))] } }, select: { id: true, name: true } })).map((r) => [r.id, r.name])
    );
    for (const w of web) {
      rows.push({
        id: w.id,
        createdAt: w.createdAt.toISOString(),
        module: "ROOMS",
        reference: w.reservation?.confirmationNo ?? null,
        property: w.property,
        keyName: w.key.name,
        guest: { name: [w.guestFirstName, w.guestLastName].filter(Boolean).join(" "), email: w.guestEmail },
        summary: `${roomTypes.get(w.roomTypeId) ?? "Room"} · ${day(w.arrival)} → ${day(w.departure)} · ${party(w.adults, w.children, 0)}`,
        total: w.quotedTotal,
        currency: w.currency,
        payment: null,
        paymentFlagged: false,
        status: w.status === "FAILED" ? "FAILED" : w.reservation ? liveStatus(w.reservation.status) : "CONFIRMED",
        problem: w.problem,
      });
    }
  }

  if (!filter.module || filter.module === "EXCURSIONS" || filter.module === "SPA") {
    const activity = await prisma.apiActivityBooking.findMany({
      where: {
        enterpriseId,
        ...(filter.module ? { module: filter.module } : {}),
        ...(filter.propertyId ? { propertyId: filter.propertyId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        property: { select: { id: true, name: true } },
        key: { select: { name: true } },
        excursionDeparture: { select: { departureDate: true, departureTime: true, excursionType: { select: { name: true } } } },
        excursionBooking: { select: { status: true } },
        spaAppointment: { select: { appointmentStatus: true, appointmentDate: true, startTime: true, treatmentNameSnapshot: true, partySize: true } },
      },
    });
    for (const a of activity) {
      let status: OnlineBookingStatus;
      if (a.status === "FAILED") status = "FAILED";
      else if (a.status === "EXPIRED" || (a.status === "HELD" && (!a.holdExpiresAt || a.holdExpiresAt <= now))) status = "EXPIRED";
      else if (a.status === "HELD") status = "HELD";
      else if (a.excursionBooking) status = liveStatus(a.excursionBooking.status);
      else if (a.spaAppointment) status = liveStatus(a.spaAppointment.appointmentStatus);
      else status = "OTHER";

      const summary =
        a.module === "EXCURSIONS"
          ? a.excursionDeparture
            ? `${a.excursionDeparture.excursionType.name} · ${day(a.excursionDeparture.departureDate)} ${a.excursionDeparture.departureTime} · ${party(a.adults, a.children, a.infants)}`
            : `Excursion · ${party(a.adults, a.children, a.infants)}`
          : a.spaAppointment
            ? `${a.spaAppointment.treatmentNameSnapshot} · ${day(a.spaAppointment.appointmentDate)} ${a.spaAppointment.startTime} · ${a.spaAppointment.partySize} guest${a.spaAppointment.partySize === 1 ? "" : "s"}`
            : `Spa · ${a.adults || 1} guest(s)`;

      rows.push({
        id: a.id,
        createdAt: a.createdAt.toISOString(),
        module: a.module as OnlineBookingModule,
        reference: a.status === "CONFIRMED" ? a.publicRef : null,
        property: a.property,
        keyName: a.key.name,
        guest: { name: [a.guestFirstName, a.guestLastName].filter(Boolean).join(" ") || null, email: a.guestEmail },
        summary,
        total: a.quotedTotal,
        currency: a.currency,
        payment: a.paymentStatus ? (a.paymentStatus === "PAID" ? `Paid online${a.paymentReference ? ` · ${a.paymentReference}` : ""}` : "Pay at property") : null,
        paymentFlagged: a.amountMismatch,
        status,
        problem: a.problem,
      });
    }
  }

  return rows
    .filter((r) => !filter.status || r.status === filter.status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}
