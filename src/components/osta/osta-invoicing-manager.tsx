"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Save, RefreshCw, FileText, Receipt } from "@/components/icons"
import { toast } from "@/lib/toast"
import type { StationeryBrand } from "@/lib/stationery-brand"
import { STATIONERY_FONTS, DEFAULT_STATIONERY_FONT, resolveStationeryFontClass } from "@/lib/stationery-fonts"
import { DEFAULT_INVOICE_BRAND_COLOR } from "@/lib/invoice-branding"
import { StationeryPreviewFrame } from "@/components/print/stationery/preview-frame"
import { InfoHint } from "@/components/ui/info-hint"
import {
  LicenseTaxInvoiceDocument,
  LicenseReceiptDocument,
  buildSampleLicenseInvoice,
  buildSampleLicenseReceipt,
} from "@/components/print/stationery/license-invoice"

// Osta's own invoicing/receipt stationery — the documents Osta will send to CLIENT
// ENTERPRISES for platform licensing (not a property's guest-facing paper). Same
// document components and live-preview pattern as the tenant Stationaries page, with
// one structural difference: a property's branding comes from its General profile,
// but Osta has no property — so brand identity is edited right here and stored on
// Osta's own EnterpriseSettings row (the invoiceBrand* columns, which are deprecated
// for tenant use but are exactly the right home for the platform's own identity).
// Saving goes through the existing /api/tenant-settings, which is enterprise-scoped:
// an Osta session reads and writes Osta's own settings row, nobody else's.

type FormData = {
  // Brand identity (Osta the company, shown in the document header)
  invoiceBrandName: string
  invoiceLogoUrl: string
  invoiceBrandColor: string
  invoiceFontFamily: string
  invoiceTaxId: string
  invoicePhone: string
  invoiceEmail: string
  invoiceAddress: string
  // Invoice content
  invoiceHeaderText: string
  invoicePaymentAccountName: string
  invoicePaymentAccountNumber: string
  invoicePaymentIban: string
  invoicePaymentBankInfo: string
  invoicePaymentTerms: string
  invoiceFooterText: string
  // Receipt content
  receiptFooterText: string
  receiptTerms: string
}

const EMPTY_FORM: FormData = {
  invoiceBrandName: "",
  invoiceLogoUrl: "",
  invoiceBrandColor: DEFAULT_INVOICE_BRAND_COLOR,
  invoiceFontFamily: DEFAULT_STATIONERY_FONT,
  invoiceTaxId: "",
  invoicePhone: "",
  invoiceEmail: "",
  invoiceAddress: "",
  invoiceHeaderText: "",
  invoicePaymentAccountName: "",
  invoicePaymentAccountNumber: "",
  invoicePaymentIban: "",
  invoicePaymentBankInfo: "",
  invoicePaymentTerms: "",
  invoiceFooterText: "",
  receiptFooterText: "",
  receiptTerms: "",
}

export function OstaInvoicingManager() {
  const [form, setForm] = useState<FormData>(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/tenant-settings")
        if (!res.ok) return
        const s = await res.json()
        if (cancelled) return
        setForm({
          invoiceBrandName: s.invoiceBrandName ?? "",
          invoiceLogoUrl: s.invoiceLogoUrl ?? "",
          invoiceBrandColor: s.invoiceBrandColor ?? DEFAULT_INVOICE_BRAND_COLOR,
          invoiceFontFamily: s.invoiceFontFamily ?? DEFAULT_STATIONERY_FONT,
          invoiceTaxId: s.invoiceTaxId ?? "",
          invoicePhone: s.invoicePhone ?? "",
          invoiceEmail: s.invoiceEmail ?? "",
          invoiceAddress: s.invoiceAddress ?? "",
          invoiceHeaderText: s.invoiceHeaderText ?? "",
          invoicePaymentAccountName: s.invoicePaymentAccountName ?? "",
          invoicePaymentAccountNumber: s.invoicePaymentAccountNumber ?? "",
          invoicePaymentIban: s.invoicePaymentIban ?? "",
          invoicePaymentBankInfo: s.invoicePaymentBankInfo ?? "",
          invoicePaymentTerms: s.invoicePaymentTerms ?? "",
          invoiceFooterText: s.invoiceFooterText ?? "",
          receiptFooterText: s.receiptFooterText ?? "",
          receiptTerms: s.receiptTerms ?? "",
        })
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const set = (field: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch("/api/tenant-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      if (res.ok) toast.success("Invoicing settings saved")
      else toast.error("Failed to save settings")
    } finally {
      setSaving(false)
    }
  }

  // Live preview brand, built straight from unsaved form state — same "judge it in
  // situ" idea as the property Stationaries page.
  const brand: StationeryBrand = useMemo(
    () => ({
      name: form.invoiceBrandName || "Uppsolut PMS",
      logoUrl: form.invoiceLogoUrl || null,
      address: form.invoiceAddress || null,
      phone: form.invoicePhone || null,
      email: form.invoiceEmail || null,
      taxId: form.invoiceTaxId || null,
      brandColor: form.invoiceBrandColor || DEFAULT_INVOICE_BRAND_COLOR,
      fontClass: resolveStationeryFontClass(form.invoiceFontFamily),
    }),
    [form]
  )

  if (loading) return <p className="text-sm text-muted-foreground italic">Loading...</p>

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            Platform Identity
            <InfoHint label="Platform Identity">Who the licensing invoice comes from. Client enterprises see this in the header of every invoice and payment receipt Osta issues to them.</InfoHint>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="brandName">Company Name</Label>
            <Input id="brandName" value={form.invoiceBrandName} onChange={set("invoiceBrandName")} placeholder="Uppsolut PMS Pvt Ltd" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="logoUrl">Logo URL</Label>
            <Input id="logoUrl" value={form.invoiceLogoUrl} onChange={set("invoiceLogoUrl")} placeholder="https://…/logo.png" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="taxId">Tax ID / Registration</Label>
            <Input id="taxId" value={form.invoiceTaxId} onChange={set("invoiceTaxId")} placeholder="TIN 1234567" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" value={form.invoicePhone} onChange={set("invoicePhone")} placeholder="+960 …" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={form.invoiceEmail} onChange={set("invoiceEmail")} placeholder="billing@uppsolut.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brandColor">Accent Color</Label>
            <div className="flex gap-2 items-center">
              <input
                type="color"
                aria-label="Accent color"
                value={form.invoiceBrandColor || DEFAULT_INVOICE_BRAND_COLOR}
                onChange={(e) => setForm((f) => ({ ...f, invoiceBrandColor: e.target.value }))}
                className="h-9 w-12 border cursor-pointer bg-transparent"
              />
              <Input value={form.invoiceBrandColor} onChange={set("invoiceBrandColor")} className="font-mono" />
            </div>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="address">Address</Label>
            <Textarea id="address" value={form.invoiceAddress} onChange={set("invoiceAddress")} rows={2} placeholder="Malé, Republic of Maldives" />
          </div>
          <div className="space-y-1.5">
            <Label>Document Font</Label>
            <Select value={form.invoiceFontFamily} onValueChange={(v) => setForm((f) => ({ ...f, invoiceFontFamily: v ?? DEFAULT_STATIONERY_FONT }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATIONERY_FONTS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="invoice">
        <TabsList>
          <TabsTrigger value="invoice"><FileText className="h-4 w-4 mr-1.5" />Invoice</TabsTrigger>
          <TabsTrigger value="receipt"><Receipt className="h-4 w-4 mr-1.5" />Payment Receipt</TabsTrigger>
        </TabsList>

        <TabsContent value="invoice" className="pt-4">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="invHeader">Header Text</Label>
                <Textarea id="invHeader" value={form.invoiceHeaderText} onChange={set("invoiceHeaderText")} rows={2} placeholder="Shown under the invoice title." />
              </div>
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
            Payment Instructions
            <InfoHint label="Payment Instructions">Bank details a client enterprise pays the license fee to.</InfoHint>
          </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="payName">Account Name</Label>
                    <Input id="payName" value={form.invoicePaymentAccountName} onChange={set("invoicePaymentAccountName")} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="payNo">Account Number</Label>
                    <Input id="payNo" value={form.invoicePaymentAccountNumber} onChange={set("invoicePaymentAccountNumber")} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="payIban">IBAN / SWIFT</Label>
                    <Input id="payIban" value={form.invoicePaymentIban} onChange={set("invoicePaymentIban")} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="payBank">Bank</Label>
                    <Input id="payBank" value={form.invoicePaymentBankInfo} onChange={set("invoicePaymentBankInfo")} />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="payTerms">Payment Terms</Label>
                    <Textarea id="payTerms" value={form.invoicePaymentTerms} onChange={set("invoicePaymentTerms")} rows={2} placeholder="e.g. Due within 14 days of issue." />
                  </div>
                </CardContent>
              </Card>
              <div className="space-y-1.5">
                <Label htmlFor="invFooter">Footer Text</Label>
                <Textarea id="invFooter" value={form.invoiceFooterText} onChange={set("invoiceFooterText")} rows={2} placeholder="Closing line at the bottom of the invoice." />
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Live Preview</p>
              <StationeryPreviewFrame>
                <LicenseTaxInvoiceDocument {...buildSampleLicenseInvoice(brand, form)} />
              </StationeryPreviewFrame>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="receipt" className="pt-4">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="rcptFooter">Footer Text</Label>
                <Textarea id="rcptFooter" value={form.receiptFooterText} onChange={set("receiptFooterText")} rows={2} placeholder="Closing line at the bottom of the receipt." />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rcptTerms">Terms</Label>
                <Textarea id="rcptTerms" value={form.receiptTerms} onChange={set("receiptTerms")} rows={3} placeholder="Small print shown under the receipt body." />
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Live Preview</p>
              <StationeryPreviewFrame>
                <LicenseReceiptDocument {...buildSampleLicenseReceipt(brand, form)} />
              </StationeryPreviewFrame>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
          Save Settings
        </Button>
      </div>
    </div>
  )
}
