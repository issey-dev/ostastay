"use client"

import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { MappingInput } from "@/components/hub/mapping/mapping-input"

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
    <div className="overflow-x-auto rounded-md border border-border">
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
  )
}
