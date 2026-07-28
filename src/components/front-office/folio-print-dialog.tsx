"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Printer } from "@/components/icons"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  FOLIO_STYLES,
  FOLIO_STYLE_LABELS,
  FOLIO_STYLE_DESCRIPTIONS,
  isFolioStyle,
  type FolioStyle,
} from "@/lib/folio-presentation"

export type FolioDocumentType = "tax" | "proforma" | "interim"

type HeaderOptions = {
  propertyName: string
  outlets: Array<{ id: string; name: string }>
  selected: string
}

const DOCUMENT_LABELS: Record<FolioDocumentType, string> = {
  tax: "Tax Invoice",
  proforma: "Proforma Invoice",
  interim: "Interim Bill",
}

// Asked before a folio document is generated: which layout does the guest get? A folio
// now physically holds a Service Charge and a GST line per revenue group (tax is attached
// at group level — see src/lib/posting/charge-tree.ts), which is what accounting wants
// and rarely what a guest wants, so the choice is offered up front rather than assumed.
//
// Every style totals to the same figure. Grouping never changes what is owed.
export function FolioPrintDialog({
  open,
  onOpenChange,
  folioId,
  documentType,
  slug,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  folioId: string
  documentType: FolioDocumentType
  slug: string
}) {
  const [style, setStyle] = useState<FolioStyle>("detailed")
  // "property", or an outlet id — whose business identity heads the document.
  const [header, setHeader] = useState<string>("property")
  const [headerOptions, setHeaderOptions] = useState<HeaderOptions | null>(null)

  // Open on the property's configured default (Stationaries > Invoices > Default Folio
  // Style). Re-read each time the dialog opens so a change in Controls takes effect
  // without a reload; the operator can still pick something else for this one document.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch("/api/tenant-settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (!cancelled && isFolioStyle(s?.defaultFolioStyle)) setStyle(s.defaultFolioStyle)
      })
      .catch(() => { /* the hardcoded default stands */ })
    return () => { cancelled = true }
  }, [open])

  // Which outlets have activity on this folio, and which header the API would pick on
  // its own — a walk-in bill defaults to the outlet that raised it, everything else to
  // the property.
  //
  // Probed as `interim` deliberately, NOT as the document being generated: a Tax Invoice
  // or Proforma allocates its document number on first fetch, so asking with the real
  // type would burn a sequence number just for opening this dialog — even on cancel.
  // Interim is the informational variant that never numbers, and the outlets on a folio
  // are the same whichever document is being raised.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch(`/api/folios/${folioId}/invoice-data?type=interim`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.headerOptions) return
        setHeaderOptions(d.headerOptions)
        setHeader(d.headerOptions.selected ?? "property")
      })
      .catch(() => { /* no picker — the API's own default applies */ })
    return () => { cancelled = true }
  }, [open, folioId])

  const generate = () => {
    const params = new URLSearchParams({ type: documentType, view: style, header })
    window.open(`/e/${slug}/dashboard/folios/${folioId}/print?${params}`, "_blank")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{DOCUMENT_LABELS[documentType]}</DialogTitle>
          <DialogDescription>
            Choose how the charges are laid out. Every style totals to the same amount —
            only the grouping changes.
          </DialogDescription>
        </DialogHeader>

        {/* Only shown when an outlet is actually in the picture — a plain room folio
            with no outlet trade on it has nothing to choose between. */}
        {headerOptions && headerOptions.outlets.length > 0 && (
          <div className="space-y-2 mt-2">
            <Label className="text-xs text-muted-foreground">Raise under</Label>
            <Select value={header} onValueChange={(v) => setHeader(v ?? "property")}>
              <SelectTrigger>
                <SelectValue>
                  {header === "property"
                    ? headerOptions.propertyName
                    : headerOptions.outlets.find((o) => o.id === header)?.name ?? headerOptions.propertyName}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="property">{headerOptions.propertyName} (property)</SelectItem>
                {headerOptions.outlets.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.name} (outlet)</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Whose name, address, contact details and tax number head the document. An
              outlet&apos;s own details come from Controls &gt; Outlets; the accent colour and
              font always stay the property&apos;s.
            </p>
          </div>
        )}

        <div className="space-y-2 mt-2">
          <Label className="text-xs text-muted-foreground">Folio style</Label>
          <div className="space-y-2">
            {FOLIO_STYLES.map((s) => (
              <label
                key={s}
                className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${
                  style === s ? "border-primary bg-muted/60" : "border-border hover:bg-muted/30"
                }`}
              >
                <input
                  type="radio"
                  name="folioStyle"
                  className="mt-1 shrink-0"
                  checked={style === s}
                  onChange={() => setStyle(s)}
                />
                <span className="space-y-0.5">
                  <span className="block text-sm font-medium">{FOLIO_STYLE_LABELS[s]}</span>
                  <span className="block text-xs text-muted-foreground">{FOLIO_STYLE_DESCRIPTIONS[s]}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={generate}>
            <Printer className="w-4 h-4 mr-2" /> Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
