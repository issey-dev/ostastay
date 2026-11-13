import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { prisma } from "@/lib/db";
import { DEEP_MAROON, OBSIDIAN_BLACK, STEEL_SLATE } from "@/lib/brand";
import type { BOOKING_INCLUDE } from "@/lib/agent-api/bookings";
import type { Prisma } from "@prisma/client";

// The booking confirmation an agent generates for their client (Agent Portal plan A-17).
// Produced by the PMS so the document the guest carries matches what the desk sees: the
// property's name and contact, the Source's name and file number, the stay, the guests,
// and a version number (a re-issue after a change is a new version). A tentative booking
// produces an "OPTION — NOT A CONFIRMATION" document. No price unless the agent asks for
// it (agents often resell at their own price). Sent to the agent, never to the client.

type Row = Prisma.ReservationGetPayload<{ include: typeof BOOKING_INCLUDE }>;

function hex(c: string) {
  const n = parseInt(c.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
const fmt = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

export async function buildConfirmationPdf(r: Row, opts: { showPrice: boolean; sourceName: string; price?: number | null; currency?: string }): Promise<Uint8Array> {
  const settings = await prisma.propertySettings.findUnique({ where: { propertyId: r.property.id }, select: { confirmationLetterMessage: true } });
  const property = await prisma.property.findUniqueOrThrow({ where: { id: r.property.id }, select: { name: true, checkInTime: true, checkOutTime: true, defaultCurrency: true } });
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const tentative = r.status === "TENTATIVE";
  let y = 790;
  const text = (p: PDFPage, s: string, x: number, size: number, f: PDFFont = font, color = hex(OBSIDIAN_BLACK)) => p.drawText(s, { x, y, size, font: f, color });

  text(page, property.name, 50, 20, bold, hex(DEEP_MAROON));
  y -= 26;
  text(page, tentative ? "OPTION - NOT A CONFIRMATION" : "BOOKING CONFIRMATION", 50, 13, bold);
  text(page, `Version ${r.agentConfirmationVersion}`, 470, 9, font, hex(STEEL_SLATE));
  y -= 14;
  page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 1, color: hex(STEEL_SLATE) });
  y -= 24;

  const rows: [string, string][] = [
    ["Booked by", opts.sourceName],
    ["Agent reference", [r.agentReference, r.agentRef].filter(Boolean).join("  /  ")],
    ["Hotel confirmation", tentative ? "Pending" : r.confirmationNo],
    ["Lead guest", `${r.primaryGuest.firstName} ${r.primaryGuest.lastName ?? ""}`.trim()],
    ["Guests", [`${r.adults} adult${r.adults === 1 ? "" : "s"}`, r.children ? `${r.children} child${r.children === 1 ? "" : "ren"}` : null].filter(Boolean).join(", ")],
    ["Arrival", `${fmt(r.checkInDate)}  (check-in from ${property.checkInTime})`],
    ["Departure", `${fmt(r.checkOutDate)}  (check-out by ${property.checkOutTime})`],
    ["Room", r.assignments[0]?.roomType.name ?? ""],
    ["Meal plan", r.mealPlan && r.mealPlan !== "NONE" ? r.mealPlan : "Room only"],
    ...(r.packageName ? ([["Package", r.packageName]] as [string, string][]) : []),
    ...(tentative && r.optionDate ? ([["Option valid until", fmt(r.optionDate)]] as [string, string][]) : []),
    ...(r.isOverflow ? ([["Accommodated at", r.overflowHotelName ?? "a partner hotel"]] as [string, string][]) : []),
    ...(opts.showPrice && opts.price != null ? ([["Total", `${opts.currency ?? property.defaultCurrency} ${opts.price.toFixed(2)}`]] as [string, string][]) : []),
  ];
  for (const [k, v] of rows) {
    text(page, k, 50, 10, font, hex(STEEL_SLATE));
    text(page, v.slice(0, 80), 200, 11, bold);
    y -= 20;
  }

  const names = r.accompanyingGuests.map((g) => `${g.profile.firstName} ${g.profile.lastName ?? ""}`.trim());
  if (names.length) {
    y -= 6;
    text(page, "Travelling with", 50, 10, font, hex(STEEL_SLATE));
    for (const n of names.slice(0, 10)) {
      text(page, n, 200, 11);
      y -= 16;
    }
  }
  const legs = r.transports.filter((t) => t.carrierCode || t.carrierTime);
  if (legs.length) {
    y -= 6;
    for (const t of legs) {
      text(page, t.direction === "DROPOFF" ? "Departure flight" : "Arrival flight", 50, 10, font, hex(STEEL_SLATE));
      text(page, [t.carrierCode, t.carrierTime ? t.carrierTime.toISOString().slice(0, 16).replace("T", " ") : null].filter(Boolean).join("  "), 200, 11);
      y -= 18;
    }
  }
  if (r.remarks) {
    y -= 6;
    text(page, "Requests", 50, 10, font, hex(STEEL_SLATE));
    for (const line of wrap(r.remarks, 70).slice(0, 6)) {
      text(page, line, 200, 10);
      y -= 14;
    }
  }
  const message = settings?.confirmationLetterMessage;
  if (message && !tentative) {
    y -= 16;
    for (const line of wrap(message, 95).slice(0, 10)) {
      text(page, line, 50, 9, font, hex(STEEL_SLATE));
      y -= 12;
    }
  }
  y = 60;
  text(
    page,
    tentative
      ? "This booking is held on option and is not confirmed until the hotel confirms it."
      : "Requests are passed to the hotel and are subject to availability on arrival.",
    50,
    8,
    font,
    hex(STEEL_SLATE)
  );
  return doc.save();
}

function wrap(s: string, width: number): string[] {
  const out: string[] = [];
  for (const para of s.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if ((line + " " + word).trim().length > width) {
        out.push(line.trim());
        line = word;
      } else line = `${line} ${word}`;
    }
    if (line.trim()) out.push(line.trim());
  }
  return out;
}
