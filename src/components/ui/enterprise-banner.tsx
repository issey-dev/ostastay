import { cn } from "@/lib/utils"

type EnterpriseBannerProps = {
  icon?: React.ReactNode
  message: React.ReactNode
  actions?: React.ReactNode
  className?: string
}

// The ONLY component in the app allowed to consume --accent-enterprise (see
// src/app/theme.css and DESIGN_PLAN.md §3.3 — the reserved per-tenant accent injection
// point). Every other component stays monochromatic; this is the sanctioned escape
// hatch. Today used for the support-acting-as session indicator; reserved for a future
// tenant-configurable announcement banner once that config field exists.
export function EnterpriseBanner({ icon, message, actions, className }: EnterpriseBannerProps) {
  return (
    <div
      data-slot="enterprise-banner"
      className={cn(
        "relative flex items-center gap-2 px-4 py-2 text-sm font-medium bg-accent-enterprise text-accent-enterprise-foreground",
        className
      )}
      style={{ zIndex: "var(--z-banner)" }}
    >
      {icon}
      <span className="flex-1">{message}</span>
      {actions}
    </div>
  )
}
