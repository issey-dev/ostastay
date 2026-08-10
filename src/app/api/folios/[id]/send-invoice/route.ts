import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { requireSession, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { sendStationeryEmail } from "@/lib/send-stationery-email";
import { MAIL_KINDS } from "@/lib/mail-sender";
import { generateStationeryPdf } from "@/lib/stationery-pdf";

// Same three variants the print page (src/app/e/[slug]/dashboard/folios/[id]/print)
// renders — kept in sync with its own documentTypeParam mapping.
const DOCUMENT_LABELS = {
  tax: "Tax Invoice",
  proforma: "Proforma Invoice",
  interim: "Interim Bill",
} as const;
type DocumentType = keyof typeof DOCUMENT_LABELS;

function parseDocumentType(value: string | null): DocumentType {
  return value === "proforma" ? "proforma" : value === "interim" ? "interim" : "tax";
}

async function loadFolio(id: string) {
  return prisma.folio.findUnique({
    where: { id },
    select: {
      id: true,
      propertyId: true,
      folioNumber: true,
      taxInvoiceNumber: true,
      proformaInvoiceNumber: true,
      property: {
        select: { name: true, enterpriseId: true, enterprise: { select: { slug: true } } },
      },
    },
  });
}

// The exact print page URL headless Chrome (or the browser, for a direct download)
// renders — must stay identical to what the print page itself constructs from its
// own `type`/`view`/`header` query params.
function buildPrintPath(slug: string, id: string, type: DocumentType, view: string | null, header: string | null) {
  const qs = new URLSearchParams({ type });
  if (view) qs.set("view", view);
  if (header) qs.set("header", header);
  return `/e/${slug}/dashboard/folios/${id}/print?${qs.toString()}`;
}

function documentNumberFor(folio: { taxInvoiceNumber: string | null; proformaInvoiceNumber: string | null; folioNumber: number }, type: DocumentType) {
  if (type === "tax") return folio.taxInvoiceNumber ?? String(folio.folioNumber);
  if (type === "proforma") return folio.proformaInvoiceNumber ?? String(folio.folioNumber);
  return String(folio.folioNumber);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    const { id } = await params;

    const body = await request.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    if (!email) {
      return NextResponse.json({ error: "An email address is required." }, { status: 400 });
    }
    const type = parseDocumentType(typeof body?.type === "string" ? body.type : null);
    const view = typeof body?.view === "string" ? body.view : null;
    const header = typeof body?.header === "string" ? body.header : null;

    const folio = await loadFolio(id);
    if (!folio) {
      return NextResponse.json({ error: "Folio not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, folio.propertyId);

    const authToken = (await cookies()).get("auth_token")?.value;
    if (!authToken) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const label = DOCUMENT_LABELS[type];
    const pdfPath = buildPrintPath(folio.property.enterprise.slug, id, type, view, header);
    const html = `<p>Please find attached your ${label} from ${folio.property.name}.</p>`;

    const result = await sendStationeryEmail({
      enterpriseId: folio.property.enterpriseId,
      kind: MAIL_KINDS.FOLIO_INVOICE,
      to: email,
      subject: `${label} — ${folio.property.name}`,
      html,
      pdfPath,
      pdfFilename: `${label.replace(/\s+/g, "-")}-${documentNumberFor(folio, type)}.pdf`,
      authToken,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    await logActivity({
      ctx,
      module: "CASHIERING",
      action: "SEND_INVOICE",
      entityType: "Folio",
      entityId: folio.id,
      description: `Emailed ${label} ${documentNumberFor(folio, type)} to ${email}`,
    });

    return NextResponse.json({ success: true, sentTo: email });
  } catch (error) {
    const { status, body: errBody } = toErrorResponse(error);
    return NextResponse.json(errBody, { status });
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    const { id } = await params;

    const url = new URL(request.url);
    const type = parseDocumentType(url.searchParams.get("type"));
    const view = url.searchParams.get("view");
    const header = url.searchParams.get("header");

    const folio = await loadFolio(id);
    if (!folio) {
      return NextResponse.json({ error: "Folio not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, folio.propertyId);

    const authToken = (await cookies()).get("auth_token")?.value;
    if (!authToken) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const pdfPath = buildPrintPath(folio.property.enterprise.slug, id, type, view, header);

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await generateStationeryPdf(pdfPath, authToken);
    } catch (pdfError) {
      console.error("Failed to render invoice PDF:", pdfError);
      return NextResponse.json({ error: "Failed to generate the PDF for this document." }, { status: 502 });
    }

    await logActivity({
      ctx,
      module: "CASHIERING",
      action: "DOWNLOAD_INVOICE",
      entityType: "Folio",
      entityId: folio.id,
      description: `Downloaded ${DOCUMENT_LABELS[type]} ${documentNumberFor(folio, type)} as PDF`,
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${DOCUMENT_LABELS[type].replace(/\s+/g, "-")}-${documentNumberFor(folio, type)}.pdf"`,
      },
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
