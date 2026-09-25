"use client"

import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import { useUrlState } from "@/lib/use-url-state"
import { UserPlus, Pencil, Trash2, Star, MoreHorizontal } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { useRouter, useParams } from "next/navigation"
import { Users, Building2, Briefcase, UserCog } from "@/components/icons"
import { PageHeader } from "@/components/ui/page-header"
import { primaryEmail, primaryMobile } from "@/lib/profile-communications"
import { CountryFlag } from "@/components/ui/country-flag"
import { useSystemCodeLabels } from "@/hooks/use-system-code-labels"
import { toast } from "@/lib/toast"
import { ContactLink } from "@/components/ui/contact-link"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { MobileCard, MobileCardList } from "@/components/ui/mobile-card"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
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

const classColors: Record<string, string> = {
  VIP: "bg-foreground text-background border-transparent",
  REGULAR: "bg-muted text-foreground border-border",
  BLACKLISTED: "bg-destructive-muted text-destructive border-destructive/30",
}

// One consistent monochrome treatment for every avatar — the initials themselves are
// the distinguishing feature, not a per-person hue (the app's palette is monochromatic
// with color reserved for status/tone, not decorative identity).
const AVATAR_COLOR = "bg-muted text-foreground"

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
  const { label, country } = useSystemCodeLabels()
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

  const columns: ListColumn<Profile>[] = [
    {
      key: "name",
      header: "Guest",
      primary: true,
      sortValue: displayName,
      cell: (p) => (
        <span className="inline-flex items-center gap-3">
          <span className={`h-10 w-10 rounded-none flex items-center justify-center font-bold text-sm shrink-0 ${AVATAR_COLOR}`}>
            {p.firstName?.charAt(0) || ""}{p.lastName?.charAt(0) || ""}
          </span>
          <span className="flex flex-col">
            <span className="inline-flex items-center gap-1.5">
              {/* inline-flex blocks the link's own underline — re-apply it on the name. */}
              <span className="[a:hover_&]:underline">{displayName(p)}</span>
              {p.vipLevel && <Star className="h-4 w-4 text-warning fill-none shrink-0" />}
            </span>
            {p.addresses?.[0]?.country && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground font-medium">
                <CountryFlag value={p.addresses[0].country} />
                {country(p.addresses[0].country)}
              </span>
            )}
          </span>
        </span>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      csv: (p) => [primaryEmail(p.communications), primaryMobile(p.communications)].filter(Boolean).join(" / "),
      cell: (p) => (
        <div className="text-sm">
          {primaryEmail(p.communications) ? <div className="text-foreground">{primaryEmail(p.communications)}</div> : <div className="text-muted-foreground italic text-xs">No email</div>}
          {primaryMobile(p.communications) ? <div className="text-muted-foreground">{primaryMobile(p.communications)}</div> : <div className="text-muted-foreground italic text-xs">No phone</div>}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (p) => label("CLASSIFICATION", p.classification),
      cell: (p) => (
        <div className="flex flex-col gap-1 items-start">
          <span className={`px-2 py-1 rounded-none text-[10px] uppercase font-bold border ${classColors[p.classification] || "bg-muted text-foreground"}`}>
            {label("CLASSIFICATION", p.classification)}
          </span>
          {p.vipLevel && (
            <span className="px-2 py-1 rounded-none text-[10px] uppercase font-bold border bg-warning-muted text-warning border-warning/30">
              {label("VIP_LEVEL", p.vipLevel)}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "history",
      header: "History",
      sortValue: (p) => p.totalStays || 0,
      csv: (p) => `${p.totalStays || 0} stays / ${(p.totalRevenue || 0).toFixed(2)}`,
      cell: (p) => (
        <div className="flex flex-col text-sm">
          <span className="text-foreground font-medium">{p.totalStays || 0} Stays</span>
          <span className="text-muted-foreground">${(p.totalRevenue || 0).toFixed(2)}</span>
        </div>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      // The row opens the profile — the buttons must not also do that.
      cell: (p) => (
        <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" className="text-primary" onClick={() => editProfile(p)}>
            <Pencil className="mr-2 h-4 w-4" /> Edit
          </Button>
          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => askDelete(p)}>
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </Button>
        </div>
      ),
    },
  ]

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
        <TabsList variant="line" className="w-full justify-start overflow-x-auto border-b rounded-none h-auto p-0 bg-transparent mb-6 max-md:hidden">
          <TabsTrigger
            value="GUEST"
            className="data-active:text-primary dark:data-active:text-primary shrink-0 rounded-none px-3 py-2 font-medium text-muted-foreground sm:px-6 sm:py-3"
          >
            <Users className="w-4 h-4 mr-2" /> Guests
          </TabsTrigger>
          <TabsTrigger
            value="COMPANY"
            className="data-active:text-primary dark:data-active:text-primary shrink-0 rounded-none px-3 py-2 font-medium text-muted-foreground sm:px-6 sm:py-3"
          >
            <Building2 className="w-4 h-4 mr-2" /> Corporate accounts
          </TabsTrigger>
          <TabsTrigger
            value="TRAVEL_AGENT"
            className="data-active:text-primary dark:data-active:text-primary shrink-0 rounded-none px-3 py-2 font-medium text-muted-foreground sm:px-6 sm:py-3"
          >
            <Briefcase className="w-4 h-4 mr-2" /> Travel agents
          </TabsTrigger>
          <TabsTrigger
            value="STAFF"
            className="data-active:text-primary dark:data-active:text-primary shrink-0 rounded-none px-3 py-2 font-medium text-muted-foreground sm:px-6 sm:py-3"
          >
            <UserCog className="w-4 h-4 mr-2" /> Staff
          </TabsTrigger>
        </TabsList>

      {/* The tab already names the directory — no second heading here. */}
      <FilterBar
        className="mb-3"
        search={{ value: search, onChange: setSearch, placeholder: "Name, email, phone…" }}
        activeCount={urlSearch ? 1 : 0}
        onClear={clearSearch}
      />
      <ListTable
        rows={profiles}
        columns={columns}
        rowKey={(p) => p.upid}
        rowHref={profileUrl}
        total={total}
        loading={loading}
        error={loadError}
        onRetry={() => fetchProfiles()}
        empty={{ icon: Users, title: "No profiles found" }}
        exportName={`profiles-${activeTab.toLowerCase()}`}
        // Capped at the 50 most recently updated — say so quietly, next to "50 of 312".
        toolbar={total !== undefined && total > profiles.length ? <span>Refine the search to see the rest</span> : undefined}
        mobile={
          <MobileCardList className="p-4">
            {profiles.map((p) => {
              const open = () => router.push(profileUrl(p))
              const email = primaryEmail(p.communications)
              const mobile = primaryMobile(p.communications)
              return (
                <MobileCard
                  key={p.upid}
                  onClick={open}
                  title={
                    <span className="inline-flex items-center gap-1.5">
                      {displayName(p)}
                      {p.vipLevel && <Star className="h-3.5 w-3.5 text-warning fill-none shrink-0" />}
                    </span>
                  }
                  subtitle={
                    p.addresses?.[0]?.country ? (
                      <span className="inline-flex items-center gap-1">
                        <CountryFlag value={p.addresses[0].country} />
                        {country(p.addresses[0].country)}
                      </span>
                    ) : undefined
                  }
                  badge={
                    // "Regular" is the default for nearly everyone — only flag the exceptions.
                    p.classification !== "REGULAR" ? (
                      <span className={`px-2 py-1 rounded-none text-[10px] uppercase font-bold border ${classColors[p.classification] || 'bg-muted text-foreground'}`}>
                        {label("CLASSIFICATION", p.classification)}
                      </span>
                    ) : undefined
                  }
                  meta={[
                    { label: "Stays", value: p.totalStays || 0 },
                    { label: "Revenue", value: `$${(p.totalRevenue || 0).toFixed(2)}` },
                  ]}
                  actions={
                    <>
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => editProfile(p)}>
                        <Pencil className="mr-2 h-4 w-4" /> Edit
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" aria-label="More actions" />}>
                          <MoreHorizontal className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-48">
                          <DropdownMenuItem onClick={open}>
                            <Users className="h-4 w-4" /> Open profile
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onClick={() => askDelete(p)}>
                            <Trash2 className="h-4 w-4" /> Delete profile
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  }
                >
                  {/* Tapping a contact link dials / mails — it must not also open the profile. */}
                  <div className="flex flex-col items-start gap-1 text-sm text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                    {email ? <ContactLink type="email" value={email} className="py-0.5" /> : <span className="italic text-xs">No email</span>}
                    {mobile && <ContactLink type="phone" value={mobile} className="py-0.5" />}
                  </div>
                </MobileCard>
              )
            })}
          </MobileCardList>
        }
      />
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
