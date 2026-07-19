import type { EnterpriseSettings, TaxRate } from "@prisma/client"

// The tax/service-charge engine shared by every route that posts a charge (pos/charge,
// folios/[id]/line-items, night-audit/run's room charge). One charge code is taxed
// either by the enterprise's single default engine (Service Charge, then GST on
// Base + Service Charge) or by its own Custom Tax profile — a profile can hold several
// named lines, each either a flat percentage of the subtotal ("BASE") or a percentage
// of the running total so far ("COMPOUND"), applied in ascending `order`. BASE/COMPOUND
// is exactly how Service Charge/GST already relate to each other; a Custom Tax profile
// just generalizes that to any number of lines instead of a fixed two.

export type TaxCalcMode = "BASE" | "COMPOUND"

export type TaxBreakdownLine = {
  name: string
  ratePercent: number
  calculateOn: TaxCalcMode
  amount: number
}

export type ChargeTaxResult = {
  baseAmount: number
  taxAmount: number
  serviceChargeAmount: number
  breakdown: TaxBreakdownLine[]
}

type TaxLineInput = { name: string; ratePercent: number; calculateOn: string; order: number }

const round2 = (n: number) => Math.round(n * 100) / 100

// Core engine: given an amount and an ordered set of BASE/COMPOUND lines, resolves the
// subtotal (backing tax out of an inclusive price if needed) and each line's amount.
// Intermediate accumulation stays unrounded so a COMPOUND line sees the true running
// total, matching how the original two-line Service Charge/GST formula only rounded
// its three final numbers, never an intermediate one; only the returned breakdown
// amounts (and the final totals) are rounded to cents.
function computeTaxLines(
  inputAmount: number,
  lines: TaxLineInput[],
  pricesIncludeTaxes: boolean
): { baseAmount: number; breakdown: TaxBreakdownLine[] } {
  const ordered = [...lines].sort((a, b) => a.order - b.order)

  // grandTotal = baseAmount * totalMultiplier — a pure ratio, independent of the
  // actual amount, so it works both to add tax on top of an exclusive price and to
  // back tax out of an inclusive one.
  let totalMultiplier = 1
  for (const line of ordered) {
    const r = line.ratePercent / 100
    totalMultiplier = line.calculateOn === "COMPOUND" ? totalMultiplier * (1 + r) : totalMultiplier + r
  }

  const baseAmountRaw = pricesIncludeTaxes ? inputAmount / totalMultiplier : inputAmount

  let runningTotalRaw = baseAmountRaw
  const breakdown: TaxBreakdownLine[] = []
  for (const line of ordered) {
    const r = line.ratePercent / 100
    const amountRaw = line.calculateOn === "COMPOUND" ? runningTotalRaw * r : baseAmountRaw * r
    breakdown.push({
      name: line.name,
      ratePercent: line.ratePercent,
      calculateOn: line.calculateOn === "COMPOUND" ? "COMPOUND" : "BASE",
      amount: round2(amountRaw),
    })
    runningTotalRaw += amountRaw
  }

  return { baseAmount: round2(baseAmountRaw), breakdown }
}

// The enterprise-wide default: Service Charge (BASE) then GST (COMPOUND, on
// Base + Service Charge) — unchanged from the original fixed two-step formula,
// just expressed as the BASE/COMPOUND special case of computeTaxLines.
export function computeDefaultEngineTax(
  inputAmount: number,
  settings: Pick<EnterpriseSettings, "serviceChargeEnabled" | "serviceChargeRate" | "tgstEnabled" | "tgstRate"> | null,
  pricesIncludeTaxes: boolean
): ChargeTaxResult {
  const serviceChargeRate = settings?.serviceChargeEnabled ? settings.serviceChargeRate : 0
  const tgstRate = settings?.tgstEnabled ? settings.tgstRate : 0

  const { baseAmount, breakdown } = computeTaxLines(
    inputAmount,
    [
      { name: "Service Charge", ratePercent: serviceChargeRate, calculateOn: "BASE", order: 0 },
      { name: "GST", ratePercent: tgstRate, calculateOn: "COMPOUND", order: 1 },
    ],
    pricesIncludeTaxes
  )

  return {
    baseAmount,
    serviceChargeAmount: breakdown[0].amount,
    taxAmount: breakdown[1].amount,
    breakdown,
  }
}

// A Custom Tax profile's lines, applied together. There's no separate "service
// charge" concept here — every line is tax, summed into one taxAmount.
export function computeCustomProfileTax(
  inputAmount: number,
  rates: Array<Pick<TaxRate, "name" | "ratePercent" | "calculateOn" | "order">>,
  pricesIncludeTaxes: boolean
): ChargeTaxResult {
  const { baseAmount, breakdown } = computeTaxLines(inputAmount, rates, pricesIncludeTaxes)
  const taxAmount = round2(breakdown.reduce((sum, l) => sum + l.amount, 0))
  return { baseAmount, taxAmount, serviceChargeAmount: 0, breakdown }
}

// The one connection point every charge-posting route should call: resolves whether a
// charge code uses the default engine or its own Custom Tax profile, and returns a
// uniform result either way. `chargeCode.taxProfile` must be fetched with its `rates`
// included; only rates currently effective as of `asOf` (default: now) are applied.
export function resolveChargeTax(params: {
  chargeCode: {
    useDefaultTax: boolean
    taxProfile?: {
      rates: Array<Pick<TaxRate, "name" | "ratePercent" | "calculateOn" | "order" | "effectiveFrom" | "effectiveTo">>
    } | null
  }
  inputAmount: number
  settings: Pick<EnterpriseSettings, "serviceChargeEnabled" | "serviceChargeRate" | "tgstEnabled" | "tgstRate"> | null
  pricesIncludeTaxes: boolean
  asOf?: Date
}): ChargeTaxResult {
  const { chargeCode, inputAmount, settings, pricesIncludeTaxes } = params
  const asOf = params.asOf ?? new Date()

  if (chargeCode.useDefaultTax || !chargeCode.taxProfile) {
    return computeDefaultEngineTax(inputAmount, settings, pricesIncludeTaxes)
  }

  const effectiveRates = chargeCode.taxProfile.rates.filter(
    (r) => r.effectiveFrom <= asOf && (!r.effectiveTo || r.effectiveTo >= asOf)
  )
  return computeCustomProfileTax(inputAmount, effectiveRates, pricesIncludeTaxes)
}

// Outlets (Spa, Restaurant, Bar...) can optionally force one tax handling for
// everything sold through them, overriding whatever the charge code itself says. A
// thin wrapper around resolveChargeTax rather than a modification to it — builds a
// synthetic "effective charge code" reflecting the outlet's override (if any) and
// delegates, so the BASE/COMPOUND engine is never duplicated and every existing caller
// of resolveChargeTax (routes with no outlet context) is completely unaffected.
export function resolveOutletChargeTax(params: {
  chargeCode: {
    useDefaultTax: boolean
    taxProfile?: {
      rates: Array<Pick<TaxRate, "name" | "ratePercent" | "calculateOn" | "order" | "effectiveFrom" | "effectiveTo">>
    } | null
  }
  outlet?: {
    taxOverrideMode: string // "NONE" | "DEFAULT_ENGINE" | "CUSTOM"
    taxProfile?: {
      rates: Array<Pick<TaxRate, "name" | "ratePercent" | "calculateOn" | "order" | "effectiveFrom" | "effectiveTo">>
    } | null
  } | null
  inputAmount: number
  settings: Pick<EnterpriseSettings, "serviceChargeEnabled" | "serviceChargeRate" | "tgstEnabled" | "tgstRate"> | null
  pricesIncludeTaxes: boolean
  asOf?: Date
}): ChargeTaxResult {
  const { outlet, chargeCode, ...rest } = params

  if (!outlet || outlet.taxOverrideMode === "NONE") {
    return resolveChargeTax({ chargeCode, ...rest })
  }
  if (outlet.taxOverrideMode === "DEFAULT_ENGINE") {
    return resolveChargeTax({ chargeCode: { useDefaultTax: true, taxProfile: null }, ...rest })
  }
  // CUSTOM — substitute the outlet's own profile in place of the charge code's.
  return resolveChargeTax({ chargeCode: { useDefaultTax: false, taxProfile: outlet.taxProfile }, ...rest })
}
