"use client"

import { Suspense, useEffect, useState, use } from "react"
import { useUrlState } from "@/lib/use-url-state"
import { useRouter, useParams } from "next/navigation"
import { useSmartBack } from "@/lib/use-smart-back"
import { ArrowLeft, Pencil, ExternalLink, Star, CalendarDays, History as HistoryIcon, UserX, ChevronLeft } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { InlineLoading } from "@/components/ui/inline-loading"
import { ActionBar } from "@/components/ui/action-bar"
import { primaryEmail, primaryMobile } from "@/lib/profile-communications"
import { useProperty } from "@/components/providers/property-provider"
import { InfoHint } from "@/components/ui/info-hint"
import { PageHeader } from "@/components/ui/page-header"
import Link from "next/link"
import { CountryFlag, CountryLabel } from "@/components/ui/country-flag"
import { useSystemCodeLabels } from "@/hooks/use-system-code-labels"
import { ContactLink } from "@/components/ui/contact-link"
import { cn } from "@/lib/utils"
import { greenTaxExemptReason, EXEMPT_REASON_LABELS } from "@/lib/green-tax-exemption"

const PROFILE_TYPE_LABELS: Record<string, string> = {
  GUEST: "Guest", COMPANY: "Company", TRAVEL_AGENT: "Travel agent", STAFF: "Staff",
}
const COMM_TYPE_LABELS: Record<string, string> = { EMAIL: "Email", MOBILE: "Mobile", SOCIAL: "Social" }
const ADDRESS_TYPE_LABELS: Record<string, string> = { HOME: "Home", BUSINESS: "Business", BILLING: "Billing" }
const classColors: Record<string, string> = {
  VIP: "bg-foreground text-background border-transparent",
  REGULAR: "bg-muted text-foreground border-border",
  BLACKLISTED: "bg-destructive-muted text-destructive border-destructive/30",
}

type StayRecord = {
  id: string
  confirmationNo: string
  status: string
  propertyId?: string
  propertyName: string
  checkInDate: string
  checkOutDate: string
  roomTypes: string[]
  revenueTotal: number
  revenueBreakdown: { code: string; description: string; amount: number }[]
}

type FieldEntry = [label: string, value: React.ReactNode]

const filled = (v: React.ReactNode) => v !== null && v !== undefined && v !== "" && v !== false

/**
 * Label-above-value fields — only the FILLED ones (DESKTOP_PLAN D7: view mode never shows a
 * grid of "—"). Renders nothing when every value is empty.
 */
function Fields({ entries, className }: { entries: FieldEntry[]; className?: string }) {
  const shown = entries.filter(([, v]) => filled(v))
  if (shown.length === 0) return null
  return (
    <dl className={cn("grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3 lg:grid-cols-4", className)}>
      {shown.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-0.5 text-sm font-medium text-foreground break-words">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** One item of the summary strip under the header. */
function Item({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-baseline gap-1.5", className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 text-sm font-medium text-foreground">{children}</span>
    </div>
  )
}

/** A quiet "Add …" link into the Edit form, scrolled to the matching section. */
function AddLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-sm font-medium text-primary underline-offset-2 hover:underline">
      {children}
    </Link>
  )
}

/** Phones only: the show/hide control for a secondary section (desktop never renders it). */
function PhoneToggle({ open, onToggle, label }: { open: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${open ? "Hide" : "Show"} ${label}`}
      className="ml-auto inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-md text-xs font-medium text-muted-foreground md:hidden"
    >
      {open ? "Hide" : "Show"}
      <ChevronLeft className={cn("h-4 w-4 transition-transform", open ? "-rotate-90" : "rotate-180")} />
    </button>
  )
}

/**
 * One titled group inside a tab's single card — a heading and its content, divided from the
 * next by a rule, instead of a bordered card per group (DESKTOP_PLAN §2.2 "Profiles").
 */
function Section({
  id,
  title,
  hint,
  action,
  toggle,
  bodyClassName,
  children,
}: {
  id: string
  title: string
  hint?: React.ReactNode
  /** A small link on the heading's right (e.g. "Add"). */
  action?: React.ReactNode
  /** Phones: the fold control. */
  toggle?: React.ReactNode
  bodyClassName?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="py-5 first:pt-0 last:pb-0">
      <h2 id={`${id}-title`} className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        {title}
        {hint && <InfoHint label={title}>{hint}</InfoHint>}
        {action && <span className="ml-auto font-normal">{action}</span>}
        {toggle}
      </h2>
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

// Secondary sections a phone starts folded (see .agents/docs/MOBILE_PLAN.md §3) — the phone
// contact card above the tabs already carries the primary email and mobile.
const PHONE_FOLDED = ["communications", "address"]

// "stay-history" is the old value — kept so existing links still open the Stays tab.
const PROFILE_TABS = ["overview", "stays", "finance", "documents", "stay-history"] as const
type ProfileTab = (typeof PROFILE_TABS)[number]

// useUrlState reads the query string — the page needs a Suspense boundary.
export default function ProfileDetailRoute({ params }: { params: Promise<{ upid: string }> }) {
  return (
    <Suspense>
      <ProfileDetailPage params={params} />
    </Suspense>
  )
}

function ProfileDetailPage({ params }: { params: Promise<{ upid: string }> }) {
  const { upid } = use(params)
  const [rawTab, setTab] = useUrlState<ProfileTab>("tab", "overview", PROFILE_TABS)
  const tab: ProfileTab = rawTab === "stay-history" ? "stays" : rawTab
  const router = useRouter()
  const { slug } = useParams<{ slug: string }>()
  const goBack = useSmartBack(`/e/${slug}/dashboard/profiles`)
  const { currentProperty } = useProperty()
  const { label, country } = useSystemCodeLabels()

  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [stayHistory, setStayHistory] = useState<{ future: StayRecord[]; history: StayRecord[]; visitsToProperty: number | null } | null>(null)
  const [historyLoading, setHistoryLoading] = useState(true)
  // Phones only: which secondary sections are unfolded. Desktop ignores this entirely.
  const [unfolded, setUnfolded] = useState<Record<string, boolean>>({})
  const [negotiatedRates, setNegotiatedRates] = useState<{ available: { id: string; name: string; code: string; propertyName: string }[]; links: { ratePlanId: string; commissionRate: number | null }[] } | null>(null)

  useEffect(() => {
    fetch(`/api/profiles/${upid}`)
      .then((r) => r.json())
      .then(setProfile)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [upid])

  useEffect(() => {
    fetch(`/api/profiles/${upid}/negotiated-rates`)
      .then((r) => r.json())
      .then(setNegotiatedRates)
      .catch(console.error)
  }, [upid])

  useEffect(() => {
    const qs = currentProperty?.id ? `?propertyId=${currentProperty.id}` : ""
    fetch(`/api/profiles/${upid}/stay-history${qs}`)
      .then((r) => r.json())
      .then(setStayHistory)
      .catch(console.error)
      .finally(() => setHistoryLoading(false))
  }, [upid, currentProperty?.id])

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }
  if (!profile || profile.error) {
    return <EmptyState icon={UserX} title="Profile not found" className="py-24" />
  }

  // The stored title is a system code ("MRS"); the heading shows its configured label ("Mrs").
  // Until the codes load, or for a code with no label, a bare upper-case code reads "Mrs".
  const titleLabel = (code: string | null | undefined) => {
    const t = label("TITLE", code)
    if (!t || t !== code || t !== t.toUpperCase()) return t
    return t.charAt(0) + t.slice(1).toLowerCase()
  }
  const isB2B = profile.profileType === "COMPANY" || profile.profileType === "TRAVEL_AGENT"
  const isIndividual = !isB2B
  const displayName = isB2B
    ? profile.companyName || `${profile.firstName} ${profile.lastName ?? ""}`.trim()
    : [titleLabel(profile.title), profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" ")

  const editHref = `/e/${slug}/dashboard/profiles/${upid}/edit`
  const editAt = (section: string) => `${editHref}#${section}`

  const folded = (id: string) => PHONE_FOLDED.includes(id) && !unfolded[id]
  const toggle = (id: string) => setUnfolded((u) => ({ ...u, [id]: folded(id) }))
  const phoneToggle = (id: string, name: string) =>
    PHONE_FOLDED.includes(id) ? <PhoneToggle open={!folded(id)} onToggle={() => toggle(id)} label={name} /> : undefined
  /** Classes for a foldable section's body on phones. */
  const foldClass = (id: string) => (folded(id) ? "max-md:hidden" : undefined)

  const email = primaryEmail(profile.communications)
  const mobile = primaryMobile(profile.communications)
  // The API lists in-house and upcoming stays first; this page only links this property's.
  const nextStay = stayHistory?.future?.[0]
  const nextStayLinkable = nextStay && (!nextStay.propertyId || nextStay.propertyId === currentProperty?.id)

  const communications: any[] = profile.communications ?? []
  const addresses: any[] = profile.addresses ?? []
  const documents: any[] = profile.documents ?? []
  const attachments: any[] = profile.attachments ?? []
  const notes: any[] = profile.notes ?? []
  const dietary = (profile.preferences ?? []).filter((p: any) => p.category === "DIETARY")
  const preferences = (profile.preferences ?? []).filter((p: any) => p.category === "PREFERENCE")
  const rateLinks = (negotiatedRates?.links ?? [])
    .map((link) => ({ link, rp: negotiatedRates?.available.find((r) => r.id === link.ratePlanId) }))
    .filter((x) => x.rp)

  const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString() : null)
  const nationality = profile.nationality
    ? <CountryLabel value={profile.nationality} name={label("NATIONALITY", profile.nationality)} />
    : null

  // Marketing / compliance switches — only the ones that are ON are worth a line.
  const flags = [
    profile.marketingOptIn && "On the mail list",
    // Same rule as posting: under 2, Maldivian, work permit, or ticked by hand.
    (() => {
      const reason = greenTaxExemptReason(profile, new Date(), 2)
      return reason ? `Green Tax exempt (${EXEMPT_REASON_LABELS[reason].toLowerCase()})` : null
    })(),
    profile.isIncognito && "Incognito",
  ].filter(Boolean) as string[]

  const billingEntries: FieldEntry[] = [
    ["AR number", profile.arNumber],
    ["Credit limit", profile.creditLimit != null ? <span className="tabular-nums">${Number(profile.creditLimit).toFixed(2)}</span> : null],
    ["Credit account", isB2B && profile.isCreditAccount
      ? <Link href={`/e/${slug}/dashboard/debtors/${upid}`} className="hover:underline">Active · open account</Link>
      : null],
    ["IATA number", isB2B ? profile.iataNumber : null],
    ["TIN", isB2B ? profile.tinNumber : null],
    ["Booking method", isB2B ? profile.bookingMethod : null],
  ]
  const hasBilling = billingEntries.some(([, v]) => filled(v))

  // The personal details a front desk usually wants and a profile often lacks.
  const missingPersonal = isIndividual && (!profile.gender || !profile.dateOfBirth || !profile.nationality || !profile.preferredLanguage)

  const renderStayRow = (r: StayRecord, showBreakdown: boolean) => (
    <div key={r.id} className="rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-sm">
            {/* A real link to the stay (DESKTOP_PLAN D4) — only for this property's bookings,
                the dashboard is one property at a time. */}
            {!r.propertyId || r.propertyId === currentProperty?.id ? (
              <Link href={`/e/${slug}/dashboard/reservations/${r.id}`} className="hover:underline">
                {r.confirmationNo}
              </Link>
            ) : (
              r.confirmationNo
            )}{" "}
            — {r.propertyName}
          </p>
          <p className="text-xs text-muted-foreground">
            {new Date(r.checkInDate).toLocaleDateString()} – {new Date(r.checkOutDate).toLocaleDateString()}
            {r.roomTypes.length > 0 && <> · {r.roomTypes.join(", ")}</>}
          </p>
        </div>
        <div className="text-right shrink-0">
          <Badge variant="outline">{r.status}</Badge>
          <p className="text-sm font-semibold mt-1 tabular-nums">${r.revenueTotal.toFixed(2)}</p>
        </div>
      </div>
      {showBreakdown && r.revenueBreakdown.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border text-xs text-muted-foreground space-y-0.5">
          {r.revenueBreakdown.map((b) => (
            <div key={b.code} className="flex justify-between">
              <span>{b.code} — {b.description}</span>
              <span className="tabular-nums">${b.amount.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div className="flex flex-col gap-4 pb-12">
      {/* Header — mirrors the Edit form's sticky header. Breadcrumbs ("Client Relations ›")
          replace the back arrow from md up. */}
      <div className="sticky top-0 z-10 bg-muted/80 backdrop-blur-md pb-4 pt-2 border-b border-border flex flex-col gap-3 max-md:static max-md:bg-transparent max-md:backdrop-blur-none">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" onClick={goBack} title="Back" aria-label="Back" className="shrink-0 md:hidden">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <PageHeader
            className="min-w-0 flex-1 max-sm:flex-col max-sm:items-stretch"
            crumb={null}
            tabTitle={displayName || "Unnamed profile"}
            title={
              <span className="flex min-w-0 flex-wrap items-center gap-2 max-sm:break-words">
                {displayName || "Unnamed profile"}
                <Badge variant="outline">{PROFILE_TYPE_LABELS[profile.profileType] ?? profile.profileType}</Badge>
                <span className={`px-2 py-1 rounded-none text-[10px] uppercase font-bold border ${classColors[profile.classification] || "bg-muted text-foreground"}`}>
                  {label("CLASSIFICATION", profile.classification)}
                </span>
                {profile.vipLevel && (
                  <span className="px-2 py-1 rounded-none text-[10px] uppercase font-bold border bg-warning-muted text-warning border-warning/30 inline-flex items-center gap-1">
                    <Star className="h-3 w-3 fill-none" /> {label("VIP_LEVEL", profile.vipLevel)}
                  </span>
                )}
              </span>
            }
            actions={
              <ActionBar
                className="max-sm:w-full"
                primary={
                  <Button className="w-full sm:w-auto" onClick={() => router.push(editHref)}>
                    <Pencil className="mr-2 h-4 w-4" /> Edit
                  </Button>
                }
              />
            }
          />
        </div>

        {/* Summary strip — the facts people open a profile for, on one line. Contact and the
            next stay are phone-card items on phones (below), so they are desktop-only here. */}
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1.5">
          {email && <Item label="Email" className="max-md:hidden"><ContactLink type="email" value={email} /></Item>}
          {mobile && <Item label="Phone" className="max-md:hidden"><ContactLink type="phone" value={mobile} /></Item>}
          {!email && !mobile && (
            <span className="text-sm text-muted-foreground max-md:hidden">
              No phone or email · <AddLink href={editAt("communications")}>Add</AddLink>
            </span>
          )}
          {nationality && <Item label="Nationality">{nationality}</Item>}
          <Item label="Visits">
            <span className="tabular-nums">
              {stayHistory?.visitsToProperty != null && <>{stayHistory.visitsToProperty} here · </>}
              {profile.totalStays ?? 0} across the group
            </span>
          </Item>
          {nextStay && (
            <Item label={nextStay.status === "CHECKED_IN" ? "In house" : "Next stay"} className="max-md:hidden">
              {nextStayLinkable ? (
                <Link href={`/e/${slug}/dashboard/reservations/${nextStay.id}`} className="hover:underline">
                  {nextStay.confirmationNo}
                </Link>
              ) : (
                nextStay.confirmationNo
              )}
              <span className="font-normal text-muted-foreground">
                {" "}· {fmtDate(nextStay.checkInDate)} – {fmtDate(nextStay.checkOutDate)}
              </span>
            </Item>
          )}
          {isB2B && profile.isCreditAccount && (
            <Item label="Credit account">
              <Link href={`/e/${slug}/dashboard/debtors/${upid}`} className="hover:underline">
                {profile.arNumber || "Open"}
              </Link>
            </Item>
          )}
        </div>
      </div>

      {/* Phones: the reasons someone opens a profile on the go — call, email, and the
          next stay — first, as big tap targets. */}
      <div className="md:hidden rounded-2xl bg-card p-2 shadow-elevation-1 ring-1 ring-foreground/5">
        {mobile || email ? (
          <div className="divide-y divide-border">
            {mobile && (
              <ContactLink type="phone" value={mobile} showIcon className="flex min-h-11 w-full px-2 text-sm font-medium text-foreground" />
            )}
            {email && (
              <ContactLink type="email" value={email} showIcon className="flex min-h-11 w-full px-2 text-sm font-medium text-foreground" />
            )}
          </div>
        ) : (
          <p className="px-2 py-3 text-sm text-muted-foreground italic">No phone or email on file.</p>
        )}
        {nextStay && (
          <button
            type="button"
            onClick={() => router.push(`/e/${slug}/dashboard/reservations/${nextStay.id}`)}
            className="mt-1 flex min-h-11 w-full items-center gap-3 rounded-xl bg-muted/60 px-3 py-2 text-left"
          >
            <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-muted-foreground">
                {nextStay.status === "CHECKED_IN" ? "In house" : "Next stay"} · {nextStay.confirmationNo}
              </span>
              <span className="block truncate text-sm font-medium">
                {fmtDate(nextStay.checkInDate)} – {fmtDate(nextStay.checkOutDate)}
                {nextStay.roomTypes.length > 0 && <> · {nextStay.roomTypes.join(", ")}</>}
              </span>
            </span>
            <ChevronLeft className="h-4 w-4 shrink-0 rotate-180 text-muted-foreground" />
          </button>
        )}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as ProfileTab)}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="stays">Stays</TabsTrigger>
          <TabsTrigger value="finance">Finance</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        {/* ---------------- OVERVIEW ---------------- */}
        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardContent className="divide-y divide-border">
              <Section
                id="personal-info"
                title={isB2B ? "Company details" : "Personal details"}
                action={missingPersonal ? <AddLink href={editAt("personal-info")}>Add details</AddLink> : undefined}
              >
                {isB2B ? (
                  <Fields entries={[
                    ["Company / agency", profile.companyName],
                    ["Contact", [profile.firstName, profile.lastName].filter(Boolean).join(" ")],
                    ["Language", profile.preferredLanguage],
                    ["Created at", profile.originProperty?.name],
                  ]} />
                ) : (
                  <Fields entries={[
                    ["Title", label("TITLE", profile.title)],
                    ["First name", profile.firstName],
                    ["Middle name", profile.middleName],
                    ["Last name", profile.lastName],
                    ["Gender", label("GENDER", profile.gender)],
                    ["Birthdate", fmtDate(profile.dateOfBirth)],
                    ["Nationality", nationality],
                    ["Language", profile.preferredLanguage],
                    ["Anniversary", fmtDate(profile.anniversaryDate)],
                    ["Membership no.", profile.membershipNumber],
                    ["Created at", profile.originProperty?.name],
                  ]} />
                )}
              </Section>

              <Section
                id="communications"
                title="Contact"
                hint="Email, mobile and social contact methods — the starred one is primary."
                action={communications.length > 0 ? <AddLink href={editAt("communications")}>Add</AddLink> : undefined}
                toggle={communications.length > 0 ? phoneToggle("communications", "Contact") : undefined}
                bodyClassName={communications.length > 0 ? foldClass("communications") : undefined}
              >
                {communications.length === 0 ? (
                  <EmptyState size="inline" title="No phone or email on file." action={<AddLink href={editAt("communications")}>Add contact</AddLink>} />
                ) : (
                  <ul className="grid gap-x-6 gap-y-2 md:grid-cols-2">
                    {communications.map((c) => (
                      <li key={c.id} className="flex min-w-0 items-center gap-2 text-sm">
                        <span className="w-14 shrink-0 text-xs text-muted-foreground">{COMM_TYPE_LABELS[c.type] ?? c.type}</span>
                        {c.type === "EMAIL" || c.type === "MOBILE" ? (
                          <ContactLink type={c.type === "EMAIL" ? "email" : "phone"} value={c.value} className="min-w-0 font-medium" />
                        ) : (
                          <span className="min-w-0 truncate font-medium">{c.value}</span>
                        )}
                        {c.isPrimary && <Star className="h-3.5 w-3.5 shrink-0 fill-current text-warning" aria-label="Primary" />}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section
                id="address"
                title="Address"
                hint="Home, business or billing addresses — the starred one is primary."
                action={addresses.length > 0 ? <AddLink href={editAt("address")}>Add</AddLink> : undefined}
                toggle={addresses.length > 0 ? phoneToggle("address", "Address") : undefined}
                bodyClassName={addresses.length > 0 ? foldClass("address") : undefined}
              >
                {addresses.length === 0 ? (
                  <EmptyState size="inline" title="No address on file." action={<AddLink href={editAt("address")}>Add address</AddLink>} />
                ) : (
                  <ul className="grid gap-x-6 gap-y-3 md:grid-cols-2">
                    {addresses.map((a) => (
                      <li key={a.id} className="min-w-0 text-sm">
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {ADDRESS_TYPE_LABELS[a.type] ?? a.type}
                          {a.isPrimary && <Star className="h-3.5 w-3.5 fill-current text-warning" aria-label="Primary" />}
                        </p>
                        {a.fullAddress && <p className="font-medium">{a.fullAddress}</p>}
                        {[a.city, a.stateProvince, a.postalCode, a.country].some(Boolean) && (
                          <p className="flex items-center gap-1.5 text-muted-foreground">
                            {a.country && <CountryFlag value={a.country} />}
                            {[a.city, a.stateProvince, a.postalCode, country(a.country)].filter(Boolean).join(", ")}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {/* Preferences & dietary — the Edit form keeps them on individuals only. */}
              {isIndividual && (
                <Section
                  id="crm"
                  title="Preferences"
                  action={dietary.length + preferences.length > 0 ? <AddLink href={editAt("crm")}>Change</AddLink> : undefined}
                >
                  {dietary.length + preferences.length === 0 ? (
                    <EmptyState size="inline" title="No preferences or dietary needs." action={<AddLink href={editAt("crm")}>Add</AddLink>} />
                  ) : (
                    <div className="space-y-2">
                      {dietary.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="w-20 shrink-0 text-xs text-muted-foreground">Dietary</span>
                          {dietary.map((d: any) => <Badge key={d.id} variant="outline">{label("DIETARY_REQ", d.value)}</Badge>)}
                        </div>
                      )}
                      {preferences.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="w-20 shrink-0 text-xs text-muted-foreground">Preferences</span>
                          {preferences.map((p: any) => <Badge key={p.id} variant="outline">{label("PREFERENCE", p.value)}</Badge>)}
                        </div>
                      )}
                    </div>
                  )}
                </Section>
              )}

              <Section
                id="notes"
                title="Notes"
                hint="Feedback, complaints and other notable things about this profile."
                action={notes.length > 0 ? <AddLink href={editAt("notes")}>Add note</AddLink> : undefined}
              >
                {notes.length === 0 ? (
                  <EmptyState size="inline" title="No notes yet." action={<AddLink href={editAt("notes")}>Add note</AddLink>} />
                ) : (
                  <ul className="space-y-3">
                    {notes.map((n) => (
                      <li key={n.id} className="border-l-2 border-border pl-3 text-sm">
                        <p className="whitespace-pre-wrap">{n.noteText}</p>
                        <p className="text-xs text-muted-foreground">
                          {n.authorName ?? "Unknown"} · {new Date(n.createdAt).toLocaleString()}{n.isPinned && " · Pinned"}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- STAYS ---------------- */}
        <TabsContent value="stays" className="mt-4">
          <Card>
            <CardContent className="divide-y divide-border">
              {historyLoading ? (
                <InlineLoading lines={4} />
              ) : (
                <>
                  <section className="py-5 first:pt-0">
                    <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><CalendarDays className="h-4 w-4" /> Upcoming and in house</h2>
                    {(!stayHistory?.future || stayHistory.future.length === 0) ? (
                      <EmptyState size="inline" title="No upcoming or in-house stays." />
                    ) : (
                      <div className="flex flex-col gap-2">{stayHistory.future.map((r) => renderStayRow(r, false))}</div>
                    )}
                  </section>
                  <section className="py-5 last:pb-0">
                    <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><HistoryIcon className="h-4 w-4" /> Past stays</h2>
                    {(!stayHistory?.history || stayHistory.history.length === 0) ? (
                      <EmptyState size="inline" title="No past stays on record." />
                    ) : (
                      <div className="flex flex-col gap-2">{stayHistory.history.map((r) => renderStayRow(r, true))}</div>
                    )}
                  </section>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- FINANCE ---------------- */}
        <TabsContent value="finance" className="mt-4">
          <Card>
            <CardContent className="divide-y divide-border">
              <Section
                id="billing-finance"
                title="Billing"
                action={hasBilling ? <AddLink href={editAt("billing-finance")}>Change</AddLink> : undefined}
              >
                {hasBilling ? (
                  <Fields entries={billingEntries} />
                ) : (
                  <EmptyState size="inline" title="No billing details." action={<AddLink href={editAt("billing-finance")}>Add</AddLink>} />
                )}
              </Section>

              {isB2B && (
                <Section
                  id="negotiated-rates"
                  title="Negotiated rates"
                  hint="The negotiated rate plans this account can book with — only on bookings made through this profile."
                  action={rateLinks.length > 0 ? <AddLink href={editAt("negotiated-rates")}>Change</AddLink> : undefined}
                >
                  {!negotiatedRates ? (
                    <InlineLoading lines={1} />
                  ) : rateLinks.length === 0 ? (
                    <EmptyState size="inline" title="No negotiated rate plans linked." action={<AddLink href={editAt("negotiated-rates")}>Link rate plans</AddLink>} />
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {rateLinks.map(({ link, rp }) => (
                        <Badge key={rp!.id} variant="outline">
                          {rp!.name} ({rp!.code}) · {rp!.propertyName}
                          {link.commissionRate != null && ` · ${link.commissionRate}% commission`}
                        </Badge>
                      ))}
                    </div>
                  )}
                </Section>
              )}

              <Section
                id="marketing-compliance"
                title="Marketing and compliance"
                hint="Mail list, Green Tax exemption and incognito. Only the ones switched on are listed."
                action={<AddLink href={editAt("marketing-compliance")}>Change</AddLink>}
              >
                {flags.length === 0 && !profile.photoUrl ? (
                  <EmptyState size="inline" title="None switched on." />
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {flags.map((f) => <Badge key={f} variant="outline">{f}</Badge>)}
                    {profile.photoUrl && (
                      <a href={profile.photoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-info hover:underline">
                        Photo / logo <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                )}
              </Section>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- DOCUMENTS ---------------- */}
        <TabsContent value="documents" className="mt-4">
          <Card>
            <CardContent className="divide-y divide-border">
              {isIndividual && (
                <Section
                  id="identification"
                  title="Identification"
                  hint="Passport or national ID documents — the starred one is primary."
                  action={documents.length > 0 ? <AddLink href={editAt("identification")}>Add ID</AddLink> : undefined}
                >
                  {documents.length === 0 ? (
                    <EmptyState size="inline" title="No ID on file." action={<AddLink href={editAt("identification")}>Add ID</AddLink>} />
                  ) : (
                    <ul className="space-y-2">
                      {documents.map((d) => (
                        <li key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                          <span className="w-24 shrink-0 text-xs text-muted-foreground">{label("ID_TYPE", d.documentType)}</span>
                          <span className="font-medium">{d.documentNumber}</span>
                          {d.issuingCountry && (
                            <span className="inline-flex items-center gap-1 text-muted-foreground">
                              · <CountryFlag value={d.issuingCountry} /> {country(d.issuingCountry)}
                            </span>
                          )}
                          {d.expiryDate && <span className="text-muted-foreground">· expires {fmtDate(d.expiryDate)}</span>}
                          {d.isWorkPermit && <Badge variant="outline">Work permit</Badge>}
                          {d.isPrimary && <Star className="h-3.5 w-3.5 fill-current text-warning" aria-label="Primary" />}
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              )}

              <Section
                id="attachments"
                title="Attachments"
                hint="Linked files (label and URL) — passport scans, signed contracts and so on."
                action={attachments.length > 0 ? <AddLink href={editAt("attachments")}>Add</AddLink> : undefined}
              >
                {attachments.length === 0 ? (
                  <EmptyState size="inline" title="No attachments." action={<AddLink href={editAt("attachments")}>Add attachment</AddLink>} />
                ) : (
                  <ul className="space-y-1.5">
                    {attachments.map((a) => (
                      <li key={a.id}>
                        <a href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-info hover:underline">
                          {a.label} <ExternalLink className="h-3 w-3" />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
