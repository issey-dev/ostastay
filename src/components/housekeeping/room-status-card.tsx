import { useState } from "react"
import { BedDouble, CheckCircle2, AlertTriangle, Users, Brush, Wrench, Bell } from "lucide-react"

type RoomStatusCardProps = {
  room: any
  onStatusChange: (roomId: string, newStatus: string) => void
  isSelected?: boolean
  onToggleSelect?: (roomId: string) => void
  onEditMaintenance?: (ticket: any) => void
  onCompleteTask?: (taskId: string) => void
}

export function RoomStatusCard({ room, onStatusChange, isSelected, onToggleSelect, onEditMaintenance, onCompleteTask }: RoomStatusCardProps) {
  const [loading, setLoading] = useState(false)

  const activeAssignment = room.RoomAssignment?.[0]
  const isOccupied = !!activeAssignment
  const hasSharer = isOccupied && activeAssignment.reservation?.accompanyingGuests?.length > 0
  const hasMaintenance = room.maintenance?.length > 0
  const activeTicket = hasMaintenance ? room.maintenance[0] : null
  
  // Find any special request tasks that are pending
  const specialRequests = room.housekeepingTasks?.filter((t: any) => t.taskType === 'SPECIAL_REQUEST' && t.status !== 'COMPLETED') || []
  
  // Keep the other tasks for the yellow badge
  const regularTasks = room.housekeepingTasks?.filter((t: any) => t.taskType !== 'SPECIAL_REQUEST' && t.status !== 'COMPLETED') || []

  const getStatusColor = (status: string) => {
    switch (status) {
      case "CLEAN": return "bg-emerald-50 border-emerald-200 text-emerald-700"
      case "DIRTY": return "bg-rose-50 border-rose-200 text-rose-700"
      case "INSPECTED": return "bg-indigo-50 border-indigo-200 text-indigo-700"
      case "OUT_OF_ORDER": return "bg-slate-100 border-slate-300 text-slate-700"
      default: return "bg-slate-50 border-slate-200 text-slate-700"
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "CLEAN": return <CheckCircle2 className="w-4 h-4" />
      case "DIRTY": return <Brush className="w-4 h-4" />
      case "OUT_OF_ORDER": return <AlertTriangle className="w-4 h-4" />
      default: return <BedDouble className="w-4 h-4" />
    }
  }

  const cycleStatus = async () => {
    if (loading) return
    setLoading(true)
    
    // Simple cycle: DIRTY -> CLEAN -> INSPECTED -> DIRTY
    let newStatus = "DIRTY"
    if (room.status === "DIRTY") newStatus = "CLEAN"
    else if (room.status === "CLEAN") newStatus = "INSPECTED"
    else if (room.status === "INSPECTED") newStatus = "DIRTY"
    
    // Ignore if OUT_OF_ORDER for now via quick toggle
    if (room.status !== "OUT_OF_ORDER") {
      await onStatusChange(room.id, newStatus)
    }
    setLoading(false)
  }

  const handleCardClick = () => {
    // If we are in bulk selection mode (onToggleSelect is passed), then toggle selection instead of cycling status.
    if (onToggleSelect) {
      onToggleSelect(room.id)
    } else {
      cycleStatus()
    }
  }

  return (
    <div 
      className={`border rounded-xl p-4 shadow-sm transition-all cursor-pointer hover:shadow-md relative
      ${getStatusColor(room.status)} 
      ${loading ? 'opacity-50' : ''}
      ${isSelected ? 'ring-2 ring-indigo-600 ring-offset-2' : ''}
      `}
      onClick={handleCardClick}
    >
      {isSelected && (
        <div className="absolute -top-2 -right-2 bg-indigo-600 text-white rounded-full p-0.5 shadow-md z-10">
          <CheckCircle2 className="w-4 h-4" />
        </div>
      )}
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="text-2xl font-bold flex items-center gap-2">
            {room.roomNumber}
            {hasMaintenance && (
              <button 
                onClick={(e) => {
                  e.stopPropagation(); // prevent card selection
                  if (onEditMaintenance && activeTicket) onEditMaintenance(activeTicket);
                }}
                title={`${activeTicket?.status}: ${activeTicket?.description}${activeTicket?.assignedTo ? `\nAssigned to: ${activeTicket.assignedTo.firstName} ${activeTicket.assignedTo.lastName}` : ''}`} 
                className={`transition-colors p-1 rounded-full flex items-center justify-center cursor-pointer
                  ${activeTicket?.status === 'IN_PROGRESS' 
                    ? 'text-amber-600 bg-amber-100 hover:bg-amber-200' 
                    : 'text-rose-500 bg-rose-100 hover:bg-rose-200'}
                `}
              >
                <Wrench className="w-3 h-3" />
              </button>
            )}
          </h3>
          <p className="text-xs font-medium opacity-80 mt-0.5">{room.roomType.name}</p>
        </div>
        <div className="bg-white/50 p-2 rounded-full shadow-sm">
          {getStatusIcon(room.status)}
        </div>
      </div>

      <div className="space-y-2 mt-4">
        <div className="flex justify-between items-center text-sm font-medium">
          <span>Status:</span>
          <span className="capitalize">{room.status.replace(/_/g, ' ').toLowerCase()}</span>
        </div>
        
        {isOccupied ? (
          <div className="bg-white/60 rounded-md p-2 mt-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <Users className="w-3 h-3" />
              Occupied
              {hasSharer && <span className="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full text-[10px]">Sharer</span>}
            </div>
            <p className="text-xs text-slate-500 mt-1 truncate">
              {activeAssignment.reservation.primaryGuest?.firstName} {activeAssignment.reservation.primaryGuest?.lastName}
            </p>
          </div>
        ) : (
          <div className="bg-white/40 rounded-md p-2 mt-2 border border-dashed border-slate-300">
            <p className="text-xs text-center font-medium text-slate-500">Vacant</p>
          </div>
        )}

        {regularTasks?.length > 0 && (
          <div className="mt-2 text-xs font-medium bg-amber-100 text-amber-800 p-1.5 rounded text-center">
            Task: {regularTasks[0].taskType.replace(/_/g, ' ')}
          </div>
        )}

        {specialRequests.map((req: any) => (
          <div key={req.id} className="mt-2 text-[11px] font-semibold bg-purple-100 text-purple-800 px-2 py-1.5 rounded border border-purple-200 flex flex-col gap-1">
            <div className="flex justify-between items-start gap-2">
              <div className="flex items-start gap-1.5">
                <Bell className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span className="leading-snug">{req.notes}</span>
              </div>
              <button 
                onClick={(e) => {
                  e.stopPropagation()
                  if (onCompleteTask) onCompleteTask(req.id)
                }}
                className="bg-white/60 hover:bg-white text-purple-900 rounded p-0.5 shrink-0 transition-colors"
                title="Mark as completed"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}

        {room.assignedAttendant && (
          <div className="mt-2 text-[11px] font-semibold bg-white/70 text-indigo-700 px-2 py-1 rounded border border-indigo-100 flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-full bg-indigo-200 flex items-center justify-center text-[9px]">
              {room.assignedAttendant.firstName[0]}
            </div>
            {room.assignedAttendant.firstName} {room.assignedAttendant.lastName}
          </div>
        )}

        {activeTicket?.assignedTo && (
          <div className="mt-2 text-[11px] font-semibold bg-white/70 text-amber-700 px-2 py-1 rounded border border-amber-100 flex items-center gap-1.5">
            <Wrench className="w-3 h-3" />
            {activeTicket.assignedTo.firstName} {activeTicket.assignedTo.lastName}
          </div>
        )}
      </div>
    </div>
  )
}
