"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useTableSort, SortableTableHead } from "@/components/controls/use-table-sort"
import { ControlsCard } from "@/components/controls/controls-card"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/ui/status-badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { Users, Plus, Edit, Trash2, Shield, Info, Briefcase, MoreHorizontal } from "@/components/icons"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { DesktopOnlyNotice } from "@/components/ui/mobile"
import { OptionSelect } from "@/components/ui/option-select"
import { JOB_FUNCTIONS, isJobFunction, jobFunctionLabel } from "@/lib/job-functions"
import { RoleWidgetAccess } from "@/components/controls/role-widget-access"
import { RolePermissionMatrix, emptyPermissionMatrix, grantsEnterpriseOnlyAccess, type PermissionMatrix } from "./role-permission-matrix"
import type { StatusTone } from "@/lib/status-tone"
import { MIN_PASSWORD_LENGTH, normalizeEmail, userIdentitySchema } from "@/lib/user-account-rules"
import { SubmitButton } from "@/components/ui/submit-button"
import { useConfirm } from "@/components/providers/confirm-provider"
import { apiError } from "@/lib/api-error"
import { toast } from "@/lib/toast"

type Role = {
  id: string
  name: string
  isSystem: boolean
  permissions: { module: string; canView: boolean; canCreate: boolean; canUpdate: boolean; canDelete: boolean }[]
  /** Dashboard widget ids this role may NOT see — see RoleWidgetAccess. */
  blockedWidgets?: string[]
  _count?: { users: number }
}

type UserRow = {
  id: string
  email: string
  firstName: string
  lastName: string
  roles: { role: { id: string; name: string; isSystem: boolean } }[]
  isProtected: boolean
  scope: "ENTERPRISE" | "PROPERTY"
  propertyId: string | null
  isActive: boolean
  jobFunction: string | null
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
  const confirm = useConfirm()

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
    roleIds: [] as string[], scope: "ENTERPRISE" as "ENTERPRISE" | "PROPERTY", propertyId: "",
    jobFunction: "", isActive: true,
  })
  // Inline, as-you-type validation of the identity fields (APP STANDARD 001), with the
  // same Zod rules the API applies (src/lib/user-account-rules.ts). A field's message
  // shows once it has been touched, so an empty new dialog doesn't open covered in red.
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const identityCheck = userIdentitySchema(editingUser ? "edit" : "create").safeParse(userForm)
  const identityErrors: Record<string, string> = {}
  if (!identityCheck.success) {
    for (const issue of identityCheck.error.issues) {
      const key = String(issue.path[0] ?? "")
      if (key && !identityErrors[key]) identityErrors[key] = issue.message
    }
  }
  const fieldError = (key: string) => (touched[key] ? identityErrors[key] : undefined)
  const touch = (key: string) => setTouched((t) => (t[key] ? t : { ...t, [key]: true }))
  // Whether ANY role currently chosen in the user dialog carries an enterprise-only
  // module — access is the union, so one such role among several is enough.
  const enterpriseOnlyRoles = roles.filter(
    (r) => userForm.roleIds.includes(r.id) && grantsEnterpriseOnlyAccess(matrixFromRole(r))
  )
  const selectedRoleGrantsEnterpriseOnly = enterpriseOnlyRoles.length > 0
  const [userErrorMsg, setUserErrorMsg] = useState<string | null>(null)
  const [savingUser, setSavingUser] = useState(false)
  const openNewUserDialog = () => {
    setEditingUser(null)
    setUserForm({
      firstName: "", lastName: "", email: "", password: "", roleIds: roles[0] ? [roles[0].id] : [],
      scope: isPropertyLockedActor ? "PROPERTY" : "ENTERPRISE",
      propertyId: isPropertyLockedActor ? (actorPropertyId ?? "") : "",
      jobFunction: "", isActive: true,
    })
    setTouched({})
    setUserErrorMsg(null)
    setIsUserDialogOpen(true)
  }

  const openEditUserDialog = (user: UserRow) => {
    setEditingUser(user)
    setUserForm({
      firstName: user.firstName, lastName: user.lastName, email: user.email, password: "",
      roleIds: user.roles.map((ur) => ur.role.id), scope: user.scope, propertyId: user.propertyId ?? "",
      jobFunction: user.jobFunction ?? "", isActive: user.isActive,
    })
    setTouched({})
    setUserErrorMsg(null)
    setIsUserDialogOpen(true)
  }

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault()
    // Enter submits the form, so the Save button's own guards are repeated here.
    if (savingUser || !identityCheck.success || userForm.roleIds.length === 0) return
    setSavingUser(true)
    setUserErrorMsg(null)

    const method = editingUser ? "PATCH" : "POST"
    const body: any = {
      ...userForm,
      // Sign-in lower-cases the address, so it is stored that way (the API does too).
      email: normalizeEmail(userForm.email),
      roles: userForm.roleIds,
      propertyId: userForm.scope === "PROPERTY" ? userForm.propertyId : null,
    }
    if (editingUser) body.id = editingUser.id
    else delete body.isActive // a new account is always created active
    if (!body.password) delete body.password

    try {
      const res = await fetch("/api/settings/users", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        setIsUserDialogOpen(false)
        toast.success("Team member saved")
        fetchAll()
      } else {
        setUserErrorMsg(await apiError(res, "Couldn't save the team member. Try again."))
      }
    } catch (e) {
      console.error(e)
      setUserErrorMsg("An unexpected error occurred while saving.")
    } finally {
      setSavingUser(false)
    }
  }

  const handleDeleteUser = async (userToDelete: UserRow) => {
    const ok = await confirm({
      title: "Delete this team member?",
      description: (
        <>
          This will permanently delete the user account for <strong>{userToDelete.firstName} {userToDelete.lastName}</strong>.
        </>
      ),
      confirmLabel: "Delete user",
      destructive: true,
    })
    if (!ok) return
    try {
      const res = await fetch(`/api/settings/users?id=${userToDelete.id}`, { method: "DELETE" })
      if (res.ok) {
        toast.success("Team member deleted")
        fetchAll()
      } else {
        toast.error(await apiError(res, "Couldn't delete the team member. Try again."))
      }
    } catch (e) {
      console.error(e)
      toast.error("Couldn't delete the team member. Try again.")
    }
  }

  const getRoleTone = (roleName: string): StatusTone => {
    if (roleName === "Housekeeping") return "success"
    if (roleName === "Maintenance") return "warning"
    if (roleName === "Reservations") return "info"
    return "neutral"
  }

  // ---- Roles ----
  const [isRoleDialogOpen, setIsRoleDialogOpen] = useState(false)
  const [editingRole, setEditingRole] = useState<Role | null>(null)
  const [roleName, setRoleName] = useState("")
  const [roleMatrix, setRoleMatrix] = useState<PermissionMatrix>(emptyPermissionMatrix())
  const [roleBlockedWidgets, setRoleBlockedWidgets] = useState<string[]>([])
  const [roleErrorMsg, setRoleErrorMsg] = useState<string | null>(null)
  const [savingRole, setSavingRole] = useState(false)

  const openNewRoleDialog = () => {
    setEditingRole(null)
    setRoleName("")
    setRoleMatrix(emptyPermissionMatrix())
    setRoleBlockedWidgets([])
    setRoleErrorMsg(null)
    setIsRoleDialogOpen(true)
  }

  const openEditRoleDialog = (role: Role) => {
    setEditingRole(role)
    setRoleName(role.name)
    setRoleMatrix(matrixFromRole(role))
    setRoleBlockedWidgets(role.blockedWidgets ?? [])
    setRoleErrorMsg(null)
    setIsRoleDialogOpen(true)
  }

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault()
    if (savingRole || editingRole?.isSystem) return
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
        body: JSON.stringify({ name: roleName, permissions: roleMatrix, blockedWidgets: roleBlockedWidgets }),
      })
      if (res.ok) {
        setIsRoleDialogOpen(false)
        toast.success("Role saved")
        fetchAll()
      } else {
        setRoleErrorMsg(await apiError(res, "Couldn't save the role. Try again."))
      }
    } catch (e) {
      console.error(e)
      setRoleErrorMsg("An unexpected error occurred while saving.")
    } finally {
      setSavingRole(false)
    }
  }

  const handleDeleteRole = async (roleToDelete: Role) => {
    const ok = await confirm({
      title: `Delete role "${roleToDelete.name}"?`,
      description: "This cannot be undone. A role with users still assigned cannot be deleted.",
      confirmLabel: "Delete role",
      destructive: true,
    })
    if (!ok) return
    try {
      const res = await fetch(`/api/roles/${roleToDelete.id}`, { method: "DELETE" })
      if (res.ok) {
        toast.success("Role deleted")
        fetchAll()
      } else {
        toast.error(await apiError(res, "Couldn't delete the role. Try again."))
      }
    } catch (e) {
      console.error(e)
      toast.error("Couldn't delete the role. Try again.")
    }
  }

  // First-column (Name) sorting for the users table, asc<->desc.
  const { sorted: sortedUsers, sort } = useTableSort(
    users,
    { name: (u) => `${u.firstName} ${u.lastName}` },
    "name"
  )

  if (loading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-9 w-full max-w-sm" />
        <Skeleton className="h-48 rounded-md" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ---- Users (own card) ---- */}
      <ControlsCard
        title="Staff accounts"
        description="Manage user accounts, roles, and work-location assignment."
        action={
          <Button onClick={openNewUserDialog}>
            <Plus className="w-4 h-4 mr-2" /> Add team member
          </Button>
        }
      >
        {/* Bleed the table/cards to the card edges (like every other Controls table). */}
        <div className="-mx-6 -mb-6 border-t border-border">
          {/* Phone view — one card per user: identity + role/post/access facts stacked,
              edit/delete reachable as full-width buttons instead of a cramped last
              column. The table below takes over at md. */}
          <div className="md:hidden">
            {users.length === 0 ? (
              <EmptyState icon={Users} title="No users found" description="Create your first team member." />
            ) : (
              // Compact rows: tap the person to edit them (deactivate, reset password, roles);
              // Delete sits behind ⋯ so it can't be hit by accident.
              <ul className="divide-y divide-border">
                {sortedUsers.map((user) => (
                  <li key={user.id} className="flex items-center gap-1 pr-2">
                    <button
                      type="button"
                      onClick={() => openEditUserDialog(user)}
                      className="flex min-h-14 min-w-0 flex-1 flex-col items-start justify-center px-4 py-2.5 text-left active:bg-muted"
                    >
                      <span className="flex w-full min-w-0 items-center gap-2">
                        <span className="truncate font-medium">{user.firstName} {user.lastName}</span>
                        <StatusBadge className="shrink-0" status={user.isActive ? "ACTIVE" : "INACTIVE"} label={user.isActive ? "Active" : "Inactive"} />
                      </span>
                      <span className="w-full truncate text-sm text-muted-foreground">
                        {user.roles.length ? user.roles.map((ur) => ur.role.name).join(", ") : "No role"}
                        {" · "}
                        {user.scope === "ENTERPRISE"
                          ? "All properties"
                          : properties.find((p) => p.id === user.propertyId)?.name ?? "Single property"}
                      </span>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<Button variant="ghost" size="icon" className="shrink-0" aria-label={`More actions for ${user.firstName} ${user.lastName}`} />}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-44">
                        <DropdownMenuItem onClick={() => openEditUserDialog(user)}>
                          <Edit className="h-4 w-4" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => handleDeleteUser(user)}>
                          <Trash2 className="h-4 w-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <SortableTableHead columnKey="name" sort={sort} className="px-6">Name</SortableTableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Post</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right px-6">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium px-6">{user.firstName} {user.lastName}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {user.roles.map((ur) => (
                          <StatusBadge key={ur.role.id} label={ur.role.name} tone={getRoleTone(ur.role.name)} />
                        ))}
                        {user.roles.length === 0 && <span className="text-sm text-muted-foreground">No role</span>}
                      </div>
                    </TableCell>
                    {/* Post, not role — an unset one reads as a dash rather than being
                        guessed from the role, which is exactly the conflation being undone. */}
                    <TableCell className="text-sm text-muted-foreground">
                      {jobFunctionLabel(user.jobFunction) ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {user.scope === "ENTERPRISE"
                        ? "All properties"
                        : properties.find((p) => p.id === user.propertyId)?.name ?? "Single property"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={user.isActive ? "ACTIVE" : "INACTIVE"} label={user.isActive ? "Active" : "Inactive"} />
                    </TableCell>
                    <TableCell className="text-right px-6">
                      <Button variant="ghost" size="sm" onClick={() => openEditUserDialog(user)}>
                        <Edit className="w-4 h-4 text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDeleteUser(user)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {users.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-0">
                      <EmptyState icon={Users} title="No users found" description="Create your first team member." />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </ControlsCard>

      {/* ---- Roles & Permissions (own card) ---- */}
      <ControlsCard
        title="Roles & permissions"
        description="Per-module view / create / update / delete access. System roles are shared and read-only."
        action={
          <Button onClick={openNewRoleDialog} className="max-md:hidden">
            <Plus className="w-4 h-4 mr-2" /> Add role
          </Button>
        }
      >
        {/* Phones: the role editor is a wide permission matrix — read-only list + notice. */}
        <DesktopOnlyNotice
          className="mb-4"
          feature="Role editing"
          description="Roles and their permissions are edited on a tablet or computer. You can still give people roles here."
        />
        <ul className="divide-y divide-border rounded-lg border border-border md:hidden">
          {roles.map((role) => (
            <li key={role.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="flex min-w-0 items-center gap-2 font-medium">
                <span className="truncate">{role.name}</span>
                {role.isSystem && <Badge variant="secondary" className="bg-muted text-muted-foreground">System</Badge>}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {role._count?.users ?? 0} user{role._count?.users === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-1 gap-3 max-md:hidden md:grid-cols-2 lg:grid-cols-3">
          {roles.map((role) => (
            <Card key={role.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    {role.name}
                    {role.isSystem && <Badge variant="secondary" className="bg-muted text-muted-foreground">System</Badge>}
                  </CardTitle>
                </div>
                <CardDescription>{role._count?.users ?? 0} user{role._count?.users === 1 ? "" : "s"} assigned</CardDescription>
              </CardHeader>
              <CardContent className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => openEditRoleDialog(role)}>
                  <Edit className="w-4 h-4 mr-1" /> {role.isSystem ? "View" : "Edit"}
                </Button>
                {!role.isSystem && (
                  <Button variant="ghost" size="sm" onClick={() => handleDeleteRole(role)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </ControlsCard>

      {/* ---- User add/edit ---- */}
      <Dialog open={isUserDialogOpen} onOpenChange={setIsUserDialogOpen}>
        <DialogContent size="md">
          <form onSubmit={handleSaveUser} className="contents">
          <DialogHeader>
            <DialogTitle>{editingUser ? "Edit team member" : "Add team member"}</DialogTitle>
            <DialogDescription>{editingUser ? "Update staff details and access levels." : "Create a new user account for your staff."}</DialogDescription>
          </DialogHeader>
          {userErrorMsg && (
            <div className="bg-destructive-muted border border-destructive/30 text-destructive text-sm p-3 rounded-md flex items-center">
              <Shield className="w-4 h-4 mr-2" />{userErrorMsg}
            </div>
          )}
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">First name</label>
                <Input value={userForm.firstName} onChange={(e) => { touch("firstName"); setUserForm({ ...userForm, firstName: e.target.value }) }} onBlur={() => touch("firstName")} placeholder="John" aria-invalid={!!fieldError("firstName")} />
                {fieldError("firstName") && <p className="text-xs text-destructive">{fieldError("firstName")}</p>}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Last name</label>
                <Input value={userForm.lastName} onChange={(e) => { touch("lastName"); setUserForm({ ...userForm, lastName: e.target.value }) }} onBlur={() => touch("lastName")} placeholder="Doe" aria-invalid={!!fieldError("lastName")} />
                {fieldError("lastName") && <p className="text-xs text-destructive">{fieldError("lastName")}</p>}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email address</label>
              <Input
                type="email"
                value={userForm.email}
                onChange={(e) => { touch("email"); setUserForm({ ...userForm, email: e.target.value }) }}
                onBlur={() => { touch("email"); setUserForm((f) => ({ ...f, email: normalizeEmail(f.email) })) }}
                placeholder="john.doe@example.com"
                aria-invalid={!!fieldError("email")}
              />
              {fieldError("email") ? (
                <p className="text-xs text-destructive">{fieldError("email")}</p>
              ) : (
                <p className="text-xs text-muted-foreground">Used to sign in. Saved in lower case.</p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Password {editingUser && <span className="text-muted-foreground font-normal">(leave blank to keep unchanged)</span>}
              </label>
              <Input
                type="password"
                value={userForm.password}
                onChange={(e) => { touch("password"); setUserForm({ ...userForm, password: e.target.value }) }}
                onBlur={() => touch("password")}
                placeholder={editingUser ? "••••••••" : "Create a secure password"}
                aria-invalid={!!fieldError("password")}
              />
              {fieldError("password") ? (
                <p className="text-xs text-destructive">{fieldError("password")}</p>
              ) : (
                <p className="text-xs text-muted-foreground">At least {MIN_PASSWORD_LENGTH} characters.</p>
              )}
            </div>
            {/* Edit only — a new account is always active. Deactivating ends the user's
                live sessions at once (the API revokes them); the onboarding account can
                never be deactivated (USER_MANAGEMENT_PLAN.md decision 9). */}
            {editingUser && (
              <div className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
                <div className="space-y-0.5">
                  <label htmlFor="user-active" className="text-sm font-medium">Active</label>
                  <p className="text-xs text-muted-foreground">
                    {editingUser.isProtected
                      ? "The onboarding account can’t be deactivated."
                      : userForm.isActive
                        ? "Can sign in."
                        : "Can’t sign in. Saving signs them out of every session."}
                  </p>
                </div>
                <Switch
                  id="user-active"
                  checked={userForm.isActive}
                  onCheckedChange={(checked) => setUserForm({ ...userForm, isActive: !!checked })}
                  disabled={editingUser.isProtected}
                />
              </div>
            )}
            {/* Roles are MANY per user: access is the union of what each grants, so
                holding "Cashier" and "Reservations" means both sets of permissions. */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1"><Shield className="w-4 h-4 text-primary" /> Roles</label>
              <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-md border border-border p-2">
                {roles.map((r) => {
                  const on = userForm.roleIds.includes(r.id)
                  return (
                    <label key={r.id} className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox
                        checked={on}
                        onCheckedChange={() =>
                          setUserForm({
                            ...userForm,
                            roleIds: on
                              ? userForm.roleIds.filter((x) => x !== r.id)
                              : [...userForm.roleIds, r.id],
                          })
                        }
                        disabled={editingUser?.isProtected}
                      />
                      <span>{r.name}{r.isSystem ? " (System)" : ""}</span>
                    </label>
                  )
                })}
              </div>
              {editingUser?.isProtected ? (
                <p className="text-xs text-warning">
                  This is the onboarding account — its access can&apos;t be changed. It&apos;s what
                  guarantees someone can always administer this enterprise.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Access is the combination of every role selected.
                </p>
              )}
            </div>
            {/* The user's POST, separate from the Role above. Roles decide what the app
                lets them see; this decides where they show up as assignable staff. */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1"><Briefcase className="w-4 h-4 text-primary" /> Job function</label>
              <OptionSelect
                value={userForm.jobFunction}
                onChange={(v) => setUserForm({ ...userForm, jobFunction: v })}
                options={[
                  { label: "No post assigned", value: "" },
                  ...JOB_FUNCTIONS.map((j) => ({ label: j.label, value: j.code })),
                  // A post stored before the list was fixed stays selectable for this user.
                  ...(editingUser?.jobFunction && !isJobFunction(editingUser.jobFunction)
                    ? [{ label: `${jobFunctionLabel(editingUser.jobFunction)} (no longer listed)`, value: editingUser.jobFunction }]
                    : []),
                ]}
              />
              <p className="text-xs text-muted-foreground">
                Their post at the property. Housekeeping and Maintenance decide who appears in
                the room-assignment and work-order pickers — the role does not.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Access</label>
                <Select
                  value={userForm.scope}
                  onValueChange={(v) => setUserForm({ ...userForm, scope: (v as "ENTERPRISE" | "PROPERTY") ?? "ENTERPRISE" })}
                  disabled={isPropertyLockedActor}
                >
                  <SelectTrigger><SelectValue>{userForm.scope === "ENTERPRISE" ? "All properties" : "Single property"}</SelectValue></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ENTERPRISE">All properties (enterprise-wide)</SelectItem>
                    <SelectItem value="PROPERTY">Single property (work location)</SelectItem>
                  </SelectContent>
                </Select>
                {isPropertyLockedActor && (
                  <p className="text-xs text-muted-foreground">You can only manage users at your own property.</p>
                )}
              </div>
              {userForm.scope === "PROPERTY" && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Work location</label>
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

            {/* A single-property user reaches only their own property's setup in the Hub,
                never the enterprise area (hasEnterpriseHubAccess in src/lib/scope.ts), so
                Users & Access can never take effect for them. Saying so here is the
                difference between a permission that quietly does nothing and one the admin
                understands — the save still succeeds, this is guidance, not a block. */}
            {selectedRoleGrantsEnterpriseOnly && userForm.scope === "PROPERTY" && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-muted/40 p-3 text-xs">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <p className="text-muted-foreground">
                  <strong className="text-foreground">
                    {enterpriseOnlyRoles.map((r) => r.name).join(", ")}
                  </strong>{" "}
                  grants Users &amp; Access, but a user assigned to a single property only reaches
                  their own property&apos;s setup — never the enterprise settings. That permission
                  will have no effect. Set Access to{" "}
                  <strong className="text-foreground">All properties</strong> if this user needs
                  to manage people.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsUserDialogOpen(false)}>Cancel</Button>
            <SubmitButton
              pending={savingUser}
              disabled={!identityCheck.success || userForm.roleIds.length === 0}
            >
              {editingUser ? "Save" : "Create"}
            </SubmitButton>
          </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ---- Role add/edit ----
          A side sheet, not a dialog (DESKTOP_PLAN D10): the permission matrix and the
          widget list make this a long form, so the role name + description stay pinned at
          the top and Cancel / Save at the bottom while only the body scrolls. Full width
          on a phone (ui/sheet.tsx). */}
      <Sheet open={isRoleDialogOpen} onOpenChange={setIsRoleDialogOpen}>
        <SheetContent
          side="right"
          className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[min(960px,95vw)]"
        >
          <form onSubmit={handleSaveRole} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader className="border-b border-border pr-12">
            <SheetTitle>{editingRole ? (editingRole.isSystem ? `View "${editingRole.name}"` : `Edit "${editingRole.name}"`) : "Add role"}</SheetTitle>
            <SheetDescription>
              {editingRole?.isSystem ? "System roles are shared across enterprises and cannot be edited." : "Tick the modules this role can view, create, update, or delete."}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {roleErrorMsg && (
              <div className="bg-destructive-muted border border-destructive/30 text-destructive text-sm p-3 rounded-md flex items-center">
                <Shield className="w-4 h-4 mr-2" />{roleErrorMsg}
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium">Role name</label>
              <Input value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder="e.g. Night Manager" disabled={editingRole?.isSystem} />
            </div>
            <RolePermissionMatrix value={roleMatrix} onChange={setRoleMatrix} disabled={editingRole?.isSystem} />
            {/* Only meaningful once the role can open the dashboard at all — otherwise it
                is a list of cards nobody will ever reach. */}
            {roleMatrix.DASHBOARD?.canView && (
              <RoleWidgetAccess value={roleBlockedWidgets} onChange={setRoleBlockedWidgets} disabled={editingRole?.isSystem} />
            )}
          </div>
          <SheetFooter className="mt-0 flex-row justify-end border-t border-border max-sm:pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Button type="button" variant="outline" onClick={() => setIsRoleDialogOpen(false)}>{editingRole?.isSystem ? "Close" : "Cancel"}</Button>
            {!editingRole?.isSystem && (
              <SubmitButton pending={savingRole}>
                {editingRole ? "Save" : "Create"}
              </SubmitButton>
            )}
          </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  )
}
