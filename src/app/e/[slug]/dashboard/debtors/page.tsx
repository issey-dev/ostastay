"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { Plus, Landmark, AlertTriangle } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"
import { ErrorState } from "@/components/ui/error-state"
import { Skeleton } from "@/components/ui/skeleton"
import { useProperty } from "@/components/providers/property-provider"
import { InfoHint } from "@/components/ui/info-hint"

type DebtorAccount = {
  upid: string
  profileType: string
  firstName: string
  lastName: string | null
  companyName: string | null
  arNumber: string | null
  creditLimit: number | null
  balance: number
  overLimit: boolean
}

function accountName(a: DebtorAccount): string {
  return a.companyName || [a.firstName, a.lastName].filter(Boolean).join(" ")
}

const money = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" })

export default function DebtorsPage() {
  const { slug } = useParams<{ slug: string }>()
  const { currentProperty } = useProperty()
  const propertyId = currentProperty?.id ?? ""

  const [accounts, setAccounts] = useState<DebtorAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const fetchAccounts = useCallback(() => {
    if (!propertyId) return
    setLoading(true)
    setLoadError(false)
    fetch(`/api/debtors/accounts?propertyId=${propertyId}`)
      .then((res) => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then((data) => { if (Array.isArray(data)) setAccounts(data) })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [propertyId])

  useEffect(() => { fetchAccounts() }, [fetchAccounts])

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
            Debtors
            <InfoHint label="Debtors">Accounts Receivable — Travel Agent and corporate credit accounts.</InfoHint>
          </h2>
        </div>
        <Link href={`/e/${slug}/dashboard/debtors/new`} className="sm:shrink-0">
          <Button className="w-full sm:w-auto"><Plus className="w-4 h-4 mr-2" /> New Account</Button>
        </Link>
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : loadError ? (
        <ErrorState title="Couldn't load debtors" onRetry={fetchAccounts} />
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="No credit accounts yet"
          description="Activate a Travel Agent or Company profile as a credit account to start billing charges to it."
        />
      ) : (
        <>
          {/* Mobile: stacked cards instead of a horizontally-scrolled table */}
          <div className="md:hidden space-y-3">
            {accounts.map((a) => (
              <Link
                key={a.upid}
                href={`/e/${slug}/dashboard/debtors/${a.upid}`}
                className="block rounded-md border border-border bg-card p-4 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-foreground">{accountName(a)}</span>
                  <Badge variant="outline" className="shrink-0">{a.profileType === "TRAVEL_AGENT" ? "Travel Agent" : "Company"}</Badge>
                </div>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>AR: {a.arNumber || "—"}</span>
                  <span>Limit: {a.creditLimit != null ? money(a.creditLimit) : "—"}</span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <span className="text-xs text-muted-foreground">Balance</span>
                  <span className={`text-sm font-semibold flex items-center gap-1.5 ${a.overLimit ? "text-destructive" : "text-foreground"}`}>
                    {a.overLimit && <AlertTriangle className="w-3.5 h-3.5" />}
                    {money(a.balance)}
                  </span>
                </div>
              </Link>
            ))}
          </div>

          {/* Tablet/desktop: full table */}
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>AR Number</TableHead>
                  <TableHead className="text-right">Credit Limit</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((a) => (
                  <TableRow key={a.upid}>
                    <TableCell className="font-medium">
                      <Link href={`/e/${slug}/dashboard/debtors/${a.upid}`} className="hover:underline">
                        {accountName(a)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{a.profileType === "TRAVEL_AGENT" ? "Travel Agent" : "Company"}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{a.arNumber || "—"}</TableCell>
                    <TableCell className="text-right">{a.creditLimit != null ? money(a.creditLimit) : "—"}</TableCell>
                    <TableCell className="text-right font-medium">
                      <div className="flex items-center justify-end gap-1.5">
                        {a.overLimit && <AlertTriangle className="w-3.5 h-3.5 text-destructive" />}
                        <span className={a.overLimit ? "text-destructive" : ""}>{money(a.balance)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Link href={`/e/${slug}/dashboard/debtors/${a.upid}`}>
                        <Button variant="outline" size="sm">View</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}
