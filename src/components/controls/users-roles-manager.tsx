"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Users, Plus, Edit, Trash2, CheckCircle2, XCircle, Shield, KeyRound } from "lucide-react"
import { RolePermissionMatrix, emptyPermissionMatrix, type PermissionMatrix } from "./role-permission-matrix"
import { MODULES } from "@/lib/modules"

type Role = {
  id: string
  name: string
  isSystem: boolean
  permissions: { module: string; canView: boolean; canCreate: boolean; canUpdate: boolean; canDelete: boolean }[]
  _count?: { users: number }
}

type UserRow = {
  id: string
  email: string
  firstName: string
  lastName: string
  role: { id: string; name: string }
  scope: "ENTERPRISE" | "PROPERTY"
  propertyId: string | null
  isActive: boolean
}

type PropertyOption = { id: string; name: string; code: string }

function matrixFromRole(role: Role): PermissionMatrix {
  const matrix = emptyPermissionMatrix()
  for (const p of role.permissions) {
    if (p.module in matrix) {
      matrix[p.module as keyof PermissionMatrix] = {
        canView: p.canView,
        canCreate: p.canCreate,
        canUpdate: p.canUpdate,
        canDelete: p.canDelete,
      }
    }
  }
  return matrix
}

export function UsersRolesManager({
  actorScope,
  actorPropertyId,
}: {
  actorScope: "ENTERPRISE" | "PROPERTY"
  actorPropertyId: string | null
}) {
  // A property-scoped actor can only ever manage users at their own property — the
  // server enforces this regardless (src/app/api/settings/users/route.ts), but locking
  // it here too means they never fill out a form only to hit a 403 at the end.
  const isPropertyLockedActor = actorScope === "PROPERTY"

  const [users, setUsers] = useState<UserRow[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [properties, setProperties] = useState<PropertyOption[]>([])
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [usersRes, rolesRes, propsRes] = await Promise.all([
        fetch("/api/settings/users"),
        fetch("/api/roles"),
        fetch("/api/properties"),
      ])
      if (usersRes.ok) setUsers(await usersRes.json())
      if (rolesRes.ok) setRoles(await rolesRes.json())
      if (propsRes.ok) setProperties(await propsRes.json())
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  // ---- Users ----
  const [isUserDialogOpen, setIsUserDialogOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<UserRow | null>(null)
  const [userForm, setUserForm] = useState({
    firstName: "", lastName: "", email: "", password: "",
    roleId: "", scope: "ENTERPRISE" as "ENTERPRISE" | "PROPERTY", propertyId: "",
  })
  const [userErrorMsg, setUserErrorMsg] = useState<string | null>(null)
  const [savingUser, setSavingUser] = useState(false)
  const [userToDelete, setUserToDelete] = useState<UserRow | null>(null)
  const [deleteErrorMsg, setDeleteErrorMsg] = useState<string | null>(null)

  const openNewUserDialog = () => {
    setEditingUser(null)
    setUserForm({
      firstName: "", lastName: "", email: "", password: "", roleId: roles[0]?.id ?? "",
      scope: isPropertyLockedActor ? "PROPERTY" : "ENTERPRISE",
      propertyId: isPropertyLockedActor ? (actorPropertyId ?? "") : "",
    })
    setUserErrorMsg(null)
    setIsUserDialogOpen(true)
  }

  const openEditUserDialog = (user: UserRow) => {
    setEditingUser(user)
    setUserForm({
      firstName: user.firstName, lastName: user.lastName, email: user.email, password: "",
      roleId: user.role.id, scope: user.scope, propertyId: user.propertyId ?? "",
    })
    setUserErrorMsg(null)
    setIsUserDialogOpen(true)
  }

  const handleSaveUser = async () => {
    setSavingUser(true)
    setUserErrorMsg(null)

    const method = editingUser ? "PATCH" : "POST"
    const body: any = {
      ...userForm,
      role: userForm.roleId,
      propertyId: userForm.scope === "PROPERTY" ? userForm.propertyId : null,
    }
    if (editingUser) body.id = editingUser.id
    if (!body.password) delete body.password

    try {
      const res = await fetch("/api/settings/users", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        setIsUserDialogOpen(false)
        fetchAll()
      } else {
        const error = await res.json()
        setUserErrorMsg(error.error || "Failed to save user")
      }
    } catch (e) {
      console.error(e)
      setUserErrorMsg("An unexpected error occurred while saving.")
    } finally {
      setSavingUser(false)
    }
  }

  const handleDeleteUser = async () => {
    if (!userToDelete) return
    setDeleteErrorMsg(null)
    try {
      const res = await fetch(`/api/settings/users?id=${userToDelete.id}`, { method: "DELETE" })
      if (res.ok) {
        setUserToDelete(null)
        fetchAll()
      } else {
        const error = await res.json()
        setDeleteErrorMsg(error.error || "Failed to delete user")
      }
    } catch (e) {
      console.error(e)
      setDeleteErrorMsg("An unexpected error occurred.")
    }
  }

  const getRoleBadgeColor = (roleName: string) => {
    if (roleName === "Admin" || roleName === "Manager") return "bg-indigo-100 text-indigo-700"
    if (roleName === "Housekeeping") return "bg-emerald-100 text-emerald-700"
    if (roleName === "Maintenance") return "bg-amber-100 text-amber-700"
    if (roleName === "Reservations") return "bg-blue-100 text-blue-700"
    return "bg-slate-100 text-slate-700"
  }

  // ---- Roles ----
  const [isRoleDialogOpen, setIsRoleDialogOpen] = useState(false)
  const [editingRole, setEditingRole] = useState<Role | null>(null)
  const [roleName, setRoleName] = useState("")
  const [roleMatrix, setRoleMatrix] = useState<PermissionMatrix>(emptyPermissionMatrix())
  const [roleErrorMsg, setRoleErrorMsg] = useState<string | null>(null)
  const [savingRole, setSavingRole] = useState(false)
  const [roleToDelete, setRoleToDelete] = useState<Role | null>(null)
  const [roleDeleteErrorMsg, setRoleDeleteErrorMsg] = useState<string | null>(null)

  const openNewRoleDialog = () => {
    setEditingRole(null)
    setRoleName("")
    setRoleMatrix(emptyPermissionMatrix())
    setRoleErrorMsg(null)
    setIsRoleDialogOpen(true)
  }

  const openEditRoleDialog = (role: Role) => {
    setEditingRole(role)
    setRoleName(role.name)
    setRoleMatrix(matrixFromRole(role))
    setRoleErrorMsg(null)
    setIsRoleDialogOpen(true)
  }

  const handleSaveRole = async () => {
    if (!roleName.trim()) {
      setRoleErrorMsg("Role name is required")
      return
    }
    setSavingRole(true)
    setRoleErrorMsg(null)

    const url = editingRole ? `/api/roles/${editingRole.id}` : "/api/roles"
    const method = editingRole ? "PATCH" : "POST"

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: roleName, permissions: roleMatrix }),
      })
      if (res.ok) {
        setIsRoleDialogOpen(false)
        fetchAll()
      } else {
        const error = await res.json()
        setRoleErrorMsg(error.error || "Failed to save role")
      }
    } catch (e) {
      console.error(e)
      setRoleErrorMsg("An unexpected error occurred while saving.")
    } finally {
      setSavingRole(false)
    }
  }

  const handleDeleteRole = async () => {
    if (!roleToDelete) return
    setRoleDeleteErrorMsg(null)
    try {
      const res = await fetch(`/api/roles/${roleToDelete.id}`, { method: "DELETE" })
      if (res.ok) {
        setRoleToDelete(null)
        fetchAll()
      } else {
        const error = await res.json()
        setRoleDeleteErrorMsg(error.error || "Failed to delete role")
      }
    } catch (e) {
      console.error(e)
      setRoleDeleteErrorMsg("An unexpected error occurred.")
    }
  }

  if (loading) return <div className="p-8 text-center text-slate-500">Loading team members...</div>

  return (
    <div className="space-y-8">
      {/* ---- Users ---- */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-lg font-medium flex items-center gap-2"><Users className="w-4 h-4" /> Staff Accounts</h3>
            <p className="text-sm text-slate-500">Manage user accounts, roles, and work-location assignment</p>
          </div>
          <Button onClick={openNewUserDialog} className="bg-indigo-600 hover:bg-indigo-700 text-white">
            <Plus className="w-4 h-4 mr-2" /> Add Team Member
          </Button>
        </div>

        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.firstName} {user.lastName}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={getRoleBadgeColor(user.role.name)}>{user.role.name}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">
                    {user.scope === "ENTERPRISE"
                      ? "All properties"
                      : properties.find((p) => p.id === user.propertyId)?.name ?? "Single property"}
                  </TableCell>
                  <TableCell>
                    {user.isActive ? (
                      <span className="flex items-center text-emerald-600 text-sm font-medium"><CheckCircle2 className="w-4 h-4 mr-1" /> Active</span>
                    ) : (
                      <span className="flex items-center text-slate-400 text-sm font-medium"><XCircle className="w-4 h-4 mr-1" /> Inactive</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => openEditUserDialog(user)}>
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
                  <TableCell colSpan={6} className="text-center py-8 text-slate-500">No users found. Create your first team member!</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* ---- Roles ---- */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-lg font-medium flex items-center gap-2"><KeyRound className="w-4 h-4" /> Roles &amp; Permissions</h3>
            <p className="text-sm text-slate-500">Per-module view / create / update / delete access. System roles are shared and read-only.</p>
          </div>
          <Button onClick={openNewRoleDialog} variant="outline">
            <Plus className="w-4 h-4 mr-2" /> New Role
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {roles.map((role) => (
            <Card key={role.id} className="premium-card">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    {role.name}
                    {role.isSystem && <Badge variant="secondary" className="bg-slate-100 text-slate-600">System</Badge>}
                  </CardTitle>
                </div>
                <CardDescription>{role._count?.users ?? 0} user{role._count?.users === 1 ? "" : "s"} assigned</CardDescription>
              </CardHeader>
              <CardContent className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => openEditRoleDialog(role)}>
                  <Edit className="w-4 h-4 mr-1" /> {role.isSystem ? "View" : "Edit"}
                </Button>
                {!role.isSystem && (
                  <Button variant="ghost" size="sm" onClick={() => setRoleToDelete(role)}>
                    <Trash2 className="w-4 h-4 text-rose-500" />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* ---- User delete confirm ---- */}
      <Dialog open={!!userToDelete} onOpenChange={(open) => { if (!open) { setUserToDelete(null); setDeleteErrorMsg(null) } }}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Are you absolutely sure?</DialogTitle>
            <DialogDescription>
              This will permanently delete the user account for <strong>{userToDelete?.firstName} {userToDelete?.lastName}</strong>.
            </DialogDescription>
          </DialogHeader>
          {deleteErrorMsg && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm p-3 rounded-md flex items-start">
              <Shield className="w-4 h-4 mr-2 mt-0.5 shrink-0" /><span>{deleteErrorMsg}</span>
            </div>
          )}
          <DialogFooter className="mt-4 gap-2">
            <Button variant="outline" onClick={() => { setUserToDelete(null); setDeleteErrorMsg(null) }}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteUser}>Delete User</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- User add/edit ---- */}
      <Dialog open={isUserDialogOpen} onOpenChange={setIsUserDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingUser ? "Edit Team Member" : "Add Team Member"}</DialogTitle>
            <DialogDescription>{editingUser ? "Update staff details and access levels." : "Create a new user account for your staff."}</DialogDescription>
          </DialogHeader>
          {userErrorMsg && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm p-3 rounded-md flex items-center">
              <Shield className="w-4 h-4 mr-2" />{userErrorMsg}
            </div>
          )}
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">First Name</label>
                <Input value={userForm.firstName} onChange={(e) => setUserForm({ ...userForm, firstName: e.target.value })} placeholder="John" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Last Name</label>
                <Input value={userForm.lastName} onChange={(e) => setUserForm({ ...userForm, lastName: e.target.value })} placeholder="Doe" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email Address</label>
              <Input type="email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} placeholder="john.doe@example.com" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Password {editingUser && <span className="text-slate-400 font-normal">(Leave blank to keep unchanged)</span>}
              </label>
              <Input type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} placeholder={editingUser ? "••••••••" : "Create a secure password"} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1"><Shield className="w-4 h-4 text-indigo-500" /> Role</label>
              <Select value={userForm.roleId} onValueChange={(v) => setUserForm({ ...userForm, roleId: v ?? "" })}>
                <SelectTrigger><SelectValue placeholder="Select role">{roles.find((r) => r.id === userForm.roleId)?.name}</SelectValue></SelectTrigger>
                <SelectContent>
                  {roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}{r.isSystem ? " (System)" : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Access</label>
                <Select
                  value={userForm.scope}
                  onValueChange={(v) => setUserForm({ ...userForm, scope: (v as "ENTERPRISE" | "PROPERTY") ?? "ENTERPRISE" })}
                  disabled={isPropertyLockedActor}
                >
                  <SelectTrigger><SelectValue>{userForm.scope === "ENTERPRISE" ? "All Properties" : "Single Property"}</SelectValue></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ENTERPRISE">All Properties (Enterprise-wide)</SelectItem>
                    <SelectItem value="PROPERTY">Single Property (Work Location)</SelectItem>
                  </SelectContent>
                </Select>
                {isPropertyLockedActor && (
                  <p className="text-xs text-slate-500">You can only manage users at your own property.</p>
                )}
              </div>
              {userForm.scope === "PROPERTY" && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Work Location</label>
                  <Select
                    value={userForm.propertyId}
                    onValueChange={(v) => setUserForm({ ...userForm, propertyId: v ?? "" })}
                    disabled={isPropertyLockedActor}
                  >
                    <SelectTrigger><SelectValue placeholder="Select property">{properties.find((p) => p.id === userForm.propertyId)?.name}</SelectValue></SelectTrigger>
                    <SelectContent>
                      {properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsUserDialogOpen(false)}>Cancel</Button>
            <Button
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
              onClick={handleSaveUser}
              disabled={savingUser || !userForm.email || !userForm.roleId || (!editingUser && !userForm.password) || !userForm.firstName}
            >
              {savingUser ? "Saving..." : "Save User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Role delete confirm ---- */}
      <Dialog open={!!roleToDelete} onOpenChange={(open) => { if (!open) { setRoleToDelete(null); setRoleDeleteErrorMsg(null) } }}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete role &quot;{roleToDelete?.name}&quot;?</DialogTitle>
            <DialogDescription>This cannot be undone. A role with users still assigned cannot be deleted.</DialogDescription>
          </DialogHeader>
          {roleDeleteErrorMsg && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm p-3 rounded-md flex items-start">
              <Shield className="w-4 h-4 mr-2 mt-0.5 shrink-0" /><span>{roleDeleteErrorMsg}</span>
            </div>
          )}
          <DialogFooter className="mt-4 gap-2">
            <Button variant="outline" onClick={() => { setRoleToDelete(null); setRoleDeleteErrorMsg(null) }}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteRole}>Delete Role</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Role add/edit ---- */}
      <Dialog open={isRoleDialogOpen} onOpenChange={setIsRoleDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRole ? (editingRole.isSystem ? `View "${editingRole.name}"` : `Edit "${editingRole.name}"`) : "New Role"}</DialogTitle>
            <DialogDescription>
              {editingRole?.isSystem ? "System roles are shared across enterprises and cannot be edited." : "Tick the modules this role can view, create, update, or delete."}
            </DialogDescription>
          </DialogHeader>
          {roleErrorMsg && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm p-3 rounded-md flex items-center">
              <Shield className="w-4 h-4 mr-2" />{roleErrorMsg}
            </div>
          )}
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Role Name</label>
              <Input value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder="e.g. Night Manager" disabled={editingRole?.isSystem} />
            </div>
            <RolePermissionMatrix value={roleMatrix} onChange={setRoleMatrix} disabled={editingRole?.isSystem} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRoleDialogOpen(false)}>{editingRole?.isSystem ? "Close" : "Cancel"}</Button>
            {!editingRole?.isSystem && (
              <Button className="bg-indigo-600 hover:bg-indigo-700 text-white" onClick={handleSaveRole} disabled={savingRole}>
                {savingRole ? "Saving..." : "Save Role"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
