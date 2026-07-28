"use client"

import { useState, useEffect, useCallback } from "react"
import { Plus, Pencil, Trash2, Layers } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ControlsSectionBody } from "@/components/controls/controls-section-header"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/lib/toast"
import { REPORT_BUCKETS, REPORT_BUCKET_LABELS, type ReportBucket } from "@/lib/posting/charge-tree"

export type ChargeSubgroup = {
  id: string
  code: string
  name: string
  isSystem: boolean
  sortOrder: number
  chargeGroupId: string
  _count?: { chargeCodes: number }
}
export type ChargeGroup = {
  id: string
  code: string
  name: string
  reportBucket: string
  isRevenue: boolean
  isSystem: boolean
  sortOrder: number
  subgroups: ChargeSubgroup[]
}

// Levels 1 and 2 of the charge hierarchy, shown as one nested table because a subgroup
// is meaningless outside its group. The seven canonical groups are system-managed: their
// code and reporting bucket are locked (every revenue report keys off the bucket), but a
// property can rename them and add its own groups and subgroups alongside.
export function ChargeGroupsManager({ onChanged }: { onChanged?: () => void }) {
  const [groups, setGroups] = useState<ChargeGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<ChargeGroup | null>(null)
  const [groupForm, setGroupForm] = useState({ code: "", name: "", reportBucket: "OTHER" as ReportBucket, isRevenue: true })

  const [subDialogOpen, setSubDialogOpen] = useState(false)
  const [editingSub, setEditingSub] = useState<ChargeSubgroup | null>(null)
  const [subForm, setSubForm] = useState({ code: "", name: "", chargeGroupId: "" })

  const [deleting, setDeleting] = useState<{ kind: "group" | "subgroup"; id: string; label: string } | null>(null)

  const fetchGroups = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/charge-groups")
      if (res.ok) setGroups(await res.json())
    } catch (e) {
      console.error("Failed to fetch charge groups", e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchGroups() }, [fetchGroups])

  const afterWrite = () => { fetchGroups(); onChanged?.() }

  const openGroupCreate = () => {
    setEditingGroup(null)
    setGroupForm({ code: "", name: "", reportBucket: "OTHER", isRevenue: true })
    setGroupDialogOpen(true)
  }
  const openGroupEdit = (g: ChargeGroup) => {
    setEditingGroup(g)
    setGroupForm({ code: g.code, name: g.name, reportBucket: g.reportBucket as ReportBucket, isRevenue: g.isRevenue })
    setGroupDialogOpen(true)
  }

  const submitGroup = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const res = await fetch(editingGroup ? `/api/charge-groups/${editingGroup.id}` : "/api/charge-groups", {
        method: editingGroup ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(groupForm),
      })
      if (res.ok) {
        setGroupDialogOpen(false)
        afterWrite()
      } else {
        toast.error((await res.json().catch(() => null))?.error || "Failed to save charge group")
      }
    } finally {
      setSubmitting(false)
    }
  }

  const openSubCreate = (groupId: string) => {
    setEditingSub(null)
    setSubForm({ code: "", name: "", chargeGroupId: groupId })
    setSubDialogOpen(true)
  }
  const openSubEdit = (s: ChargeSubgroup) => {
    setEditingSub(s)
    setSubForm({ code: s.code, name: s.name, chargeGroupId: s.chargeGroupId })
    setSubDialogOpen(true)
  }

  const submitSub = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const res = await fetch(editingSub ? `/api/charge-subgroups/${editingSub.id}` : "/api/charge-subgroups", {
        method: editingSub ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subForm),
      })
      if (res.ok) {
        setSubDialogOpen(false)
        afterWrite()
      } else {
        toast.error((await res.json().catch(() => null))?.error || "Failed to save subgroup")
      }
    } finally {
      setSubmitting(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    const url = deleting.kind === "group" ? `/api/charge-groups/${deleting.id}` : `/api/charge-subgroups/${deleting.id}`
    const res = await fetch(url, { method: "DELETE" })
    if (res.ok) {
      setDeleting(null)
      afterWrite()
    } else {
      toast.error((await res.json().catch(() => null))?.error || "Failed to delete")
    }
  }

  if (loading) {
    return <div className="space-y-3"><Skeleton className="h-9 w-48" /><Skeleton className="h-64 rounded-xl" /></div>
  }

  return (
    <div className="w-full space-y-4">
      <div className="flex justify-end">
        <Button size="sm" className="shadow-sm" onClick={openGroupCreate}>
          <Plus className="w-4 h-4 mr-2" /> Add Group
        </Button>
      </div>

      <ControlsSectionBody>
        <Table>
          <TableHeader className="bg-muted/80">
            <TableRow>
              <TableHead>Group / Subgroup</TableHead>
              <TableHead>Reports As</TableHead>
              <TableHead>Codes</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => [
              <TableRow key={g.id} className="bg-muted/30 hover:bg-muted/50">
                <TableCell className="font-medium">
                  <span className="font-mono text-xs text-muted-foreground mr-2">{g.code}</span>
                  {g.name}
                  {g.isSystem && <Badge variant="secondary" className="ml-2 font-normal">System</Badge>}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-normal">{REPORT_BUCKET_LABELS[g.reportBucket as ReportBucket] ?? g.reportBucket}</Badge>
                  {!g.isRevenue && <span className="ml-2 text-xs text-muted-foreground">not revenue</span>}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {g.subgroups.reduce((n, s) => n + (s._count?.chargeCodes ?? 0), 0)}
                </TableCell>
                <TableCell className="text-right px-6">
                  <div className="flex gap-1 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => openSubCreate(g.id)} title="Add subgroup">
                      <Plus className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="text-primary hover:bg-muted" onClick={() => openGroupEdit(g)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost" size="sm"
                      className="text-destructive hover:bg-destructive-muted disabled:opacity-30"
                      disabled={g.isSystem}
                      title={g.isSystem ? "System groups can't be deleted" : "Delete group"}
                      onClick={() => setDeleting({ kind: "group", id: g.id, label: `${g.code} — ${g.name}` })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>,
              ...g.subgroups.map((s) => (
                <TableRow key={s.id} className="hover:bg-muted/50">
                  <TableCell className="pl-10 text-sm">
                    <span className="font-mono text-xs text-muted-foreground mr-2">{s.code}</span>
                    {s.name}
                  </TableCell>
                  <TableCell />
                  <TableCell className="text-muted-foreground text-sm">{s._count?.chargeCodes ?? 0}</TableCell>
                  <TableCell className="text-right px-6">
                    <div className="flex gap-1 justify-end">
                      <Button variant="ghost" size="sm" className="text-primary hover:bg-muted" onClick={() => openSubEdit(s)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        className="text-destructive hover:bg-destructive-muted disabled:opacity-30"
                        disabled={s.isSystem}
                        title={s.isSystem ? "System subgroups can't be deleted" : "Delete subgroup"}
                        onClick={() => setDeleting({ kind: "subgroup", id: s.id, label: `${s.code} — ${s.name}` })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )),
            ])}
            {groups.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-0">
                  <EmptyState icon={Layers} title="No charge groups configured" />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ControlsSectionBody>

      {/* Group create / edit */}
      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingGroup ? "Edit Charge Group" : "Add Charge Group"}</DialogTitle>
            <DialogDescription>
              A group decides which reporting bucket everything beneath it rolls up into.
              System groups keep their code and bucket — rename them freely.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitGroup} className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Code *</Label>
                <Input
                  required className="uppercase" placeholder="e.g. WELLNESS"
                  disabled={!!editingGroup?.isSystem}
                  value={groupForm.code}
                  onChange={(e) => setGroupForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Reports As *</Label>
                <Select
                  value={groupForm.reportBucket}
                  onValueChange={(v) => setGroupForm((p) => ({ ...p, reportBucket: (v ?? "OTHER") as ReportBucket }))}
                  disabled={!!editingGroup?.isSystem}
                >
                  <SelectTrigger>
                    <SelectValue>{REPORT_BUCKET_LABELS[groupForm.reportBucket]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {REPORT_BUCKETS.map((b) => <SelectItem key={b} value={b}>{REPORT_BUCKET_LABELS[b]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input required placeholder="e.g. Wellness" value={groupForm.name} onChange={(e) => setGroupForm((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border"
                disabled={!!editingGroup?.isSystem}
                checked={groupForm.isRevenue}
                onChange={(e) => setGroupForm((p) => ({ ...p, isRevenue: e.target.checked }))}
              />
              Counts as earned revenue
            </label>
            <p className="text-xs text-muted-foreground">
              Leave unticked for pass-through money — taxes collected for the government,
              commissions, deposits — so it never inflates revenue reporting.
            </p>
            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setGroupDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Subgroup create / edit */}
      <Dialog open={subDialogOpen} onOpenChange={setSubDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSub ? "Edit Subgroup" : "Add Subgroup"}</DialogTitle>
            <DialogDescription>
              A subgroup is a reporting split inside its group — it carries no bucket of
              its own, so adding one never changes how revenue rolls up.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitSub} className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Group *</Label>
              <Select
                value={subForm.chargeGroupId}
                onValueChange={(v) => setSubForm((p) => ({ ...p, chargeGroupId: v ?? "" }))}
                disabled={!!editingSub?.isSystem}
              >
                <SelectTrigger>
                  <SelectValue>{groups.find((g) => g.id === subForm.chargeGroupId)?.name ?? "Select Group"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Code *</Label>
                <Input
                  required className="uppercase" placeholder="e.g. POOL_BAR"
                  disabled={!!editingSub?.isSystem}
                  value={subForm.code}
                  onChange={(e) => setSubForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Name *</Label>
                <Input required placeholder="e.g. Pool Bar" value={subForm.name} onChange={(e) => setSubForm((p) => ({ ...p, name: e.target.value }))} />
              </div>
            </div>
            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setSubDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete {deleting?.kind === "group" ? "Charge Group" : "Subgroup"}</DialogTitle>
            <DialogDescription>
              Delete <strong>{deleting?.label}</strong>? This is only possible while no charge
              codes are classified under it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={confirmDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
