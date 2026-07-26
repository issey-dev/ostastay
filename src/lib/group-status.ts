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
export const GROUP_STATUSES = ["TENTATIVE", "DEFINITE", "LOST", "CANCELLED"] as const
export type GroupStatus = (typeof GROUP_STATUSES)[number]

export const GROUP_START_STATUSES: GroupStatus[] = ["TENTATIVE", "DEFINITE"]

// Allowed target statuses from each current status (includes staying put).
export const GROUP_STATUS_TRANSITIONS: Record<GroupStatus, GroupStatus[]> = {
  TENTATIVE: ["TENTATIVE", "DEFINITE", "LOST", "CANCELLED"],
  DEFINITE: ["DEFINITE", "CANCELLED"],
  LOST: ["LOST"],
  CANCELLED: ["CANCELLED"],
}

// Statuses that release the block (no live commitment) — they can't carry active pickups.
export const GROUP_RELEASING_STATUSES: GroupStatus[] = ["LOST", "CANCELLED"]

export const GROUP_STATUS_LABEL: Record<GroupStatus, string> = {
  TENTATIVE: "Tentative",
  DEFINITE: "Definite",
  LOST: "Lost",
  CANCELLED: "Cancelled",
}

export function canTransitionGroupStatus(from: string, to: string): boolean {
  const allowed = GROUP_STATUS_TRANSITIONS[from as GroupStatus]
  return !!allowed && allowed.includes(to as GroupStatus)
}
