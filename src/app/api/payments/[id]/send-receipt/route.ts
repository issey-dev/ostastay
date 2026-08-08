import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { requireSession, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { sendStationeryEmail } from "@/lib/send-stationery-email";
import { generateStationeryPdf } from "@/lib/stationery-pdf";

const PAYMENT_INCLUDE = {
  folio: {
    include: {
      property: true,
    },
  },
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    const { id } = await params;
    const { email, slug } = await request.json();

    if (!email || !slug) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: PAYMENT_INCLUDE,
    });
    if (!payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, payment.folio.propertyId);

    const authToken = (await cookies()).get("auth_token")?.value;
    if (!authToken) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const html = `<p>Please find attached your payment receipt from ${payment.folio.property.name}.</p>`;

    const result = await sendStationeryEmail({
      enterpriseId: payment.folio.property.enterpriseId,
      to: email,
      subject: `Payment Receipt | ${payment.folio.property.name}`,
      html,
      pdfPath: `/e/${slug}/dashboard/payments/${id}/receipt`,
      pdfFilename: `Payment-Receipt-${payment.receiptNumber || payment.id}.pdf`,
      authToken,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    await logActivity({
      ctx,
      module: "CASHIERING",
      action: "SEND_RECEIPT",
      entityType: "Payment",
      entityId: payment.id,
      description: `Emailed payment receipt to ${email}`,
    });

    return NextResponse.json({ success: true, sentTo: email });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    const { id } = await params;
    const url = new URL(request.url);
    const slug = url.searchParams.get("slug");
    if (!slug) {
      return NextResponse.json({ error: "Missing slug" }, { status: 400 });
    }

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: PAYMENT_INCLUDE,
    });
    if (!payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, payment.folio.propertyId);

    const authToken = (await cookies()).get("auth_token")?.value;
    if (!authToken) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const pdfBuffer = await generateStationeryPdf(
      `/e/${slug}/dashboard/payments/${id}/receipt`,
      authToken
    );

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Payment-Receipt-${payment.receiptNumber || payment.id}.pdf"`,
      },
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
