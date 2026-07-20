import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertProfileAccess, toErrorResponse } from "@/lib/scope";
import { COMMUNICATION_TYPES, validateCommunicationValue } from "@/lib/profile-communications";

async function loadOwnRow(upid: string, id: string) {
  const row = await prisma.profileCommunication.findUnique({ where: { id } });
  if (!row || row.upid !== upid) return null;
  return row;
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ upid: string; id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "PROFILES", "update");
    const { upid, id } = await params;
    await assertProfileAccess(ctx, upid);

    const existing = await loadOwnRow(upid, id);
    if (!existing) {
      return NextResponse.json({ error: "Communication not found" }, { status: 404 });
    }

    const body = await request.json();
    const type = body.type ?? existing.type;
    if (!COMMUNICATION_TYPES.includes(type)) {
      return NextResponse.json({ error: `type must be one of ${COMMUNICATION_TYPES.join(", ")}` }, { status: 400 });
    }
    const value = body.value !== undefined ? body.value : existing.value;
    const validationError = validateCommunicationValue(type, value);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const makingPrimary = body.isPrimary === true && !existing.isPrimary;
    if (makingPrimary) {
      await prisma.profileCommunication.updateMany({ where: { upid }, data: { isPrimary: false } });
    }

    const updated = await prisma.profileCommunication.update({
      where: { id },
      data: {
        type,
        value: typeof value === "string" ? value.trim() : value,
        isPrimary: body.isPrimary !== undefined ? !!body.isPrimary : existing.isPrimary,
      },
    });
    return NextResponse.json(updated);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ upid: string; id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "PROFILES", "update");
    const { upid, id } = await params;
    await assertProfileAccess(ctx, upid);

    const existing = await loadOwnRow(upid, id);
    if (!existing) {
      return NextResponse.json({ error: "Communication not found" }, { status: 404 });
    }

    await prisma.profileCommunication.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
