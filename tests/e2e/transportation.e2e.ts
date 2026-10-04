// Transportation end to end on the e2e property (TRANSPORTATION_PLAN.md): set up a route and
// a rate, book two guests from different reservations onto one shared departure, see them —
// and the "Needs attention" warning — on the board, the dispatch view and the booking panel,
// run Night Audit, find each pickup posted once on its own guest's folio, and export the
// daily report. Arranging data goes through the API; what is under test is the screen and
// the posting.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  api,
  BASE_URL,
  businessDate,
  checkInViaApi,
  closeBrowser,
  createBooking,
  createGuest,
  ensureE2E,
  goto,
  isoDay,
  openBrowser,
  prisma,
  resetStays,
  uniqueName,
  waitForText,
  click,
  clickButton,
  fieldAfterLabel,
  MODAL,
  waitForToast,
  withShot,
  type E2EBrowser,
  type E2EFixture,
} from "./fixtures";

describe("Transportation", () => {
  let fx: E2EFixture;
  let b: E2EBrowser;
  let day: string;
  const bookingIds: string[] = [];
  const resIds: string[] = [];
  const guests: string[] = [];
  const q = () => `?propertyId=${fx.propertyId}`;

  beforeAll(async () => {
    fx = await ensureE2E();
    b = await openBrowser(fx);
    await resetStays(b.session, fx);
    const bd = await businessDate(fx.propertyId);
    day = isoDay(bd);

    // The add-on (Osta sells it per enterprise), then Hub set-up: switch on, defaults, a
    // route with a rate, a 4-seat boat.
    await prisma.enterpriseAddonAccess.upsert({
      where: { enterpriseId_module: { enterpriseId: fx.enterpriseId, module: "TRANSPORTATION" } },
      update: { enabled: true },
      create: { enterpriseId: fx.enterpriseId, module: "TRANSPORTATION", enabled: true },
    });
    await api(b.session, `/api/transport/settings${q()}`, { method: "PATCH", body: { enabled: true, attentionToleranceMinutes: 60 } });
    await api(b.session, `/api/transport/defaults${q()}`, { body: {} });
    const config = await api(b.session, `/api/transport/config${q()}`);
    const loc = (code: string) => config.locations.find((l: { code: string }) => l.code === code).id;
    const spb = config.types.find((t: { code: string }) => t.code === "SPB").id;
    const route =
      config.routes.find((r: { code: string }) => r.code === "E2E-SPB") ??
      (await api(b.session, `/api/transport/config/routes${q()}`, {
        body: { code: "E2E-SPB", name: "Airport to hotel", originId: loc("MLE"), destinationId: loc("HOME"), transportTypeId: spb, category: "AIRPORT_TRANSFER", direction: "BOTH", durationMinutes: 40, departureSlots: ["14:00"] },
      }));
    if (!config.rates.some((r: { routeId: string }) => r.routeId === route.id)) {
      await api(b.session, `/api/transport/config/rates${q()}`, {
        body: { routeId: route.id, direction: "BOTH", pricingBasis: "PER_PERSON", adultPrice: 50, childPrice: 25, chargeCodeId: config.settings.defaultChargeCodeId, taxMode: "CHARGE_CODE" },
      });
    }
    const provider =
      config.providers.find((p: { name: string }) => p.name === "E2E boats") ?? (await api(b.session, `/api/transport/config/providers${q()}`, { body: { name: "E2E boats", kind: "OWN" } }));
    const vessel =
      provider.vessels?.[0] ?? (await api(b.session, `/api/transport/config/vessels${q()}`, { body: { providerId: provider.id, name: "E2E Dhoni", capacity: 4, transportTypeId: spb } }));

    // Two guests, two reservations, both arriving today and checked in.
    for (const [i, flight] of [["EK652", "11:30"], ["QR672", "13:30"]].entries()) {
      const name = uniqueName(`Transfer${i}`);
      guests.push(name);
      const upid = await createGuest(b.session, "Tara", name);
      const r = await createBooking(b.session, fx, { guestUpid: upid, from: bd, nights: 2 });
      await checkInViaApi(b.session, r.id);
      resIds.push(r.id);
      const booking = await api(b.session, `/api/transport/bookings${q()}`, {
        body: { reservationId: r.id, direction: "PICKUP", routeId: route.id, flightNo: flight[0], flightTime: flight[1] },
      });
      bookingIds.push(booking.id);
    }
    // The shared departure: 14:00, both guests (2 + 2 = 4 of 4 seats).
    await api(b.session, `/api/transport/manifests${q()}`, {
      body: { routeId: route.id, direction: "PICKUP", serviceDate: day, departureTime: "14:00", providerId: provider.id, vesselId: vessel.id, bookingIds },
    });
  });
  afterAll(async () => {
    await closeBrowser(b);
  });

  it("shows the shared departure and the attention warning on the board", () =>
    withShot(b.page, "transportation-board", async () => {
      const { page } = b;
      await goto(page, `${fx.dash}/transportation?date=${day}`);
      for (const g of guests) await waitForText(page, g);
      // QR672 lands 13:30, the boat leaves 14:00, 60 minutes needed.
      expect(await page.$$eval("[aria-label^='Needs attention']", (els) => els.length)).toBeGreaterThan(0);

      await goto(page, `${fx.dash}/transportation?date=${day}&view=dispatch`);
      await waitForText(page, "4 / 4 pax");
      await click(page, "button", /14:00/);
      await waitForText(page, /Passengers\s*\(2\)/);
      await waitForText(page, "E2E Dhoni");
    }));

  it("opens a booking and explains the warning", () =>
    withShot(b.page, "transportation-panel", async () => {
      const { page } = b;
      await goto(page, `${fx.dash}/transportation?date=${day}`);
      await click(page, "tbody tr", new RegExp(guests[1]));
      await waitForText(page, /Departs 30 min after landing/);
    }));

  it("the reservation's Transport section is read-only from the module, and editable with it off", () =>
    withShot(b.page, "transportation-reservation", async () => {
      const { page } = b;
      await goto(page, `${fx.dash}/reservations/${resIds[0]}`);
      await waitForText(page, "Managed in Transportation");
      await waitForText(page, "EK652");
      await waitForText(page, "E2E Dhoni");
      // The server refuses edits too.
      const refused = await fetch(`${BASE_URL}/api/reservations/${resIds[0]}/transport`, {
        method: "PUT",
        headers: { Cookie: `auth_token=${b.session.token}`, "content-type": "application/json" },
        body: JSON.stringify({ pickup: { flightNo: "XX1", transportNo: "", time: "" }, dropoff: { flightNo: "", transportNo: "", time: "" } }),
      });
      expect(refused.status).toBe(409);

      await api(b.session, `/api/transport/settings${q()}`, { method: "PATCH", body: { enabled: false } });
      try {
        await goto(page, `${fx.dash}/reservations/${resIds[1]}`);
        await clickButton(page, /^Add transport$/);
        await (await fieldAfterLabel(page, "Flight no.", { within: MODAL })).type("QR999");
        await (await fieldAfterLabel(page, "Transport no.", { within: MODAL })).type("SB-7");
        await (await fieldAfterLabel(page, "Flight lands", { within: MODAL })).type("0945A");
        await clickButton(page, /^Save transport$/, { within: MODAL });
        await waitForToast(page, "Transport saved");
        await waitForText(page, "QR999");
        const leg = await prisma.reservationTransport.findUniqueOrThrow({ where: { reservationId_direction: { reservationId: resIds[1], direction: "PICKUP" } } });
        expect(leg).toMatchObject({ carrierCode: "QR999", transportNo: "SB-7", chargeToGuest: false });
        await prisma.reservationTransport.delete({ where: { id: leg.id } });
      } finally {
        await api(b.session, `/api/transport/settings${q()}`, { method: "PATCH", body: { enabled: true } });
      }
    }));

  it("Night Audit posts each pickup once, to its own guest's folio, and the report exports", async () => {
    const run = await api(b.session, "/api/night-audit/run", { body: { propertyId: fx.propertyId, confirmed: true, reason: "e2e transportation" } });
    expect(run.transportChargesPosted).toBe(2);
    for (const [i, id] of bookingIds.entries()) {
      const bk = await prisma.transportBooking.findUniqueOrThrow({ where: { id }, include: { folioLineItem: { include: { folio: true } } } });
      expect(bk.billingStatus).toBe("POSTED");
      expect(bk.folioLineItem?.folio.reservationId).toBe(resIds[i]);
      const lines = await prisma.folioLineItem.count({ where: { folio: { reservationId: resIds[i] }, description: { startsWith: "Transfer" }, isVoid: false } });
      expect(lines).toBe(1);
    }
    const csv = await fetch(`${BASE_URL}/api/transport/report${q()}&from=${day}&format=csv`, { headers: { Cookie: `auth_token=${b.session.token}` } });
    expect(csv.status).toBe(200);
    const text = await csv.text();
    for (const g of guests) expect(text).toContain(g);
  });
});
