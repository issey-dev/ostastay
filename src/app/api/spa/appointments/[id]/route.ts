import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "SPA", "view");

    const { id } = await params;
    const appointment = await prisma.spaAppointment.findUnique({
      where: { id },
      include: {
        treatment: { select: { id: true, name: true, category: { select: { id: true, name: true } } } },
        room: { select: { id: true, name: true } },
        folio: { select: { id: true, isClosed: true } },
        folioLineItem: { select: { id: true, amount: true, taxAmount: true, serviceChargeAmount: true, isVoid: true } },
        participants: {
          include: {
            reservation: { include: { primaryGuest: true, assignments: { include: { room: true } } } },
            therapist: { select: { id: true, displayName: true } },
          },
          orderBy: { participantIndex: "asc" },
        },
      },
    });
    if (!appointment) {
      return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
    }
    await assertPropertyModuleAccess(ctx, appointment.propertyId, "SPA");

    return NextResponse.json(appointment);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
