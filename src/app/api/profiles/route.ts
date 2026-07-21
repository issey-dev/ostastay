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
} as const;

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search"); // Used for global search
    const profileType = searchParams.get("profileType");

    const profiles = await prisma.profile.findMany({
      where: {
        enterpriseId: ctx.enterpriseId,
        profileType: profileType ? profileType : undefined,
        OR: search ? [
          { firstName: { contains: search } },
          { lastName: { contains: search } },
          { companyName: { contains: search } },
          { communications: { some: { value: { contains: search } } } },
          { addresses: { some: { fullAddress: { contains: search } } } },
        ] : undefined
      },
      include: {
        communications: true,
        addresses: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 50 // Limit results for dashboard
    });
    return NextResponse.json(profiles);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "PROFILES", "create");

    const body = await request.json();

    if (!body.firstName && !body.companyName) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Set once at creation from the client's active property context — a "first seen
    // at" breadcrumb only (Profile stays enterprise-wide, never re-scoped by this).
    let originPropertyId: string | null = null;
    if (body.originPropertyId) {
      const property = await prisma.property.findUnique({ where: { id: body.originPropertyId } });
      if (property && property.enterpriseId === ctx.enterpriseId) {
        originPropertyId = property.id;
      }
    }

    const newProfile = await prisma.profile.create({
      data: {
        enterpriseId: ctx.enterpriseId,
        profileType: body.profileType as ProfileType || ProfileType.GUEST,
        title: body.title,
        firstName: body.firstName || "",
        middleName: body.middleName || null,
        lastName: body.lastName,
        companyName: body.companyName,
        classification: body.classification as ProfileClassification || ProfileClassification.REGULAR,
        preferredLanguage: body.preferredLanguage || "en",
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
        isCreditAccount: body.isCreditAccount !== undefined ? body.isCreditAccount : false,
        originPropertyId,
        // Convenience initial rows on create only — ongoing management of these is via
        // their own dedicated endpoints (/communications, /addresses, /documents,
        // /preferences, /attachments), never a destructive replace-all from here.
        ...(Array.isArray(body.communications) && body.communications.length > 0 && {
          communications: {
            create: body.communications.map((c: { type: string; value: string; isPrimary?: boolean }) => ({
              type: c.type,
              value: c.value,
              isPrimary: !!c.isPrimary,
            })),
          },
        }),
        ...(Array.isArray(body.addresses) && body.addresses.length > 0 && {
          addresses: {
            create: body.addresses.map((a: { type: string; fullAddress: string; city?: string; stateProvince?: string; postalCode?: string; country?: string; isPrimary?: boolean }) => ({
              type: a.type,
              fullAddress: a.fullAddress || "",
              city: a.city,
              stateProvince: a.stateProvince,
              postalCode: a.postalCode,
              country: a.country,
              isPrimary: !!a.isPrimary,
            })),
          },
        }),
        ...(Array.isArray(body.documents) && body.documents.length > 0 && {
          documents: {
            create: body.documents.map((d: { documentType: string; documentNumber: string; issuingCountry?: string; expiryDate?: string; isPrimary?: boolean }) => ({
              documentType: d.documentType,
              documentNumber: d.documentNumber,
              issuingCountry: d.issuingCountry || null,
              expiryDate: d.expiryDate ? new Date(d.expiryDate) : null,
              isPrimary: !!d.isPrimary,
            })),
          },
        }),
      },
      include: PROFILE_CHILD_INCLUDE,
    });

    await logActivity({
      ctx,
      module: "PROFILES",
      action: "CREATE",
      entityType: "Profile",
      entityId: newProfile.upid,
      description: `Created ${(newProfile.profileType || "GUEST").toLowerCase().replace("_", " ")} profile ${newProfile.companyName || `${newProfile.firstName} ${newProfile.lastName ?? ""}`.trim()}`,
    });

    return NextResponse.json(newProfile, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
