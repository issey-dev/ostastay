import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// Full replacement of a therapist's treatment-qualification set — same "whole set,
// not incremental" convention as SpaTreatment.rates. The booking engine's candidate
// list (SPA_PLAN.md §7) reads SpaTherapistTreatment.qualified directly, so this is
// the single place that list is edited.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "update");

    const { id } = await params;
    const body = await request.json();
    if (!Array.isArray(body.skills)) {
      return NextResponse.json({ error: "skills must be an array" }, { status: 400 });
    }

    const therapist = await prisma.spaTherapist.findUnique({ where: { id } });
    if (!therapist) {
      return NextResponse.json({ error: "Therapist not found" }, { status: 404 });
    }
    await assertPropertyModuleAccess(ctx, therapist.propertyId, "SPA");

    const treatmentIds: string[] = body.skills.map((s: { treatmentId?: string }) => s.treatmentId).filter(Boolean);
    if (treatmentIds.length > 0) {
      const validTreatments = await prisma.spaTreatment.count({
        where: { id: { in: treatmentIds }, propertyId: therapist.propertyId },
      });
      if (validTreatments !== new Set(treatmentIds).size) {
        return NextResponse.json({ error: "One or more treatments do not belong to this property" }, { status: 400 });
      }
    }

    await prisma.$transaction([
      prisma.spaTherapistTreatment.deleteMany({ where: { therapistId: id } }),
      prisma.spaTherapistTreatment.createMany({
        data: body.skills.map((s: { treatmentId: string; qualified?: boolean; preferred?: boolean; customDurationMinutes?: number; notes?: string }) => ({
          therapistId: id,
          treatmentId: s.treatmentId,
          qualified: s.qualified !== undefined ? !!s.qualified : true,
          preferred: s.preferred !== undefined ? !!s.preferred : false,
          customDurationMinutes: s.customDurationMinutes ? parseInt(String(s.customDurationMinutes)) : null,
          notes: s.notes || null,
        })),
      }),
    ]);

    const updated = await prisma.spaTherapist.findUnique({
      where: { id },
      include: { skills: { include: { treatment: { select: { id: true, name: true } } } } },
    });

    await logActivity({
      ctx, module: "CONTROLS", action: "UPDATE", entityType: "SpaTherapist", entityId: id,
      description: `Updated treatment qualifications for spa therapist "${therapist.displayName}"`,
    });

    return NextResponse.json(updated);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
