import { createWorker } from "tesseract.js";

// Local OCR only — no image ever leaves this server. tesseract.js runs entirely in the
// Node runtime of the API route via WASM; the one network dependency is its own
// eng.traineddata fetch on first use, which it caches locally afterward.
export async function extractText(buffer: Buffer): Promise<string> {
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(buffer);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

// --- ICAO 9303 MRZ (machine-readable zone) — TD3 passport format ---------------------
//
// Two 44-character lines. Deterministic and checksummed, so a garbled OCR read can be
// detected rather than silently trusted:
//   Line 1: P<CCCSURNAME<<GIVEN<NAMES<<<<<<<<<<<<<<<<<<<<<<
//   Line 2: PASSPORT#(9)CD NATIONALITY(3) YYMMDD(6)CD SEX(1) YYMMDD(6)CD PERSONAL#(14)CD COMPOSITE-CD

export type MrzPassportFields = {
  documentNumber: string;
  issuingCountry: string;
  nationality: string;
  surname: string;
  givenNames: string;
  dateOfBirth: string | null; // ISO yyyy-mm-dd
  sex: "MALE" | "FEMALE" | "OTHER" | null;
  expiryDate: string | null; // ISO yyyy-mm-dd
  // False when the document number, date of birth, or expiry check digits don't match —
  // callers should treat the parse as unreliable (blurry photo, OCR misread) rather than
  // fill the form with it.
  checkDigitsValid: boolean;
};

const MRZ_CHAR_VALUES: Record<string, number> = { "<": 0 };
for (let i = 0; i <= 9; i++) MRZ_CHAR_VALUES[String(i)] = i;
for (let i = 0; i < 26; i++) MRZ_CHAR_VALUES[String.fromCharCode(65 + i)] = 10 + i;

function mrzCheckDigit(input: string): number {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < input.length; i++) {
    sum += (MRZ_CHAR_VALUES[input[i]] ?? 0) * weights[i % 3];
  }
  return sum % 10;
}

function mrzDateToIso(yymmdd: string, kind: "birth" | "expiry"): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = parseInt(yymmdd.slice(0, 2), 10);
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return null;
  const currentYy = new Date().getFullYear() % 100;
  // Births roll over to the 1900s once the two-digit year would otherwise read as being in
  // the future; expiry dates on a passport are effectively always 2000s-or-later.
  const century = kind === "birth" ? (yy > currentYy ? 1900 : 2000) : 2000;
  return `${century + yy}-${mm}-${dd}`;
}

export function parseMrzPassport(rawText: string): MrzPassportFields | null {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.toUpperCase().replace(/[^A-Z0-9<]/g, ""))
    .filter((l) => l.length >= 30);

  const normalize = (l: string) => (l.length >= 44 ? l.slice(0, 44) : l.padEnd(44, "<"));

  const line1Idx = lines.findIndex((l) => l.startsWith("P<"));
  if (line1Idx === -1) return null;
  const line1 = normalize(lines[line1Idx]);
  const line2Raw = lines[line1Idx + 1];
  if (!line2Raw) return null;
  const line2 = normalize(line2Raw);

  const issuingCountry = line1.slice(2, 5).replace(/</g, "");
  const nameField = line1.slice(5);
  const [surnameRaw, givenRaw = ""] = nameField.split("<<");
  const surname = surnameRaw.replace(/</g, " ").trim();
  const givenNames = givenRaw.replace(/</g, " ").trim().replace(/\s+/g, " ");

  const docNumberField = line2.slice(0, 9);
  const docNumberCheck = line2[9];
  const nationality = line2.slice(10, 13).replace(/</g, "");
  const dobField = line2.slice(13, 19);
  const dobCheck = line2[19];
  const sexChar = line2[20];
  const expiryField = line2.slice(21, 27);
  const expiryCheck = line2[27];

  const docNumberValid = String(mrzCheckDigit(docNumberField)) === docNumberCheck;
  const dobValid = String(mrzCheckDigit(dobField)) === dobCheck;
  const expiryValid = String(mrzCheckDigit(expiryField)) === expiryCheck;

  const documentNumber = docNumberField.replace(/</g, "");
  if (!documentNumber || !surname) return null;

  return {
    documentNumber,
    issuingCountry,
    nationality,
    surname,
    givenNames,
    dateOfBirth: mrzDateToIso(dobField, "birth"),
    sex: sexChar === "M" ? "MALE" : sexChar === "F" ? "FEMALE" : sexChar === "<" ? null : "OTHER",
    expiryDate: mrzDateToIso(expiryField, "expiry"),
    checkDigitsValid: docNumberValid && dobValid && expiryValid,
  };
}

// --- Maldivian National ID — best-effort heuristic ------------------------------------
//
// There's no MRZ or published field-position spec for this card in this codebase to parse
// against precisely, so this is a lower-confidence regex pass over the raw OCR text rather
// than a deterministic layout parser. Callers should surface it as "please review" rather
// than trust it outright the way a checksummed MRZ read can be.

export type MaldivianNidFields = {
  documentNumber: string | null;
  fullName: string | null;
  dateOfBirth: string | null; // ISO yyyy-mm-dd
  confidence: "low";
};

function normalizeDmy(raw: string): string | null {
  const parts = raw.split(/[/\-.]/);
  if (parts.length !== 3) return null;
  const [d, m, yRaw] = parts;
  const y = yRaw.length === 2 ? (parseInt(yRaw, 10) > 50 ? `19${yRaw}` : `20${yRaw}`) : yRaw;
  const dd = d.padStart(2, "0");
  const mm = m.padStart(2, "0");
  if (Number(dd) > 31 || Number(mm) > 12) return null;
  return `${y}-${mm}-${dd}`;
}

export function parseMaldivianNid(rawText: string): MaldivianNidFields | null {
  const text = rawText.replace(/\r/g, "");
  const isMaldivian = /REPUBLIC\s+OF\s+MALDIVES|MALDIVES/i.test(text);
  // The commonly-seen Maldivian NID number shape: one letter followed by 6-7 digits.
  const idMatch = text.match(/\b([A-Z]\d{6,7})\b/);
  const dobMatch =
    text.match(/(?:date of birth|dob)[^\d]{0,10}(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})/i) ??
    text.match(/\b(\d{1,2}[/\-.]\d{1,2}[/\-.](?:19|20)\d{2})\b/);
  const nameMatch = text.match(/name[:\s]+([A-Z][A-Za-z .'-]{2,60})/i);

  if (!isMaldivian && !idMatch) return null;

  return {
    documentNumber: idMatch ? idMatch[1] : null,
    fullName: nameMatch ? nameMatch[1].trim() : null,
    dateOfBirth: dobMatch ? normalizeDmy(dobMatch[1]) : null,
    confidence: "low",
  };
}
