import { describe, it, expect } from "vitest";
import { parseDateKey, toDateKey } from "@/lib/date-only";

// Regression for "I pick the 23rd and the form gets the 22nd": the calendar returns
// LOCAL midnight, and `toISOString()` shifted it into the previous UTC day for any zone
// east of Greenwich (the app runs at UTC+5). These helpers must never cross a zone,
// whatever zone the test machine is in.
describe("date-only values", () => {
  it("serialises a picked day as that same day", () => {
    // What react-day-picker hands back when the user clicks 23 Sep 2026.
    const picked = new Date(2026, 8, 23);
    expect(toDateKey(picked)).toBe("2026-09-23");
  });

  it("reads a stored yyyy-MM-dd as local midnight of that day", () => {
    const d = parseDateKey("2026-09-23")!;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 8, 23, 0]);
  });

  it("reads a database date (UTC midnight ISO string or Date) as its own day", () => {
    expect(toDateKey(parseDateKey("2026-09-23T00:00:00.000Z")!)).toBe("2026-09-23");
    expect(toDateKey(parseDateKey(new Date(Date.UTC(2026, 8, 23)))!)).toBe("2026-09-23");
  });

  it("round-trips: pick → store → show highlights the same day", () => {
    for (let day = 1; day <= 30; day++) {
      const picked = new Date(2026, 8, day);
      expect(parseDateKey(toDateKey(picked))!.getTime()).toBe(picked.getTime());
    }
  });

  it("treats empty and invalid input as no date", () => {
    expect(parseDateKey("")).toBeUndefined();
    expect(parseDateKey(null)).toBeUndefined();
    expect(parseDateKey("not a date")).toBeUndefined();
  });
});
