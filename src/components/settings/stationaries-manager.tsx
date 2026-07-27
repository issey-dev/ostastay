"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Save, RefreshCw, Receipt, FileText, FileStack, Mail, ClipboardList, Landmark, Info } from "@/components/icons"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { useProperty } from "@/components/providers/property-provider"
import { resolveStationeryBrand, type PropertyBrandInput } from "@/lib/stationery-brand"
import { StationeryPreviewFrame } from "@/components/print/stationery/preview-frame"
import {
  InvoiceDocument,
  ReceiptDocument,
  ConfirmationLetterDocument,
  RegistrationCardDocument,
  StatementDocument,
} from "@/components/print/stationery/documents"
import {
  buildSampleInvoice,
  buildSampleReceipt,
  buildSampleLetter,
  buildSampleRegistrationCard,
  buildSampleStatement,
  EMPTY_STATIONERY_CONTENT,
  type StationeryContent,
} from "@/components/print/stationery/sample"

type StationeryTab = "invoices" | "receipts" | "letter" | "regcard" | "statement"

// The content this page owns — everything that is NOT branding. Branding identity (name,
// logo, tax id, contact, address), accent colour and font all come from the property's own
// General profile + Appearance (Controls > General), so this manager never edits them; it
// only reads the property to render a faithful live preview.
type FormData = StationeryContent & { registrationCardEnabled: boolean }

const EMPTY_FORM: FormData = { ...EMPTY_STATIONERY_CONTENT, registrationCardEnabled: true }

export function StationariesManager() {
  const { currentProperty } = useProperty()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<StationeryTab>("invoices")
  // Which invoice header variant the preview shows; both share everything else.
  const [invoiceVariant, setInvoiceVariant] = useState<"proforma" | "tax">("proforma")
  const [formData, setFormData] = useState<FormData>(EMPTY_FORM)
  // The current property's full branding row, fetched for the preview only.
  const [propertyBrand, setPropertyBrand] = useState<PropertyBrandInput | null>(null)

  const set = <K extends keyof FormData>(key: K, value: FormData[K]) =>
    setFormData((p) => ({ ...p, [key]: value }))

  const fetchSettings = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/tenant-settings`)
      if (res.ok) {
        const data = await res.json()
        setFormData({
          invoiceHeaderText: data.invoiceHeaderText || "",
          invoicePaymentAccountName: data.invoicePaymentAccountName || "",
          invoicePaymentAccountNumber: data.invoicePaymentAccountNumber || "",
          invoicePaymentIban: data.invoicePaymentIban || "",
          invoicePaymentBankInfo: data.invoicePaymentBankInfo || "",
          invoicePaymentTerms: data.invoicePaymentTerms || "",
          invoiceFooterText: data.invoiceFooterText || "",
          receiptFooterText: data.receiptFooterText || "",
          receiptTerms: data.receiptTerms || "",
          statementFooterText: data.statementFooterText || "",
          statementTerms: data.statementTerms || "",
          confirmationLetterMessage: data.confirmationLetterMessage || "",
          registrationCardMessage: data.registrationCardMessage || "",
          registrationCardTerms: data.registrationCardTerms || "",
          registrationCardEnabled: data.registrationCardEnabled ?? true,
        })
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  // Pull the current property's own branding row so the preview shows the real identity,
  // accent and font that the printed documents will use.
  const fetchPropertyBrand = async () => {
    try {
      const res = await fetch(`/api/properties`)
      if (res.ok) {
        const list: PropertyBrandInput[] = await res.json()
        const match =
          (currentProperty && list.find((p: any) => p.id === currentProperty.id)) || list[0] || null
        setPropertyBrand(match)
      }
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    fetchSettings()

  }, [])

  useEffect(() => {
    fetchPropertyBrand()

  }, [currentProperty?.id])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch(`/api/tenant-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })
      if (res.ok) {
        toast.success("Stationary settings saved successfully!")
      } else {
        toast.error("Failed to save stationary settings.")
      }
    } catch (e) {
      console.error(e)
      toast.error("Error saving settings.")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="py-12 text-center text-muted-foreground">Loading stationary configuration...</div>
  }

  // Branding for the preview: the current property (name/logo/colour/font/contact/address),
  // with a neutral placeholder before it loads so the preview never renders blank.
  const brand = resolveStationeryBrand(
    propertyBrand ?? {
      name: currentProperty?.name || "Your Property",
      bannerColor: currentProperty?.bannerColor ?? null,
      stationeryFont: currentProperty?.stationeryFont ?? null,
    }
  )

  return (
    <div className="grid items-start gap-8 lg:grid-cols-5">
      {/* Editor Form */}
      <form onSubmit={handleSave} className="space-y-5 lg:col-span-3">
        {/* Branding now lives in General — make that unmistakable so nobody hunts for it here. */}
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Logo, name, tax ID, contact details, <strong className="text-foreground">accent colour</strong> and{" "}
            <strong className="text-foreground">font</strong> come from{" "}
            <strong className="text-foreground">Controls › General</strong> (Property Information &amp; Appearance) and
            are inherited by every document. This page sets each document&apos;s wording.
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as StationeryTab)} className="w-full">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="invoices"><FileText className="mr-1.5 h-4 w-4" /> Invoices</TabsTrigger>
            <TabsTrigger value="receipts"><Receipt className="mr-1.5 h-4 w-4" /> Receipts</TabsTrigger>
            <TabsTrigger value="letter"><Mail className="mr-1.5 h-4 w-4" /> Letter</TabsTrigger>
            <TabsTrigger value="regcard"><ClipboardList className="mr-1.5 h-4 w-4" /> Reg. Card</TabsTrigger>
            <TabsTrigger value="statement"><Landmark className="mr-1.5 h-4 w-4" /> Statement</TabsTrigger>
          </TabsList>

          {/* -------- Invoices: Proforma + Tax share everything but the header line -------- */}
          <TabsContent value="invoices" className="mt-5 space-y-5">
            <p className="text-xs text-muted-foreground">
              Proforma and Tax invoices are identical apart from the header — Proforma shows “This is not a tax
              invoice”, Tax shows “Tax invoice”. Everything below applies to both.
            </p>
            <div className="space-y-2">
              <Label>Header Text <span className="font-normal text-muted-foreground">(registered business info)</span></Label>
              <Textarea
                rows={2}
                placeholder="Veyo Beach House Pvt Ltd. Registered in Maldives. Registration #98765"
                value={formData.invoiceHeaderText}
                onChange={(e) => set("invoiceHeaderText", e.target.value)}
              />
            </div>

            <div className="space-y-3 rounded-lg border p-4">
              <Label className="flex items-center gap-1"><Receipt className="h-4 w-4" /> Payment Information</Label>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Account Name</Label>
                  <Input value={formData.invoicePaymentAccountName} onChange={(e) => set("invoicePaymentAccountName", e.target.value)} placeholder="Veyo Beach House Pvt Ltd" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Account Number</Label>
                  <Input value={formData.invoicePaymentAccountNumber} onChange={(e) => set("invoicePaymentAccountNumber", e.target.value)} placeholder="0123456789" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">IBAN</Label>
                  <Input value={formData.invoicePaymentIban} onChange={(e) => set("invoicePaymentIban", e.target.value)} placeholder="MV.. .... ...." />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Bank Info</Label>
                  <Input value={formData.invoicePaymentBankInfo} onChange={(e) => set("invoicePaymentBankInfo", e.target.value)} placeholder="Bank of Maldives, Swift: MALBMVMV" />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Terms &amp; Conditions</Label>
              <Textarea rows={3} value={formData.invoicePaymentTerms} onChange={(e) => set("invoicePaymentTerms", e.target.value)} placeholder="Payment due within 30 days of invoice date." />
            </div>

            <div className="space-y-2">
              <Label>Footer Text / Greeting</Label>
              <Textarea rows={2} value={formData.invoiceFooterText} onChange={(e) => set("invoiceFooterText", e.target.value)} placeholder="Thank you for staying with us! We look forward to welcoming you back." />
            </div>
          </TabsContent>

          {/* -------- Receipts: Payment + Currency Exchange, header label only differs -------- */}
          <TabsContent value="receipts" className="mt-5 space-y-5">
            <p className="text-xs text-muted-foreground">
              Used by Payment Receipts and Currency Exchange Receipts — only the header label differs between them.
            </p>
            <div className="space-y-2">
              <Label>Footer Text / Greeting</Label>
              <Textarea rows={2} value={formData.receiptFooterText} onChange={(e) => set("receiptFooterText", e.target.value)} placeholder="Thank you for staying with us!" />
            </div>
            <div className="space-y-2">
              <Label>Terms &amp; Conditions</Label>
              <Textarea rows={3} value={formData.receiptTerms} onChange={(e) => set("receiptTerms", e.target.value)} placeholder="This receipt confirms the payment recorded above." />
            </div>
          </TabsContent>

          {/* -------- Confirmation Letter -------- */}
          <TabsContent value="letter" className="mt-5 space-y-5">
            <p className="text-xs text-muted-foreground">
              Shown as the policy paragraph on the guest Confirmation Letter, sent once a stay is confirmed.
            </p>
            <div className="space-y-2">
              <Label>Policy Text</Label>
              <Textarea
                rows={6}
                value={formData.confirmationLetterMessage}
                onChange={(e) => set("confirmationLetterMessage", e.target.value)}
                placeholder="We kindly request that all guests carry a valid photo ID or passport upon arrival. This letter may be presented as confirmation of accommodation for immigration and travel purposes."
              />
            </div>
          </TabsContent>

          {/* -------- Registration Card -------- */}
          <TabsContent value="regcard" className="mt-5 space-y-5">
            <p className="text-xs text-muted-foreground">
              Printed and signed by the guest at check-in (one card per guest).
            </p>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label>Registration Card step</Label>
                <p className="text-xs text-muted-foreground">Prompt to print &amp; collect a signed card during check-in.</p>
              </div>
              <Switch checked={formData.registrationCardEnabled} onCheckedChange={(v) => set("registrationCardEnabled", !!v)} />
            </div>
            <div className="space-y-2">
              <Label>Welcome / Intro Message</Label>
              <Input value={formData.registrationCardMessage} onChange={(e) => set("registrationCardMessage", e.target.value)} placeholder="Welcome — please review, complete, and sign below." />
            </div>
            <div className="space-y-2">
              <Label>Terms &amp; Conditions</Label>
              <Textarea rows={8} value={formData.registrationCardTerms} onChange={(e) => set("registrationCardTerms", e.target.value)} placeholder="Printed above the signature line. Leave blank to use the default wording." />
            </div>
          </TabsContent>

          {/* -------- Account Statement (scaffold) -------- */}
          <TabsContent value="statement" className="mt-5 space-y-5">
            <div className="flex items-start gap-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <p>The full statement layout will be finalised once you share its template. For now you can set its footer and terms; the preview uses the interim layout.</p>
            </div>
            <div className="space-y-2">
              <Label>Footer Text / Greeting</Label>
              <Textarea rows={2} value={formData.statementFooterText} onChange={(e) => set("statementFooterText", e.target.value)} placeholder="Thank you for your business." />
            </div>
            <div className="space-y-2">
              <Label>Terms &amp; Conditions</Label>
              <Textarea rows={3} value={formData.statementTerms} onChange={(e) => set("statementTerms", e.target.value)} placeholder="Balances are due per the agreed credit terms." />
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={fetchSettings} disabled={saving}>
            <RefreshCw className="mr-2 h-4 w-4" /> Reset
          </Button>
          <Button type="submit" disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? "Saving..." : "Save Stationary Settings"}
          </Button>
        </div>
      </form>

      {/* Live Preview — follows the active tab; no separate document selector. */}
      <div className="sticky top-6 space-y-2 lg:col-span-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Live Preview</Label>
          {activeTab === "invoices" && (
            <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
              {(["proforma", "tax"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setInvoiceVariant(v)}
                  className={cn(
                    "rounded px-2.5 py-1 font-medium capitalize transition-colors",
                    invoiceVariant === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          )}
        </div>

        <StationeryPreviewFrame>
          {activeTab === "invoices" && <InvoiceDocument {...buildSampleInvoice(brand, formData, invoiceVariant)} />}
          {activeTab === "receipts" && <ReceiptDocument {...buildSampleReceipt(brand, formData)} />}
          {activeTab === "letter" && <ConfirmationLetterDocument {...buildSampleLetter(brand, formData)} />}
          {activeTab === "regcard" && <RegistrationCardDocument {...buildSampleRegistrationCard(brand, formData)} />}
          {activeTab === "statement" && <StatementDocument {...buildSampleStatement(brand, formData)} />}
        </StationeryPreviewFrame>
      </div>
    </div>
  )
}
