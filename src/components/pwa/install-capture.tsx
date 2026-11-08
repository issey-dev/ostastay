"use client"

import { useEffect } from "react"
import { startInstallCapture } from "@/lib/pwa/install-store"

// Draws nothing. Keeps the browser's install offer so the Account dialog can use it later.
export function InstallCapture() {
  useEffect(() => {
    startInstallCapture()
  }, [])
  return null
}
