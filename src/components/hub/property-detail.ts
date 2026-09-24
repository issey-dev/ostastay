"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

// The property fields the Hub's property setup screens read (General, Appearance,
// Revenue, Session timeout). Loaded on the server by the page — see
// src/lib/hub-property-detail.ts — and passed down, because the Hub deliberately has no
// PropertyProvider (src/app/e/[slug]/hub/layout.tsx).
export type HubPropertyDetail = {
  id: string
  enterpriseId: string
  name: string
  code: string
  bannerColor: string | null
  stationeryFont: string | null
  allocationCalculationMode: string
  sessionIdleMinutes: number
}

// A server-loaded property, plus the changes this screen has just saved. `apply` shows a
// saved change at once and asks the server for fresh data (the band and sidebar read the
// same property, so they update too). Pages remount per property (the property layout
// keys its children by id), so a pending change can never bleed into another property.
export function usePropertyValue<T extends object>(property: T) {
  const router = useRouter()
  const [saved, setSaved] = useState<Partial<T>>({})
  const current = { ...property, ...saved } as T
  const apply = (patch: Partial<T>) => {
    setSaved((prev) => ({ ...prev, ...patch }))
    router.refresh()
  }
  return [current, apply] as const
}
