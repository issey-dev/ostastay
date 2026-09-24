/* eslint-disable @next/next/no-img-element -- next/image is disabled app-wide (images.unoptimized) */

/**
 * The logo as the app shows it: on a white rounded tile, so a dark or transparent logo stays
 * readable on the dark header (owner, 2026-09-24).
 */
export function LogoTile({ src, className }: { src: string | null; className?: string }) {
  return (
    <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-white ${className ?? ""}`}>
      {src ? <img src={src} alt="Logo" className="h-full w-full object-contain" /> : <span className="text-[10px] text-[var(--print-muted)]">No logo</span>}
    </div>
  )
}
