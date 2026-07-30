"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useDeviceTier } from "@/hooks/use-mobile"
import {
  Boxes,
  Wallet,
  Contact,
  FileBarChart,
  Settings2,
  CalendarDays,
  Users,
  ShieldCheck,
  Hash,
  ArrowLeft,
  ChevronRight,
  Store,
  TrendingUp,
  Compass,
  Sparkles,
  Receipt,
} from "@/components/icons"
import { ControlsCard } from "@/components/controls/controls-card"
import { GeneralSettingsManager } from "@/components/settings/general-settings-manager"
import { PropertiesManager } from "@/components/settings/properties-manager"
import { FacilitiesManager } from "@/components/settings/facilities-manager"
import { FacilityAmenitiesManager } from "@/components/settings/facility-amenities-manager"
import { OutletsManager } from "@/components/controls/outlets-manager"
import { TaxManager } from "@/components/controls/tax-manager"
import { ChargeCodesManager } from "@/components/controls/charge-codes-manager"
import { ChargeGroupsManager } from "@/components/controls/charge-groups-manager"
import { PaymentMethodsManager } from "@/components/settings/payment-methods-manager"
import { PostingDefaultsManager } from "@/components/controls/posting-defaults-manager"
import { SettlementDefaultsManager } from "@/components/controls/settlement-defaults-manager"
import { FeeRulesManager } from "@/components/controls/fee-rules-manager"
import { DropdownsManager, PROFILE_LOV_CATEGORIES, OPERATIONS_LOV_CATEGORIES, ROOM_FEATURE_LOV_CATEGORIES, RESERVATION_LOV_CATEGORIES } from "@/components/settings/dropdowns-manager"
import { UsersRolesManager } from "@/components/controls/users-roles-manager"
import { SupportAccessManager } from "@/components/controls/support-access-manager"
import { PropertyProfileManager } from "@/components/controls/property-profile-manager"
import { PropertyBannerColorManager } from "@/components/controls/property-banner-color-manager"
import { PropertyStationeryFontManager } from "@/components/controls/property-stationery-font-manager"
import { SmtpSftpManager } from "@/components/controls/smtp-sftp-manager"
import { SequenceManager } from "@/components/controls/sequence-manager"
import { MealPlansManager } from "@/components/controls/meal-plans-manager"
import { AllocationCalculationManager } from "@/components/controls/allocation-calculation-manager"
import { ExcursionsManager } from "@/components/controls/excursions-manager"
import { ModuleOutletPicker } from "@/components/controls/module-outlet-picker"
import { SpaCatalogManager } from "@/components/controls/spa-manager"
import { SpaTherapistsManager } from "@/components/controls/spa-therapists-manager"
import { SpaRoomsManager } from "@/components/controls/spa-rooms-manager"
import { SpaSettingsForm } from "@/components/controls/spa-settings-form"

// Vertical sidebar-nav trigger (tablet/desktop only — see ControlsDashboard below).
// Base UI's Tabs primitive marks the active tab with a bare `data-active` attribute,
// not shadcn's Radix-era `data-state="active"`. variant="line" on the parent
// <TabsList> gives a thin right-edge indicator instead of a boxed pill (see
// tabs.tsx's group-data-vertical rules) — kept deliberately understated so this
// primary nav reads differently from the "segmented control" pill tabs used inside
// individual sections (Tax, Property Architecture, dropdown categories).
const SIDEBAR_TRIGGER_CLASS =
  "data-active:text-primary dark:data-active:text-primary rounded-md px-3 py-2 font-medium text-muted-foreground"

// Config-array-driven sections, mirroring app-sidebar-nav.tsx's `NAV_GROUPS` pattern —
// add a new Controls section here rather than hand-adding another TabsTrigger/
// TabsContent pair.
//
// Order follows how a property is actually set up, from the ground up: the property
// itself (General) -> what you sell (Inventory) -> how it's booked (Reservations,
// Client Relations) -> what it's worth (Revenue, Finance) -> ancillary revenue
// (Outlets, Excursions) -> output and numbering (Reports, Sequences) -> who may touch
// any of it (Users & Roles, Support Access). The first section is also the landing
// tab, so it deliberately opens on something with real content.
//
// Licensing has moved to the dedicated Osta console (/osta/licensing) — Osta users
// never reach this tenant page at all now (see the redirect in
// src/app/e/[slug]/dashboard/layout.tsx), so there's no longer an Osta-only section
// to gate here.
type ControlsSection = {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  render: () => React.ReactNode
}

function buildSections(actorScope: "ENTERPRISE" | "PROPERTY", actorPropertyId: string | null): ControlsSection[] {
  return [
    {
      key: "general",
      label: "General",
      icon: Settings2,
      render: () => (
        <div className="space-y-6">
          <ControlsCard title="Property Information" description="This property's own profile. Which enterprise it belongs to cannot be changed here.">
            <PropertyProfileManager />
          </ControlsCard>
          <ControlsCard title="Appearance" description="Choose this property's own banner accent and stationery font — inherited across the app and every printed document.">
            <PropertyBannerColorManager />
            <PropertyStationeryFontManager />
          </ControlsCard>
        </div>
      ),
    },
    {
      key: "inventory",
      label: "Inventory",
      icon: Boxes,
      render: () => (
        <div className="space-y-6">
          <PropertiesManager
            title="Properties"
            description="Manage all properties, buildings, and facilities across your enterprise."
          />
          <ControlsCard title="Property Architecture" description="Manage your global buildings, floors, and room types.">
            <FacilitiesManager />
          </ControlsCard>
          <ControlsCard title="Housekeeping Dropdowns" description="Lists used by Housekeeping and Maintenance operations.">
            <DropdownsManager categories={OPERATIONS_LOV_CATEGORIES} />
          </ControlsCard>
          <ControlsCard title="Room Features" description="Bed Type, View, and Amenity options offered when configuring a Room Type.">
            <DropdownsManager categories={ROOM_FEATURE_LOV_CATEGORIES} />
          </ControlsCard>
        </div>
      ),
    },
    {
      key: "reservations",
      label: "Reservations",
      icon: CalendarDays,
      render: () => (
        <div className="space-y-6">
          <ControlsCard title="Booking Codes & Defaults" description="Confirmation-number formatting used by normal and block reservations.">
            <GeneralSettingsManager />
          </ControlsCard>
          <ControlsCard title="Reservation Dropdown Lists" description="Special Requests and other reservation-level lists.">
            <DropdownsManager categories={RESERVATION_LOV_CATEGORIES} />
          </ControlsCard>
        </div>
      ),
    },
    {
      key: "client-relations",
      label: "Client Relations",
      icon: Contact,
      render: () => (
        <ControlsCard title="Profile Dropdown Lists" description="Manage dynamic dropdown options used on guest/company/travel-agent profiles — genders, titles, nationalities, dietary requirements, and more.">
          <DropdownsManager categories={PROFILE_LOV_CATEGORIES} />
        </ControlsCard>
      ),
    },
    {
      key: "revenue",
      label: "Revenue",
      icon: TrendingUp,
      render: () => (
        <div className="space-y-6">
          <ControlsCard title="Allocation Calculation" description="Which side drives automatic Allocation attachment on a reservation — Meal Plan or Rate Plan. Per-property; changing this only affects reservations created or edited afterward, not existing bookings.">
            <AllocationCalculationManager />
          </ControlsCard>
          <MealPlansManager
            title="Meal Plans"
            description="Meal plan codes offered on a reservation (Bed & Breakfast, Half Board, etc.). Link each plan to its Allocations (Revenue > Allocations, e.g. BB → BF) for per-person nightly pricing; a Derived Rate Plan remains an option for flat room-rate adjustments."
          />
        </div>
      ),
    },
    {
      key: "finance",
      label: "Finance",
      icon: Wallet,
      render: () => (
        <div className="space-y-6">
          <ControlsCard title="Tax" description="Configure Maldives Tax (Green Tax, GST, Service Charge) and any Custom Tax profiles. Which charge code each levy posts against is set under Cashiering > Posting Defaults.">
            <TaxManager />
          </ControlsCard>
          <PaymentMethodsManager
            title="Payment Methods"
            description="Configure accepted payment methods like Cash, Credit Cards, Bank Transfers, or City Ledger."
          />
          <ControlsCard title="Settlement Defaults" description="Which City Ledger payment method settles a debtor folio at checkout.">
            <SettlementDefaultsManager />
          </ControlsCard>
          <ControlsCard title="Deposit & Fee Rules" description="Per-property Deposit, Cancellation, and No-Show fee rules. The amount can be flat, a percentage of the stay, the first night, or the full stay. Cancellation fees are prompted on cancel; no-show fees apply at Night Audit — both collected via the Deposit module, never billing.">
            <FeeRulesManager />
          </ControlsCard>
        </div>
      ),
    },
    // Everything charge-code: the Group -> Subgroup -> Code hierarchy that classifies
    // revenue, the generates cascade that posts derived levies, and the role -> code
    // pointers billing resolves through. Tax rates and Payment Methods stay in Finance
    // — a charge code only ever *references* those.
    {
      key: "cashiering",
      label: "Cashiering",
      icon: Receipt,
      render: () => (
        <div className="space-y-6">
          <ControlsCard title="Charge Groups & Subgroups" description="The two levels above a charge code. A Group carries the reporting bucket every revenue, tax and EOD report rolls up into; a Subgroup splits it further for detail. The canonical set is system-managed — rename freely, and add your own alongside.">
            <ChargeGroupsManager />
          </ControlsCard>
          <ControlsCard title="Charge Codes" description="The transaction codes everything posts against — Night Audit, POS, folios and billing. Each is classified by Subgroup (that's what reports group by), carries a posting type, and can automatically generate derived charges such as Green Tax.">
            <ChargeCodesManager />
          </ControlsCard>
          <ControlsCard title="Posting Defaults" description="Which charge code plays each system role: the nightly room charge, the Green Tax levy, and the Travel Agent commission credit. Billing resolves these by role, never by a hardcoded code name.">
            <PostingDefaultsManager />
          </ControlsCard>
        </div>
      ),
    },
    {
      key: "outlets",
      label: "Outlets",
      icon: Store,
      render: () => (
        <div className="space-y-6">
          <ControlsCard title="Outlets" description="Spa, restaurant, and other revenue-generating points of sale — each curates its own set of charge codes and can override tax handling.">
            <OutletsManager />
          </ControlsCard>
          <ControlsCard title="Amenities" description="Facility amenities shown on a property's guest-facing profile (Pool, Gym, Spa, etc).">
            <FacilityAmenitiesManager />
          </ControlsCard>
        </div>
      ),
    },
    {
      key: "excursions",
      label: "Excursions",
      icon: Compass,
      render: () => (
        <div className="space-y-6">
          <ControlsCard title="Excursion Outlet" description="One outlet, shared across every property in the Hub — all excursion sales post through it and follow its Tax Rule. Posting is blocked until one is linked.">
            <ModuleOutletPicker module="EXCURSIONS" />
          </ControlsCard>
          <ExcursionsManager
            title="Excursions"
            description="Bookable activities sold to guests from Front Office — catalog, pricing, and recurring schedules. Requires the Excursions add-on, enabled per property by Osta."
          />
        </div>
      ),
    },
    {
      key: "spa",
      label: "Spa",
      icon: Sparkles,
      render: () => (
        <div className="space-y-6">
          <ControlsCard title="Spa Outlet" description="One outlet, shared across every property in the Hub — all spa charges post through it and follow its Tax Rule. Posting is blocked until one is linked.">
            <ModuleOutletPicker module="SPA" />
          </ControlsCard>
          <ControlsCard title="Treatment Catalog" description="Categories, treatments, and pricing sold to guests from the Spa scheduler. Requires the Spa add-on, enabled per property by Osta.">
            <SpaCatalogManager />
          </ControlsCard>
          <ControlsCard title="Therapists" description="Schedulable therapists — treatment qualifications, weekly working hours, and day-off/leave exceptions. A PMS login is optional.">
            <SpaTherapistsManager />
          </ControlsCard>
          <ControlsCard title="Treatment Rooms" description="Rooms available for spa treatments, including couple-capable rooms and maintenance/cleaning closures.">
            <SpaRoomsManager />
          </ControlsCard>
          <ControlsCard title="Spa Settings" description="Operating hours, booking defaults, charge timing, and cancellation/no-show policy for this property (the Spa Outlet above is hub-wide).">
            <SpaSettingsForm />
          </ControlsCard>
        </div>
      ),
    },
    {
      key: "reports",
      label: "Reports",
      icon: FileBarChart,
      render: () => (
        <div className="space-y-6">
          <ControlsCard title="SMTP / SFTP" description="Outgoing email and file-transfer connection settings.">
            <SmtpSftpManager />
          </ControlsCard>
        </div>
      ),
    },
    {
      key: "sequences",
      label: "Sequences",
      icon: Hash,
      render: () => (
        <ControlsCard
          title="Sequence Manager"
          description="Track and reset the current sequence number for Registration No, Proforma Folio, Tax Invoice, and Receipt No. This manages the plain number only — not prefixes or formatting."
        >
          <SequenceManager />
        </ControlsCard>
      ),
    },
    {
      key: "users",
      label: "Users & Roles",
      icon: Users,
      render: () => (
        <UsersRolesManager actorScope={actorScope} actorPropertyId={actorPropertyId} />
      ),
    },
    {
      key: "support",
      label: "Support Access",
      icon: ShieldCheck,
      render: () => (
        <ControlsCard
          title="Support Access"
          description="Osta support staff have no implicit access to your data — they must request it here, and you decide whether to approve it."
        >
          <SupportAccessManager isInternal={false} />
        </ControlsCard>
      ),
    },
  ]
}

// Shared row for the mobile drill-down list screen — full-width tappable row with
// a chevron affordance, used for both the primary and Osta-internal section lists.
function MobileSectionRow({
  section,
  onSelect,
}: {
  section: ControlsSection
  onSelect: (key: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(section.key)}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-medium hover:bg-muted/50 active:bg-muted"
    >
      <section.icon className="w-4 h-4 shrink-0 text-muted-foreground" />
      <span className="flex-1">{section.label}</span>
      <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
    </button>
  )
}

export function ControlsDashboard({
  actorScope,
  actorPropertyId,
}: {
  actorScope: "ENTERPRISE" | "PROPERTY"
  actorPropertyId: string | null
}) {
  const sections = buildSections(actorScope, actorPropertyId)

  const tier = useDeviceTier()
  const [activeKey, setActiveKey] = useState<string | undefined>(sections[0]?.key)
  const [mobileDrilledIn, setMobileDrilledIn] = useState(false)

  const header = (
    <div>
      <h2 className="text-3xl font-bold tracking-tight">Controls</h2>
      <p className="text-muted-foreground">
        Manage your enterprise, properties, taxes, users, and integrations here.
      </p>
    </div>
  )

  const selectMobileSection = (key: string) => {
    setActiveKey(key)
    setMobileDrilledIn(true)
  }

  // Pre-hydration: render the correct layout silhouette with pure CSS (Tailwind's
  // own md: breakpoint) instead of guessing a tier in JS, so there's no flash once
  // useDeviceTier() resolves on the client.
  if (tier === undefined) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <div className="flex gap-8">
          <div className="hidden md:flex md:w-56 md:shrink-0 md:flex-col md:gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
          <div className="flex-1 space-y-4">
            <Skeleton className="h-9 w-48 md:hidden" />
            <Skeleton className="h-40 w-full" />
          </div>
        </div>
      </div>
    )
  }

  if (tier === "mobile") {
    if (!mobileDrilledIn) {
      return (
        <div className="flex flex-col gap-6">
          {header}
          <nav className="flex flex-col divide-y divide-border/50 rounded-lg bg-card overflow-hidden shadow-elevation-1 ring-1 ring-foreground/5">
            {sections.map((s) => (
              <MobileSectionRow key={s.key} section={s} onSelect={selectMobileSection} />
            ))}
          </nav>
        </div>
      )
    }

    const active = sections.find((s) => s.key === activeKey)
    return (
      <div className="flex flex-col gap-6">
        <Button variant="ghost" size="sm" onClick={() => setMobileDrilledIn(false)} className="-ml-2 w-fit">
          <ArrowLeft className="w-4 h-4 mr-1.5" /> Controls
        </Button>
        {active && (
          <div className="flex items-center gap-2">
            <active.icon className="w-5 h-5 text-muted-foreground" />
            <h2 className="text-xl font-semibold">{active.label}</h2>
          </div>
        )}
        {active?.render()}
      </div>
    )
  }

  // Tablet / desktop: vertical sidebar nav using Tabs' native vertical orientation
  // — src/components/ui/tabs.tsx is already fully wired for this (flex-column list,
  // full-width left-aligned triggers, right-edge active indicator), so this is just
  // the prop plus a width on the list.
  return (
    <div className="flex flex-col gap-6">
      {header}
      <Tabs
        orientation="vertical"
        value={activeKey}
        onValueChange={(v) => setActiveKey(v)}
        className="w-full items-start gap-8"
      >
        <TabsList variant="line" className="w-56 shrink-0 items-stretch justify-start rounded-none h-auto p-0">
          {sections.map((s) => (
            <TabsTrigger key={s.key} value={s.key} className={SIDEBAR_TRIGGER_CLASS}>
              <s.icon className="w-4 h-4 mr-2" /> {s.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {sections.map((s) => (
          <TabsContent key={s.key} value={s.key} className="m-0 min-w-0 flex-1 space-y-6">
            {s.render()}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
