import { describe, it, expect } from "vitest";
import { COUNTRIES, alpha2For, findCountry, nationalityFor } from "@/lib/countries";
import { buildNationalities, countryLabel, nationalityLabel } from "@/lib/nationalities";
import * as Flags from "country-flag-icons/react/3x2";

// The master nationality list (ISO 3166-1 codes, CLDR names, flags) and the enterprise's own
// renames and additions on top of it — src/lib/countries.ts, src/lib/nationalities.ts.

describe("The master list", () => {
  it("still resolves the country names stored before the CLDR list, and ICAO passport codes", () => {
    // eRegistration OCR stored names from the previous list.
    expect(alpha2For("Turkey")).toBe("TR");
    expect(alpha2For("Hong Kong")).toBe("HK");
    expect(alpha2For("Myanmar")).toBe("MM");
    expect(alpha2For("Côte d'Ivoire")).toBe("CI");
    expect(alpha2For("Saint Lucia")).toBe("LC");
    // A German passport's MRZ nationality is "D"; British national categories are GBx.
    expect(alpha2For("D")).toBe("DE");
    expect(alpha2For("GBD")).toBe("GB");
  });

  it("covers ISO 3166-1 with unique alpha-2 and alpha-3 codes, a name and a nationality each", () => {
    expect(COUNTRIES.length).toBe(250);
    expect(new Set(COUNTRIES.map((c) => c.alpha2)).size).toBe(COUNTRIES.length);
    expect(new Set(COUNTRIES.map((c) => c.alpha3)).size).toBe(COUNTRIES.length);
    for (const c of COUNTRIES) {
      expect(c.alpha2).toMatch(/^[A-Z]{2}$/);
      expect(c.alpha3).toMatch(/^[A-Z]{3}$/);
      expect(c.name.length).toBeGreaterThan(1);
      expect(c.nationality.length).toBeGreaterThan(1);
    }
  });

  it("has a flag for every country", () => {
    const flags = Flags as unknown as Record<string, unknown>;
    const missing = COUNTRIES.filter((c) => !flags[c.alpha2]).map((c) => c.alpha2);
    expect(missing).toEqual([]);
  });

  it("resolves a code, a passport's alpha-3, a country name or a nationality to the same country", () => {
    for (const v of ["MV", "MDV", "Maldives", "maldivian"]) expect(findCountry(v)?.alpha2).toBe("MV");
    expect(alpha2For("GBR")).toBe("GB");
    expect(alpha2For("British")).toBe("GB");
    expect(alpha2For("Atlantis")).toBeUndefined();
    expect(nationalityFor("MV")).toBe("Maldivian");
  });
});

describe("An enterprise's nationalities", () => {
  it("is the whole master list when the enterprise has changed nothing", () => {
    const list = buildNationalities([]);
    expect(list.length).toBe(COUNTRIES.length);
    expect(nationalityLabel("MV", list)).toBe("Maldivian");
    expect(countryLabel("MV", list)).toBe("Maldives");
  });

  it("renames a standard entry, and adds its own", () => {
    const list = buildNationalities([
      { code: "MV", value: "Maldivian (Local)" },
      { code: "XXA", value: "Stateless" },
    ]);
    expect(list.length).toBe(COUNTRIES.length + 1);
    const mv = list.find((o) => o.code === "MV")!;
    expect(mv).toMatchObject({ nationality: "Maldivian (Local)", country: "Maldives", standard: true, renamed: true });
    expect(nationalityLabel("XXA", list)).toBe("Stateless");
    expect(list.find((o) => o.code === "XXA")).toMatchObject({ standard: false, alpha3: null });
  });

  it("ignores a switched-off change — back to the standard name, or gone", () => {
    const list = buildNationalities([
      { code: "MV", value: "Maldivian (Local)", isActive: false },
      { code: "XXA", value: "Stateless", isActive: false },
    ]);
    expect(nationalityLabel("MV", list)).toBe("Maldivian");
    expect(list.some((o) => o.code === "XXA")).toBe(false);
  });

  it("does not count a 'rename' to the standard name as renamed", () => {
    const list = buildNationalities([{ code: "US", value: "American" }]);
    expect(list.find((o) => o.code === "US")!.renamed).toBe(false);
  });

  it("shows an unrecognised stored value as it is, rather than blank", () => {
    expect(nationalityLabel("Martian", buildNationalities([]))).toBe("Martian");
  });
});
