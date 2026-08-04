import { describe, it, expect } from "vitest";
import {
  JOB_FUNCTION,
  JOB_FUNCTION_CATEGORY,
  DEFAULT_JOB_FUNCTIONS,
  staffWithJobFunction,
  housekeepingStaff,
  maintenanceStaff,
} from "@/lib/job-functions";

// A user's POST (job function) versus their ROLE (access). These were the same field
// until 2026-08-04: the housekeeping board found its staff with
// `role.name === "Housekeeping"`, so giving a housekeeper any extra access removed them
// from the room-assignment picker. These pin the separation.

const user = (over: Partial<{ id: string; jobFunction: string | null; isActive: boolean; role: string }>) => ({
  id: "u",
  jobFunction: null as string | null,
  isActive: true,
  role: "Front Desk",
  ...over,
});

describe("Selecting staff by post", () => {
  it("finds housekeepers by their post, whatever role they hold", () => {
    // The exact case the old role-name filter got wrong: a housekeeper who was also
    // given Front Desk access disappeared from the picker.
    const staff = [
      user({ id: "a", jobFunction: JOB_FUNCTION.HOUSEKEEPING, role: "Housekeeping" }),
      user({ id: "b", jobFunction: JOB_FUNCTION.HOUSEKEEPING, role: "Front Desk" }),
      user({ id: "c", jobFunction: JOB_FUNCTION.MAINTENANCE, role: "Housekeeping" }),
    ];
    expect(housekeepingStaff(staff).map((u) => u.id)).toEqual(["a", "b"]);
  });

  it("does not include someone merely because their ROLE is named Housekeeping", () => {
    const staff = [user({ id: "a", jobFunction: null, role: "Housekeeping" })];
    expect(housekeepingStaff(staff)).toEqual([]);
  });

  it("separates maintenance from housekeeping", () => {
    const staff = [
      user({ id: "a", jobFunction: JOB_FUNCTION.HOUSEKEEPING }),
      user({ id: "b", jobFunction: JOB_FUNCTION.MAINTENANCE }),
    ];
    expect(maintenanceStaff(staff).map((u) => u.id)).toEqual(["b"]);
    expect(housekeepingStaff(staff).map((u) => u.id)).toEqual(["a"]);
  });

  it("excludes deactivated staff", () => {
    const staff = [
      user({ id: "a", jobFunction: JOB_FUNCTION.HOUSEKEEPING, isActive: true }),
      user({ id: "b", jobFunction: JOB_FUNCTION.HOUSEKEEPING, isActive: false }),
    ];
    expect(housekeepingStaff(staff).map((u) => u.id)).toEqual(["a"]);
  });

  it("treats a missing isActive as active, so a slim payload still resolves", () => {
    expect(staffWithJobFunction([{ jobFunction: JOB_FUNCTION.HOUSEKEEPING }], JOB_FUNCTION.HOUSEKEEPING)).toHaveLength(1);
  });

  it("ignores users with no post rather than guessing one", () => {
    expect(housekeepingStaff([user({ jobFunction: null }), user({ jobFunction: "" })])).toEqual([]);
  });

  it("works for a tenant-defined post the app knows nothing about", () => {
    const staff = [user({ id: "a", jobFunction: "BOAT_CAPTAIN" })];
    expect(staffWithJobFunction(staff, "BOAT_CAPTAIN").map((u) => u.id)).toEqual(["a"]);
  });
});

describe("The seeded list", () => {
  it("includes the two codes business logic depends on", () => {
    const codes = DEFAULT_JOB_FUNCTIONS.map((j) => j.code);
    expect(codes).toContain(JOB_FUNCTION.HOUSEKEEPING);
    expect(codes).toContain(JOB_FUNCTION.MAINTENANCE);
  });

  it("has no duplicate codes — they are a unique key per enterprise", () => {
    const codes = DEFAULT_JOB_FUNCTIONS.map((j) => j.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("names the category the migration and the Controls list both use", () => {
    expect(JOB_FUNCTION_CATEGORY).toBe("JOB_FUNCTION");
  });
});
