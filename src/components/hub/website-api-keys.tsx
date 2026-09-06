"use client"

import { useCallback, useEffect, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { EmptyState } from "@/components/ui/empty-state"
import { ErrorState } from "@/components/ui/error-state"
import { Skeleton } from "@/components/ui/skeleton"
import { useConfirm } from "@/components/providers/confirm-provider"
import { toast } from "@/lib/toast"
import { Key, Plus, Pencil, RefreshCw, Ban, Check } from "@/components/icons"

type KeyRow = {
  id: string
  name: string
  keyPrefix: string
  status: string
  isExpired: boolean
  allowedOrigins: string[]
  expiresAt: string | null
  lastUsedAt: string | null
  createdAt: string
  revokedAt: string | null
  createdBy: string | null
  properties: { id: string; name: string }[]
  bookingCount: number
}

type PropertyOption = { id: string; name: string; code: string }

const keySchema = z.object({
  name: z.string().trim().min(1, "Give the key a name — usually the website it belongs to"),
  propertyIds: z.array(z.string()).min(1, "Choose at least one property"),
  // One origin per line; validated properly server-side (normalizeOrigins).
  allowedOrigins: z.string(),
  expiresAt: z.string(),
})
type KeyFormValues = z.infer<typeof keySchema>

const emptyValues: KeyFormValues = { name: "", propertyIds: [], allowedOrigins: "", expiresAt: "" }

function formatDateTime(iso: string | null) {
  if (!iso) return "Never"
  return new Date(iso).toLocaleString()
}

// A key is shown exactly once — in this dialog, right after it is minted or rotated. Once
// closed there is no way to see it again (only the hash is stored), which is the point.
function RevealKeyDialog({ reveal, onClose }: { reveal: { key: string; title: string; note: string } | null; onClose: () => void }) {
  // Remounted per key by the parent (see the `key` prop where it is rendered), so this
  // resets naturally without an effect.
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reveal?.key ?? "")
      setCopied(true)
      toast.success("Key copied")
    } catch {
      toast.error("Couldn't copy — select the key and copy it manually")
    }
  }
  return (
    <Dialog open={!!reveal} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{reveal?.title}</DialogTitle>
          <DialogDescription>{reveal?.note}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="rounded-md border border-border bg-muted/40 p-3 font-mono text-xs break-all select-all">{reveal?.key}</div>
          <p className="text-sm text-destructive">
            Copy this key now. It is shown only once and cannot be recovered — if it is lost, rotate the key.
          </p>
          <p className="text-xs text-muted-foreground">
            Send it as <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>. Keep it on the website&apos;s
            server; never put it in page source. See <code className="font-mono">docs/WEBSITE_API.md</code>.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={copy}>
            {copied ? <Check className="mr-1.5 h-4 w-4" /> : null}
            {copied ? "Copied" : "Copy key"}
          </Button>
          <Button onClick={onClose}>I have saved it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function WebsiteApiKeys({ canCreate, canManage, canRevoke }: { canCreate: boolean; canManage: boolean; canRevoke: boolean }) {
  const confirm = useConfirm()
  const [rows, setRows] = useState<KeyRow[]>([])
  const [properties, setProperties] = useState<PropertyOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<KeyRow | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reveal, setReveal] = useState<{ key: string; title: string; note: string } | null>(null)

  const form = useForm<KeyFormValues>({ resolver: zodResolver(keySchema), mode: "onChange", defaultValues: emptyValues })

  const load = useCallback(async () => {
    setError(false)
    try {
      const res = await fetch("/api/hub/website/keys")
      if (!res.ok) throw new Error()
      const data = await res.json()
      setRows(data.keys ?? [])
      setProperties(data.properties ?? [])
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setServerError(null)
    form.reset({ ...emptyValues, propertyIds: properties.length === 1 ? [properties[0].id] : [] })
    setDialogOpen(true)
  }

  const openEdit = (row: KeyRow) => {
    setEditing(row)
    setServerError(null)
    form.reset({
      name: row.name,
      propertyIds: row.properties.map((p) => p.id),
      allowedOrigins: row.allowedOrigins.join("\n"),
      expiresAt: row.expiresAt ? row.expiresAt.slice(0, 10) : "",
    })
    setDialogOpen(true)
  }

  const onSubmit = async (values: KeyFormValues) => {
    setSubmitting(true)
    setServerError(null)
    try {
      const payload = {
        name: values.name,
        propertyIds: values.propertyIds,
        allowedOrigins: values.allowedOrigins.split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean),
        expiresAt: values.expiresAt ? new Date(`${values.expiresAt}T23:59:59.000Z`).toISOString() : null,
      }
      const res = await fetch(editing ? `/api/hub/website/keys/${editing.id}` : "/api/hub/website/keys", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setServerError(typeof body?.error === "string" ? body.error : "Couldn't save the key")
        return
      }
      setDialogOpen(false)
      await load()
      if (!editing && body?.key) {
        setReveal({ key: body.key, title: `Key created: ${body.row?.name ?? values.name}`, note: "Give this to whoever builds the website." })
      } else {
        toast.success("Key updated")
      }
    } finally {
      setSubmitting(false)
    }
  }

  const rotate = async (row: KeyRow) => {
    if (!(await confirm({
      title: `Rotate "${row.name}"?`,
      description: "A new key is issued and the current one stops working immediately. The website must be updated with the new key before it can make bookings again.",
      confirmLabel: "Rotate key",
      destructive: true,
    }))) return
    setBusyId(row.id)
    try {
      const res = await fetch(`/api/hub/website/keys/${row.id}/rotate`, { method: "POST" })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(typeof body?.error === "string" ? body.error : "Couldn't rotate the key")
        return
      }
      await load()
      setReveal({ key: body.key, title: `Key rotated: ${row.name}`, note: "The previous key has stopped working." })
    } finally {
      setBusyId(null)
    }
  }

  const revoke = async (row: KeyRow) => {
    if (!(await confirm({
      title: `Revoke "${row.name}"?`,
      description: "The website using this key loses access immediately and permanently. Bookings it already made are unaffected. This cannot be undone — create a new key to restore access.",
      confirmLabel: "Revoke key",
      destructive: true,
    }))) return
    setBusyId(row.id)
    try {
      const res = await fetch(`/api/hub/website/keys/${row.id}`, { method: "DELETE" })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        toast.error(typeof body?.error === "string" ? body.error : "Couldn't revoke the key")
        return
      }
      toast.success("Key revoked")
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const statusBadge = (row: KeyRow) => {
    if (row.status === "REVOKED") return <Badge variant="destructive">Revoked</Badge>
    if (row.isExpired) return <Badge variant="secondary">Expired</Badge>
    return <Badge variant="default">Active</Badge>
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>API keys</CardTitle>
            <CardDescription>
              One key per website. A key may cover one property or several — the site can only see and book the
              properties on its list. Only the first characters are kept here; the full key is shown once, when created.
            </CardDescription>
          </div>
          {canCreate && (
            <Button onClick={openCreate} className="shrink-0 shadow-sm">
              <Plus className="mr-2 h-4 w-4" /> New key
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : error ? (
            <ErrorState title="Couldn't load API keys" onRetry={load} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Key}
              title="No API keys yet"
              description="Create a key for each brand website, then configure what each property sells under the Properties tab."
            />
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {rows.map((r) => (
                  <div key={r.id} className="space-y-2 rounded-md border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium">{r.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{r.keyPrefix}…</div>
                      </div>
                      {statusBadge(r)}
                    </div>
                    <div className="text-sm text-muted-foreground">{r.properties.map((p) => p.name).join(", ")}</div>
                    <div className="text-xs text-muted-foreground">
                      Last used {formatDateTime(r.lastUsedAt)} · {r.bookingCount} booking{r.bookingCount === 1 ? "" : "s"}
                    </div>
                    {r.status === "ACTIVE" && (canManage || canRevoke) && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {canManage && (
                          <Button variant="outline" size="sm" className="h-9 flex-1" onClick={() => openEdit(r)}>
                            <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                          </Button>
                        )}
                        {canManage && (
                          <Button variant="outline" size="sm" className="h-9 flex-1" disabled={busyId === r.id} onClick={() => rotate(r)}>
                            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Rotate
                          </Button>
                        )}
                        {canRevoke && (
                          <Button variant="outline" size="sm" className="h-9 flex-1 text-destructive hover:text-destructive" disabled={busyId === r.id} onClick={() => revoke(r)}>
                            <Ban className="mr-1.5 h-3.5 w-3.5" /> Revoke
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="hidden overflow-x-auto md:-mx-6 md:-mb-6 md:block md:border-t md:border-border">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="px-6">Key</TableHead>
                      <TableHead>Properties</TableHead>
                      <TableHead>Origins</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last used</TableHead>
                      <TableHead>Bookings</TableHead>
                      {(canManage || canRevoke) && <TableHead className="px-6 text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="px-6">
                          <div className="font-medium">{r.name}</div>
                          <div className="font-mono text-xs text-muted-foreground">{r.keyPrefix}…</div>
                          <div className="text-xs text-muted-foreground">
                            Created {new Date(r.createdAt).toLocaleDateString()}
                            {r.createdBy ? ` by ${r.createdBy}` : ""}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.properties.map((p) => p.name).join(", ")}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.allowedOrigins.length === 0 ? <span title="Server-to-server only">Server only</span> : r.allowedOrigins.join(", ")}
                        </TableCell>
                        <TableCell>
                          {statusBadge(r)}
                          {r.expiresAt && r.status === "ACTIVE" && (
                            <div className="mt-1 text-xs text-muted-foreground">Expires {new Date(r.expiresAt).toLocaleDateString()}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">{formatDateTime(r.lastUsedAt)}</TableCell>
                        <TableCell className="text-sm tabular-nums">{r.bookingCount}</TableCell>
                        {(canManage || canRevoke) && (
                          <TableCell className="space-x-1 px-6 text-right">
                            {r.status === "ACTIVE" && canManage && (
                              <Button variant="ghost" size="icon" aria-label="Edit key" onClick={() => openEdit(r)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                            {r.status === "ACTIVE" && canManage && (
                              <Button variant="ghost" size="icon" aria-label="Rotate key" disabled={busyId === r.id} onClick={() => rotate(r)}>
                                <RefreshCw className="h-4 w-4" />
                              </Button>
                            )}
                            {r.status === "ACTIVE" && canRevoke && (
                              <Button variant="ghost" size="icon" aria-label="Revoke key" className="text-destructive hover:text-destructive" disabled={busyId === r.id} onClick={() => revoke(r)}>
                                <Ban className="h-4 w-4" />
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <DialogHeader>
                <DialogTitle>{editing ? "Edit key" : "New API key"}</DialogTitle>
                <DialogDescription>
                  {editing
                    ? "Change what this key may access. To change the key itself, use Rotate."
                    : "The key is shown once after you save it — have somewhere safe ready to paste it."}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name *</FormLabel>
                    <FormControl><Input placeholder="e.g. www.hotel.com" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="propertyIds" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Properties *</FormLabel>
                    <div className="space-y-2 rounded-md border border-border p-3">
                      {properties.length === 0 && <p className="text-sm text-muted-foreground">No active properties.</p>}
                      {properties.map((p) => {
                        const checked = field.value.includes(p.id)
                        return (
                          <label key={p.id} className="flex cursor-pointer items-center gap-3 text-sm">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) => {
                                const next = v ? [...field.value, p.id] : field.value.filter((id) => id !== p.id)
                                field.onChange(next)
                              }}
                            />
                            <span>{p.name}</span>
                            <span className="font-mono text-xs text-muted-foreground">{p.code}</span>
                          </label>
                        )
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground">The website can only see and book the properties ticked here.</p>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="allowedOrigins" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Browser origins (optional)</FormLabel>
                    <FormControl>
                      <Textarea rows={2} placeholder={"https://www.hotel.com\nhttps://booking.hotel.com"} {...field} />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      Only needed if the website calls the API directly from the visitor&apos;s browser. Leave empty for the
                      recommended server-to-server setup, where the key never leaves the website&apos;s server.
                    </p>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="expiresAt" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Expires (optional)</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {serverError && <p className="text-sm text-destructive">{serverError}</p>}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={submitting}>{submitting ? "Saving..." : editing ? "Save changes" : "Create key"}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <RevealKeyDialog key={reveal?.key ?? "none"} reveal={reveal} onClose={() => setReveal(null)} />
    </>
  )
}
