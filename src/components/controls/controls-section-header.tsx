import { cn } from "@/lib/utils"

// Plain (non-Card) sub-section heading for content that lives inside a ControlsCard —
// title + description + optional trailing action, with a divider bleeding to the full
// width of the parent card. Replaces the old pattern of nesting a second <Card> (its
// own shaded header, border, rounded corners, shadow) inside a ControlsCard, which
// produced a "card inside a card" look. Depends on being rendered as a descendant of
// ControlsCard's own p-6 CardContent — the -mx-6/px-6 offsets cancel that padding so
// the divider spans edge-to-edge while the heading text stays inset to match it.
//
// `title` is optional — omit it when the outer ControlsCard's own title (or an active
// tab label directly above) already says the same thing, so only the action button and
// divider render instead of a redundant restated heading.
export function ControlsSectionHeader({
  title,
  description,
  action,
}: {
  title?: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className={cn("flex flex-row items-start gap-4 -mx-6 px-6 pb-4 mb-6 border-b border-border", title ? "justify-between" : "justify-end")}>
      {title && (
        <div>
          <h3 className="text-lg font-medium text-foreground">{title}</h3>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      )}
      {action}
    </div>
  )
}

// Bleeds full-width content (typically a <Table>) to the edges of the parent
// ControlsCard, canceling its p-6 CardContent padding on the sides and bottom. Use
// directly after ControlsSectionHeader (which already canceled the top via its own
// divider) so the two together span the whole card with no double border.
export function ControlsSectionBody({ children }: { children: React.ReactNode }) {
  return <div className="-mx-6 -mb-6">{children}</div>
}
