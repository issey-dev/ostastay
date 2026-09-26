// Check-out is refused while money is owed, and the refusal leads to the folio: Front Desk
// › Departures › Check out on a stay with a balance → "Balance outstanding" → Open folio.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addDays,
  balanceOf,
  businessDate,
  checkInViaApi,
  click,
  closeBrowser,
  createBooking,
  createGuest,
  ensureE2E,
  findText,
  goto,
  MODAL,
  openBrowser,
  prisma,
  resetStays,
  uniqueName,
  waitForText,
  withShot,
  type E2EBrowser,
  type E2EFixture,
} from "./fixtures";

describe("Balance guard on check-out", () => {
  let fx: E2EFixture;
  let b: E2EBrowser;
  let reservationId = "";
  const last = uniqueName("Owes");

  beforeAll(async () => {
    fx = await ensureE2E();
    b = await openBrowser(fx);
    await resetStays(b.session, fx);

    // Arrange (API + DB, not the UI): a guest due out TODAY who still owes money. A booking
    // can't arrive before the business date, so book one night from today and move the
    // stay back a day — it then "arrived yesterday", and check-in charges that held night.
    const bd = await businessDate(fx.propertyId);
    const guest = await createGuest(b.session, "Oscar", last);
    const booking = await createBooking(b.session, fx, { guestUpid: guest, from: bd, nights: 1 });
    reservationId = booking.id;
    await prisma.reservation.update({ where: { id: reservationId }, data: { checkInDate: addDays(bd, -1), checkOutDate: bd } });
    const assignments = await prisma.roomAssignment.findMany({ where: { reservationId } });
    for (const a of assignments) {
      await prisma.roomAssignment.update({ where: { id: a.id }, data: { startDate: addDays(a.startDate, -1), endDate: addDays(a.endDate, -1) } });
    }
    await checkInViaApi(b.session, reservationId, { heldNights: "CHARGE" });
    expect((await balanceOf(reservationId)).balance).toBeGreaterThan(0);
  });
  afterAll(async () => {
    if (b) await resetStays(b.session, fx).catch(() => {});
    await closeBrowser(b);
  });

  it("offers Open folio instead of checking out a stay with a balance", () =>
    withShot(b.page, "balance-guard", async () => {
      const { page } = b;
      await goto(page, `${fx.dash}/front-office?tab=departures`);
      const row = await findText(page, "tbody tr", new RegExp(`Oscar ${last}`));
      const checkOut = await row.$$("button");
      let clicked = false;
      for (const btn of checkOut) {
        if (/^Check out$/.test((await btn.evaluate((e) => (e as HTMLElement).innerText)).trim())) {
          await btn.click();
          clicked = true;
          break;
        }
      }
      expect(clicked, "the departure row has a Check out button").toBe(true);

      await waitForText(page, "Balance outstanding", { within: MODAL });
      await click(page, "button", /^Open folio$/, { within: MODAL });
      await waitForText(page, "Guest folio", { within: MODAL });
      await waitForText(page, /Post payment/, { within: MODAL });

      const saved = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });
      expect(saved.status).toBe("IN_HOUSE");
    }));
});
