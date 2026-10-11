"use client"

import { Fragment, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { useUrlState } from "@/lib/use-url-state"
import { UserPlus, Pencil, Trash2, MoreHorizontal } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { useRouter, useParams } from "next/navigation"
import Link from "next/link"
import { Users, Building2, Briefcase, UserCog } from "@/components/icons"
import { PageHeader } from "@/components/ui/page-header"
import { StatusBadge } from "@/components/ui/status-badge"
import { GoldStar } from "@/components/ui/gold-star"
import { primaryEmail, primaryMobile } from "@/lib/profile-communications"
import { CountryFlag } from "@/components/ui/country-flag"
import { useSystemCodeLabels } from "@/hooks/use-system-code-labels"
import { toast } from "@/lib/toast"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { EmptyState } from "@/components/ui/empty-state"
import { ErrorState } from "@/components/ui/error-state"
import { Skeleton } from "@/components/ui/skeleton"
import { FilterBar } from "@/components/ui/filter-bar"

type Profile = {
  upid: string
  profileType: string
  firstName: string
  lastName: string | null
  companyName: string | null
  classification: string
  title: string | null
  preferredLanguage: string
  dateOfBirth: string | null
  anniversaryDate: string | null
  vipLevel: string | null
  photoUrl: string | null
  greenTaxExempt: boolean
  gender: string | null
  nationality?: string | null
  isCreditAccount?: boolean
  arNumber?: string | null
  commissionRate?: number | null
  iataNumber?: string | null
  marketingOptIn: boolean
  isIncognito: boolean
  communications: {
    type: string
    value: string
    isPrimary: boolean
  }[]
  addresses?: {
    country: string | null
  }[]
  documents?: {
    documentType: string
    documentNumber: string
    issuingCountry: string | null
    issueDate: string | null
    expiryDate: string | null
  }[]
  totalStays: number
  totalRevenue: number
  lastStayDate: string | null
}

const PROFILE_TYPE_LABELS: Record<string, string> = {
  GUEST: "Guest",
  COMPANY: "Company",
  TRAVEL_AGENT: "Travel agent",
  STAFF: "Staff",
}

const displayName = (p: Profile) =>
  p.profileType === "GUEST" || p.profileType === "STAFF"
    ? `${p.firstName} ${p.lastName || ""}`.trim()
    : p.companyName || `${p.firstName} ${p.lastName || ""}`.trim()

// Phone-only directory picker (the four tabs don't fit a phone's width).
const PHONE_TABS = [
  { value: "GUEST", label: "Guests", icon: Users },
  { value: "COMPANY", label: "Corporate accounts", icon: Building2 },
  { value: "TRAVEL_AGENT", label: "Travel agents", icon: Briefcase },
  { value: "STAFF", label: "Staff", icon: UserCog },
] as const

function ProfilesDashboard() {
  const router = useRouter()
  const { slug } = useParams<{ slug: string }>()
  const { label } = useSystemCodeLabels()
  const [profiles, setProfiles] = useState<Profile[]>([])
  // Matching profiles on the server — the API returns the 50 most recently updated and
  // the full count in X-Total-Count, so the footer can say "50 of 312".
  const [total, setTotal] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [activeTab, setActiveTab] = useUrlState<string>("tab", "GUEST", ["GUEST", "COMPANY", "TRAVEL_AGENT", "STAFF"])

  // Search lives in the URL (?q=) so Back from a profile keeps it. The box is local state
  // for instant typing; the URL (and so the fetch) follows 300 ms after the last keystroke,
  // and a URL change that didn't come from typing (Back/Forward) flows back into the box.
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

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [deletingUpid, setDeletingUpid] = useState<string | null>(null)

  const fetchProfiles = useCallback((signal?: AbortSignal) => {
    setLoading(true)
    setLoadError(false)
    const params = new URLSearchParams({ search: urlSearch, profileType: activeTab })
    fetch(`/api/profiles?${params}`, { signal })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load profiles")
        const header = res.headers.get("X-Total-Count")
        setTotal(header !== null && Number.isFinite(Number(header)) ? Number(header) : undefined)
        return res.json()
      })
      .then((data) => {
        setProfiles(Array.isArray(data) ? data : [])
      })
      .catch(() => {
        if (!signal?.aborted) setLoadError(true)
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false)
      })
  }, [urlSearch, activeTab])

  // Refetch when the directory tab or the (debounced) search changes; a newer request
  // cancels the one in flight so a slow answer can't land after a newer one.
  useEffect(() => {
    const controller = new AbortController()
    fetchProfiles(controller.signal)
    return () => controller.abort()
  }, [fetchProfiles])

  const clearSearch = () => {
    lastWrittenSearch.current = ""
    setSearch("")
    setUrlSearch("")
  }

  const profileUrl = (p: Profile) => `/e/${slug}/dashboard/profiles/${p.upid}`
  const editProfile = (p: Profile) => router.push(`${profileUrl(p)}/edit`)
  const askDelete = (p: Profile) => {
    setDeletingUpid(p.upid)
    setIsDeleteDialogOpen(true)
  }

  // Small labelled badges under the name - only what matters for THAT kind of profile:
  //   guest  - visits, VIP level, nationality;
  //   company - credit account, bookings;
  //   travel agent - commission, IATA number, credit account, bookings;
  //   staff - nationality.
  // A badge for something that is not set (a "Regular" tag, "active", an empty commission)
  // is never shown.
  const profileBadges = (p: Profile) => {
    const out: { key: string; node: React.ReactNode }[] = []
    const stays = p.totalStays || 0
    const add = (key: string, node: React.ReactNode) => out.push({ key, node })
    const nationalityBadge = () =>
      p.nationality &&
      add("nat", <StatusBadge icon={<CountryFlag value={p.nationality} />} label={label("NATIONALITY", p.nationality) ?? p.nationality} tone="neutral" />)

    if (p.profileType === "GUEST") {
      add("visits", <StatusBadge label={stays === 0 ? "No stays yet" : `${stays} ${stays === 1 ? "visit" : "visits"}`} tone={stays > 0 ? "info" : "neutral"} />)
      if (p.vipLevel) add("vip", <StatusBadge label={label("VIP_LEVEL", p.vipLevel) ?? p.vipLevel} tone="warning" />)
      nationalityBadge()
    } else if (p.profileType === "COMPANY" || p.profileType === "TRAVEL_AGENT") {
      if (p.profileType === "TRAVEL_AGENT" && p.commissionRate != null) add("comm", <StatusBadge label={`${p.commissionRate}% commission`} tone="info" />)
      if (p.profileType === "TRAVEL_AGENT" && p.iataNumber) add("iata", <StatusBadge label={`IATA ${p.iataNumber}`} tone="neutral" />)
      if (p.isCreditAccount) add("credit", <StatusBadge label={p.arNumber ? `Credit account ${p.arNumber}` : "Credit account"} tone="success" />)
      if (stays > 0) add("bookings", <StatusBadge label={`${stays} ${stays === 1 ? "booking" : "bookings"}`} tone="neutral" />)
    } else {
      nationalityBadge()
    }
    if (p.classification === "BLACKLISTED") add("bl", <StatusBadge label={label("CLASSIFICATION", p.classification) ?? p.classification} tone="danger" />)
    return out
  }

  const handleDelete = async () => {
    if (!deletingUpid) return
    try {
      const res = await fetch(`/api/profiles/${deletingUpid}`, { method: "DELETE" })
      if (res.ok) {
        setIsDeleteDialogOpen(false)
        setDeletingUpid(null)
        fetchProfiles()
      } else {
        const error = await res.json()
        toast.error(error.error || "Failed to delete profile")
      }
    } catch (e) {
      console.error(e)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Client Relations"
        hint="Manage your individual guests, travel agents, and corporate accounts here. Search by name, email, or phone."
        actionsClassName="gap-2 max-sm:w-full"
        actions={
          <Button className="w-full sm:w-auto" onClick={() => router.push(`/e/${slug}/dashboard/profiles/new?type=${activeTab}`)}>
            <UserPlus className="mr-2 h-4 w-4" /> New {PROFILE_TYPE_LABELS[activeTab] ?? activeTab}
          </Button>
        }
      />

        {/* Delete Modal */}
        <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Delete profile</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this profile? Profiles with active reservations cannot be deleted.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>Cancel</Button>
              <Button type="button" variant="destructive" onClick={handleDelete}>Delete</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(String(v))} className="w-full flex-col">
        {/* Phones: the directory is a picker, not four tabs scrolling off the edge. */}
        <div className="mb-2 md:hidden">
          <Select value={activeTab} onValueChange={(v) => v && setActiveTab(v as string)}>
            <SelectTrigger className="w-full" aria-label="Directory">
              <SelectValue>
                {(() => {
                  const t = PHONE_TABS.find((x) => x.value === activeTab) ?? PHONE_TABS[0]
                  return (
                    <>
                      <t.icon className="h-4 w-4" /> {t.label}
                    </>
                  )
                })()}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {PHONE_TABS.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  <t.icon className="h-4 w-4" /> {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <TabsList className="mb-3 h-auto w-fit max-md:hidden data-horizontal:h-auto">
          {PHONE_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="gap-1.5 px-3">
              <t.icon className="h-4 w-4" /> {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

      {/* The tab already names the directory — no second heading here. */}
      <FilterBar
        className="mb-3"
        search={{ value: search, onChange: setSearch, placeholder: "Name, email, phone…" }}
        activeCount={urlSearch ? 1 : 0}
        onClear={clearSearch}
      />
      {loading ? (
        <div className="grid gap-3 grid-cols-1">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      ) : loadError ? (
        <ErrorState title="Couldn't load profiles" onRetry={() => fetchProfiles()} />
      ) : profiles.length === 0 ? (
        <EmptyState icon={Users} title="No profiles found" />
      ) : (
        <>
          <div className="grid gap-3 grid-cols-1">
            {profiles.map((p) => {
              const email = primaryEmail(p.communications)
              const mobile = primaryMobile(p.communications)
              return (
                <div
                  key={p.upid}
                  onClick={() => router.push(profileUrl(p))}
                  className="flex cursor-pointer flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-elevation-1 transition-colors hover:bg-muted/30"
                >
                  <div className="min-w-0">
                    <div className="inline-flex max-w-full items-center gap-1.5 text-lg font-semibold text-foreground">
                      {/* A real link, so Ctrl/middle-click opens it in a new tab. */}
                      <Link href={profileUrl(p)} onClick={(e) => e.stopPropagation()} className="truncate hover:underline">{displayName(p)}</Link>
                      {p.profileType === "GUEST" && p.vipLevel && <span title="VIP" className="shrink-0"><GoldStar className="h-3.5 w-3.5" /></span>}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {(p.profileType === "COMPANY" || p.profileType === "TRAVEL_AGENT") && [p.firstName, p.lastName].filter(Boolean).join(" ") && (
                        <span>{[p.firstName, p.lastName].filter(Boolean).join(" ")} · </span>
                      )}
                      {email ?? <span className="italic">No email</span>}
                      {mobile && <span> · {mobile}</span>}
                    </div>
                  </div>
                  <div className="flex items-end justify-between gap-3 border-t border-border pt-3">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                      {profileBadges(p).map((b) => <Fragment key={b.key}>{b.node}</Fragment>)}
                    </div>
                    <div className="shrink-0 self-end" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="outline" size="icon" className="h-8 w-8" title="More actions" aria-label="More actions" />}>
                          <MoreHorizontal className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-44">
                          <DropdownMenuItem className="cursor-pointer" onClick={() => editProfile(p)}>
                            <Pencil className="h-4 w-4" /> Edit profile
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" className="cursor-pointer" onClick={() => askDelete(p)}>
                            <Trash2 className="h-4 w-4" /> Delete profile
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {total !== undefined && total > profiles.length ? `${profiles.length} of ${total} - refine the search to see the rest` : `${profiles.length} ${profiles.length === 1 ? "result" : "results"}`}
          </p>
        </>
      )}
      </Tabs>
    </div>
  )
}

// useUrlState reads the query string — the page needs a Suspense boundary.
export default function ProfilesPage() {
  return (
    <Suspense>
      <ProfilesDashboard />
    </Suspense>
  )
}
