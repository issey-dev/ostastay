// End of Day on the e2e property: autopilot runs every step up to the final confirm, then
// Roll & close moves the business date on by one day. This really closes the e2e
// property's day — it is isolated, and every spec reads the business date fresh.
import { format } from "date-fns";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addDays,
  BASE_URL,
  businessDate,
  checkInViaApi,
  clickButton,
  closeBrowser,
  createBooking,
  createGuest,
  ensureE2E,
  goto,
  isoDay,
  mintSession,
  openBrowser,
  prisma,
  resetStays,
  revokeSession,
  uniqueName,
  waitForText,
  withShot,
  type AppSession,
  type E2EBrowser,
  type E2EFixture,
} from "./fixtures";

describe("Night Audit", () => {
  let fx: E2EFixture;
  let b: E2EBrowser;
  let after: AppSession | undefined;
  let bd: Date;
  let inHouseId = "";

  beforeAll(async () => {
    fx = await ensureE2E();
    b = await openBrowser(fx);
    // Nothing for End of Day to stop on (no departures due, no un-arrived bookings)...
    await resetStays(b.session, fx);
    bd = await businessDate(fx.propertyId);
    // ...and one in-house guest, so posting has a room night to post.
    const guest = await createGuest(b.session, "Nora", uniqueName("Audit"));
    inHouseId = (await createBooking(b.session, fx, { guestUpid: guest, from: bd, nights: 2 })).id;
    await checkInViaApi(b.session, inHouseId);
  });
  afterAll(async () => {
    await closeBrowser(b);
    await revokeSession(after);
  });

  it("runs End of Day on autopilot, then Roll & close advances the business date", () =>
    withShot(b.page, "night-audit", async () => {
      const { page } = b;
      await goto(page, `${fx.dash}/financials/night-audit`);
      await waitForText(page, `Business date ${format(bd, "EEEE, dd MMM yyyy")}`);

      await clickButton(page, /^(Run End of Day|Resume auto-run)$/);
      await waitForText(page, "Ready to close the day", { timeout: 150_000 });
      await waitForText(page, "5 of 6 steps complete");

      // Autopilot stops before the one irreversible step; every other step is stamped.
      const audit = await prisma.eodRun.findUnique({ where: { propertyId_businessDate: { propertyId: fx.propertyId, businessDate: bd } } });
      expect(audit, "an End of Day row for the business date").not.toBeNull();
      for (const col of ["departuresAt", "cashierAt", "postAt", "registrationAt", "reportsAt"] as const) {
        expect(audit![col], `${col} stamped`).not.toBeNull();
      }
      expect(audit!.finalizedAt).toBeNull();
      // Posting ran: the in-house guest has tonight's room charge.
      const roomNight = await prisma.folioLineItem.findFirst({
        where: { folio: { reservationId: inHouseId }, isVoid: false, date: { gte: bd, lt: addDays(bd, 1) } },
      });
      expect(roomNight, "a room charge posted for the business date").not.toBeNull();

      await clickButton(page, /^Roll & close$/);
      // Closing signs everyone on the property out — this session included.
      await page.waitForFunction(() => /\/login/.test(location.pathname), { timeout: 60_000 }).catch(() => {});
      await expect.poll(async () => isoDay(await businessDate(fx.propertyId)), { timeout: 30_000 }).toBe(isoDay(addDays(bd, 1)));

      // Signed back in, the page shows the new, open date.
      after = await mintSession(fx);
      await page.setCookie({ name: "auth_token", value: after.token, domain: new URL(BASE_URL).hostname, path: "/", httpOnly: true });
      await goto(page, `${fx.dash}/financials/night-audit`);
      await waitForText(page, `Business date ${format(addDays(bd, 1), "EEEE, dd MMM yyyy")}`);
      await waitForText(page, "Run End of Day");
    }));
});
