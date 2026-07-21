"use client"

import { use } from "react"
import { BookingForm } from "@/components/reservations/booking-form"

export default function EditReservationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <BookingForm reservationId={id} />
}
