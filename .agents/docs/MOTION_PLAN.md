# Motion plan

Motion in the app is built on the `motion` package through ONE kit:
`src/components/dashboard/motion-kit.tsx` (easing, durations, stagger, `WidgetReveal`,
`CountUp`, `RiseItem`, `useReveal`). Do not hand-roll another animation approach; extend the kit.

## Principles (the rule that keeps it from looking over-engineered)

- One easing curve (out-expo `[0.22, 1, 0.36, 1]`; ease-in-out only for line draws) and the same
  durations everywhere, taken from `DUR` / `STAGGER` in the kit.
- Plays ONCE per mount. Never replay on refresh, filter, sort or paging. After first reveal, only
  `CountUp` reacts to new data (tween old → new).
- Only the first screen animates; whole entrance stays under ~1.2 s (stagger capped at 0.6 s).
- Reduced motion → final state immediately (`useMotionOk()` / `useReducedMotion`).
- Print / PDF views never animate.
- Motion is for arrival and for explaining a change (a moved booking). Never for screens people
  work in all shift: forms, settings, housekeeping cards, Front Desk worklists, sidebar/header.

## Done

- Dashboard (8.8.5+): `StatTile` "instrument" tile (corner glow kept at 5%), count-up figures,
  drawn lines / rising bars / sweeping donut / growing ranked + stacked bars + meters, widget
  stagger, worklist rows rising in.
- `ui/stat-tile` re-exports the dashboard tile, so Reports KPI strip, Front Office, Group detail,
  Night Audit reports and the Osta admin screens already get the new tile and count-up.
- Reports charts (`report-visuals.tsx`) use the animated chart primitives.
- Cashiering "Shift closed" reconciliation figures count up (a one-off moment). The live open-shift
  summary is deliberately NOT animated: its numbers change as payments post.

## Findings

- Revenue, Debtors and Payments pages have no headline figure strips (tables / forms), so there is
  nothing to animate there. Adding strips would be a product decision, not a motion one.

## Also done

- Lists (ListTable, every `TableBody`, `MobileCardList`): rows/cards POP IN ONE BY ONE on first load — 55 ms apart, 14px rise + slight scale, first 14 then the rest together (none past 30). Pure CSS: `.cascade` in globals.css, toggled by `useIntro()` for 1.6 s. Filter / page / refresh rows never animate; sorting never remounts. `<TableBody cascade={false}>` opts out.
- Page transition: `src/app/e/[slug]/dashboard/template.tsx`, 180 ms fade + 6 px rise, no exit.

- Tape Chart and Availability grid: one 300 ms fade-in when the grid first appears (tw-animate
  `animate-in fade-in-0`, off under reduced motion). Bars do not animate in.
- Tape Chart move: the moved booking pulses twice in its new slot (`.tape-landed` in globals.css)
  instead of a layout animation. Why: bars are HTML5-draggable grid items (motion's drag props would
  collide with the handlers) and sliding every bar on each scroll / window change is noise on the
  busiest screen. Revisit only if the pulse proves too subtle.
- Sheet and toast easing aligned to the kit curve. Dialog / alert-dialog already fade+zoom in 100 ms,
  left as they are.



## Next (not started)

Nothing planned. Candidates if asked: Revenue/Debtors/Payments figure strips (product call).
