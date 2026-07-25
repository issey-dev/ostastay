import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ProfileType, ProfileClassification } from "@/lib/enums";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

const PROFILE_CHILD_INCLUDE = {
  communications: true,
  addresses: true,
  documents: true,
  preferences: true,
  attachments: true,
  notes: { orderBy: [{ isPinned: "desc" as const }, { createdAt: "desc" as const }] },
  originProperty: { select: { id: true, name: true } },
};

async function assertProfileAccess(upid: string, enterpriseId: string) {
  const profile = await prisma.profile.findUnique({ where: { upid } });
  if (!profile || profile.enterpriseId !== enterpriseId) {
    return null;
  }
  return profile;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ upid: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "PROFILES", "view");
    const { upid } = await params;

    const profile = await prisma.profile.findUnique({
      where: { upid },
      include: PROFILE_CHILD_INCLUDE,
    });

    if (!profile || profile.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    return NextResponse.json(profile);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ upid: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "PROFILES", "update");

    const { upid } = await params;
    const existing = await assertProfileAccess(upid, ctx.enterpriseId);
    if (!existing) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const body = await request.json();

    if (!body.firstName && !body.companyName) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Scalar fields only — Communications, Address, Identification, Preferences,
    // Attachments, and Notes are all managed via their own dedicated per-row CRUD
    // endpoints now, never a destructive replace-all from the main profile PUT.
    // originPropertyId is likewise untouched here: set once at creation, immutable.
    const updatedProfile = await prisma.profile.update({
      where: { upid },
      data: {
        profileType: body.profileType as ProfileType,
        title: body.title,
        firstName: body.firstName || "",
        middleName: body.middleName || null,
        lastName: body.lastName,
        companyName: body.companyName,
        classification: body.classification as ProfileClassification,
        preferredLanguage: body.preferredLanguage,
        dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
        nationality: body.nationality || null,
        anniversaryDate: body.anniversaryDate ? new Date(body.anniversaryDate) : null,
        vipLevel: body.vipLevel || null,
        photoUrl: body.photoUrl,
        iataNumber: body.iataNumber,
        commissionRate: body.commissionRate ? parseFloat(body.commissionRate) : null,
        greenTaxExempt: body.greenTaxExempt !== undefined ? body.greenTaxExempt : false,
        gender: body.gender,
        membershipNumber: body.membershipNumber,
        marketingOptIn: body.marketingOptIn !== undefined ? body.marketingOptIn : false,
        isIncognito: body.isIncognito !== undefined ? body.isIncognito : false,
        arNumber: body.arNumber || null,
        creditLimit: body.creditLimit ? parseFloat(body.creditLimit) : null,
        isCreditAccount: body.isCreditAccount !== undefined ? body.isCreditAccount : existing.isCreditAccount,
      },
      include: PROFILE_CHILD_INCLUDE,
    });

    await logActivity({
      ctx,
      module: "PROFILES",
      action: "UPDATE",
      entityType: "Profile",
      entityId: upid,
      description: `Updated profile ${updatedProfile.companyName || `${updatedProfile.firstName} ${updatedProfile.lastName ?? ""}`.trim()}`,
    });

    return NextResponse.json(updatedProfile);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

// Partial scalar update — touches ONLY the fields present in the body (unlike PUT, which
// is a full-scalar replace). Used by the check-in Identification step to fill in a guest's
// Date of Birth / Nationality without needing the whole profile payload.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ upid: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "PROFILES", "update");

    const { upid } = await params;
    const existing = await assertProfileAccess(upid, ctx.enterpriseId);
    if (!existing) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const body = await request.json();
    const data: { dateOfBirth?: Date | null; nationality?: string | null } = {};
    if (body.dateOfBirth !== undefined) data.dateOfBirth = body.dateOfBirth ? new Date(body.dateOfBirth) : null;
    if (body.nationality !== undefined) data.nationality = body.nationality || null;
    if (Object.keys(data).length === 0) {
      return NextResponse.json(existing);
    }

    const updated = await prisma.profile.update({ where: { upid }, data, include: PROFILE_CHILD_INCLUDE });
    await logActivity({
      ctx, module: "PROFILES", action: "UPDATE", entityType: "Profile", entityId: upid,
      description: `Updated ${Object.keys(data).join(", ")} for ${updated.companyName || `${updated.firstName} ${updated.lastName ?? ""}`.trim()}`,
    });
    return NextResponse.json(updated);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ upid: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "PROFILES", "delete");

    const { upid } = await params;
    const existing = await assertProfileAccess(upid, ctx.enterpriseId);
    if (!existing) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    // Check if the profile has any active reservations
    const reservations = await prisma.reservation.findFirst({
      where: { primaryGuestId: upid }
    });

    if (reservations) {
      return NextResponse.json(
        { error: "Cannot delete profile because there are reservations attached to it." },
        { status: 400 }
      );
    }

    await prisma.profile.delete({
      where: { upid },
    });

    await logActivity({
      ctx,
      module: "PROFILES",
      action: "DELETE",
      entityType: "Profile",
      entityId: upid,
      description: `Deleted profile ${existing.companyName || `${existing.firstName} ${existing.lastName ?? ""}`.trim()}`,
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
