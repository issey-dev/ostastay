"use client"

import { useEffect, useState, use } from "react"
import { useProperty } from "@/components/providers/property-provider"
import { useRouter } from "next/navigation"
import { ArrowLeft, Users, CalendarDays, Wallet, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { format, parseISO } from "date-fns"
import { GroupPickupDialog } from "@/components/groups/group-pickup-dialog"

export default function GroupManagement({ params }: { params: Promise<{ id: string }> }) {
  const unwrappedParams = use(params)
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
    return <div className="p-8 flex justify-center text-slate-400">Loading group details...</div>
  }

  if (!group) {
    return <div className="p-8 text-center text-slate-500">Group not found.</div>
  }

  const pickedUp = group.reservations?.length || 0;
  const remaining = Math.max(0, group.totalRoomsHeld - pickedUp);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/groups">
            <Button variant="outline" size="icon">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold text-slate-900">{group.name}</h1>
              <span className={`text-xs px-2 py-1 rounded-full font-semibold ${
                group.status === 'DEFINITE' ? 'bg-emerald-100 text-emerald-700' :
                group.status === 'CANCELLED' ? 'bg-rose-100 text-rose-700' :
                'bg-amber-100 text-amber-700'
              }`}>
                {group.status}
              </span>
            </div>
            <p className="text-slate-500 mt-1 font-mono text-sm">Code: {group.code}</p>
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
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3 text-slate-500 mb-2">
            <CalendarDays className="w-5 h-5 text-indigo-500" />
            <h3 className="font-semibold">Event Dates</h3>
          </div>
          <p className="text-lg font-bold text-slate-900">
            {format(parseISO(group.startDate), "dd-MMM")} - {format(parseISO(group.endDate), "dd-MMM-yy")}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3 text-slate-500 mb-2">
            <Users className="w-5 h-5 text-indigo-500" />
            <h3 className="font-semibold">Total Held</h3>
          </div>
          <p className="text-2xl font-bold text-slate-900">{group.totalRoomsHeld}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3 text-slate-500 mb-2">
            <UserPlus className="w-5 h-5 text-emerald-500" />
            <h3 className="font-semibold">Picked Up</h3>
          </div>
          <p className="text-2xl font-bold text-slate-900">{pickedUp}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3 text-slate-500 mb-2">
            <Users className="w-5 h-5 text-amber-500" />
            <h3 className="font-semibold">Remaining</h3>
          </div>
          <p className="text-2xl font-bold text-slate-900">{remaining}</p>
        </div>
      </div>

      {/* Reservations List */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b flex justify-between items-center bg-slate-50">
          <h2 className="text-lg font-bold text-slate-800">Group Reservations (Pickups)</h2>
        </div>
        
        {group.reservations && group.reservations.length > 0 ? (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white text-slate-500 text-xs uppercase tracking-wider border-b">
                <th className="p-4 font-semibold">Res #</th>
                <th className="p-4 font-semibold">Guest</th>
                <th className="p-4 font-semibold">Dates</th>
                <th className="p-4 font-semibold">Room</th>
                <th className="p-4 font-semibold">Status</th>
                <th className="p-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {group.reservations.map((res: any) => (
                <tr key={res.id} className="hover:bg-slate-50">
                  <td className="p-4 font-mono text-sm text-slate-700">{res.reservationNumber}</td>
                  <td className="p-4 font-semibold text-slate-900">
                    {res.primaryGuest?.firstName} {res.primaryGuest?.lastName}
                  </td>
                  <td className="p-4 text-sm text-slate-600">
                    {format(parseISO(res.checkInDate), "dd-MMM")} - {format(parseISO(res.checkOutDate), "dd-MMM")}
                  </td>
                  <td className="p-4 text-sm font-semibold text-slate-700">
                    {res.assignments?.[0]?.room?.number || "Unassigned"}
                  </td>
                  <td className="p-4">
                    <span className="text-xs px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full font-semibold">
                      {res.status}
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    <Link href={`/dashboard/reservations/${res.id}`}>
                      <Button variant="ghost" size="sm" className="text-indigo-600 hover:text-indigo-800">
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
            <Users className="w-12 h-12 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-500 font-medium">No reservations picked up yet.</p>
            <p className="text-sm text-slate-400 mt-1">Click "Pickup Room" to add a guest to this group.</p>
          </div>
        )}
      </div>

    </div>
  )
}
