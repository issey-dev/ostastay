import { DesktopOnlyNotice } from "@/components/ui/mobile"

// Phones only (DesktopOnlyNotice is md:hidden): the line at the top of a Hub setup page
// that is built for a large screen — long forms, wide tables, editors. The page itself
// stays reachable below it, readable but not optimised (.agents/docs/MOBILE_PLAN.md §2.4).
export function HubSetupNotice({ title, description }: { title: string; description?: string }) {
  return (
    <DesktopOnlyNotice
      feature={`${title} setup`}
      description={description ?? "You can still read everything below. To make changes comfortably, open the Hub on a tablet or computer."}
    />
  )
}
