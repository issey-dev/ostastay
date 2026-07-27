"use client"

import { useState, useEffect, useCallback } from "react"
import { Plus, Pencil, Trash2, Receipt, ArrowRightCircle } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useTableSort, SortableTableHead } from "@/components/controls/use-table-sort"
import { ControlsSectionBody } from "@/components/controls/controls-section-header"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/lib/toast"
import {
  POSTING_TYPES,
  POSTING_TYPE_LABELS,
  REPORT_BUCKET_LABELS,
  type PostingType,
  type ReportBucket,
} from "@/lib/posting/charge-tree"
import { ChargeCodeGeneratesEditor } from "@/components/controls/charge-code-generates-editor"
import type { ChargeGroup } from "@/components/controls/charge-groups-manager"

export type ChargeCodeRow = {
  id: string
  code: string
  description: string
  chargeSubgroupId: string | null
  chargeSubgroup?: { id: string; code: string; name: string; chargeGroup: { code: string; name: string; reportBucket: string } } | null
  category: string
  postingType: string
  isSystem: boolean
  isActive: boolean
  useDefaultTax: boolean
  taxProfileId: string | null
  taxProfile?: { id: string; name: string } | null
  generatesFrom?: Array<{ id: string; method: string; generatedCode: { code: string } }>
}

// What the Tax column says. Only a CHARGE code is ever taxed, and when its group's tax
// codes are wired as generates that — not `useDefaultTax` — is where its tax actually
// comes from, so say so rather than showing a mode that no longer decides anything.
function taxLabel(cc: ChargeCodeRow): string {
  if (cc.postingType === "TAX") return "Face value (levy)"
  if (cc.postingType !== "CHARGE") return "Not taxed"
  const routes = (cc.generatesFrom ?? []).filter((g) => g.method === "SERVICE_CHARGE" || g.method === "GST")
  if (routes.length > 0) {
    const parts = routes.map((g) => (g.method === "SERVICE_CHARGE" ? "Service Charge" : "GST"))
    return `${parts.join(" + ")} → group codes`
  }
  return cc.useDefaultTax ? "Default (Maldives Tax)" : cc.taxProfile?.name || "Custom Tax"
}

const BLANK_FORM = {
  code: "",
  description: "",
  chargeSubgroupId: "",
  postingType: "CHARGE" as PostingType,
  isActive: true,
  useDefaultTax: true,
  taxProfileId: "",
}

// Level 3 of the charge hierarchy. A code's classification is now its Subgroup (which
// carries the Group, which carries the reporting bucket) — the old free-text "category"
// dropdown is gone. `postingType` makes explicit what used to be implied by the code
// string: a TAX code posts at face value and stays out of the GST base, exactly as the
// hardcoded GTX handling did.
export function ChargeCodesManager() {
  const [chargeCodes, setChargeCodes] = useState<ChargeCodeRow[]>([])
  const [groups, setGroups] = useState<ChargeGroup[]>([])
  const [taxProfiles, setTaxProfiles] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [bucketFilter, setBucketFilter] = useState<string>("ALL")

  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [editing, setEditing] = useState<ChargeCodeRow | null>(null)
  const [form, setForm] = useState(BLANK_FORM)

  const [deleting, setDeleting] = useState<ChargeCodeRow | null>(null)
  const [generatesFor, setGeneratesFor] = useState<ChargeCodeRow | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [ccRes, taxRes, grpRes] = await Promise.all([
        fetch(`/api/charge-codes`),
        fetch(`/api/taxes`),
        fetch(`/api/charge-groups`),
      ])
      if (ccRes.ok) setChargeCodes(await ccRes.json())
      if (taxRes.ok) setTaxProfiles(await taxRes.json())
      if (grpRes.ok) setGroups(await grpRes.json())
    } catch (error) {
      console.error("Failed to fetch charge codes", error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Flat "Group / Subgroup" options for the picker — the hierarchy is two levels, so a
  // single grouped list reads better than two chained dropdowns.
  const subgroupOptions = groups.flatMap((g) =>
    g.subgroups.map((s) => ({ label: `${g.name} / ${s.name}`, value: s.id }))
  )

  const openCreate = () => {
    setEditing(null)
    setForm(BLANK_FORM)
    setModalOpen(true)
  }

  const openEdit = (cc: ChargeCodeRow) => {
    setEditing(cc)
    setForm({
      code: cc.code,
      description: cc.description,
      chargeSubgroupId: cc.chargeSubgroupId ?? "",
      postingType: (POSTING_TYPES.includes(cc.postingType as PostingType) ? cc.postingType : "CHARGE") as PostingType,
      isActive: cc.isActive,
      useDefaultTax: cc.useDefaultTax,
      taxProfileId: cc.taxProfileId || cc.taxProfile?.id || "",
    })
    setModalOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const res = await fetch(editing ? `/api/charge-codes/${editing.id}` : `/api/charge-codes`, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        setModalOpen(false)
        fetchData()
      } else {
        toast.error((await res.json().catch(() => null))?.error || "Failed to save charge code")
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deleting) return
    const res = await fetch(`/api/charge-codes/${deleting.id}`, { method: "DELETE" })
    if (res.ok) {
      setDeleting(null)
      fetchData()
    } else {
      toast.error((await res.json().catch(() => null))?.error || "Failed to delete Charge Code")
    }
  }

  const bucketOf = (cc: ChargeCodeRow) => cc.chargeSubgroup?.chargeGroup.reportBucket ?? null
  const filtered = bucketFilter === "ALL" ? chargeCodes : chargeCodes.filter((cc) => bucketOf(cc) === bucketFilter)
  const { sorted, sort } = useTableSort(filtered, { code: (cc) => cc.code }, "code")

  // Only buckets that actually exist on this enterprise's groups.
  const bucketFilters = [...new Set(groups.map((g) => g.reportBucket))]

  // A levy never runs the tax engine, so its tax picker is meaningless.
  const taxApplies = form.postingType !== "TAX"

  if (loading) {
    return <div className="space-y-3"><Skeleton className="h-9 w-48" /><Skeleton className="h-64 rounded-xl" /></div>
  }

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="space-y-2 w-56">
          <Label className="text-xs text-muted-foreground">Filter by Reporting Bucket</Label>
          <Select value={bucketFilter} onValueChange={(v) => setBucketFilter(v ?? "ALL")}>
            <SelectTrigger>
              <SelectValue>
                {bucketFilter === "ALL" ? "All Buckets" : (REPORT_BUCKET_LABELS[bucketFilter as ReportBucket] ?? bucketFilter)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Buckets</SelectItem>
              {bucketFilters.map((b) => (
                <SelectItem key={b} value={b}>{REPORT_BUCKET_LABELS[b as ReportBucket] ?? b}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button size="sm" className="shadow-sm" onClick={openCreate}>
          <Plus className="w-4 h-4 mr-2" /> Add Charge Code
        </Button>
      </div>

      <ControlsSectionBody>
        <Table>
          <TableHeader className="bg-muted/80">
            <TableRow>
              <SortableTableHead columnKey="code" sort={sort}>Code</SortableTableHead>
              <TableHead>Description</TableHead>
              <TableHead>Group / Subgroup</TableHead>
              <TableHead>Posting</TableHead>
              <TableHead>Tax</TableHead>
              <TableHead>Generates</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((cc) => (
              <TableRow key={cc.id} className={`hover:bg-muted/50 ${cc.isActive ? "" : "opacity-60"}`}>
                <TableCell className="font-mono font-medium text-foreground">
                  {cc.code}
                  {cc.isSystem && <Badge variant="secondary" className="ml-2 font-normal">System</Badge>}
                  {!cc.isActive && <Badge variant="outline" className="ml-2 font-normal">Inactive</Badge>}
                </TableCell>
                <TableCell>{cc.description}</TableCell>
                <TableCell>
                  {cc.chargeSubgroup ? (
                    <span className="text-sm">
                      {cc.chargeSubgroup.chargeGroup.name}
                      <span className="text-muted-foreground"> / {cc.chargeSubgroup.name}</span>
                    </span>
                  ) : (
                    <Badge variant="outline" className="font-normal text-warning border-warning/40">Unclassified</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-normal">
                    {POSTING_TYPE_LABELS[cc.postingType as PostingType] ?? cc.postingType}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className="font-normal">{taxLabel(cc)}</Badge>
                </TableCell>
                <TableCell>
                  {cc.generatesFrom && cc.generatesFrom.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {cc.generatesFrom.map((g) => (
                        <Badge key={g.id} variant="outline" className="font-mono text-[11px] font-normal">{g.generatedCode.code}</Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right px-6">
                  <div className="flex gap-1 justify-end">
                    <Button variant="ghost" size="sm" title="Generates" onClick={() => setGeneratesFor(cc)}>
                      <ArrowRightCircle className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="text-primary hover:bg-muted" onClick={() => openEdit(cc)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost" size="sm"
                      className="text-destructive hover:bg-destructive-muted disabled:opacity-30"
                      disabled={cc.isSystem}
                      title={cc.isSystem ? "System charge codes can't be deleted — deactivate instead" : "Delete"}
                      onClick={() => setDeleting(cc)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-0">
                  <EmptyState icon={Receipt} title="No charge codes configured" />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ControlsSectionBody>

      {/* Create / edit */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Charge Code" : "Add Charge Code"}</DialogTitle>
            <DialogDescription>
              A posting code, classified by Subgroup — that&apos;s what every revenue and tax
              report groups by.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Code Identifier *</Label>
                <Input
                  required placeholder="e.g. MB, REST" className="uppercase"
                  disabled={!!editing?.isSystem}
                  value={form.code}
                  onChange={(e) => setForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
                />
                {editing?.isSystem && (
                  <p className="text-[11px] text-muted-foreground">System code — billing resolves against it, so it can&apos;t be renamed.</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Posting Type *</Label>
                <Select value={form.postingType} onValueChange={(v) => setForm((p) => ({ ...p, postingType: (v ?? "CHARGE") as PostingType }))}>
                  <SelectTrigger>
                    <SelectValue>{POSTING_TYPE_LABELS[form.postingType]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {POSTING_TYPES.map((t) => <SelectItem key={t} value={t}>{POSTING_TYPE_LABELS[t]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Description *</Label>
              <Input required placeholder="e.g. Mini Bar" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
            </div>

            <div className="space-y-2">
              <Label>Group / Subgroup *</Label>
              <SearchableSelect
                required
                value={form.chargeSubgroupId}
                onChange={(v) => setForm((p) => ({ ...p, chargeSubgroupId: v ?? "" }))}
                placeholder="Select Subgroup..."
                options={subgroupOptions}
              />
              <p className="text-[11px] text-muted-foreground">
                Decides the reporting bucket this code&apos;s revenue rolls up into. Manage the
                tree under Charge Groups above.
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox" className="h-4 w-4 rounded border-border"
                checked={form.isActive}
                onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))}
              />
              Active — offered when posting a charge
            </label>

            <div className="space-y-2 border-t pt-4">
              <Label>Tax</Label>
              {taxApplies ? (
                <>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="radio" name="taxMode"
                        checked={form.useDefaultTax}
                        onChange={() => setForm((p) => ({ ...p, useDefaultTax: true, taxProfileId: "" }))}
                      />
                      Default (Maldives Tax)
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="radio" name="taxMode"
                        checked={!form.useDefaultTax}
                        onChange={() => setForm((p) => ({ ...p, useDefaultTax: false }))}
                      />
                      Custom Tax
                    </label>
                  </div>
                  {!form.useDefaultTax && (
                    <SearchableSelect
                      required
                      value={form.taxProfileId}
                      onChange={(v) => setForm((p) => ({ ...p, taxProfileId: v ?? "" }))}
                      placeholder="Select Custom Tax"
                      options={taxProfiles.map((tp) => ({ label: tp.name, value: tp.id }))}
                    />
                  )}
                  {taxProfiles.length === 0 && !form.useDefaultTax && (
                    <p className="text-xs text-muted-foreground">No Custom Tax profiles yet — add one under Finance &gt; Tax &gt; Custom Tax first.</p>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  A Tax / Levy code posts at face value: it is never service-charged or GST&apos;d,
                  and stays out of the GST base on every report. Its rate comes from wherever
                  it&apos;s levied — for Green Tax, from Finance &gt; Tax &gt; Maldives Tax.
                </p>
              )}
            </div>

            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Generates */}
      <Dialog open={!!generatesFor} onOpenChange={(o) => { if (!o) { setGeneratesFor(null); fetchData() } }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Generates — {generatesFor?.code}</DialogTitle>
            <DialogDescription>
              Posting <strong>{generatesFor?.code}</strong> automatically posts each code
              below, in order. This is how Green Tax rides on the room charge — and how a
              bed tax or municipal levy is added without any code change.
            </DialogDescription>
          </DialogHeader>
          {generatesFor && (
            <ChargeCodeGeneratesEditor
              chargeCode={generatesFor}
              allCodes={chargeCodes}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Charge Code</DialogTitle>
            <DialogDescription>
              Delete <strong>{deleting?.code}</strong>? It can&apos;t be deleted if any folio
              line item is posted against it — deactivate it instead to retire it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
