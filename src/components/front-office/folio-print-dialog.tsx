"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Printer } from "@/components/icons"
import {
  FOLIO_STYLES,
  FOLIO_STYLE_LABELS,
  FOLIO_STYLE_DESCRIPTIONS,
  isFolioStyle,
  type FolioStyle,
} from "@/lib/folio-presentation"

export type FolioDocumentType = "tax" | "proforma" | "interim"

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

  const generate = () => {
    window.open(`/e/${slug}/dashboard/folios/${folioId}/print?type=${documentType}&view=${style}`, "_blank")
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
