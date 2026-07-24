"use client"

import { Moon, Sun } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { useDarkMode } from "@/components/providers/dark-mode-provider"

// The one reusable dark/light switch — use this everywhere a theme toggle is needed
// rather than re-implementing the icon-swap logic.
export function ThemeToggle() {
  const { isDark, toggle } = useDarkMode()

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  )
}
