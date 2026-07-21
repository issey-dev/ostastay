"use client"

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'

type Property = {
  id: string
  enterpriseId: string
  name: string
  bannerColor: string | null
  // "RATE_PLAN" or "MEAL_PLAN" — which side drives automatic Allocation attachment
  // on a reservation (Controls > Revenue). See src/lib/allocations.ts.
  allocationCalculationMode: string
  // The property's operational business date (ISO string) — the "today" the front
  // desk works against. Rolled forward only by Night Audit (EOD). Null until a
  // property has been initialized. See src/lib/business-date.ts.
  businessDate: string | null
}

type PropertyContextType = {
  currentProperty: Property | null
  properties: Property[]
  isLocked: boolean
  loading: boolean
  setCurrentProperty: (property: Property) => void
  // Re-fetches the property list/current-property from the server without switching
  // which one is active — for a page that just edited the current property's own
  // fields (e.g. Controls > Revenue's Allocation Calculation toggle) and needs the
  // rest of the app to see the new value without a full reload.
  refreshProperties: () => void
}

const PropertyContext = createContext<PropertyContextType | undefined>(undefined)

export function PropertyProvider({ children }: { children: React.ReactNode }) {
  const [properties, setProperties] = useState<Property[]>([])
  const [currentProperty, setCurrentPropertyState] = useState<Property | null>(null)
  const [isLocked, setIsLocked] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchCurrentProperty = useCallback(() => {
    return fetch("/api/session/current-property")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return
        setProperties(data.properties ?? [])
        setIsLocked(!!data.isLocked)
        const current = (data.properties ?? []).find((p: Property) => p.id === data.currentPropertyId) ?? data.properties?.[0] ?? null
        setCurrentPropertyState(current)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchCurrentProperty().finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setCurrentProperty = useCallback((property: Property) => {
    setCurrentPropertyState(property)
    if (!isLocked) {
      fetch("/api/session/current-property", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: property.id }),
      }).catch(() => {})
    }
  }, [isLocked])

  return (
    <PropertyContext.Provider value={{ currentProperty, properties, isLocked, loading, setCurrentProperty, refreshProperties: fetchCurrentProperty }}>
      {children}
    </PropertyContext.Provider>
  )
}

const FALLBACK_CONTEXT: PropertyContextType = {
  currentProperty: null,
  properties: [],
  isLocked: false,
  loading: true,
  setCurrentProperty: () => {},
  refreshProperties: () => {},
}

export function useProperty() {
  const context = useContext(PropertyContext)
  if (context === undefined) {
    // Return stable reference to prevent infinite loops in useEffect
    return FALLBACK_CONTEXT
  }
  return context
}
