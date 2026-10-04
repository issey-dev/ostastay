"use client"

import { useEffect, useMemo, useState } from "react"
import { Pencil, Plus, X, ArrowRightLeft, CheckCircle2, XCircle, RotateCcw, Ship, AlertTriangle } from "@/components/icons"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { InlineLoading } from "@/components/ui/inline-loading"
import { EmptyState } from "@/components/ui/empty-state"
import { ContactLink } from "@/components/ui/contact-link"
import { MobileActions, type MobileAction } from "@/components/ui/mobile"
import { useConfirm } from "@/components/providers/confirm-provider"
import { toast } from "@/lib/toast"
import { DIRECTION_LABELS, label } from "@/lib/transport/constants"
import { cn } from "@/lib/utils"
import {
  api,
  AttentionBadge,
  BookingStatus,
  GroupTag,
  ManifestStatus,
  dayLabel,
  flightLabel,
  paxLabel,
  type BookingView,
  type ManifestView,
} from "@/components/transport/shared"
import type { TransportPerms } from "@/components/transport/booking-panel"

// A departure's panel — the dispatch view of one boat: who is on it (with flights and
// warnings), seats used against the vessel's capacity, and the moves dispatch makes all day:
// add guests (search by name, reservation, flight or group; select many), take one off,
// move one to another departure, and the departure's own status.

export function ManifestPanel({
  manifestId,
  onOpenChange,
  propertyId,
  perms,
  onChanged,
  onEdit,
  onOpenBooking,
}: {
  manifestId: string | null
  onOpenChange: (open: boolean) => void
  propertyId: string
  perms: TransportPerms
  onChanged: () => void
  onEdit: (m: ManifestView) => void
  onOpenBooking: (id: string) => void
}) {
  const confirm = useConfirm()
  const [m, setM] = useState<ManifestView | null>(null)
  const [others, setOthers] = useState<ManifestView[]>([])
  const [candidates, setCandidates] = useState<BookingView[]>([])
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState("")
  const [group, setGroup] = useState("")
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const load = async (id: string) => {
    try {
      const mv = await api<ManifestView>(`/api/transport/manifests/${id}?propertyId=${propertyId}`)
      setM(mv)
      const [day, unassigned] = await Promise.all([
        api<ManifestView[]>(`/api/transport/manifests?propertyId=${propertyId}&from=${mv.serviceDate}&to=${mv.serviceDate}&direction=${mv.direction}`),
        api<{ items: BookingView[] }>(`/api/transport/bookings?propertyId=${propertyId}&from=${mv.serviceDate}&to=${mv.serviceDate}&direction=${mv.direction}`),
      ])
      setOthers(day.filter((x) => x.id !== id && x.status !== "CANCELLED" && x.status !== "COMPLETED"))
      setCandidates(unassigned.items.filter((b) => b.manifest?.id !== id && b.status !== "CANCELLED" && b.status !== "NO_SHOW"))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  useEffect(() => {
    if (!manifestId) return
    setM(null)
    setAdding(false)
    setPicked(new Set())
    setSearch("")
    setGroup("")
    load(manifestId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifestId, propertyId])

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    if (!manifestId) return
    setBusy(true)
    try {
      await fn()
      toast.success(ok)
      await load(manifestId)
      onChanged()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const change = (action: "ATTACH" | "DETACH" | "KEEP", bookingIds: string[], target = manifestId) =>
    api(`/api/transport/manifests/${target}/bookings?propertyId=${propertyId}`, { method: "POST", json: { action, bookingIds } })

  const setStatus = async (status: string) => {
    if (status === "CANCELLED") {
      const ok = await confirm({
        title: "Cancel this departure?",
        description: "Its passengers are taken off and stay booked, ready to put on another departure.",
        confirmLabel: "Cancel departure",
        destructive: true,
      })
      if (!ok) return
    }
    await act(async () => {
      const r = await api<{ cascade: { completed: number; released: number } }>(`/api/transport/manifests/${manifestId}?propertyId=${propertyId}`, { method: "PATCH", json: { status } })
      if (r.cascade.released) toast.info(`${r.cascade.released} booking(s) released — put them on another departure.`)
    }, "Departure updated")
  }

  const groups = useMemo(() => {
    const map = new Map<string, { id: string; code: string; name: string }>()
    candidates.forEach((b) => b.groupBlock && map.set(b.groupBlock.id, b.groupBlock))
    return [...map.values()]
  }, [candidates])
  const filtered = candidates.filter((b) => {
    if (group && b.groupBlock?.id !== group) return false
    const q = search.trim().toLowerCase()
    if (!q) return true
    return [b.guestName, b.reservation?.confirmationNo, b.flightNo, b.groupBlock?.code, b.groupBlock?.name].some((s) => s?.toLowerCase().includes(q))
  })

  const statusActions: MobileAction[] = []
  if (m && perms.manageManifests) {
    if (m.status === "OPEN") statusActions.push({ label: "Confirm", icon: CheckCircle2, onSelect: () => setStatus("CONFIRMED") })
    if (m.status === "OPEN" || m.status === "CONFIRMED") statusActions.push({ label: "Departed", icon: Ship, onSelect: () => setStatus("DEPARTED") })
    if (m.status !== "COMPLETED" && m.status !== "CANCELLED") statusActions.push({ label: "Completed", icon: CheckCircle2, onSelect: () => setStatus("COMPLETED") })
    if (m.status === "CANCELLED") statusActions.push({ label: "Reopen", icon: RotateCcw, onSelect: () => setStatus("OPEN") })
    if (m.status === "OPEN" || m.status === "CONFIRMED") statusActions.push({ label: "Cancel departure", icon: XCircle, onSelect: () => setStatus("CANCELLED"), destructive: true })
  }
  const editable = m && perms.manageManifests && m.status !== "COMPLETED" && m.status !== "CANCELLED"

  return (
    <Sheet open={!!manifestId} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto data-[side=right]:sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2 pr-8">
            {m ? `${m.departureLocal.time} · ${m.route.name}` : "Departure"}
            {m && <ManifestStatus status={m.status} />}
          </SheetTitle>
          <SheetDescription>
            {m
              ? `${m.reference} · ${label(DIRECTION_LABELS, m.direction)} · ${dayLabel(m.serviceDate, { weekday: "short", day: "2-digit", month: "short" })} · ${m.route.from.code} → ${m.route.to.code}`
              : "Loading…"}
          </SheetDescription>
        </SheetHeader>
        {!m ? (
          <div className="p-4">
            <InlineLoading />
          </div>
        ) : (
          <div className="space-y-5 px-4 pb-6">
            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <div>
                <div className="text-xs text-muted-foreground">Passengers</div>
                <div className={cn("text-lg font-semibold tabular-nums", m.capacityState === "OVER" && "text-destructive")}>
                  {m.pax}
                  {m.capacity ? <span className="text-sm font-normal text-muted-foreground"> / {m.capacity} seats</span> : null}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Vessel</div>
                <div>{m.vessel?.name ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Provider</div>
                <div>{m.provider?.name ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Driver / captain</div>
                <div>
                  {m.driverName ?? "—"} {m.driverContact && <ContactLink type="phone" value={m.driverContact} />}
                </div>
              </div>
            </div>
            {m.capacityState === "OVER" && (
              <p className="flex items-center gap-2 border border-destructive/40 bg-destructive-muted p-2 text-sm text-destructive" role="status">
                <AlertTriangle className="h-4 w-4" /> {m.pax - (m.capacity ?? 0)} over the vessel&apos;s seats — saved anyway; move someone or change the vessel.
              </p>
            )}
            {m.notes && <p className="text-sm text-muted-foreground">{m.notes}</p>}

            <div className="flex flex-wrap gap-2 max-md:hidden">
              {editable && (
                <Button variant="outline" size="sm" onClick={() => onEdit(m)} disabled={busy}>
                  <Pencil className="mr-1.5 h-4 w-4" /> Edit
                </Button>
              )}
              {editable && (
                <Button variant="outline" size="sm" onClick={() => setAdding((a) => !a)} disabled={busy}>
                  <Plus className="mr-1.5 h-4 w-4" /> Add passengers
                </Button>
              )}
              {statusActions.map((a) => (
                <Button key={a.label} variant="outline" size="sm" onClick={a.onSelect} disabled={busy} className={a.destructive ? "text-destructive hover:text-destructive" : undefined}>
                  {a.icon && <a.icon className="mr-1.5 h-4 w-4" />} {a.label}
                </Button>
              ))}
            </div>
            <MobileActions
              className="md:hidden"
              primary={
                editable ? (
                  <Button variant="outline" className="h-11" onClick={() => setAdding((a) => !a)} disabled={busy}>
                    <Plus className="mr-1.5 h-4 w-4" /> Add passengers
                  </Button>
                ) : undefined
              }
              more={[...(editable ? [{ label: "Edit departure", icon: Pencil, onSelect: () => onEdit(m) }] : []), ...statusActions]}
            />

            {adding && editable && (
              <section className="space-y-2 border border-border p-3">
                <div className="flex flex-wrap gap-2">
                  <Input className="min-w-0 flex-1" placeholder="Name, reservation, flight or group" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search bookings" />
                  {groups.length > 0 && (
                    <OptionSelect className="w-44" value={group} onChange={setGroup} options={[{ value: "", label: "All groups" }, ...groups.map((g) => ({ value: g.id, label: g.code }))]} aria-label="Group block" />
                  )}
                </div>
                <div className="max-h-64 divide-y divide-border overflow-y-auto">
                  {filtered.length === 0 ? (
                    <p className="p-3 text-sm text-muted-foreground">No other {label(DIRECTION_LABELS, m.direction).toLowerCase()}s on this day.</p>
                  ) : (
                    filtered.map((b) => (
                      <label key={b.id} className="flex cursor-pointer items-center gap-3 px-2 py-2.5 text-sm hover:bg-muted/50">
                        <Checkbox
                          checked={picked.has(b.id)}
                          onCheckedChange={(c) =>
                            setPicked((s) => {
                              const n = new Set(s)
                              if (c) n.add(b.id)
                              else n.delete(b.id)
                              return n
                            })
                          }
                        />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{b.guestName}</span> <GroupTag group={b.groupBlock} />
                          <span className="block text-xs text-muted-foreground">
                            {b.reservation?.confirmationNo ?? "No stay"} · {b.pax} pax{b.flightNo ? ` · ${flightLabel(b)}` : ""}
                            {b.manifest ? ` · on ${b.manifest.departureLocal.time}` : " · unassigned"}
                          </span>
                        </span>
                      </label>
                    ))
                  )}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {filtered.length > 0 && (
                    <Button variant="ghost" size="sm" onClick={() => setPicked(new Set(filtered.map((b) => b.id)))}>
                      Select all {filtered.length}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    disabled={picked.size === 0 || busy}
                    onClick={() => act(() => change("ATTACH", [...picked]).then(() => setPicked(new Set())), `Added ${picked.size} booking(s)`)}
                  >
                    Add {picked.size || ""} to this departure
                  </Button>
                </div>
              </section>
            )}

            <section>
              <h3 className="mb-2 text-sm font-medium">
                Passengers <span className="text-muted-foreground">({m.bookings.length})</span>
              </h3>
              {m.bookings.length === 0 ? (
                <EmptyState icon={Ship} title="No one on this departure yet" description="Add passengers from the day's bookings." size="inline" />
              ) : (
                <ul className="divide-y divide-border border border-border">
                  {m.bookings.map((b) => (
                    <li key={b.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 p-3", (b.status === "NO_SHOW" || b.status === "CANCELLED") && "text-muted-foreground")}>
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpenBooking(b.id)}>
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{b.guestName}</span>
                          <GroupTag group={b.groupBlock} />
                          <AttentionBadge reasons={b.attention} compact />
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {b.reservation ? `${b.reservation.confirmationNo}${b.reservation.roomNumber ? ` · Room ${b.reservation.roomNumber}` : ""}` : "No stay"} · {paxLabel(b)}
                          {b.flightNo ? ` · ${flightLabel(b)}` : ""}
                        </span>
                      </button>
                      <BookingStatus status={b.status} />
                      {editable && (
                        <div className="flex items-center gap-1">
                          {b.attention.some((a) => a.message.startsWith("Flight time")) && (
                            <Button variant="ghost" size="sm" onClick={() => act(() => change("KEEP", [b.id]), "Kept on this departure")} disabled={busy}>
                              Keep
                            </Button>
                          )}
                          {others.length > 0 && (
                            <OptionSelect
                              size="sm"
                              className="w-32"
                              value=""
                              aria-label={`Move ${b.guestName} to another departure`}
                              placeholder="Move to…"
                              onChange={(target) => target && act(() => change("ATTACH", [b.id], target), "Moved")}
                              options={others.map((o) => ({ value: o.id, label: `${o.departureLocal.time} ${o.route.code}` }))}
                            />
                          )}
                          <Button variant="ghost" size="icon" aria-label={`Take ${b.guestName} off this departure`} onClick={() => act(() => change("DETACH", [b.id]), "Taken off the departure")} disabled={busy}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {others.length > 0 && editable && m.bookings.length > 1 && (
                <div className="mt-3 flex items-center justify-end gap-2 text-sm">
                  <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
                  <OptionSelect
                    size="sm"
                    className="w-56"
                    value=""
                    placeholder="Move everyone to…"
                    onChange={(target) => target && act(() => change("ATTACH", m.bookings.filter((b) => b.status !== "CANCELLED").map((b) => b.id), target), "Everyone moved")}
                    options={others.map((o) => ({ value: o.id, label: `${o.departureLocal.time} · ${o.route.name}` }))}
                    aria-label="Move every passenger to another departure"
                  />
                </div>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
