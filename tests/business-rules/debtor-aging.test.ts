import { describe, it, expect } from "vitest";
import { computeFolioAgingBuckets, totalOutstanding } from "@/lib/debtor-aging";

const asOf = new Date("2026-07-19T00:00:00Z");
const daysAgo = (n: number) => new Date(asOf.getTime() - n * 24 * 60 * 60 * 1000);

describe("debtor-aging: computeFolioAgingBuckets", () => {
  it("buckets a same-day open invoice as current", () => {
    const buckets = computeFolioAgingBuckets([{ balance: 100, referenceDate: daysAgo(0) }], asOf);
    expect(buckets.current).toBe(100);
    expect(totalOutstanding(buckets)).toBe(100);
  });

  it("buckets invoices into 1-30/31-60/61-90/90+ by age of their own referenceDate", () => {
    const buckets = computeFolioAgingBuckets(
      [
        { balance: 100, referenceDate: daysAgo(15) },
        { balance: 200, referenceDate: daysAgo(45) },
        { balance: 300, referenceDate: daysAgo(75) },
        { balance: 400, referenceDate: daysAgo(120) },
      ],
      asOf
    );
    expect(buckets["1-30"]).toBe(100);
    expect(buckets["31-60"]).toBe(200);
    expect(buckets["61-90"]).toBe(300);
    expect(buckets["90+"]).toBe(400);
  });

  it("sums multiple open invoices that land in the same bucket independently — no cross-invoice allocation", () => {
    const buckets = computeFolioAgingBuckets(
      [
        { balance: 100, referenceDate: daysAgo(120) },
        { balance: 50, referenceDate: daysAgo(0) },
      ],
      asOf
    );
    expect(buckets["90+"]).toBe(100);
    expect(buckets.current).toBe(50);
    expect(totalOutstanding(buckets)).toBe(150);
  });

  it("excludes paid-off invoices (balance at or below zero) entirely", () => {
    const buckets = computeFolioAgingBuckets(
      [
        { balance: 0, referenceDate: daysAgo(10) },
        { balance: -5, referenceDate: daysAgo(10) },
      ],
      asOf
    );
    expect(totalOutstanding(buckets)).toBe(0);
  });

  it("excludes invoices with a balance that's a rounding artifact (<= 0.005)", () => {
    const buckets = computeFolioAgingBuckets([{ balance: 0.004, referenceDate: daysAgo(10) }], asOf);
    expect(totalOutstanding(buckets)).toBe(0);
  });

  it("includes a partially-paid invoice's remaining balance only", () => {
    const buckets = computeFolioAgingBuckets([{ balance: 42.5, referenceDate: daysAgo(5) }], asOf);
    expect(buckets["1-30"]).toBeCloseTo(42.5, 2);
  });

  it("bucket boundaries are inclusive at 30/60/90 days", () => {
    const buckets = computeFolioAgingBuckets(
      [
        { balance: 10, referenceDate: daysAgo(30) },
        { balance: 20, referenceDate: daysAgo(60) },
        { balance: 30, referenceDate: daysAgo(90) },
        { balance: 40, referenceDate: daysAgo(91) },
      ],
      asOf
    );
    expect(buckets["1-30"]).toBe(10);
    expect(buckets["31-60"]).toBe(20);
    expect(buckets["61-90"]).toBe(30);
    expect(buckets["90+"]).toBe(40);
  });

  it("returns all-zero buckets for no invoices", () => {
    const buckets = computeFolioAgingBuckets([], asOf);
    expect(totalOutstanding(buckets)).toBe(0);
  });

  it("accepts a string referenceDate, matching how it's called with reservation.checkOutDate ?? new Date()", () => {
    const buckets = computeFolioAgingBuckets([{ balance: 75, referenceDate: daysAgo(15).toISOString() }], asOf);
    expect(buckets["1-30"]).toBe(75);
  });
});
