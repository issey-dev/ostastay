import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { generateEregistrationToken, hashEregistrationToken } from "@/lib/eregistration/token";
import { planSlotReconciliation } from "@/lib/eregistration/slots";
import { logActivity } from "@/lib/activity-log";

// Every ERegistrationGuestSlot row for a reservation, regardless of which link (past or
// present) it's linked to — slots are unique per (reservationId, slotIndex) and outlive
// any single link's lifecycle, so staff review always reads them straight off the
// reservation rather than through whichever link happens to be currently active.
async function loadStatus(reservationId: string) {
  const [link, slots] = await Promise.all([
    prisma.eRegistrationLink.findFirst({
      where: { reservationId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.eRegistrationGuestSlot.findMany({
      where: { reservationId },
      orderBy: { slotIndex: "asc" },
      include: { existingProfile: { select: { upid: true, firstName: true, lastName: true, companyName: true } } },
    }),
  ]);
  const effectiveStatus =
    link && link.status === "ACTIVE" && link.expiresAt.getTime() < Date.now() ? "EXPIRED" : link?.status ?? null;
  return { link, effectiveStatus, slots };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "view");
    const { id } = await params;

    const reservation = await prisma.reservation.findUnique({ where: { id }, select: { propertyId: true } });
    if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    await assertPropertyAccess(ctx, reservation.propertyId);

    const { link, effectiveStatus, slots } = await loadStatus(id);
    return NextResponse.json({
      link: link ? { id: link.id, status: effectiveStatus, expiresAt: link.expiresAt, createdAt: link.createdAt, lastAccessedAt: link.lastAccessedAt } : null,
      slots,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");
    const { id } = await params;

    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: {
        property: { select: { id: true, enterpriseId: true, status: true } },
        accompanyingGuests: { orderBy: { createdAt: "asc" }, select: { profileId: true, createdAt: true } },
      },
    });
    if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    await assertPropertyAccess(ctx, reservation.propertyId);

    if (["CANCELLED", "NO_SHOW", "CHECKED_OUT"].includes(reservation.status)) {
      return NextResponse.json(
        { error: `Cannot generate an eRegistration link — this reservation is ${reservation.status.replace(/_/g, " ").toLowerCase()}.` },
        { status: 400 }
      );
    }

    const settings = await prisma.enterpriseSettings.findUnique({ where: { enterpriseId: reservation.property.enterpriseId } });
    if (settings && settings.eRegistrationEnabled === false) {
      return NextResponse.json({ error: "eRegistration is disabled for this enterprise — enable it under Controls → Stationaries first." }, { status: 400 });
    }
    const expiryHours = settings?.eRegistrationExpiryHours ?? 72;

    const existingSlots = await prisma.eRegistrationGuestSlot.findMany({
      where: { reservationId: id },
      select: { slotIndex: true, existingProfileId: true, status: true },
    });

    const plan = planSlotReconciliation(
      { adults: reservation.adults, primaryGuestId: reservation.primaryGuestId, accompanyingGuests: reservation.accompanyingGuests },
      existingSlots as { slotIndex: number; existingProfileId: string | null; status: "PENDING" | "SUBMITTED" | "APPLIED" }[]
    );

    const token = generateEregistrationToken();
    const tokenHash = hashEregistrationToken(token);
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

    const link = await prisma.$transaction(async (tx) => {
      await tx.eRegistrationLink.updateMany({
        where: { reservationId: id, status: "ACTIVE" },
        data: { status: "REVOKED", revokedAt: new Date(), revokedByUserId: ctx.userId },
      });

      const newLink = await tx.eRegistrationLink.create({
        data: {
          reservationId: id,
          propertyId: reservation.propertyId,
          enterpriseId: reservation.property.enterpriseId,
          tokenHash,
          status: "ACTIVE",
          expiresAt,
          createdByUserId: ctx.userId,
        },
      });

      for (const s of plan.toCreate) {
        await tx.eRegistrationGuestSlot.create({
          data: { linkId: newLink.id, reservationId: id, slotIndex: s.slotIndex, isPrimary: s.isPrimary, existingProfileId: s.existingProfileId },
        });
      }
      for (const s of plan.toUpdate) {
        await tx.eRegistrationGuestSlot.updateMany({
          where: { reservationId: id, slotIndex: s.slotIndex },
          data: { existingProfileId: s.existingProfileId, linkId: newLink.id },
        });
      }
      for (const idx of plan.toRelink) {
        await tx.eRegistrationGuestSlot.updateMany({ where: { reservationId: id, slotIndex: idx }, data: { linkId: newLink.id } });
      }
      for (const idx of plan.toDeletePending) {
        await tx.eRegistrationGuestSlot.deleteMany({ where: { reservationId: id, slotIndex: idx, status: "PENDING" } });
      }

      return newLink;
    });

    await logActivity({
      ctx,
      module: "RESERVATIONS",
      action: "EREGISTRATION_LINK_CREATE",
      entityType: "Reservation",
      entityId: id,
      description: `Generated an eRegistration link for ${reservation.confirmationNo}`,
    });

    const url = `${process.env.APP_URL ?? "http://localhost:3000"}/eregistration/${token}`;
    return NextResponse.json({ url, token, expiresAt: link.expiresAt, warnings: plan.warnings });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
