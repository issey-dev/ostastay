import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { requireSession, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { sendStationeryEmail } from "@/lib/send-stationery-email";
import { MAIL_KINDS } from "@/lib/mail-sender";
import { generateStationeryPdf } from "@/lib/stationery-pdf";

const EXCHANGE_INCLUDE = {
  property: true,
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

    const exchange = await prisma.currencyExchange.findUnique({
      where: { id },
      include: EXCHANGE_INCLUDE,
    });
    if (!exchange) {
      return NextResponse.json({ error: "Currency exchange not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, exchange.propertyId);

    const authToken = (await cookies()).get("auth_token")?.value;
    if (!authToken) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const html = `<p>Please find attached your currency exchange receipt from ${exchange.property.name}.</p>`;

    const result = await sendStationeryEmail({
      enterpriseId: exchange.property.enterpriseId,
      kind: MAIL_KINDS.EXCHANGE_RECEIPT,
      to: email,
      subject: `Currency Exchange Receipt | ${exchange.property.name}`,
      html,
      pdfPath: `/e/${slug}/dashboard/cashiering/exchange/${id}/receipt`,
      pdfFilename: `Exchange-Receipt-${exchange.receiptNumber || exchange.id}.pdf`,
      authToken,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    await logActivity({
      ctx,
      module: "CASHIERING",
      action: "SEND_RECEIPT",
      entityType: "CurrencyExchange",
      entityId: exchange.id,
      description: `Emailed currency exchange receipt to ${email}`,
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

    const exchange = await prisma.currencyExchange.findUnique({
      where: { id },
      include: EXCHANGE_INCLUDE,
    });
    if (!exchange) {
      return NextResponse.json({ error: "Currency exchange not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, exchange.propertyId);

    const authToken = (await cookies()).get("auth_token")?.value;
    if (!authToken) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const pdfBuffer = await generateStationeryPdf(
      `/e/${slug}/dashboard/cashiering/exchange/${id}/receipt`,
      authToken
    );

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Exchange-Receipt-${exchange.receiptNumber || exchange.id}.pdf"`,
      },
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
