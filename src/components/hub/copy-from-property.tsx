"use client"

import { EmptyState } from "@/components/ui/empty-state"
import { useCallback, useEffect, useMemo, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Skeleton } from "@/components/ui/skeleton"
import { FileStack, AlertTriangle } from "@/components/icons"
import { toast } from "@/lib/toast"

// "Copy from another property" for one setup section — see src/lib/property-copy.ts for the
// rules. Onboarding help: pick a property, tick what to bring over, copy. Anything this
// property already has is shown with a warning and skipped — there is no overwrite.
// Renders nothing when there is no other property to copy from (a one-property enterprise,
// or a single-property admin, who sees no other property at all).

export type CopySection =
  | "lists"
  | "tax-profiles"
  | "charge-codes"
  | "payment-methods"
  | "stationery"
  | "meal-plans"
  | "room-types"
  | "outlets"

type Source = { id: string; name: string; code: string }
type Item = { key: string; label: string; detail: string | null; exists: boolean }
type ReportItem = { key: string; label: string }
type Report = { copied: ReportItem[]; skipped: ReportItem[]; pulled: ReportItem[] }

const schema = z.object({
  from: z.string().min(1, "Choose the property to copy from"),
  keys: z.array(z.string()).min(1, "Tick at least one item to copy"),
})
type Values = z.infer<typeof schema>

export function CopyFromPropertyButton({
  propertyId,
  section,
  title,
  keyPrefixes,
}: {
  propertyId: string
  section: CopySection
  /** What is being copied, e.g. "charge codes" — used in the dialog's wording. */
  title: string
  /** Narrow the items offered to keys starting with one of these (e.g. "BED_TYPE:" — only
   *  the room-feature lists on the Room Features card). */
  keyPrefixes?: string[]
}) {
  const [sources, setSources] = useState<Source[]>([])
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Item[] | null>(null)
  const [loadingItems, setLoadingItems] = useState(false)
  const [report, setReport] = useState<Report | null>(null)

  const form = useForm<Values>({ resolver: zodResolver(schema), mode: "onChange", defaultValues: { from: "", keys: [] } })
  const from = form.watch("from")

  useEffect(() => {
    fetch(`/api/properties/${propertyId}/copy`)
      .then((r) => (r.ok ? r.json() : { sources: [] }))
      .then((d) => setSources(d.sources ?? []))
      .catch(() => setSources([]))
  }, [propertyId])

  const loadItems = useCallback(
    async (source: string) => {
      setItems(null)
      if (!source) return
      setLoadingItems(true)
      try {
        const res = await fetch(`/api/properties/${propertyId}/copy?section=${section}&from=${source}`)
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(data.error ?? "Couldn't load that property's items")
          return
        }
        const all: Item[] = (data.items ?? []).filter(
          (i: Item) => !keyPrefixes || keyPrefixes.some((p) => i.key.startsWith(p))
        )
        setItems(all)
        // Everything new is ticked to start with; what already exists can't be.
        const fresh = all.filter((i) => !i.exists).map((i) => i.key)
        form.setValue("keys", fresh, { shouldValidate: fresh.length > 0 })
      } finally {
        setLoadingItems(false)
      }
    },
    // keyPrefixes by value — a fresh array each render must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [propertyId, section, keyPrefixes?.join("|"), form]
  )

  useEffect(() => {
    void loadItems(from)
  }, [from, loadItems])

  const fresh = useMemo(() => items?.filter((i) => !i.exists) ?? [], [items])
  const existing = useMemo(() => items?.filter((i) => i.exists) ?? [], [items])

  if (sources.length === 0) return null

  const close = () => {
    setOpen(false)
    // The section's own list was loaded before the copy — reload so it shows the new items.
    if (report && (report.copied.length > 0 || report.pulled.length > 0)) window.location.reload()
    setReport(null)
    setItems(null)
    form.reset({ from: "", keys: [] })
  }

  const onSubmit = async (values: Values) => {
    const res = await fetch(`/api/properties/${propertyId}/copy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section, from: values.from, keys: values.keys }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(typeof data.error === "string" ? data.error : "Couldn't copy")
      return
    }
    setReport(data)
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <FileStack className="mr-2 h-4 w-4" /> Copy from…
      </Button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Copy {title} from another property</DialogTitle>
            <DialogDescription>
              Brings copies over to this property — each property keeps its own afterwards. Anything this property already
              has is skipped, never overwritten.
            </DialogDescription>
          </DialogHeader>

          {report ? (
            <div className="space-y-3 text-sm">
              <p>
                Copied <strong>{report.copied.length}</strong>
                {report.pulled.length > 0 && <> and pulled along <strong>{report.pulled.length}</strong> they need</>}.
              </p>
              {report.pulled.length > 0 && (
                <div className="rounded-md border border-border p-3">
                  <p className="mb-1 font-medium">Pulled along</p>
                  <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                    {report.pulled.map((i) => <li key={`p-${i.key}`}>{i.label}</li>)}
                  </ul>
                </div>
              )}
              {report.skipped.length > 0 && (
                <div className="rounded-md border border-warning/40 bg-warning-muted p-3">
                  <p className="mb-1 flex items-center gap-1.5 font-medium text-warning">
                    <AlertTriangle className="h-4 w-4" /> Skipped — already here
                  </p>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {report.skipped.map((i) => <li key={`s-${i.key}`}>{i.label}</li>)}
                  </ul>
                </div>
              )}
              <DialogFooter>
                <Button onClick={close}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="from" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Copy from *</FormLabel>
                    <FormControl>
                      <SearchableSelect
                        value={field.value}
                        onChange={(v) => field.onChange(v ?? "")}
                        placeholder="Choose a property…"
                        options={sources.map((s) => ({ label: `${s.name} (${s.code})`, value: s.id }))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {from && (loadingItems || !items) ? (
                  <Skeleton className="h-32 w-full" />
                ) : items && items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">That property has no {title} to copy.</p>
                ) : items ? (
                  <FormField control={form.control} name="keys" render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel>What to copy *</FormLabel>
                        {fresh.length > 0 && (
                          <button
                            type="button"
                            className="text-xs text-primary hover:underline"
                            onClick={() =>
                              field.onChange(field.value.length === fresh.length ? [] : fresh.map((i) => i.key))
                            }
                          >
                            {field.value.length === fresh.length ? "Clear all" : "Select all"}
                          </button>
                        )}
                      </div>
                      {fresh.length === 0 && (
                        <EmptyState size="inline" title="Nothing new to copy — this property already has all of them." />
                      )}
                      {existing.length > 0 && (
                        <p className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-xs text-warning">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          {existing.length} already exist here and will be skipped — nothing here is overwritten.
                        </p>
                      )}
                      <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                        {items.map((i) => {
                          const checked = field.value.includes(i.key)
                          return (
                            <label
                              key={i.key}
                              className={`flex items-start gap-3 rounded px-2 py-1.5 text-sm ${i.exists ? "opacity-60" : "cursor-pointer hover:bg-muted/50"}`}
                            >
                              <Checkbox
                                className="mt-0.5"
                                checked={checked}
                                disabled={i.exists}
                                onCheckedChange={(v) =>
                                  field.onChange(v ? [...field.value, i.key] : field.value.filter((k) => k !== i.key))
                                }
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block">{i.label}</span>
                                {i.detail && <span className="block truncate text-xs text-muted-foreground">{i.detail}</span>}
                              </span>
                              {i.exists && <Badge variant="outline" className="shrink-0">Already here</Badge>}
                            </label>
                          )
                        })}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )} />
                ) : null}

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={close}>Cancel</Button>
                  <Button type="submit" disabled={form.formState.isSubmitting || !items || fresh.length === 0}>
                    {form.formState.isSubmitting ? "Copying…" : "Copy"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
