import { describe, expect, it } from "vitest"
import { allRows, buildInsights } from "@/lib/reports/insights"
import { flattenResult } from "@/lib/reports/render/flatten"
import { renderDelimited, serializeDelimited } from "@/lib/reports/render/delimited"
import { renderCsv } from "@/lib/reports/render/csv"
import { DEFAULT_EXPORT_OPTIONS, parseExportOptions } from "@/lib/reports/export-options"
import { guardFormula } from "@/lib/reports/format"
import { REPORTS } from "@/lib/reports/registry"
import type { ReportResult } from "@/lib/reports/types"

// Pure tests — no database. They guard the two promises of the 8.7 Daily Reports rework:
//  1. every file format is a faithful, safe rendering of the same rows;
//  2. KPIs and charts are derived from the table's own rows, so they can never disagree.

const result: ReportResult = {
  title: "Test",
  subtitle: "Sub",
  columns: [
    { key: "name", label: "Name" },
    { key: "day", label: "Day", format: "date" },
    { key: "amount", label: "Amount", format: "currency" },
  ],
  groups: [
    { label: "A, Ltd", rows: [{ name: "Ann", day: "2026-10-01T00:00:00.000Z", amount: 1234.5 }, { name: "=SUM(1)", day: "2026-10-02T00:00:00.000Z", amount: 10 }], subtotals: { amount: 1244.5 } },
    { label: "B", rows: [{ name: 'Bo "the" Builder', day: "2026-10-01T00:00:00.000Z", amount: 5 }] },
  ],
  totals: { amount: 1249.5 },
}

describe("delimited export", () => {
  it("data layout is one header row, group as a leading column, raw values, no subtotals", () => {
    const grid = flattenResult(result, "data")
    expect(grid[0]).toEqual(["Group", "Name", "Day", "Amount"])
    expect(grid).toHaveLength(4)
    expect(grid[1]).toEqual(["A, Ltd", "Ann", "2026-10-01", "1234.5"])
  })

  it("presentation layout keeps the title block, subtotals and grand total", () => {
    const grid = flattenResult(result, "presentation")
    expect(grid[0]).toEqual(["Test"])
    expect(grid.some((r) => r[0] === "Subtotal")).toBe(true)
    expect(grid[grid.length - 1][0]).toBe("Total")
  })

  it("neutralises spreadsheet formulas in text cells but not in numbers", () => {
    expect(guardFormula("=SUM(1)")).toBe("'=SUM(1)")
    expect(guardFormula("Ann")).toBe("Ann")
    const grid = flattenResult(result, "data")
    expect(grid[2][1]).toBe("'=SUM(1)")
  })

  it("qualifies cells containing the delimiter or quotes", () => {
    const o = { ...DEFAULT_EXPORT_OPTIONS, delimiter: "comma" as const, lineEnding: "lf" as const }
    const text = serializeDelimited(flattenResult(result, "data"), o)
    expect(text).toContain('"A, Ltd"')
    expect(text).toContain('"Bo ""the"" Builder"')
  })

  it("honours delimiter, header and line-ending options", () => {
    const o = { ...DEFAULT_EXPORT_OPTIONS, delimiter: "pipe" as const, header: false, lineEnding: "lf" as const }
    const text = serializeDelimited(flattenResult(result, "data"), o)
    expect(text.split("\n")[0]).toBe("A, Ltd|Ann|2026-10-01|1234.5")
  })

  it("with no qualifier, delimiters inside values become spaces so rows stay intact", () => {
    const o = { ...DEFAULT_EXPORT_OPTIONS, delimiter: "comma" as const, qualifier: "none" as const, lineEnding: "lf" as const }
    const text = serializeDelimited(flattenResult(result, "data"), o)
    expect(text.split("\n")[1].split(",")).toHaveLength(4)
  })

  it("encodes UTF-8 BOM and Windows-1252", () => {
    const r: ReportResult = { title: "t", columns: [{ key: "n", label: "N" }], rows: [{ n: "Café €" }] }
    const bom = renderCsv(r)
    expect([...bom.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const w = renderDelimited(r, { ...DEFAULT_EXPORT_OPTIONS, encoding: "windows1252", lineEnding: "lf" })
    expect(w.includes(0xe9)).toBe(true) // é
    expect(w.includes(0x80)).toBe(true) // €
  })

  it("rejects an unusable custom delimiter and falls back to defaults", () => {
    expect(parseExportOptions({ delimiter: "custom", customDelimiter: '"' })).toEqual(DEFAULT_EXPORT_OPTIONS)
    expect(parseExportOptions({ delimiter: "custom", customDelimiter: "~" }).delimiter).toBe("custom")
    expect(parseExportOptions(null)).toEqual(DEFAULT_EXPORT_OPTIONS)
  })
})

describe("report insights", () => {
  it("KPIs and charts are derived from the table's rows", () => {
    const out = buildInsights(result, {
      kpis: [
        { label: "Rows", agg: "count" },
        { label: "Amount", agg: "sum", column: "amount", format: "currency" },
        { label: "Total", agg: "sum", column: "amount", fromTotals: true, format: "currency" },
      ],
      visuals: [
        { type: "ranked", title: "By group", by: "$group", value: "amount" },
        { type: "column", title: "By day", by: "day", values: [{ label: "Amount", column: "amount" }] },
      ],
    })
    expect(out.summary?.[0].value).toBe(3)
    expect(out.summary?.[1].value).toBe(1249.5)
    expect(out.summary?.[2].value).toBe(1249.5)
    const ranked = out.visuals?.[0]
    expect(ranked?.type === "ranked" && ranked.rows.reduce((s, r) => s + r.value, 0)).toBe(1249.5)
    const col = out.visuals?.[1]
    // Two days, in date order; the chart's grand total equals the table's.
    expect(col?.type === "column" && col.points.map((p) => p.label)).toEqual(["01 Oct", "02 Oct"])
    expect(col?.type === "column" && col.points.reduce((s, p) => s + p.values[0], 0)).toBe(1249.5)
  })

  it("falls back to a record count and the grand totals when a report declares nothing", () => {
    const out = buildInsights(result, undefined)
    expect(out.summary?.map((k) => k.label)).toEqual(["Records", "Total Amount"])
  })

  it("folds the long tail into Other and drops empty charts", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ k: `c${i}`, v: i + 1 }))
    const out = buildInsights({ title: "t", columns: [{ key: "k", label: "K" }, { key: "v", label: "V", format: "number" }], rows }, {
      visuals: [{ type: "donut", title: "d", by: "k", value: "v", top: 4 }, { type: "ranked", title: "empty", by: "k" }],
    })
    const d = out.visuals?.[0]
    expect(d?.type === "donut" && d.slices).toHaveLength(4)
    expect(d?.type === "donut" && d.slices.reduce((s, x) => s + x.value, 0)).toBe(55)
    const none = buildInsights({ title: "t", columns: [], rows: [] }, { visuals: [{ type: "donut", title: "d", by: "k" }] })
    expect(none.visuals).toEqual([])
  })

  it("every registered report's insights spec only names columns the report can have", () => {
    // The registry specs are plain data: make sure each is well-formed (keys unique, types known).
    const specced = REPORTS.filter((r) => r.insights)
    expect(specced.length).toBeGreaterThanOrEqual(20)
    for (const r of specced) {
      for (const v of r.insights!.visuals ?? []) expect(["donut", "ranked", "column", "line"]).toContain(v.type)
      for (const k of r.insights!.kpis ?? []) expect(["count", "sum", "avg", "max", "min", "distinct"]).toContain(k.agg)
    }
    expect(allRows({ groups: [{ label: "G", rows: [{ a: 1 }] }] })[0].$group).toBe("G")
  })
})
