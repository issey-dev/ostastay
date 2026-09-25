"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { ChevronRight, LayoutDashboard } from "@/components/icons"
import { ENTERPRISE_NAV, PROPERTY_NAV, enterpriseHref, isControlsSection, propertyHref, type HubNavItem } from "@/components/hub/hub-nav"
import { cn } from "@/lib/utils"
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
  // "Controls" (the property's landing page, with its sections as a collapsible sub-list)
  // and the Channel Manager with its pages (owner, 2026-09-23; DESKTOP_PLAN §2.1). The
  // sections are the same filtered list the Controls landing page shows its cards for.
  const propertyItems = PROPERTY_NAV.filter((i) => (i.path === "" || i.ownEntry) && propertyKeys.includes(i.key))
  const controlsSections = PROPERTY_NAV.filter((i) => isControlsSection(i) && propertyKeys.includes(i.key))

  // Longest matching href wins, so "channel-manager/mapping" doesn't also light up
  // "channel-manager", and "Controls" doesn't light up on a section's or the Channel
  // Manager's pages.
  const candidates: string[] = [
    ...(showOverview ? [root] : []),
    ...enterpriseItems.map((i) => enterpriseHref(slug, i)),
    ...(propertyId ? [...propertyItems, ...controlsSections].map((i) => propertyHref(slug, propertyId, i)) : []),
  ]
  const activeHref = candidates
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0]

  const controlsHref = property ? propertyHref(slug, property.id, { path: "" }) : null
  const sectionActive = !!property && controlsSections.some((i) => propertyHref(slug, property.id, i) === activeHref)
  const inControls = (!!controlsHref && activeHref === controlsHref) || sectionActive

  // Collapsed by default; opens on its own whenever the route enters Controls (adjusting
  // state while rendering, not in an effect — react.dev "storing information from previous
  // renders"). The chevron still lets the user fold it away again.
  const [controlsOpen, setControlsOpen] = useState(inControls)
  const [wasInControls, setWasInControls] = useState(inControls)
  if (inControls !== wasInControls) {
    setWasInControls(inControls)
    if (inControls) setControlsOpen(true)
  }

  // Icon rail: the sub-list is hidden, so "Controls" itself stays lit on a section's page.
  // Same when the user has folded the list away.
  const { state, isMobile } = useSidebar()
  const railMode = state === "collapsed" && !isMobile
  const controlsLit = (!!controlsHref && activeHref === controlsHref) || (sectionActive && (railMode || !controlsOpen))

  const renderItem = (item: HubNavItem, href: string) => (
    <SidebarMenuItem key={item.key}>
      <SidebarMenuButton
        tooltip={item.title}
        isActive={href === activeHref}
        className={item.child ? "pl-7 group-data-[collapsible=icon]:pl-2" : undefined}
        render={<Link href={href} />}
      >
        <item.icon className="h-4 w-4" />
        <span>{item.title}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )

  const renderControls = (item: HubNavItem, href: string, propertyIdForLinks: string) => (
    <SidebarMenuItem key={item.key}>
      <SidebarMenuButton tooltip={item.title} isActive={controlsLit} render={<Link href={href} />}>
        <item.icon className="h-4 w-4" />
        <span>{item.title}</span>
      </SidebarMenuButton>
      {controlsSections.length > 0 && (
        <>
          <SidebarMenuAction
            aria-label={controlsOpen ? "Hide Controls sections" : "Show Controls sections"}
            aria-expanded={controlsOpen}
            aria-controls="hub-controls-sections"
            onClick={() => setControlsOpen((o) => !o)}
          >
            <ChevronRight className={cn("transition-transform", controlsOpen && "rotate-90")} />
          </SidebarMenuAction>
          {controlsOpen && (
            <SidebarMenuSub id="hub-controls-sections">
              {controlsSections.map((section) => {
                const sectionHref = propertyHref(slug, propertyIdForLinks, section)
                return (
                  <SidebarMenuSubItem key={section.key}>
                    <SidebarMenuSubButton isActive={sectionHref === activeHref} render={<Link href={sectionHref} />}>
                      <span>{section.title}</span>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                )
              })}
            </SidebarMenuSub>
          )}
        </>
      )}
    </SidebarMenuItem>
  )

  return (
    <>
      {showOverview && (
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Overview" isActive={root === activeHref} render={<Link href={root} />}>
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
            <SidebarMenu>
              {propertyItems.map((item) =>
                item.path === ""
                  ? renderControls(item, propertyHref(slug, property.id, item), property.id)
                  : renderItem(item, propertyHref(slug, property.id, item))
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}
    </>
  )
}
