// Small formatters shared by Osta server pages and client lists. Kept out of the
// "use client" modules: a server component calling a function imported from one gets a
// client reference, not the function.

/** "5 min ago" / "3 h ago" / "2 d ago" against a server-supplied `now` (no hydration drift). */
export function ago(iso: string | null, nowIso: string): string {
  if (!iso) return "—"
  const s = Math.max(0, (Date.parse(nowIso) - Date.parse(iso)) / 1000)
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`
  if (s < 86_400 * 60) return `${Math.floor(s / 86_400)} d ago`
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

export const fmtMoney = (amount: number, currency: string) =>
  `${currency} ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Amounts kept per currency, shown side by side ("USD 1,200.00 · EUR 300.00"); "—" when empty. */
export function fmtMoneyByCurrency(m: Record<string, number>): string {
  const parts = Object.entries(m).filter(([, v]) => v !== 0)
  return parts.length === 0 ? "—" : parts.map(([c, v]) => fmtMoney(v, c)).join(" · ")
}
