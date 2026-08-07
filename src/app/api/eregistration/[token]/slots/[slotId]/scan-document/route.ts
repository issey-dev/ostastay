import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveEregistrationLink, reservationIdsForLink } from "@/lib/eregistration/resolve-link";
import { sniffImageType, MAX_UPLOAD_BYTES } from "@/lib/eregistration/storage";
import { extractText, parseMrzPassport, parseMaldivianNid } from "@/lib/eregistration/ocr";
import { countryNameFor } from "@/lib/countries";

// Experimental auto-fill: OCR's an uploaded ID photo and returns best-guess fields for the
// client to offer as suggestions — this never writes to the slot itself, so a bad/blurry
// read can't corrupt saved draft data. Runs entirely server-side (tesseract.js, no cloud
// vision API), same public/token-scoped shape as the sibling /photo route.
export async function POST(request: Request, { params }: { params: Promise<{ token: string; slotId: string }> }) {
  const { token, slotId } = await params;
  const resolution = await resolveEregistrationLink(token);
  if (!resolution.ok) return NextResponse.json({ error: resolution.error }, { status: resolution.status });
  const { link } = resolution;

  const reservationIds = await reservationIdsForLink(link);
  const slot = await prisma.eRegistrationGuestSlot.findFirst({ where: { id: slotId, reservationId: { in: reservationIds } } });
  if (!slot) return NextResponse.json({ error: "Guest slot not found" }, { status: 404 });
  if (slot.status !== "PENDING") {
    return NextResponse.json({ error: "This guest's details have already been submitted." }, { status: 409 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_UPLOAD_BYTES * 1.4) {
    return NextResponse.json({ error: "File is too large." }, { status: 413 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("photo");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0 || buffer.length > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File exceeds the 10MB limit" }, { status: 400 });
  }
  if (!sniffImageType(buffer)) {
    return NextResponse.json({ error: "Unsupported file type — only JPEG, PNG, WEBP, or HEIC images are accepted" }, { status: 400 });
  }

  let text: string;
  try {
    text = await extractText(buffer);
  } catch {
    return NextResponse.json({ error: "Couldn't read that image — try a clearer, well-lit photo." }, { status: 422 });
  }

  const passport = parseMrzPassport(text);
  if (passport && passport.checkDigitsValid) {
    return NextResponse.json({
      documentType: "PASSPORT",
      confidence: "high",
      fields: {
        firstName: passport.givenNames || null,
        lastName: passport.surname || null,
        dateOfBirth: passport.dateOfBirth,
        gender: passport.sex,
        // MRZ codes are ISO alpha-3 ("GBR") — resolve to a readable name ("United
        // Kingdom") before handing this to the guest form; falls back to the raw code
        // if it's somehow unrecognized rather than dropping the field.
        nationality: countryNameFor(passport.nationality),
        issuingCountry: countryNameFor(passport.issuingCountry),
        documentNumber: passport.documentNumber,
        documentExpiryDate: passport.expiryDate,
      },
    });
  }

  const nid = parseMaldivianNid(text);
  if (nid && (nid.documentNumber || nid.fullName)) {
    const nameParts = (nid.fullName ?? "").split(/\s+/).filter(Boolean);
    const [firstName, ...rest] = nameParts;
    return NextResponse.json({
      documentType: "NATIONAL_ID",
      confidence: "low",
      fields: {
        firstName: firstName || null,
        lastName: rest.length ? rest.join(" ") : null,
        dateOfBirth: nid.dateOfBirth,
        documentNumber: nid.documentNumber,
        issuingCountry: nid.documentNumber ? "Maldives" : null,
      },
    });
  }

  return NextResponse.json(
    { error: "Couldn't detect a passport or Maldivian ID in that photo — please enter your details manually." },
    { status: 422 }
  );
}
