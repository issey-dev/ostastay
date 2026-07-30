import { describe, it, expect } from "vitest";
import { planSlotReconciliation, serializeChildrenInfo, parseChildrenInfo } from "@/lib/eregistration/slots";
import { generateEregistrationToken, hashEregistrationToken } from "@/lib/eregistration/token";
import { sniffImageType, isValidSignatureDataUrl } from "@/lib/eregistration/storage";

describe("eRegistration slot reconciliation", () => {
  const primaryGuestId = "profile-primary";

  it("generates slot 0 for the primary guest plus one slot per accompanying guest, ordered by createdAt", () => {
    const plan = planSlotReconciliation(
      {
        adults: 3,
        primaryGuestId,
        accompanyingGuests: [
          { profileId: "acc-2", createdAt: new Date("2026-01-02") },
          { profileId: "acc-1", createdAt: new Date("2026-01-01") },
        ],
      },
      []
    );
    // Caller is responsible for pre-sorting by createdAt — verifying the algorithm
    // trusts the given order rather than re-sorting itself.
    expect(plan.toCreate).toEqual([
      { slotIndex: 0, isPrimary: true, existingProfileId: primaryGuestId },
      { slotIndex: 1, isPrimary: false, existingProfileId: "acc-2" },
      { slotIndex: 2, isPrimary: false, existingProfileId: "acc-1" },
    ]);
    expect(plan.warnings).toEqual([]);
  });

  it("gives extra adult slots with no accompanying profile a blank (guest types their own name)", () => {
    const plan = planSlotReconciliation({ adults: 3, primaryGuestId, accompanyingGuests: [] }, []);
    expect(plan.toCreate).toEqual([
      { slotIndex: 0, isPrimary: true, existingProfileId: primaryGuestId },
      { slotIndex: 1, isPrimary: false, existingProfileId: null },
      { slotIndex: 2, isPrimary: false, existingProfileId: null },
    ]);
  });

  it("floors adults at 1 even when the reservation says 0 (day-use/all-children edge case)", () => {
    const plan = planSlotReconciliation({ adults: 0, primaryGuestId, accompanyingGuests: [] }, []);
    expect(plan.toCreate).toEqual([{ slotIndex: 0, isPrimary: true, existingProfileId: primaryGuestId }]);
  });

  it("warns, but does not silently drop, excess accompanying guests beyond the adult headcount", () => {
    const plan = planSlotReconciliation(
      {
        adults: 2,
        primaryGuestId,
        accompanyingGuests: [
          { profileId: "acc-1", createdAt: new Date("2026-01-01") },
          { profileId: "acc-2", createdAt: new Date("2026-01-02") },
        ],
      },
      []
    );
    expect(plan.toCreate.map((s) => s.existingProfileId)).toEqual([primaryGuestId, "acc-1"]);
    expect(plan.warnings.some((w) => w.includes("will not get an eRegistration slot"))).toBe(true);
  });

  it("never deletes or reassigns a SUBMITTED slot when headcount shrinks — only relinks it", () => {
    const plan = planSlotReconciliation(
      { adults: 1, primaryGuestId, accompanyingGuests: [] },
      [
        { slotIndex: 0, existingProfileId: primaryGuestId, status: "PENDING" },
        { slotIndex: 1, existingProfileId: "acc-1", status: "SUBMITTED" },
      ]
    );
    expect(plan.toDeletePending).toEqual([]);
    expect(plan.toRelink).toContain(1);
  });

  it("deletes a PENDING slot beyond the new headcount, but keeps a SUBMITTED one", () => {
    const plan = planSlotReconciliation(
      { adults: 1, primaryGuestId, accompanyingGuests: [] },
      [
        { slotIndex: 0, existingProfileId: primaryGuestId, status: "PENDING" },
        { slotIndex: 1, existingProfileId: "acc-1", status: "PENDING" },
      ]
    );
    expect(plan.toDeletePending).toEqual([1]);
  });

  it("updates a PENDING slot's expected profile when the accompanying guest at that position changes", () => {
    const plan = planSlotReconciliation(
      { adults: 2, primaryGuestId, accompanyingGuests: [{ profileId: "acc-new", createdAt: new Date() }] },
      [
        { slotIndex: 0, existingProfileId: primaryGuestId, status: "PENDING" },
        { slotIndex: 1, existingProfileId: "acc-old", status: "PENDING" },
      ]
    );
    expect(plan.toUpdate).toEqual([{ slotIndex: 1, existingProfileId: "acc-new" }]);
  });

  it("never touches a SUBMITTED slot's profile — flags a mismatch instead of reassigning it", () => {
    const plan = planSlotReconciliation(
      { adults: 2, primaryGuestId, accompanyingGuests: [{ profileId: "acc-new", createdAt: new Date() }] },
      [
        { slotIndex: 0, existingProfileId: primaryGuestId, status: "PENDING" },
        { slotIndex: 1, existingProfileId: "acc-old", status: "SUBMITTED" },
      ]
    );
    expect(plan.toUpdate).toEqual([]);
    expect(plan.warnings.some((w) => w.includes("guest list at that position has since changed"))).toBe(true);
  });

  it("leaves an already-correct slot alone (no update, still relinked)", () => {
    const plan = planSlotReconciliation(
      { adults: 1, primaryGuestId, accompanyingGuests: [] },
      [{ slotIndex: 0, existingProfileId: primaryGuestId, status: "PENDING" }]
    );
    expect(plan.toUpdate).toEqual([]);
    expect(plan.toCreate).toEqual([]);
    expect(plan.toRelink).toEqual([0]);
  });
});

describe("eRegistration declared-children info", () => {
  it("round-trips a normal list", () => {
    const raw = serializeChildrenInfo([{ name: "Kid One", dateOfBirth: "2018-01-01" }]);
    expect(parseChildrenInfo(raw)).toEqual([{ name: "Kid One", dateOfBirth: "2018-01-01" }]);
  });

  it("caps the count and per-entry name length rather than trusting input size", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ name: "x".repeat(500), dateOfBirth: null }));
    const raw = serializeChildrenInfo(many);
    const parsed = parseChildrenInfo(raw);
    expect(parsed.length).toBeLessThanOrEqual(20);
    expect(parsed[0].name.length).toBeLessThanOrEqual(200);
  });

  it("parses malformed/garbage input as an empty list rather than throwing", () => {
    expect(parseChildrenInfo("not json")).toEqual([]);
    expect(parseChildrenInfo(null)).toEqual([]);
    expect(parseChildrenInfo("{}")).toEqual([]);
  });
});

describe("eRegistration token", () => {
  it("generates a 256-bit hex token and hashes it deterministically", () => {
    const token = generateEregistrationToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(hashEregistrationToken(token)).toBe(hashEregistrationToken(token));
    expect(hashEregistrationToken(token)).not.toBe(token);
  });

  it("generates distinct tokens each call", () => {
    const a = generateEregistrationToken();
    const b = generateEregistrationToken();
    expect(a).not.toBe(b);
  });
});

describe("eRegistration upload validation", () => {
  it("sniffs JPEG, PNG, and WEBP by magic bytes, ignoring any claimed mime type", () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0x00]))?.mimeType).toBe("image/jpeg");
    expect(sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.mimeType).toBe("image/png");
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP")]);
    expect(sniffImageType(webp)?.mimeType).toBe("image/webp");
  });

  it("rejects anything that doesn't match a known image signature", () => {
    expect(sniffImageType(Buffer.from("<html>not an image</html>"))).toBeNull();
    expect(sniffImageType(Buffer.from([0x25, 0x50, 0x44, 0x46]))).toBeNull(); // %PDF
  });

  it("validates the signature data URL shape and size", () => {
    expect(isValidSignatureDataUrl("data:image/png;base64," + "A".repeat(100))).toBe(true);
    expect(isValidSignatureDataUrl("data:image/jpeg;base64,AAAA")).toBe(false);
    expect(isValidSignatureDataUrl("not a data url")).toBe(false);
    expect(isValidSignatureDataUrl("data:image/png;base64," + "A".repeat(300_000))).toBe(false);
  });
});
