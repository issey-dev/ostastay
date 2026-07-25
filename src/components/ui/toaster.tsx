"use client"

import type { ComponentType } from "react"
import { Toast } from "@base-ui/react/toast"
import { toastManager } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { X, CheckCircle2, AlertTriangle, Info } from "@/components/icons"

const TYPE_STYLE: Record<string, { ring: string; icon: ComponentType<{ className?: string }>; iconColor: string }> = {
  success: { ring: "ring-success/30", icon: CheckCircle2, iconColor: "text-success" },
  error: { ring: "ring-destructive/30", icon: AlertTriangle, iconColor: "text-destructive" },
  warning: { ring: "ring-warning/30", icon: AlertTriangle, iconColor: "text-warning" },
  info: { ring: "ring-foreground/10", icon: Info, iconColor: "text-foreground" },
}

function ToastList() {
  const { toasts } = Toast.useToastManager()
  return toasts.map((t) => {
    const style = TYPE_STYLE[t.type ?? "info"] ?? TYPE_STYLE.info
    const Icon = style.icon
    return (
      <Toast.Root
        key={t.id}
        toast={t}
        className={cn(
          "relative flex items-start gap-3 rounded-lg bg-popover p-3 pr-9 text-sm text-popover-foreground shadow-elevation-4 ring-1",
          style.ring,
          "transition-all duration-150 data-[starting-style]:translate-x-4 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0"
        )}
      >
        <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", style.iconColor)} />
        <div className="min-w-0 flex-1">
          <Toast.Title className="font-medium leading-snug">{t.title}</Toast.Title>
          {t.description && (
            <Toast.Description className="mt-0.5 text-muted-foreground">{t.description}</Toast.Description>
          )}
        </div>
        <Toast.Close
          className="absolute top-2 right-2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </Toast.Close>
      </Toast.Root>
    )
  })
}

// Mounted once (root layout). Renders whatever toast.success/error/... enqueues on the
// shared global toastManager — top-right, stacked, auto-dismissing.
export function Toaster() {
  return (
    <Toast.Provider toastManager={toastManager}>
      <Toast.Portal>
        <Toast.Viewport className="fixed top-4 right-4 z-[var(--z-toast,100)] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  )
}
