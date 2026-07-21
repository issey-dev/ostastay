// Shared helpers over a reservation's room-assignment segments — used by both the
// create/update API routes (validation + hasScheduledRoomMove) and, conceptually,
// mirrored by the booking form's client-side reconcile logic.

type AssignmentLike = { startDate: string | Date; endDate: string | Date; roomId?: string | null }

function byStart<T extends AssignmentLike>(assignments: T[]): T[] {
  return [...assignments].sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
}

// Hard rule: a split-stay's segments must run back-to-back with no gaps — segment
// N's arrival must exactly equal segment N-1's departure.
export function assignmentsAreContiguous(assignments: AssignmentLike[]): boolean {
  const sorted = byStart(assignments)
  for (let i = 1; i < sorted.length; i++) {
    if (new Date(sorted[i].startDate).getTime() !== new Date(sorted[i - 1].endDate).getTime()) return false
  }
  return true
}

// True when any two date-adjacent segments assign different physical rooms — i.e.
// the stay itself requires a mid-stay room change on a known future date.
export function detectScheduledRoomMove(assignments: AssignmentLike[]): boolean {
  const sorted = byStart(assignments)
  for (let i = 1; i < sorted.length; i++) {
    const prevRoomId = sorted[i - 1].roomId
    const roomId = sorted[i].roomId
    if (prevRoomId && roomId && prevRoomId !== roomId) return true
  }
  return false
}
