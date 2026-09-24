// npm run docs:shots — capture the screenshots the Configuration guide shows, from the
// fictional Coral Bay Hotels enterprise (npm run docs:demo first). Local development only.
//
// Every shot is the MAIN CONTENT only — never the app's sidebar, header or footer — or an
// open dialog, saved as a compact WebP in public/docs/img/ and shown with <Shot name=…>.
//
// Needs the app running. DOCS_BASE_URL defaults to http://localhost:3000. Pass shot names
// (or name prefixes) to capture only some:
//   DOCS_BASE_URL=http://localhost:3002 npm run docs:shots
//   npm run docs:shots -- property-rooms
//
// Signing in: the demo admin has no usable password, so this mints a session the same way
// src/lib/auth.ts createSession does — a Session row plus a signed auth_token cookie — and
// revokes it when done. It refuses to run in production.
import { randomUUID } from "crypto";
import { mkdirSync } from "fs";
import puppeteer, { type Page } from "puppeteer";
import { prisma } from "../src/lib/db";
import { signToken } from "../src/lib/auth";
import { SHOTS } from "./docs-shots.config";

if (process.env.NODE_ENV === "production") {
  console.error("docs:shots is for local development only.");
  process.exit(1);
}

const BASE = (process.env.DOCS_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const OUT = "public/docs/img";
const ADMIN_EMAIL = "admin@coralbay.example.com";
const wanted = process.argv.slice(2);

/** Hide the app chrome and anything that moves, so a shot is the content and only that. */
const CLEANUP_CSS = `
  *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
  [data-sonner-toaster], nextjs-portal { display: none !important; }
`;

export type ShotContext = { page: Page; ids: { slug: string; resort: string; lodge: string } };

async function main() {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL }, include: { enterprise: true } });
  const props = await prisma.property.findMany({ where: { enterpriseId: user.enterpriseId }, select: { id: true, code: true } });
  const ids = {
    slug: user.enterprise.slug,
    resort: props.find((p) => p.code === "CBR")!.id,
    lodge: props.find((p) => p.code === "CBL")!.id,
  };

  const jti = randomUUID();
  await prisma.session.create({ data: { userId: user.id, jti, expiresAt: new Date(Date.now() + 3600_000) } });
  const token = await signToken(user.id, jti, 3600);

  mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    // A short viewport: the layouts are min-h-screen, so a tall one would pad every shot
    // with empty space. Content below the fold is still captured (captureBeyondViewport).
    await page.setViewport({ width: 1280, height: 640, deviceScaleFactor: 1 });
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
    await page.setCookie({ name: "auth_token", value: token, domain: new URL(BASE).hostname, path: "/", httpOnly: true });

    const shots = SHOTS.filter((s) => wanted.length === 0 || wanted.some((w) => s.name.startsWith(w)));
    for (const shot of shots) {
      const path = shot.path(ids);
      const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle0", timeout: 120_000 });
      if (!res || !res.ok()) throw new Error(`${shot.name}: ${path} answered ${res?.status() ?? "nothing"}`);
      await page.addStyleTag({ content: CLEANUP_CSS });
      // Client-loaded tables say "Loading…" until their data arrives.
      await page
        .waitForFunction(() => !/Loading/.test(document.querySelector("#main-content")?.textContent ?? ""), { timeout: 15_000 })
        .catch(() => console.warn(`  ${shot.name}: still loading after 15s`));
      // A dialog is capped at a share of the viewport height, so give dialogs room.
      await page.setViewport({ width: 1280, height: shot.dialog ? 1200 : 640, deviceScaleFactor: 1 });
      if (shot.before) await shot.before({ page, ids });
      await new Promise((r) => setTimeout(r, 400));

      const selector = shot.selector ?? (shot.dialog ? '[role="dialog"]' : "[data-docs-shot-content]");
      // The main content of the Hub and dashboard layouts is the block under the sticky
      // header inside #main-content; mark it so the default selector can find it.
      await page.evaluate(() => {
        const main = document.querySelector("#main-content");
        const content = main && Array.from(main.children).find((c) => c.classList.contains("flex-1"));
        content?.setAttribute("data-docs-shot-content", "");
      });
      const el = await page.waitForSelector(selector, { visible: true, timeout: 15_000 });
      if (!el) throw new Error(`${shot.name}: nothing matches ${selector}`);
      const box = await el.boundingBox();
      if (!box) throw new Error(`${shot.name}: ${selector} is not visible`);
      // Trim to where the content actually ends: a short page in a min-h-screen layout
      // would otherwise carry a band of empty background.
      const contentBottom = await el.evaluate((node) => {
        let bottom = 0;
        for (const d of Array.from(node.querySelectorAll("*"))) {
          const r = d.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) bottom = Math.max(bottom, r.bottom);
        }
        return bottom;
      });
      const natural = contentBottom > 0 ? Math.min(box.height, contentBottom - box.y + 24) : box.height;
      const height = Math.min(natural, shot.maxHeight ?? 1400);
      await page.screenshot({
        path: `${OUT}/${shot.name}.webp`,
        type: "webp",
        quality: 78,
        clip: { x: box.x, y: box.y, width: box.width, height },
        captureBeyondViewport: true,
      });
      console.log(`  ${shot.name}.webp  ${Math.round(box.width)}×${Math.round(height)}`);
    }
  } finally {
    await browser.close();
    await prisma.session.update({ where: { jti }, data: { revokedAt: new Date(), revokedReason: "LOGOUT" } }).catch(() => {});
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("docs:shots failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
