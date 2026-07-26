// Money helpers. All monetary amounts in the app are decimal dollars stored as SQLite
// REAL (Float). A single 2-decimal value round-trips through a double fine, but SUMMING
// many of them accumulates binary-float error (0.1 + 0.2 === 0.30000000000000004), which
// is why folio-balance / drawer / report totals historically needed a 0.01 tolerance to
// look "balanced". These helpers do additive money math in integer CENTS and convert back,
// so sums and differences are exact to the cent.
//
// Precondition: inputs are already rounded to at most 2 decimals (every charge is rounded
// to cents at its posting boundary — see tax-calc's round2). We defensively round on the
// way in anyway, so a stray long-float input can't smear the total.

/** Dollars → integer cents (rounded). Null/undefined treated as 0. */
export const toCents = (dollars: number | null | undefined): number => Math.round((dollars ?? 0) * 100);

/** Integer cents → dollars. */
export const fromCents = (cents: number): number => cents / 100;

/** Round a dollar amount to whole cents. */
export const round2 = (n: number | null | undefined): number => Math.round((n ?? 0) * 100) / 100;

/** Exact sum of money values (summed in integer cents, returned as dollars). */
export function sumMoney(values: Array<number | null | undefined>): number {
  return fromCents(values.reduce<number>((acc, v) => acc + toCents(v), 0));
}

/** Exact sum of a mapped money field over a list. */
export function sumBy<T>(items: T[], select: (item: T) => number | null | undefined): number {
  return fromCents(items.reduce<number>((acc, item) => acc + toCents(select(item)), 0));
}

/** Exact addition of money values. */
export const addMoney = (...values: Array<number | null | undefined>): number => sumMoney(values);

/** Exact `a - b` for money values. */
export const subMoney = (a: number | null | undefined, b: number | null | undefined): number =>
  fromCents(toCents(a) - toCents(b));

/** True when two money amounts are equal to the cent (avoids float-equality pitfalls). */
export const moneyEquals = (a: number | null | undefined, b: number | null | undefined): boolean =>
  toCents(a) === toCents(b);

/** True when a money amount is effectively zero (|value| < half a cent). */
export const isZeroMoney = (n: number | null | undefined): boolean => toCents(n) === 0;
