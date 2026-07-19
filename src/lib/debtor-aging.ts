// Pure Accounts Receivable aging calculation — no DB access, unit-tested directly in
// tests/business-rules/debtor-aging.test.ts. A debtor invoice is a reservation's own
// Folio, finalized (isDebtorAccount: true) at checkout — so unlike the old shared-ledger
// design, each invoice is independent: no cross-invoice FIFO allocation is needed, just
// bucket each still-open (unpaid) invoice's own balance by its own age.

export interface AgingBuckets {
  current: number;
  "1-30": number;
  "31-60": number;
  "61-90": number;
  "90+": number;
}

const EMPTY_BUCKETS: AgingBuckets = { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };

function bucketForAge(ageDays: number): keyof AgingBuckets {
  if (ageDays <= 0) return "current";
  if (ageDays <= 30) return "1-30";
  if (ageDays <= 60) return "31-60";
  if (ageDays <= 90) return "61-90";
  return "90+";
}

// referenceDate is the invoice's own date (the reservation's checkOutDate) — the
// point at which the debt was incurred, for aging purposes. Paid-off invoices
// (balance <= 0) are excluded entirely, matching "age of open folios only".
export function computeFolioAgingBuckets(
  invoices: Array<{ balance: number; referenceDate: Date | string }>,
  asOfDate: Date = new Date()
): AgingBuckets {
  const buckets: AgingBuckets = { ...EMPTY_BUCKETS };
  const msPerDay = 1000 * 60 * 60 * 24;

  for (const invoice of invoices) {
    if (invoice.balance <= 0.005) continue;
    const ageDays = Math.floor((asOfDate.getTime() - new Date(invoice.referenceDate).getTime()) / msPerDay);
    buckets[bucketForAge(ageDays)] += invoice.balance;
  }

  return buckets;
}

export function totalOutstanding(buckets: AgingBuckets): number {
  return buckets.current + buckets["1-30"] + buckets["31-60"] + buckets["61-90"] + buckets["90+"];
}
