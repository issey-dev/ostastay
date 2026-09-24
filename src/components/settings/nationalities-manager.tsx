"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { CountryFlag } from "@/components/ui/country-flag"
import { Check, Pencil, Plus, RotateCcw, Search, Trash2, X } from "@/components/icons"
import { COUNTRIES } from "@/lib/countries"
import { buildNationalities, type NationalityOption } from "@/lib/nationalities"
import { invalidateNationalities } from "@/components/ui/nationality-select"
import { invalidateSystemCodeCache } from "@/components/ui/system-code-select"
import { toast } from "@/lib/toast"

// The enterprise's nationality list (Hub > Enterprise > Guest Lists). Every country is
// already there — the master ISO 3166-1 list with flags (src/lib/countries.ts) — so there
// is nothing to set up. The enterprise can rename a standard entry, or add its own (e.g.
// "Stateless"); both are its NATIONALITY SystemCode rows (src/lib/nationalities.ts).

type Row = { id: string; code: string; value: string; isActive: boolean }

const MASTER_CODES = new Set(COUNTRIES.flatMap((c) => [c.alpha2, c.alpha3]))

const addSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,3}$/, "2 or 3 letters, e.g. XXA")
    .refine((c) => !MASTER_CODES.has(c), "That is a standard country code — rename the country instead"),
  nationality: z.string().trim().min(1, "Enter the nationality").max(60, "Keep it under 60 characters"),
})
type AddValues = z.infer<typeof addSchema>

export function NationalitiesManager({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [search, setSearch] = useState("")
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  const [busy, setBusy] = useState(false)
  const form = useForm<AddValues>({ resolver: zodResolver(addSchema), mode: "onChange", defaultValues: { code: "", nationality: "" } })

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/system-codes?category=NATIONALITY&includeInactive=1")
    setRows(res.ok ? await res.json() : [])
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const list = useMemo(() => buildNationalities(rows ?? []), [rows])
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = q
      ? list.filter((o) => [o.nationality, o.country, o.code, o.alpha3 ?? ""].some((v) => v.toLowerCase().includes(q)))
      : list
    // The enterprise's own changes first, then everything else alphabetically.
    return [...filtered].sort((a, b) => Number(b.renamed || !b.standard) - Number(a.renamed || !a.standard))
  }, [list, search])

  // Every change goes to the enterprise's NATIONALITY rows: create one, or update the row
  // that already exists for that code (even a switched-off one) — never a duplicate.
  const save = async (code: string, value: string, isActive: boolean) => {
    const existing = rows?.find((r) => r.code === code)
    setBusy(true)
    try {
      const res = existing
        ? await fetch("/api/settings/system-codes", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: existing.id, value, isActive }),
          })
        : await fetch("/api/settings/system-codes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ category: "NATIONALITY", code, value, sortOrder: 0 }),
          })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(typeof body.error === "string" ? body.error : "Couldn't save")
        return false
      }
      invalidateNationalities()
      invalidateSystemCodeCache("NATIONALITY")
      await load()
      return true
    } finally {
      setBusy(false)
    }
  }

  const rename = async (o: NationalityOption) => {
    const value = editValue.trim()
    if (!value) return
    const standard = COUNTRIES.find((c) => c.alpha2 === o.code)?.nationality
    // Renaming back to the standard name is the same as resetting it.
    if (await save(o.code, value, value !== standard)) {
      setEditing(null)
      toast.success(`${o.country}: "${value}"`)
    }
  }

  const onAdd = async (values: AddValues) => {
    if (await save(values.code, values.nationality, true)) {
      form.reset({ code: "", nationality: "" })
      toast.success(`Added ${values.nationality}`)
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Every country is already here, with its flag — the international ISO 3166-1 list, the same for every property. You
        can rename one for this enterprise, or add your own.
      </p>

      {canEdit && (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onAdd)} className="flex flex-col gap-3 rounded-md border border-border p-3 md:flex-row md:items-start">
            <FormField control={form.control} name="code" render={({ field }) => (
              <FormItem className="md:w-40">
                <FormLabel>Code</FormLabel>
                <FormControl><Input {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} maxLength={3} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="nationality" render={({ field }) => (
              <FormItem className="md:flex-1">
                <FormLabel>Nationality</FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <Button type="submit" className="md:mt-[1.375rem]" disabled={busy || form.formState.isSubmitting}>
              <Plus className="mr-2 h-4 w-4" /> Add nationality
            </Button>
          </form>
        </Form>
      )}

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search nationality, country or code" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {rows === null ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="max-h-[480px] overflow-y-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Nationality</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">Country</th>
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((o) => (
                <tr key={o.code}>
                  <td className="px-3 py-2">
                    {editing === o.code ? (
                      <div className="flex items-center gap-1.5">
                        <Input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="h-8"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void rename(o)
                            if (e.key === "Escape") setEditing(null)
                          }}
                        />
                        <Button variant="ghost" size="sm" className="h-8 w-8 shrink-0 p-0" aria-label="Save" onClick={() => void rename(o)} disabled={busy}>
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 shrink-0 p-0" aria-label="Cancel" onClick={() => setEditing(null)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="inline-flex w-5 shrink-0 justify-center"><CountryFlag value={o.code} /></span>
                        <span>{o.nationality}</span>
                        {o.renamed && <Badge variant="secondary">Renamed</Badge>}
                        {!o.standard && <Badge variant="outline">Added</Badge>}
                      </span>
                    )}
                  </td>
                  <td className="hidden px-3 py-2 text-muted-foreground md:table-cell">{o.standard ? o.country : "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {o.code}
                    {o.alpha3 && <span className="ml-1.5 opacity-70">{o.alpha3}</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canEdit && editing !== o.code && (
                      <span className="inline-flex gap-1">
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label={`Rename ${o.nationality}`} onClick={() => { setEditing(o.code); setEditValue(o.nationality) }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {o.renamed && (
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label="Back to the standard name" disabled={busy}
                            onClick={() => void save(o.code, COUNTRIES.find((c) => c.alpha2 === o.code)!.nationality, false)}>
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {!o.standard && (
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" aria-label={`Remove ${o.nationality}`} disabled={busy}
                            onClick={() => void save(o.code, o.nationality, false)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">No nationality matches “{search}”.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
