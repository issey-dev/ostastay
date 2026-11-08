import { redirect } from "next/navigation"

// Property approvals are handled in Today's inbox and on each enterprise's Properties tab
// (owner, 2026-11-08); the standalone list is gone. Single properties stay at /osta/properties/[id].
export default function OstaPropertiesRedirect() {
  redirect("/osta?show=approval")
}
