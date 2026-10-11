import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveEregistrationLink, reservationIdsForLink } from "@/lib/eregistration/resolve-link";
import { isValidSignatureDataUrl } from "@/lib/eregistration/storage";
import { serializeChildrenInfo, parseChildrenInfo } from "@/lib/eregistration/slots";

type SlotLike = { isPrimary: boolean; existingProfileId: string | null };

// The lead guest's name is the booking's main point of reference, so the guest can't change
// it here — reception corrects it on the guest profile if it's wrong. Everyone else (and a
// lead with no profile yet) types their own.
const isNameLocked = (slot: SlotLike) => slot.isPrimary && !!slot.existingProfileId;

async function loadPrefillProfile(upid: string) {
  const p = await prisma.profile.findUnique({
    where: { upid },
    select: {
      firstName: true, middleName: true, lastName: true, dateOfBirth: true, nationality: true, gender: true,
      vipLevel: true, classification: true, totalStays: true, lastStayDate: true,
      communications: { select: { type: true, value: true, isPrimary: true }, orderBy: { createdAt: "asc" } },
      addresses: { select: { fullAddress: true, city: true, country: true, isPrimary: true }, orderBy: { createdAt: "asc" } },
      documents: {
        select: { documentType: true, documentNumber: true, issuingCountry: true, issueDate: true, expiryDate: true, isPrimary: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!p) return null;
  const pick = <T extends { isPrimary: boolean }>(rows: T[]) => rows.find((r) => r.isPrimary) ?? rows[0];
  const email = pick(p.communications.filter((c) => c.type === "EMAIL"));
  const mobile = pick(p.communications.filter((c) => c.type === "MOBILE"));
  const address = pick(p.addresses);
  const doc = pick(p.documents);
  return {
    firstName: p.firstName, middleName: p.middleName, lastName: p.lastName,
    dateOfBirth: p.dateOfBirth, nationality: p.nationality, gender: p.gender,
    email: email?.value ?? null, mobile: mobile?.value ?? null,
    addressFull: address?.fullAddress ?? null, addressCity: address?.city ?? null, addressCountry: address?.country ?? null,
    documentType: doc?.documentType ?? null, documentNumber: doc?.documentNumber ?? null,
    issuingCountry: doc?.issuingCountry ?? null, documentIssueDate: doc?.issueDate ?? null, documentExpiryDate: doc?.expiryDate ?? null,
    vipLevel: p.vipLevel, classification: p.classification, totalStays: p.totalStays, lastStayDate: p.lastStayDate,
  };
}

function guestMark(p: Awaited<ReturnType<typeof loadPrefillProfile>>): "VIP" | "RETURNING" | null {
  if (!p) return null;
  if (p.vipLevel || p.classification === "VIP") return "VIP";
  if (p.totalStays > 0 || p.lastStayDate) return "RETURNING";
  return null;
}

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

  // A guest already on the reservation has a Profile: whatever it holds fills the form
  // wherever the guest hasn't typed something themselves. Only this slot's own profile is
  // read, and only the fields the form shows.
  const profile = slot.existingProfileId ? await loadPrefillProfile(slot.existingProfileId) : null
  const nameLocked = isNameLocked(slot)

  return NextResponse.json({
    id: slot.id,
    slotIndex: slot.slotIndex,
    isPrimary: slot.isPrimary,
    status: slot.status,
    nameLocked,
    // Only a hint for a subtle "welcome back" touch — never the VIP level or stay history.
    guestMark: guestMark(profile),
    firstName: nameLocked ? profile?.firstName : slot.firstName ?? profile?.firstName ?? null,
    middleName: nameLocked ? profile?.middleName ?? null : slot.middleName ?? profile?.middleName ?? null,
    lastName: nameLocked ? profile?.lastName ?? null : slot.lastName ?? profile?.lastName ?? null,
    dateOfBirth: slot.dateOfBirth ?? profile?.dateOfBirth ?? null,
    nationality: slot.nationality ?? profile?.nationality ?? null,
    gender: slot.gender ?? profile?.gender ?? null,
    email: slot.email ?? profile?.email ?? null,
    mobile: slot.mobile ?? profile?.mobile ?? null,
    addressFull: slot.addressFull ?? profile?.addressFull ?? null,
    addressCity: slot.addressCity ?? profile?.addressCity ?? null,
    addressCountry: slot.addressCountry ?? profile?.addressCountry ?? null,
    documentType: slot.documentType ?? profile?.documentType ?? null,
    documentNumber: slot.documentNumber ?? profile?.documentNumber ?? null,
    issuingCountry: slot.issuingCountry ?? profile?.issuingCountry ?? null,
    documentIssueDate: slot.documentIssueDate ?? profile?.documentIssueDate ?? null,
    documentExpiryDate: slot.documentExpiryDate ?? profile?.documentExpiryDate ?? null,
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
  if (isNameLocked(slot)) {
    // Whatever the client sends, the lead guest's name stays the profile's.
    const profile = await prisma.profile.findUnique({ where: { upid: slot.existingProfileId! }, select: { firstName: true, middleName: true, lastName: true } });
    data.firstName = profile?.firstName ?? null;
    data.middleName = profile?.middleName ?? null;
    data.lastName = profile?.lastName ?? null;
  } else {
    if ("firstName" in body) data.firstName = clip(body.firstName);
    if ("middleName" in body) data.middleName = clip(body.middleName);
    if ("lastName" in body) data.lastName = clip(body.lastName);
  }
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
