"use client"

import { useRef, useState, useCallback, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { RotateCcw } from "@/components/icons"

type Props = {
  value: string | null
  onChange: (dataUrl: string | null) => void
}

// A live, hand-drawn signature — required for eRegistration's government-compliance
// requirement (a real signature, not a typed name or a checkbox). Plain canvas + pointer
// events, no new dependency; exports a PNG data URL matching what the server validates
// (src/lib/eregistration/storage.ts's isValidSignatureDataUrl).
export function SignaturePad({ value, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const hasStroke = useRef(false)
  const [empty, setEmpty] = useState(!value)

  const getCtx = () => canvasRef.current?.getContext("2d") ?? null

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // Backing store at device pixel ratio for crisp strokes, CSS size stays fixed.
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * ratio
    canvas.height = rect.height * ratio
    const ctx = getCtx()
    if (!ctx) return
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2
    ctx.lineCap = "round"
    ctx.strokeStyle = "#111827"
    if (value) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height)
      img.src = value
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const posFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    const ctx = getCtx()
    const { x, y } = posFromEvent(e)
    ctx?.beginPath()
    ctx?.moveTo(x, y)
  }

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const ctx = getCtx()
    const { x, y } = posFromEvent(e)
    ctx?.lineTo(x, y)
    ctx?.stroke()
    hasStroke.current = true
    setEmpty(false)
  }

  const end = useCallback(() => {
    if (!drawing.current) return
    drawing.current = false
    if (hasStroke.current && canvasRef.current) {
      onChange(canvasRef.current.toDataURL("image/png"))
    }
  }, [onChange])

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = getCtx()
    if (canvas && ctx) {
      const rect = canvas.getBoundingClientRect()
      ctx.clearRect(0, 0, rect.width, rect.height)
    }
    hasStroke.current = false
    setEmpty(true)
    onChange(null)
  }

  return (
    <div className="space-y-2">
      <div className="rounded-md border bg-white">
        <canvas
          ref={canvasRef}
          className="h-40 w-full touch-none cursor-crosshair rounded-md"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
        />
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {empty ? "Sign above with your finger, stylus, or mouse." : "Signature captured."}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={clear}>
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Clear
        </Button>
      </div>
    </div>
  )
}
