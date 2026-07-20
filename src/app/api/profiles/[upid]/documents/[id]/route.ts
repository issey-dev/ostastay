import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertProfileAccess, toErrorResponse } from "@/lib/scope";

async function loadOwnRow(upid: string, id: string) {
  const row = await prisma.profileDocument.findUnique({ where: { id } });
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
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const body = await request.json();
    const documentType = body.documentType ?? existing.documentType;
    const documentNumber = body.documentNumber ?? existing.documentNumber;
    if (!documentType || !documentNumber) {
      return NextResponse.json({ error: "Document type and number are required" }, { status: 400 });
    }

    const makingPrimary = body.isPrimary === true && !existing.isPrimary;
    if (makingPrimary) {
      await prisma.profileDocument.updateMany({ where: { upid }, data: { isPrimary: false } });
    }

    const updated = await prisma.profileDocument.update({
      where: { id },
      data: {
        documentType,
        documentNumber,
        issuingCountry: body.issuingCountry !== undefined ? body.issuingCountry : existing.issuingCountry,
        expiryDate: body.expiryDate !== undefined ? (body.expiryDate ? new Date(body.expiryDate) : null) : existing.expiryDate,
        isPrimary: body.isPrimary !== undefined ? !!body.isPrimary : existing.isPrimary,
      },
    });
    return NextResponse.json(updated);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "This document type + number already exists for this profile" }, { status: 400 });
    }
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
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    await prisma.profileDocument.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
