import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError } from "@/lib/scope";
import { computeLicenseState } from "@/lib/license";

// The Osta console's Ctrl+K search (OstaCommandPalette): customer enterprises, their
// properties and licence invoices, matched on name / code / number. Deliberately not a
// customer's users: who works at a customer is not Osta's to browse (owner, 2026-11-07).
// Osta staff only, like every /api/osta route.
const TAKE = 6;

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    if (!ctx.isInternal) throw new ForbiddenError("Only Osta staff can search the console");
    requirePermission(ctx, "CONTROLS", "view");

    const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) return NextResponse.json({ enterprises: [], properties: [], invoices: [] });
    const has = { contains: q, mode: "insensitive" as const };
    const standard = { type: "STANDARD" };

    const [enterprises, properties, invoices] = await Promise.all([
      prisma.enterprise.findMany({
        where: { ...standard, OR: [{ name: has }, { slug: has }] },
        select: { id: true, name: true, slug: true, license: { select: { status: true, expiresAt: true, graceDays: true } } },
        orderBy: { name: "asc" },
        take: TAKE,
      }),
      prisma.property.findMany({
        where: { enterprise: standard, OR: [{ name: has }, { code: has }, { legalName: has }] },
        select: { id: true, name: true, code: true, status: true, enterprise: { select: { id: true, name: true } } },
        orderBy: { name: "asc" },
        take: TAKE,
      }),
      prisma.licenseInvoice.findMany({
        where: { OR: [{ invoiceNo: has }, { receiptNo: has }, { enterprise: { name: has } }] },
        select: { id: true, invoiceNo: true, status: true, amount: true, discountAmount: true, currency: true, dueAt: true, enterprise: { select: { id: true, name: true } } },
        orderBy: { issuedAt: "desc" },
        take: TAKE,
      }),
    ]);

    const now = new Date();
    return NextResponse.json({
      enterprises: enterprises.map((e) => ({ id: e.id, name: e.name, slug: e.slug, state: computeLicenseState(e.license, now).state })),
      properties: properties.map((p) => ({ id: p.id, name: p.name, code: p.code, status: p.status, enterpriseId: p.enterprise.id, enterpriseName: p.enterprise.name })),
      invoices: invoices.map((i) => ({
        id: i.id,
        invoiceNo: i.invoiceNo,
        status: i.status,
        overdue: i.status === "ISSUED" && !!i.dueAt && i.dueAt < now,
        amount: i.amount - i.discountAmount,
        currency: i.currency,
        enterpriseId: i.enterprise.id,
        enterpriseName: i.enterprise.name,
      })),
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
