// Shared fixture for the browser click-through tests (npm run test:e2e).
//
// Everything happens inside ONE dedicated enterprise — slug "e2e", property code "E2E" —
// created here idempotently, so a run never disturbs the Veyo demo or the Coral Bay docs
// demo, and Night Audit only ever runs on this property. The property is provisioned the
// way the Osta console does it (src/app/api/osta/properties/create/route.ts, as
// scripts/docs-demo.ts provisionProperty ports it): Base Rate plan, the property's own
// chart of accounts with its Service Charge / GST generates, fee-rule wiring.
//
// Signing in: the e2e admin has an unusable password. A session is minted the way
// src/lib/auth.ts createSession does (a Session row + a signed auth_token cookie), as
// scripts/mobile-audit.ts and scripts/docs-shots.ts do.
//
// Local development only: refuses NODE_ENV=production and any base URL that isn't
// localhost.
import { randomBytes, randomUUID } from "crypto";
import { mkdirSync } from "fs";
import { join } from "path";
import bcrypt from "bcryptjs";
import puppeteer, { type Browser, type ElementHandle, type Page } from "puppeteer";
import { prisma } from "../../src/lib/db";
import { signToken } from "../../src/lib/auth";
import { goLiveDate } from "../../src/lib/business-date";
import { chartModulesFor, ensureChargeTree, ensureFeeRules } from "../../src/lib/posting/ensure-charge-tree";

export { prisma };

// ── Safety ─────────────────────────────────────────────────────────────────────────────
export const BASE_URL = (process.env.E2E_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

if (process.env.NODE_ENV === "production") {
  throw new Error("test:e2e is for local development only — refusing to run with NODE_ENV=production.");
}
if (!LOCAL_HOSTS.has(new URL(BASE_URL).hostname)) {
  throw new Error(`test:e2e only runs against a local app — E2E_BASE_URL is ${BASE_URL}.`);
}

export const E2E = {
  slug: "e2e",
  enterpriseName: "E2E Test Hotels",
  propertyCode: "E2E",
  propertyName: "E2E Test Hotel",
  adminEmail: "admin@e2e.example.com",
};

/** Screenshots of failing tests land here (gitignored). */
export const SHOT_DIR = ".tmp/e2e";

const DAY = 864e5;
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);

export type E2EFixture = {
  enterpriseId: string;
  slug: string;
  propertyId: string;
  adminUserId: string;
  roomTypes: Record<"STD" | "DLX", string>;
  ratePlanId: string; // BAR
  cashMethodId: string;
  businessDate: Date;
  /** /e/e2e/dashboard */
  dash: string;
};

async function findOrCreate<T>(find: () => Promise<T | null>, create: () => Promise<T>): Promise<T> {
  return (await find()) ?? (await create());
}

const ROOM_TYPES = [
  { code: "STD", name: "Standard Room", max: 3, base: 2, price: 150, rooms: ["101", "102", "103", "104", "105", "106"] },
  { code: "DLX", name: "Deluxe Room", max: 3, base: 2, price: 250, rooms: ["201", "202", "203", "204"] },
] as const;

/**
 * Create (or top up) the e2e enterprise and return its ids. Idempotent: re-running only
 * adds what is missing and extends prices to cover the next months from the CURRENT
 * business date (Night Audit moves it on every run).
 */
export async function ensureE2E(): Promise<E2EFixture> {
  const enterprise = await prisma.enterprise.upsert({
    where: { slug: E2E.slug },
    update: {},
    create: { name: E2E.enterpriseName, slug: E2E.slug, type: "STANDARD" },
  });
  await prisma.enterpriseLicense.upsert({
    where: { enterpriseId: enterprise.id },
    update: {},
    create: { enterpriseId: enterprise.id, maxProperties: 1 },
  });
  await prisma.enterpriseSettings.upsert({ where: { enterpriseId: enterprise.id }, update: {}, create: { enterpriseId: enterprise.id } });

  const adminRole = await prisma.role.findFirst({ where: { isSystem: true, name: "Admin", enterprise: { type: "INTERNAL" } } });
  if (!adminRole) throw new Error('System role "Admin" not found — run npm run seed first.');

  // ── Property, provisioned as the Osta console does ───────────────────────────────
  let property = await prisma.property.findUnique({ where: { code: E2E.propertyCode } });
  if (property && property.enterpriseId !== enterprise.id) {
    throw new Error(`Property code ${E2E.propertyCode} belongs to another enterprise — refusing to use it.`);
  }
  if (!property) {
    property = await prisma.property.create({
      data: {
        enterpriseId: enterprise.id,
        name: E2E.propertyName,
        code: E2E.propertyCode,
        legalName: "E2E Test Hotels Pvt Ltd",
        defaultCurrency: "USD",
        timeZone: "Indian/Maldives",
        checkInTime: "14:00",
        checkOutTime: "12:00",
        address: "Test Island, Maldives",
        contactPhone: "+960 000 0000",
        contactEmail: "frontdesk@e2e.example.com",
        status: "ACTIVE",
        businessDate: goLiveDate(undefined),
        reviewedAt: new Date(),
      },
    });
    await prisma.ratePlan.create({ data: { propertyId: property.id, code: "BASE", name: "Base Rate", priority: 999, isLocked: true } });
  }
  const P = property.id;

  // Payment methods first, so the chart seeding below links each to its charge code.
  for (const m of [
    { name: "Cash", type: "CASH" },
    { name: "Visa / Mastercard", type: "CARD" },
  ]) {
    await findOrCreate(
      () => prisma.paymentMethod.findFirst({ where: { propertyId: P, name: m.name } }),
      () => prisma.paymentMethod.create({ data: { enterpriseId: enterprise.id, propertyId: P, ...m } })
    );
  }
  // The full demo chart (revenue codes like 2004 Beverage), as the test helpers use.
  await ensureChargeTree(prisma, { propertyId: P }, await chartModulesFor(prisma, enterprise.id), { demo: true });
  await ensureFeeRules(prisma, { propertyId: P });
  const cash = await prisma.paymentMethod.findFirstOrThrow({ where: { propertyId: P, type: "CASH" } });

  // ── Admin (no usable password — sessions are minted) ─────────────────────────────
  const unusable = await bcrypt.hash(randomBytes(24).toString("hex"), 10);
  const admin = await prisma.user.upsert({
    where: { email: E2E.adminEmail },
    update: {},
    create: {
      enterpriseId: enterprise.id,
      email: E2E.adminEmail,
      passwordHash: unusable,
      firstName: "Eddie",
      lastName: "Tester",
      jobFunction: "MANAGEMENT",
      scope: "ENTERPRISE",
      roles: { create: { roleId: adminRole.id } },
    },
  });
  if (admin.enterpriseId !== enterprise.id) throw new Error(`${E2E.adminEmail} belongs to another enterprise.`);

  // ── Rooms ────────────────────────────────────────────────────────────────────────
  const roomTypes = {} as Record<"STD" | "DLX", string>;
  for (const t of ROOM_TYPES) {
    const rt = await findOrCreate(
      () => prisma.roomType.findFirst({ where: { propertyId: P, code: t.code } }),
      () => prisma.roomType.create({ data: { propertyId: P, code: t.code, name: t.name, maxOccupancy: t.max, baseOccupancy: t.base } })
    );
    roomTypes[t.code] = rt.id;
    for (const roomNumber of t.rooms) {
      await prisma.room.upsert({
        where: { propertyId_roomNumber: { propertyId: P, roomNumber } },
        update: {},
        create: { propertyId: P, roomTypeId: rt.id, roomNumber, status: "CLEAN" },
      });
    }
  }
  // ── Rates: BAR, priced from the business date for the next 180 days ─────────────
  const bar = await prisma.ratePlan.upsert({
    where: { propertyId_code: { propertyId: P, code: "BAR" } },
    update: {},
    create: { propertyId: P, code: "BAR", name: "Best Available Rate", priority: 10 },
  });
  const base = await prisma.ratePlan.findUniqueOrThrow({ where: { propertyId_code: { propertyId: P, code: "BASE" } } });
  const fresh = await prisma.property.findUniqueOrThrow({ where: { id: P } });
  const businessDate = fresh.businessDate ?? goLiveDate(undefined);
  const rows = [];
  for (const plan of [base, bar]) {
    for (const t of ROOM_TYPES) {
      for (let d = -7; d < 180; d++) {
        rows.push({
          ratePlanId: plan.id,
          roomTypeId: roomTypes[t.code],
          date: addDays(businessDate, d),
          price: t.price,
          extraAdultPrice: 40,
          extraChildPrice: 20,
        });
      }
    }
  }
  await prisma.priceCalendar.createMany({ data: rows, skipDuplicates: true });

  return {
    enterpriseId: enterprise.id,
    slug: E2E.slug,
    propertyId: P,
    adminUserId: admin.id,
    roomTypes,
    ratePlanId: bar.id,
    cashMethodId: cash.id,
    businessDate,
    dash: `/e/${E2E.slug}/dashboard`,
  };
}

/** The property's business date, read fresh (Night Audit moves it). */
export async function businessDate(propertyId: string): Promise<Date> {
  const p = await prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { businessDate: true } });
  return p.businessDate ?? goLiveDate(undefined);
}

// ── Sessions & API (arranging data only — never the action under test) ──────────────
export type AppSession = { token: string; jti: string };

export async function mintSession(fx: E2EFixture): Promise<AppSession> {
  const jti = randomUUID();
  await prisma.session.create({
    data: { userId: fx.adminUserId, jti, propertyId: fx.propertyId, expiresAt: new Date(Date.now() + 3 * 3600_000) },
  });
  return { token: await signToken(fx.adminUserId, jti, 3 * 3600), jti };
}

export async function revokeSession(s: AppSession | undefined) {
  if (!s) return;
  await prisma.session.updateMany({ where: { jti: s.jti, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function api<T = any>(s: AppSession, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: { Cookie: `auth_token=${s.token}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  return data as T;
}

let seq = 0;
/** A unique, searchable guest surname for this run. */
export function uniqueName(prefix: string) {
  seq += 1;
  return `${prefix}${Date.now().toString(36).slice(-5)}${seq}`.replace(/[0-9]/g, (d) => "abcdefghij"[Number(d)]);
}

export async function createGuest(s: AppSession, firstName: string, lastName: string): Promise<string> {
  const p = await api<{ upid: string }>(s, "/api/profiles", { body: { profileType: "GUEST", firstName, lastName, communications: [] } });
  return p.upid;
}

/** A room of the type that nothing live holds over [from, to). */
export async function freeRoom(fx: E2EFixture, roomTypeId: string, from: Date, to: Date): Promise<string> {
  const rooms = await prisma.room.findMany({ where: { propertyId: fx.propertyId, roomTypeId, status: { in: ["CLEAN", "INSPECTED"] } }, orderBy: { roomNumber: "asc" } });
  const busy = await prisma.roomAssignment.findMany({
    where: {
      roomId: { in: rooms.map((r) => r.id) },
      startDate: { lt: to },
      endDate: { gt: from },
      reservation: { status: { in: ["RESERVED", "IN_HOUSE"] } },
    },
    select: { roomId: true },
  });
  const taken = new Set(busy.map((b) => b.roomId));
  const room = rooms.find((r) => !taken.has(r.id));
  if (!room) throw new Error("No free e2e room — the e2e property is full; clear old in-house stays.");
  return room.id;
}

export async function createBooking(
  s: AppSession,
  fx: E2EFixture,
  opts: { guestUpid: string; from: Date; nights: number; type?: "STD" | "DLX"; withRoom?: boolean }
): Promise<{ id: string; confirmationNo: string }> {
  const roomTypeId = fx.roomTypes[opts.type ?? "STD"];
  const to = addDays(opts.from, opts.nights);
  const roomId = opts.withRoom === false ? null : await freeRoom(fx, roomTypeId, opts.from, to);
  return api(s, "/api/reservations", {
    body: {
      propertyId: fx.propertyId,
      primaryGuestId: opts.guestUpid,
      checkInDate: opts.from.toISOString(),
      checkOutDate: to.toISOString(),
      adults: 2,
      children: 0,
      infants: 0,
      mealPlan: "NONE",
      acknowledgeOverbook: true,
      assignments: [{ roomTypeId, roomId, ratePlanId: fx.ratePlanId, overrideRate: null, startDate: opts.from.toISOString(), endDate: to.toISOString() }],
    },
  });
}

export async function checkInViaApi(s: AppSession, reservationId: string, body: Record<string, unknown> = {}) {
  return api<{ folioId: string }>(s, `/api/reservations/${reservationId}/check-in`, { body });
}

/** What the guest owes across the stay's non-ledger folios. */
export async function balanceOf(reservationId: string): Promise<{ folioId: string; balance: number }> {
  const folios = await prisma.folio.findMany({
    where: { reservationId },
    orderBy: { folioNumber: "asc" },
    include: { lineItems: true, payments: true },
  });
  let balance = 0;
  for (const f of folios) {
    for (const i of f.lineItems) if (!i.isVoid) balance += i.amount + i.taxAmount + (i.serviceChargeAmount || 0);
    for (const p of f.payments) balance += p.isRefund ? p.amount : -p.amount;
  }
  return { folioId: folios[0]?.id, balance: Math.round(balance * 100) / 100 };
}

/** Pay whatever is owed and check the stay out (early if need be). */
export async function settleAndCheckOut(s: AppSession, fx: E2EFixture, reservationId: string) {
  const { folioId, balance } = await balanceOf(reservationId);
  if (balance > 0.005) await api(s, `/api/folios/${folioId}/payments`, { body: { paymentMethodId: fx.cashMethodId, amount: balance } });
  const res = await fetch(`${BASE_URL}/api/reservations/${reservationId}/check-out`, {
    method: "POST",
    headers: { Cookie: `auth_token=${s.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ early: false }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (data.earlyCheckoutRequired) await api(s, `/api/reservations/${reservationId}/check-out`, { body: { early: true } });
    else throw new Error(`check-out ${reservationId} → ${res.status}: ${JSON.stringify(data)}`);
  }
}

/**
 * Start a spec from an empty hotel: every in-house e2e stay is settled and checked out,
 * every open e2e booking cancelled. Leftovers of earlier (possibly failed) runs would
 * otherwise sell the rooms out and give End of Day departures and no-shows to stop on.
 * Specs run one file at a time (vitest.e2e.config.ts), so this never pulls a stay out
 * from under another spec.
 */
export async function resetStays(s: AppSession, fx: E2EFixture) {
  const inHouse = await prisma.reservation.findMany({ where: { propertyId: fx.propertyId, status: "IN_HOUSE" }, select: { id: true } });
  for (const r of inHouse) await settleAndCheckOut(s, fx, r.id);
  const open = await prisma.reservation.findMany({ where: { propertyId: fx.propertyId, status: "RESERVED" }, select: { id: true } });
  for (const r of open) await api(s, `/api/reservations/${r.id}/status`, { method: "PATCH", body: { status: "CANCELLED" } });
  // Checking out leaves rooms Dirty; nobody cleans the e2e hotel.
  await prisma.room.updateMany({ where: { propertyId: fx.propertyId, status: "DIRTY" }, data: { status: "CLEAN" } });
}

// ── Browser ────────────────────────────────────────────────────────────────────────────
export type E2EBrowser = { browser: Browser; page: Page; session: AppSession };

export async function openBrowser(fx: E2EFixture): Promise<E2EBrowser> {
  const session = await mintSession(fx);
  const browser = await puppeteer.launch({ headless: true, args: ["--window-size=1400,1000"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(120_000);
  await page.setCookie({ name: "auth_token", value: session.token, domain: new URL(BASE_URL).hostname, path: "/", httpOnly: true });
  return { browser, page, session };
}

export async function closeBrowser(b: E2EBrowser | undefined) {
  if (!b) return;
  await b.browser.close().catch(() => {});
  await revokeSession(b.session);
}

/** Run a test body; on failure save a full-page screenshot to .tmp/e2e/ and rethrow. */
export async function withShot(page: Page | undefined, name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    if (page) {
      mkdirSync(SHOT_DIR, { recursive: true });
      const file = join(SHOT_DIR, `${name.replace(/[^a-z0-9-]+/gi, "-")}-${Date.now()}.png`) as `${string}.png`;
      await page.screenshot({ path: file, fullPage: true }).catch(() => {});
      console.error(`  screenshot: ${file} (url ${page.url()})`);
    }
    throw e;
  }
}

export async function goto(page: Page, path: string) {
  const res = await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle2" });
  if (res && res.status() >= 400) throw new Error(`${path} answered ${res.status()}`);
}

type FindOpts = { within?: string; timeout?: number; enabled?: boolean };

/**
 * The first VISIBLE element matching `selector` whose text (or aria-label) matches — a
 * string matches as a prefix, ignoring case and extra whitespace. Waits for it.
 */
export async function findText(page: Page, selector: string, text: string | RegExp, opts: FindOpts = {}): Promise<ElementHandle<Element>> {
  const re = typeof text === "string" ? new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}`, "i") : text;
  try {
    const handle = await page.waitForFunction(
      (sel: string, src: string, flags: string, within: string | null, enabled: boolean) => {
        const rx = new RegExp(src, flags);
        const roots: ParentNode[] = within ? Array.from(document.querySelectorAll(within)) : [document];
        for (const root of roots) {
          for (const el of Array.from(root.querySelectorAll<HTMLElement>(sel))) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden") continue;
            if (enabled && ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true")) continue;
            const label = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").replace(/\s+/g, " ").trim();
            if (rx.test(label)) return el;
          }
        }
        return null;
      },
      { timeout: opts.timeout ?? 30_000, polling: 150 },
      selector,
      re.source,
      re.flags,
      opts.within ?? null,
      opts.enabled ?? true
    );
    return handle.asElement() as ElementHandle<Element>;
  } catch (e) {
    const seen = await page
      .evaluate((sel: string) => Array.from(document.querySelectorAll<HTMLElement>(sel)).filter((b) => b.offsetParent !== null).map((b) => (b.innerText || b.getAttribute("aria-label") || "?").replace(/\s+/g, " ").trim().slice(0, 40)).slice(0, 40).join(" | "), selector)
      .catch(() => "?");
    throw new Error(`No visible ${selector} matching ${re} (${(e as Error).message.split("\n")[0]}). Visible: ${seen}`);
  }
}

export async function click(page: Page, selector: string, text: string | RegExp, opts: FindOpts = {}) {
  const el = await findText(page, selector, text, opts);
  await el.click();
  return el;
}

export const clickButton = (page: Page, text: string | RegExp, opts: FindOpts = {}) => click(page, "button, [role=button], a", text, opts);

/** Wait until the page body shows `text`. */
export async function waitForText(page: Page, text: string | RegExp, opts: { within?: string; timeout?: number } = {}) {
  const re = typeof text === "string" ? new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : text;
  await page
    .waitForFunction(
      (src: string, flags: string, within: string) =>
        Array.from(document.querySelectorAll<HTMLElement>(within)).some((el) => new RegExp(src, flags).test((el.innerText || "").replace(/\s+/g, " "))),
      { timeout: opts.timeout ?? 30_000, polling: 150 },
      re.source,
      re.flags,
      opts.within ?? "body"
    )
    .catch((e) => {
      throw new Error(`Timed out waiting for text ${re}${opts.within ? ` in ${opts.within}` : ""}: ${(e as Error).message.split("\n")[0]}`);
    });
}

// Base UI toasts are role=dialog/alertdialog inside the toast viewport (role=region), so a
// modal dialog is any dialog NOT inside that region.
export const TOAST = "[role=region] [role=dialog], [role=region] [role=alertdialog]";
export const MODAL = "[role=dialog]:not([role=region] *), [role=alertdialog]:not([role=region] *)";

/** A toast showing `text`. */
export const waitForToast = (page: Page, text: string | RegExp, timeout = 30_000) => waitForText(page, text, { within: TOAST, timeout });

/** Open a SearchableSelect (its combobox trigger), type into its search box, pick the option. */
export async function pickSearchable(page: Page, trigger: ElementHandle<Element>, query: string, option: string | RegExp) {
  await trigger.click();
  await page.waitForSelector("[role=listbox]", { visible: true });
  // Short lists have no search box (SearchableSelect's threshold) — then just pick.
  const box = await page.$("[role=searchbox]");
  if (box) await box.type(query, { delay: 20 });
  await click(page, "[role=option]", option);
}

/**
 * The visible control (default: an input) in the same field box as the <label> with this
 * text — `<div><Label>Amount</Label><Input/></div>`, the layout every app form uses.
 */
export async function fieldAfterLabel(page: Page, label: string, opts: { within?: string; control?: string } = {}): Promise<ElementHandle<Element>> {
  const handle = await page.waitForFunction(
    (text: string, root: string, control: string) => {
      for (const scope of Array.from(document.querySelectorAll(root))) {
        for (const lab of Array.from(scope.querySelectorAll<HTMLElement>("label"))) {
          if (lab.offsetParent === null || !(lab.innerText || "").trim().toLowerCase().startsWith(text.toLowerCase())) continue;
          const box = lab.closest("div");
          const found = Array.from(box?.querySelectorAll<HTMLElement>(control) ?? []).find((i) => i.offsetParent !== null);
          if (found) return found;
        }
      }
      return null;
    },
    { timeout: 30_000, polling: 150 },
    label,
    opts.within ?? "body",
    opts.control ?? "input:not([type=hidden])"
  );
  return handle.asElement() as ElementHandle<Element>;
}

/** Replace an input's value by typing (select-all first). */
export async function retype(page: Page, input: ElementHandle<Element>, value: string) {
  await input.click({ count: 3 });
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await input.type(value, { delay: 15 });
}

/** Pick a day in an open react-day-picker calendar, paging forward a few months if needed. */
export async function pickCalendarDay(page: Page, day: Date) {
  const key = isoDay(day);
  for (let i = 0; i < 6; i++) {
    const btn = await page.$(`[data-day="${key}"]:not([data-outside]) button:not([disabled])`);
    if (btn) {
      await btn.click();
      return;
    }
    const next = await page.$('button[aria-label="Next month"]:not([disabled])');
    if (!next) break;
    await next.click();
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Day ${key} not pickable in the calendar`);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
