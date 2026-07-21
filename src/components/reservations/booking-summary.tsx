"use client"

import { format } from "date-fns"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export type Quote = {
  nights: number
  pricesIncludeTaxes: boolean
  segments: {
    roomTypeId: string; ratePlanId: string; nights: number
    roomBase: number; roomTax: number; roomServiceCharge: number
    extraOccupancyBase: number; extraOccupancyTax: number; extraOccupancyServiceCharge: number
    unpricedNights: number
  }[]
  allocations: {
    allocationId: string; code: string; name: string; source: string; mode: string
    base: number; tax: number; serviceCharge: number
    breakdown: {
      postingRhythm: string; totalNights: number; postingNights: number; unpricedNights: number
      segments: { nights: number; adultPrice: number; childPrice: number; amountPerNight: number; subtotal: number }[]
      total: number
    }
  }[]
  taxLines: { name: string; ratePercent: number; calculateOn: string; amount: number }[]
  greenTax: { enabled: boolean; adults: number; children: number; perAdultAmount: number; perChildAmount: number; nights: number; total: number }
  totals: { roomBase: number; extraOccupancyBase: number; allocationsBase: number; taxTotal: number; greenTaxTotal: number; grandTotal: number }
  warnings: string[]
}

const PIPE = "×"
const RHYTHM_LABEL: Record<string, string> = {
  EVERY_NIGHT: "every night",
  ARRIVAL_NIGHT: "arrival night only",
  DEPARTURE_NIGHT: "departure night only",
}
const money = (n: number) => `$${n.toFixed(2)}`

type BookingSummaryProps = {
  checkInDate: string
  checkOutDate: string
  adults: number
  children: number
  infants: number
  quote: Quote | null
  quoteLoading: boolean
  roomTypes: any[]
  ratePlans: any[]
}

// The sticky sidebar: server-quoted totals with the full tax/allocation
// breakdown. Pure display — the quote itself is fetched by the parent form.
export function BookingSummary({ checkInDate, checkOutDate, adults, children, infants, quote, quoteLoading, roomTypes, ratePlans }: BookingSummaryProps) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">Booking Summary</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        {checkInDate && checkOutDate && (
          <div className="text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Stay</span>
              <span>{format(new Date(checkInDate), "dd MMM")} – {format(new Date(checkOutDate), "dd MMM yyyy")}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Occupancy</span>
              <span>
                {adults} adult{adults === 1 ? "" : "s"}
                {children > 0 ? `, ${children} child${children === 1 ? "" : "ren"}` : ""}
                {infants > 0 ? `, ${infants} infant${infants === 1 ? "" : "s"}` : ""}
              </span>
            </div>
          </div>
        )}

        {!quote ? (
          <p className="text-xs text-muted-foreground italic">
            {quoteLoading ? "Calculating..." : "Pick a room & rate to see the estimated total."}
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1.5 text-sm border-t pt-3">
              {quote.segments.map((seg, i) => {
                const rt = roomTypes.find(r => r.id === seg.roomTypeId)
                const rp = ratePlans.find(r => r.id === seg.ratePlanId)
                return (
                  <div key={i} className="flex justify-between">
                    <span className="text-muted-foreground">
                      {rt?.code ?? "Room"} · {rp?.code ?? "Rate"} × {seg.nights}n
                      {seg.unpricedNights > 0 && <span className="text-warning" title={`${seg.unpricedNights} night(s) unpriced`}>*</span>}
                    </span>
                    <span className="font-mono">{money(seg.roomBase)}</span>
                  </div>
                )
              })}
              {quote.totals.extraOccupancyBase > 0.005 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Extra occupancy</span>
                  <span className="font-mono">{money(quote.totals.extraOccupancyBase)}</span>
                </div>
              )}
            </div>

            {quote.allocations.length > 0 && (
              <div className="flex flex-col gap-2 text-sm border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground">Allocations</p>
                {quote.allocations.map(a => (
                  <div key={a.allocationId} className="flex flex-col gap-0.5">
                    <div className="flex justify-between">
                      <span><span className="font-mono text-xs">{a.code}</span> {a.name}</span>
                      <span className="font-mono">{money(a.base)}</span>
                    </div>
                    {a.breakdown.segments.map((seg, i) => (
                      <p key={i} className="text-[11px] text-muted-foreground pl-1">
                        {adults} adult{adults === 1 ? "" : "s"} {PIPE} {money(seg.adultPrice)}
                        {children > 0 && <> + {children} child{children === 1 ? "" : "ren"} {PIPE} {money(seg.childPrice)}</>}
                        {" = "}{money(seg.amountPerNight)}/night {PIPE} {seg.nights} night{seg.nights === 1 ? "" : "s"} ({RHYTHM_LABEL[a.breakdown.postingRhythm] ?? a.breakdown.postingRhythm}) = {money(seg.subtotal)}
                      </p>
                    ))}
                    {a.breakdown.unpricedNights > 0 && (
                      <p className="text-[11px] text-warning pl-1">
                        {a.breakdown.unpricedNights} qualifying night(s) had no rate configured — not charged.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-1 text-sm border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground">
                Taxes &amp; charges {quote.pricesIncludeTaxes && <span className="italic">(included in prices above)</span>}
              </p>
              {quote.taxLines.map(line => (
                <div key={line.name} className="flex justify-between">
                  <span className="text-muted-foreground">
                    {line.name} ({line.ratePercent}%{line.calculateOn === "COMPOUND" ? ", compound" : ""})
                  </span>
                  <span className="font-mono">{money(line.amount)}</span>
                </div>
              ))}
              {quote.greenTax.enabled && quote.greenTax.total > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Green Tax ({quote.greenTax.adults}×{money(quote.greenTax.perAdultAmount)}
                    {quote.greenTax.children > 0 ? ` + ${quote.greenTax.children}×${money(quote.greenTax.perChildAmount)}` : ""} × {quote.greenTax.nights}n)
                  </span>
                  <span className="font-mono">{money(quote.greenTax.total)}</span>
                </div>
              )}
            </div>

            <div className="flex justify-between items-baseline border-t pt-3">
              <span className="font-semibold">Grand Total</span>
              <span className="font-mono font-bold text-lg">{money(quote.totals.grandTotal)}</span>
            </div>

            {quote.warnings.length > 0 && (
              <div className="text-[11px] text-warning flex flex-col gap-0.5 border-t pt-2">
                {quote.warnings.map((w, i) => <p key={i}>{w}</p>)}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
