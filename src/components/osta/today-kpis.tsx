"use client"

import { Building2, DollarSign, CalendarClock, ReceiptText, ArrowLeftRight } from "@/components/icons"
import { StatTile } from "@/components/ui/stat-tile"

// Today's portfolio strip. A client component only because StatTile takes its icon as a
// component, which a server page cannot pass across the boundary.

export type TodayKpiValues = {
  mrr: string
  enterpriseCount: number
  liveProperties: number
  pendingProperties: number
  receivables: string
  unpaidCount: number
  overdueCount: number
  renewals30: number
  graceCount: number
  channelsConnected: number
  channelsFailing: number
}

export function TodayKpis({ k }: { k: TodayKpiValues }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <StatTile label="Monthly recurring" value={k.mrr} icon={DollarSign} href="/osta/billing" footnote="Active and grace licences" />
      <StatTile
        label="Customers"
        value={String(k.enterpriseCount)}
        icon={Building2}
        href="/osta/enterprises"
        footnote={`${k.liveProperties} properties live${k.pendingProperties ? ` · ${k.pendingProperties} pending` : ""}`}
      />
      <StatTile
        label="Receivables"
        value={k.receivables}
        icon={ReceiptText}
        href="/osta/billing"
        footnote={
          k.unpaidCount === 0 ? "No unpaid invoices" : (
            <span className={k.overdueCount ? "text-destructive" : undefined}>
              {k.unpaidCount} unpaid{k.overdueCount ? ` · ${k.overdueCount} overdue` : ""}
            </span>
          )
        }
      />
      <StatTile
        label="Renewals · 30 days"
        value={String(k.renewals30)}
        icon={CalendarClock}
        href="/osta/billing"
        footnote={k.graceCount ? <span className="text-warning">{k.graceCount} in grace period</span> : "None in grace period"}
      />
      {/* Five tiles in a two-column grid would leave this one alone on its row: it takes
          the full row until the strip goes five across. */}
      <div className="sm:max-xl:col-span-2">
        <StatTile
          label="Channel links"
          value={String(k.channelsConnected)}
          icon={ArrowLeftRight}
          href="/osta/channel-manager"
          footnote={k.channelsFailing ? <span className="text-destructive">{k.channelsFailing} failing</span> : "Connected, none failing"}
        />
      </div>
    </div>
  )
}
