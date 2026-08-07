import { describe, it, expect } from "vitest";
import { parseMrzPassport, parseMaldivianNid } from "@/lib/eregistration/ocr";

// The standard published ICAO 9303 TD3 sample MRZ — a well-known valid example, useful
// here because its check digits are known-correct without having to hand-compute them.
const VALID_MRZ =
  "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\n" + "L898902C36UTO7408122F1204159ZE184226B<<<<<10";

describe("MRZ passport parser (ICAO 9303 TD3)", () => {
  it("parses the standard ICAO sample MRZ with valid check digits", () => {
    const result = parseMrzPassport(VALID_MRZ);
    expect(result).not.toBeNull();
    expect(result?.checkDigitsValid).toBe(true);
    expect(result?.documentNumber).toBe("L898902C3");
    expect(result?.surname).toBe("ERIKSSON");
    expect(result?.givenNames).toBe("ANNA MARIA");
    expect(result?.issuingCountry).toBe("UTO");
    expect(result?.nationality).toBe("UTO");
    expect(result?.dateOfBirth).toBe("1974-08-12");
    expect(result?.sex).toBe("FEMALE");
    expect(result?.expiryDate).toBe("2012-04-15");
  });

  it("rejects an MRZ whose check digit doesn't match — a garbled OCR read", () => {
    const corrupted = VALID_MRZ.replace("L898902C36UTO", "L898902C39UTO");
    const result = parseMrzPassport(corrupted);
    expect(result).not.toBeNull();
    expect(result?.checkDigitsValid).toBe(false);
  });

  it("returns null when no MRZ is present", () => {
    expect(parseMrzPassport("just some random OCR text\nwith no passport data")).toBeNull();
  });

  it("tolerates OCR noise (stray whitespace) around the MRZ lines", () => {
    const noisy = "  " + VALID_MRZ.split("\n").join("  \n ") + "  ";
    const result = parseMrzPassport(noisy);
    expect(result?.checkDigitsValid).toBe(true);
  });
});

describe("Maldivian NID heuristic parser", () => {
  it("extracts an ID number and labeled fields when present", () => {
    const text = [
      "REPUBLIC OF MALDIVES",
      "National ID Card",
      "Name: AHMED RASHEED",
      "Date of Birth: 15/06/1990",
      "ID Card No: A123456",
    ].join("\n");
    const result = parseMaldivianNid(text);
    expect(result).not.toBeNull();
    expect(result?.documentNumber).toBe("A123456");
    expect(result?.dateOfBirth).toBe("1990-06-15");
    expect(result?.fullName).toBe("AHMED RASHEED");
    expect(result?.confidence).toBe("low");
  });

  it("returns null for unrelated OCR text with no ID markers", () => {
    expect(parseMaldivianNid("some receipt text with no ID markers")).toBeNull();
  });
});
