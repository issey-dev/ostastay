import { SmtpNotConfiguredError, PlatformSmtpNotConfiguredError } from "@/lib/mailer"
import { sendEnterpriseMail, type MailKind, type MailSender } from "@/lib/mail-sender"
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
  /** Which document this is — recorded on the EmailLog row so a bill can be itemised. */
  kind: MailKind
  /** Path + query of the print page to render, e.g. `/e/demo/dashboard/folios/abc/print?type=proforma`. */
  pdfPath: string
  pdfFilename: string
  /** The caller's own session cookie — forwarded to headless Chrome so the rendered
   *  page loads as the same authenticated user, not anonymously. */
  authToken: string
}): Promise<{ ok: true; sender: MailSender } | { ok: false; error: string; status: number }> {
  let pdfBuffer: Buffer
  try {
    pdfBuffer = await generateStationeryPdf(params.pdfPath, params.authToken)
  } catch (pdfError) {
    console.error("Failed to render stationery PDF:", pdfError)
    return { ok: false, error: "Failed to generate the PDF for this document.", status: 502 }
  }

  try {
    // Sender selection (own SMTP, or Uppsolut's if they bought the mail service) and the
    // EmailLog row both live in sendEnterpriseMail — nothing to decide here.
    const { sender } = await sendEnterpriseMail({
      enterpriseId: params.enterpriseId,
      kind: params.kind,
      to: params.to,
      subject: params.subject,
      html: params.html,
      attachments: [{ filename: params.pdfFilename, content: pdfBuffer, contentType: "application/pdf" }],
    })
    return { ok: true, sender }
  } catch (mailError) {
    if (mailError instanceof SmtpNotConfiguredError) {
      return { ok: false, error: mailError.message, status: 400 }
    }
    // Bought the mail service, but the deployment has no platform sender configured. That
    // is ours to fix, so it must not read as "go and configure your SMTP".
    if (mailError instanceof PlatformSmtpNotConfiguredError) {
      console.error("Platform SMTP is unconfigured but an enterprise relies on it:", mailError)
      return {
        ok: false,
        error: "Email is temporarily unavailable — Uppsolut has been notified. Please try again shortly.",
        status: 503,
      }
    }
    console.error("Failed to send stationery email:", mailError)
    return { ok: false, error: "Failed to send the email — check the SMTP settings and try again.", status: 502 }
  }
}
