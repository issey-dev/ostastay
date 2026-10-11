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

// The segment a given night belongs to. Routes load assignments newest-first, so
// `assignments[0]` is the LAST segment — right for "extend the stay", wrong for "where is
// the guest tonight" once a stay has several segments. Falls back to the newest segment
// that had started, then to the first one (a night before the stay's first segment).
export function segmentForNight<T extends { startDate: string | Date; endDate: string | Date }>(assignments: T[], night: Date): T | undefined {
  const day = (d: string | Date) => {
    const x = new Date(d)
    return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate())
  }
  const n = day(night)
  const sorted = byStart(assignments)
  return (
    sorted.find((a) => day(a.startDate) <= n && n < day(a.endDate)) ??
    [...sorted].reverse().find((a) => day(a.startDate) <= n) ??
    sorted[0]
  )
}
