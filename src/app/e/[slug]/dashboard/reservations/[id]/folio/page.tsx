"use client"

import { use } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { FolioView } from "@/components/front-office/folio-panel"
import { useProperty } from "@/components/providers/property-provider"
import { Skeleton } from "@/components/ui/skeleton"
import { ArrowLeft } from "@/components/icons"
import { PageHeader } from "@/components/ui/page-header"
import { DashboardBreadcrumbs } from "@/components/shell/dashboard-breadcrumbs"

// The folio as a real page (DESKTOP_PLAN §2.2, owner-approved 2026-09-25): linkable, opens
// in its own tab next to the reservation. Same body as the FolioPanel quick-view dialog.
export default function ReservationFolioPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = use(params)
  const router = useRouter()
  const { currentProperty } = useProperty()
  const reservationUrl = `/e/${slug}/dashboard/reservations/${id}`

  if (!currentProperty?.id) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <FolioView
        reservationId={id}
        propertyId={currentProperty.id}
        onCheckedOut={() => router.push(reservationUrl)}
        renderHeader={({ actions, guestName, confirmationNo }) => (
          <div className="mb-4 border-b pb-4">
            {/* Phone: back link. Desktop: "Reservations › VM4224 › Folio" breadcrumbs. */}
            <Link href={reservationUrl} className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground md:hidden">
              <ArrowLeft className="h-4 w-4" /> {confirmationNo ? `Reservation ${confirmationNo}` : "Reservation"}
            </Link>
            <div className="max-md:hidden">
              <DashboardBreadcrumbs
                current="Folio"
                parents={confirmationNo ? [{ label: confirmationNo, href: reservationUrl }] : []}
              />
            </div>
            <PageHeader
              align="end"
              title={`Folio${guestName ? ` — ${guestName}` : ""}`}
              tabTitle={confirmationNo ? `${confirmationNo} · Folio` : "Folio"}
              actions={actions}
            />
          </div>
        )}
      />
    </div>
  )
}
