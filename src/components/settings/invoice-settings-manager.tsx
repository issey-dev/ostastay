"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Save, RefreshCw, Palette, Type, Receipt } from "lucide-react"
import { DEFAULT_INVOICE_BRAND_COLOR } from "@/lib/invoice-branding"

export function InvoiceSettingsManager() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formData, setFormData] = useState({
    invoiceBrandName: "",
    invoiceLogoUrl: "",
    invoiceBrandColor: DEFAULT_INVOICE_BRAND_COLOR,
    invoiceFontFamily: "Geist",
    invoiceTaxId: "",
    invoicePhone: "",
    invoiceEmail: "",
    invoiceAddress: "",
    invoiceHeaderText: "",
    invoiceFooterText: "",
    invoicePaymentTerms: "",
    invoicePaymentAccountName: "",
    invoicePaymentAccountNumber: "",
    invoicePaymentIban: "",
    invoicePaymentBankInfo: "",
    confirmationLetterMessage: ""
  })

  const fetchSettings = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/tenant-settings`)
      if (res.ok) {
        const data = await res.json()
        setFormData({
          invoiceBrandName: data.invoiceBrandName || "",
          invoiceLogoUrl: data.invoiceLogoUrl || "",
          invoiceBrandColor: data.invoiceBrandColor || DEFAULT_INVOICE_BRAND_COLOR,
          invoiceFontFamily: data.invoiceFontFamily || "Geist",
          invoiceTaxId: data.invoiceTaxId || "",
          invoicePhone: data.invoicePhone || "",
          invoiceEmail: data.invoiceEmail || "",
          invoiceAddress: data.invoiceAddress || "",
          invoiceHeaderText: data.invoiceHeaderText || "",
          invoiceFooterText: data.invoiceFooterText || "",
          invoicePaymentTerms: data.invoicePaymentTerms || "",
          invoicePaymentAccountName: data.invoicePaymentAccountName || "",
          invoicePaymentAccountNumber: data.invoicePaymentAccountNumber || "",
          invoicePaymentIban: data.invoicePaymentIban || "",
          invoicePaymentBankInfo: data.invoicePaymentBankInfo || "",
          confirmationLetterMessage: data.confirmationLetterMessage || ""
        })
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch(`/api/tenant-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData)
      })
      if (res.ok) {
        alert("Invoice settings saved successfully!")
      } else {
        alert("Failed to save invoice settings.")
      }
    } catch (e) {
      console.error(e)
      alert("Error saving settings.")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="py-12 text-center text-muted-foreground">Loading invoice configuration...</div>
  }

  const fontStyles: Record<string, string> = {
    Geist: "font-sans",
    Inter: "font-sans",
    Roboto: "font-sans",
    Courier: "font-mono",
    Georgia: "font-serif"
  }

  return (
    <div className="grid lg:grid-cols-5 gap-8 items-start">
      {/* Editor Form */}
      <form onSubmit={handleSave} className="lg:col-span-3 space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Brand / Hotel Name</Label>
            <Input 
              placeholder="e.g. Cozy Guest House" 
              value={formData.invoiceBrandName} 
              onChange={e => setFormData(p => ({ ...p, invoiceBrandName: e.target.value }))} 
            />
          </div>

          <div className="space-y-2">
            <Label>Logo URL</Label>
            <Input 
              placeholder="https://example.com/logo.png" 
              value={formData.invoiceLogoUrl} 
              onChange={e => setFormData(p => ({ ...p, invoiceLogoUrl: e.target.value }))} 
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Tax / VAT Number</Label>
            <Input 
              placeholder="e.g. TAX-12345678" 
              value={formData.invoiceTaxId} 
              onChange={e => setFormData(p => ({ ...p, invoiceTaxId: e.target.value }))} 
            />
          </div>

          <div className="space-y-2">
            <Label>Contact Phone</Label>
            <Input 
              placeholder="+1 (555) 0199" 
              value={formData.invoicePhone} 
              onChange={e => setFormData(p => ({ ...p, invoicePhone: e.target.value }))} 
            />
          </div>

          <div className="space-y-2">
            <Label>Contact Email</Label>
            <Input 
              type="email"
              placeholder="billing@guesthouse.com" 
              value={formData.invoiceEmail} 
              onChange={e => setFormData(p => ({ ...p, invoiceEmail: e.target.value }))} 
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Billing Address</Label>
          <Input 
            placeholder="123 Main St, City, Country" 
            value={formData.invoiceAddress} 
            onChange={e => setFormData(p => ({ ...p, invoiceAddress: e.target.value }))} 
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="flex items-center gap-1"><Palette className="w-4 h-4"/> Accent Brand Color</Label>
            <div className="flex gap-2 items-center">
              <Input 
                type="color" 
                className="w-12 h-10 p-1 cursor-pointer border rounded-md"
                value={formData.invoiceBrandColor} 
                onChange={e => setFormData(p => ({ ...p, invoiceBrandColor: e.target.value }))} 
              />
              <Input 
                className="font-mono"
                placeholder="#4f46e5"
                value={formData.invoiceBrandColor} 
                onChange={e => setFormData(p => ({ ...p, invoiceBrandColor: e.target.value }))} 
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-1"><Type className="w-4 h-4"/> Font Style</Label>
            <Select value={formData.invoiceFontFamily} onValueChange={v => setFormData(p => ({ ...p, invoiceFontFamily: v ?? "" }))}>
              <SelectTrigger>
                <SelectValue placeholder="Select Font" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Geist">Geist (Default)</SelectItem>
                <SelectItem value="Inter">Inter (Clean)</SelectItem>
                <SelectItem value="Roboto">Roboto (Sleek)</SelectItem>
                <SelectItem value="Georgia">Georgia (Classic Serif)</SelectItem>
                <SelectItem value="Courier">Courier (Retro Mono)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Header Text (Optional Entity Details)</Label>
          <Textarea 
            placeholder="Cozy Guest House LLC. Registered in State. Registration #98765" 
            rows={2}
            value={formData.invoiceHeaderText} 
            onChange={e => setFormData(p => ({ ...p, invoiceHeaderText: e.target.value }))} 
          />
        </div>

        <div className="space-y-3 border rounded-lg p-4">
          <Label className="flex items-center gap-1"><Receipt className="w-4 h-4"/> Payment Information</Label>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Account Name</Label>
              <Input
                placeholder="Cozy Guest House LLC"
                value={formData.invoicePaymentAccountName}
                onChange={e => setFormData(p => ({ ...p, invoicePaymentAccountName: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Account Number</Label>
              <Input
                placeholder="0123456789"
                value={formData.invoicePaymentAccountNumber}
                onChange={e => setFormData(p => ({ ...p, invoicePaymentAccountNumber: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">IBAN</Label>
              <Input
                placeholder="GB29 NWBK 6016 1331 9268 19"
                value={formData.invoicePaymentIban}
                onChange={e => setFormData(p => ({ ...p, invoicePaymentIban: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Bank Info</Label>
              <Input
                placeholder="Bank of Example, Swift: EXMPGB2L"
                value={formData.invoicePaymentBankInfo}
                onChange={e => setFormData(p => ({ ...p, invoicePaymentBankInfo: e.target.value }))}
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Terms & Conditions</Label>
          <Textarea
            placeholder="Payment is due immediately upon check-out. Late payments accrue interest at 1.5% per month."
            rows={3}
            value={formData.invoicePaymentTerms}
            onChange={e => setFormData(p => ({ ...p, invoicePaymentTerms: e.target.value }))}
          />
        </div>

        <div className="space-y-2">
          <Label>Footer Text / Greetings</Label>
          <Textarea 
            placeholder="Thank you for staying with us! We look forward to welcoming you back." 
            rows={2}
            value={formData.invoiceFooterText} 
            onChange={e => setFormData(p => ({ ...p, invoiceFooterText: e.target.value }))} 
          />
        </div>

        <div className="space-y-2">
          <Label>Confirmation Letter — Policy Text</Label>
          <Textarea
            placeholder="Check-in time is from 14:00 and check-out time is until 12:00. We kindly request that all guests carry a valid photo ID or passport upon arrival."
            rows={3}
            value={formData.confirmationLetterMessage}
            onChange={e => setFormData(p => ({ ...p, confirmationLetterMessage: e.target.value }))}
          />
        </div>

        <div className="flex justify-end pt-4 border-t gap-2">
          <Button type="button" variant="outline" onClick={fetchSettings} disabled={saving}>
            <RefreshCw className="w-4 h-4 mr-2" /> Reset
          </Button>
          <Button type="submit" disabled={saving} className="">
            <Save className="w-4 h-4 mr-2" /> 
            {saving ? "Saving..." : "Save Invoice Settings"}
          </Button>
        </div>
      </form>

      {/* Live Preview Column */}
      <div className="lg:col-span-2 space-y-2 sticky top-6">
        <Label className="text-muted-foreground font-semibold uppercase text-xs tracking-wider">Live Invoice Preview</Label>
        <div 
          className={`bg-card border rounded-xl shadow-md p-6 overflow-hidden select-none text-[10px] leading-normal min-h-[480px] flex flex-col justify-between ${fontStyles[formData.invoiceFontFamily] || "font-sans"}`}
        >
          <div>
            {/* Logo & Header */}
            <div className="flex justify-between items-start border-b pb-4 mb-4">
              <div>
                {formData.invoiceLogoUrl ? (
                  <img 
                    src={formData.invoiceLogoUrl} 
                    alt="Logo" 
                    className="max-h-8 max-w-[120px] mb-2 object-contain"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                ) : (
                  <div className="w-8 h-8 rounded bg-muted flex items-center justify-center text-muted-foreground mb-2 font-bold text-xs border border-dashed">
                    H
                  </div>
                )}
                <h4 className="font-bold text-sm text-foreground uppercase tracking-tight">
                  {formData.invoiceBrandName || "YOUR HOTEL NAME"}
                </h4>
                <p className="text-[8px] text-muted-foreground whitespace-pre-line mt-1">
                  {formData.invoiceAddress || "123 Street Name, City, Country"}<br/>
                  Phone: {formData.invoicePhone || "+1 (555) 0123"}<br/>
                  Email: {formData.invoiceEmail || "billing@hotel.com"}
                </p>
              </div>
              <div className="text-right">
                <span 
                  className="inline-block px-2 py-0.5 rounded text-[8px] font-bold text-white uppercase tracking-wider mb-2"
                  style={{ backgroundColor: formData.invoiceBrandColor }}
                >
                  INVOICE
                </span>
                <p className="font-semibold text-foreground">CONF-98218</p>
                <p className="text-[8px] text-muted-foreground">Date: {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, '-')}</p>
                {formData.invoiceTaxId && (
                  <p className="text-[8px] text-muted-foreground mt-1">Tax ID: <span className="font-medium">{formData.invoiceTaxId}</span></p>
                )}
              </div>
            </div>

            {/* Header Text details */}
            {formData.invoiceHeaderText && (
              <div className="bg-muted p-2 rounded border border-border text-[8px] text-muted-foreground mb-4 whitespace-pre-line">
                {formData.invoiceHeaderText}
              </div>
            )}

            {/* Dummy Guest Info */}
            <div className="mb-4">
              <span className="font-bold text-muted-foreground uppercase tracking-wider text-[8px]">Bill To:</span>
              <p className="font-semibold text-foreground text-xs">Jane Doe</p>
              <p className="text-[8px] text-muted-foreground">Stay: Jul 9, 2026 - Jul 11, 2026 (2 Nights)</p>
            </div>

            {/* Dummy Ledger Table */}
            <table className="w-full mb-4 text-[8px]">
              <thead>
                <tr className="border-b-2 text-muted-foreground font-semibold" style={{ borderBottomColor: formData.invoiceBrandColor }}>
                  <th className="text-left pb-1">Description</th>
                  <th className="text-right pb-1">Amount</th>
                  <th className="text-right pb-1">Tax</th>
                  <th className="text-right pb-1">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b text-foreground">
                  <td className="py-1">Room Charge (Deluxe Room) - 2 Nights</td>
                  <td className="text-right py-1">$300.00</td>
                  <td className="text-right py-1">$30.00</td>
                  <td className="text-right py-1 font-semibold">$330.00</td>
                </tr>
                <tr className="border-b text-foreground">
                  <td className="py-1">Room Service</td>
                  <td className="text-right py-1">$45.00</td>
                  <td className="text-right py-1">$4.50</td>
                  <td className="text-right py-1 font-semibold">$49.50</td>
                </tr>
                <tr className="text-foreground font-semibold">
                  <td className="py-2" colSpan={3}>Total Due:</td>
                  <td className="text-right py-2 text-destructive text-xs">$379.50</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Footer & Terms */}
          <div className="border-t pt-3 mt-4 space-y-2">
            {(formData.invoicePaymentAccountName || formData.invoicePaymentAccountNumber || formData.invoicePaymentIban || formData.invoicePaymentBankInfo || formData.invoicePaymentTerms) && (
              <div className="grid grid-cols-2 gap-3">
                {(formData.invoicePaymentAccountName || formData.invoicePaymentAccountNumber || formData.invoicePaymentIban || formData.invoicePaymentBankInfo) && (
                  <div>
                    <span className="font-bold text-muted-foreground uppercase tracking-wider text-[7px]">Payment Information:</span>
                    <div className="text-[7.5px] text-muted-foreground leading-tight space-y-0.5">
                      {formData.invoicePaymentAccountName && <p>Account Name: {formData.invoicePaymentAccountName}</p>}
                      {formData.invoicePaymentAccountNumber && <p>Account Number: {formData.invoicePaymentAccountNumber}</p>}
                      {formData.invoicePaymentIban && <p>IBAN: {formData.invoicePaymentIban}</p>}
                      {formData.invoicePaymentBankInfo && <p className="whitespace-pre-line">{formData.invoicePaymentBankInfo}</p>}
                    </div>
                  </div>
                )}
                {formData.invoicePaymentTerms && (
                  <div>
                    <span className="font-bold text-muted-foreground uppercase tracking-wider text-[7px]">Terms & Conditions:</span>
                    <p className="text-[7.5px] text-muted-foreground leading-tight whitespace-pre-line">
                      {formData.invoicePaymentTerms}
                    </p>
                  </div>
                )}
              </div>
            )}
            {formData.invoiceFooterText && (
              <p className="text-[8px] text-muted-foreground text-center italic pt-1 whitespace-pre-line border-t border-border">
                {formData.invoiceFooterText}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
