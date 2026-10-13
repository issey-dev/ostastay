export type BreakdownLine = { label: string; amount: number }

/** Net first, then each service-charge / tax line that belongs to the posting. */
export function breakdownLines(
  base: number,
  parent: { taxAmount?: number | null; serviceChargeAmount?: number | null },
  generated: { description: string; amount: number; taxAmount: number; serviceChargeAmount?: number | null }[]
): BreakdownLine[] {
  const lines: BreakdownLine[] = [{ label: "Net", amount: base }]
  if ((parent.serviceChargeAmount ?? 0) > 0) lines.push({ label: "Service Charge", amount: parent.serviceChargeAmount! })
  if ((parent.taxAmount ?? 0) > 0) lines.push({ label: "Tax", amount: parent.taxAmount! })
  for (const g of generated) {
    const amount = g.amount + g.taxAmount + (g.serviceChargeAmount ?? 0)
    if (Math.abs(amount) > 0.005) lines.push({ label: g.description, amount })
  }
  return lines
}
