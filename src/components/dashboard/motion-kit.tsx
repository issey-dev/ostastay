"use client"

import * as React from "react"
import { animate, motion, useInView, useReducedMotion } from "motion/react"

// One motion language for every Operations Dashboard widget.
//
// Order inside a widget: the card lifts in (WidgetReveal, staggered by grid position),
// the figure counts and the chart draws once it is on screen, then small accents (delta
// pill, last-point dot) land on top. Everything arrives on the same out-expo curve; line
// draws use ease-in-out because a stroke that decelerates to a stop looks unfinished.
//
// PLAYS ONCE PER MOUNT. The dashboard refetches every two minutes — replaying the whole
// entrance each time would be exhausting. After first reveal only CountUp reacts to new
// data (it tweens from the old value), and chart marks simply take their new geometry.
//
// REDUCED MOTION: `useMotionOk()` is false → components render their final state at once.

export const EASE_OUT = [0.22, 1, 0.36, 1] as const
export const EASE_DRAW = [0.65, 0, 0.35, 1] as const
export const SPRING_POP = { type: "spring", stiffness: 520, damping: 22 } as const

export const DUR = { enter: 0.6, count: 0.9, draw: 1.0, bar: 0.7, grow: 0.8 } as const
export const STAGGER = { widget: 0.06, item: 0.055, cap: 0.6 } as const

const VIEWPORT = { once: true, margin: "0px 0px -6% 0px" } as const

/** Delay inherited from the widget's place in the grid, so a card's figure and chart
 *  start just after the card itself has landed. */
const BaseDelayContext = React.createContext(0)
export const BaseDelayProvider = BaseDelayContext.Provider
export const useBaseDelay = () => React.useContext(BaseDelayContext)

export function useMotionOk() {
  return !useReducedMotion()
}

/** Reveal-once trigger. Pass an existing ref (a chart already measuring its width) or
 *  use the one returned. `show` is true immediately when motion is off. */
export function useReveal<T extends Element>(external?: React.RefObject<T | null>) {
  const own = React.useRef<T | null>(null)
  const ref = external ?? own
  const ok = useMotionOk()
  const inView = useInView(ref as React.RefObject<Element | null>, VIEWPORT)
  return { ref, ok, show: inView || !ok, delay: useBaseDelay() }
}

/** Wraps a whole widget card: fade, rise and settle. */
export function WidgetReveal({ index, children }: { index: number; children: React.ReactNode }) {
  const ok = useMotionOk()
  const delay = Math.min(index * STAGGER.widget, STAGGER.cap)
  return (
    <BaseDelayProvider value={delay}>
      <motion.div
        initial={ok ? { opacity: 0, y: 14, scale: 0.98 } : false}
        whileInView={{ opacity: 1, y: 0, scale: 1 }}
        viewport={VIEWPORT}
        transition={{ duration: DUR.enter, ease: EASE_OUT, delay }}
      >
        {children}
      </motion.div>
    </BaseDelayProvider>
  )
}

/** A list row that rises in, `i`-th in its list. */
export function RiseItem({ i = 0, className, children }: { i?: number; className?: string; children: React.ReactNode }) {
  const ok = useMotionOk()
  const base = useBaseDelay()
  return (
    <motion.li
      className={className}
      initial={ok ? { opacity: 0, y: 8 } : false}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={VIEWPORT}
      transition={{ duration: DUR.enter * 0.8, ease: EASE_OUT, delay: base + 0.15 + Math.min(i * STAGGER.item, STAGGER.cap) }}
    >
      {children}
    </motion.li>
  )
}

// ── CountUp ───────────────────────────────────────────────────────────────────────

const NUMBER = /-?\d[\d,]*(?:\.\d+)?/

function parseNumeric(value: string) {
  const m = NUMBER.exec(value)
  if (!m) return null
  const raw = m[0]
  return {
    n: parseFloat(raw.replace(/,/g, "")),
    decimals: raw.split(".")[1]?.length ?? 0,
    grouped: raw.includes(","),
    prefix: value.slice(0, m.index),
    suffix: value.slice(m.index + raw.length),
  }
}

function renderNumeric(p: NonNullable<ReturnType<typeof parseNumeric>>, n: number) {
  const body = n.toLocaleString("en-US", {
    minimumFractionDigits: p.decimals,
    maximumFractionDigits: p.decimals,
    useGrouping: p.grouped,
  })
  return `${p.prefix}${body}${p.suffix}`
}

/**
 * Counts the first number in an already-formatted string up from zero when it scrolls
 * into view, and tweens old → new when the data refreshes. The exact original string is
 * always what's rendered once the tween settles, so the app's own number formatting
 * (currency, locale, compact suffix) is never second-guessed — the animation only
 * approximates it in between.
 */
export function CountUp({ value, className, duration = DUR.count }: { value: string; className?: string; duration?: number }) {
  const ok = useMotionOk()
  const base = useBaseDelay()
  const ref = React.useRef<HTMLSpanElement | null>(null)
  const inView = useInView(ref, VIEWPORT)
  const parsed = React.useMemo(() => parseNumeric(value), [value])
  const animated = ok && parsed !== null
  // Hold the zero state until the figure is on screen so it doesn't finish counting
  // below the fold.
  const [text, setText] = React.useState<string | null>(() => (animated && parsed ? renderNumeric(parsed, 0) : null))
  const settled = React.useRef<number | null>(null)

  React.useEffect(() => {
    if (!animated || !parsed) return
    const first = settled.current === null
    if (first && !inView) return
    const from = first ? 0 : (settled.current as number)
    if (from === parsed.n) {
      settled.current = parsed.n
      setText(null)
      return
    }
    const controls = animate(from, parsed.n, {
      duration: first ? duration : duration * 0.7,
      ease: EASE_OUT,
      delay: first ? base + 0.15 : 0,
      onUpdate: (v) => setText(renderNumeric(parsed, v)),
      onComplete: () => {
        settled.current = parsed.n
        setText(null)
      },
    })
    return () => controls.stop()
  }, [animated, parsed, inView, base, duration])

  return (
    <span ref={ref} suppressHydrationWarning className={className} style={text !== null ? { fontVariantNumeric: "tabular-nums" } : undefined}>
      {text ?? value}
    </span>
  )
}
