"use client"

import { useEffect, useState } from "react"
import { useProperty } from "@/components/providers/property-provider"
import { BarChart3, TrendingUp, Percent, DollarSign, BedDouble, Calendar as CalendarIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { StatTile } from "@/components/ui/stat-tile"
import { InlineLoading } from "@/components/ui/inline-loading"
import { ErrorState } from "@/components/ui/error-state"
import { EmptyState } from "@/components/ui/empty-state"

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
    return <InlineLoading lines={6} label="Loading the flash report" />
  }

  if (!data) {
    return <ErrorState title="Couldn't load the flash report" onRetry={fetchAnalytics} />
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2 max-md:text-xl">
            <BarChart3 className="w-6 h-6 text-primary" />
            Manager&apos;s Flash Report
          </h1>
          <p className="text-muted-foreground mt-1">Real-time KPI overview for {new Date(data.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, '-')}</p>
        </div>
        <Button onClick={fetchAnalytics} variant="outline" className="flex items-center gap-2 w-full sm:w-auto">
          <CalendarIcon className="w-4 h-4" />
          Refresh today
        </Button>
      </div>

      {/* KPI Cards — the shared StatTile (DESKTOP_PLAN D8); 2x2 on a phone */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatTile
          label="Occupancy"
          value={`${data.occupancyPercentage.toFixed(1)}%`}
          footnote={`${data.occupiedRoomsCount} / ${data.totalRooms} Rooms Occupied`}
          icon={Percent}
        />
        <StatTile label="ADR" value={formatCurrency(data.adr)} footnote="Average daily rate" icon={DollarSign} />
        <StatTile label="RevPAR" value={formatCurrency(data.revpar)} footnote="Revenue per available room" icon={TrendingUp} />
        <StatTile
          label="Total revenue"
          value={formatCurrency(data.totalRevenue)}
          footnote={`Room: ${formatCurrency(data.roomRevenue)} · Other: ${formatCurrency(data.otherRevenue)}`}
          icon={DollarSign}
        />
      </div>

      {/* Revenue Breakdown & Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Revenue Breakdown */}
        <div className="bg-card rounded-xl shadow-sm border border-border p-6 lg:col-span-2 max-md:p-4">
          <h3 className="text-lg font-bold text-foreground mb-6">Revenue by category</h3>
          {Object.keys(data.revenueByCategory).length === 0 ? (
            <EmptyState size="inline" title="No revenue posted today" />
          ) : (
            <div className="space-y-4">
              {Object.entries(data.revenueByCategory).map(([category, amount]) => (
                <div key={category} className="flex items-center gap-2">
                  <div className="w-20 sm:w-32 shrink-0 truncate text-sm font-medium text-muted-foreground">{category}</div>
                  <div className="flex-1 min-w-0 bg-muted rounded-none h-4 overflow-hidden relative">
                    <div
                      className="absolute top-0 left-0 h-full bg-primary rounded-none"
                      style={{ width: `${((amount as number) / data.totalRevenue) * 100}%` }}
                    ></div>
                  </div>
                  <div className="w-20 sm:w-24 shrink-0 text-right font-bold text-foreground text-sm sm:text-base">
                    {formatCurrency(amount as number)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Stats */}
        <div className="bg-card rounded-xl shadow-sm border border-border p-6 max-md:p-4">
          <h3 className="text-lg font-bold text-foreground mb-6">Daily snapshot</h3>
          <ul className="space-y-4">
            <li className="flex items-center justify-between pb-4 border-b">
              <div className="flex items-center gap-3 text-muted-foreground">
                <BedDouble className="w-5 h-5 text-muted-foreground" />
                <span>Physical rooms</span>
              </div>
              <span className="font-bold">{data.totalRooms}</span>
            </li>
            <li className="flex items-center justify-between pb-4 border-b">
              <div className="flex items-center gap-3 text-muted-foreground">
                <TrendingUp className="w-5 h-5 text-muted-foreground" />
                <span>Transactions posted</span>
              </div>
              <span className="font-bold">{data.recentActivityCount}</span>
            </li>
          </ul>
        </div>

      </div>

    </div>
  )
}
