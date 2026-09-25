"use client"

import { useEffect } from "react"
import { ErrorState } from "@/components/ui/error-state"

// The error boundary body for a dashboard/Hub page (error.tsx): the shell stays, the page area
// says what happened and offers a retry — instead of Next's full-screen crash.
export function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])
  return (
    <ErrorState
      title="This page couldn't load"
      description="Something went wrong on our side. Try again, or open another page from the menu."
      onRetry={retry}
    />
  )
}
