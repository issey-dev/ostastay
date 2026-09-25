"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Cropper, { type Area } from "react-easy-crop"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { toast } from "@/lib/toast"
import { LogoTile } from "@/components/ui/logo-tile"
import { LOGO_ASPECT, LOGO_HEIGHT, LOGO_WIDTH, MAX_LOGO_BYTES, MAX_LOGO_SOURCE_BYTES } from "@/lib/property-logo-spec"

// A property's logo (owner, 2026-09-24): picked here, cropped to the fixed 3:2 frame the app
// and every document use, and exported as a 900 × 600 PNG in the browser — a large photo or
// scan is compressed by that re-export alone. What falls outside the frame is dimmed, and
// zooming OUT past "fit" is allowed so a very wide or tall logo can sit whole inside the
// frame (the rest stays transparent). Uploaded to POST /api/properties/[id]/logo.

const ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml"
const MIN_ZOOM = 0.3
const MAX_ZOOM = 4

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("That file couldn't be read as an image."))
    img.src = src
  })
}

/** Draw the chosen area into a transparent LOGO_WIDTH × LOGO_HEIGHT canvas and encode PNG. */
async function renderLogo(src: string, area: Area): Promise<Blob> {
  const img = await loadImage(src)
  const canvas = document.createElement("canvas")
  canvas.width = LOGO_WIDTH
  canvas.height = LOGO_HEIGHT
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("This browser can't prepare the logo.")
  ctx.imageSmoothingQuality = "high"
  // The area may reach past the image when zoomed out — drawing the whole image at the
  // area's scale and offset leaves those parts transparent.
  const scale = LOGO_WIDTH / area.width
  ctx.drawImage(img, -area.x * scale, -area.y * scale, img.naturalWidth * scale, img.naturalHeight * scale)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
  if (!blob) throw new Error("This browser can't prepare the logo.")
  return blob
}

export function PropertyLogoUploader({
  propertyId,
  logoUrl,
  onChange,
}: {
  propertyId: string
  logoUrl: string | null
  onChange: (logoUrl: string | null) => void
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [source, setSource] = useState<string | null>(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [area, setArea] = useState<Area | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // The object URLs this component made are released when replaced or closed.
  useEffect(() => () => { if (source) URL.revokeObjectURL(source) }, [source])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const onCropComplete = useCallback((_: Area, pixels: Area) => setArea(pixels), [])

  // A live preview of exactly what will be saved, refreshed as the frame settles.
  useEffect(() => {
    if (!source || !area) return
    let cancelled = false
    const t = setTimeout(() => {
      renderLogo(source, area)
        .then((blob) => { if (!cancelled) setPreview(URL.createObjectURL(blob)) })
        .catch(() => {})
    }, 150)
    return () => { cancelled = true; clearTimeout(t) }
  }, [source, area])

  const pick = (file: File | undefined) => {
    if (!file) return
    if (!ACCEPT.split(",").includes(file.type)) {
      toast.error("Choose a PNG, JPG, WebP or SVG image.")
      return
    }
    if (file.size > MAX_LOGO_SOURCE_BYTES) {
      toast.error("That image is over 10 MB — choose a smaller file.")
      return
    }
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setArea(null)
    setPreview(null)
    setSource(URL.createObjectURL(file))
  }

  const close = () => {
    setSource(null)
    setPreview(null)
    if (fileInput.current) fileInput.current.value = ""
  }

  const save = async () => {
    if (!source || !area) return
    setBusy(true)
    try {
      const blob = await renderLogo(source, area)
      if (blob.size > MAX_LOGO_BYTES) {
        toast.error("This logo is too detailed to save — try a simpler version of it.")
        return
      }
      const form = new FormData()
      form.append("logo", blob, "logo.png")
      const res = await fetch(`/api/properties/${propertyId}/logo`, { method: "POST", body: form })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error || "The logo couldn't be saved.")
        return
      }
      onChange(body.logoUrl)
      toast.success("Logo saved — it now shows in the app and on every document.")
      close()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The logo couldn't be saved.")
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/properties/${propertyId}/logo`, { method: "DELETE" })
      if (!res.ok) {
        toast.error((await res.json().catch(() => ({}))).error || "The logo couldn't be removed.")
        return
      }
      onChange(null)
      toast.success("Logo removed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <Label>Logo</Label>
      <div className="flex flex-wrap items-center gap-4">
        <LogoTile src={logoUrl} className="h-20 w-[120px]" />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={busy}>
            {logoUrl ? "Replace logo" : "Upload logo"}
          </Button>
          {logoUrl && (
            <Button type="button" variant="ghost" size="sm" onClick={remove} disabled={busy}>
              Remove
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Shown in the app header and on every report and document. PNG, JPG, WebP or SVG up to 10 MB — you&apos;ll crop it to a 3:2 frame.
      </p>
      <input ref={fileInput} type="file" accept={ACCEPT} className="hidden" onChange={(e) => pick(e.target.files?.[0])} />

      <Dialog open={!!source} onOpenChange={(open) => !open && close()}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Crop the logo</DialogTitle>
            <DialogDescription>
              Drag to position and zoom to fit. Only what&apos;s inside the frame is shown in the app and on documents — zoom in to trim empty space, or out to fit a wide logo whole.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-[1fr_220px]">
            <div className="space-y-3">
              {/* A checkerboard behind the image shows what will be transparent. */}
              <div className="relative h-72 overflow-hidden rounded-md border bg-[conic-gradient(#e5e7eb_25%,#fff_0_50%,#e5e7eb_0_75%,#fff_0)] bg-[length:16px_16px]">
                {source && (
                  <Cropper
                    image={source}
                    crop={crop}
                    zoom={zoom}
                    aspect={LOGO_ASPECT}
                    minZoom={MIN_ZOOM}
                    maxZoom={MAX_ZOOM}
                    restrictPosition={false}
                    objectFit="contain"
                    onCropChange={setCrop}
                    onZoomChange={setZoom}
                    onCropComplete={onCropComplete}
                  />
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">Zoom</span>
                <input
                  type="range"
                  aria-label="Zoom"
                  min={MIN_ZOOM}
                  max={MAX_ZOOM}
                  step={0.01}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  className="flex-1 accent-primary"
                />
                <Button type="button" variant="ghost" size="sm" onClick={() => { setZoom(1); setCrop({ x: 0, y: 0 }) }}>
                  Fit
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">App header</p>
                <div className="flex items-center gap-2 rounded-md border bg-card p-2">
                  <LogoTile src={preview} className="h-9 w-[54px]" />
                  <span className="text-xs font-semibold text-foreground">Property name</span>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Documents &amp; reports</p>
                <div className="rounded-md border bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a blob: preview */}
                    {preview ? <img src={preview} alt="" className="h-12 w-[72px] object-contain object-left" /> : <div className="h-12 w-[72px]" />}
                    <div className="space-y-1 pt-1 text-right">
                      <div className="ml-auto h-1.5 w-16 rounded bg-[var(--print-muted)] opacity-50" />
                      <div className="ml-auto h-1.5 w-10 rounded bg-[var(--print-muted)] opacity-30" />
                    </div>
                  </div>
                  <div className="mt-3 space-y-1">
                    <div className="h-1.5 w-full rounded bg-[var(--print-muted)] opacity-15" />
                    <div className="h-1.5 w-3/4 rounded bg-[var(--print-muted)] opacity-15" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={busy}>Cancel</Button>
            <Button type="button" onClick={save} disabled={busy || !area}>{busy ? "Saving…" : "Save logo"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
