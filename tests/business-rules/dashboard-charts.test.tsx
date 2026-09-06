// Render check for the dashboard chart primitives.
//
// These are hand-rolled SVG, so their failure mode isn't a wrong number — it's a NaN or
// Infinity reaching a path/coordinate attribute, which makes the browser silently drop
// the mark. A chart that renders nothing looks exactly like a chart with no data. So the
// assertion is on the emitted markup itself, across the degenerate inputs a real property
// actually produces: a day with no postings (all zero), a forecast tail (all null), a
// brand-new property (empty), and the 60-day range.
//
// Touches no database — the only test file here that doesn't.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { ColumnChart, LineChart, DonutChart, RankedBars, StackedBar, Sparkline, Meter, hueFor } from "@/components/dashboard/charts";

const days = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ label: `${i + 1} Sep`, sub: `Wed ${i + 1} Sep 2026`, date: `2026-09-${String(i + 1).padStart(2, "0")}` }));

function assertClean(name: string, html: string) {
  expect(html, `${name} produced empty markup`).toBeTruthy();
  // A NaN anywhere in a path/coordinate silently drops the mark — the classic SVG bug.
  expect(html, `${name} contains NaN`).not.toMatch(/NaN/);
  expect(html, `${name} contains Infinity`).not.toMatch(/Infinity/);
  expect(html, `${name} contains undefined attr`).not.toMatch(/="undefined"/);
}

describe("chart primitives render", () => {
  it("ColumnChart: normal, all-zero, single point, two series", () => {
    const mk = (pts: { label: string; sub: string }[], values: (i: number) => number[], series: number) =>
      renderToStaticMarkup(
        React.createElement(ColumnChart, {
          ariaLabel: "test",
          points: pts.map((p, i) => ({ ...p, values: values(i) })),
          series: Array.from({ length: series }, (_, s) => ({ key: `s${s}`, label: `S${s}`, color: hueFor(s) })),
        })
      );

    assertClean("normal", mk(days(14), (i) => [i * 3 + 5], 1));
    assertClean("all zero", mk(days(14), () => [0], 1));
    assertClean("single point", mk(days(1), () => [7], 1));
    assertClean("two series", mk(days(30), (i) => [i, 30 - i], 2));
    assertClean("60 day", mk(days(60), (i) => [i % 17], 1));
    // Empty input must not throw or emit junk geometry.
    assertClean("empty", mk([], () => [], 1));
  });

  it("LineChart: with nulls, all null, flat series", () => {
    const mk = (value: (i: number) => number | null, n = 21) =>
      renderToStaticMarkup(
        React.createElement(LineChart, {
          ariaLabel: "test",
          seriesLabel: "ADR",
          points: days(n).map((p, i) => ({ ...p, value: value(i) })),
        })
      );

    assertClean("normal", mk((i) => 100 + i * 4));
    // The real shape: posted history then a null forecast tail.
    assertClean("forecast tail", mk((i) => (i < 14 ? 100 + i : null)));
    assertClean("all null", mk(() => null));
    assertClean("flat", mk(() => 200));
    assertClean("all zero", mk(() => 0));
  });

  it("DonutChart: normal, single slice, all-zero", () => {
    const mk = (slices: { label: string; value: number; color: string }[]) =>
      renderToStaticMarkup(
        React.createElement(DonutChart, { ariaLabel: "test", slices, centerValue: "$1", centerLabel: "today" })
      );

    assertClean("normal", mk([
      { label: "Room", value: 800, color: hueFor(0) },
      { label: "F&B", value: 210, color: hueFor(1) },
      { label: "Other", value: 40, color: hueFor(2) },
    ]));
    assertClean("single", mk([{ label: "Room", value: 800, color: hueFor(0) }]));
    assertClean("all zero", mk([{ label: "Room", value: 0, color: hueFor(0) }]));
    assertClean("empty", mk([]));
  });

  // Regression, 2026-09-06. The tick scale used to stop at the last clean step at or
  // BELOW the data max, and every chart scales its marks by that top tick — so an ADR
  // peaking at 250 against ticks 0/100/200 was drawn a quarter of a plot height above its
  // own frame and, the SVG having overflow visible, straight over the occupancy chart
  // stacked above it. The assertion is geometric on purpose: "renders without NaN" was
  // always true of the broken version.
  it("never plots above its own frame when the data max is not a clean multiple of a tick", () => {
    const height = 120;
    const html = renderToStaticMarkup(
      React.createElement(LineChart, {
        ariaLabel: "test",
        seriesLabel: "ADR",
        height,
        points: days(6).map((p, i) => ({ ...p, value: [0, 250, 120, 250, 0, 80][i] })),
      })
    );

    const d = /<path d="(M[^"]+)" fill="none"/.exec(html)?.[1];
    expect(d, "line path not found in markup").toBeTruthy();
    const ys = [...d!.matchAll(/[ML][\d.]+ (-?[\d.]+)/g)].map((m) => Number(m[1]));
    expect(ys.length).toBeGreaterThan(1);
    expect(Math.min(...ys), "line drawn above the top of its own SVG").toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys), "line drawn below the bottom of its own SVG").toBeLessThanOrEqual(height);

    // Same guarantee for bars: the top tick has to cover the tallest column.
    const bars = renderToStaticMarkup(
      React.createElement(ColumnChart, {
        ariaLabel: "test",
        height: 140,
        points: days(5).map((p, i) => ({ ...p, values: [[10], [85], [40], [85], [0]][i] })),
        series: [{ key: "s", label: "S", color: hueFor(0) }],
        format: (n: number) => String(n),
      })
    );
    const ticks = [...bars.matchAll(/text-anchor="end"[^>]*>([\d.]+)</g)].map((m) => Number(m[1]));
    expect(ticks.length, "no axis ticks found").toBeGreaterThan(1);
    expect(Math.max(...ticks), "top tick is below the tallest bar").toBeGreaterThanOrEqual(85);
  });

  it("RankedBars / StackedBar / Sparkline / Meter", () => {
    assertClean("ranked", renderToStaticMarkup(React.createElement(RankedBars, { rows: [{ label: "Cash", value: 400 }, { label: "Card", value: 0 }] })));
    assertClean("ranked ordinal", renderToStaticMarkup(React.createElement(RankedBars, { ordinal: true, rows: [{ label: "Current", value: 0 }, { label: "1-30", value: 0 }] })));
    assertClean("ranked empty", renderToStaticMarkup(React.createElement(RankedBars, { rows: [] })));
    assertClean("stacked", renderToStaticMarkup(React.createElement(StackedBar, { ariaLabel: "p", segments: [{ label: "HIGH", value: 2, color: "red" }, { label: "LOW", value: 0, color: "grey" }] })));
    assertClean("stacked zero", renderToStaticMarkup(React.createElement(StackedBar, { ariaLabel: "p", segments: [] })));
    assertClean("spark", renderToStaticMarkup(React.createElement(Sparkline, { values: [1, 1, 1, 1] })));
    assertClean("meter zero max", renderToStaticMarkup(React.createElement(Meter, { value: 3, max: 0, label: "m" })));
  });
});
