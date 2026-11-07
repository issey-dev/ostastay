"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import type { Module } from "@/lib/scope"
import {
  CHORD_KEY,
  CHORD_TIMEOUT_MS,
  GO_TO_TARGETS,
  SHORTCUTS,
  SHORTCUT_GROUP_ORDER,
  canUseSingleKey,
  chordTarget,
  isTypingTarget,
  type ShortcutDoc,
} from "@/lib/shortcuts"

// Global keyboard layer (UX round 2, 8.9.0): "?" opens the cheat sheet, "g" then a letter jumps
// to a page. The list itself is src/lib/shortcuts.ts. Mounted once next to the command palette.
//
// It adds to the keyboard, it never takes from it: single letters act only when nothing is
// focused, no window is open and no Ctrl / ⌘ / Alt is held (canUseSingleKey), and a person can
// switch them off here. Ctrl+K, "/" and Ctrl+B are untouched.

export const OPEN_SHORTCUTS = "open-keyboard-shortcuts"

const QUICK_KEYS_STORAGE = "quick-keys"
const QUICK_KEYS_EVENT = "quick-keys-changed"

function readQuickKeys(): boolean {
  try {
    return window.localStorage.getItem(QUICK_KEYS_STORAGE) !== "off"
  } catch {
    return true // storage blocked — keep the default rather than lose the feature
  }
}

function subscribeQuickKeys(cb: () => void) {
  window.addEventListener(QUICK_KEYS_EVENT, cb)
  window.addEventListener("storage", cb)
  return () => {
    window.removeEventListener(QUICK_KEYS_EVENT, cb)
    window.removeEventListener("storage", cb)
  }
}

/** Whether single-letter quick keys are on for this person on this device (default: on). */
export function useQuickKeys(): boolean {
  return React.useSyncExternalStore(subscribeQuickKeys, readQuickKeys, () => true)
}

export function setQuickKeys(on: boolean) {
  try {
    if (on) window.localStorage.removeItem(QUICK_KEYS_STORAGE)
    else window.localStorage.setItem(QUICK_KEYS_STORAGE, "off")
  } catch {
    /* storage unavailable — the switch just won't stick */
  }
  window.dispatchEvent(new Event(QUICK_KEYS_EVENT))
}

/** Any window (dialog, confirmation, sheet, the palette) on top of the page. Confirmations
 *  ("Check out this guest?") are alertdialogs, so both roles count. */
export const dialogIsOpen = () => typeof document !== "undefined" && !!document.querySelector('[role="dialog"], [role="alertdialog"]')

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex min-w-5 items-center justify-center border border-border bg-muted px-1 py-0.5 font-sans text-[11px] font-medium leading-none text-foreground shadow-[0_1px_0_var(--border)]",
        className
      )}
    >
      {children}
    </kbd>
  )
}

/** One shortcut's keys on caps: "G then F", "Ctrl + K", "↑ or ↓". */
export function KeyCaps({ keys, join }: Pick<ShortcutDoc, "keys" | "join">) {
  const sep = join === "then" ? "then" : join === "or" ? "or" : "+"
  return (
    <span className="inline-flex flex-wrap items-center gap-1 whitespace-nowrap">
      {keys.map((k, i) => (
        <React.Fragment key={`${k}-${i}`}>
          {i > 0 && <span className="text-[11px] text-muted-foreground">{sep}</span>}
          <Kbd>{k.length === 1 ? k.toUpperCase() : k}</Kbd>
        </React.Fragment>
      ))}
    </span>
  )
}

export function KeyboardShortcuts({ allowedModules, prefix }: { allowedModules: Module[]; prefix: string }) {
  const router = useRouter()
  const quickKeys = useQuickKeys()
  const [open, setOpen] = React.useState(false)
  const [chord, setChord] = React.useState(false)
  const openRef = React.useRef(false)
  const chordRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const allowed = React.useMemo(() => new Set(allowedModules), [allowedModules])

  React.useEffect(() => {
    openRef.current = open
  }, [open])

  const endChord = React.useCallback(() => {
    if (chordRef.current) clearTimeout(chordRef.current)
    chordRef.current = null
    setChord(false)
  }, [])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // "?" — the cheat sheet. Works with quick keys off; ignored while typing.
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(e.target)) {
        if (dialogIsOpen() && !openRef.current) return
        e.preventDefault()
        endChord()
        setOpen((o) => !o)
        return
      }
      if (!quickKeys) return

      if (chordRef.current) {
        // Second key of "g, …": anything that is not a page letter just cancels the chord.
        if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return
        const target = e.key.length === 1 ? chordTarget(e.key, allowed) : undefined
        endChord()
        if (e.key === "Escape") return
        if (target) {
          e.preventDefault()
          router.push(`${prefix}${target.url}`)
        }
        return
      }

      if (e.key === CHORD_KEY && canUseSingleKey(e, dialogIsOpen())) {
        e.preventDefault()
        setChord(true)
        chordRef.current = setTimeout(endChord, CHORD_TIMEOUT_MS)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener("keydown", onKey)
    window.addEventListener(OPEN_SHORTCUTS, onOpen)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener(OPEN_SHORTCUTS, onOpen)
      if (chordRef.current) clearTimeout(chordRef.current)
    }
  }, [quickKeys, allowed, prefix, router, endChord])

  // Pages this person can't open are not listed — the sheet shows what works for them.
  const visible = SHORTCUTS.filter((s) => {
    if (!s.id.startsWith("go-")) return true
    const t = GO_TO_TARGETS.find((x) => `go-${x.key}` === s.id)
    return !!t && allowed.has(t.module)
  })

  return (
    <>
      {chord && (
        <div
          role="status"
          className="pointer-events-none fixed bottom-4 left-1/2 z-[var(--z-toast,60)] -translate-x-1/2 border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-elevation-2"
        >
          <Kbd>G</Kbd> then a letter to go to a page — <Kbd>?</Kbd> lists them
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg" className="max-h-[85vh] gap-0 overflow-hidden p-0">
          <div className="border-b border-border px-5 py-4">
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription className="mt-1">
              Letters work when nothing is selected and no window is open. Press <Kbd>?</Kbd> any time to see this list.
            </DialogDescription>
            <label className="mt-3 flex items-center justify-between gap-4 border border-border bg-muted/40 px-3 py-2 text-sm">
              <span>
                <span className="font-medium">Quick keys</span>
                <span className="block text-xs text-muted-foreground">
                  The single-letter keys below. Switch off if they get in your way — <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> and <Kbd>?</Kbd> always work.
                </span>
              </span>
              <Switch checked={quickKeys} onCheckedChange={(v) => setQuickKeys(!!v)} aria-label="Quick keys" />
            </label>
          </div>
          <div className="max-h-[60vh] overflow-y-auto px-5 py-3">
            {SHORTCUT_GROUP_ORDER.map((group) => {
              const rows = visible.filter((s) => s.group === group)
              if (rows.length === 0) return null
              const dimmed = !quickKeys && group !== "Everywhere" && group !== "Search and commands"
              return (
                <section key={group} className={cn("pb-4", dimmed && "opacity-50")}>
                  <h3 className="pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</h3>
                  <ul className={cn(group === "Go to a page" && "grid gap-x-6 sm:grid-cols-2")}>
                    {rows.map((s) => (
                      <li key={s.id} className="flex items-start justify-between gap-4 border-b border-border/60 py-1.5 text-sm last:border-0">
                        <span className="min-w-0">{s.label}</span>
                        <KeyCaps keys={s.keys} join={s.join} />
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
