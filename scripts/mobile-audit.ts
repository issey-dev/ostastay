// npm run mobile:audit — capture the app at phone, tablet and desktop widths, and diff two
// captures pixel by pixel. The verification tool for the mobile polish work
// (.agents/docs/MOBILE_PLAN.md): every phase is checked at 360/390/430 + 768 and must leave
// desktop (1280/1440) unchanged. Local development only; needs the app running and the
// seeded demo data (npm run seed).
//
//   npm run mobile:audit -- capture --out .tmp/before --widths 1280,1440
//   npm run mobile:audit -- capture --out .tmp/after  --widths 360,390,430,768 --only dash-
//   npm run mobile:audit -- diff .tmp/before .tmp/after
//
// capture: one PNG per route per width (<out>/<width>/<name>.png, capped at 3000px tall)
// plus report.json with, per shot: page width (horizontal overflow), elements clipped past
// the right edge, and tap targets smaller than 40px. It signs in by minting a session for the
// demo admin (like docs:shots) and revokes it afterwards.
// diff: for every shot present in both folders, the share of pixels that changed, worst
// first, with a red-highlight diff image next to the "after" shot.
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import puppeteer, { type Page } from "puppeteer";
import { prisma } from "../src/lib/db";
import { signToken } from "../src/lib/auth";

if (process.env.NODE_ENV === "production") {
  console.error("mobile:audit is for local development only.");
  process.exit(1);
}

const BASE = (process.env.AUDIT_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const ADMIN_EMAIL = process.env.AUDIT_USER ?? "admin@veyo.mv";
const MAX_HEIGHT = 3000;

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

type Shot = { name: string; path: string; open?: string };

async function routes(): Promise<{ shots: Shot[]; userId: string; propertyId: string }> {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL }, include: { enterprise: true } });
  const slug = user.enterprise.slug;
  const prop = await prisma.property.findFirstOrThrow({ where: { enterpriseId: user.enterpriseId, status: "ACTIVE" }, orderBy: { name: "asc" } });
  const res =
    (await prisma.reservation.findFirst({ where: { propertyId: prop.id, status: "CHECKED_IN" } })) ??
    (await prisma.reservation.findFirst({ where: { propertyId: prop.id } }));
  const profile = await prisma.profile.findFirst({ where: { enterpriseId: user.enterpriseId, profileType: "GUEST" } });
  const group = await prisma.groupBlock.findFirst({ where: { propertyId: prop.id } });
  const debtor = await prisma.profile.findFirst({ where: { enterpriseId: user.enterpriseId, profileType: { in: ["COMPANY", "TRAVEL_AGENT"] } } });
  const d = `/e/${slug}/dashboard`;
  const h = `/e/${slug}/hub`;
  const p = `${h}/p/${prop.id}`;
  const shots: Shot[] = [
    { name: "dash-overview", path: `${d}/overview` },
    { name: "dash-front-office", path: `${d}/front-office` },
    { name: "dash-reservations", path: `${d}/reservations` },
    { name: "dash-reservation-new", path: `${d}/reservations/new` },
    { name: "dash-reservation-detail", path: `${d}/reservations/${res?.id}` },
    { name: "dash-tape-chart", path: `${d}/reservations/tape-chart` },
    { name: "dash-availability", path: `${d}/availability` },
    { name: "dash-groups", path: `${d}/groups` },
    { name: "dash-group-detail", path: `${d}/groups/${group?.id}` },
    { name: "dash-profiles", path: `${d}/profiles` },
    { name: "dash-profile-detail", path: `${d}/profiles/${profile?.upid}` },
    { name: "dash-profile-edit", path: `${d}/profiles/${profile?.upid}/edit` },
    { name: "dash-housekeeping", path: `${d}/housekeeping` },
    { name: "dash-maintenance", path: `${d}/maintenance` },
    { name: "dash-cashiering", path: `${d}/cashiering` },
    { name: "dash-pos", path: `${d}/pos` },
    { name: "dash-debtors", path: `${d}/debtors` },
    { name: "dash-debtor-detail", path: `${d}/debtors/${debtor?.upid}` },
    { name: "dash-night-audit", path: `${d}/financials/night-audit` },
    { name: "dash-reports", path: `${d}/reports` },
    { name: "dash-revenue", path: `${d}/revenue` },
    { name: "dash-revenue-calendar", path: `${d}/revenue/calendar` },
    { name: "dash-spa", path: `${d}/spa` },
    { name: "dash-excursions", path: `${d}/excursions` },
    { name: "dash-activity-log", path: `${d}/activity-log` },
    { name: "hub-overview", path: h },
    { name: "hub-ent-properties", path: `${h}/enterprise/properties` },
    { name: "hub-ent-people", path: `${h}/enterprise/people` },
    { name: "hub-ent-sessions", path: `${h}/enterprise/sessions` },
    { name: "hub-controls", path: p },
    { name: "hub-general", path: `${p}/general` },
    { name: "hub-inventory", path: `${p}/inventory` },
    { name: "hub-finance", path: `${p}/finance` },
    { name: "hub-charge-codes", path: `${p}/charge-codes` },
    { name: "hub-night-audit", path: `${p}/night-audit` },
    { name: "hub-stationery", path: `${p}/stationery` },
    // Dialogs: open the named button, capture the whole viewport (dialog + backdrop).
    { name: "dlg-team-member", path: `${h}/enterprise/people`, open: "Add Team Member" },
    { name: "dlg-charge-code", path: `${p}/charge-codes`, open: "Add Charge Code" },
    { name: "dlg-rate-plan", path: `${d}/revenue`, open: "New Rate Plan" },
    { name: "dlg-exchange", path: `${d}/cashiering`, open: "New Exchange" },
    { name: "dlg-report-issue", path: `${d}/maintenance`, open: "Report issue" },
  ].filter((s) => !s.path.includes("undefined"));
  return { shots, userId: user.id, propertyId: prop.id };
}

const CLEANUP_CSS = `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}nextjs-portal{display:none!important}`;

async function openButton(page: Page, text: string) {
  // Sections load after the page (skeleton loaders carry no "Loading" text), so wait for the
  // button to appear rather than trusting the page-level wait.
  const find = (text: string) =>
    Array.from(document.querySelectorAll<HTMLElement>("button")).find(
      (b) => b.offsetParent !== null && (b.innerText || "").trim().toLowerCase().startsWith(text.toLowerCase())
    );
  await page.waitForFunction(find, { timeout: 10_000 }, text).catch(() => {});
  const ok = await page.evaluate((text) => {
    const el = Array.from(document.querySelectorAll<HTMLElement>("button")).find(
      (b) => b.offsetParent !== null && (b.innerText || "").trim().toLowerCase().startsWith(text.toLowerCase())
    );
    el?.click();
    return !!el;
  }, text);
  if (!ok) throw new Error(`no button "${text}"`);
  await new Promise((r) => setTimeout(r, 600));
}

async function capture() {
  const out = flag("out");
  if (!out) throw new Error("--out <dir> is required");
  const widths = (flag("widths") ?? "360,390,430,768,1280,1440").split(",").map(Number);
  const only = flag("only");
  const { shots, userId, propertyId } = await routes();
  const selected = shots.filter((s) => !only || only.split(",").some((o) => s.name.startsWith(o)));

  const jti = randomUUID();
  await prisma.session.create({ data: { userId, jti, propertyId, expiresAt: new Date(Date.now() + 3600_000) } });
  const token = await signToken(userId, jti, 3600);
  const browser = await puppeteer.launch({ headless: true });
  const report: Record<string, unknown>[] = [];
  try {
    for (const width of widths) {
      const mobile = width < 768;
      mkdirSync(join(out, String(width)), { recursive: true });
      const page = await browser.newPage();
      await page.setViewport({ width, height: mobile ? 844 : 900, deviceScaleFactor: 1, isMobile: mobile, hasTouch: width < 1024 });
      if (width < 1024) {
        await page.setUserAgent(
          mobile
            ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
            : "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        );
      }
      await page.setCookie({ name: "auth_token", value: token, domain: new URL(BASE).hostname, path: "/", httpOnly: true });
      for (const s of selected) {
        try {
          const r = await page.goto(`${BASE}${s.path}`, { waitUntil: "networkidle0", timeout: 120_000 });
          await page.addStyleTag({ content: CLEANUP_CSS });
          await page
            .waitForFunction(() => !/\bLoading\b/.test(document.querySelector("#main-content")?.textContent ?? ""), { timeout: 10_000 })
            .catch(() => {});
          if (s.open) await openButton(page, s.open);
          await new Promise((res) => setTimeout(res, 500));
          const m = await page.evaluate((vw) => {
            const clipped: string[] = [];
            for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
              const rect = el.getBoundingClientRect();
              if (rect.width === 0 || rect.right <= vw + 1) continue;
              let p = el.parentElement;
              let reported = false;
              while (p && p !== document.body) {
                if (p.getBoundingClientRect().right > vw + 1) { reported = true; break; }
                const cs = getComputedStyle(p);
                if ((cs.overflowX === "auto" || cs.overflowX === "scroll") && p.scrollWidth > p.clientWidth) { reported = true; break; }
                p = p.parentElement;
              }
              if (!reported) clipped.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 70)} →${Math.round(rect.right)}`);
            }
            const small = Array.from(document.querySelectorAll<HTMLElement>("button, a[href], [role=tab], [role=button], [role=combobox], input:not([type=hidden]), select, textarea")).filter((e) => {
              const r = e.getBoundingClientRect();
              return r.width > 0 && r.height > 0 && (r.height < 40 || r.width < 40);
            }).length;
            return { pageWidth: document.documentElement.scrollWidth, clipped: clipped.slice(0, 10), smallTaps: small, height: document.documentElement.scrollHeight };
          }, width);
          const height = s.open ? (mobile ? 844 : 900) : Math.min(m.height, MAX_HEIGHT);
          await page.screenshot({ path: join(out, String(width), `${s.name}.png`) as `${string}.png`, captureBeyondViewport: !s.open, clip: { x: 0, y: 0, width, height } });
          report.push({ width, name: s.name, status: r?.status(), ...m });
          console.log(`${width} ${s.name.padEnd(24)} ${m.pageWidth > width + 1 ? `OVERFLOW ${m.pageWidth}` : "ok"} clipped=${m.clipped.length} small=${m.smallTaps}`);
        } catch (e) {
          report.push({ width, name: s.name, error: String(e).slice(0, 200) });
          console.log(`${width} ${s.name} ERROR ${String(e).slice(0, 120)}`);
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
    await prisma.session.update({ where: { jti }, data: { revokedAt: new Date(), revokedReason: "LOGOUT" } }).catch(() => {});
  }
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
}

async function diff() {
  const [a, b] = args.slice(1, 3);
  if (!a || !b) throw new Error("usage: diff <beforeDir> <afterDir>");
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const rows: { shot: string; changed: number; sizeChanged: boolean }[] = [];
  try {
    for (const width of readdirSync(a).filter((w) => existsSync(join(b, w)) && /^\d+$/.test(w))) {
      for (const file of readdirSync(join(a, width)).filter((f) => f.endsWith(".png") && !f.endsWith(".diff.png"))) {
        const after = join(b, width, file);
        if (!existsSync(after)) continue;
        const toUrl = (p: string) => `data:image/png;base64,${readFileSync(p).toString("base64")}`;
        const result = await page.evaluate(async (u1: string, u2: string) => {
          const load = (u: string) => new Promise<HTMLImageElement>((res) => { const i = new Image(); i.onload = () => res(i); i.src = u; });
          const [i1, i2] = await Promise.all([load(u1), load(u2)]);
          const w = Math.max(i1.width, i2.width), h = Math.max(i1.height, i2.height);
          const draw = (i: HTMLImageElement) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d")!; x.drawImage(i, 0, 0); return x.getImageData(0, 0, w, h); };
          const d1 = draw(i1), d2 = draw(i2);
          const out = document.createElement("canvas"); out.width = w; out.height = h;
          const ox = out.getContext("2d")!; ox.drawImage(i2, 0, 0); ox.fillStyle = "rgba(255,255,255,0.7)"; ox.fillRect(0, 0, w, h);
          const od = ox.getImageData(0, 0, w, h);
          let changed = 0;
          for (let k = 0; k < d1.data.length; k += 4) {
            const delta = Math.abs(d1.data[k] - d2.data[k]) + Math.abs(d1.data[k + 1] - d2.data[k + 1]) + Math.abs(d1.data[k + 2] - d2.data[k + 2]);
            if (delta > 30) { changed++; od.data[k] = 255; od.data[k + 1] = 0; od.data[k + 2] = 0; od.data[k + 3] = 255; }
          }
          ox.putImageData(od, 0, 0);
          return { changed: changed / (w * h), sizeChanged: i1.width !== i2.width || i1.height !== i2.height, png: out.toDataURL("image/png") };
        }, toUrl(join(a, width, file)), toUrl(after));
        if (result.changed > 0) writeFileSync(after.replace(/\.png$/, ".diff.png"), Buffer.from(result.png.split(",")[1], "base64"));
        rows.push({ shot: `${width}/${file}`, changed: result.changed, sizeChanged: result.sizeChanged });
      }
    }
  } finally {
    await browser.close();
  }
  rows.sort((x, y) => y.changed - x.changed);
  for (const r of rows) console.log(`${(r.changed * 100).toFixed(2).padStart(6)}%  ${r.sizeChanged ? "SIZE " : "     "}${r.shot}`);
  console.log(`mobile:audit diff — ${rows.filter((r) => r.changed > 0).length} of ${rows.length} shots differ.`);
}

const mode = args[0];
(mode === "diff" ? diff() : mode === "capture" ? capture() : Promise.reject(new Error("mode: capture | diff")))
  .catch((e) => {
    console.error("mobile:audit failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
