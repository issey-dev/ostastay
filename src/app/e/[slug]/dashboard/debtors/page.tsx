"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { Plus, Landmark, AlertTriangle } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { useProperty } from "@/components/providers/property-provider"

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

  const fetchAccounts = useCallback(() => {
    if (!propertyId) return
    setLoading(true)
    fetch(`/api/debtors/accounts?propertyId=${propertyId}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => { if (Array.isArray(data)) setAccounts(data) })
      .finally(() => setLoading(false))
  }, [propertyId])

  useEffect(() => { fetchAccounts() }, [fetchAccounts])

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Debtors</h2>
          <p className="text-sm text-muted-foreground">Accounts Receivable — Travel Agent and corporate credit accounts.</p>
        </div>
        <Link href={`/e/${slug}/dashboard/debtors/new`}>
          <Button><Plus className="w-4 h-4 mr-2" /> New Account</Button>
        </Link>
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="No credit accounts yet"
          description="Activate a Travel Agent or Company profile as a credit account to start billing charges to it."
        />
      ) : (
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
      )}
    </div>
  )
}
