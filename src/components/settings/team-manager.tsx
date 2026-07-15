"use client"

import { useState, useEffect } from "react"
import { useProperty } from "@/components/providers/property-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Users, Plus, Edit, Trash2, CheckCircle2, XCircle, Shield } from "lucide-react"
import { Badge } from "@/components/ui/badge"

const ROLES = [
  { value: "ADMIN", label: "Admin" },
  { value: "MANAGER", label: "Manager" },
  { value: "FRONT_DESK", label: "Front Desk" },
  { value: "RESERVATIONS", label: "Reservations" },
  { value: "HOUSEKEEPING", label: "Housekeeping" },
  { value: "MAINTENANCE", label: "Maintenance" },
  { value: "CASHIER", label: "Cashier" },
]

export function TeamManager() {
  const { currentProperty } = useProperty()
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<any>(null)
  
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    role: "FRONT_DESK",
    isActive: true,
  })

  const [saving, setSaving] = useState(false)

  const fetchUsers = async () => {
    if (!currentProperty) return
    setLoading(true)
    try {
      const res = await fetch(`/api/settings/users?tenantId=${currentProperty.tenantId}`)
      if (res.ok) {
        const data = await res.json()
        setUsers(data)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [userToDelete, setUserToDelete] = useState<any>(null)
  const [deleteErrorMsg, setDeleteErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    fetchUsers()
  }, [currentProperty])

  const openNewDialog = () => {
    setEditingUser(null)
    setFormData({
      firstName: "",
      lastName: "",
      email: "",
      password: "",
      role: "FRONT_DESK",
      isActive: true,
    })
    setErrorMsg(null)
    setIsDialogOpen(true)
  }

  const openEditDialog = (user: any) => {
    setEditingUser(user)
    setFormData({
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      password: "", // blank password so we don't overwrite unless they type one
      role: user.role,
      isActive: user.isActive,
    })
    setErrorMsg(null)
    setIsDialogOpen(true)
  }

  const handleSave = async () => {
    if (!currentProperty) return
    setSaving(true)
    setErrorMsg(null)

    const url = "/api/settings/users"
    const method = editingUser ? "PATCH" : "POST"
    const body = editingUser 
      ? { ...formData, id: editingUser.id } 
      : { ...formData, tenantId: currentProperty.tenantId }

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      })

      if (res.ok) {
        setIsDialogOpen(false)
        fetchUsers()
      } else {
        const error = await res.json()
        setErrorMsg(error.error || "Failed to save user")
      }
    } catch (e) {
      console.error(e)
      setErrorMsg("An unexpected error occurred while saving.")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!userToDelete) return
    setDeleteErrorMsg(null)
    try {
      const res = await fetch(`/api/settings/users?id=${userToDelete.id}`, {
        method: "DELETE"
      })
      if (res.ok) {
        setUserToDelete(null)
        fetchUsers()
      } else {
        const error = await res.json()
        setDeleteErrorMsg(error.error || "Failed to delete user")
      }
    } catch (e) {
      console.error(e)
      setDeleteErrorMsg("An unexpected error occurred.")
    }
  }

  const getRoleBadgeColor = (role: string) => {
    if (role === "ADMIN" || role === "MANAGER") return "bg-indigo-100 text-indigo-700"
    if (role === "HOUSEKEEPING") return "bg-emerald-100 text-emerald-700"
    if (role === "MAINTENANCE") return "bg-amber-100 text-amber-700"
    if (role === "RESERVATIONS") return "bg-blue-100 text-blue-700"
    return "bg-slate-100 text-slate-700"
  }

  if (loading) return <div className="p-8 text-center text-slate-500">Loading team members...</div>

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="text-lg font-medium">Staff Accounts</h3>
          <p className="text-sm text-slate-500">Manage user accounts and their permissions</p>
        </div>
        <Button onClick={openNewDialog} className="bg-indigo-600 hover:bg-indigo-700 text-white">
          <Plus className="w-4 h-4 mr-2" /> Add Team Member
        </Button>
      </div>

      <Dialog open={!!userToDelete} onOpenChange={(open) => {
        if (!open) {
          setUserToDelete(null)
          setDeleteErrorMsg(null)
        }
      }}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Are you absolutely sure?</DialogTitle>
            <DialogDescription>
              This action cannot be undone. This will permanently delete the user account for 
              <strong> {userToDelete?.firstName} {userToDelete?.lastName}</strong>.
            </DialogDescription>
          </DialogHeader>
          
          {deleteErrorMsg && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm p-3 rounded-md flex items-start">
              <Shield className="w-4 h-4 mr-2 mt-0.5 shrink-0" />
              <span>{deleteErrorMsg}</span>
            </div>
          )}

          <DialogFooter className="mt-4 gap-2">
            <Button 
              variant="outline" 
              onClick={() => {
                setUserToDelete(null)
                setDeleteErrorMsg(null)
              }}
            >
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleDelete}
            >
              Delete User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role / Department</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">
                  {user.firstName} {user.lastName}
                </TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className={getRoleBadgeColor(user.role)}>
                    {user.role.replace("_", " ")}
                  </Badge>
                </TableCell>
                <TableCell>
                  {user.isActive ? (
                    <span className="flex items-center text-emerald-600 text-sm font-medium">
                      <CheckCircle2 className="w-4 h-4 mr-1" /> Active
                    </span>
                  ) : (
                    <span className="flex items-center text-slate-400 text-sm font-medium">
                      <XCircle className="w-4 h-4 mr-1" /> Inactive
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => openEditDialog(user)}>
                    <Edit className="w-4 h-4 text-slate-500" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setUserToDelete(user)}>
                    <Trash2 className="w-4 h-4 text-rose-500" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {users.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-slate-500">
                  No users found. Create your first team member!
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingUser ? "Edit Team Member" : "Add Team Member"}</DialogTitle>
            <DialogDescription>
              {editingUser ? "Update staff details and access levels." : "Create a new user account for your staff."}
            </DialogDescription>
          </DialogHeader>
          
          {errorMsg && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm p-3 rounded-md flex items-center">
              <Shield className="w-4 h-4 mr-2" />
              {errorMsg}
            </div>
          )}
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">First Name</label>
                <Input 
                  value={formData.firstName} 
                  onChange={e => setFormData({...formData, firstName: e.target.value})}
                  placeholder="John"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Last Name</label>
                <Input 
                  value={formData.lastName} 
                  onChange={e => setFormData({...formData, lastName: e.target.value})}
                  placeholder="Doe"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Email Address</label>
              <Input 
                type="email"
                value={formData.email} 
                onChange={e => setFormData({...formData, email: e.target.value})}
                placeholder="john.doe@example.com"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                Password {editingUser && <span className="text-slate-400 font-normal">(Leave blank to keep unchanged)</span>}
              </label>
              <Input 
                type="password"
                value={formData.password} 
                onChange={e => setFormData({...formData, password: e.target.value})}
                placeholder={editingUser ? "••••••••" : "Create a secure password"}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-1">
                  <Shield className="w-4 h-4 text-indigo-500" /> Department / Role
                </label>
                <select 
                  className="w-full border-slate-200 rounded-md shadow-sm h-10 px-3 border focus:ring-indigo-500 focus:border-indigo-500"
                  value={formData.role}
                  onChange={e => setFormData({...formData, role: e.target.value})}
                >
                  {ROLES.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Account Status</label>
                <select 
                  className="w-full border-slate-200 rounded-md shadow-sm h-10 px-3 border focus:ring-indigo-500 focus:border-indigo-500"
                  value={formData.isActive ? "true" : "false"}
                  onChange={e => setFormData({...formData, isActive: e.target.value === "true"})}
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </div>
            </div>

          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
            <Button 
              className="bg-indigo-600 hover:bg-indigo-700 text-white" 
              onClick={handleSave} 
              disabled={saving || !formData.email || (!editingUser && !formData.password) || !formData.firstName}
            >
              {saving ? "Saving..." : "Save User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
