import * as React from "react"
import { cn } from "@/lib/utils"
import { Mail, Phone } from "@/components/icons"

/**
 * A phone number or email address that DOES something when tapped: a phone number dials
 * (tel:), an email opens the mail app (mailto:). On a phone, calling the guest is one of the
 * most common reasons to open a profile or reservation. Renders as inline text styled like
 * the value it replaces, so it can drop into existing layouts.
 */
export function ContactLink({
  type,
  value,
  showIcon = false,
  className,
}: {
  type: "phone" | "email"
  value: string | null | undefined
  showIcon?: boolean
  className?: string
}) {
  if (!value) return null
  const trimmed = value.trim()
  // tel: wants digits and a leading +; keep what the user typed for display.
  const href = type === "phone" ? `tel:${trimmed.replace(/[^\d+]/g, "")}` : `mailto:${trimmed}`
  const Icon = type === "phone" ? Phone : Mail
  return (
    <a
      href={href}
      className={cn("inline-flex items-center gap-1.5 break-all underline-offset-2 hover:underline", className)}
    >
      {showIcon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
      {trimmed}
    </a>
  )
}
