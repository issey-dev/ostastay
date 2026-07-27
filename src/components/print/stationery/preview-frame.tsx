"use client"

import { useRef, useState, useLayoutEffect } from "react"

// Shrinks a full-size A4 stationary document to fit the configurator's preview column via a
// CSS transform, measuring the document's natural height so the frame collapses to the
// scaled height (no dead space, no clipping). Because it scales the *real* document
// components rather than re-styling miniatures, the preview is pixel-faithful to what prints.

const PAGE_WIDTH = 794 // ≈ A4 width at 96dpi (210mm)

export function StationeryPreviewFrame({ children }: { children: React.ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.45)
  const [height, setHeight] = useState(0)

  useLayoutEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner) return
    const update = () => {
      const w = outer.clientWidth
      const s = w / PAGE_WIDTH
      setScale(s)
      setHeight(inner.offsetHeight * s)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(outer)
    ro.observe(inner)
    return () => ro.disconnect()
  }, [])

  return (
    <div
      ref={outerRef}
      className="overflow-hidden rounded-xl border border-border bg-white shadow-md"
      style={{ height: height || undefined }}
    >
      <div
        ref={innerRef}
        style={{ width: PAGE_WIDTH, transform: `scale(${scale})`, transformOrigin: "top left" }}
        className="p-10"
      >
        {children}
      </div>
    </div>
  )
}
