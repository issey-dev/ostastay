import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";

// Qualified therapists for ONE treatment, for the booking screen's "request someone
// specific" picker — distinct from GET /api/spa/therapists (every therapist at the
// property, for Controls management, no qualification filter). Not availability-
// filtered here (no date/time is known yet in the therapist-first flow this feeds);
// GET .../availability is what actually checks a specific day/time against whichever
// therapist ends up requested.
//
// `profileId` (optional) surfaces that guest's remembered therapist for THIS property
// (SpaGuestTherapistPreference) as `isPreferredForGuest`, so the UI can pin/star it —
// only if that therapist still qualifies for this treatment; a stale preference for a
// treatment they no longer do simply doesn't show up as preferred.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "SPA", "view");

    const { id: treatmentId } = await params;
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    const profileId = searchParams.get("profileId");
    if (!propertyId) {
      return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    }

    const treatment = await prisma.spaTreatment.findUnique({ where: { id: treatmentId } });
    if (!treatment || treatment.propertyId !== propertyId) {
      return NextResponse.json({ error: "Treatment not found at this property" }, { status: 404 });
    }
    await assertPropertyModuleAccess(ctx, propertyId, "SPA");

    const [qualified, preference] = await Promise.all([
      prisma.spaTherapistTreatment.findMany({
        where: { treatmentId, qualified: true, therapist: { propertyId, isActive: true, bookable: true } },
        select: { preferred: true, therapist: { select: { id: true, displayName: true, gender: true } } },
        orderBy: { therapist: { displayOrder: "asc" } },
      }),
      profileId
        ? prisma.spaGuestTherapistPreference.findUnique({ where: { profileId_propertyId: { profileId, propertyId } } })
        : null,
    ]);

    const therapists = qualified.map((q) => ({
      id: q.therapist.id,
      displayName: q.therapist.displayName,
      gender: q.therapist.gender,
      preferred: q.preferred,
      isPreferredForGuest: preference?.therapistId === q.therapist.id,
    }));

    return NextResponse.json(therapists);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
