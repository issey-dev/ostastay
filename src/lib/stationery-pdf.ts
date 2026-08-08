import puppeteer from "puppeteer"

// Server-side PDF generation for stationery documents (Invoice, Receipts, Registration
// Card, Confirmation Letter, Statement) — reuses the exact same React/CSS rendering the
// on-screen print pages already use (headless Chrome navigates to the real, authenticated
// print URL) rather than re-implementing the branded layout in a separate PDF-drawing
// library. That keeps the on-screen preview, the printed page, and the downloaded/emailed
// PDF permanently in sync — one rendering path, not three.
//
// Exists because the OS print dialog's "Save as PDF" is not reliable across devices:
// iOS Safari's own print-to-PDF export ignores the `@page { margin: 0 }` trick that
// reliably suppresses the browser-injected URL/date/page-number footer on desktop
// Chrome. A PDF generated once here is byte-identical on every device, and doubles as
// the attachment when emailing a document to a guest.

const INTERNAL_APP_URL = process.env.INTERNAL_APP_URL || `http://127.0.0.1:${process.env.PORT || 3000}`
const SESSION_COOKIE_NAME = "auth_token"

/**
 * Renders a stationery page (given as a path + query string, e.g.
 * `/e/demo/dashboard/folios/abc/print?type=proforma`) to PDF bytes, authenticated as the
 * calling user via their existing session cookie.
 */
export async function generateStationeryPdf(pathAndQuery: string, authToken: string): Promise<Buffer> {
  const url = new URL(pathAndQuery, INTERNAL_APP_URL)

  const browser = await puppeteer.launch({
    headless: true,
    // Containers rarely have the kernel namespace permissions Chrome's sandbox wants,
    // regardless of the process's UID. Safe here — we only ever navigate to our own
    // trusted, server-rendered URLs, never third-party or user-supplied ones.
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })
  try {
    const page = await browser.newPage()
    await page.setCookie({
      name: SESSION_COOKIE_NAME,
      value: authToken,
      domain: url.hostname,
      path: "/",
    })
    await page.goto(url.toString(), { waitUntil: "networkidle0", timeout: 30_000 })
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    })
    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}
