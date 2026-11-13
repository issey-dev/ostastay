// Group block status state machine.
//
//   TENTATIVE ─▶ DEFINITE ─▶ CANCELLED
//        │  │         └──────▶ (terminal)
//        │  └──▶ LOST (deal fell through — pricing/etc.; from TENTATIVE only)
//        └─────▶ CANCELLED (hotel can't accommodate)
//
// A block starts TENTATIVE or DEFINITE. DEFINITE can't regress to TENTATIVE. LOST and
// CANCELLED are terminal. "Lost" tracks a deal we didn't win; "Cancelled" is the hotel
// pulling the block (e.g. unavailability).
//
// Agent Portal plan A-7 (Phase 4): a Source's slot request is a block in REQUESTED. It holds
// nothing. Staff approve it (→ TENTATIVE, availability checked then) or decline it
// (→ DECLINED, terminal; an agent withdrawing lands here too). Approval goes through
// src/lib/groups/slot-requests.ts, never a plain status change.
export const GROUP_STATUSES = ["REQUESTED", "TENTATIVE", "DEFINITE", "LOST", "CANCELLED", "DECLINED"] as const
export type GroupStatus = (typeof GROUP_STATUSES)[number]

export const GROUP_START_STATUSES: GroupStatus[] = ["TENTATIVE", "DEFINITE"]

// Allowed target statuses from each current status (includes staying put).
export const GROUP_STATUS_TRANSITIONS: Record<GroupStatus, GroupStatus[]> = {
  REQUESTED: ["REQUESTED"],
  DECLINED: ["DECLINED"],
  TENTATIVE: ["TENTATIVE", "DEFINITE", "LOST", "CANCELLED"],
  DEFINITE: ["DEFINITE", "CANCELLED"],
  LOST: ["LOST"],
  CANCELLED: ["CANCELLED"],
}

// Statuses that release the block (no live commitment) — they can't carry active pickups.
export const GROUP_RELEASING_STATUSES: GroupStatus[] = ["LOST", "CANCELLED", "DECLINED"]

// Statuses whose holds count against availability. A request holds nothing.
export const GROUP_HOLDING_STATUSES: GroupStatus[] = ["TENTATIVE", "DEFINITE"]

export const GROUP_STATUS_LABEL: Record<GroupStatus, string> = {
  REQUESTED: "Slot request",
  DECLINED: "Declined",
  TENTATIVE: "Tentative",
  DEFINITE: "Definite",
  LOST: "Lost",
  CANCELLED: "Cancelled",
}

export function canTransitionGroupStatus(from: string, to: string): boolean {
  const allowed = GROUP_STATUS_TRANSITIONS[from as GroupStatus]
  return !!allowed && allowed.includes(to as GroupStatus)
}
