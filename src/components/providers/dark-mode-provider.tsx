"use client"

import React, { createContext, useContext, useState, useEffect, useCallback } from "react"

type DarkModeContextType = {
  isDark: boolean
  toggle: () => void
}

const DarkModeContext = createContext<DarkModeContextType | undefined>(undefined)

const STORAGE_KEY = "theme-mode"

export function DarkModeProvider({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    // The inline script in src/app/layout.tsx already applied the class before hydration
    // (avoiding a flash of the wrong theme) — this just syncs React state to match it.
    setIsDark(document.documentElement.classList.contains("dark"))
  }, [])

  const toggle = useCallback(() => {
    setIsDark((prev) => {
      const next = !prev
      document.documentElement.classList.toggle("dark", next)
      localStorage.setItem(STORAGE_KEY, next ? "dark" : "light")
      return next
    })
  }, [])

  return <DarkModeContext.Provider value={{ isDark, toggle }}>{children}</DarkModeContext.Provider>
}

export function useDarkMode() {
  const context = useContext(DarkModeContext)
  if (context === undefined) {
    return { isDark: false, toggle: () => {} }
  }
  return context
}
