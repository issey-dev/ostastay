// Shared by SidebarUserMenu (a Client Component) and the OstaSidebar/HubSidebar Server
// Components' own footer identity rows. Deliberately NOT in sidebar-user-menu.tsx: a
// Server Component calling a plain function imported from a "use client" module crashes
// at render with "Attempted to call initials() from the server but initials is on the
// client" — Next.js replaces every export of a client module with a reference proxy for
// the server module graph, and that proxy only supports being rendered as a Component,
// not invoked directly. This module carries no directive, so it's safe to call from both
// sides of the boundary.
export function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("")
}
