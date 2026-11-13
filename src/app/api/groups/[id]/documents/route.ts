import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { buildGroupStatementPdf } from "@/lib/groups/group-statement-pdf";
import { sendEnterpriseMail, MAIL_KINDS } from "@/lib/mail-sender";
import { logActivity } from "@/lib/activity-log";

// Send documents for a group (Agent Portal plan §7, Phase 8). GET downloads the group
// statement PDF (master folio + every pickup folio + the total). POST { email, message? }
// emails it. Reading needs CASHIERING view; sending needs CASHIERING update.
async function load(id: string) {
  return prisma.groupBlock.findUnique({ where: { id }, select: { propertyId: true, code: true, property: { select: { enterpriseId: true } } } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "view");
    const { id } = await params;
    const b = await load(id);
    if (!b) return NextResponse.json({ error: "Group not found" }, { status: 404 });
    await assertPropertyAccess(ctx, b.propertyId);
    const { pdf, filename } = await buildGroupStatementPdf(id);
    return new NextResponse(Buffer.from(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "update");
    const { id } = await params;
    const b = await load(id);
    if (!b) return NextResponse.json({ error: "Group not found" }, { status: 404 });
    await assertPropertyAccess(ctx, b.propertyId);
    const body = await request.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    const { pdf, filename, balance } = await buildGroupStatementPdf(id);
    const message = typeof body.message === "string" && body.message.trim() ? body.message.trim().slice(0, 2000) : "Please find the group's statement attached.";
    await sendEnterpriseMail({
      enterpriseId: b.property.enterpriseId,
      kind: MAIL_KINDS.DEBTOR_STATEMENT,
      to: email,
      subject: `Group ${b.code}: statement`,
      text: `${message}\n\nBalance due: ${balance.toFixed(2)}`,
      html: `<p>${message.replace(/</g, "&lt;")}</p><p>Balance due: <strong>${balance.toFixed(2)}</strong></p>`,
      attachments: [{ filename, content: Buffer.from(pdf), contentType: "application/pdf" }],
    });
    await logActivity({ ctx, module: "CASHIERING", action: "SEND", entityType: "GroupBlock", entityId: id, description: `Group ${b.code} statement emailed to ${email}` });
    return NextResponse.json({ sent: true, filename });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
