// A user's JOB FUNCTION — their post at the property (Room Attendant, Technician, Front
// Office…) — as distinct from their ROLE, which is what the app lets them see and do.
//
// These were the same thing until 2026-08-04: the housekeeping board found its staff with
// `u.role.name === "Housekeeping"`, and maintenance did the same. That conflation is why
// a hotel could not give a housekeeper read access to Reservations without them vanishing
// from the room-assignment picker, and it breaks outright once a user can hold more than
// one role (see .agents/docs/USER_MANAGEMENT_PLAN.md).
//
// A FIXED list (owner, 2026-09-25): it is picked on the People form when a user is created
// or edited, and there is nothing to set up. Until then it was an enterprise-editable
// JOB_FUNCTION dropdown list in the Hub — a list of posts to pick from, which duplicated the
// field on People and, left empty, gave the People form nothing to offer. Two entries carry
// behaviour: HOUSEKEEPING and MAINTENANCE are what the assignment pickers filter on, and this
// file is the single place those literals are written.

/** The codes business logic depends on. */
export const JOB_FUNCTION = {
  HOUSEKEEPING: "HOUSEKEEPING",
  MAINTENANCE: "MAINTENANCE",
} as const;

/** Every post a user can hold, in display order. */
export const JOB_FUNCTIONS: { code: string; label: string }[] = [
  { code: "MANAGEMENT", label: "Management" },
  { code: "FRONT_OFFICE", label: "Front Office" },
  { code: "RESERVATIONS", label: "Reservations" },
  { code: "CASHIER", label: "Cashier" },
  { code: JOB_FUNCTION.HOUSEKEEPING, label: "Housekeeping" },
  { code: JOB_FUNCTION.MAINTENANCE, label: "Maintenance" },
  { code: "FOOD_BEVERAGE", label: "Food & Beverage" },
  { code: "SPA", label: "Spa" },
];

export function isJobFunction(code: string): boolean {
  return JOB_FUNCTIONS.some((j) => j.code === code);
}

/** "HOUSEKEEPING" → "Housekeeping"; an unknown stored code is shown as it is. */
export function jobFunctionLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return JOB_FUNCTIONS.find((j) => j.code === code)?.label ?? code;
}

/** Shape the assignment pickers need — deliberately minimal. */
export type StaffLike = { isActive?: boolean | null; jobFunction?: string | null };

/**
 * Who may be assigned housekeeping / maintenance work.
 *
 * One predicate rather than a `.filter(...)` repeated in three components, so widening it
 * later (a supervisor who also cleans, say) is one edit rather than a hunt.
 */
export function staffWithJobFunction<T extends StaffLike>(users: T[], jobFunction: string): T[] {
  return users.filter((u) => u.isActive !== false && u.jobFunction === jobFunction);
}

export const housekeepingStaff = <T extends StaffLike>(users: T[]): T[] =>
  staffWithJobFunction(users, JOB_FUNCTION.HOUSEKEEPING);

export const maintenanceStaff = <T extends StaffLike>(users: T[]): T[] =>
  staffWithJobFunction(users, JOB_FUNCTION.MAINTENANCE);
