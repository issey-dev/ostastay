"use client"

import { useEffect, useState, useMemo } from "react"
import Link from "next/link"
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2 } from "lucide-react"
import { format, addDays, subDays, differenceInDays, startOfDay, isWithinInterval } from "date-fns"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type Reservation = {
  id: string
  confirmationNo: string
  status: string
  checkInDate: string
  checkOutDate: string
  primaryGuest: { firstName: string, lastName: string, companyName: string, profileType: string }
  roomId: string | null
}

type Room = { id: string, roomNumber: string, roomTypeId: string }
type RoomType = { id: string, name: string, code: string }

const statusColors: Record<string, string> = {
  RESERVED: "bg-blue-200 border-blue-400 text-blue-900",
  IN_HOUSE: "bg-green-200 border-green-400 text-green-900",
  CHECKED_OUT: "bg-slate-200 border-slate-400 text-slate-900",
  NO_SHOW: "bg-red-200 border-red-400 text-red-900",
  CANCELLED: "bg-red-100 border-red-300 text-red-800 opacity-50",
}

export default function ReservationsCalendarPage() {
  const [loading, setLoading] = useState(true)
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  
  const [windowStart, setWindowStart] = useState(startOfDay(new Date()))
  const WINDOW_DAYS = 14

  const propertyId = "00000000-0000-0000-0000-000000000000" // Hardcoded for demo

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`/api/reservations?propertyId=${propertyId}`).then(r => r.json()),
      fetch(`/api/rooms?propertyId=${propertyId}`).then(r => r.json()),
      fetch(`/api/room-types?propertyId=${propertyId}`).then(r => r.json())
    ]).then(([resData, rmData, rtData]) => {
      if (Array.isArray(resData)) setReservations(resData)
      if (Array.isArray(rmData)) setRooms(rmData)
      if (Array.isArray(rtData)) setRoomTypes(rtData)
    }).finally(() => setLoading(false))
  }, [])

  // Generate the array of dates for the header
  const windowDates = useMemo(() => {
    const dates = []
    for (let i = 0; i < WINDOW_DAYS; i++) {
      dates.push(addDays(windowStart, i))
    }
    return dates
  }, [windowStart])

  const windowEnd = addDays(windowStart, WINDOW_DAYS)

  // Group rooms by room type
  const groupedRooms = useMemo(() => {
    const map = new Map<string, Room[]>()
    roomTypes.forEach(rt => map.set(rt.id, []))
    rooms.forEach(rm => {
      if (map.has(rm.roomTypeId)) {
        map.get(rm.roomTypeId)!.push(rm)
      }
    })
    return Array.from(map.entries()).map(([rtId, rms]) => ({
      roomType: roomTypes.find(rt => rt.id === rtId)!,
      rooms: rms.sort((a, b) => a.roomNumber.localeCompare(b.roomNumber))
    })).filter(g => g.roomType && g.rooms.length > 0)
  }, [rooms, roomTypes])

  // Filter and process reservations for the current window
  const visibleReservations = useMemo(() => {
    return reservations.filter(res => {
      if (res.status === 'CANCELLED') return false
      const ci = new Date(res.checkInDate)
      const co = new Date(res.checkOutDate)
      // Check if the reservation overlaps with the window
      return ci < windowEnd && co > windowStart
    })
  }, [reservations, windowStart, windowEnd])

  const renderReservationBar = (res: Reservation) => {
    const ci = startOfDay(new Date(res.checkInDate))
    const co = startOfDay(new Date(res.checkOutDate))
    
    let startIndex = differenceInDays(ci, windowStart)
    let endIndex = differenceInDays(co, windowStart)
    
    // Clamp to window boundaries
    let isCutLeft = false
    let isCutRight = false
    
    if (startIndex < 0) {
      startIndex = 0
      isCutLeft = true
    }
    if (endIndex > WINDOW_DAYS) {
      endIndex = WINDOW_DAYS
      isCutRight = true
    }
    
    if (startIndex >= endIndex) return null // Should not happen given overlap filter, but safe guard

    const colorClass = statusColors[res.status] || "bg-slate-200 border-slate-400 text-slate-800"
    const name = res.primaryGuest.profileType === 'COMPANY' || res.primaryGuest.profileType === 'TRAVEL_AGENT'
      ? res.primaryGuest.companyName
      : `${res.primaryGuest.firstName} ${res.primaryGuest.lastName || ''}`.trim()

    return (
      <div 
        key={res.id}
        className={`absolute top-1 bottom-1 flex items-center px-2 text-xs font-semibold overflow-hidden whitespace-nowrap shadow-sm border rounded-sm z-10 ${colorClass}`}
        style={{
          // Left position is percentage of total width
          left: `${(startIndex / WINDOW_DAYS) * 100}%`,
          // Width is percentage of total width based on duration
          width: `${((endIndex - startIndex) / WINDOW_DAYS) * 100}%`,
          marginLeft: isCutLeft ? '0' : '2px',
          marginRight: isCutRight ? '0' : '2px',
          borderLeftWidth: isCutLeft ? '0' : '1px',
          borderRightWidth: isCutRight ? '0' : '1px',
          borderTopLeftRadius: isCutLeft ? '0' : '0.25rem',
          borderBottomLeftRadius: isCutLeft ? '0' : '0.25rem',
          borderTopRightRadius: isCutRight ? '0' : '0.25rem',
          borderBottomRightRadius: isCutRight ? '0' : '0.25rem',
        }}
        title={`${name} (${res.confirmationNo})`}
      >
        <span className="truncate">{name}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 h-full">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/reservations">
            <Button variant="outline" size="icon" className="shadow-sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Tape Chart</h2>
            <p className="text-muted-foreground">
              Visual overview of reservations and room availability.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-white border p-1 rounded-md shadow-sm">
          <Button variant="ghost" size="sm" onClick={() => setWindowStart(subDays(windowStart, 7))}>
            <ChevronLeft className="h-4 w-4 mr-1" /> -7d
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setWindowStart(startOfDay(new Date()))}>
            Today
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setWindowStart(addDays(windowStart, 7))}>
            +7d <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>

      <Card className="flex-1 overflow-hidden flex flex-col shadow-md">
        <CardHeader className="bg-slate-50 border-b py-4">
          <CardTitle className="text-lg flex items-center justify-between">
            <span>Room Allocation</span>
            <span className="text-sm font-normal text-muted-foreground flex gap-4">
              <span className="flex items-center gap-1"><div className="w-3 h-3 bg-blue-200 border border-blue-400 rounded-sm"></div> Reserved</span>
              <span className="flex items-center gap-1"><div className="w-3 h-3 bg-green-200 border border-green-400 rounded-sm"></div> In House</span>
              <span className="flex items-center gap-1"><div className="w-3 h-3 bg-slate-200 border border-slate-400 rounded-sm"></div> Checked Out</span>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-auto flex-1">
          {loading ? (
            <div className="h-64 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
            </div>
          ) : (
            <div className="min-w-[1000px]">
              {/* Header Row (Dates) */}
              <div className="flex border-b sticky top-0 bg-white z-20 shadow-sm">
                <div className="w-48 flex-shrink-0 border-r bg-slate-100 p-3 font-semibold text-sm flex items-center">
                  Room
                </div>
                <div className="flex-1 flex">
                  {windowDates.map((date, i) => {
                    const isToday = differenceInDays(date, startOfDay(new Date())) === 0
                    const isWeekend = date.getDay() === 0 || date.getDay() === 6
                    return (
                      <div 
                        key={i} 
                        className={`flex-1 border-r min-w-[60px] flex flex-col items-center justify-center py-2 text-sm
                          ${isToday ? 'bg-indigo-50 text-indigo-700 font-bold' : isWeekend ? 'bg-slate-50' : 'bg-white'}
                        `}
                      >
                        <span className="text-xs uppercase text-slate-500">{format(date, "EEE")}</span>
                        <span>{format(date, "d")}</span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Grid Body */}
              <div className="flex flex-col pb-10">
                {groupedRooms.map(group => (
                  <div key={group.roomType.id} className="flex flex-col">
                    {/* Room Type Header */}
                    <div className="flex border-b bg-slate-100/50">
                      <div className="w-48 flex-shrink-0 border-r p-2 pl-4 text-xs font-bold text-slate-700 uppercase tracking-wider bg-slate-100">
                        {group.roomType.name}
                      </div>
                      <div className="flex-1"></div>
                    </div>
                    
                    {/* Rooms */}
                    {group.rooms.map(room => {
                      const roomReservations = visibleReservations.filter(r => r.roomId === room.id)
                      
                      return (
                        <div key={room.id} className="flex border-b hover:bg-slate-50 transition-colors group">
                          {/* Room Label */}
                          <div className="w-48 flex-shrink-0 border-r p-3 font-medium text-slate-800 bg-white flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                            Room {room.roomNumber}
                          </div>
                          
                          {/* Days Grid container */}
                          <div className="flex-1 flex relative">
                            {/* Background day cells */}
                            {windowDates.map((date, i) => {
                              const isWeekend = date.getDay() === 0 || date.getDay() === 6
                              return (
                                <div 
                                  key={i} 
                                  className={`flex-1 border-r min-w-[60px] h-12 
                                    ${isWeekend ? 'bg-slate-50/50' : ''}
                                  `}
                                />
                              )
                            })}
                            
                            {/* Absolute positioned reservations */}
                            {roomReservations.map(res => renderReservationBar(res))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
                
                {/* Unassigned Reservations */}
                {(() => {
                  const unassigned = visibleReservations.filter(r => !r.roomId)
                  if (unassigned.length === 0) return null
                  
                  return (
                    <div className="flex flex-col mt-4">
                      <div className="flex border-b border-t bg-amber-50">
                        <div className="w-48 flex-shrink-0 border-r p-2 pl-4 text-xs font-bold text-amber-800 uppercase tracking-wider">
                          Unassigned ({unassigned.length})
                        </div>
                        <div className="flex-1"></div>
                      </div>
                      
                      {unassigned.map(res => (
                        <div key={res.id} className="flex border-b hover:bg-amber-50/50 transition-colors">
                          <div className="w-48 flex-shrink-0 border-r p-3 text-sm text-amber-700 bg-white flex items-center">
                            Pending Assignment
                          </div>
                          <div className="flex-1 flex relative">
                            {windowDates.map((_, i) => (
                              <div key={i} className="flex-1 border-r min-w-[60px] h-12" />
                            ))}
                            {renderReservationBar(res)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })()}

              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
