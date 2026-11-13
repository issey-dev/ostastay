"use client"

import type { ComponentType, SVGProps } from "react"
import {
  AlertTriangle,
  Award,
  Briefcase,
  Building2,
  Clock,
  Crown,
  Flag,
  Gift,
  Globe,
  Heart,
  Link2,
  Plane,
  Ship,
  Sparkles,
  Star,
  Sun,
  Tag,
  Users,
} from "@/components/icons"
import { MARKER_COLORS, type MarkerIcon, type ResolvedMarker } from "@/lib/booking-markers"
import { cn } from "@/lib/utils"

// Rendering for booking markers (Agent Portal plan A-22). The resolution rules live in
// src/lib/booking-markers.ts; this only draws them.

type Icon = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>

const ICONS: Record<MarkerIcon, Icon> = {
  Briefcase,
  Clock,
  Building2,
  Users,
  Globe,
  Link2,
  AlertTriangle,
  Star,
  Crown,
  Award,
  Heart,
  Gift,
  Flag,
  Tag,
  Plane,
  Ship,
  Sun,
  Sparkles,
} as Record<MarkerIcon, Icon>

export function MarkerIconView({ name, className }: { name: string; className?: string }) {
  const I = ICONS[name as MarkerIcon] ?? Briefcase
  return <I className={className} aria-hidden="true" />
}

/** A small icon chip in the marker's colour, with its label as the tooltip. */
export function MarkerChip({ marker, className }: { marker: ResolvedMarker; className?: string }) {
  return (
    <span
      title={marker.label}
      aria-label={marker.label}
      className={cn("inline-flex size-4 shrink-0 items-center justify-center rounded-sm", MARKER_COLORS[marker.color].chip, className)}
    >
      <MarkerIconView name={marker.icon} className="size-3" />
    </span>
  )
}

/** Left-edge class for a booking bar or card. */
export function markerEdgeClass(marker: ResolvedMarker | null): string {
  return marker ? cn("border-l-4", MARKER_COLORS[marker.color].edge) : ""
}

/** Diagonal hatching for a tentative booking (on top of its status fill). */
export const TENTATIVE_HATCH_STYLE = {
  backgroundImage:
    "repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in oklab, currentColor 14%, transparent) 6px 8px)",
} as const

/** The Tape Chart legend: one entry per distinct marker on screen. */
export function MarkerLegend({ markers }: { markers: ResolvedMarker[] }) {
  const seen = new Map<string, ResolvedMarker>()
  for (const m of markers) seen.set(`${m.label}|${m.icon}|${m.color}`, m)
  if (seen.size === 0) return null
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
      {[...seen.values()].map((m) => (
        <li key={`${m.label}|${m.icon}|${m.color}`} className="flex items-center gap-1">
          <MarkerChip marker={m} />
          {m.label}
        </li>
      ))}
    </ul>
  )
}
