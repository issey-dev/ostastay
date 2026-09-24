import { describe, it, expect } from "vitest";
import {
  propertyProfileFormSchema,
  propertyProfilePatchSchema,
  profileFieldErrors,
} from "@/lib/properties/profile-schema";
import { taxProfileInUseMessage } from "@/lib/tax-profile-usage";
import { MIN_SERVICE_CHARGE_RATE } from "@/lib/tax-calc";
import { propertySettingsPatchSchema } from "@/lib/property-settings";

// Hub › General › Property Information (APP STANDARD 001) — the form and
// PUT /api/properties/[id] share these rules.

const validForm = () => ({
  name: "Sunset Resort",
  legalName: "Sunset Resort Pvt Ltd",
  code: "SUN",
  starRating: "4",
  checkInTime: "14:00",
  checkOutTime: "11:00",
  taxId: "",
  contactPhone: "",
  contactEmail: "",
  address: "",
});

const fieldsOf = (r: { success: boolean; error?: unknown }) =>
  r.success ? [] : Object.keys(profileFieldErrors((r as { error: Parameters<typeof profileFieldErrors>[0] }).error));

describe("Property profile form schema", () => {
  it("accepts a complete profile with optional fields blank", () => {
    expect(propertyProfileFormSchema.safeParse(validForm()).success).toBe(true);
  });

  it.each([
    ["name", "S"],
    ["legalName", ""],
    ["code", "S"],
    ["code", "THIRTEENCHARS"],
    ["code", "sun"],
    ["code", "-SUN"],
    ["starRating", "6"],
    ["starRating", "3.5"],
    ["checkInTime", "2pm"],
    ["checkOutTime", "25:00"],
    ["contactEmail", "not-an-email"],
  ])("rejects %s = %j", (field, value) => {
    const r = propertyProfileFormSchema.safeParse({ ...validForm(), [field]: value });
    expect(fieldsOf(r)).toContain(field);
  });

  it("accepts a blank star rating and a valid email", () => {
    const r = propertyProfileFormSchema.safeParse({ ...validForm(), starRating: "", contactEmail: "fo@sunset.mv" });
    expect(r.success).toBe(true);
  });
});

describe("Property PUT body schema", () => {
  it("leaves absent keys absent — one-field PUTs from other panels pass untouched", () => {
    const r = propertyProfilePatchSchema.safeParse({ bannerColor: "#123456" });
    expect(r.success).toBe(true);
    expect(r.success && r.data).toEqual({});
    const r2 = propertyProfilePatchSchema.safeParse({ allocationCalculationMode: "MEAL_PLAN" });
    expect(r2.success).toBe(true);
  });

  it("keeps a console-created code with a dash editable", () => {
    expect(propertyProfileFormSchema.safeParse({ ...validForm(), code: "VEYO-MAIN" }).success).toBe(true);
  });

  it("normalises the code to upper case and blank optionals to null", () => {
    const r = propertyProfilePatchSchema.safeParse({ code: " sun1 ", contactEmail: "", taxId: "  ", starRating: "" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.code).toBe("SUN1");
      expect(r.data.contactEmail).toBeNull();
      expect(r.data.taxId).toBeNull();
      expect(r.data.starRating).toBeNull();
    }
  });

  it("accepts a numeric-string star rating from older callers, rejects out-of-range", () => {
    const ok = propertyProfilePatchSchema.safeParse({ starRating: "5" });
    expect(ok.success && ok.data.starRating).toBe(5);
    expect(propertyProfilePatchSchema.safeParse({ starRating: 7 }).success).toBe(false);
    expect(propertyProfilePatchSchema.safeParse({ starRating: 2.5 }).success).toBe(false);
  });

  it("rejects an invalid present field with a per-field message", () => {
    const r = propertyProfilePatchSchema.safeParse({ name: "A", checkInTime: "9am", contactEmail: "x@" });
    expect(fieldsOf(r).sort()).toEqual(["checkInTime", "contactEmail", "name"]);
  });
});

describe("Service Charge floor (Finance › Tax)", () => {
  it("is 10% — the same value the form and the settings API enforce", () => {
    expect(MIN_SERVICE_CHARGE_RATE).toBe(10);
    expect(propertySettingsPatchSchema.safeParse({ serviceChargeRate: 9.99 }).success).toBe(false);
    expect(propertySettingsPatchSchema.safeParse({ serviceChargeRate: 0 }).success).toBe(false);
    expect(propertySettingsPatchSchema.safeParse({ serviceChargeRate: 10 }).success).toBe(true);
    expect(propertySettingsPatchSchema.safeParse({ serviceChargeRate: 12.5 }).success).toBe(true);
  });

  it("still lets Service Charge posting be switched off", () => {
    expect(propertySettingsPatchSchema.safeParse({ serviceChargeEnabled: false }).success).toBe(true);
  });
});

describe("Custom Tax profile in-use message", () => {
  it("is null when nothing uses the profile", () => {
    expect(taxProfileInUseMessage("City Tax", { chargeCodes: 0, outlets: 0 })).toBeNull();
  });

  it("names the counts", () => {
    expect(taxProfileInUseMessage("City Tax", { chargeCodes: 3, outlets: 0 })).toContain("3 charge codes");
    expect(taxProfileInUseMessage("City Tax", { chargeCodes: 1, outlets: 1 })).toContain("1 charge code and 1 outlet");
    expect(taxProfileInUseMessage("City Tax", { chargeCodes: 0, outlets: 2 })).toContain("2 outlets");
  });
});
