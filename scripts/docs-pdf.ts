// npm run docs:pdf — build the downloadable PDF guides from the documentation portal itself,
// so a PDF can never drift from the pages (the old hand-made PDF did). One PDF per area of
// the portal (src/app/docs/nav.ts), written to public/docs/ and served at the area's pdf.url.
//
// Needs the app running. DOCS_BASE_URL defaults to http://localhost:3000. Pass area keys to
// build only some:
//   DOCS_BASE_URL=http://localhost:3002 npm run docs:pdf
//   npm run docs:pdf -- configuration
import { writeFileSync } from "fs";
import puppeteer from "puppeteer";
import { PDFDocument } from "pdf-lib";
import { DOC_AREAS, areaLinks } from "../src/app/docs/nav";

const BASE = (process.env.DOCS_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const wanted = process.argv.slice(2);

async function main() {
  const areas = DOC_AREAS.filter((a) => wanted.length === 0 || wanted.includes(a.key));
  if (areas.length === 0) throw new Error(`no such area: ${wanted.join(", ")} (have ${DOC_AREAS.map((a) => a.key).join(", ")})`);
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.emulateMediaType("print");
    for (const area of areas) {
      const title = `Uppsolut Stay — ${area.pdf.title}`;
      const merged = await PDFDocument.create();
      merged.setTitle(title);
      merged.setAuthor("Uppsolut Stay");
      console.log(`${area.title}:`);
      for (const { href } of areaLinks(area)) {
        const res = await page.goto(`${BASE}${href}`, { waitUntil: "networkidle0", timeout: 120_000 });
        if (!res || !res.ok()) throw new Error(`${href}: HTTP ${res?.status() ?? "no response"}`);
        // Screenshots are lazy-loaded on screen; a PDF needs every one of them in place.
        await page.evaluate(async () => {
          const imgs = Array.from(document.images);
          imgs.forEach((img) => (img.loading = "eager"));
          await Promise.all(imgs.map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
        });
        const pdf = await page.pdf({
          format: "A4",
          printBackground: true,
          margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
          displayHeaderFooter: true,
          headerTemplate: "<span></span>",
          footerTemplate:
            '<div style="width:100%;font-size:8px;color:#666;padding:0 16mm;display:flex;justify-content:space-between">' +
            `<span>${title}</span><span><span class="pageNumber"></span></span></div>`,
        });
        const doc = await PDFDocument.load(pdf);
        for (const p of await merged.copyPages(doc, doc.getPageIndices())) merged.addPage(p);
        console.log(`  ${href} — ${doc.getPageCount()} page(s)`);
      }
      const out = `public${area.pdf.url}`;
      writeFileSync(out, await merged.save());
      console.log(`docs:pdf — wrote ${out} (${merged.getPageCount()} pages)`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("docs:pdf failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
