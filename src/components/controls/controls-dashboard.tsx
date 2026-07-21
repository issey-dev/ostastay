"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useDeviceTier } from "@/hooks/use-mobile"
import {
  MonitorPlay,
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
} from "lucide-react"
import { ControlsCard } from "@/components/controls/controls-card"
import { GeneralSettingsManager } from "@/components/settings/general-settings-manager"
import { PropertiesManager } from "@/components/settings/properties-manager"
import { FacilitiesManager } from "@/components/settings/facilities-manager"
import { FacilityAmenitiesManager } from "@/components/settings/facility-amenities-manager"
import { OutletsManager } from "@/components/controls/outlets-manager"
import { TaxManager } from "@/components/controls/tax-manager"
import { ChargeCodesManager } from "@/components/controls/charge-codes-manager"
import { PaymentMethodsManager } from "@/components/settings/payment-methods-manager"
import { PostingDefaultsManager } from "@/components/controls/posting-defaults-manager"
import { DropdownsManager, PROFILE_LOV_CATEGORIES, OPERATIONS_LOV_CATEGORIES, ROOM_FEATURE_LOV_CATEGORIES, RESERVATION_LOV_CATEGORIES } from "@/components/settings/dropdowns-manager"
import { UsersRolesManager } from "@/components/controls/users-roles-manager"
import { SupportAccessManager } from "@/components/controls/support-access-manager"
import { PropertyProfileManager } from "@/components/controls/property-profile-manager"
import { PropertyBannerColorManager } from "@/components/controls/property-banner-color-manager"
import { SmtpSftpManager } from "@/components/controls/smtp-sftp-manager"
import { SequenceManager } from "@/components/controls/sequence-manager"
import { MealPlansManager } from "@/components/controls/meal-plans-manager"
import { AllocationCalculationManager } from "@/components/controls/allocation-calculation-manager"

// Vertical sidebar-nav trigger (tablet/desktop only — see ControlsDashboard below).
// Base UI's Tabs primitive marks the active tab with a bare `data-active` attribute,
// not shadcn's Radix-era `data-state="active"`. variant="line" on the parent
// <TabsList> gives a thin right-edge indicator instead of a boxed pill (see
// tabs.tsx's group-data-vertical rules) — kept deliberately understated so this
// primary nav reads differently from the "segmented control" pill tabs used inside
// individual sections (Tax, Property Architecture, dropdown categories).
const SIDEBAR_TRIGGER_CLASS =
  "data-active:text-primary dark:data-active:text-primary rounded-md px-3 py-2 font-medium text-muted-foreground"

// Config-array-driven sections, mirroring app-sidebar.tsx's `items` pattern — add a new
// Controls section here rather than hand-adding another TabsTrigger/TabsContent pair.
// Tabs are grouped to match the app's own operational modules (Front Desk, Inventory,
// Finance, Client Relations, Reports, General, Reservations) plus the identity/admin
// sections from Phase 1. Licensing has moved to the dedicated Osta console
// (/osta/licensing) — Osta users never reach this tenant page at all now (see the
// redirect in src/app/e/[slug]/dashboard/layout.tsx), so there's no longer an
// Osta-only section to gate here.
type ControlsSection = {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  render: () => React.ReactNode
}

function buildSections(actorScope: "ENTERPRISE" | "PROPERTY", actorPropertyId: string | null): ControlsSection[] {
  return [
    {
      key: "front-desk",
      label: "Front Desk",
      icon: MonitorPlay,
      render: () => (
        <ControlsCard title="Front Desk" description="No Front Desk-specific configuration exists yet.">
          <p className="text-sm text-muted-foreground">
            Nothing to configure here today — this tab is reserved for future front-desk-specific settings.
          </p>
        </ControlsCard>
      ),
    },
    {
      key: "inventory",
      label: "Inventory",
      icon: Boxes,
      render: () => (
        <div className="space-y-6">
          <ControlsCard title="Properties" description="Manage all properties, buildings, and facilities across your enterprise.">
            <PropertiesManager />
          </ControlsCard>
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
      key: "finance",
      label: "Finance",
      icon: Wallet,
      render: () => (
        <div className="space-y-6">
          <ControlsCard title="Tax" description="Configure Maldives Tax (Green Tax, GST, Service Charge) and any Custom Tax profiles.">
            <TaxManager />
          </ControlsCard>
          <ControlsCard title="Charge Codes" description="System-wide transaction codes, grouped by category for reporting — used by Night Audit and Cashiering.">
            <ChargeCodesManager />
          </ControlsCard>
          <ControlsCard title="Payment Methods" description="Configure accepted payment methods like Cash, Credit Cards, Bank Transfers, or City Ledger.">
            <PaymentMethodsManager />
          </ControlsCard>
          <ControlsCard title="Posting & Settlement Defaults" description="Which charge code the nightly room charge posts against, which City Ledger method settles debtor folios at checkout, and which charge code posts a Travel Agent commission credit.">
            <PostingDefaultsManager />
          </ControlsCard>
        </div>
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
          <ControlsCard title="Meal Plans" description="Meal plan codes offered on a reservation (Bed & Breakfast, Half Board, etc.). Link each plan to its Allocations (Revenue > Allocations, e.g. BB → BF) for per-person nightly pricing; a Derived Rate Plan remains an option for flat room-rate adjustments.">
            <MealPlansManager />
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
      key: "general",
      label: "General",
      icon: Settings2,
      render: () => (
        <div className="space-y-6">
          <ControlsCard title="Property Information" description="This property's own profile. Which enterprise it belongs to cannot be changed here.">
            <PropertyProfileManager />
          </ControlsCard>
          <ControlsCard title="Appearance" description="Choose this property's own banner accent, shown at the top of every page.">
            <PropertyBannerColorManager />
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
        <ControlsCard title="Users & Roles" description="Manage staff accounts, work-location assignment, and per-module role permissions.">
          <UsersRolesManager actorScope={actorScope} actorPropertyId={actorPropertyId} />
        </ControlsCard>
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
          <nav className="flex flex-col divide-y divide-border rounded-lg border border-border">
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
