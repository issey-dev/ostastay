import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertProfileAccess, toErrorResponse } from "@/lib/scope";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ upid: string }> }
) {
  try {
    const ctx = await requireSession();
    const { upid } = await params;
    await assertProfileAccess(ctx, upid);
    requirePermission(ctx, "PROFILES", "view");

    const documents = await prisma.profileDocument.findMany({
      where: { upid },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });
    return NextResponse.json(documents);
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
    if (!body.documentType || !body.documentNumber) {
      return NextResponse.json({ error: "Document type and number are required" }, { status: 400 });
    }

    // Consistent with Communications/Address: unspecified isPrimary defaults to false
    // (never auto-true), and demoting existing rows only happens when this one is
    // actually becoming primary.
    const isPrimary = !!body.isPrimary;
    if (isPrimary) {
      await prisma.profileDocument.updateMany({ where: { upid }, data: { isPrimary: false } });
    }

    const document = await prisma.profileDocument.create({
      data: {
        upid,
        documentType: body.documentType,
        documentNumber: body.documentNumber,
        issuingCountry: body.issuingCountry || null,
        expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
        isPrimary,
      },
    });
    return NextResponse.json(document, { status: 201 });
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "This document type + number already exists for this profile" }, { status: 400 });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
