"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  MonitorPlay,
  Boxes,
  Wallet,
  Contact,
  FileBarChart,
  Settings2,
  CalendarDays,
  Users,
  KeyRound,
  ShieldCheck,
} from "lucide-react"
import { ControlsCard } from "@/components/controls/controls-card"
import { GeneralSettingsManager } from "@/components/settings/general-settings-manager"
import { InvoiceSettingsManager } from "@/components/settings/invoice-settings-manager"
import { PropertiesManager } from "@/components/settings/properties-manager"
import { FacilitiesManager } from "@/components/settings/facilities-manager"
import { FacilityAmenitiesManager } from "@/components/settings/facility-amenities-manager"
import { FinancialsManager } from "@/components/settings/financials-manager"
import { PaymentMethodsManager } from "@/components/settings/payment-methods-manager"
import { DropdownsManager, PROFILE_LOV_CATEGORIES, OPERATIONS_LOV_CATEGORIES } from "@/components/settings/dropdowns-manager"
import { UsersRolesManager } from "@/components/controls/users-roles-manager"
import { LicensingManager } from "@/components/controls/licensing-manager"
import { SupportAccessManager } from "@/components/controls/support-access-manager"
import { PropertyProfileManager } from "@/components/controls/property-profile-manager"
import { ThemeColorManager } from "@/components/controls/theme-color-manager"
import { SmtpSftpManager } from "@/components/controls/smtp-sftp-manager"

const TAB_TRIGGER_CLASS =
  "data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-600 rounded-none px-6 py-3 font-medium text-slate-500 dark:text-slate-400"

// Config-array-driven sections, mirroring app-sidebar.tsx's `items` pattern — add a new
// Controls section here rather than hand-adding another TabsTrigger/TabsContent pair.
// Tabs are grouped to match the app's own operational modules (Front Desk, Inventory,
// Finance, Client Relations, Reports, General, Reservations) plus the identity/admin
// sections from Phase 1. `ostaOnly` sections (Licensing) only render for Osta/INTERNAL
// sessions.
type ControlsSection = {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  ostaOnly?: boolean
  render: () => React.ReactNode
}

function buildSections(isInternal: boolean): ControlsSection[] {
  return [
    {
      key: "front-desk",
      label: "Front Desk",
      icon: MonitorPlay,
      render: () => (
        <ControlsCard title="Front Desk" description="No Front Desk-specific configuration exists yet.">
          <p className="text-sm text-slate-500">
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
          <ControlsCard title="Amenities" description="Facility amenities shown on a property's guest-facing profile (Pool, Gym, Spa, etc).">
            <FacilityAmenitiesManager />
          </ControlsCard>
          <ControlsCard title="Housekeeping Dropdowns" description="Lists used by Housekeeping and Maintenance operations.">
            <DropdownsManager categories={OPERATIONS_LOV_CATEGORIES} />
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
          <ControlsCard title="Tax Profiles & Charge Codes" description="Configure VAT, City Tax, and system-wide transaction codes — used by Night Audit and Cashiering.">
            <FinancialsManager />
          </ControlsCard>
          <ControlsCard title="Payment Methods" description="Configure accepted payment methods like Cash, Credit Cards, or Bank Transfers.">
            <PaymentMethodsManager />
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
          <ControlsCard title="Invoice Design" description="Customize the look, colors, headers, footers, and payment terms of guest invoices.">
            <InvoiceSettingsManager />
          </ControlsCard>
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
          <ControlsCard title="Appearance" description="Choose the app's primary accent color for everyone in this enterprise.">
            <ThemeColorManager />
          </ControlsCard>
        </div>
      ),
    },
    {
      key: "reservations",
      label: "Reservations",
      icon: CalendarDays,
      render: () => (
        <ControlsCard title="Booking Codes & Defaults" description="Confirmation-number formatting used by normal and block reservations.">
          <GeneralSettingsManager />
        </ControlsCard>
      ),
    },
    {
      key: "users",
      label: "Users & Roles",
      icon: Users,
      render: () => (
        <ControlsCard title="Users & Roles" description="Manage staff accounts, work-location assignment, and per-module role permissions.">
          <UsersRolesManager />
        </ControlsCard>
      ),
    },
    {
      key: "licensing",
      label: "Licensing",
      icon: KeyRound,
      ostaOnly: true,
      render: () => (
        <ControlsCard title="Licensing" description="Control how many properties each enterprise may create and (eventually) which modules their plan tier includes.">
          <LicensingManager />
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
          <SupportAccessManager isInternal={isInternal} />
        </ControlsCard>
      ),
    },
  ]
}

export function ControlsDashboard({ isInternal }: { isInternal: boolean }) {
  const sections = buildSections(isInternal).filter((s) => !s.ostaOnly || isInternal)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Controls</h2>
        <p className="text-muted-foreground">
          Manage your enterprise, properties, taxes, users, and integrations here.
        </p>
      </div>

      <Tabs defaultValue={sections[0]?.key} className="w-full flex-col">
        <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent mb-6 flex-wrap">
          {sections.map((s) => (
            <TabsTrigger key={s.key} value={s.key} className={TAB_TRIGGER_CLASS}>
              <s.icon className="w-4 h-4 mr-2" /> {s.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {sections.map((s) => (
          <TabsContent key={s.key} value={s.key} className="m-0 space-y-6">
            {s.render()}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
