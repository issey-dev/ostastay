import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveEregistrationLink, reservationIdsForLink } from "@/lib/eregistration/resolve-link";
import { resolveInvoiceBrandColor } from "@/lib/invoice-branding";

function displayName(slot: { firstName: string | null; lastName: string | null; existingProfile: { firstName: string; lastName: string | null; companyName: string | null } | null }) {
  if (slot.existingProfile) {
    return slot.existingProfile.companyName || [slot.existingProfile.firstName, slot.existingProfile.lastName].filter(Boolean).join(" ");
  }
  if (slot.firstName) return [slot.firstName, slot.lastName].filter(Boolean).join(" ");
  return null;
}

// Guest-facing landing summary. No session — every scoping value comes from the
// resolved link row, never a client param. Shaped narrowly: per OTHER slot only
// slotIndex/isPrimary/displayName/status ever cross this boundary — never another
// guest's document, address, photo, or signature, and never any rate/room/folio/
// payment data. One token can be shared by multiple people filling in separate slots.
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolution = await resolveEregistrationLink(token);
  if (!resolution.ok) return NextResponse.json({ error: resolution.error }, { status: resolution.status });
  const { link } = resolution;

  await prisma.eRegistrationLink.update({ where: { id: link.id }, data: { lastAccessedAt: new Date() } });

  const reservationIds = await reservationIdsForLink(link);
  const reservations = await prisma.reservation.findMany({
    where: { id: { in: reservationIds } },
    select: {
      id: true,
      confirmationNo: true,
      checkInDate: true,
      checkOutDate: true,
      status: true,
      property: { select: { name: true, logoUrl: true, bannerColor: true, enterpriseId: true } },
    },
  });

  const activeReservations = reservations.filter((r) => !["CANCELLED", "NO_SHOW", "CHECKED_OUT"].includes(r.status));
  if (activeReservations.length === 0) {
    return NextResponse.json({ error: "This stay is no longer available for eRegistration." }, { status: 410 });
  }

  const settings = await prisma.enterpriseSettings.findUnique({ where: { enterpriseId: activeReservations[0].property.enterpriseId } });

  const slots = await prisma.eRegistrationGuestSlot.findMany({
    where: { reservationId: { in: activeReservations.map((r) => r.id) } },
    orderBy: [{ reservationId: "asc" }, { slotIndex: "asc" }],
    include: { existingProfile: { select: { firstName: true, lastName: true, companyName: true } } },
  });

  const byReservation = activeReservations.map((r) => ({
    reservationId: r.id,
    confirmationNo: r.confirmationNo,
    checkInDate: r.checkInDate,
    checkOutDate: r.checkOutDate,
    slots: slots
      .filter((s) => s.reservationId === r.id)
      .map((s) => ({
        id: s.id,
        slotIndex: s.slotIndex,
        isPrimary: s.isPrimary,
        displayName: displayName(s),
        status: s.status,
      })),
  }));

  const property = activeReservations[0].property;
  return NextResponse.json({
    propertyName: property.name,
    logoUrl: property.logoUrl,
    brandColor: resolveInvoiceBrandColor(property.bannerColor),
    message: settings?.eRegistrationMessage ?? null,
    reservations: byReservation,
  });
}
