"use client"

import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/ui/status-badge"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { MappingInput } from "@/components/hub/mapping/mapping-input"
import { MobileCard, MobileCardList } from "@/components/ui/mobile-card"

export type RoomTypeMap = {
  roomTypeId: string
  roomTypeName: string
  roomTypeCode: string
  isActive: boolean
  externalRoomId: string | null
  shared: boolean
}

// External code ↔ property room type. The mapping most everything else depends on: an
// unmapped active room type is exactly what keeps sharing from being turned on
// (see computeReadiness in src/lib/channels/sharing.ts).
export function RoomTypeTab({
  roomTypes,
  canManage,
  onPatch,
}: {
  roomTypes: RoomTypeMap[]
  canManage: boolean
  onPatch: (payload: Record<string, unknown>, successMessage?: string) => Promise<boolean>
}) {
  return (
    <>
      {/* Phone view — the mapping input and share toggle both need their own row width
          to be usable with a thumb, so each room type becomes a small card. */}
      <MobileCardList>
        {roomTypes.map((rt) => (
          <MobileCard
            key={rt.roomTypeId}
            tone={rt.isActive ? undefined : "muted"}
            title={rt.roomTypeName}
            subtitle={<span className="font-mono">{rt.roomTypeCode}</span>}
            badge={
              <>
                {!rt.isActive && <StatusBadge status="INACTIVE" label="Inactive" />}
                <span className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Share</span>
                  <Switch
                    checked={rt.shared}
                    disabled={!canManage || !rt.externalRoomId}
                    onCheckedChange={(checked) =>
                      void onPatch({ roomTypeId: rt.roomTypeId, externalRoomId: rt.externalRoomId ?? "", shared: checked })
                    }
                  />
                </span>
              </>
            }
          >
            <MappingInput
              value={rt.externalRoomId ?? ""}
              disabled={!canManage}
              placeholder="Beds24 room ID"
              onSave={(v) => onPatch({ roomTypeId: rt.roomTypeId, externalRoomId: v }, "Mapping saved")}
            />
          </MobileCard>
        ))}
      </MobileCardList>

      <div className="hidden overflow-x-auto rounded-md border border-border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Room type</TableHead>
              <TableHead>Channel room ID</TableHead>
              <TableHead className="w-[90px] text-right">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roomTypes.map((rt) => (
              <TableRow key={rt.roomTypeId}>
                <TableCell>
                  <span className="text-sm font-medium">{rt.roomTypeName}</span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{rt.roomTypeCode}</span>
                  {!rt.isActive && (
                    <Badge variant="secondary" className="ml-2">
                      Inactive
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <MappingInput
                    value={rt.externalRoomId ?? ""}
                    disabled={!canManage}
                    placeholder="Beds24 room ID"
                    onSave={(v) => onPatch({ roomTypeId: rt.roomTypeId, externalRoomId: v }, "Mapping saved")}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Switch
                    checked={rt.shared}
                    disabled={!canManage || !rt.externalRoomId}
                    onCheckedChange={(checked) =>
                      void onPatch({ roomTypeId: rt.roomTypeId, externalRoomId: rt.externalRoomId ?? "", shared: checked })
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}
