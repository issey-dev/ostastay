"use client"

import { useSearchParams } from "next/navigation"
import { BookingForm } from "@/components/reservations/booking-form"

export default function NewReservationPage() {
  // Walk-in bookings arrive as ?walkin=1 from the Front Desk — arrival is then
  // locked to today's business date inside the form.
  const walkIn = useSearchParams().get("walkin") === "1"
  return <BookingForm walkIn={walkIn} />
}
