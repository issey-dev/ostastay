import { describe, it, expect } from "vitest";
import {
  groupChargeCodesByHierarchy,
  triStateOf,
  describeSelection,
  chargeCodeMatches,
  type ChargeCodeLike,
} from "@/lib/charge-code-options";

// Shaping behind the Routing modal's grouped checklist (redesign, 2026-08-03). The old
// picker was a flat wall of numeric chips: it could not show what a code WAS, and the
// standard chart is 48 codes. These pin the grouping, the tri-state toggles and the
// footer summary — all pure, so they run without a database.

const code = (
  id: string,
  c: string,
  description: string,
  group: string | null,
  sub: string | null,
  groupSort = 1,
  subSort = 1
): ChargeCodeLike => ({
  id,
  code: c,
  description,
  isActive: true,
  postingType: "REVENUE",
  chargeSubgroup: sub
    ? {
        name: sub,
        sortOrder: subSort,
        chargeGroup: group ? { name: group, sortOrder: groupSort, reportBucket: "ROOM" } : null,
      }
    : null,
});

const CHART: ChargeCodeLike[] = [
  code("a", "1000", "Room charge", "Room & lodging", "Accommodation", 1, 1),
  code("b", "1010", "Extra bed", "Room & lodging", "Accommodation", 1, 1),
  code("c", "1020", "Late check-out", "Room & lodging", "Other room", 1, 2),
  code("d", "2001", "Restaurant — breakfast", "Food & beverage", "Restaurant", 2, 1),
  code("e", "2002", "Restaurant — lunch", "Food & beverage", "Restaurant", 2, 1),
  code("f", "2901", "Minibar", "Food & beverage", "Minibar", 2, 2),
];

describe("Grouping charge codes into the picker's tree", () => {
  it("nests Group → Subgroup → code, in the chart's own order", () => {
    const groups = groupChargeCodesByHierarchy(CHART);
    expect(groups.map((g) => g.name)).toEqual(["Room & lodging", "Food & beverage"]);
    expect(groups[0].subgroups.map((s) => s.name)).toEqual(["Accommodation", "Other room"]);
    expect(groups[1].subgroups.map((s) => s.name)).toEqual(["Restaurant", "Minibar"]);
  });

  it("flattens every code onto its group, so a group toggle covers all of them", () => {
    const groups = groupChargeCodesByHierarchy(CHART);
    expect(groups[0].codes.map((c) => c.code)).toEqual(["1000", "1010", "1020"]);
    expect(groups[1].codes).toHaveLength(3);
  });

  it("keeps an unclassified code visible rather than dropping it", () => {
    // A picker that silently omits a code is worse than one showing it in a catch-all:
    // the operator cannot tell "not routable" from "missing".
    const groups = groupChargeCodesByHierarchy([...CHART, code("z", "9999", "Orphan", null, null)]);
    const orphan = groups.find((g) => g.name === "Unclassified");
    expect(orphan).toBeTruthy();
    expect(orphan!.codes.map((c) => c.code)).toEqual(["9999"]);
  });

  it("loses nothing — every input code appears exactly once", () => {
    const groups = groupChargeCodesByHierarchy(CHART);
    const seen = groups.flatMap((g) => g.subgroups.flatMap((s) => s.codes.map((c) => c.id)));
    expect(seen.sort()).toEqual(CHART.map((c) => c.id).sort());
  });

  it("returns nothing for an empty chart rather than an empty group", () => {
    expect(groupChargeCodesByHierarchy([])).toEqual([]);
  });
});

describe("Tri-state group toggle", () => {
  it("reports all / some / none against the selection", () => {
    expect(triStateOf(["a", "b"], new Set(["a", "b"]))).toBe("all");
    expect(triStateOf(["a", "b"], new Set(["a"]))).toBe("some");
    expect(triStateOf(["a", "b"], new Set())).toBe("none");
  });

  it("treats an empty group as unselected, never as 'all'", () => {
    // "all of nothing" would render a ticked box the operator cannot untick.
    expect(triStateOf([], new Set(["a"]))).toBe("none");
  });

  it("ignores selected ids that aren't in the group", () => {
    expect(triStateOf(["a"], new Set(["a", "zzz"]))).toBe("all");
  });
});

describe("Footer selection summary", () => {
  const groups = groupChargeCodesByHierarchy(CHART);

  it("is empty when nothing is selected", () => {
    expect(describeSelection(groups, new Set())).toBe("");
  });

  it("names a whole group once every code in it is selected", () => {
    const all = new Set(["a", "b", "c"]);
    expect(describeSelection(groups, all)).toBe("Room & lodging (all)");
  });

  it("lists individual codes that aren't part of a fully-selected group", () => {
    expect(describeSelection(groups, new Set(["a", "d"]))).toBe("1000, 2001");
  });

  it("does not repeat a code already covered by its group", () => {
    const s = describeSelection(groups, new Set(["a", "b", "c", "d"]));
    expect(s).toBe("Room & lodging (all), 2001");
    expect(s).not.toContain("1000");
  });

  it("collapses past the limit so the footer never wraps", () => {
    // One short of complete in BOTH groups, so nothing collapses to a "(all)" and the
    // four individual codes exceed the limit.
    const s = describeSelection(groups, new Set(["a", "c", "d", "f"]), 3);
    expect(s).toBe("1000, 1020, 2001 +1 more");
  });

  it("counts a group name as one entry against the limit, not the codes inside it", () => {
    const many = groupChargeCodesByHierarchy([
      ...CHART,
      code("g", "3001", "Spa", "Spa", "Treatments", 3, 1),
      code("h", "4001", "Laundry", "Services", "Laundry", 4, 1),
    ]);
    // Six codes selected, but they read as four entries — three complete groups plus one
    // loose code — so the limit bites on entries, not on code count.
    const s = describeSelection(many, new Set(["a", "b", "c", "d", "g", "h"]), 3);
    expect(s).toBe("Room & lodging (all), Spa (all), Services (all) +1 more");
  });

  it("puts complete groups before loose codes, so the summary reads widest-first", () => {
    const groups2 = groupChargeCodesByHierarchy(CHART);
    expect(describeSelection(groups2, new Set(["d", "e", "f", "a"]))).toBe("Food & beverage (all), 1000");
  });
});

describe("Search", () => {
  it("matches on code or description, case-insensitively", () => {
    const c = CHART[3]; // 2001 Restaurant — breakfast
    expect(chargeCodeMatches(c, "2001")).toBe(true);
    expect(chargeCodeMatches(c, "rest")).toBe(true);
    expect(chargeCodeMatches(c, "REST")).toBe(true);
    expect(chargeCodeMatches(c, "breakfast")).toBe(true);
    expect(chargeCodeMatches(c, "minibar")).toBe(false);
  });

  it("matches everything on an empty or whitespace query", () => {
    expect(chargeCodeMatches(CHART[0], "")).toBe(true);
    expect(chargeCodeMatches(CHART[0], "   ")).toBe(true);
  });
});
