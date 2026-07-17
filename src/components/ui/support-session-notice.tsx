import { cn } from "@/lib/utils"

type SupportSessionNoticeProps = {
  icon?: React.ReactNode
  message: React.ReactNode
  actions?: React.ReactNode
  className?: string
}

// The "Osta support is viewing as this enterprise" indicator — a fixed, non-customizable
// warning tone (not the property's own accent color) since this is a security notice, not
// branding: it must never be recolored to something low-contrast or easy to miss.
export function SupportSessionNotice({ icon, message, actions, className }: SupportSessionNoticeProps) {
  return (
    <div
      data-slot="support-session-notice"
      className={cn(
        "relative flex items-center gap-2 px-4 py-2 text-sm font-medium bg-warning text-warning-foreground",
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
