import { prisma } from "@/lib/db"
import { sendMail, SmtpNotConfiguredError, type SmtpConfig } from "@/lib/mailer"
import { generateStationeryPdf } from "@/lib/stationery-pdf"

// Shared send path for every stationery "Email" button (Invoice, Payment Receipt,
// Exchange Receipt, Registration Card, Confirmation Letter, Debtor Statement) — looks
// up the tenant's SMTP settings, renders the same authenticated print page to PDF
// (src/lib/stationery-pdf.ts) and attaches it, and normalizes the error cases every
// route would otherwise duplicate (SMTP not configured, send failure, PDF render
// failure). Each caller only supplies the email body and which page to render.
export async function sendStationeryEmail(params: {
  enterpriseId: string
  to: string
  subject: string
  html: string
  /** Path + query of the print page to render, e.g. `/e/demo/dashboard/folios/abc/print?type=proforma`. */
  pdfPath: string
  pdfFilename: string
  /** The caller's own session cookie — forwarded to headless Chrome so the rendered
   *  page loads as the same authenticated user, not anonymously. */
  authToken: string
}): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const settings = await prisma.enterpriseSettings.findUnique({ where: { enterpriseId: params.enterpriseId } })
  const smtpConfig: SmtpConfig = settings ?? {
    smtpHost: null,
    smtpPort: null,
    smtpUsername: null,
    smtpPassword: null,
    smtpFromAddress: null,
    smtpUseTls: true,
  }

  let pdfBuffer: Buffer
  try {
    pdfBuffer = await generateStationeryPdf(params.pdfPath, params.authToken)
  } catch (pdfError) {
    console.error("Failed to render stationery PDF:", pdfError)
    return { ok: false, error: "Failed to generate the PDF for this document.", status: 502 }
  }

  try {
    await sendMail({
      settings: smtpConfig,
      to: params.to,
      subject: params.subject,
      html: params.html,
      attachments: [{ filename: params.pdfFilename, content: pdfBuffer, contentType: "application/pdf" }],
    })
  } catch (mailError) {
    if (mailError instanceof SmtpNotConfiguredError) {
      return { ok: false, error: mailError.message, status: 400 }
    }
    console.error("Failed to send stationery email:", mailError)
    return { ok: false, error: "Failed to send the email — check the SMTP settings and try again.", status: 502 }
  }

  return { ok: true }
}
