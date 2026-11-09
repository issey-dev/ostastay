"use client"

import { useRouter } from "next/navigation"
import { Plus, ChevronDown, Search, Building2, ReceiptText, ShieldCheck, ArrowLeftRight, ClipboardCheck } from "@/components/icons"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { CommandPaletteTrigger, OPEN_COMMAND_PALETTE } from "@/components/shell/command-palette"
import { OstaCommandPalette } from "@/components/osta/osta-command-palette"
import { CreateEnterpriseDialog, OPEN_CREATE_ENTERPRISE } from "@/components/osta/create-enterprise-button"

// The Osta console header's tools: the search box (opens the Ctrl+K palette), the + New
// menu, and the two overlays they open, mounted once here for every console page.
// "New" items that need a customer first (an invoice, a support request, a channel
// connection) go to the screen where that customer is chosen.
export function OstaHeaderTools() {
  const router = useRouter()
  return (
    <>
      <CommandPaletteTrigger />
      {/* Phones: the search box above is hidden (max-md), so search is an icon. */}
      <Button
        variant="ghost"
        size="icon"
        aria-label="Search"
        className="text-muted-foreground md:hidden"
        onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE))}
      >
        <Search className="h-5 w-5" />
      </Button>
      {/* Tablet and desktop only (owner, 2026-11-08): no create button in the phone header. */}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button aria-label="New" className="max-md:hidden" />}>
          <Plus className="h-4 w-4" />
          <span className="max-sm:hidden">New</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-80" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-60">
          {/* Base UI: a menu label must sit inside a group, or opening the menu throws. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>Create</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => window.dispatchEvent(new Event(OPEN_CREATE_ENTERPRISE))}>
              <Building2 className="h-4 w-4" /> Enterprise
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/osta/enterprises")}>
              <ReceiptText className="h-4 w-4" /> Licence invoice
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/osta/support-access")}>
              <ShieldCheck className="h-4 w-4" /> Support access request
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/osta/channel-manager")}>
              <ArrowLeftRight className="h-4 w-4" /> Channel-manager connection
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => router.push("/osta?show=approval")}>
            <ClipboardCheck className="h-4 w-4" /> Review property approvals
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <OstaCommandPalette />
      <CreateEnterpriseDialog />
    </>
  )
}
