"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Settings2, Building, Percent, KeyRound, Users, CreditCard, Receipt, List } from "lucide-react"
import { PaymentMethodsManager } from "@/components/settings/payment-methods-manager"
import { GeneralSettingsManager } from "@/components/settings/general-settings-manager"
import { FinancialsManager } from "@/components/settings/financials-manager"
import { FacilitiesManager } from "@/components/settings/facilities-manager"
import { PropertiesManager } from "@/components/settings/properties-manager"
import { InvoiceSettingsManager } from "@/components/settings/invoice-settings-manager"
import { DropdownsManager } from "@/components/settings/dropdowns-manager"
import { TeamManager } from "@/components/settings/team-manager"

export default function SettingsDashboard() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">System Settings</h2>
        <p className="text-muted-foreground">
          Manage your global property configurations, taxes, and integrations here.
        </p>
      </div>

      <Tabs defaultValue="general" className="w-full flex-col">
        <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent mb-6">
          <TabsTrigger 
            value="general" 
            className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-600 rounded-none px-6 py-3 font-medium text-slate-500"
          >
            <Settings2 className="w-4 h-4 mr-2" /> General
          </TabsTrigger>
          <TabsTrigger 
            value="invoice" 
            className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-600 rounded-none px-6 py-3 font-medium text-slate-500"
          >
            <Receipt className="w-4 h-4 mr-2" /> Invoice Design
          </TabsTrigger>
          <TabsTrigger 
            value="facilities" 
            className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-600 rounded-none px-6 py-3 font-medium text-slate-500"
          >
            <Building className="w-4 h-4 mr-2" /> Facilities & Rooms
          </TabsTrigger>
          <TabsTrigger 
            value="taxes" 
            className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-600 rounded-none px-6 py-3 font-medium text-slate-500"
          >
            <Percent className="w-4 h-4 mr-2" /> Financial & Taxes
          </TabsTrigger>
          <TabsTrigger 
            value="payments" 
            className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-600 rounded-none px-6 py-3 font-medium text-slate-500"
          >
            <CreditCard className="w-4 h-4 mr-2" /> Payment Methods
          </TabsTrigger>
          <TabsTrigger 
            value="dropdowns" 
            className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-600 rounded-none px-6 py-3 font-medium text-slate-500"
          >
            <List className="w-4 h-4 mr-2" /> Dropdowns
          </TabsTrigger>
          <TabsTrigger 
            value="team" 
            className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-600 rounded-none px-6 py-3 font-medium text-slate-500"
          >
            <Users className="w-4 h-4 mr-2" /> Team Management
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6 m-0">
          <Card className="premium-card">
            <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
              <CardTitle className="text-lg">Tenant Configuration</CardTitle>
              <CardDescription>Update your core system defaults and locale settings.</CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <GeneralSettingsManager />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invoice" className="space-y-6 m-0">
          <Card className="premium-card">
            <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
              <CardTitle className="text-lg">Invoice Branding & Terms</CardTitle>
              <CardDescription>Customize the look, colors, headers, footers, and payment terms of guest invoices.</CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <InvoiceSettingsManager />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="facilities" className="m-0 space-y-6">
          <Card className="premium-card">
            <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4 flex flex-row items-center justify-between">
              <div className="w-full">
                <PropertiesManager />
              </div>
            </CardHeader>
          </Card>
          
          <Card className="premium-card">
            <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">Property Architecture</CardTitle>
                <CardDescription>Manage your global buildings, floors, and room types.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              <FacilitiesManager />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="taxes" className="m-0">
          <Card className="premium-card">
            <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
              <CardTitle className="text-lg">Tax Profiles & Charge Codes</CardTitle>
              <CardDescription>Configure VAT, City Tax, and system-wide charge codes.</CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <FinancialsManager />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments" className="m-0">
          <PaymentMethodsManager />
        </TabsContent>

        <TabsContent value="dropdowns" className="m-0">
          <Card className="premium-card">
            <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
              <CardTitle className="text-lg">Dropdown Lists</CardTitle>
              <CardDescription>Manage dynamic dropdown options used across the PMS — genders, titles, nationalities, and more.</CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <DropdownsManager />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="team" className="m-0">
          <Card className="premium-card">
            <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
              <CardTitle className="text-lg">User Access</CardTitle>
              <CardDescription>Manage user permissions, roles, and system access.</CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <TeamManager />
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>
    </div>
  )
}
