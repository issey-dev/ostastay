"use client"

import { useRouter } from "next/navigation"

// Returns a "back" handler that goes to the previous in-app page when there IS
// navigation history (so Front Desk → reservation → Back returns to Front Desk,
// reservation → profile → Back returns to the reservation), and falls back to a
// sensible default only on a fresh/direct load (new tab, refresh, external
// referrer) where there is nothing to go back to.
export function useSmartBack(fallback: string) {
  const router = useRouter()
  return () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back()
    } else {
      router.push(fallback)
    }
  }
}
