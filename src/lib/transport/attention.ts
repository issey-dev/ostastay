// "Needs attention" — warnings worked out live from a booking's flight and its departure,
// never stored (nothing to drift) and never blocking (section 3.2 of the brief). Pure, so
// the rules are unit-tested directly.
//
//   PICKUP    the boat must leave at least `tolerance` minutes after the flight lands
//             (immigration, baggage, the walk to the jetty).
//   DROP_OFF  the boat must reach the airport (departure + route duration) at least
//             `tolerance` minutes before the flight leaves (check-in).
//   Both      a flight time that changed after the booking joined its manifest is flagged
//             until someone confirms the booking still fits (re-attach or "keep").
//             An airport transfer with no flight details is flagged once it is confirmed.

export type AttentionInput = {
  direction: string
  status: string
  flightAt: Date | null
  flightNo?: string | null
  /** The effective departure: the manifest's once attached, else the booking's own. */
  departureAt: Date | null
  durationMinutes: number | null
  toleranceMinutes: number
  onManifest: boolean
  flightAtOnManifest: Date | null
  /** Route is an airport transfer, or its transport type requires flight details. */
  needsFlight: boolean
  /** The linked reservation's status, if any. */
  reservationStatus?: string | null
}

export type AttentionReason = { code: string; message: string }

const ACTIVE = new Set(["CONFIRMED", "ASSIGNED"])
const mins = (ms: number) => Math.round(ms / 60_000)

export function attentionFor(b: AttentionInput): AttentionReason[] {
  const out: AttentionReason[] = []
  if (!ACTIVE.has(b.status) && b.status !== "DRAFT") return out

  if (b.flightAt && b.departureAt) {
    const tol = Math.max(0, b.toleranceMinutes)
    if (b.direction === "PICKUP") {
      const gap = mins(b.departureAt.getTime() - b.flightAt.getTime())
      if (gap < tol) {
        out.push({
          code: "TOO_SOON_AFTER_LANDING",
          message:
            gap < 0
              ? `Departs ${-gap} min before the flight lands`
              : `Departs ${gap} min after landing — allow at least ${tol} min`,
        })
      }
    } else {
      const arrive = b.departureAt.getTime() + (b.durationMinutes ?? 0) * 60_000
      const gap = mins(b.flightAt.getTime() - arrive)
      if (gap < tol) {
        out.push({
          code: "TOO_CLOSE_TO_FLIGHT",
          message:
            gap < 0
              ? `Reaches the airport ${-gap} min after the flight leaves`
              : `Reaches the airport ${gap} min before the flight — allow at least ${tol} min`,
        })
      }
    }
  }

  if (b.onManifest && b.flightAtOnManifest && b.flightAt && b.flightAt.getTime() !== b.flightAtOnManifest.getTime()) {
    out.push({ code: "FLIGHT_CHANGED", message: "Flight time changed since the booking was added to the departure" })
  }
  if (b.onManifest && b.flightAtOnManifest && !b.flightAt) {
    out.push({ code: "FLIGHT_CHANGED", message: "Flight time removed since the booking was added to the departure" })
  }

  // The stay was cancelled or never arrived, but the transfer is still live: Night Audit
  // won't charge it — someone should cancel it or mark it a no-show.
  if (b.reservationStatus === "CANCELLED" || b.reservationStatus === "NO_SHOW") {
    out.push({
      code: "RESERVATION_CLOSED",
      message: b.reservationStatus === "CANCELLED" ? "The reservation is cancelled" : "The reservation is a no-show",
    })
  }

  if (b.needsFlight && ACTIVE.has(b.status) && (!b.flightAt || !b.flightNo)) {
    out.push({ code: "FLIGHT_MISSING", message: "Flight details missing" })
  }
  return out
}

/** Pax on a manifest vs the vessel's seats — a soft warning only. */
export function capacityState(pax: number, capacity: number | null | undefined): "OK" | "FULL" | "OVER" | "UNKNOWN" {
  if (!capacity || capacity <= 0) return "UNKNOWN"
  if (pax > capacity) return "OVER"
  if (pax === capacity) return "FULL"
  return "OK"
}
