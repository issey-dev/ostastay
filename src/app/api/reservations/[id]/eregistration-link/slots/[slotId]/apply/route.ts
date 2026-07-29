import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// Which field groups from a submitted slot to copy into the live Profile — staff choose
// via the Check-in Wizard's diff dialog rather than an all-or-nothing bulk overwrite,
// since the wizard's own Identification step already lets staff hand-edit DOB/
// nationality moments earlier in the same session.
const FIELD_GROUPS = ["personal", "contact", "address", "document"] as const;
type FieldGroup = (typeof FIELD_GROUPS)[number];

function fullName(p: { firstName: string; lastName: string | null }) {
  return [p.firstName, p.lastName].filter(Boolean).join(" ");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; slotId: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");
    requirePermission(ctx, "PROFILES", "update");
    const { id, slotId } = await params;
    const body = await request.json().catch(() => ({}));
    const fields: FieldGroup[] = Array.isArray(body.fields)
      ? body.fields.filter((f: string): f is FieldGroup => FIELD_GROUPS.includes(f as FieldGroup))
      : [...FIELD_GROUPS];

    const reservation = await prisma.reservation.findUnique({ where: { id }, select: { propertyId: true, confirmationNo: true } });
    if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    await assertPropertyAccess(ctx, reservation.propertyId);

    const slot = await prisma.eRegistrationGuestSlot.findFirst({ where: { id: slotId, reservationId: id } });
    if (!slot) return NextResponse.json({ error: "Guest slot not found" }, { status: 404 });
    if (slot.status === "PENDING") {
      return NextResponse.json({ error: "This guest hasn't submitted their eRegistration yet." }, { status: 400 });
    }

    let profileUpid = slot.existingProfileId;

    const result = await prisma.$transaction(async (tx) => {
      if (!profileUpid) {
        // A brand new guest, not previously on the reservation — create the Profile and
        // link it as an accompanying guest directly (never the destructive
        // deleteMany+recreate replace path on PUT /api/reservations/[id]).
        if (!slot.firstName) {
          throw new Error("Cannot create a profile — the submission has no name.");
        }
        const created = await tx.profile.create({
          data: {
            enterpriseId: (await tx.property.findUniqueOrThrow({ where: { id: reservation.propertyId }, select: { enterpriseId: true } })).enterpriseId,
            firstName: slot.firstName,
            middleName: slot.middleName,
            lastName: slot.lastName,
            dateOfBirth: slot.dateOfBirth,
            nationality: slot.nationality,
            gender: slot.gender,
            originPropertyId: reservation.propertyId,
            ...(slot.email && { communications: { create: [{ type: "EMAIL", value: slot.email, isPrimary: true }] } }),
            ...(slot.mobile && { communications: { create: [{ type: "MOBILE", value: slot.mobile, isPrimary: true }] } }),
            ...(slot.addressFull && {
              addresses: { create: [{ type: "HOME", fullAddress: slot.addressFull, city: slot.addressCity, country: slot.addressCountry, isPrimary: true }] },
            }),
            ...(slot.documentType &&
              slot.documentNumber && {
                documents: {
                  create: [
                    {
                      documentType: slot.documentType,
                      documentNumber: slot.documentNumber,
                      issuingCountry: slot.issuingCountry,
                      issueDate: slot.documentIssueDate,
                      expiryDate: slot.documentExpiryDate,
                      documentImageStoragePath: slot.idPhotoPath,
                      isPrimary: true,
                    },
                  ],
                },
              }),
          },
        });
        await tx.accompanyingGuest.create({ data: { reservationId: id, profileId: created.upid } });
        profileUpid = created.upid;
      } else {
        const profile = await tx.profile.findUniqueOrThrow({
          where: { upid: profileUpid },
          include: { communications: true, addresses: true },
        });

        if (fields.includes("personal")) {
          await tx.profile.update({
            where: { upid: profileUpid },
            data: {
              ...(slot.firstName && { firstName: slot.firstName }),
              ...(slot.middleName && { middleName: slot.middleName }),
              ...(slot.lastName && { lastName: slot.lastName }),
              ...(slot.dateOfBirth && { dateOfBirth: slot.dateOfBirth }),
              ...(slot.nationality && { nationality: slot.nationality }),
              ...(slot.gender && { gender: slot.gender }),
            },
          });
        }
        if (fields.includes("contact")) {
          if (slot.email && !profile.communications.some((c) => c.type === "EMAIL")) {
            await tx.profileCommunication.create({ data: { upid: profileUpid, type: "EMAIL", value: slot.email, isPrimary: true } });
          }
          if (slot.mobile && !profile.communications.some((c) => c.type === "MOBILE")) {
            await tx.profileCommunication.create({ data: { upid: profileUpid, type: "MOBILE", value: slot.mobile, isPrimary: true } });
          }
        }
        if (fields.includes("address") && slot.addressFull && profile.addresses.length === 0) {
          await tx.profileAddress.create({
            data: { upid: profileUpid, type: "HOME", fullAddress: slot.addressFull, city: slot.addressCity, country: slot.addressCountry, isPrimary: true },
          });
        }
        if (fields.includes("document") && slot.documentType && slot.documentNumber) {
          // Upsert, not create — a returning guest re-submitting the same passport would
          // otherwise throw on the existing @@unique([upid, documentType, documentNumber]).
          await tx.profileDocument.upsert({
            where: { upid_documentType_documentNumber: { upid: profileUpid, documentType: slot.documentType, documentNumber: slot.documentNumber } },
            update: {
              issuingCountry: slot.issuingCountry,
              issueDate: slot.documentIssueDate,
              expiryDate: slot.documentExpiryDate,
              documentImageStoragePath: slot.idPhotoPath,
            },
            create: {
              upid: profileUpid,
              documentType: slot.documentType,
              documentNumber: slot.documentNumber,
              issuingCountry: slot.issuingCountry,
              issueDate: slot.documentIssueDate,
              expiryDate: slot.documentExpiryDate,
              documentImageStoragePath: slot.idPhotoPath,
              isPrimary: true,
            },
          });
        }
      }

      return tx.eRegistrationGuestSlot.update({
        where: { id: slotId },
        data: { status: "APPLIED", appliedAt: new Date(), appliedByUserId: ctx.userId, existingProfileId: profileUpid },
      });
    });

    const profile = await prisma.profile.findUnique({ where: { upid: profileUpid! }, select: { firstName: true, lastName: true } });
    await logActivity({
      ctx,
      module: "RESERVATIONS",
      action: "EREGISTRATION_APPLY",
      entityType: "Reservation",
      entityId: id,
      description: `Applied eRegistration submission${profile ? ` for ${fullName(profile)}` : ""} to ${reservation.confirmationNo}`,
    });

    return NextResponse.json({ slot: result, profileUpid });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
