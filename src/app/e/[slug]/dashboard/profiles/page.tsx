"use client"

import { useEffect, useState } from "react"
import { Search, UserPlus, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { useRouter } from "next/navigation"
import { Users, Building2, Briefcase } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"

type Profile = {
  upid: string
  profileType: string
  firstName: string
  lastName: string | null
  companyName: string | null
  classification: string
  title: string | null
  preferredLanguage: string
  dateOfBirth: string | null
  anniversaryDate: string | null
  loyaltyTier: string | null
  photoUrl: string | null
  greenTaxExempt: boolean
  gender: string | null
  marketingOptIn: boolean
  isIncognito: boolean
  contacts: {
    mobile: string | null
    email: string | null
    country: string | null
    address: string | null
  }[]
  documents?: {
    documentType: string
    documentNumber: string
    issuingCountry: string | null
    issueDate: string | null
    expiryDate: string | null
  }[]
  totalStays: number
  totalRevenue: number
  lastStayDate: string | null
}

const classColors: Record<string, string> = {
  VIP: "bg-foreground text-background border-transparent",
  REGULAR: "bg-muted text-foreground border-border",
  BLACKLISTED: "bg-destructive-muted text-destructive border-destructive/30",
}

// One consistent monochrome treatment for every avatar — the initials themselves are
// the distinguishing feature, not a per-person hue (the app's palette is monochromatic
// with color reserved for status/tone, not decorative identity).
const AVATAR_COLOR = "bg-muted text-foreground"

export default function ProfilesDashboard() {
  const router = useRouter()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [activeTab, setActiveTab] = useState("GUEST")

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [deletingUpid, setDeletingUpid] = useState<string | null>(null)

  const enterpriseId = "00000000-0000-0000-0000-000000000000" // Hardcoded for demo

  const fetchProfiles = (searchQuery = "", type = activeTab) => {
    setLoading(true)
    fetch(`/api/profiles?enterpriseId=${enterpriseId}&search=${searchQuery}&profileType=${type}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setProfiles(data)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    // Initial fetch
    fetchProfiles()
  }, [])

  // Fetch when tab changes
  useEffect(() => {
    fetchProfiles(search, activeTab)
  }, [activeTab])

  // Debounced Search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchProfiles(search, activeTab)
    }, 500)
    return () => clearTimeout(timer)
  }, [search])



  const handleDelete = async () => {
    if (!deletingUpid) return
    try {
      const res = await fetch(`/api/profiles/${deletingUpid}`, { method: "DELETE" })
      if (res.ok) {
        setIsDeleteDialogOpen(false)
        setDeletingUpid(null)
        fetchProfiles(search, activeTab)
      } else {
        const error = await res.json()
        alert(error.error || "Failed to delete profile")
      }
    } catch (e) {
      console.error(e)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Profiles & CRM</h2>
          <p className="text-muted-foreground">
            Manage your individual guests, travel agents, and corporate accounts here.
          </p>
        </div>
        
        <Button onClick={() => router.push(`/dashboard/profiles/new?type=${activeTab}`)}>
          <UserPlus className="mr-2 h-4 w-4" /> New {activeTab === "GUEST" ? "Guest" : activeTab === "COMPANY" ? "Company" : "Travel Agent"}
        </Button>
        
        {/* Delete Modal */}
        <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Delete Profile</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this profile? Profiles with active reservations cannot be deleted.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>Cancel</Button>
              <Button type="button" variant="destructive" onClick={handleDelete}>Delete</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full flex-col">
        <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent mb-6">
          <TabsTrigger 
            value="GUEST" 
            className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary rounded-none px-6 py-3 font-medium text-muted-foreground"
          >
            <Users className="w-4 h-4 mr-2" /> Guests
          </TabsTrigger>
          <TabsTrigger 
            value="COMPANY" 
            className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary rounded-none px-6 py-3 font-medium text-muted-foreground"
          >
            <Building2 className="w-4 h-4 mr-2" /> Corporate Accounts
          </TabsTrigger>
          <TabsTrigger 
            value="TRAVEL_AGENT" 
            className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary rounded-none px-6 py-3 font-medium text-muted-foreground"
          >
            <Briefcase className="w-4 h-4 mr-2" /> Travel Agents
          </TabsTrigger>
        </TabsList>

      <Card>
        <CardHeader className="bg-muted/50 border-b border-border">
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="text-lg">
                {activeTab === "GUEST" ? "Guest Directory" : activeTab === "COMPANY" ? "Corporate Accounts" : "Travel Agents"}
              </CardTitle>
              <CardDescription>Search by name, email, or phone.</CardDescription>
            </div>
            <div className="relative w-72">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search profiles..."
                className="pl-9 bg-card"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* Mobile: stacked cards instead of a horizontally-scrolled table */}
          <div className="md:hidden divide-y divide-border">
            {loading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
              </div>
            ) : profiles.length === 0 ? (
              <EmptyState icon={Users} title="No profiles found" />
            ) : (
              profiles.map((p) => (
                <div key={p.upid} className="p-4 flex items-start gap-3">
                  <div className={`h-10 w-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${AVATAR_COLOR}`}>
                    {p.firstName?.charAt(0) || ''}{p.lastName?.charAt(0) || ''}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-foreground truncate">
                        {p.profileType === 'GUEST'
                          ? `${p.firstName} ${p.lastName || ''}`.trim()
                          : p.companyName || `${p.firstName} ${p.lastName || ''}`.trim()}
                      </span>
                      <span className={`px-2 py-1 rounded-full text-[10px] uppercase font-bold border shrink-0 ${classColors[p.classification] || 'bg-muted text-foreground'}`}>
                        {p.classification}
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      {p.contacts?.[0]?.email || "No email"} {p.contacts?.[0]?.mobile ? `· ${p.contacts[0].mobile}` : ""}
                    </div>
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
                      <span className="text-xs text-muted-foreground">{p.totalStays || 0} stays · ${(p.totalRevenue || 0).toFixed(2)}</span>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon-sm" className="text-primary" onClick={() => router.push(`/dashboard/profiles/${p.upid}/edit`)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon-sm" className="text-destructive" onClick={() => {
                          setDeletingUpid(p.upid)
                          setIsDeleteDialogOpen(true)
                        }}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Tablet/desktop: full table */}
          <Table className="hidden md:table">
            <TableHeader className="bg-muted/50">
              <TableRow className="border-border">
                <TableHead className="text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6 py-4">Guest</TableHead>
                <TableHead className="text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6 py-4">Contact</TableHead>
                <TableHead className="text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6 py-4">Status</TableHead>
                <TableHead className="text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6 py-4">History</TableHead>
                <TableHead className="text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6 py-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-10">Loading profiles...</TableCell></TableRow>
              ) : profiles.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-10">No profiles found.</TableCell></TableRow>
              ) : (
                profiles.map((p) => (
                  <TableRow key={p.upid} className="hover:bg-muted/40">
                    <TableCell className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`h-10 w-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${AVATAR_COLOR}`}>
                          {p.firstName?.charAt(0) || ''}{p.lastName?.charAt(0) || ''}
                        </div>
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground">
                            {p.profileType === 'GUEST' 
                              ? `${p.firstName} ${p.lastName || ''}`.trim() 
                              : p.companyName || `${p.firstName} ${p.lastName || ''}`.trim()}
                          </span>
                          {p.contacts?.[0]?.country && (
                            <span className="text-xs text-muted-foreground font-medium">{p.contacts[0].country}</span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="px-6 py-4">
                      <div className="text-sm">
                        {p.contacts?.[0]?.email ? <div className="text-foreground">{p.contacts[0].email}</div> : <div className="text-muted-foreground italic text-xs">No email</div>}
                        {p.contacts?.[0]?.mobile ? <div className="text-muted-foreground">{p.contacts[0].mobile}</div> : <div className="text-muted-foreground italic text-xs">No phone</div>}
                      </div>
                    </TableCell>
                    <TableCell className="px-6 py-4">
                      <div className="flex flex-col gap-1 items-start">
                        <span className={`px-2 py-1 rounded-full text-[10px] uppercase font-bold border ${classColors[p.classification] || 'bg-muted text-foreground'}`}>
                          {p.classification}
                        </span>
                        {p.loyaltyTier && (
                          <span className="px-2 py-1 rounded-full text-[10px] uppercase font-bold border bg-warning-muted text-warning border-warning/30">
                            {p.loyaltyTier}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="px-6 py-4">
                      <div className="flex flex-col text-sm">
                        <span className="text-foreground font-medium">{p.totalStays || 0} Stays</span>
                        <span className="text-muted-foreground">${(p.totalRevenue || 0).toFixed(2)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2 transition-opacity">
                        <Button variant="ghost" size="sm" className="text-primary" onClick={() => router.push(`/dashboard/profiles/${p.upid}/edit`)}>
                          <Pencil className="mr-2 h-4 w-4" /> Edit
                        </Button>
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => {
                          setDeletingUpid(p.upid)
                          setIsDeleteDialogOpen(true)
                        }}>
                          <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      </Tabs>
    </div>
  )
}
