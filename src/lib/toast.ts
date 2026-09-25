"use client"

import { Toast } from "@base-ui/react/toast"
import type * as React from "react"

// One global toast manager so any code — including outside React (event handlers, catch
// blocks) — can raise a toast via toast.error(...) without wiring a hook at the call site.
// The <Toaster> (mounted once in the root layout) subscribes to it and renders the queue.
// This replaces the app's 42 blocking alert() calls with one consistent, styled surface.
export const toastManager = Toast.createToastManager()

// `action` puts one button in the toast — the "next step" after an action (Open folio, View
// booking) without a blocking dialog. DESKTOP_PLAN D1/D2: success is a toast, never an OK modal.
type ToastAction = { label: string; onClick: () => void }
type ToastOptions = { description?: React.ReactNode; duration?: number; action?: ToastAction }
type ToastType = "success" | "error" | "info" | "warning"

function show(type: ToastType, message: React.ReactNode, opts?: ToastOptions): string {
  return toastManager.add({
    title: message,
    description: opts?.description,
    type,
    // A toast with an action stays a little longer so there is time to reach the button.
    timeout: opts?.duration ?? (type === "error" || opts?.action ? 6000 : 4000),
    actionProps: opts?.action ? { children: opts.action.label, onClick: opts.action.onClick } : undefined,
  })
}

// sonner-style API: toast("..."), toast.success("..."), toast.error("...").
export const toast = Object.assign(
  (message: React.ReactNode, opts?: ToastOptions) => show("info", message, opts),
  {
    success: (message: React.ReactNode, opts?: ToastOptions) => show("success", message, opts),
    error: (message: React.ReactNode, opts?: ToastOptions) => show("error", message, opts),
    info: (message: React.ReactNode, opts?: ToastOptions) => show("info", message, opts),
    warning: (message: React.ReactNode, opts?: ToastOptions) => show("warning", message, opts),
    dismiss: (id?: string) => toastManager.close(id),
  }
)
