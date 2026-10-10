// What the booking screens ask when a save comes back 409 for a soft block. Two independent
// ones, either or both:
//   Overbook          — the room type has no free rooms (requiresOverbookConfirm).
//   Override Restriction — the night is under stop sale (requiresStopSaleOverride); only offered
//                       to users with Availability update access.
// Confirming resends the booking with the matching flag(s) set. See gateBookingConflicts in
// src/lib/restrictions.ts.

export type ConflictResponse = {
  error?: string;
  requiresOverbookConfirm?: boolean;
  requiresStopSaleOverride?: boolean;
  stopSaleMessage?: string;
  overbookMessage?: string;
};

export type ConflictPrompt = {
  title: string;
  description: string;
  confirmLabel: string;
};

const sentence = (s: string) => s.replace(/[.\s]+$/, "");

export function conflictPrompt(r: ConflictResponse): ConflictPrompt | null {
  const stop = !!r.requiresStopSaleOverride;
  const over = !!r.requiresOverbookConfirm;
  if (stop && over) {
    return {
      title: "Room not available and restricted",
      description: `${sentence(r.overbookMessage ?? "")}. ${sentence(r.stopSaleMessage ?? "")}. Continuing oversells the room type and overrides the stop sale — proceed anyway?`,
      confirmLabel: "Override & overbook",
    };
  }
  if (stop) {
    return {
      title: "Override stop sale?",
      description: `${sentence(r.stopSaleMessage ?? r.error ?? "")}. This room type is closed for sale on those dates — book it anyway?`,
      confirmLabel: "Override restriction",
    };
  }
  if (over) {
    return {
      title: "Overbook this room type?",
      description: `${sentence(r.overbookMessage ?? r.error ?? "")}. This will oversell the room type — proceed anyway?`,
      confirmLabel: "Overbook",
    };
  }
  return null;
}

/** The flags to resend with, given the response that was just confirmed. */
export function conflictFlags(r: ConflictResponse): { acknowledgeOverbook: boolean; overrideStopSale: boolean } {
  return { acknowledgeOverbook: !!r.requiresOverbookConfirm, overrideStopSale: !!r.requiresStopSaleOverride };
}
