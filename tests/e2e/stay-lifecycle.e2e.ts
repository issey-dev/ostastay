// A stay end to end, the way the desk does it: book → check in → post a charge and settle
// the folio → check out. The steps build on each other (one reservation walks through),
// so they run in order inside one describe.
import type { ElementHandle } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addDays,
  clickButton,
  click,
  closeBrowser,
  ensureE2E,
  findText,
  goto,
  fieldAfterLabel,
  openBrowser,
  pickCalendarDay,
  pickSearchable,
  prisma,
  resetStays,
  sleep,
  uniqueName,
  waitForText,
  waitForToast,
  withShot,
  MODAL,
  type E2EBrowser,
  type E2EFixture,
} from "./fixtures";

describe("Stay lifecycle", () => {
  let fx: E2EFixture;
  let b: E2EBrowser;
  let reservationId = "";
  const first = "Erin";
  const last = uniqueName("Stay");

  beforeAll(async () => {
    fx = await ensureE2E();
    b = await openBrowser(fx);
    await resetStays(b.session, fx);
  });
  afterAll(async () => {
    await closeBrowser(b);
  });

  it("books a stay from the look-to-book grid with a quick-created guest", () =>
    withShot(b.page, "booking", async () => {
      const { page } = b;
      await goto(page, `${fx.dash}/reservations/new`);
      await waitForText(page, "1 · Stay");

      // Arrival defaults to the business date; pick Departure = business date + 2.
      await click(page, "button", /Pick a date/);
      await pickCalendarDay(page, addDays(fx.businessDate, 2));
      await waitForText(page, "2 Nights");

      // Room & rate: the BAR row, Standard Room column.
      const cell = await page.waitForFunction(
        () => {
          const table = Array.from(document.querySelectorAll("table")).find((t) => /Rate plan/.test(t.querySelector("thead")?.textContent ?? ""));
          if (!table) return null;
          const col = Array.from(table.querySelectorAll("thead th")).findIndex((th) => /Standard Room/.test(th.textContent ?? ""));
          const row = Array.from(table.querySelectorAll("tbody tr")).find((tr) => /Best Available Rate/.test(tr.textContent ?? ""));
          return col > 0 && row ? row.querySelectorAll("td")[col]?.querySelector("button") ?? null : null;
        },
        { timeout: 60_000 }
      );
      await (cell.asElement() as ElementHandle<Element>).click();
      await waitForText(page, "Standard Room (STD) · Best Available Rate");

      // Guest: search, nothing found → quick-create seeded from the search text.
      await click(page, "button", /^Select\.\.\./);
      const search = await page.waitForSelector(`input[placeholder^="Search by first name"]`, { visible: true });
      await search!.type(`${first} ${last}`, { delay: 15 });
      await waitForText(page, "No matching profiles found", { within: MODAL });
      await clickButton(page, /Can.t find them\? Quick-create/, { within: MODAL });
      const firstName = await fieldAfterLabel(page, "First name", { within: MODAL });
      expect(await firstName.evaluate((i) => (i as HTMLInputElement).value)).toBe(first);
      await clickButton(page, "Create & select", { within: MODAL });
      await page.waitForFunction((m) => !document.querySelector(m), {}, MODAL);
      await waitForText(page, `${first} ${last}`);

      await clickButton(page, "Book now");
      await page.waitForFunction(() => /\/reservations\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 60_000 });
      await waitForToast(page, /Booking \S+ created/);
      reservationId = page.url().split("/").pop()!;
      const saved = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId }, include: { primaryGuest: true } });
      expect(saved.status).toBe("RESERVED");
      expect(saved.primaryGuest.lastName).toBe(last);
    }));

  it("checks the guest in through the wizard", (ctx) => {
    if (!reservationId) ctx.skip(); // the booking step failed
    return withShot(b.page, "check-in", async () => {
      const { page } = b;
      await goto(page, `${fx.dash}/reservations/${reservationId}`);
      await clickButton(page, "Check in", { within: "aside" });
      await waitForText(page, "Check in —", { within: MODAL });

      // Room step: the booking has no room yet — pick one.
      const trigger = await findText(page, "[role=combobox]", /Select a room/);
      await pickSearchable(page, trigger, "10", /^Room 10\d/);
      await clickButton(page, "Next", { within: MODAL });
      // Identification (and a registration card step when the property has one).
      for (let i = 0; i < 4; i++) {
        const next = await findText(page, "button", /^(Continue|Next guest|Check in)$/, { within: MODAL });
        const label = (await next.evaluate((e) => (e as HTMLElement).innerText)).trim();
        if (label === "Check in") break;
        await next.click();
        await sleep(200);
      }
      await clickButton(page, /^Check in$/, { within: MODAL });
      await waitForToast(page, /Checked in|In-House/i);
      await waitForText(page, /In[- ]house/i, { within: "aside" });
      const saved = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });
      expect(saved.status).toBe("IN_HOUSE");
    });
  });

  it("posts a charge with the searchable picker, sees it rolled up, and settles the folio", (ctx) => {
    if (!reservationId) ctx.skip(); // the booking step failed
    return withShot(b.page, "folio", async () => {
      const { page } = b;
      await goto(page, `${fx.dash}/reservations/${reservationId}/folio`);
      await waitForText(page, "Post charge");

      const trigger = await findText(page, "[role=combobox]", /Select charge code/);
      await pickSearchable(page, trigger, "bevera", /^2004 · Beverage/);
      const amount = await page.waitForSelector('input[placeholder="Negative to reverse/adjust"]', { visible: true });
      await amount!.type("50");
      await clickButton(page, /^Post charge to folio/);
      await waitForToast(page, "Charge posted");

      // The amount is tax-inclusive: $50 = $38.85 base + 10% SC $3.89 + 17% GST (on base +
      // SC) $7.26 — and all three sit in ONE rolled-up ledger row.
      const row = await findText(page, "tbody tr", /Beverage/);
      const text = await row.evaluate((r) => (r as HTMLElement).innerText.replace(/\s+/g, " "));
      expect(text).toMatch(/\$38\.85.*\$3\.89.*\$7\.26.*\$50\.00/);
      const rowsBefore = await page.$$eval("tbody tr", (rs) => rs.length);
      const toggle = await row.$("button[aria-expanded]");
      expect(toggle, "the charge row should be a roll-up with an expand toggle").not.toBeNull();
      await toggle!.click();
      await waitForText(page, /Check \S+/, { within: "tbody" });
      const rowsAfter = await page.$$eval("tbody tr", (rs) => rs.length);
      expect(rowsAfter).toBeGreaterThanOrEqual(rowsBefore + 2); // the charge, its SC and its GST

      // Pay the balance in cash (the amount is pre-filled with what's owed).
      await click(page, "[role=tab]", "Post payment");
      // (The method trigger shows no "Select method" placeholder — see TODO.md.)
      const method = await fieldAfterLabel(page, "Payment method", { control: "button, [role=combobox]" });
      await method.click();
      await click(page, "[role=option]", /^Cash$/);
      const payAmount = await page.waitForSelector('input[inputmode="decimal"]', { visible: true });
      const owed = await payAmount!.evaluate((i) => (i as HTMLInputElement).value);
      expect(Number(owed)).toBe(50);
      await clickButton(page, /^Post payment to folio/);
      await waitForToast(page, "Payment posted");
      await waitForText(page, "$0.00");
    });
  });

  it("checks out from the folio once the balance is zero", (ctx) => {
    if (!reservationId) ctx.skip(); // the booking step failed
    return withShot(b.page, "check-out", async () => {
      const { page } = b;
      await clickButton(page, /^Check out$/);
      // Settled → a confirm; the stay isn't due out yet, so the early check-out confirm too.
      await clickButton(page, /^Check out$/, { within: MODAL });
      const early = await findText(page, "button", /^Check out anyway$/, { within: MODAL, timeout: 10_000 }).catch(() => null);
      if (early) await early.click();
      await waitForToast(page, /checked out/i);
      const saved = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });
      expect(saved.status).toBe("CHECKED_OUT");
      await goto(page, `${fx.dash}/reservations/${reservationId}`);
      await waitForText(page, /Checked out/i, { within: "aside" });
    });
  });
});
