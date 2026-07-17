"use client"

import { useEffect, useState, use } from "react"
import { useProperty } from "@/components/providers/property-provider"
import { useRouter } from "next/navigation"
import { ArrowLeft, Users, CalendarDays, Wallet, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { format, parseISO } from "date-fns"
import { GroupPickupDialog } from "@/components/groups/group-pickup-dialog"
import { statusMutedClasses } from "@/lib/status-tone"

export default function GroupManagement({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const unwrappedParams = use(params)
  const { slug } = unwrappedParams
  const { currentProperty } = useProperty()
  const [group, setGroup] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const fetchGroup = async () => {
    if (!currentProperty) return
    setLoading(true)
    try {
      const res = await fetch(`/api/groups/${unwrappedParams.id}`)
      if (res.ok) {
        const data = await res.json()
        setGroup(data)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchGroup()
  }, [currentProperty, unwrappedParams.id])

  if (loading) {
    return <div className="p-8 flex justify-center text-muted-foreground">Loading group details...</div>
  }

  if (!group) {
    return <div className="p-8 text-center text-muted-foreground">Group not found.</div>
  }

  const pickedUp = group.reservations?.length || 0;
  const remaining = Math.max(0, group.totalRoomsHeld - pickedUp);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <Link href={`/e/${slug}/dashboard/groups`}>
            <Button variant="outline" size="icon">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold text-foreground">{group.name}</h1>
              <span className={`text-xs px-2 py-1 rounded-full font-semibold border ${statusMutedClasses(group.status)}`}>
                {group.status}
              </span>
            </div>
            <p className="text-muted-foreground mt-1 font-mono text-sm">Code: {group.code}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" className="flex items-center gap-2">
            <Wallet className="w-4 h-4" />
            Master Folio
          </Button>
          <GroupPickupDialog groupId={group.id} onSaved={fetchGroup} />
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-6">
        <div className="bg-card rounded-xl shadow-elevation-1 border border-border p-5">
          <div className="flex items-center gap-3 text-muted-foreground mb-2">
            <CalendarDays className="w-5 h-5" />
            <h3 className="font-semibold">Event Dates</h3>
          </div>
          <p className="text-lg font-bold text-foreground">
            {format(parseISO(group.startDate), "dd-MMM")} - {format(parseISO(group.endDate), "dd-MMM-yy")}
          </p>
        </div>
        <div className="bg-card rounded-xl shadow-elevation-1 border border-border p-5">
          <div className="flex items-center gap-3 text-muted-foreground mb-2">
            <Users className="w-5 h-5" />
            <h3 className="font-semibold">Total Held</h3>
          </div>
          <p className="text-2xl font-bold text-foreground">{group.totalRoomsHeld}</p>
        </div>
        <div className="bg-card rounded-xl shadow-elevation-1 border border-border p-5">
          <div className="flex items-center gap-3 text-muted-foreground mb-2">
            <UserPlus className="w-5 h-5" />
            <h3 className="font-semibold">Picked Up</h3>
          </div>
          <p className="text-2xl font-bold text-foreground">{pickedUp}</p>
        </div>
        <div className="bg-card rounded-xl shadow-elevation-1 border border-border p-5">
          <div className="flex items-center gap-3 text-muted-foreground mb-2">
            <Users className="w-5 h-5" />
            <h3 className="font-semibold">Remaining</h3>
          </div>
          <p className="text-2xl font-bold text-foreground">{remaining}</p>
        </div>
      </div>

      {/* Reservations List */}
      <div className="bg-card rounded-xl shadow-elevation-1 border border-border overflow-hidden">
        <div className="px-6 py-4 border-b flex justify-between items-center bg-muted">
          <h2 className="text-lg font-bold text-foreground">Group Reservations (Pickups)</h2>
        </div>

        {group.reservations && group.reservations.length > 0 ? (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-card text-muted-foreground text-xs uppercase tracking-wider border-b">
                <th className="p-4 font-semibold">Res #</th>
                <th className="p-4 font-semibold">Guest</th>
                <th className="p-4 font-semibold">Dates</th>
                <th className="p-4 font-semibold">Room</th>
                <th className="p-4 font-semibold">Status</th>
                <th className="p-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {group.reservations.map((res: any) => (
                <tr key={res.id} className="hover:bg-muted/50">
                  <td className="p-4 font-mono text-sm text-foreground">{res.reservationNumber}</td>
                  <td className="p-4 font-semibold text-foreground">
                    {res.primaryGuest?.firstName} {res.primaryGuest?.lastName}
                  </td>
                  <td className="p-4 text-sm text-muted-foreground">
                    {format(parseISO(res.checkInDate), "dd-MMM")} - {format(parseISO(res.checkOutDate), "dd-MMM")}
                  </td>
                  <td className="p-4 text-sm font-semibold text-foreground">
                    {res.assignments?.[0]?.room?.number || "Unassigned"}
                  </td>
                  <td className="p-4">
                    <span className={`text-xs px-2 py-1 rounded-full font-semibold border ${statusMutedClasses(res.status)}`}>
                      {res.status}
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    <Link href={`/e/${slug}/dashboard/reservations/${res.id}`}>
                      <Button variant="ghost" size="sm">
                        View
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-center py-16">
            <Users className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">No reservations picked up yet.</p>
            <p className="text-sm text-muted-foreground mt-1">Click "Pickup Room" to add a guest to this group.</p>
          </div>
        )}
      </div>

    </div>
  )
}
