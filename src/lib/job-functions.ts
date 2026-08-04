import type { PrismaClient, Prisma } from "@prisma/client";

type Client = PrismaClient | Prisma.TransactionClient;

// A user's JOB FUNCTION — their post at the property (Room Attendant, Technician, Front
// Office…) — as distinct from their ROLE, which is what the app lets them see and do.
//
// These were the same thing until 2026-08-04: the housekeeping board found its staff with
// `u.role.name === "Housekeeping"`, and maintenance did the same. That conflation is why
// a hotel could not give a housekeeper read access to Reservations without them vanishing
// from the room-assignment picker, and it breaks outright once a user can hold more than
// one role (see .agents/docs/USER_MANAGEMENT_PLAN.md).
//
// The list is a tenant-editable JOB_FUNCTION system code, so a property can add "Boat
// Captain" or "Pool Attendant". Two entries are special: HOUSEKEEPING and MAINTENANCE are
// what the assignment pickers filter on, so they are seeded for every enterprise and the
// code below is the single place those literals are written.

export const JOB_FUNCTION_CATEGORY = "JOB_FUNCTION";

/** The codes business logic depends on. Everything else is free-form tenant config. */
export const JOB_FUNCTION = {
  HOUSEKEEPING: "HOUSEKEEPING",
  MAINTENANCE: "MAINTENANCE",
} as const;

/**
 * Seeded for every enterprise. Deliberately mirrors the system ROLE names that were doing
 * this job before, so a tenant recognises the list and the backfill maps cleanly onto it.
 * A property may rename the labels, add to them, or deactivate the ones it doesn't use —
 * only the two codes above carry behaviour.
 */
export const DEFAULT_JOB_FUNCTIONS: { code: string; value: string; sortOrder: number }[] = [
  { code: "MANAGEMENT", value: "Management", sortOrder: 1 },
  { code: "FRONT_OFFICE", value: "Front Office", sortOrder: 2 },
  { code: "RESERVATIONS", value: "Reservations", sortOrder: 3 },
  { code: "CASHIER", value: "Cashier", sortOrder: 4 },
  { code: JOB_FUNCTION.HOUSEKEEPING, value: "Housekeeping", sortOrder: 5 },
  { code: JOB_FUNCTION.MAINTENANCE, value: "Maintenance", sortOrder: 6 },
  { code: "FOOD_BEVERAGE", value: "Food & Beverage", sortOrder: 7 },
  { code: "SPA", value: "Spa", sortOrder: 8 },
];

/**
 * Idempotent seeder, in the shape of ensureChargeTree/ensureFeeRules. Safe to call on
 * every property creation: `update: {}` means an existing code keeps whatever label and
 * sort order the tenant has since given it.
 */
export async function ensureJobFunctions(client: Client, enterpriseId: string): Promise<number> {
  let created = 0;
  for (const jf of DEFAULT_JOB_FUNCTIONS) {
    const before = await client.systemCode.findUnique({
      where: {
        enterpriseId_category_code: {
          enterpriseId,
          category: JOB_FUNCTION_CATEGORY,
          code: jf.code,
        },
      },
      select: { id: true },
    });
    if (before) continue;
    await client.systemCode.create({
      data: { enterpriseId, category: JOB_FUNCTION_CATEGORY, ...jf },
    });
    created++;
  }
  return created;
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
