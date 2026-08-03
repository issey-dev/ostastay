"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CheckSquare, X, Check, Wrench } from "@/components/icons"
import { WorkOrderManager } from "@/components/housekeeping/work-order-manager"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/ui/error-state"
import { InfoHint } from "@/components/ui/info-hint"
import { statusMutedClasses, toneMutedClasses, toneSolidClasses } from "@/lib/status-tone"

type Room = {
  id: string
  roomNumber: string
  status: "CLEAN" | "DIRTY" | "INSPECTED" | "OUT_OF_ORDER" | "OUT_OF_SERVICE"
  floor: { name: string }
  roomType: { code: string }
  maintenance?: any[]
}


export default function RoomMatrix() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [propertyId, setPropertyId] = useState<string | null>(null)
  
  const [isBulkMode, setIsBulkMode] = useState(false)
  const [selectedRooms, setSelectedRooms] = useState<string[]>([])
  const fetchProperty = () => {
    fetch('/api/properties')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setPropertyId(data[0].id)
        } else {
          setLoading(false)
        }
      })
      .catch(e => {
        console.error(e)
        setLoading(false)
      })
  }

  useEffect(() => {
    fetchProperty()
  }, [])

  const fetchRooms = () => {
    setLoading(true)
    setLoadError(false)
    fetch(`/api/rooms?propertyId=${propertyId}`)
      .then((res) => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then((data) => {
        if (Array.isArray(data)) setRooms(data)
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (propertyId) {
      fetchRooms()
    }
  }, [propertyId])

  const handleStatusChange = async (roomId: string, newStatus: string) => {
    // Optimistic UI Update
    setRooms(rooms.map(r => r.id === roomId ? { ...r, status: newStatus as Room["status"] } : r))
    
    // Background Sync
    await fetch("/api/rooms", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: roomId, status: newStatus }),
    })
  }

  const toggleBulkMode = () => {
    setIsBulkMode(!isBulkMode)
    setSelectedRooms([])
  }

  const toggleRoomSelection = (roomId: string) => {
    if (selectedRooms.includes(roomId)) {
      setSelectedRooms(selectedRooms.filter(id => id !== roomId))
    } else {
      setSelectedRooms([...selectedRooms, roomId])
    }
  }

  const handleBulkStatusChange = async (newStatus: string) => {
    if (selectedRooms.length === 0) return
    
    // Optimistic UI Update
    setRooms(rooms.map(r => selectedRooms.includes(r.id) ? { ...r, status: newStatus as Room["status"] } : r))
    
    const idsToUpdate = [...selectedRooms]
    setIsBulkMode(false)
    setSelectedRooms([])
    
    // Background Sync
    await fetch("/api/rooms", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: idsToUpdate, status: newStatus }),
    })
  }

  // Group rooms by floor
  const floors = Array.from(new Set(rooms.map(r => r.floor?.name || "Unassigned")))
    .sort((a, b) => a.localeCompare(b))

  if (loading && !propertyId) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64 mb-2" />
        <Skeleton className="h-5 w-96 mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (!propertyId) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <h3 className="flex items-center gap-2 text-xl font-bold text-foreground mb-2">
            No Property Found
            <InfoHint label="No Property Found">Please create a property in the Properties module first.</InfoHint>
          </h3>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl lg:text-3xl">
            Housekeeping Operations
            <InfoHint label="Housekeeping Operations">Manage real-time housekeeping statuses, bulk updates, and room readiness.</InfoHint>
          </h2>
      </div>

      <Tabs defaultValue="matrix" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="matrix">Room Matrix</TabsTrigger>
          <TabsTrigger value="work-orders">Work Orders</TabsTrigger>
        </TabsList>

        <TabsContent value="matrix" className="m-0 border-none p-0 outline-none">
          <Card className="overflow-hidden relative">
            <CardHeader className="bg-muted/50 border-b border-border pb-4 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
            Status Overview
            <InfoHint label="Status Overview">Click a room to instantly update its status (Optimistic UI Enabled).</InfoHint>
          </CardTitle>
              </div>
              {!isBulkMode ? (
                <Button variant="outline" onClick={toggleBulkMode} className="shadow-sm">
                  <CheckSquare className="w-4 h-4 mr-2 text-primary" /> Bulk Update
                </Button>
              ) : (
                <Button variant="ghost" onClick={toggleBulkMode} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4 mr-2" /> Cancel Bulk Mode
                </Button>
              )}
            </CardHeader>
            
            {isBulkMode && (
              <div className="bg-muted border-b border-border p-4 flex flex-col sm:flex-row gap-4 sm:items-center justify-between shadow-inner">
                <div className="font-medium text-foreground flex items-center">
                  <span className="bg-primary text-primary-foreground text-xs font-bold px-2 py-1 rounded-none mr-3">
                    {selectedRooms.length}
                  </span>
                  rooms selected
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className={toneMutedClasses("success")} onClick={() => handleBulkStatusChange("CLEAN")} disabled={selectedRooms.length === 0}>
                    Mark Clean
                  </Button>
                  <Button size="sm" variant="outline" className={toneMutedClasses("danger")} onClick={() => handleBulkStatusChange("DIRTY")} disabled={selectedRooms.length === 0}>
                    Mark Dirty
                  </Button>
                  <Button size="sm" variant="outline" className={toneMutedClasses("info")} onClick={() => handleBulkStatusChange("INSPECTED")} disabled={selectedRooms.length === 0}>
                    Mark Inspected
                  </Button>
                </div>
              </div>
            )}
            
            <CardContent className="p-6 space-y-8">
          {loading ? (
            <div className="space-y-8">
              <div>
                <Skeleton className="h-5 w-24 mb-3" />
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-24" />
                  ))}
                </div>
              </div>
            </div>
          ) : loadError ? (
            <ErrorState title="Couldn't load rooms" onRetry={fetchRooms} />
          ) : rooms.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 max-w-sm mx-auto">
              <div className="h-20 w-20 bg-muted rounded-none flex items-center justify-center mb-6 shadow-inner">
                <svg className="w-10 h-10 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
              </div>
              <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground mb-2">
            No Rooms Configured
            <InfoHint label="No Rooms Configured">You haven&apos;t added any floors or rooms to this property yet. Set up your property to see the grid.</InfoHint>
          </h3>
            </div>
          ) : (
            floors.map(floorName => (
              <div key={floorName} className="space-y-4">
                <h3 className="font-semibold text-foreground text-lg border-b border-border pb-2 flex items-center">
                  <span className="w-2 h-2 rounded-none bg-foreground mr-2"></span> Floor {floorName}
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
                  {rooms.filter(r => (r.floor?.name || "Unassigned") === floorName).map(room => {
                    const isSelected = selectedRooms.includes(room.id)
                    const roomContent = (
                      <div className="flex flex-col w-full h-full justify-between items-start text-left relative">
                        {isSelected && (
                          <div className="absolute -top-1 -right-1 bg-primary text-primary-foreground rounded-none p-0.5 shadow-md z-10">
                            <Check className="w-3 h-3" strokeWidth={3} />
                          </div>
                        )}
                        {!isSelected && room.maintenance && room.maintenance.length > 0 && (
                          <div
                            className={`absolute -top-1 -right-1 rounded-none p-1 shadow-md z-10 ${
                              room.maintenance.some((m: any) => m.priority === 'HIGH')
                                ? `${toneSolidClasses("danger")} animate-pulse`
                                : room.maintenance.some((m: any) => m.priority === 'MEDIUM')
                                  ? toneSolidClasses("warning")
                                  : toneSolidClasses("info")
                            }`}
                            title="Active Maintenance"
                          >
                            <Wrench className="w-3 h-3" />
                          </div>
                        )}
                        <div className="flex justify-between w-full items-start">
                          <span className="font-bold text-xl">{room.roomNumber}</span>
                          <span className="text-[10px] uppercase font-bold tracking-wider opacity-70 bg-background/50 px-1.5 py-0.5 rounded">{room.roomType?.code}</span>
                        </div>
                        <span className="text-xs font-semibold tracking-wide">{room.status.replace(/_/g, " ")}</span>
                      </div>
                    )

                    const buttonClasses = `h-24 w-full p-3 border-2 shadow-sm transition-all duration-200 ${statusMutedClasses(room.status)} ${isBulkMode ? (isSelected ? 'ring-2 ring-ring border-transparent shadow-md' : 'hover:scale-[1.02] opacity-90') : 'hover:-translate-y-1 hover:shadow-md'}`

                    if (isBulkMode) {
                      return (
                        <Button 
                          key={room.id}
                          variant="outline" 
                          onClick={() => toggleRoomSelection(room.id)}
                          className={buttonClasses}
                        >
                          {roomContent}
                        </Button>
                      )
                    }

                    return (
                      <DropdownMenu key={room.id}>
                        <DropdownMenuTrigger render={<Button variant="outline" className={buttonClasses} />}>
                          {roomContent}
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-48">
                          <DropdownMenuGroup>
                            <DropdownMenuLabel className="text-xs text-muted-foreground uppercase tracking-wider">Update Status</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="cursor-pointer font-medium" onClick={() => handleStatusChange(room.id, "CLEAN")}>
                              <span className="w-2 h-2 rounded-none bg-success mr-2"></span> Mark Clean
                            </DropdownMenuItem>
                            <DropdownMenuItem className="cursor-pointer font-medium" onClick={() => handleStatusChange(room.id, "DIRTY")}>
                              <span className="w-2 h-2 rounded-none bg-destructive mr-2"></span> Mark Dirty
                            </DropdownMenuItem>
                            <DropdownMenuItem className="cursor-pointer font-medium" onClick={() => handleStatusChange(room.id, "INSPECTED")}>
                              <span className="w-2 h-2 rounded-none bg-info mr-2"></span> Mark Inspected
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="cursor-pointer text-muted-foreground" onClick={() => handleStatusChange(room.id, "OUT_OF_ORDER")}>
                              Out of Order (OOO)
                            </DropdownMenuItem>
                            <DropdownMenuItem className="cursor-pointer text-muted-foreground" onClick={() => handleStatusChange(room.id, "OUT_OF_SERVICE")}>
                              Out of Service (OOS)
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )
                  })}
                </div>
              </div>
            ))
          )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="work-orders" className="m-0 border-none p-0 outline-none">
          <Card className="overflow-hidden">
            <CardHeader className="bg-muted/50 border-b border-border pb-4">
              <h3 className="text-xl font-bold text-foreground">Maintenance & Work Orders</h3>
            </CardHeader>
            <CardContent className="p-6 bg-muted/30">
              <WorkOrderManager 
                propertyId={propertyId} 
                rooms={rooms} 
                refreshMatrix={fetchRooms} 
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
