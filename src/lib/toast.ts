"use client"

import { Toast } from "@base-ui/react/toast"
import type * as React from "react"

// One global toast manager so any code — including outside React (event handlers, catch
// blocks) — can raise a toast via toast.error(...) without wiring a hook at the call site.
// The <Toaster> (mounted once in the root layout) subscribes to it and renders the queue.
// This replaces the app's 42 blocking alert() calls with one consistent, styled surface.
export const toastManager = Toast.createToastManager()

type ToastOptions = { description?: React.ReactNode; duration?: number }
type ToastType = "success" | "error" | "info" | "warning"

function show(type: ToastType, message: React.ReactNode, opts?: ToastOptions): string {
  return toastManager.add({
    title: message,
    description: opts?.description,
    type,
    timeout: opts?.duration ?? (type === "error" ? 6000 : 4000),
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
