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

type PdfOptions = Parameters<import("puppeteer").Page["pdf"]>[0]

/** Open `pathAndQuery` in headless Chrome as the calling user and print it to PDF. */
async function renderAuthenticatedPdf(
  pathAndQuery: string,
  authToken: string,
  pdfOptions: PdfOptions,
  // Refuse to print if the page navigated away (e.g. an expired session redirected to
  // sign-in) — otherwise the "PDF" is a picture of the login screen.
  opts: { requireSamePath?: boolean } = {}
): Promise<Buffer> {
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
    if (opts.requireSamePath && new URL(page.url()).pathname !== url.pathname) {
      throw new Error(`PDF source page redirected to ${new URL(page.url()).pathname}`)
    }
    const pdf = await page.pdf(pdfOptions)
    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}

/**
 * Renders a stationery page (given as a path + query string, e.g.
 * `/e/demo/dashboard/folios/abc/print?type=proforma`) to PDF bytes, authenticated as the
 * calling user via their existing session cookie.
 */
export async function generateStationeryPdf(pathAndQuery: string, authToken: string): Promise<Buffer> {
  return renderAuthenticatedPdf(pathAndQuery, authToken, {
    format: "A4",
    printBackground: true,
    margin: { top: "0", right: "0", bottom: "0", left: "0" },
  })
}

/**
 * Renders a report print page (`/e/<slug>/dashboard/reports/print?r=…`) to PDF. Unlike
 * stationery, a report runs to many pages, so the page margin is real and Chrome draws a
 * "Page X of Y" footer into it — the only way to number pages, which CSS alone cannot.
 */
export async function generateReportPdf(pathAndQuery: string, authToken: string, opts: { landscape: boolean; footerLabel: string }): Promise<Buffer> {
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)
  return renderAuthenticatedPdf(pathAndQuery, authToken, {
    format: "A4",
    landscape: opts.landscape,
    printBackground: true,
    margin: { top: "12mm", right: "12mm", bottom: "14mm", left: "12mm" },
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    // Chrome renders these templates at a tiny default scale with no page styles, so
    // every size and colour is inline. #A5A096 = --print-faint.
    footerTemplate: `<div style="width:100%;padding:0 12mm;font-family:Helvetica,Arial,sans-serif;font-size:7px;color:#A5A096;display:flex;justify-content:space-between;">
      <span>${esc(opts.footerLabel)}</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
    </div>`,
  }, { requireSamePath: true })
}
