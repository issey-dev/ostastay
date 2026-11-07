"use client"

import { motion } from "motion/react"
import { EASE_OUT, useMotionOk } from "@/components/dashboard/motion-kit"

// A template (unlike a layout) remounts on every navigation between dashboard pages, which
// is what makes this a page transition: a short fade with a 6px rise, nothing on exit.
// Kept deliberately small — staff move between screens all shift, so it must read as
// "the page arrived", not as an effect. Opacity + y only; `y` settles back to no transform,
// so sticky headers and fixed overlays on the page behave normally afterwards.
export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  const ok = useMotionOk()
  return (
    <motion.div
      initial={ok ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  )
}
