"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Settings2, Building, Percent, Users, CreditCard, Receipt, List, KeyRound, ShieldCheck } from "lucide-react"
import { PaymentMethodsManager } from "@/components/settings/payment-methods-manager"
import { GeneralSettingsManager } from "@/components/settings/general-settings-manager"
import { FinancialsManager } from "@/components/settings/financials-manager"
import { FacilitiesManager } from "@/components/settings/facilities-manager"
import { PropertiesManager } from "@/components/settings/properties-manager"
import { InvoiceSettingsManager } from "@/components/settings/invoice-settings-manager"
import { DropdownsManager } from "@/components/settings/dropdowns-manager"
import { FacilityAmenitiesManager } from "@/components/settings/facility-amenities-manager"
import { UsersRolesManager } from "@/components/controls/users-roles-manager"
import { LicensingManager } from "@/components/controls/licensing-manager"
import { SupportAccessManager } from "@/components/controls/support-access-manager"

const TAB_TRIGGER_CLASS =
  "data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-600 rounded-none px-6 py-3 font-medium text-slate-500"

// Config-array-driven sections, mirroring app-sidebar.tsx's `items` pattern — add a new
// Controls section here rather than hand-adding another TabsTrigger/TabsContent pair.
// `ostaOnly` sections (Licensing) are only rendered for Osta/INTERNAL sessions.
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
      key: "general",
      label: "General",
      icon: Settings2,
      render: () => (
        <Card className="premium-card">
          <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
            <CardTitle className="text-lg">Enterprise Configuration</CardTitle>
            <CardDescription>Update your core system defaults and locale settings.</CardDescription>
          </CardHeader>
          <CardContent className="p-6"><GeneralSettingsManager /></CardContent>
        </Card>
      ),
    },
    {
      key: "invoice",
      label: "Invoice Design",
      icon: Receipt,
      render: () => (
        <Card className="premium-card">
          <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
            <CardTitle className="text-lg">Invoice Branding & Terms</CardTitle>
            <CardDescription>Customize the look, colors, headers, footers, and payment terms of guest invoices.</CardDescription>
          </CardHeader>
          <CardContent className="p-6"><InvoiceSettingsManager /></CardContent>
        </Card>
      ),
    },
    {
      key: "facilities",
      label: "Facilities & Rooms",
      icon: Building,
      render: () => (
        <div className="space-y-6">
          <Card className="premium-card">
            <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4 flex flex-row items-center justify-between">
              <div className="w-full"><PropertiesManager /></div>
            </CardHeader>
          </Card>
          <Card className="premium-card">
            <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
              <CardTitle className="text-lg">Property Architecture</CardTitle>
              <CardDescription>Manage your global buildings, floors, and room types.</CardDescription>
            </CardHeader>
            <CardContent className="p-6"><FacilitiesManager /></CardContent>
          </Card>
          <Card className="premium-card">
            <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
              <CardTitle className="text-lg">Amenities</CardTitle>
              <CardDescription>Facility amenities shown on a property&apos;s guest-facing profile (Pool, Gym, Spa, etc).</CardDescription>
            </CardHeader>
            <CardContent className="p-6"><FacilityAmenitiesManager /></CardContent>
          </Card>
        </div>
      ),
    },
    {
      key: "taxes",
      label: "Financial & Taxes",
      icon: Percent,
      render: () => (
        <Card className="premium-card">
          <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
            <CardTitle className="text-lg">Tax Profiles & Charge Codes</CardTitle>
            <CardDescription>Configure VAT, City Tax, and system-wide charge codes.</CardDescription>
          </CardHeader>
          <CardContent className="p-6"><FinancialsManager /></CardContent>
        </Card>
      ),
    },
    {
      key: "payments",
      label: "Payment Methods",
      icon: CreditCard,
      render: () => <PaymentMethodsManager />,
    },
    {
      key: "dropdowns",
      label: "Dropdowns",
      icon: List,
      render: () => (
        <Card className="premium-card">
          <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
            <CardTitle className="text-lg">Dropdown Lists</CardTitle>
            <CardDescription>Manage dynamic dropdown options used across the PMS — genders, titles, nationalities, and more.</CardDescription>
          </CardHeader>
          <CardContent className="p-6"><DropdownsManager /></CardContent>
        </Card>
      ),
    },
    {
      key: "users",
      label: "Users & Roles",
      icon: Users,
      render: () => (
        <Card className="premium-card">
          <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
            <CardTitle className="text-lg">Users & Roles</CardTitle>
            <CardDescription>Manage staff accounts, work-location assignment, and per-module role permissions.</CardDescription>
          </CardHeader>
          <CardContent className="p-6"><UsersRolesManager /></CardContent>
        </Card>
      ),
    },
    {
      key: "licensing",
      label: "Licensing",
      icon: KeyRound,
      ostaOnly: true,
      render: () => (
        <Card className="premium-card">
          <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
            <CardTitle className="text-lg">Licensing</CardTitle>
            <CardDescription>Control how many properties each enterprise may create and (eventually) which modules their plan tier includes.</CardDescription>
          </CardHeader>
          <CardContent className="p-6"><LicensingManager /></CardContent>
        </Card>
      ),
    },
    {
      key: "support",
      label: "Support Access",
      icon: ShieldCheck,
      render: () => (
        <Card className="premium-card">
          <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
            <CardTitle className="text-lg">Support Access</CardTitle>
            <CardDescription>
              Osta support staff have no implicit access to your data — they must request it here, and you decide whether to approve it.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6"><SupportAccessManager isInternal={isInternal} /></CardContent>
        </Card>
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
