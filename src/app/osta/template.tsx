"use client"

import { motion } from "motion/react"
import { EASE_OUT, useMotionOk } from "@/components/dashboard/motion-kit"

// The same page transition as the tenant dashboard (src/app/e/[slug]/dashboard/template.tsx):
// a template remounts on every navigation between console pages, so each page arrives
// with a short fade and a 6px rise, nothing on exit. The print page lives in this shell
// too; the transform settles to none, so printing is unaffected.
export default function OstaTemplate({ children }: { children: React.ReactNode }) {
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
