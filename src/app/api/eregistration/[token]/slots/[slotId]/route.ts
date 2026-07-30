import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveEregistrationLink, reservationIdsForLink } from "@/lib/eregistration/resolve-link";
import { isValidSignatureDataUrl } from "@/lib/eregistration/storage";
import { serializeChildrenInfo, parseChildrenInfo } from "@/lib/eregistration/slots";

// Rehydrates a draft form after a refresh/re-open. Full field detail is only ever
// returned while the slot is still PENDING (still theirs to edit) — once SUBMITTED or
// APPLIED, this returns the same narrow shape as the landing list, because the shared
// link means anyone could otherwise request another guest's already-locked slot by id
// and read their address/ID number/photo reference/signature.
export async function GET(request: Request, { params }: { params: Promise<{ token: string; slotId: string }> }) {
  const { token, slotId } = await params;
  const resolution = await resolveEregistrationLink(token);
  if (!resolution.ok) return NextResponse.json({ error: resolution.error }, { status: resolution.status });
  const { link } = resolution;

  const reservationIds = await reservationIdsForLink(link);
  const slot = await prisma.eRegistrationGuestSlot.findFirst({ where: { id: slotId, reservationId: { in: reservationIds } } });
  if (!slot) return NextResponse.json({ error: "Guest slot not found" }, { status: 404 });

  if (slot.status !== "PENDING") {
    return NextResponse.json({ id: slot.id, slotIndex: slot.slotIndex, isPrimary: slot.isPrimary, status: slot.status });
  }

  return NextResponse.json({
    id: slot.id,
    slotIndex: slot.slotIndex,
    isPrimary: slot.isPrimary,
    status: slot.status,
    firstName: slot.firstName,
    middleName: slot.middleName,
    lastName: slot.lastName,
    dateOfBirth: slot.dateOfBirth,
    nationality: slot.nationality,
    gender: slot.gender,
    email: slot.email,
    mobile: slot.mobile,
    addressFull: slot.addressFull,
    addressCity: slot.addressCity,
    addressCountry: slot.addressCountry,
    documentType: slot.documentType,
    documentNumber: slot.documentNumber,
    issuingCountry: slot.issuingCountry,
    documentIssueDate: slot.documentIssueDate,
    documentExpiryDate: slot.documentExpiryDate,
    hasPhoto: !!slot.idPhotoPath,
    signatureDataUrl: slot.signatureDataUrl,
    childrenInfo: slot.isPrimary ? parseChildrenInfo(slot.childrenInfo) : [],
  });
}

const MAX_TEXT = 200;
const clip = (v: unknown) => (typeof v === "string" ? v.slice(0, MAX_TEXT).trim() || null : null);
const clipLong = (v: unknown) => (typeof v === "string" ? v.slice(0, 2000).trim() || null : null);
const parseDate = (v: unknown) => (typeof v === "string" && v.trim() ? new Date(v) : null);

// Draft save — repeatable, safe to call from a flaky mobile connection. Only PENDING
// slots can be touched; a SUBMITTED/APPLIED slot 409s until staff explicitly reopen it
// (see the staff-facing .../slots/[slotId]/reopen route) — this is what makes the
// multi-tab / multi-session race safe: once locked, nothing but an explicit staff
// action can unlock it again.
export async function PATCH(request: Request, { params }: { params: Promise<{ token: string; slotId: string }> }) {
  const { token, slotId } = await params;
  const resolution = await resolveEregistrationLink(token);
  if (!resolution.ok) return NextResponse.json({ error: resolution.error }, { status: resolution.status });
  const { link } = resolution;

  const reservationIds = await reservationIdsForLink(link);
  const slot = await prisma.eRegistrationGuestSlot.findFirst({ where: { id: slotId, reservationId: { in: reservationIds } } });
  if (!slot) return NextResponse.json({ error: "Guest slot not found" }, { status: 404 });
  if (slot.status !== "PENDING") {
    return NextResponse.json({ error: "This guest's details have already been submitted and can no longer be edited here." }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if ("firstName" in body) data.firstName = clip(body.firstName);
  if ("middleName" in body) data.middleName = clip(body.middleName);
  if ("lastName" in body) data.lastName = clip(body.lastName);
  if ("dateOfBirth" in body) data.dateOfBirth = parseDate(body.dateOfBirth);
  if ("nationality" in body) data.nationality = clip(body.nationality);
  if ("gender" in body) data.gender = clip(body.gender);
  if ("email" in body) data.email = clip(body.email);
  if ("mobile" in body) data.mobile = clip(body.mobile);
  if ("addressFull" in body) data.addressFull = clipLong(body.addressFull);
  if ("addressCity" in body) data.addressCity = clip(body.addressCity);
  if ("addressCountry" in body) data.addressCountry = clip(body.addressCountry);
  if ("documentType" in body) data.documentType = clip(body.documentType);
  if ("documentNumber" in body) data.documentNumber = clip(body.documentNumber);
  if ("issuingCountry" in body) data.issuingCountry = clip(body.issuingCountry);
  if ("documentIssueDate" in body) data.documentIssueDate = parseDate(body.documentIssueDate);
  if ("documentExpiryDate" in body) data.documentExpiryDate = parseDate(body.documentExpiryDate);

  if ("signatureDataUrl" in body) {
    if (body.signatureDataUrl === null) {
      data.signatureDataUrl = null;
    } else if (isValidSignatureDataUrl(body.signatureDataUrl)) {
      data.signatureDataUrl = body.signatureDataUrl;
    } else {
      return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
    }
  }

  // Declared children only make sense attached to the primary guest of a reservation —
  // every other slot's form never shows this section, so this is a defense-in-depth
  // check, not the only guard.
  if ("childrenInfo" in body) {
    if (!slot.isPrimary) {
      return NextResponse.json({ error: "Only the primary guest can declare accompanying children." }, { status: 400 });
    }
    data.childrenInfo = Array.isArray(body.childrenInfo) ? serializeChildrenInfo(body.childrenInfo) : null;
  }

  const updated = await prisma.eRegistrationGuestSlot.update({ where: { id: slotId }, data });
  return NextResponse.json(updated);
}
