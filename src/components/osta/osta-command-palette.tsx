"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Building2, ChevronRight, ClipboardCheck, ReceiptText, Search, ShieldCheck, ArrowLeftRight, Plus, FileText, KeyRound } from "@/components/icons"
import { OPEN_COMMAND_PALETTE } from "@/components/shell/command-palette"
import { OSTA_NAV_GROUPS } from "@/components/osta-sidebar-nav"
import { OPEN_CREATE_ENTERPRISE } from "@/components/osta/create-enterprise-button"
import { PROPERTY_STATUS_LABEL } from "@/lib/osta/labels"

// Ctrl+K / ⌘K (and "/" outside a text field) in the Osta console: jump to any customer
// enterprise, property or licence invoice, run a console action, or open a page. Never a
// customer's users (owner, 2026-11-07: who works at a customer is not Osta's to browse).
// Same dialog, keys and open event as the tenant palette (src/components/shell/
// command-palette.tsx), so the header's search box (CommandPaletteTrigger) opens this one
// in the console: ↑/↓ move, Enter opens, Tab or → lists what can be done with a result,
// Esc steps back, then closes. Search: /api/osta/search (Osta staff only).

type Item = {
  id: string
  group: string
  label: string
  hint?: string
  icon?: React.ComponentType<{ className?: string }>
  href?: string
  run?: () => void
  /** What Tab / → offers for this result. */
  actions?: Item[]
}

type SearchResult = {
  enterprises: { id: string; name: string; slug: string; state: string }[]
  properties: { id: string; name: string; code: string; status: string; enterpriseId: string; enterpriseName: string }[]
  invoices: { id: string; invoiceNo: string; status: string; overdue: boolean; amount: number; currency: string; enterpriseId: string; enterpriseName: string }[]
}

const LICENSE: Record<string, string> = { ACTIVE: "Active", GRACE: "Grace period", EXPIRED: "Expired", REVOKED: "Revoked", UNLICENSED: "No licence" }
const money = (amount: number, currency: string) => `${currency} ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const ws = (id: string, tab?: string) => `/osta/enterprises/${id}${tab ? `?tab=${tab}` : ""}`

function enterpriseActions(id: string, name: string): Item[] {
  const a = (key: string, label: string, icon: Item["icon"], href: string): Item => ({ id: `e-${id}-${key}`, group: "Actions", label, icon, href })
  return [
    a("open", `Open ${name}`, Building2, ws(id)),
    a("billing", "Licence & billing", KeyRound, ws(id, "billing")),
    a("properties", "Properties", ClipboardCheck, ws(id, "properties")),
    a("channel", "Channel", ArrowLeftRight, ws(id, "channel")),
    a("support", "Request support access", ShieldCheck, "/osta/support-access"),
  ]
}

export function OstaCommandPalette() {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [q, setQ] = React.useState("")
  const [results, setResults] = React.useState<SearchResult | null>(null)
  const [searching, setSearching] = React.useState(false)
  const [active, setActive] = React.useState(0)
  const [actionsFor, setActionsFor] = React.useState<Item | null>(null)
  const listRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName))
      if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      } else if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        setOpen(true)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener("keydown", onKey)
    window.addEventListener(OPEN_COMMAND_PALETTE, onOpen)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener(OPEN_COMMAND_PALETTE, onOpen)
    }
  }, [])

  React.useEffect(() => {
    if (!open) {
      setQ("")
      setResults(null)
      setActive(0)
      setActionsFor(null)
    }
  }, [open])

  // Debounced search; a newer term aborts the older request.
  React.useEffect(() => {
    const term = q.trim()
    if (term.length < 2) {
      setResults(null)
      setSearching(false)
      return
    }
    const ctrl = new AbortController()
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/osta/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
        if (res.ok) setResults(await res.json())
      } catch {
        /* aborted or offline — keep the last results */
      } finally {
        if (!ctrl.signal.aborted) setSearching(false)
      }
    }, 200)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [q])

  const items = React.useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase()
    const match = (s: string) => !term || s.toLowerCase().includes(term)

    const actions: Item[] = [
      { id: "a-new-ent", group: "Actions", label: "New enterprise", hint: "Start onboarding a client", icon: Plus, run: () => window.dispatchEvent(new Event(OPEN_CREATE_ENTERPRISE)) },
      { id: "a-approvals", group: "Actions", label: "Review property approvals", icon: ClipboardCheck, href: "/osta?show=approval" },
      { id: "a-invoice", group: "Actions", label: "Issue an invoice", hint: "Pick the enterprise", icon: ReceiptText, href: "/osta/enterprises" },
      { id: "a-support", group: "Actions", label: "Request support access", icon: ShieldCheck, href: "/osta/support-access" },
      { id: "a-channel", group: "Actions", label: "Connect a channel manager", icon: ArrowLeftRight, href: "/osta/channel-manager" },
    ]

    const pages: Item[] = OSTA_NAV_GROUPS.flatMap((g) =>
      g.items.map((i) => ({ id: `p-${i.url}`, group: "Pages", label: i.title, hint: g.label ?? undefined, icon: i.icon, href: i.url }))
    )

    const found: Item[] = []
    if (results) {
      for (const e of results.enterprises)
        found.push({ id: `e-${e.id}`, group: "Enterprises", label: e.name, hint: `/e/${e.slug} · ${LICENSE[e.state] ?? e.state}`, icon: Building2, href: ws(e.id), actions: enterpriseActions(e.id, e.name) })
      for (const p of results.properties)
        found.push({
          id: `p-${p.id}`,
          group: "Properties",
          label: `${p.name} · ${p.code}`,
          hint: `${p.enterpriseName} · ${PROPERTY_STATUS_LABEL[p.status] ?? p.status}`,
          icon: ClipboardCheck,
          href: `/osta/properties/${p.id}`,
          actions: [
            { id: `p-${p.id}-open`, group: "Actions", label: "Open property", icon: ClipboardCheck, href: `/osta/properties/${p.id}` },
            { id: `p-${p.id}-ent`, group: "Actions", label: p.status === "PENDING" ? `Approve or reject in ${p.enterpriseName}` : `Open ${p.enterpriseName}`, icon: Building2, href: ws(p.enterpriseId, "properties") },
          ],
        })
      for (const i of results.invoices)
        found.push({
          id: `i-${i.id}`,
          group: "Invoices",
          label: i.invoiceNo,
          hint: `${i.enterpriseName} · ${money(i.amount, i.currency)} · ${i.overdue ? "Overdue" : i.status === "ISSUED" ? "Unpaid" : i.status.toLowerCase()}`,
          icon: ReceiptText,
          href: ws(i.enterpriseId, "billing"),
          actions: [
            { id: `i-${i.id}-billing`, group: "Actions", label: `Licence & billing · ${i.enterpriseName}`, icon: KeyRound, href: ws(i.enterpriseId, "billing") },
            { id: `i-${i.id}-print`, group: "Actions", label: "Print invoice", icon: FileText, href: `/osta/license-invoices/${i.id}/print` },
          ],
        })
    }

    return [...found, ...actions.filter((a) => match(a.label)), ...pages.filter((p) => match(p.label))]
  }, [q, results])

  React.useEffect(() => setActive(0), [q, results, actionsFor])

  const shown = actionsFor?.actions ?? items

  const go = (item: Item | undefined) => {
    if (!item) return
    setOpen(false)
    if (item.run) item.run()
    else if (item.href) router.push(item.href)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive((i) => Math.min(shown.length - 1, i + 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === "Enter") {
      e.preventDefault()
      go(shown[active])
    } else if (!actionsFor && !e.shiftKey && (e.key === "Tab" || (e.key === "ArrowRight" && e.currentTarget.selectionStart === e.currentTarget.value.length))) {
      const item = shown[active]
      if (item?.actions) {
        e.preventDefault()
        setActionsFor(item)
      }
    } else if (actionsFor && (e.key === "Escape" || e.key === "ArrowLeft" || (e.key === "Tab" && e.shiftKey))) {
      e.preventDefault()
      e.stopPropagation()
      setActionsFor(null)
    }
  }

  React.useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" })
  }, [active, actionsFor])

  let lastGroup = ""
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && actionsFor) {
          setActionsFor(null)
          return
        }
        setOpen(o)
      }}
    >
      <DialogContent size="md" showCloseButton={false} className="gap-0 p-0 sm:top-[15%] sm:translate-y-0">
        <DialogTitle className="sr-only">Search the console</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search enterprises, properties, invoices or pages"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label="Search"
            role="combobox"
            aria-expanded
            aria-controls="osta-command-palette-list"
          />
          {searching && <span className="text-xs text-muted-foreground">Searching…</span>}
        </div>
        <div ref={listRef} id="osta-command-palette-list" role="listbox" className="max-h-[60vh] overflow-y-auto p-1 sm:max-h-[420px]">
          {actionsFor && (
            <p className="px-3 pb-1 pt-2 text-xs text-muted-foreground">
              What you can do with <span className="font-medium text-foreground">{actionsFor.label}</span>
            </p>
          )}
          {shown.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {q.trim().length >= 2 && !searching ? "Nothing found" : "Type a name, code or invoice number"}
            </p>
          ) : (
            shown.map((item, i) => {
              const header = !actionsFor && item.group !== lastGroup ? item.group : null
              lastGroup = item.group
              const Icon = item.icon
              return (
                <React.Fragment key={item.id}>
                  {header && <p className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">{header}</p>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    data-index={i}
                    onMouseMove={() => setActive(i)}
                    onClick={() => go(item)}
                    className={cn("flex w-full items-center gap-3 px-3 py-2 text-left text-sm", i === active && "bg-muted")}
                  >
                    {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.hint && <span className="shrink-0 truncate text-xs text-muted-foreground max-sm:hidden">{item.hint}</span>}
                    {item.actions && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground max-sm:hidden" aria-hidden />}
                  </button>
                </React.Fragment>
              )
            })
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-xs text-muted-foreground max-sm:hidden">
          <span><kbd className="font-sans">↑↓</kbd> move</span>
          <span><kbd className="font-sans">Enter</kbd> open</span>
          {actionsFor ? (
            <span><kbd className="font-sans">Esc</kbd> back</span>
          ) : (
            <>
              <span><kbd className="font-sans">Tab</kbd> actions on a result</span>
              <span><kbd className="font-sans">Esc</kbd> close</span>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
