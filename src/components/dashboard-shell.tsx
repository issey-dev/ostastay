"use client"

import { usePathname } from "next/navigation"
import { isStationeryRoute } from "@/lib/stationery-routes"

// Picks between the two shells dashboard/layout.tsx pre-builds (chrome vs. bare) based
// on the CURRENT pathname — deliberately just a picker, nothing else. Both trees are
// built server-side in the layout (so AppSidebar and everything else that touches
// cookies()/Prisma stays a real Server Component); this file only decides which one to
// render, which is the one piece of that decision that genuinely needs the client-side
// usePathname() hook. Importing AppSidebar/HeaderBrand/etc. directly into a "use client"
// file here was the earlier mistake — Next.js has to bundle their whole server-only
// import chain (next/headers, Prisma) into the client bundle, which fails the build.
export function DashboardShell({
  chrome,
  bare,
}: {
  chrome: React.ReactNode
  bare: React.ReactNode
}) {
  const pathname = usePathname()
  return isStationeryRoute(pathname) ? <>{bare}</> : <>{chrome}</>
}
