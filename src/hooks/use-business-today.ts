"use client"

import { startOfDay } from "date-fns"
import { useProperty } from "@/components/providers/property-provider"
import { parseDateKey } from "@/lib/date-only"

/**
 * "Today" for the property: its BUSINESS date as a local-midnight Date, which is the day the
 * desk is trading on. It only differs from the device's date around midnight (before the
 * night audit runs) or on a property whose date was set elsewhere (a demo, a late go-live).
 * Falls back to the device's date until the property has loaded.
 */
export function useBusinessToday(): { today: Date; ready: boolean; propertyId: string | null } {
  const { currentProperty } = useProperty()
  const business = parseDateKey(currentProperty?.businessDate ?? null)
  return {
    today: business ?? startOfDay(new Date()),
    ready: !!business,
    propertyId: currentProperty?.id ?? null,
  }
}
