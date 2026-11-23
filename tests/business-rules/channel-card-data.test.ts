import { describe, it, expect, beforeAll, vi } from "vitest";

process.env.SECRETS_ENCRYPTION_KEY = "test-channel-card-key";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { prisma } = await import("@/lib/db");
const { stripCardData, maskCardNumbers, CARD_REMOVED } = await import("@/lib/channels/core/card-data");
const { redactForLog } = await import("@/lib/channels/redact");
const { ingestBooking } = await import("@/lib/channels/inbound/ingest");
const { parseBeds24Booking, isCancelledStatus } = await import("@/lib/channels/inbound/parse");
const { connectProperty, makeChannelProperty } = await import("../helpers/channel");

// DECISIONS.md "Channel bookings never store card details" (2026-11-23).

const VISA = "4111111111111111"; // standard Luhn-valid test number
const VISA_SPACED = "4111 1111 1111 1111";

describe("Channel card data is never stored", () => {
  describe("stripCardData / maskCardNumbers", () => {
    it("drops card keys at any depth, whatever their spelling", () => {
      const { value, cardSupplied } = stripCardData({
        id: 1,
        booking: { card_number: VISA, CVV: "123", expiryMonth: "02", stripeToken: "tok_abc", pcibookingToken: "pci_x" },
        guests: [{ firstName: "A", creditCardHolder: "A B" }],
      });
      expect(cardSupplied).toBe(true);
      expect(value).toEqual({ id: 1, booking: {}, guests: [{ firstName: "A" }] });
      expect(JSON.stringify(value)).not.toContain("tok_abc");
    });

    it("masks a card number typed into free text, keeping the rest", () => {
      const { value, cardSupplied } = stripCardData({ message: `Please charge ${VISA_SPACED} thanks` });
      expect(cardSupplied).toBe(true);
      expect(value.message).toBe(`Please charge ${CARD_REMOVED} thanks`);
    });

    it("leaves ordinary numbers alone: phone numbers, booking ids, non-Luhn digit runs", () => {
      const input = { phone: "+960 777 1234", id: "1234567890123", ref: "4111111111111112", total: 1200 };
      const { value, cardSupplied } = stripCardData(input);
      expect(cardSupplied).toBe(false);
      expect(value).toEqual(input);
    });

    it("an empty card key (Beds24 sends stripeToken: null on every booking) is dropped but is not 'supplied'", () => {
      const { value, cardSupplied } = stripCardData({ id: 7, stripeToken: null, pcibookingToken: "" });
      expect(cardSupplied).toBe(false);
      expect(value).toEqual({ id: 7 });
    });

    it("maskCardNumbers reports what it found", () => {
      expect(maskCardNumbers(`x ${VISA} y`)).toEqual({ text: `x ${CARD_REMOVED} y`, found: true });
      expect(maskCardNumbers("nothing here").found).toBe(false);
    });

    it("the sync log never shows a card number, even in a whitelisted free-text field", () => {
      const log = redactForLog({ message: `card ${VISA}`, id: 5 });
      expect(log).not.toContain(VISA);
      expect(log).toContain(CARD_REMOVED);
    });
  });

  describe("ingest", () => {
    let enterpriseId: string;
    let connectionId: string;

    beforeAll(async () => {
      const ent = await prisma.enterprise.create({
        data: { name: `Card Ent ${Date.now()}`, slug: `test-card-${Date.now()}`, type: "STANDARD" },
      });
      enterpriseId = ent.id;
      const propertyId = (await makeChannelProperty(enterpriseId, "Card Property")).id;
      connectionId = (await connectProperty(propertyId)).connection.id;
    });

    const ingest = (raw: unknown) =>
      ingestBooking({ enterpriseId, connectionId, raw, source: "WEBHOOK", parse: parseBeds24Booking, isCancelled: isCancelledStatus });

    async function row(id: string) {
      return prisma.channelInboundBooking.findUniqueOrThrow({
        where: { connectionId_externalBookingId: { connectionId, externalBookingId: id } },
      });
    }

    it("stores the booking without card data and marks cardSupplied", async () => {
      await ingest({
        id: "card-1", roomId: 1, arrival: "2027-01-10", departure: "2027-01-12", status: "confirmed",
        firstName: "Card", lastName: "Guest", stripeToken: "tok_live_123", message: `my card ${VISA}`,
      });
      const r = await row("card-1");
      expect(r.cardSupplied).toBe(true);
      expect(r.rawPayload).not.toContain("tok_live_123");
      expect(r.rawPayload).not.toContain(VISA);
      expect(r.rawPayload).not.toContain("stripeToken");
      // Everything else is still there, so a mis-parse stays replayable.
      expect(r.guestLastName).toBe("Guest");
      expect(JSON.parse(r.rawPayload).arrival).toBe("2027-01-10");
    });

    it("cardSupplied stays true when a later delivery carries no card", async () => {
      await ingest({ id: "card-1", roomId: 1, arrival: "2027-01-10", departure: "2027-01-12", status: "confirmed" });
      expect((await row("card-1")).cardSupplied).toBe(true);
    });

    it("a booking with no card is not marked", async () => {
      await ingest({ id: "card-2", roomId: 1, arrival: "2027-02-10", departure: "2027-02-11", status: "confirmed", stripeToken: null });
      expect((await row("card-2")).cardSupplied).toBe(false);
    });
  });
});
