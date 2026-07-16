import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ProfileType, ProfileClassification } from "@/lib/enums";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId");
  const search = searchParams.get("search"); // Used for global search
  const profileType = searchParams.get("profileType");

  try {
    const profiles = await prisma.profile.findMany({
      where: {
        enterpriseId: enterpriseId ? enterpriseId : undefined,
        profileType: profileType ? profileType : undefined,
        OR: search ? [
          { firstName: { contains: search } },
          { lastName: { contains: search } },
          { companyName: { contains: search } },
        ] : undefined
      },
      include: {
        contacts: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 50 // Limit results for dashboard
    });
    return NextResponse.json(profiles);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch profiles" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    if (!body.enterpriseId || (!body.firstName && !body.companyName)) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const newProfile = await prisma.profile.create({
      data: {
        enterpriseId: body.enterpriseId,
        profileType: body.profileType as ProfileType || ProfileType.GUEST,
        title: body.title,
        firstName: body.firstName || "",
        lastName: body.lastName,
        companyName: body.companyName,
        classification: body.classification as ProfileClassification || ProfileClassification.REGULAR,
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
            create: body.preferences.map((p: any) => ({
              category: p.category,
              value: p.value,
              notes: p.notes
            }))
          }
        }),
        ...(body.documentType && body.documentNumber ? {
          documents: {
            create: {
              documentType: body.documentType,
              documentNumber: body.documentNumber,
              issuingCountry: body.issuingCountry,
              issueDate: body.issueDate ? new Date(body.issueDate) : null,
              expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
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
    
    return NextResponse.json(newProfile, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to create profile" }, { status: 500 });
  }
}
