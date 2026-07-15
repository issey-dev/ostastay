"use client"

import { useEffect, useState } from "react"
import { useProperty } from "@/components/providers/property-provider"
import { BarChart3, TrendingUp, Percent, DollarSign, BedDouble, Calendar as CalendarIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

export function FlashReport() {
  const { currentProperty } = useProperty()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const fetchAnalytics = async () => {
    if (!currentProperty) return
    setLoading(true)
    try {
      const res = await fetch(`/api/analytics?propertyId=${currentProperty.id}`)
      if (res.ok) {
        const stats = await res.json()
        setData(stats)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAnalytics()
  }, [currentProperty])

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
  }

  if (loading) {
    return <div className="py-20 text-center text-slate-400">Calculating Revenue Data...</div>
  }

  if (!data) {
    return <div className="py-20 text-center text-slate-400">Failed to load analytics.</div>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-indigo-600" />
            Manager's Flash Report
          </h1>
          <p className="text-slate-500 mt-1">Real-time KPI overview for {new Date(data.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, '-')}</p>
        </div>
        <Button onClick={fetchAnalytics} variant="outline" className="flex items-center gap-2">
          <CalendarIcon className="w-4 h-4" />
          Refresh Today
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Occupancy */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col justify-between">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-1">Occupancy</p>
              <h3 className="text-3xl font-bold text-slate-900">{data.occupancyPercentage.toFixed(1)}%</h3>
            </div>
            <div className="p-3 bg-blue-50 rounded-lg">
              <Percent className="w-6 h-6 text-blue-600" />
            </div>
          </div>
          <div className="text-sm text-slate-500">
            <span className="font-semibold text-slate-700">{data.occupiedRoomsCount}</span> / {data.totalRooms} Rooms Occupied
          </div>
        </div>

        {/* ADR */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col justify-between">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-1">ADR</p>
              <h3 className="text-3xl font-bold text-slate-900">{formatCurrency(data.adr)}</h3>
            </div>
            <div className="p-3 bg-emerald-50 rounded-lg">
              <DollarSign className="w-6 h-6 text-emerald-600" />
            </div>
          </div>
          <div className="text-sm text-slate-500">Average Daily Rate</div>
        </div>

        {/* RevPAR */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col justify-between">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-1">RevPAR</p>
              <h3 className="text-3xl font-bold text-slate-900">{formatCurrency(data.revpar)}</h3>
            </div>
            <div className="p-3 bg-indigo-50 rounded-lg">
              <TrendingUp className="w-6 h-6 text-indigo-600" />
            </div>
          </div>
          <div className="text-sm text-slate-500">Revenue Per Available Room</div>
        </div>

        {/* Total Revenue */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col justify-between">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-1">Total Revenue</p>
              <h3 className="text-3xl font-bold text-slate-900">{formatCurrency(data.totalRevenue)}</h3>
            </div>
            <div className="p-3 bg-amber-50 rounded-lg">
              <DollarSign className="w-6 h-6 text-amber-600" />
            </div>
          </div>
          <div className="text-sm text-slate-500 flex justify-between">
            <span>Room: {formatCurrency(data.roomRevenue)}</span>
            <span>Other: {formatCurrency(data.otherRevenue)}</span>
          </div>
        </div>
      </div>

      {/* Revenue Breakdown & Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Revenue Breakdown */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 lg:col-span-2">
          <h3 className="text-lg font-bold text-slate-800 mb-6">Revenue by Category</h3>
          {Object.keys(data.revenueByCategory).length === 0 ? (
            <div className="text-center py-10 text-slate-500">
              No revenue posted today.
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(data.revenueByCategory).map(([category, amount]) => (
                <div key={category} className="flex items-center">
                  <div className="w-32 text-sm font-medium text-slate-600">{category}</div>
                  <div className="flex-1 bg-slate-100 rounded-full h-4 overflow-hidden relative mx-4">
                    <div 
                      className="absolute top-0 left-0 h-full bg-indigo-500 rounded-full"
                      style={{ width: `${((amount as number) / data.totalRevenue) * 100}%` }}
                    ></div>
                  </div>
                  <div className="w-24 text-right font-bold text-slate-900">
                    {formatCurrency(amount as number)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Stats */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h3 className="text-lg font-bold text-slate-800 mb-6">Daily Snapshot</h3>
          <ul className="space-y-4">
            <li className="flex items-center justify-between pb-4 border-b">
              <div className="flex items-center gap-3 text-slate-600">
                <BedDouble className="w-5 h-5 text-slate-400" />
                <span>Physical Rooms</span>
              </div>
              <span className="font-bold">{data.totalRooms}</span>
            </li>
            <li className="flex items-center justify-between pb-4 border-b">
              <div className="flex items-center gap-3 text-slate-600">
                <TrendingUp className="w-5 h-5 text-slate-400" />
                <span>Transactions Posted</span>
              </div>
              <span className="font-bold">{data.recentActivityCount}</span>
            </li>
          </ul>
        </div>

      </div>

    </div>
  )
}
