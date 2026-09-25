import { describe, it, expect } from "vitest";
import { autoExemptReason, greenTaxExemptReason, greenTaxPax, isMaldivian, type GreenTaxGuest } from "@/lib/green-tax-exemption";
import { greenTaxCategory, GREEN_TAX_CATEGORY } from "@/lib/green-tax-sheet";
import { computeGeneratedAmounts } from "@/lib/posting/run-generates";

// Owner, 2026-09-25 (DECISIONS "Green Tax per guest"): exempt when under 2, Maldivian, a
// work-permit holder, or ticked by hand, and Green Tax is worked out per person, so one
// exempt guest on a booking does not exempt the rest.

const CHECK_IN = new Date(Date.UTC(2026, 8, 25));
const guest = (g: Partial<GreenTaxGuest> = {}): GreenTaxGuest => ({
  dateOfBirth: null, nationality: null, greenTaxExempt: false, documents: [], ...g,
});

describe("Green Tax exemption per guest", () => {
  it("recognises Maldivian nationality in every form it is stored in", () => {
    for (const v of ["MV", "mv", "MDV", "Maldives", "MALDIVIAN", "Maldivian"]) expect(isMaldivian(v), v).toBe(true);
    for (const v of [null, "", "GB", "IND", "India"]) expect(isMaldivian(v), String(v)).toBe(false);
  });

  it("an infant is under the exempt age at check-in", () => {
    expect(autoExemptReason(guest({ dateOfBirth: new Date(Date.UTC(2024, 8, 26)) }), CHECK_IN, 2)).toBe("INFANT"); // a day short of 2
    expect(autoExemptReason(guest({ dateOfBirth: new Date(Date.UTC(2024, 8, 25)) }), CHECK_IN, 2)).toBe(null); // turns 2 on check-in
    expect(autoExemptReason(guest({ dateOfBirth: null }), CHECK_IN, 2)).toBe(null); // unknown: not assumed
  });

  it("Maldivian, work permit and the manual tick each exempt; reasons follow the sheet's order", () => {
    expect(greenTaxExemptReason(guest({ nationality: "MV" }), CHECK_IN, 2)).toBe("MALDIVIAN");
    expect(greenTaxExemptReason(guest({ documents: [{ isWorkPermit: false }, { isWorkPermit: true }] }), CHECK_IN, 2)).toBe("WORK_PERMIT");
    expect(greenTaxExemptReason(guest({ greenTaxExempt: true }), CHECK_IN, 2)).toBe("MANUAL");
    expect(greenTaxExemptReason(guest(), CHECK_IN, 2)).toBe(null);
    // A Maldivian infant is an infant, as on the MIRA sheet.
    expect(greenTaxExemptReason(guest({ nationality: "MV", dateOfBirth: new Date(Date.UTC(2026, 0, 1)) }), CHECK_IN, 2)).toBe("INFANT");
    expect(greenTaxCategory({ dateOfBirth: null, nationality: "Maldivian", isWorkPermitHolder: false, checkInDate: CHECK_IN, infantAge: 2 })).toBe(GREEN_TAX_CATEGORY.MALDIVIAN);
  });

  it("takes only the exempt named guests off the head count", () => {
    const res = { adults: 2, children: 1, infants: 0, checkInDate: CHECK_IN };
    // Nobody named is exempt: everyone pays.
    expect(greenTaxPax(res, [guest({ upid: "a" }), guest({ upid: "b" })], 2)).toMatchObject({ adults: 2, children: 1 });
    // A Maldivian adult with a foreign adult and a child: one adult comes off.
    expect(greenTaxPax(res, [guest({ upid: "a" }), guest({ upid: "b", nationality: "MV" })], 2)).toMatchObject({ adults: 1, children: 1 });
    // An exempt minor comes off the children.
    expect(greenTaxPax(res, [guest({ upid: "c", greenTaxExempt: true, dateOfBirth: new Date(Date.UTC(2016, 0, 1)) })], 2)).toMatchObject({ adults: 2, children: 0 });
    // The same person listed twice (primary AND accompanying) counts once.
    expect(greenTaxPax(res, [guest({ upid: "a", nationality: "MV" }), guest({ upid: "a", nationality: "MV" })], 2)).toMatchObject({ adults: 1, children: 1 });
    // Everyone exempt: nothing to pay, never negative.
    expect(
      greenTaxPax({ ...res, adults: 1, children: 0 }, [guest({ upid: "a", nationality: "MV" }), guest({ upid: "b", nationality: "MV" })], 2)
    ).toMatchObject({ adults: 0, children: 0 });
  });

  it("an infant already in the infants bucket is not taken off twice; one booked as a child is", () => {
    const baby = guest({ upid: "i", dateOfBirth: new Date(Date.UTC(2026, 0, 1)) });
    // Booked as 2 adults + 1 infant: the infant bucket is untaxed already.
    expect(greenTaxPax({ adults: 2, children: 0, infants: 1, checkInDate: CHECK_IN }, [baby], 2)).toMatchObject({ adults: 2, children: 0 });
    // Booked as 2 adults + 1 child, but the named child is 1 year old: the child comes off.
    expect(greenTaxPax({ adults: 2, children: 1, infants: 0, checkInDate: CHECK_IN }, [baby], 2)).toMatchObject({ adults: 2, children: 0 });
  });

  it("the posting engine charges Green Tax on the paying head count only", () => {
    const g = { id: "g", generatedCodeId: "gtx", method: "GREEN_TAX", value: 0, calculateOn: "NET", basisGenerateId: null, sortOrder: 0, isActive: true };
    const settings = { greenTaxEnabled: true, greenTaxAdultAmount: 12, greenTaxChildAmount: 6 };
    const amount = (context: Record<string, number>) =>
      computeGeneratedAmounts({ generates: [g], netAmount: 100, grossAmount: 100, settings: settings as never, context: context as never })[0]?.amount ?? 0;
    expect(amount({ adults: 2, children: 1, nights: 1 })).toBe(30);
    expect(amount({ adults: 2, children: 1, nights: 1, greenTaxAdults: 1, greenTaxChildren: 1 })).toBe(18);
    expect(amount({ adults: 2, children: 1, nights: 3, greenTaxAdults: 0, greenTaxChildren: 0 })).toBe(0);
  });
});
