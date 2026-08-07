"use client"

import { useEffect, useState, use } from "react"
import { useRouter, useParams } from "next/navigation"
import { useSmartBack } from "@/lib/use-smart-back"
import { ArrowLeft, Pencil, ExternalLink, Star, CalendarDays, History as HistoryIcon, UserX } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { primaryEmail, primaryMobile } from "@/lib/profile-communications"
import { useProperty } from "@/components/providers/property-provider"
import { InfoHint } from "@/components/ui/info-hint"
import { CountryFlag, CountryLabel } from "@/components/ui/country-flag"
import { useSystemCodeLabels } from "@/hooks/use-system-code-labels"

const PROFILE_TYPE_LABELS: Record<string, string> = {
  GUEST: "Guest", COMPANY: "Company", TRAVEL_AGENT: "Travel Agent", STAFF: "Staff",
}
const classColors: Record<string, string> = {
  VIP: "bg-foreground text-background border-transparent",
  REGULAR: "bg-muted text-foreground border-border",
  BLACKLISTED: "bg-destructive-muted text-destructive border-destructive/30",
}

type StayRecord = {
  id: string
  confirmationNo: string
  status: string
  propertyName: string
  checkInDate: string
  checkOutDate: string
  roomTypes: string[]
  revenueTotal: number
  revenueBreakdown: { code: string; description: string; amount: number }[]
}

// Label-above-value field, mirroring the FormLabel/FormControl rhythm of the Edit
// form's inputs so the two screens read the same way at a glance.
function Field({ label, value, className }: { label: string; value?: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <p className="text-sm font-medium text-foreground mt-1 min-h-5">{value || value === 0 ? value : "—"}</p>
    </div>
  )
}

export default function ProfileDetailPage({ params }: { params: Promise<{ upid: string }> }) {
  const { upid } = use(params)
  const router = useRouter()
  const { slug } = useParams<{ slug: string }>()
  const goBack = useSmartBack(`/e/${slug}/dashboard/profiles`)
  const { currentProperty } = useProperty()
  const { label } = useSystemCodeLabels()

  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [stayHistory, setStayHistory] = useState<{ future: StayRecord[]; history: StayRecord[]; visitsToProperty: number | null } | null>(null)
  const [historyLoading, setHistoryLoading] = useState(true)
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
      <div className="max-w-7xl mx-auto space-y-4 p-4 md:p-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }
  if (!profile) {
    return <EmptyState icon={UserX} title="Profile not found" className="py-24" />
  }

  const isB2B = profile.profileType === "COMPANY" || profile.profileType === "TRAVEL_AGENT"
  const isIndividual = !isB2B
  const displayName = isB2B
    ? profile.companyName || `${profile.firstName} ${profile.lastName ?? ""}`.trim()
    : [profile.title, profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" ")

  const dietary = (profile.preferences ?? []).filter((p: any) => p.category === "DIETARY")
  const preferences = (profile.preferences ?? []).filter((p: any) => p.category === "PREFERENCE")

  const renderStayRow = (r: StayRecord, showBreakdown: boolean) => (
    <div key={r.id} className="rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-sm">{r.confirmationNo} — {r.propertyName}</p>
          <p className="text-xs text-muted-foreground">
            {new Date(r.checkInDate).toLocaleDateString()} – {new Date(r.checkOutDate).toLocaleDateString()}
            {r.roomTypes.length > 0 && <> · {r.roomTypes.join(", ")}</>}
          </p>
        </div>
        <div className="text-right shrink-0">
          <Badge variant="outline">{r.status}</Badge>
          <p className="text-sm font-semibold mt-1">${r.revenueTotal.toFixed(2)}</p>
        </div>
      </div>
      {showBreakdown && r.revenueBreakdown.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border text-xs text-muted-foreground space-y-0.5">
          {r.revenueBreakdown.map((b) => (
            <div key={b.code} className="flex justify-between">
              <span>{b.code} — {b.description}</span>
              <span>${b.amount.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div className="max-w-7xl w-full mx-auto p-4 flex flex-col gap-4 pb-12">
      {/* Header — mirrors the Edit form's sticky header */}
      <div className="sticky top-0 z-10 bg-muted/80 backdrop-blur-md pb-4 pt-2 border-b border-border flex justify-between items-center">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={goBack} title="Back" aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold tracking-tight">{displayName || "Unnamed profile"}</h2>
              <Badge variant="outline">{PROFILE_TYPE_LABELS[profile.profileType] ?? profile.profileType}</Badge>
              <span className={`px-2 py-1 rounded-none text-[10px] uppercase font-bold border ${classColors[profile.classification] || "bg-muted text-foreground"}`}>
                {label("CLASSIFICATION", profile.classification)}
              </span>
              {profile.vipLevel && (
                <span className="px-2 py-1 rounded-none text-[10px] uppercase font-bold border bg-warning-muted text-warning border-warning/30 inline-flex items-center gap-1">
                  <Star className="h-3 w-3 fill-none" /> {label("VIP_LEVEL", profile.vipLevel)}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {primaryEmail(profile.communications) || "No email"} {primaryMobile(profile.communications) ? `· ${primaryMobile(profile.communications)}` : ""}
            </p>
          </div>
        </div>
        <Button onClick={() => router.push(`/e/${slug}/dashboard/profiles/${upid}/edit`)}>
          <Pencil className="mr-2 h-4 w-4" /> Edit
        </Button>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="stay-history">Stay History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8 items-start">

            {/* ---------------- LEFT COLUMN (MAIN) ---------------- */}
            <div className="lg:col-span-2 flex flex-col gap-6">

              {/* Section: Personal Information / Company Details */}
              <Card id="personal-info">
                <CardHeader>
                  <CardTitle>{isB2B ? "Company Details" : "Personal Information"}</CardTitle>
                  <CardDescription>
                    {isB2B ? "Primary identification details for this entity." : "Primary identification details for this profile."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {isB2B ? (
                    <Field label="Company / Agency Name" value={profile.companyName} />
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                      <Field className="md:col-span-1" label="Title" value={label("TITLE", profile.title)} />
                      <Field className="md:col-span-2" label="First Name" value={profile.firstName} />
                      <Field className="md:col-span-1" label="Middle" value={profile.middleName} />
                      <Field className="md:col-span-2" label="Last Name" value={profile.lastName} />
                      <Field className="md:col-span-1" label="Gender" value={label("GENDER", profile.gender)} />
                      <Field className="md:col-span-1" label="Language" value={profile.preferredLanguage} />
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Section: Communications */}
              <Card id="communications">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
            Communications
            <InfoHint label="Communications">Email, mobile, and social contact methods — one may be marked primary.</InfoHint>
          </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(profile.communications ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">None on file.</p>
                  ) : profile.communications.map((c: any) => (
                    <div key={c.id} className="flex items-center gap-2 text-sm rounded-md border px-3 py-2">
                      <Badge variant="outline" className="text-xs">{c.type}</Badge>
                      <span className="font-medium">{c.value}</span>
                      {c.isPrimary && <Star className="h-3.5 w-3.5 fill-current text-warning ml-auto" />}
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Section: Address */}
              <Card id="address">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
            Address
            <InfoHint label="Address">Home, business, or billing addresses — one may be marked primary.</InfoHint>
          </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(profile.addresses ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">None on file.</p>
                  ) : profile.addresses.map((a: any) => (
                    <div key={a.id} className="rounded-md border px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{a.type}</Badge>
                        {a.isPrimary && <Star className="h-3.5 w-3.5 fill-current text-warning ml-auto" />}
                      </div>
                      <p className="font-medium mt-1">{a.fullAddress || "—"}</p>
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {a.country && <CountryFlag value={a.country} />}
                        {[a.city, a.stateProvince, a.postalCode, label("NATIONALITY", a.country)].filter(Boolean).join(", ") || "—"}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Section: Identification (Guest/Staff only) — Birthdate/Nationality live
                  here too, matching the Edit form's card boundary exactly. */}
              {isIndividual && (
                <Card id="identification">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
            Identification
            <InfoHint label="Identification">Passport or National ID documents — one may be marked primary.</InfoHint>
          </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-2">
                      {(profile.documents ?? []).length === 0 ? (
                        <p className="text-sm text-muted-foreground italic">No identification documents on file.</p>
                      ) : profile.documents.map((d: any) => (
                        <div key={d.id} className="flex items-center gap-2 text-sm rounded-md border px-3 py-2">
                          <Badge variant="outline" className="text-xs">{label("ID_TYPE", d.documentType)}</Badge>
                          <span className="font-medium">{d.documentNumber}</span>
                          {d.issuingCountry && (
                            <span className="inline-flex items-center gap-1 text-muted-foreground">
                              · <CountryFlag value={d.issuingCountry} /> {label("NATIONALITY", d.issuingCountry)}
                            </span>
                          )}
                          {d.isPrimary && <Star className="h-3.5 w-3.5 fill-current text-warning ml-auto" />}
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-border">
                      <Field label="Birthdate" value={profile.dateOfBirth ? new Date(profile.dateOfBirth).toLocaleDateString() : undefined} />
                      <Field
                        label="Nationality"
                        value={profile.nationality ? <CountryLabel value={profile.nationality} name={label("NATIONALITY", profile.nationality)} /> : undefined}
                      />
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Section: CRM (Guest/Staff only, matching the Edit form) */}
              {isIndividual && (
                <Card id="crm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
            CRM
            <InfoHint label="CRM">Stay history summary, guest preferences, and VIP status.</InfoHint>
          </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Field label="Anniversary" value={profile.anniversaryDate ? new Date(profile.anniversaryDate).toLocaleDateString() : undefined} />
                      <Field label="VIP Level" value={label("VIP_LEVEL", profile.vipLevel)} />
                    </div>

                    <div className="grid grid-cols-2 gap-4 rounded-md border p-3 bg-muted/30">
                      <div>
                        <Label className="text-xs text-muted-foreground">Visits to This Property</Label>
                        <p className="text-lg font-semibold">{stayHistory?.visitsToProperty ?? "—"}</p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Visits to Property Chain (Enterprise)</Label>
                        <p className="text-lg font-semibold">{profile.totalStays ?? 0}</p>
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <Label>Dietary Requirements</Label>
                      {dietary.length === 0 ? (
                        <p className="text-xs text-muted-foreground">None set.</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {dietary.map((d: any) => <Badge key={d.id} variant="outline">{label("DIETARY_REQ", d.value)}</Badge>)}
                        </div>
                      )}
                    </div>

                    <div className="grid gap-2">
                      <Label>Preferences</Label>
                      {preferences.length === 0 ? (
                        <p className="text-xs text-muted-foreground">None set.</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {preferences.map((p: any) => <Badge key={p.id} variant="outline">{label("PREFERENCE", p.value)}</Badge>)}
                        </div>
                      )}
                    </div>

                    <Field label="Membership Number" value={profile.membershipNumber} />
                  </CardContent>
                </Card>
              )}

              {/* Section: Negotiated Rates (Company/Travel Agent only) */}
              {isB2B && (
                <Card id="negotiated-rates">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
            Negotiated Rates
            <InfoHint label="Negotiated Rates">Which negotiated Rate Plans this account can book with — restricted to bookings made through this profile.</InfoHint>
          </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {!negotiatedRates || negotiatedRates.links.length === 0 ? (
                      <p className="text-sm text-muted-foreground italic">No negotiated rate plans linked.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {negotiatedRates.links.map((link) => {
                          const rp = negotiatedRates.available.find((r) => r.id === link.ratePlanId)
                          if (!rp) return null
                          return (
                            <Badge key={rp.id} variant="outline">
                              {rp.name} ({rp.code}) · {rp.propertyName}
                              {link.commissionRate != null && ` · ${link.commissionRate}% commission`}
                            </Badge>
                          )
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Section: Attachments */}
              <Card id="attachments">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
            Attachments
            <InfoHint label="Attachments">Linked files (label + URL) — passport scans, signed contracts, etc.</InfoHint>
          </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {(profile.attachments ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">No attachments linked yet.</p>
                  ) : profile.attachments.map((a: any) => (
                    <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm text-info hover:underline">
                      {a.label} <ExternalLink className="h-3 w-3" />
                    </a>
                  ))}
                </CardContent>
              </Card>

              {/* Section: Notes */}
              <Card id="notes">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
            Notes
            <InfoHint label="Notes">Feedback, complaints, and other notable things about this profile.</InfoHint>
          </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(profile.notes ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">No notes yet.</p>
                  ) : profile.notes.map((n: any) => (
                    <div key={n.id} className="text-sm border-l-2 pl-2 border-border">
                      <p className="whitespace-pre-wrap">{n.noteText}</p>
                      <p className="text-xs text-muted-foreground">{n.authorName ?? "Unknown"} · {new Date(n.createdAt).toLocaleString()} {n.isPinned && "· Pinned"}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>

            </div>

            {/* ---------------- RIGHT COLUMN (SIDEBAR) ---------------- */}
            <div className="flex flex-col gap-6">

              {/* Section: Profile Settings */}
              <Card id="profile-status" className="bg-muted/50">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg">Profile Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Field label="Profile Type" value={PROFILE_TYPE_LABELS[profile.profileType] ?? profile.profileType} />
                  <Field label="Classification" value={label("CLASSIFICATION", profile.classification)} />
                  {profile.originProperty && (
                    <p className="text-xs text-muted-foreground pt-2 border-t border-border">
                      Originated at <span className="font-medium text-foreground">{profile.originProperty.name}</span>
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Section: Finance & Billing (AR) */}
              <Card id="billing-finance">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg">Finance & Billing</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Field label="AR Number (Accounts Rec.)" value={profile.arNumber} />
                  <Field label="Credit Limit" value={profile.creditLimit != null ? `$${profile.creditLimit.toFixed(2)}` : undefined} />
                  {isB2B && (
                    <>
                      <Field label="Credit Account (Debtors)" value={profile.isCreditAccount ? "Active" : "No"} />
                      <div className="pt-2 border-t border-border">
                        <Field label="IATA Number" value={profile.iataNumber} />
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Section: Marketing & Compliance */}
              <Card id="marketing-compliance">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg">Marketing & Compliance</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {profile.photoUrl && (
                    <Field label="Photo / Logo URL" value={
                      <a href={profile.photoUrl} target="_blank" rel="noopener noreferrer" className="text-info hover:underline inline-flex items-center gap-1">
                        View <ExternalLink className="h-3 w-3" />
                      </a>
                    } />
                  )}
                  <div className="flex flex-col gap-3 pt-2 border-t border-border">
                    <Field label="Mail List (Marketing)" value={profile.marketingOptIn ? "Yes" : "No"} />
                    <Field label="Green Tax Exempt" value={profile.greenTaxExempt ? "Yes" : "No"} />
                    <Field label="Incognito Mode" value={profile.isIncognito ? "Yes" : "No"} />
                  </div>
                </CardContent>
              </Card>

            </div>
          </div>
        </TabsContent>

        <TabsContent value="stay-history" className="mt-4 space-y-6">
          {historyLoading ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : (
            <>
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-2"><CalendarDays className="h-4 w-4" /> Future Stays</h3>
                {(!stayHistory?.future || stayHistory.future.length === 0) ? (
                  <p className="text-sm text-muted-foreground italic">No upcoming or in-house stays.</p>
                ) : (
                  <div className="flex flex-col gap-2">{stayHistory.future.map((r) => renderStayRow(r, false))}</div>
                )}
              </div>
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-2"><HistoryIcon className="h-4 w-4" /> History</h3>
                {(!stayHistory?.history || stayHistory.history.length === 0) ? (
                  <p className="text-sm text-muted-foreground italic">No past stays on record.</p>
                ) : (
                  <div className="flex flex-col gap-2">{stayHistory.history.map((r) => renderStayRow(r, true))}</div>
                )}
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
