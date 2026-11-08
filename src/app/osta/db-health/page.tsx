import { redirect } from "next/navigation"

// DB Health became Monitoring (2026-11-08); old links and bookmarks land there.
export default function OstaDbHealthPage() {
  redirect("/osta/monitoring")
}
