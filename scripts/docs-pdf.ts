// npm run docs:pdf — build the downloadable PDF guide from the documentation portal itself,
// so the PDF can never drift from the pages (the old hand-made PDF did).
//
// Needs the app running. DOCS_BASE_URL defaults to http://localhost:3000:
//   DOCS_BASE_URL=http://localhost:3002 npm run docs:pdf
// Writes public/docs/uppsolut-stay-booking-api-guide.pdf, served at PDF_URL.
import { writeFileSync } from "fs";
import puppeteer from "puppeteer";
import { PDFDocument } from "pdf-lib";
import { ALL_DOC_LINKS } from "../src/app/docs/nav";

const BASE = (process.env.DOCS_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const OUT = "public/docs/uppsolut-stay-booking-api-guide.pdf";
const PAGES = ["/docs", ...ALL_DOC_LINKS.map((l) => l.href)];

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  const merged = await PDFDocument.create();
  merged.setTitle("Uppsolut Stay — Booking API guide");
  merged.setAuthor("Uppsolut Stay");
  try {
    const page = await browser.newPage();
    await page.emulateMediaType("print");
    for (const path of PAGES) {
      const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle0", timeout: 120_000 });
      if (!res || !res.ok()) throw new Error(`${path}: HTTP ${res?.status() ?? "no response"}`);
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate:
          '<div style="width:100%;font-size:8px;color:#666;padding:0 16mm;display:flex;justify-content:space-between">' +
          "<span>Uppsolut Stay — Booking API guide</span><span><span class=\"pageNumber\"></span></span></div>",
      });
      const doc = await PDFDocument.load(pdf);
      for (const p of await merged.copyPages(doc, doc.getPageIndices())) merged.addPage(p);
      console.log(`  ${path} — ${doc.getPageCount()} page(s)`);
    }
  } finally {
    await browser.close();
  }
  writeFileSync(OUT, await merged.save());
  console.log(`docs:pdf — wrote ${OUT} (${merged.getPageCount()} pages)`);
}

main().catch((e) => {
  console.error("docs:pdf failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
