"use client"

import { useEffect, useState } from "react"

// The signed-in user's own module actions and capabilities, for hiding what the server
// would refuse. One fetch per page load, shared by every caller. Not a security boundary.

type Perms = {
  modules: Record<string, { view: boolean; create: boolean; update: boolean; delete: boolean }>
  capabilities: string[]
}

let cache: Promise<Perms | null> | null = null

function load(): Promise<Perms | null> {
  if (!cache) {
    cache = fetch("/api/session/permissions")
      .then((r) => (r.ok ? (r.json() as Promise<Perms>) : null))
      .catch(() => null)
  }
  return cache
}

export function usePermissions() {
  const [perms, setPerms] = useState<Perms | null>(null)
  useEffect(() => {
    let live = true
    load().then((p) => {
      if (live) setPerms(p)
    })
    return () => {
      live = false
    }
  }, [])
  return {
    loaded: perms !== null,
    can: (module: string, action: "view" | "create" | "update" | "delete") => !!perms?.modules[module]?.[action],
    has: (capability: string) => !!perms?.capabilities.includes(capability),
  }
}
