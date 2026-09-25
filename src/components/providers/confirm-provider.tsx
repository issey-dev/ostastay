"use client"

import { createContext, useContext, useRef, useState, useCallback } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export type ConfirmOptions = {
  title: string
  description?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Styles the confirm button as destructive (red). */
  destructive?: boolean
}

export type ReasonOptions = ConfirmOptions & {
  /** Label above the reason box. */
  reasonLabel?: string
  placeholder?: string
  /** Confirm stays disabled until something is typed (default true). */
  required?: boolean
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>
type ReasonFn = (options: ReasonOptions) => Promise<string | null>

const ConfirmContext = createContext<ConfirmFn | null>(null)
const ReasonContext = createContext<ReasonFn | null>(null)

// The promise-based replacement for window.confirm(), rendered through the shared
// AlertDialog primitive so every destructive confirmation looks and behaves the same
// (D-3 — the app previously mixed native confirm(), hand-rolled dialogs, and AlertDialog).
// Usage: `const confirm = useConfirm(); if (!(await confirm({ title: "…" }))) return`.
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error("useConfirm must be used within a ConfirmProvider")
  return ctx
}

// The same dialog with a reason box — replaces window.prompt() for actions that must be
// explained (void bill, reverse check-out). Resolves to the trimmed reason, or null if cancelled.
// Usage: `const reason = await askReason({ title: "Void this bill?", destructive: true }); if (reason === null) return`.
export function useReasonPrompt(): ReasonFn {
  const ctx = useContext(ReasonContext)
  if (!ctx) throw new Error("useReasonPrompt must be used within a ConfirmProvider")
  return ctx
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<ReasonOptions | null>(null)
  const [withReason, setWithReason] = useState(false)
  const [reason, setReason] = useState("")
  const resolverRef = useRef<((value: string | null) => void) | null>(null)

  const ask = useCallback((opts: ReasonOptions, reasonBox: boolean) => {
    setOptions(opts)
    setWithReason(reasonBox)
    setReason("")
    setOpen(true)
    return new Promise<string | null>((resolve) => {
      resolverRef.current = resolve
    })
  }, [])

  const confirm = useCallback<ConfirmFn>((opts) => ask(opts, false).then((v) => v !== null), [ask])
  const askReason = useCallback<ReasonFn>((opts) => ask(opts, true), [ask])

  // Resolve the outstanding promise exactly once and close the dialog.
  const settle = useCallback((value: string | null) => {
    setOpen(false)
    const resolve = resolverRef.current
    resolverRef.current = null
    resolve?.(value)
  }, [])

  const reasonMissing = withReason && (options?.required ?? true) && !reason.trim()

  return (
    <ConfirmContext.Provider value={confirm}>
    <ReasonContext.Provider value={askReason}>
      {children}
      <AlertDialog open={open} onOpenChange={(next) => { if (!next) settle(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{options?.title}</AlertDialogTitle>
            {options?.description && (
              <AlertDialogDescription className="whitespace-pre-line">{options.description}</AlertDialogDescription>
            )}
          </AlertDialogHeader>
          {withReason && (
            <div className="grid gap-1.5">
              <Label htmlFor="confirm-reason">{options?.reasonLabel ?? "Reason"}</Label>
              <Textarea
                id="confirm-reason"
                autoFocus
                rows={3}
                value={reason}
                placeholder={options?.placeholder}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(null)}>{options?.cancelLabel ?? "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              disabled={reasonMissing}
              onClick={() => settle(withReason ? reason.trim() : "")}
              className={options?.destructive ? "bg-destructive hover:bg-destructive/90" : undefined}
            >
              {options?.confirmLabel ?? "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ReasonContext.Provider>
    </ConfirmContext.Provider>
  )
}
