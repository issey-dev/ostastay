"use client"

import { use } from "react"
import { useSearchParams } from "next/navigation"
import { BookingForm, type ChannelChangePrefill } from "@/components/reservations/booking-form"

// ?channelChange=1&checkIn=&checkOut=&adults=&children=&roomTypeId= pre-fills a booking
// channel's changed details for the desk to review and save (ChannelReviewPanel's "Apply").
function readChannelChange(q: URLSearchParams): ChannelChangePrefill | undefined {
  if (q.get("channelChange") !== "1") return undefined
  const num = (k: string) => {
    const v = q.get(k)
    const n = v == null || v === "" ? NaN : Number(v)
    return Number.isInteger(n) && n >= 0 ? n : undefined
  }
  const day = (k: string) => {
    const v = q.get(k)
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined
  }
  return {
    checkInDate: day("checkIn"),
    checkOutDate: day("checkOut"),
    adults: num("adults"),
    children: num("children"),
    roomTypeId: q.get("roomTypeId") || undefined,
  }
}

export default function EditReservationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const q = useSearchParams()
  return <BookingForm reservationId={id} channelChange={readChannelChange(q)} />
}
