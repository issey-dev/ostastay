"use client"

import { usePathname } from "next/navigation"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { LayoutDashboard } from "@/components/icons"
import { ENTERPRISE_NAV, PROPERTY_NAV, enterpriseHref, propertyHref, type HubNavItem } from "@/components/hub/hub-nav"
import type { HubProperty } from "@/lib/hub-properties"

// Client half of the Hub sidebar: it needs the pathname to know which property is open
// and which item is active. Everything permission-related was decided on the server —
// this only receives the keys the user may see.
export function HubSidebarNav({
  slug,
  showOverview,
  enterpriseKeys,
  propertyKeys,
  properties,
  defaultPropertyId,
}: {
  slug: string
  showOverview: boolean
  enterpriseKeys: string[]
  propertyKeys: string[]
  properties: HubProperty[]
  defaultPropertyId: string | null
}) {
  const pathname = usePathname() ?? ""
  const root = `/e/${slug}/hub`

  // The property named in the URL wins; otherwise the sidebar's property links point at
  // the default (last opened / working property). Never ambient state.
  const match = pathname.match(new RegExp(`^${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/p/([^/]+)`))
  const urlPropertyId = match?.[1] ?? null
  const propertyId = (urlPropertyId && properties.some((p) => p.id === urlPropertyId) ? urlPropertyId : null) ?? defaultPropertyId
  const property = properties.find((p) => p.id === propertyId) ?? null

  const enterpriseItems = ENTERPRISE_NAV.filter((i) => enterpriseKeys.includes(i.key))
  // "Controls" (the property's landing page, lit on every section reached from it) and the
  // Channel Manager with its pages — nothing else (owner, 2026-09-23).
  const propertyItems = PROPERTY_NAV.filter((i) => (i.path === "" || i.ownEntry) && propertyKeys.includes(i.key))

  // Longest matching href wins, so "channel-manager/mapping" doesn't also light up
  // "channel-manager", and "Controls" doesn't light up on the Channel Manager's pages.
  const candidates: string[] = [
    ...(showOverview ? [root] : []),
    ...enterpriseItems.map((i) => enterpriseHref(slug, i)),
    ...(propertyId ? propertyItems.map((i) => propertyHref(slug, propertyId, i)) : []),
  ]
  const activeHref = candidates
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0]

  const renderItem = (item: HubNavItem, href: string) => (
    <SidebarMenuItem key={item.key}>
      <SidebarMenuButton
        tooltip={item.title}
        isActive={href === activeHref}
        className={item.child ? "pl-7 group-data-[collapsible=icon]:pl-2" : undefined}
        render={<a href={href} />}
      >
        <item.icon className="h-4 w-4" />
        <span>{item.title}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )

  return (
    <>
      {showOverview && (
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Overview" isActive={root === activeHref} render={<a href={root} />}>
                  <LayoutDashboard className="h-4 w-4" />
                  <span>Overview</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}

      {enterpriseItems.length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel>Enterprise</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{enterpriseItems.map((item) => renderItem(item, enterpriseHref(slug, item)))}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}

      {property && propertyItems.length > 0 && (
        <SidebarGroup>
          {/* Which property these links belong to is named by the property band above the
              page (with its switcher) — the sidebar just says "Property" (owner, 2026-09-23). */}
          <SidebarGroupLabel>Property</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{propertyItems.map((item) => renderItem(item, propertyHref(slug, property.id, item)))}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}
    </>
  )
}
