"use client"

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'

type Property = {
  id: string
  enterpriseId: string
  name: string
  bannerColor: string | null
}

type PropertyContextType = {
  currentProperty: Property | null
  properties: Property[]
  isLocked: boolean
  loading: boolean
  setCurrentProperty: (property: Property) => void
}

const PropertyContext = createContext<PropertyContextType | undefined>(undefined)

export function PropertyProvider({ children }: { children: React.ReactNode }) {
  const [properties, setProperties] = useState<Property[]>([])
  const [currentProperty, setCurrentPropertyState] = useState<Property | null>(null)
  const [isLocked, setIsLocked] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch("/api/session/current-property")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setProperties(data.properties ?? [])
        setIsLocked(!!data.isLocked)
        const current = (data.properties ?? []).find((p: Property) => p.id === data.currentPropertyId) ?? data.properties?.[0] ?? null
        setCurrentPropertyState(current)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
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
    <PropertyContext.Provider value={{ currentProperty, properties, isLocked, loading, setCurrentProperty }}>
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
}

export function useProperty() {
  const context = useContext(PropertyContext)
  if (context === undefined) {
    // Return stable reference to prevent infinite loops in useEffect
    return FALLBACK_CONTEXT
  }
  return context
}
