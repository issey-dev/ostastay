"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { useConfirm } from "@/components/providers/confirm-provider"
import { usePermissions } from "@/hooks/use-permissions"
import { toast } from "@/lib/toast"
import { apiError } from "@/lib/api-error"
import { INPUT_EMAIL } from "@/lib/input-presets"

// Group billing on a block (Agent Portal plan A-23, §7; Phase 8): the group's documents in
// one PDF (download or email), an Advance Folio for every in-house pickup in one step, and a
// rooming-list import. Each button is shown only to roles that may use it.

type Result = { confirmationNo: string; guest: string; ok: boolean; amountPosted?: number; error?: string }

export function GroupBillingPanel({ groupId, onChanged }: { groupId: string; onChanged: () => void }) {
  const confirm = useConfirm()
  const { can, has } = usePermissions()
  const [busy, setBusy] = useState(false)
  const [sendOpen, setSendOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [message, setMessage] = useState("")
  const [results, setResults] = useState<{ title: string; rows: Result[] } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [csv, setCsv] = useState("firstName,lastName,checkIn,checkOut,roomTypeCode,adults,children,email,tentative\n")

  const advanceAll = async () => {
    if (!(await confirm({
      title: "Advance Folio for the whole group?",
      description: "Every in-house pickup's remaining nights are posted today, each to the folio it bills to (the master or its own). Pickups not in house are skipped.",
      confirmLabel: "Post",
    }))) return
    setBusy(true)
    try {
      const res = await fetch(`/api/groups/${groupId}/advance-folio`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || "Couldn't post the Advance Folio.")
        return
      }
      setResults({ title: `Advance Folio: ${data.posted} posted`, rows: data.results })
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const send = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/groups/${groupId}/documents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, message }) })
      if (!res.ok) {
        toast.error(await apiError(res, "Couldn't send the documents."))
        return
      }
      toast.success(`Group statement sent to ${email}`)
      setSendOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const importList = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/groups/${groupId}/rooming-list`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || "Couldn't import the list.")
        return
      }
      setImportOpen(false)
      setResults({
        title: `Rooming list: ${data.added} added`,
        rows: data.results.map((r: { line: number; ok: boolean; confirmationNo?: string; error?: string }) => ({ confirmationNo: r.confirmationNo ?? `Line ${r.line}`, guest: "", ok: r.ok, error: r.error })),
      })
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const canCashier = can("CASHIERING", "update")
  return (
    <Card className="shadow-elevation-1">
      <CardHeader className="py-4">
        <CardTitle className="text-lg">Group billing</CardTitle>
        <CardDescription>The group&rsquo;s statement in one PDF, the whole group&rsquo;s Advance Folio, and importing a rooming list.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {can("CASHIERING", "view") && (
          <Button variant="outline" size="sm" onClick={() => window.open(`/api/groups/${groupId}/documents`, "_blank")}>Download group statement</Button>
        )}
        {canCashier && <Button variant="outline" size="sm" onClick={() => setSendOpen(true)}>Send documents</Button>}
        {canCashier && has("billing.advanceFolio") && <Button variant="outline" size="sm" disabled={busy} onClick={advanceAll}>Advance Folio for the group</Button>}
        {can("GROUP_BLOCKS", "update") && <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>Import rooming list</Button>}
      </CardContent>

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent size="sm" mobile="sheet">
          <DialogHeader>
            <DialogTitle>Send the group&rsquo;s documents</DialogTitle>
            <DialogDescription>One PDF: the master folio, every guest&rsquo;s folio, and the group total.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="gd-email">Email</Label>
              <Input id="gd-email" {...INPUT_EMAIL} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gd-msg">Message</Label>
              <Textarea id="gd-msg" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendOpen(false)}>Cancel</Button>
            <Button disabled={busy || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)} onClick={send}>Send</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent size="lg" mobile="fullscreen">
          <DialogHeader>
            <DialogTitle>Import a rooming list</DialogTitle>
            <DialogDescription>Paste lines under the header row (dates as yyyy-mm-dd, the room type&rsquo;s code). Each line is checked like a single pickup; bad lines are listed and the rest are added.</DialogDescription>
          </DialogHeader>
          <Textarea rows={12} value={csv} onChange={(e) => setCsv(e.target.value)} className="font-mono text-xs" aria-label="Rooming list" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button disabled={busy || csv.trim().split(/\r?\n/).length < 2} onClick={importList}>Import</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!results} onOpenChange={(o) => !o && setResults(null)}>
        <DialogContent size="md" mobile="sheet">
          <DialogHeader>
            <DialogTitle>{results?.title}</DialogTitle>
          </DialogHeader>
          <ul className="max-h-80 divide-y divide-border overflow-y-auto text-sm">
            {results?.rows.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate">{r.confirmationNo}{r.guest ? ` · ${r.guest}` : ""}</span>
                <span className={r.ok ? "text-success" : "text-muted-foreground"}>{r.ok ? (r.amountPosted !== undefined ? r.amountPosted.toFixed(2) : "Added") : r.error}</span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button onClick={() => setResults(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
