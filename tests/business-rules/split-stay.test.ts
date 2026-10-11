import { describe, it, expect } from "vitest";
import {
  ratePlanAllocationWindows,
  serializeWindows,
  parseWindows,
  nightInWindows,
  allocationAmountForNight,
  allocationStayTotal,
} from "@/lib/allocations";
import { segmentForNight } from "@/lib/reservation-assignments";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const breakfast = {
  id: "bf", code: "BF", name: "Breakfast", mode: "ADD_TO_RATE", postingRhythm: "EVERY_NIGHT",
  rates: [{ adultPrice: 10, childPrice: 5, effectiveFrom: d("2020-01-01"), effectiveTo: null }],
};

describe("split stay: rate-plan allocation windows", () => {
  const segs = (links: string[][]) =>
    links.map((l, i) => ({ startDate: d(`2026-08-0${3 + i * 2}`), endDate: d(`2026-08-0${5 + i * 2}`), linkedAllocationIds: l }));

  it("covers the whole stay (null windows) when every segment's plan links it", () => {
    expect(ratePlanAllocationWindows(segs([["bf"], ["bf"]])).get("bf")).toBeNull();
  });

  it("covers only the segment whose plan links it", () => {
    const w = ratePlanAllocationWindows(segs([[], ["bf"]])).get("bf")!;
    expect(serializeWindows(w)).toBe("2026-08-05/2026-08-07");
    expect(nightInWindows(d("2026-08-04"), w)).toBe(false);
    expect(nightInWindows(d("2026-08-05"), w)).toBe(true);
    expect(nightInWindows(d("2026-08-07"), w)).toBe(false);
  });

  it("round-trips through the stored text", () => {
    const w = parseWindows("2026-08-03/2026-08-05,2026-08-09/2026-08-10")!;
    expect(w).toHaveLength(2);
    expect(parseWindows(null)).toBeNull();
  });

  it("only posts on its segment's nights, and bills a per-stay total for those nights only", () => {
    const w = ratePlanAllocationWindows(segs([[], ["bf"]])).get("bf")!;
    const base = { allocation: breakfast, adults: 2, children: 0, checkInDate: d("2026-08-03"), checkOutDate: d("2026-08-07"), windows: w };
    expect(allocationAmountForNight({ ...base, auditDate: d("2026-08-04") })).toBeNull();
    expect(allocationAmountForNight({ ...base, auditDate: d("2026-08-05") })).toBe(20);
    expect(allocationStayTotal(base)).toBe(40);
  });

  it("anchors an arrival-night rhythm to the segment that carries it", () => {
    const w = ratePlanAllocationWindows(segs([[], ["bf"]])).get("bf")!;
    const arrival = { ...breakfast, postingRhythm: "ARRIVAL_NIGHT" };
    const base = { allocation: arrival, adults: 1, children: 0, checkInDate: d("2026-08-03"), checkOutDate: d("2026-08-07"), windows: w };
    expect(allocationAmountForNight({ ...base, auditDate: d("2026-08-03") })).toBeNull();
    expect(allocationAmountForNight({ ...base, auditDate: d("2026-08-05") })).toBe(10);
  });
});

describe("segmentForNight", () => {
  const a = [
    { id: "late", startDate: d("2026-08-05"), endDate: d("2026-08-07") },
    { id: "early", startDate: d("2026-08-03"), endDate: d("2026-08-05") },
  ];
  it("picks the segment covering the night regardless of list order", () => {
    expect(segmentForNight(a, d("2026-08-04"))?.id).toBe("early");
    expect(segmentForNight(a, d("2026-08-05"))?.id).toBe("late");
  });
  it("falls back to the first segment before the stay and the newest after it", () => {
    expect(segmentForNight(a, d("2026-08-01"))?.id).toBe("early");
    expect(segmentForNight(a, d("2026-08-09"))?.id).toBe("late");
  });
});
