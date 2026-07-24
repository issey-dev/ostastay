"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { Module } from "@/lib/scope"
import { NAV_GROUPS } from "@/components/app-sidebar-nav.config"
import { useProperty } from "@/components/providers/property-provider"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

// Longest-prefix match, so a nested route highlights exactly one entry: on
// /dashboard/reservations/tape-chart both Reservations and Tape Chart match, and the
// longer (more specific) href is the one that wins.
function activeHref(pathname: string, hrefs: string[]) {
  let best = ""
  for (const href of hrefs) {
    if (pathname === href || pathname.startsWith(`${href}/`)) {
      if (href.length > best.length) best = href
    }
  }
  return best
}

export function AppSidebarNav({
  allowedModules,
  enterprisePrefix,
}: {
  allowedModules: Module[]
  enterprisePrefix: string
}) {
  const pathname = usePathname()
  const allowed = new Set(allowedModules)

  // The sidebar sits outside PropertyAccentScope (that wrapper only covers the content
  // area), so the accent is read straight from the provider here rather than inherited.
  // Undefined when the property hasn't chosen a banner color — in which case the active
  // item keeps SidebarMenuButton's own neutral highlight. See globals.css
  // `.sidebar-item-accent`.
  const { currentProperty } = useProperty()
  const accent = currentProperty?.bannerColor

  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => allowed.has(i.module)),
  })).filter((g) => g.items.length > 0)

  const current = activeHref(
    pathname,
    groups.flatMap((g) => g.items.map((i) => `${enterprisePrefix}${i.url}`))
  )

  return (
    <>
      {groups.map((group) => (
        <SidebarGroup key={group.label}>
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => {
                const href = `${enterprisePrefix}${item.url}`
                const isActive = href === current
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      isActive={isActive}
                      tooltip={item.title}
                      className={isActive && accent ? "sidebar-item-accent" : undefined}
                      style={isActive && accent ? ({ "--property-accent": accent } as React.CSSProperties) : undefined}
                      render={<Link href={href} />}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  )
}
