"use client"

import { useEffect, useState } from "react"
import { useProperty } from "@/components/providers/property-provider"
import { Users, Plus, Calendar as CalendarIcon, UserCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { format, parseISO } from "date-fns"

export default function GroupsDashboard() {
  const { currentProperty } = useProperty()
  const [groups, setGroups] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const fetchGroups = async () => {
    if (!currentProperty) return
    setLoading(true)
    try {
      const res = await fetch(`/api/groups?propertyId=${currentProperty.id}`)
      if (res.ok) {
        const data = await res.json()
        setGroups(data)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchGroups()
  }, [currentProperty])

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <Users className="w-6 h-6 text-indigo-600" />
            </div>
            Groups & Allotments
          </h1>
          <p className="text-slate-500 mt-2">Manage blocks of rooms for weddings, corporate events, and tours.</p>
        </div>
        <Link href="/dashboard/groups/new">
          <Button className="flex items-center gap-2">
            <Plus className="w-4 h-4" />
            New Group Block
          </Button>
        </Link>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b">
              <th className="p-4 font-semibold">Group Code</th>
              <th className="p-4 font-semibold">Name</th>
              <th className="p-4 font-semibold">Dates</th>
              <th className="p-4 font-semibold text-center">Status</th>
              <th className="p-4 font-semibold text-center">Rooms Held</th>
              <th className="p-4 font-semibold text-center">Picked Up</th>
              <th className="p-4 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={7} className="text-center py-10 text-slate-400">Loading groups...</td>
              </tr>
            ) : groups.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-16">
                  <Users className="w-12 h-12 text-slate-200 mx-auto mb-3" />
                  <p className="text-slate-500 font-medium">No Group Blocks found</p>
                  <p className="text-sm text-slate-400">Create a block to reserve inventory for an event.</p>
                </td>
              </tr>
            ) : (
              groups.map((group) => {
                const pickedUp = group.reservations?.length || 0;
                return (
                  <tr key={group.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4">
                      <span className="font-mono text-xs font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded">
                        {group.code}
                      </span>
                    </td>
                    <td className="p-4 font-semibold text-slate-900">{group.name}</td>
                    <td className="p-4 text-sm text-slate-600 flex items-center gap-2">
                      <CalendarIcon className="w-4 h-4 text-slate-400" />
                      {format(parseISO(group.startDate), "dd-MMM")} - {format(parseISO(group.endDate), "dd-MMM-yy")}
                    </td>
                    <td className="p-4 text-center">
                      <span className={`text-xs px-2 py-1 rounded-full font-semibold ${
                        group.status === 'DEFINITE' ? 'bg-emerald-100 text-emerald-700' :
                        group.status === 'CANCELLED' ? 'bg-rose-100 text-rose-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {group.status}
                      </span>
                    </td>
                    <td className="p-4 text-center font-semibold text-slate-700">{group.totalRoomsHeld}</td>
                    <td className="p-4 text-center">
                      <div className="flex items-center justify-center gap-1.5 font-semibold text-indigo-600">
                        <UserCheck className="w-4 h-4" />
                        {pickedUp}
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <Link href={`/dashboard/groups/${group.id}`}>
                        <Button variant="outline" size="sm">Manage</Button>
                      </Link>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
