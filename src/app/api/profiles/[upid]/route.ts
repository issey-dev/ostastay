import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ProfileType, ProfileClassification } from "@/lib/enums";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";

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
    const { upid } = await params;

    const profile = await prisma.profile.findUnique({
      where: { upid },
      include: {
        contacts: true,
        documents: true,
        preferences: true,
      }
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

    const updatedProfile = await prisma.profile.update({
      where: { upid },
      data: {
        profileType: body.profileType as ProfileType,
        title: body.title,
        firstName: body.firstName || "",
        lastName: body.lastName,
        companyName: body.companyName,
        classification: body.classification as ProfileClassification,
        preferredLanguage: body.preferredLanguage,
        dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
        anniversaryDate: body.anniversaryDate ? new Date(body.anniversaryDate) : null,
        loyaltyTier: body.loyaltyTier,
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
        contacts: {
          deleteMany: {},
          create: body.contacts ? body.contacts.map((c: any) => ({
            contactType: c.contactType || "PRIMARY",
            firstName: c.firstName,
            lastName: c.lastName,
            mobile: c.mobile,
            workPhone: c.workPhone,
            email: c.email,
            address: c.address,
            city: c.city,
            stateProvince: c.stateProvince,
            postalCode: c.postalCode,
            country: c.country,
            isPrimary: c.isPrimary !== undefined ? c.isPrimary : true
          })) : [{
            contactType: "PRIMARY",
            mobile: body.mobile,
            email: body.email,
            country: body.country,
            address: body.address || body.addressStreet,
            city: body.city || body.addressCity,
            stateProvince: body.stateProvince || body.addressState,
            postalCode: body.postalCode || body.addressZip,
            workPhone: body.workPhone,
            isPrimary: true
          }]
        },
        ...(body.preferences && {
          preferences: {
            deleteMany: {},
            create: body.preferences.map((p: any) => ({
              category: p.category,
              value: p.value,
              notes: p.notes
            }))
          }
        }),
        ...(body.documentType && body.documentNumber ? {
          documents: {
            deleteMany: {}, // For MVP, we replace all documents with the primary one submitted
            create: {
              documentType: body.documentType,
              documentNumber: body.documentNumber,
              issuingCountry: body.issuingCountry,
              issueDate: body.issueDate ? new Date(body.issueDate) : null,
              expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
              isPrimary: true
            }
          }
        } : {})
      },
      include: {
        contacts: true,
        documents: true,
        preferences: true,
      }
    });

    return NextResponse.json(updatedProfile);
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

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
