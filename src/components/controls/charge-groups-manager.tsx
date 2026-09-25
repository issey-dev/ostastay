"use client"

import { useState, useEffect, useCallback } from "react"
import { Plus, Pencil, Trash2, Layers } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { MobileCard, MobileCardList } from "@/components/ui/mobile-card"
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
import { apiError } from "@/lib/api-error"
import { useConfirm } from "@/components/providers/confirm-provider"
import { SubmitButton } from "@/components/ui/submit-button"
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
export function ChargeGroupsManager({ propertyId, onChanged }: { propertyId: string; onChanged?: () => void }) {
  const confirm = useConfirm()
  const [groups, setGroups] = useState<ChargeGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<ChargeGroup | null>(null)
  const [groupForm, setGroupForm] = useState({ code: "", name: "", reportBucket: "OTHER" as ReportBucket, isRevenue: true })

  const [subDialogOpen, setSubDialogOpen] = useState(false)
  const [editingSub, setEditingSub] = useState<ChargeSubgroup | null>(null)
  const [subForm, setSubForm] = useState({ code: "", name: "", chargeGroupId: "" })

  const fetchGroups = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/charge-groups?propertyId=${propertyId}`)
      if (res.ok) setGroups(await res.json())
    } catch (e) {
      console.error("Failed to fetch charge groups", e)
    } finally {
      setLoading(false)
    }
  }, [propertyId])

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
        body: JSON.stringify(editingGroup ? groupForm : { ...groupForm, propertyId }),
      })
      if (res.ok) {
        setGroupDialogOpen(false)
        toast.success("Charge group saved")
        afterWrite()
      } else {
        toast.error(await apiError(res, "Couldn't save the charge group. Try again."))
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
        toast.success("Subgroup saved")
        afterWrite()
      } else {
        toast.error(await apiError(res, "Couldn't save the subgroup. Try again."))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const confirmDelete = async (deleting: { kind: "group" | "subgroup"; id: string; label: string }) => {
    const ok = await confirm({
      title: deleting.kind === "group" ? "Delete charge group?" : "Delete subgroup?",
      description: (
        <>
          Delete <strong>{deleting.label}</strong>? This is only possible while no charge
          codes are classified under it.
        </>
      ),
      confirmLabel: "Delete",
      destructive: true,
    })
    if (!ok) return
    const url = deleting.kind === "group" ? `/api/charge-groups/${deleting.id}` : `/api/charge-subgroups/${deleting.id}`
    const res = await fetch(url, { method: "DELETE" })
    if (res.ok) {
      toast.success(deleting.kind === "group" ? "Charge group deleted" : "Subgroup deleted")
      afterWrite()
    } else {
      toast.error(await apiError(res, "Couldn't delete. Try again."))
    }
  }

  if (loading) {
    return <div className="space-y-3"><Skeleton className="h-9 w-48" /><Skeleton className="h-64 rounded-xl" /></div>
  }

  return (
    <div className="w-full space-y-4">
      <div className="flex justify-end">
        <Button size="sm" className="shadow-sm" onClick={openGroupCreate}>
          <Plus className="w-4 h-4 mr-2" /> Add group
        </Button>
      </div>

      <ControlsSectionBody>
        {/* Phone view — a card per group, its subgroups nested inside so the hierarchy
            stays legible without a 4-column table squeezed onto a phone. */}
        <MobileCardList className="p-4" empty={<EmptyState icon={Layers} title="No charge groups configured" />}>
          {groups.map((g) => (
            <MobileCard
              key={g.id}
              title={g.name}
              subtitle={<span className="font-mono">{g.code}</span>}
              badge={g.isSystem ? <Badge variant="secondary" className="font-normal">System</Badge> : undefined}
              meta={[
                {
                  label: "Report bucket",
                  value: (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="font-normal">{REPORT_BUCKET_LABELS[g.reportBucket as ReportBucket] ?? g.reportBucket}</Badge>
                      {!g.isRevenue && <span className="text-xs font-normal text-muted-foreground">not revenue</span>}
                    </span>
                  ),
                },
                { label: "Charge codes", value: g.subgroups.reduce((n, s) => n + (s._count?.chargeCodes ?? 0), 0) },
              ]}
              actions={
                <>
                  <Button variant="outline" size="sm" className="h-9 flex-1" onClick={() => openSubCreate(g.id)}>
                    <Plus className="h-3.5 w-3.5 mr-1.5" /> Add subgroup
                  </Button>
                  <Button variant="outline" size="icon" className="h-9 w-9 text-primary" aria-label="Edit group" onClick={() => openGroupEdit(g)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline" size="icon"
                    className="h-9 w-9 text-destructive border-destructive/40 hover:bg-destructive-muted disabled:opacity-30"
                    disabled={g.isSystem}
                    aria-label={g.isSystem ? "System groups can't be deleted" : "Delete group"}
                    onClick={() => confirmDelete({ kind: "group", id: g.id, label: `${g.code} — ${g.name}` })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              }
            >
              {g.subgroups.length > 0 && (
                <div className="space-y-2">
                  {g.subgroups.map((s) => (
                    <div key={s.id} className="rounded-md bg-muted/40 p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 text-sm">
                          <span className="font-mono text-xs text-muted-foreground mr-1.5">{s.code}</span>
                          <span className="font-medium">{s.name}</span>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">{s._count?.chargeCodes ?? 0} codes</span>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="h-8 flex-1" onClick={() => openSubEdit(s)}>
                          <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                        </Button>
                        <Button
                          variant="outline" size="icon"
                          className="h-8 w-8 text-destructive border-destructive/40 hover:bg-destructive-muted disabled:opacity-30"
                          disabled={s.isSystem}
                          aria-label={s.isSystem ? "System subgroups can't be deleted" : "Delete subgroup"}
                          onClick={() => confirmDelete({ kind: "subgroup", id: s.id, label: `${s.code} — ${s.name}` })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </MobileCard>
          ))}
        </MobileCardList>

        <div className="hidden md:block overflow-x-auto">
        <Table>
          <TableHeader className="bg-muted/80">
            <TableRow>
              <TableHead>Group / Subgroup</TableHead>
              <TableHead>Reports as</TableHead>
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
                      onClick={() => confirmDelete({ kind: "group", id: g.id, label: `${g.code} — ${g.name}` })}
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
                        onClick={() => confirmDelete({ kind: "subgroup", id: s.id, label: `${s.code} — ${s.name}` })}
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
        </div>
      </ControlsSectionBody>

      {/* Group create / edit */}
      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{editingGroup ? "Edit charge group" : "Add charge group"}</DialogTitle>
            <DialogDescription>
              A group decides which reporting bucket everything beneath it rolls up into.
              System groups keep their code and bucket — rename them freely.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitGroup} className="space-y-4 mt-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                <Label>Reports as *</Label>
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
              <SubmitButton pending={submitting}>{editingGroup ? "Save" : "Create"}</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Subgroup create / edit */}
      <Dialog open={subDialogOpen} onOpenChange={setSubDialogOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{editingSub ? "Edit subgroup" : "Add subgroup"}</DialogTitle>
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
                  <SelectValue>{groups.find((g) => g.id === subForm.chargeGroupId)?.name ?? "Select group"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
              <SubmitButton pending={submitting}>{editingSub ? "Save" : "Create"}</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

    </div>
  )
}
