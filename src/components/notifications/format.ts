// Shared by the bell and the full notifications page.

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} d ago`
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
}

/** The dot that marks an unread notification, by severity. */
export const DOT: Record<string, string> = {
  URGENT: "bg-destructive",
  ACTION: "bg-amber-500",
  INFO: "bg-muted-foreground/50",
}
