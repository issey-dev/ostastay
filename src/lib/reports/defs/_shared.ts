import type { ReportRunContext } from "@/lib/reports/types";

// Helpers shared across report definition modules.

export function guestName(
  p: { firstName: string; lastName: string | null; companyName: string | null; profileType: string } | null
): string {
  if (!p) return "—";
  if (p.profileType === "COMPANY" || p.profileType === "TRAVEL_AGENT") return p.companyName ?? "—";
  return `${p.firstName} ${p.lastName ?? ""}`.trim();
}

export function nights(checkIn: Date, checkOut: Date): number {
  return Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000));
}

export function isVip(p: { vipLevel: string | null; classification: string } | null): boolean {
  return !!p && (!!p.vipLevel || p.classification === "VIP");
}

export function primaryRoom(assignments: { room: { roomNumber: string } | null }[]): string {
  return assignments.map((a) => a.room?.roomNumber).filter(Boolean).join(", ") || "—";
}

export function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
}

export async function propertyOrThrow(rc: ReportRunContext): Promise<string> {
  if (!rc.propertyId) throw new Error("A property must be selected for this report.");
  return rc.propertyId;
}

export const guestSelect = {
  select: {
    firstName: true, lastName: true, companyName: true, profileType: true,
    vipLevel: true, classification: true, dateOfBirth: true, anniversaryDate: true, nationality: true,
  },
} as const;

export const assignmentInclude = {
  orderBy: { startDate: "asc" as const },
  include: { roomType: { select: { name: true } }, room: { select: { roomNumber: true } } },
};
