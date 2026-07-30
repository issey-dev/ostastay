import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { generateEregistrationToken, hashEregistrationToken } from "@/lib/eregistration/token";
import { planSlotReconciliation } from "@/lib/eregistration/slots";
import { logActivity } from "@/lib/activity-log";

const EXCLUDED_PICKUP_STATUSES = ["CANCELLED", "NO_SHOW", "CHECKED_OUT"];

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "view");
    const { id } = await params;

    const group = await prisma.groupBlock.findUnique({ where: { id }, select: { propertyId: true } });
    if (!group) return NextResponse.json({ error: "Group block not found" }, { status: 404 });
    await assertPropertyAccess(ctx, group.propertyId);

    const [link, pickups] = await Promise.all([
      prisma.eRegistrationLink.findFirst({ where: { groupBlockId: id, status: "ACTIVE" }, orderBy: { createdAt: "desc" } }),
      prisma.reservation.findMany({ where: { groupBlockId: id, status: { notIn: EXCLUDED_PICKUP_STATUSES } }, select: { id: true, confirmationNo: true } }),
    ]);
    const slots = await prisma.eRegistrationGuestSlot.findMany({
      where: { reservationId: { in: pickups.map((p) => p.id) } },
      orderBy: [{ reservationId: "asc" }, { slotIndex: "asc" }],
      include: { existingProfile: { select: { upid: true, firstName: true, lastName: true, companyName: true } } },
    });
    const effectiveStatus = link && link.status === "ACTIVE" && link.expiresAt.getTime() < Date.now() ? "EXPIRED" : link?.status ?? null;

    return NextResponse.json({
      link: link ? { id: link.id, status: effectiveStatus, expiresAt: link.expiresAt, createdAt: link.createdAt, lastAccessedAt: link.lastAccessedAt } : null,
      pickups: pickups.map((p) => ({ ...p, slots: slots.filter((s) => s.reservationId === p.id) })),
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

    const group = await prisma.groupBlock.findUnique({ where: { id }, select: { id: true, propertyId: true, code: true } });
    if (!group) return NextResponse.json({ error: "Group block not found" }, { status: 404 });
    await assertPropertyAccess(ctx, group.propertyId);

    const property = await prisma.property.findUniqueOrThrow({ where: { id: group.propertyId }, select: { enterpriseId: true } });
    const settings = await prisma.enterpriseSettings.findUnique({ where: { enterpriseId: property.enterpriseId } });
    if (settings && settings.eRegistrationEnabled === false) {
      return NextResponse.json({ error: "eRegistration is disabled for this enterprise — enable it under Controls → Stationaries first." }, { status: 400 });
    }
    const expiryHours = settings?.eRegistrationExpiryHours ?? 72;

    const pickups = await prisma.reservation.findMany({
      where: { groupBlockId: id, status: { notIn: EXCLUDED_PICKUP_STATUSES } },
      include: { accompanyingGuests: { orderBy: { createdAt: "asc" }, select: { profileId: true, createdAt: true } } },
    });
    if (pickups.length === 0) {
      return NextResponse.json({ error: "This group block has no active pickups to generate an eRegistration link for." }, { status: 400 });
    }

    const token = generateEregistrationToken();
    const tokenHash = hashEregistrationToken(token);
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);
    const allWarnings: string[] = [];

    const link = await prisma.$transaction(async (tx) => {
      await tx.eRegistrationLink.updateMany({
        where: { groupBlockId: id, status: "ACTIVE" },
        data: { status: "REVOKED", revokedAt: new Date(), revokedByUserId: ctx.userId },
      });

      const newLink = await tx.eRegistrationLink.create({
        data: { groupBlockId: id, propertyId: group.propertyId, enterpriseId: property.enterpriseId, tokenHash, status: "ACTIVE", expiresAt, createdByUserId: ctx.userId },
      });

      for (const pickup of pickups) {
        const existingSlots = await tx.eRegistrationGuestSlot.findMany({
          where: { reservationId: pickup.id },
          select: { slotIndex: true, existingProfileId: true, status: true },
        });
        const plan = planSlotReconciliation(
          { adults: pickup.adults, primaryGuestId: pickup.primaryGuestId, accompanyingGuests: pickup.accompanyingGuests },
          existingSlots as { slotIndex: number; existingProfileId: string | null; status: "PENDING" | "SUBMITTED" | "APPLIED" }[]
        );
        allWarnings.push(...plan.warnings.map((w) => `${pickup.confirmationNo}: ${w}`));

        for (const s of plan.toCreate) {
          await tx.eRegistrationGuestSlot.create({
            data: { linkId: newLink.id, reservationId: pickup.id, slotIndex: s.slotIndex, isPrimary: s.isPrimary, existingProfileId: s.existingProfileId },
          });
        }
        for (const s of plan.toUpdate) {
          await tx.eRegistrationGuestSlot.updateMany({ where: { reservationId: pickup.id, slotIndex: s.slotIndex }, data: { existingProfileId: s.existingProfileId, linkId: newLink.id } });
        }
        for (const idx of plan.toRelink) {
          await tx.eRegistrationGuestSlot.updateMany({ where: { reservationId: pickup.id, slotIndex: idx }, data: { linkId: newLink.id } });
        }
        for (const idx of plan.toDeletePending) {
          await tx.eRegistrationGuestSlot.deleteMany({ where: { reservationId: pickup.id, slotIndex: idx, status: "PENDING" } });
        }
      }

      return newLink;
    });

    await logActivity({
      ctx,
      module: "RESERVATIONS",
      action: "EREGISTRATION_GROUP_LINK_CREATE",
      entityType: "GroupBlock",
      entityId: id,
      description: `Generated a group eRegistration link for ${group.code} (${pickups.length} pickup${pickups.length > 1 ? "s" : ""})`,
    });

    const url = `${process.env.APP_URL ?? "http://localhost:3000"}/eregistration/${token}`;
    return NextResponse.json({ url, token, expiresAt: link.expiresAt, warnings: allWarnings, pickupCount: pickups.length });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
