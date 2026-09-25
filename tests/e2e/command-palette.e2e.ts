// The Ctrl+K palette, keyboard only: open it, search a guest, Enter → their reservation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addDays,
  businessDate,
  closeBrowser,
  createBooking,
  createGuest,
  ensureE2E,
  goto,
  openBrowser,
  resetStays,
  uniqueName,
  waitForText,
  withShot,
  type E2EBrowser,
  type E2EFixture,
} from "./fixtures";

describe("Command palette", () => {
  let fx: E2EFixture;
  let b: E2EBrowser;
  let reservationId = "";
  let confirmationNo = "";
  const last = uniqueName("Find");

  beforeAll(async () => {
    fx = await ensureE2E();
    b = await openBrowser(fx);
    await resetStays(b.session, fx);
    const guest = await createGuest(b.session, "Petra", last);
    const bd = await businessDate(fx.propertyId);
    ({ id: reservationId, confirmationNo } = await createBooking(b.session, fx, { guestUpid: guest, from: addDays(bd, 3), nights: 2, withRoom: false }));
  });
  afterAll(async () => {
    if (b) await resetStays(b.session, fx).catch(() => {});
    await closeBrowser(b);
  });

  it("finds a guest's booking with Ctrl+K and opens it with Enter", () =>
    withShot(b.page, "command-palette", async () => {
      const { page } = b;
      await goto(page, `${fx.dash}/front-office`);
      await waitForText(page, "Front Desk");

      await page.keyboard.down("Control");
      await page.keyboard.press("k");
      await page.keyboard.up("Control");
      const input = await page.waitForSelector('input[placeholder="Search guests, bookings, rooms or pages"]', { visible: true });
      expect(await input!.evaluate((i) => i === document.activeElement)).toBe(true);

      await page.keyboard.type(last, { delay: 20 });
      // The booking is the first result, and the first result is the active one.
      await page.waitForFunction(
        (text: string) => {
          const first = document.querySelector<HTMLElement>('#command-palette-list [role=option][data-index="0"]');
          return !!first && first.getAttribute("aria-selected") === "true" && first.innerText.includes(text);
        },
        {},
        confirmationNo
      );
      await page.keyboard.press("Enter");

      await page.waitForFunction((id: string) => location.pathname.endsWith(`/reservations/${id}`), {}, reservationId);
      await waitForText(page, `Petra ${last}`);
      await waitForText(page, confirmationNo);
    }));
});
