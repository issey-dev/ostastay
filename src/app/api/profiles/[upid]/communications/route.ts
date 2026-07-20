import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertProfileAccess, toErrorResponse } from "@/lib/scope";
import { COMMUNICATION_TYPES, validateCommunicationValue } from "@/lib/profile-communications";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ upid: string }> }
) {
  try {
    const ctx = await requireSession();
    const { upid } = await params;
    await assertProfileAccess(ctx, upid);

    const communications = await prisma.profileCommunication.findMany({
      where: { upid },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });
    return NextResponse.json(communications);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ upid: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "PROFILES", "update");
    const { upid } = await params;
    await assertProfileAccess(ctx, upid);

    const body = await request.json();
    if (!body.type || !COMMUNICATION_TYPES.includes(body.type)) {
      return NextResponse.json({ error: `type must be one of ${COMMUNICATION_TYPES.join(", ")}` }, { status: 400 });
    }
    const validationError = validateCommunicationValue(body.type, body.value || "");
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    // At most one primary row per profile — promoting a new one demotes the rest.
    if (body.isPrimary) {
      await prisma.profileCommunication.updateMany({ where: { upid }, data: { isPrimary: false } });
    }

    const communication = await prisma.profileCommunication.create({
      data: { upid, type: body.type, value: body.value.trim(), isPrimary: !!body.isPrimary },
    });
    return NextResponse.json(communication, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
