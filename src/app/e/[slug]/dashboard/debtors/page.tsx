"use client"

import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { Plus, Landmark, AlertTriangle } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useProperty } from "@/components/providers/property-provider"
import { MobileCard, MobileCardList } from "@/components/ui/mobile-card"
import { PageHeader } from "@/components/ui/page-header"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { FilterBar } from "@/components/ui/filter-bar"
import { useUrlState } from "@/lib/use-url-state"

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

const accountType = (a: DebtorAccount) => (a.profileType === "TRAVEL_AGENT" ? "Travel agent" : "Company")

const money = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" })

// useUrlState reads the query string — the page needs a Suspense boundary.
export default function DebtorsPage() {
  return (
    <Suspense>
      <DebtorsList />
    </Suspense>
  )
}

function DebtorsList() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const { currentProperty } = useProperty()
  const propertyId = currentProperty?.id ?? ""

  const [accounts, setAccounts] = useState<DebtorAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  // The list is filtered in the browser as you type; the search follows into the URL
  // (?q=) 300 ms after the last keystroke so Back from an account keeps it. A URL change
  // that didn't come from typing (Back/Forward) flows back into the box.
  const [urlSearch, setUrlSearch] = useUrlState<string>("q", "")
  const [search, setSearch] = useState(urlSearch)
  const lastWrittenSearch = useRef(urlSearch)
  useEffect(() => {
    if (urlSearch !== lastWrittenSearch.current) {
      lastWrittenSearch.current = urlSearch
      setSearch(urlSearch)
    }
  }, [urlSearch])
  useEffect(() => {
    const next = search.trim()
    if (next === lastWrittenSearch.current) return
    const t = setTimeout(() => {
      lastWrittenSearch.current = next
      setUrlSearch(next)
    }, 300)
    return () => clearTimeout(t)
  }, [search, setUrlSearch])
  const clearSearch = () => {
    lastWrittenSearch.current = ""
    setSearch("")
    setUrlSearch("")
  }

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

  const term = search.trim().toLowerCase()
  const shown = useMemo(
    () =>
      term
        ? accounts.filter((a) => accountName(a).toLowerCase().includes(term) || (a.arNumber ?? "").toLowerCase().includes(term))
        : accounts,
    [accounts, term]
  )

  const accountUrl = (a: DebtorAccount) => `/e/${slug}/dashboard/debtors/${a.upid}`

  const columns: ListColumn<DebtorAccount>[] = [
    { key: "name", header: "Account", primary: true, cell: accountName, sortValue: accountName },
    {
      key: "type",
      header: "Type",
      sortValue: accountType,
      cell: (a) => <Badge variant="outline">{accountType(a)}</Badge>,
    },
    {
      key: "ar",
      header: "AR number",
      sortValue: (a) => a.arNumber,
      className: "text-muted-foreground",
      cell: (a) => a.arNumber || "—",
    },
    {
      key: "limit",
      header: "Credit limit",
      align: "right",
      sortValue: (a) => a.creditLimit,
      cell: (a) => (a.creditLimit != null ? money(a.creditLimit) : "—"),
    },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      sortValue: (a) => a.balance,
      className: "font-medium",
      cell: (a) => (
        <div className="flex items-center justify-end gap-1.5">
          {a.overLimit && <AlertTriangle className="w-3.5 h-3.5 text-destructive" />}
          <span className={a.overLimit ? "text-destructive" : ""}>{money(a.balance)}</span>
        </div>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      // The row already opens the account — the button must not trigger it twice.
      cell: (a) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Link href={accountUrl(a)}>
            <Button variant="outline" size="sm">View</Button>
          </Link>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Debtors"
        hint="Accounts receivable — travel agent and corporate credit accounts."
        actionsClassName="gap-2 max-sm:w-full"
        actions={
          <Link href={`/e/${slug}/dashboard/debtors/new`} className="max-sm:w-full">
            <Button className="w-full sm:w-auto"><Plus className="w-4 h-4 mr-2" /> New account</Button>
          </Link>
        }
      />

      <div>
        <FilterBar
          className="mb-3"
          search={{ value: search, onChange: setSearch, placeholder: "Account name or AR number…" }}
          activeCount={term ? 1 : 0}
          onClear={clearSearch}
        />
        <ListTable
          rows={shown}
          columns={columns}
          rowKey={(a) => a.upid}
          rowHref={accountUrl}
          loading={loading}
          error={loadError}
          onRetry={fetchAccounts}
          empty={
            accounts.length === 0
              ? {
                  icon: Landmark,
                  title: "No credit accounts yet",
                  description: "Activate a Travel Agent or Company profile as a credit account to start billing charges to it.",
                }
              : { icon: Landmark, title: "No accounts match your search" }
          }
          exportName="debtors"
          // Phones keep the cards sitting on the page, as before — no box around them.
          className="max-md:border-0 max-md:bg-transparent"
          mobile={
            <MobileCardList>
              {shown.map((a) => (
                <MobileCard
                  key={a.upid}
                  title={accountName(a)}
                  badge={<Badge variant="outline">{accountType(a)}</Badge>}
                  tone={a.overLimit ? "danger" : undefined}
                  meta={[
                    { label: "AR number", value: a.arNumber || "—" },
                    { label: "Credit limit", value: a.creditLimit != null ? money(a.creditLimit) : "—" },
                    {
                      label: "Balance",
                      value: (
                        <span className={`flex items-center gap-1.5 ${a.overLimit ? "text-destructive" : ""}`}>
                          {a.overLimit && <AlertTriangle className="w-3.5 h-3.5" />}
                          {money(a.balance)}
                        </span>
                      ),
                    },
                  ]}
                  onClick={() => router.push(accountUrl(a))}
                />
              ))}
            </MobileCardList>
          }
        />
      </div>
    </div>
  )
}
