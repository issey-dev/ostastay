import { describe, it, expect } from "vitest";
import { normalizeOutletCode, validateOutletCode, deriveOutletCodeBase, nextAvailableOutletCode } from "@/lib/outlet-code";

describe("normalizeOutletCode", () => {
  it("trims and uppercases", () => {
    expect(normalizeOutletCode("  spa ")).toBe("SPA");
    expect(normalizeOutletCode("Bar")).toBe("BAR");
  });

  it("returns null for blank or non-string input", () => {
    expect(normalizeOutletCode("")).toBeNull();
    expect(normalizeOutletCode("   ")).toBeNull();
    expect(normalizeOutletCode(undefined)).toBeNull();
    expect(normalizeOutletCode(123)).toBeNull();
  });
});

describe("validateOutletCode", () => {
  it("requires a code", () => {
    expect(validateOutletCode(null)).toMatch(/required/i);
  });

  it("accepts 2–8 uppercase letters/digits", () => {
    expect(validateOutletCode("SPA")).toBeNull();
    expect(validateOutletCode("BAR1")).toBeNull();
    expect(validateOutletCode("AB")).toBeNull();
    expect(validateOutletCode("ABCDEFGH")).toBeNull();
  });

  it("rejects too-short, too-long, spaced, or symbol-laden codes", () => {
    expect(validateOutletCode("A")).not.toBeNull();
    expect(validateOutletCode("ABCDEFGHI")).not.toBeNull();
    expect(validateOutletCode("SP A")).not.toBeNull();
    expect(validateOutletCode("SPA-1")).not.toBeNull();
    // Lowercase never reaches validate un-normalized, but guard anyway.
    expect(validateOutletCode("spa")).not.toBeNull();
  });
});

describe("deriveOutletCodeBase", () => {
  it("takes the first 3 alphanumeric chars, uppercased", () => {
    expect(deriveOutletCodeBase("Ocean Spa")).toBe("OCE");
    expect(deriveOutletCodeBase("Bar")).toBe("BAR");
    expect(deriveOutletCodeBase("Sunset Bar & Grill")).toBe("SUN");
  });

  it("falls back to OUT for names with fewer than 2 usable chars", () => {
    expect(deriveOutletCodeBase("A")).toBe("OUT");
    expect(deriveOutletCodeBase("!!")).toBe("OUT");
    expect(deriveOutletCodeBase("")).toBe("OUT");
  });
});

describe("nextAvailableOutletCode", () => {
  it("returns the base when free", () => {
    expect(nextAvailableOutletCode("SPA", new Set())).toBe("SPA");
  });

  it("suffixes a number on collision (case-insensitive)", () => {
    expect(nextAvailableOutletCode("SPA", new Set(["SPA"]))).toBe("SPA2");
    expect(nextAvailableOutletCode("SPA", new Set(["spa", "spa2"]))).toBe("SPA3");
  });

  it("keeps results within the 2–8 char rule", () => {
    const code = nextAvailableOutletCode("OUT", new Set(["OUT"]));
    expect(validateOutletCode(code)).toBeNull();
  });
});
