"use client"

import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useProperty } from "@/components/providers/property-provider"
import { Users, Plus, Calendar as CalendarIcon, UserCheck } from "@/components/icons"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { format, parseISO } from "date-fns"
import { StatusBadge } from "@/components/ui/status-badge"
import { PageHeader } from "@/components/ui/page-header"
import { MobileCard, MobileCardList } from "@/components/ui/mobile-card"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { FilterBar } from "@/components/ui/filter-bar"
import { useUrlState } from "@/lib/use-url-state"

type Group = {
  id: string
  code: string
  name: string
  status: string
  startDate: string
  endDate: string
  totalRoomsHeld: number
  reservations?: unknown[]
}

const pickedUpCount = (g: Group) => g.reservations?.length || 0

// useUrlState reads the query string — the page needs a Suspense boundary.
export default function GroupsDashboard() {
  return (
    <Suspense>
      <GroupsList />
    </Suspense>
  )
}

function GroupsList() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const { currentProperty } = useProperty()
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  // The list is filtered in the browser as you type; the search follows into the URL
  // (?q=) 300 ms after the last keystroke so Back from a group keeps it. A URL change
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

  const fetchGroups = async () => {
    if (!currentProperty) return
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch(`/api/groups?propertyId=${currentProperty.id}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setGroups(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error(e)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchGroups()
  }, [currentProperty])

  const term = search.trim().toLowerCase()
  const shown = useMemo(
    () => (term ? groups.filter((g) => g.name?.toLowerCase().includes(term) || g.code?.toLowerCase().includes(term)) : groups),
    [groups, term]
  )

  const groupUrl = (g: Group) => `/e/${slug}/dashboard/groups/${g.id}`

  const columns: ListColumn<Group>[] = [
    {
      key: "code",
      header: "Group code",
      sortValue: (g) => g.code,
      cell: (g) => (
        <span className="font-mono text-xs font-bold text-foreground bg-muted px-2 py-1 rounded-none">{g.code}</span>
      ),
    },
    { key: "name", header: "Name", primary: true, className: "font-semibold", sortValue: (g) => g.name, cell: (g) => g.name },
    {
      key: "dates",
      header: "Dates",
      className: "text-sm text-muted-foreground",
      sortValue: (g) => g.startDate,
      csv: (g) => `${g.startDate.slice(0, 10)} - ${g.endDate.slice(0, 10)}`,
      cell: (g) => (
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-4 h-4 text-muted-foreground" />
          {format(parseISO(g.startDate), "dd-MMM")} - {format(parseISO(g.endDate), "dd-MMM-yy")}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      sortValue: (g) => g.status,
      cell: (g) => <StatusBadge label={g.status} status={g.status} />,
    },
    {
      key: "held",
      header: "Rooms held",
      align: "center",
      className: "font-semibold text-foreground",
      sortValue: (g) => g.totalRoomsHeld,
      cell: (g) => g.totalRoomsHeld,
    },
    {
      key: "picked",
      header: "Picked up",
      align: "center",
      sortValue: pickedUpCount,
      cell: (g) => (
        <div className="flex items-center justify-center gap-1.5 font-semibold text-foreground">
          <UserCheck className="w-4 h-4" />
          {pickedUpCount(g)}
        </div>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      // The row already opens the group — the button must not trigger it twice.
      cell: (g) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Link href={groupUrl(g)}>
            <Button variant="outline" size="sm">Manage</Button>
          </Link>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Group Blocks"
        hint="Manage blocks of rooms for weddings, corporate events, and tours."
        className="max-md:flex-col max-md:items-stretch max-md:gap-3"
        actions={
          <Link href={`/e/${slug}/dashboard/groups/new`} className="max-md:w-full">
            <Button className="flex items-center gap-2 max-md:w-full">
              <Plus className="w-4 h-4" />
              New group block
            </Button>
          </Link>
        }
      />

      <div>
        <FilterBar
          className="mb-3"
          search={{ value: search, onChange: setSearch, placeholder: "Group name or code…" }}
          activeCount={term ? 1 : 0}
          onClear={clearSearch}
        />
        <ListTable
          rows={shown}
          columns={columns}
          rowKey={(g) => g.id}
          rowHref={groupUrl}
          loading={loading}
          error={loadError}
          onRetry={fetchGroups}
          empty={
            groups.length === 0
              ? { icon: Users, title: "No group blocks found", description: "Create a block to reserve inventory for an event." }
              : { icon: Users, title: "No groups match your search" }
          }
          // Phones keep the cards sitting on the page, as before — no box around them.
          className="max-md:border-0 max-md:bg-transparent"
          mobile={
            <MobileCardList>
              {shown.map((group) => (
                <MobileCard
                  key={group.id}
                  title={group.name}
                  subtitle={<span className="font-mono font-bold">{group.code}</span>}
                  badge={<StatusBadge label={group.status} status={group.status} />}
                  meta={[
                    {
                      label: "Dates",
                      value: `${format(parseISO(group.startDate), "dd-MMM")} - ${format(parseISO(group.endDate), "dd-MMM-yy")}`,
                      wide: true,
                    },
                    { label: "Rooms held", value: group.totalRoomsHeld },
                    {
                      label: "Picked up",
                      value: (
                        <span className="flex items-center gap-1.5">
                          <UserCheck className="w-4 h-4" /> {pickedUpCount(group)}
                        </span>
                      ),
                    },
                  ]}
                  onClick={() => router.push(groupUrl(group))}
                />
              ))}
            </MobileCardList>
          }
        />
      </div>
    </div>
  )
}
