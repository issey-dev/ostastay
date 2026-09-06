"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { GripVertical } from "@/components/icons"

// The drag wrapper every dashboard widget is rendered inside.
//
// WHY THE HANDLE IS THE DRAGGABLE ELEMENT, not the card: the cards are full of links,
// buttons and keyboard-navigable charts. Making the card itself draggable puts a drag
// gesture on top of every one of those, and text selection inside a card stops working.
// A dedicated handle keeps the card behaving normally and makes "this can be moved"
// visible, which a draggable card never is. The handle borrows the card as its drag image
// so the ghost still looks like the thing being moved.
//
// The card is the DROP target, and reordering happens on dragenter rather than on drop —
// that is what makes the grid reflow under the pointer instead of revealing the result
// only after release. `lastOver` in the parent guards the repeat events that the reflow
// itself provokes.
//
// KEYBOARD — the handle is a real button: focus it and the arrow keys move the widget one
// place. Drag-and-drop with no keyboard equivalent is not reorderable for anyone driving
// by keyboard, and this dashboard is a permission-gated work surface, not a toy.

export function WidgetShell({
  id,
  title,
  className,
  dragging,
  isDragTarget,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onNudge,
  children,
}: {
  id: string
  title: string
  className?: string
  dragging: boolean
  isDragTarget: boolean
  onDragStart: (id: string) => void
  onDragEnter: (id: string) => void
  onDragEnd: () => void
  onNudge: (id: string, direction: -1 | 1) => void
  children: React.ReactNode
}) {
  const cardRef = React.useRef<HTMLDivElement | null>(null)

  return (
    <div
      ref={cardRef}
      data-widget={id}
      className={cn(
        "group/widget relative min-w-0 transition-[opacity,transform] duration-150",
        dragging && "scale-[0.99] opacity-40",
        isDragTarget && "ring-2 ring-primary/40 rounded-2xl ring-offset-2 ring-offset-background",
        className
      )}
      onDragOver={(e) => {
        // Without preventDefault the browser refuses the drop and shows a "no entry"
        // cursor over every card.
        e.preventDefault()
        e.dataTransfer.dropEffect = "move"
      }}
      onDragEnter={() => onDragEnter(id)}
    >
      <button
        type="button"
        draggable
        aria-label={`Move ${title}. Use the arrow keys to reorder.`}
        title="Drag to move — or use the arrow keys"
        className={cn(
          "absolute -top-1.5 -right-1.5 z-10 grid h-7 w-7 cursor-grab place-items-center rounded-full bg-card text-muted-foreground shadow-elevation-2 ring-1 ring-foreground/10 transition-opacity active:cursor-grabbing",
          "opacity-0 group-hover/widget:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          dragging && "opacity-100"
        )}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move"
          // Some browsers cancel a drag that carries no payload.
          e.dataTransfer.setData("text/plain", id)
          if (cardRef.current) e.dataTransfer.setDragImage(cardRef.current, 32, 24)
          onDragStart(id)
        }}
        onDragEnd={onDragEnd}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
            e.preventDefault()
            onNudge(id, -1)
          } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
            e.preventDefault()
            onNudge(id, 1)
          }
        }}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      {children}
    </div>
  )
}
