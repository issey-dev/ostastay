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
import { CheckSquare, X, Check, Wrench } from "lucide-react"
import { WorkOrderManager } from "@/components/housekeeping/work-order-manager"

type Room = {
  id: string
  roomNumber: string
  status: "CLEAN" | "DIRTY" | "INSPECTED" | "OUT_OF_ORDER" | "OUT_OF_SERVICE"
  floor: { name: string }
  roomType: { code: string }
  maintenance?: any[]
}

const statusColors = {
  CLEAN: "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100",
  DIRTY: "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100",
  INSPECTED: "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100",
  OUT_OF_ORDER: "bg-slate-800 text-slate-100 border-slate-900 hover:bg-slate-700",
  OUT_OF_SERVICE: "bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100",
}

export default function RoomMatrix() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
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
    fetch(`/api/rooms?propertyId=${propertyId}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setRooms(data)
      })
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
    return <div className="p-10 flex justify-center text-slate-500">Loading inventory...</div>
  }

  if (!propertyId) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <h3 className="text-xl font-bold text-slate-900 mb-2">No Property Found</h3>
        <p className="text-slate-500 mb-6">Please create a property in the Properties module first.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Housekeeping Operations</h2>
        <p className="text-muted-foreground">
          Manage real-time housekeeping statuses, bulk updates, and room readiness.
        </p>
      </div>

      <Tabs defaultValue="matrix" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="matrix">Room Matrix</TabsTrigger>
          <TabsTrigger value="work-orders">Work Orders</TabsTrigger>
        </TabsList>

        <TabsContent value="matrix" className="m-0 border-none p-0 outline-none">
          <Card className="premium-card overflow-hidden relative">
            <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">Status Overview</CardTitle>
                <CardDescription>Click a room to instantly update its status (Optimistic UI Enabled).</CardDescription>
              </div>
              {!isBulkMode ? (
                <Button variant="outline" onClick={toggleBulkMode} className="shadow-sm">
                  <CheckSquare className="w-4 h-4 mr-2 text-indigo-600" /> Bulk Update
                </Button>
              ) : (
                <Button variant="ghost" onClick={toggleBulkMode} className="text-slate-500 hover:text-slate-700">
                  <X className="w-4 h-4 mr-2" /> Cancel Bulk Mode
                </Button>
              )}
            </CardHeader>
            
            {isBulkMode && (
              <div className="bg-indigo-50/80 border-b border-indigo-100 p-4 flex flex-col sm:flex-row gap-4 sm:items-center justify-between shadow-inner">
                <div className="font-medium text-indigo-900 flex items-center">
                  <span className="bg-indigo-600 text-white text-xs font-bold px-2 py-1 rounded-full mr-3">
                    {selectedRooms.length}
                  </span>
                  rooms selected
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="bg-white hover:bg-emerald-50 text-emerald-700 border-emerald-200" onClick={() => handleBulkStatusChange("CLEAN")} disabled={selectedRooms.length === 0}>
                    Mark Clean
                  </Button>
                  <Button size="sm" variant="outline" className="bg-white hover:bg-rose-50 text-rose-700 border-rose-200" onClick={() => handleBulkStatusChange("DIRTY")} disabled={selectedRooms.length === 0}>
                    Mark Dirty
                  </Button>
                  <Button size="sm" variant="outline" className="bg-white hover:bg-blue-50 text-blue-700 border-blue-200" onClick={() => handleBulkStatusChange("INSPECTED")} disabled={selectedRooms.length === 0}>
                    Mark Inspected
                  </Button>
                </div>
              </div>
            )}
            
            <CardContent className="p-6 space-y-8 bg-white/50">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500 animate-pulse">
              <div className="h-10 w-10 rounded-full border-4 border-indigo-100 border-t-indigo-600 animate-spin mb-4" />
              Loading Room Matrix...
            </div>
          ) : rooms.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 max-w-sm mx-auto">
              <div className="h-20 w-20 bg-indigo-50 rounded-full flex items-center justify-center mb-6 shadow-inner">
                <svg className="w-10 h-10 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-slate-800 mb-2">No Rooms Configured</h3>
              <p className="text-slate-500 text-sm text-center">You haven't added any floors or rooms to this property yet. Set up your property to see the grid.</p>
            </div>
          ) : (
            floors.map(floorName => (
              <div key={floorName} className="space-y-4">
                <h3 className="font-semibold text-slate-800 text-lg border-b border-slate-100 pb-2 flex items-center">
                  <span className="w-2 h-2 rounded-full bg-indigo-500 mr-2"></span> Floor {floorName}
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
                  {rooms.filter(r => (r.floor?.name || "Unassigned") === floorName).map(room => {
                    const isSelected = selectedRooms.includes(room.id)
                    const roomContent = (
                      <div className="flex flex-col w-full h-full justify-between items-start text-left relative">
                        {isSelected && (
                          <div className="absolute -top-1 -right-1 bg-indigo-600 text-white rounded-full p-0.5 shadow-md z-10">
                            <Check className="w-3 h-3" strokeWidth={3} />
                          </div>
                        )}
                        {!isSelected && room.maintenance && room.maintenance.length > 0 && (
                          <div 
                            className={`absolute -top-1 -right-1 text-white rounded-full p-1 shadow-md z-10 ${
                              room.maintenance.some((m: any) => m.priority === 'HIGH') 
                                ? 'bg-rose-500 animate-bounce' 
                                : room.maintenance.some((m: any) => m.priority === 'MEDIUM')
                                  ? 'bg-amber-500'
                                  : 'bg-blue-500'
                            }`} 
                            title="Active Maintenance"
                          >
                            <Wrench className="w-3 h-3" />
                          </div>
                        )}
                        <div className="flex justify-between w-full items-start">
                          <span className="font-bold text-xl">{room.roomNumber}</span>
                          <span className="text-[10px] uppercase font-bold tracking-wider opacity-70 bg-white/50 px-1.5 py-0.5 rounded">{room.roomType?.code}</span>
                        </div>
                        <span className="text-xs font-semibold tracking-wide">{room.status.replace(/_/g, " ")}</span>
                      </div>
                    )

                    const buttonClasses = `h-24 w-full p-3 border-2 shadow-sm transition-all duration-200 ${statusColors[room.status]} ${isBulkMode ? (isSelected ? 'ring-2 ring-indigo-600 border-transparent shadow-md' : 'hover:scale-[1.02] opacity-90') : 'hover:-translate-y-1 hover:shadow-md'}`

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
                            <DropdownMenuLabel className="text-xs text-slate-500 uppercase tracking-wider">Update Status</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="cursor-pointer font-medium" onClick={() => handleStatusChange(room.id, "CLEAN")}>
                              <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2"></span> Mark Clean
                            </DropdownMenuItem>
                            <DropdownMenuItem className="cursor-pointer font-medium" onClick={() => handleStatusChange(room.id, "DIRTY")}>
                              <span className="w-2 h-2 rounded-full bg-rose-500 mr-2"></span> Mark Dirty
                            </DropdownMenuItem>
                            <DropdownMenuItem className="cursor-pointer font-medium" onClick={() => handleStatusChange(room.id, "INSPECTED")}>
                              <span className="w-2 h-2 rounded-full bg-blue-500 mr-2"></span> Mark Inspected
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="cursor-pointer text-slate-600" onClick={() => handleStatusChange(room.id, "OUT_OF_ORDER")}>
                              Out of Order (OOO)
                            </DropdownMenuItem>
                            <DropdownMenuItem className="cursor-pointer text-slate-600" onClick={() => handleStatusChange(room.id, "OUT_OF_SERVICE")}>
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
          <Card className="premium-card overflow-hidden">
            <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
              <h3 className="text-xl font-bold text-slate-800">Maintenance & Work Orders</h3>
            </CardHeader>
            <CardContent className="p-6 bg-slate-50/30">
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
