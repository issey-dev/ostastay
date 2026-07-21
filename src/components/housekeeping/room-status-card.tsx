import { useState } from "react"
import { BedDouble, CheckCircle2, AlertTriangle, Users, Brush, Wrench, Bell } from "lucide-react"
import { statusMutedClasses } from "@/lib/status-tone"

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

  // The board's assignments include both the current IN_HOUSE stay and any
  // RESERVED stay arriving today — occupancy comes from the former only.
  const assignments: any[] = room.RoomAssignment ?? []
  const activeAssignment = assignments.find((a) => a.reservation?.status === "IN_HOUSE")
  const arrivingAssignment = assignments.find((a) => a.reservation?.status === "RESERVED")
  const isOccupied = !!activeAssignment
  const hasSharer = isOccupied && activeAssignment.reservation?.accompanyingGuests?.length > 0

  // Priority signals so attendants clean in the right order: rooms needed for an
  // arrival first, due-outs next (they'll need a departure clean soon), stayovers last.
  const todayIso = new Date().toISOString().slice(0, 10)
  const isDueOut = isOccupied && activeAssignment.reservation?.checkOutDate?.slice(0, 10) === todayIso
  const isStayover = isOccupied && !isDueOut
  const hasArrivalToday = !!arrivingAssignment && arrivingAssignment.reservation?.checkInDate?.slice(0, 10) === todayIso
  const hasMaintenance = room.maintenance?.length > 0
  const activeTicket = hasMaintenance ? room.maintenance[0] : null
  
  // Find any special request tasks that are pending
  const specialRequests = room.housekeepingTasks?.filter((t: any) => t.taskType === 'SPECIAL_REQUEST' && t.status !== 'COMPLETED') || []
  
  // Keep the other tasks for the yellow badge
  const regularTasks = room.housekeepingTasks?.filter((t: any) => t.taskType !== 'SPECIAL_REQUEST' && t.status !== 'COMPLETED') || []

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

    // Simple cycle: DIRTY -> CLEAN -> INSPECTED -> DIRTY.
    // An OUT_OF_ORDER room returns to service as DIRTY (needs a clean first);
    // OUT_OF_SERVICE stays a deliberate admin state, untouched by the quick cycle.
    let newStatus = "DIRTY"
    if (room.status === "DIRTY") newStatus = "CLEAN"
    else if (room.status === "CLEAN") newStatus = "INSPECTED"
    else if (room.status === "INSPECTED") newStatus = "DIRTY"
    else if (room.status === "OUT_OF_ORDER") newStatus = "DIRTY"

    if (room.status !== "OUT_OF_SERVICE") {
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
      ${statusMutedClasses(room.status)}
      ${loading ? 'opacity-50' : ''}
      ${isSelected ? 'ring-2 ring-primary ring-offset-2' : ''}
      `}
      onClick={handleCardClick}
    >
      {isSelected && (
        <div className="absolute -top-2 -right-2 bg-primary text-primary-foreground rounded-none p-0.5 shadow-md z-10">
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
                className={`transition-colors p-1 rounded-none flex items-center justify-center cursor-pointer
                  ${activeTicket?.status === 'IN_PROGRESS'
                    ? 'text-warning bg-warning-muted hover:bg-warning/20'
                    : 'text-destructive bg-destructive-muted hover:bg-destructive/20'}
                `}
              >
                <Wrench className="w-3 h-3" />
              </button>
            )}
          </h3>
          <p className="text-xs font-medium opacity-80 mt-0.5">{room.roomType.name}</p>
        </div>
        <div className="bg-background/60 p-2 rounded-none shadow-sm">
          {getStatusIcon(room.status)}
        </div>
      </div>

      <div className="space-y-2 mt-4">
        <div className="flex justify-between items-center text-sm font-medium">
          <span>Status:</span>
          <span className="capitalize">{room.status.replace(/_/g, ' ').toLowerCase()}</span>
        </div>

        {isOccupied ? (
          <div className="bg-background/60 rounded-md p-2 mt-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground/80 flex-wrap">
              <Users className="w-3 h-3" />
              Occupied
              {hasSharer && <span className="bg-info-muted text-info px-1.5 py-0.5 rounded-none text-[10px]">Sharer</span>}
              {isDueOut && <span className="bg-warning-muted text-warning px-1.5 py-0.5 rounded-none text-[10px] font-bold">Due Out</span>}
              {isStayover && <span className="bg-muted text-muted-foreground px-1.5 py-0.5 rounded-none text-[10px]">Stayover</span>}
            </div>
            <p className="text-xs text-muted-foreground mt-1 truncate">
              {activeAssignment.reservation.primaryGuest?.firstName} {activeAssignment.reservation.primaryGuest?.lastName}
            </p>
          </div>
        ) : (
          <div className="bg-background/40 rounded-md p-2 mt-2 border border-dashed border-border">
            <p className="text-xs text-center font-medium text-muted-foreground">
              Vacant
            </p>
          </div>
        )}

        {hasArrivalToday && (
          <div className="mt-2 text-[11px] font-bold bg-info-muted text-info px-2 py-1 rounded border border-info/30 text-center">
            Arrival today — prioritize
          </div>
        )}

        {room.status === "OUT_OF_ORDER" && (room.oooReason || room.oooExpectedReturn) && (
          <div className="mt-2 text-[11px] bg-destructive-muted text-destructive px-2 py-1 rounded border border-destructive/30">
            {room.oooReason && <p className="font-semibold leading-snug">{room.oooReason}</p>}
            {room.oooExpectedReturn && (
              <p className="opacity-80 mt-0.5">Expected back {new Date(room.oooExpectedReturn).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</p>
            )}
          </div>
        )}

        {regularTasks.map((task: any) => (
          <div key={task.id} className="mt-2 text-xs font-medium bg-warning-muted text-warning p-1.5 rounded flex items-center justify-between gap-2">
            <span title={task.notes || undefined}>Task: {task.taskType.replace(/_/g, ' ')}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (onCompleteTask) onCompleteTask(task.id)
              }}
              className="hover:bg-warning/20 rounded p-0.5 shrink-0 transition-colors"
              title="Mark as completed"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}

        {specialRequests.map((req: any) => (
          <div key={req.id} className="mt-2 text-[11px] font-semibold bg-foreground text-background px-2 py-1.5 rounded border border-foreground/20 flex flex-col gap-1">
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
                className="bg-background/20 hover:bg-background/30 text-background rounded p-0.5 shrink-0 transition-colors"
                title="Mark as completed"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}

        {room.assignedAttendant && (
          <div className="mt-2 text-[11px] font-semibold bg-background/70 text-foreground/80 px-2 py-1 rounded border border-border flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-none bg-muted flex items-center justify-center text-[9px]">
              {room.assignedAttendant.firstName[0]}
            </div>
            {room.assignedAttendant.firstName} {room.assignedAttendant.lastName}
          </div>
        )}

        {activeTicket?.assignedTo && (
          <div className="mt-2 text-[11px] font-semibold bg-background/70 text-warning px-2 py-1 rounded border border-warning/20 flex items-center gap-1.5">
            <Wrench className="w-3 h-3" />
            {activeTicket.assignedTo.firstName} {activeTicket.assignedTo.lastName}
          </div>
        )}
      </div>
    </div>
  )
}
