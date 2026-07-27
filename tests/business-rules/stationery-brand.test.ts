import { describe, it, expect } from "vitest";
import { resolveStationeryBrand } from "@/lib/stationery-brand";
import { resolveStationeryFontClass, DEFAULT_STATIONERY_FONT } from "@/lib/stationery-fonts";
import { DEFAULT_INVOICE_BRAND_COLOR } from "@/lib/invoice-branding";

const property = {
  name: "Veyo Beach House",
  logoUrl: "https://example.com/logo.png",
  taxId: "GST129000000125",
  contactPhone: "+960 555 0100",
  contactEmail: "frontdesk@veyo.com",
  address: "North Male Atoll, Maldives",
  bannerColor: "#2563EB",
  stationeryFont: "Georgia",
};

describe("resolveStationeryBrand", () => {
  it("sources identity, accent, and font from the property", () => {
    const b = resolveStationeryBrand(property);
    expect(b.name).toBe("Veyo Beach House");
    expect(b.logoUrl).toBe("https://example.com/logo.png");
    expect(b.address).toBe("North Male Atoll, Maldives");
    expect(b.phone).toBe("+960 555 0100");
    expect(b.email).toBe("frontdesk@veyo.com");
    expect(b.taxId).toBe("GST129000000125");
    expect(b.brandColor).toBe("#2563EB");
    expect(b.fontClass).toBe("font-serif"); // Georgia
  });

  it("falls back to the default accent when the property has no banner colour", () => {
    const b = resolveStationeryBrand({ ...property, bannerColor: null });
    expect(b.brandColor).toBe(DEFAULT_INVOICE_BRAND_COLOR);
  });

  it("defaults the font class to sans when unset", () => {
    const b = resolveStationeryBrand({ ...property, stationeryFont: null });
    expect(b.fontClass).toBe("font-sans");
  });

  it("overrides identity with the outlet header but keeps the property's accent and font", () => {
    const b = resolveStationeryBrand(property, {
      name: "Sunset Bar",
      address: "Beachfront",
      phone: "+960 555 0200",
      email: "bar@veyo.com",
      taxNo: "OUTLET-TAX-1",
    });
    // Outlet identity wins…
    expect(b.name).toBe("Sunset Bar");
    expect(b.address).toBe("Beachfront");
    expect(b.phone).toBe("+960 555 0200");
    expect(b.email).toBe("bar@veyo.com");
    expect(b.taxId).toBe("OUTLET-TAX-1");
    // …but an outlet carries no logo, and the property's accent/font are still used.
    expect(b.logoUrl).toBeNull();
    expect(b.brandColor).toBe("#2563EB");
    expect(b.fontClass).toBe("font-serif");
  });
});

describe("resolveStationeryFontClass", () => {
  it("maps known fonts to their Tailwind class", () => {
    expect(resolveStationeryFontClass("Geist")).toBe("font-sans");
    expect(resolveStationeryFontClass("Inter")).toBe("font-sans");
    expect(resolveStationeryFontClass("Roboto")).toBe("font-sans");
    expect(resolveStationeryFontClass("Georgia")).toBe("font-serif");
    expect(resolveStationeryFontClass("Courier")).toBe("font-mono");
  });

  it("defaults to sans for unknown or null fonts", () => {
    expect(resolveStationeryFontClass(null)).toBe("font-sans");
    expect(resolveStationeryFontClass(undefined)).toBe("font-sans");
    expect(resolveStationeryFontClass("Comic Sans")).toBe("font-sans");
    expect(resolveStationeryFontClass(DEFAULT_STATIONERY_FONT)).toBe("font-sans");
  });
});
