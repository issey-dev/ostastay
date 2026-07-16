"use client"

import React, { createContext, useContext, useState, useEffect } from 'react'

// TODO(Phase 1): still the pre-existing hardcoded stub (setCurrentProperty is never
// called anywhere) — Phase 1 replaces this with a real provider that fetches the
// session's actual properties (or the single work-location property for a
// PROPERTY-scoped user), backed by a cookie so server components can read it too.
type Property = {
  id: string
  enterpriseId: string
  name: string
}

type PropertyContextType = {
  currentProperty: Property | null
  setCurrentProperty: (property: Property) => void
}

const PropertyContext = createContext<PropertyContextType | undefined>(undefined)

export function PropertyProvider({ children }: { children: React.ReactNode }) {
  // Hardcoded demo property
  const [currentProperty, setCurrentProperty] = useState<Property | null>({
    id: "00000000-0000-0000-0000-000000000000",
    enterpriseId: "00000000-0000-0000-0000-000000000000",
    name: "Demo Property"
  })

  return (
    <PropertyContext.Provider value={{ currentProperty, setCurrentProperty }}>
      {children}
    </PropertyContext.Provider>
  )
}

const FALLBACK_CONTEXT = {
  currentProperty: {
    id: "00000000-0000-0000-0000-000000000000",
    enterpriseId: "00000000-0000-0000-0000-000000000000",
    name: "Demo Property"
  },
  setCurrentProperty: () => {}
}

export function useProperty() {
  const context = useContext(PropertyContext)
  if (context === undefined) {
    // Return stable reference to prevent infinite loops in useEffect
    return FALLBACK_CONTEXT
  }
  return context
}
