import type { WidgetCatalogEntry } from "@/lib/dashboard/layout";

// Every widget the Operations Dashboard can show, in the order a brand-new user gets them.
//
// Metadata only — no data, no JSX, no hooks — for two reasons. It is a module constant, so
// a saved layout can be reconciled against it on the very first render, before the payload
// has arrived. And it has no client dependencies, so the SERVER can read it too: the
// overview endpoint needs the id list to work out which widgets a session's roles permit
// (src/lib/dashboard/overview.ts), and the role editor needs the titles and groups to
// render its checkboxes.
//
// ADDING A WIDGET means an entry here AND a node with the same id in buildWidgetNodes()
// (src/components/dashboard/operations-dashboard.tsx). An entry with no node never
// renders; a node with no entry never appears.
//
// IDS ARE PERSISTED — in every user's saved layout (UserDashboardLayout) and in every
// per-role block row (RoleDashboardWidget). Renaming one silently resets that widget's
// placement for everyone and drops any admin's decision to hide it. Treat ids as stable
// and change `title` instead.

export const WIDGET_CATALOG: readonly WidgetCatalogEntry[] = [
  { id: "ribbon", title: "Status ribbon", defaultSize: "full", group: "Status", align: "start" },

  { id: "kpi-occupancy", title: "Occupancy", defaultSize: "sm", group: "Key figures", align: "start" },
  { id: "kpi-adr", title: "ADR", defaultSize: "sm", group: "Key figures", align: "start" },
  { id: "kpi-revpar", title: "RevPAR", defaultSize: "sm", group: "Key figures", align: "start" },
  { id: "kpi-revenue-today", title: "Revenue today", defaultSize: "sm", group: "Key figures", align: "start" },
  { id: "kpi-in-house", title: "In-house guests", defaultSize: "sm", group: "Key figures", align: "start" },
  { id: "kpi-payments", title: "Payments today", defaultSize: "sm", group: "Key figures", align: "start" },
  { id: "kpi-receivables", title: "Accounts receivable", defaultSize: "sm", group: "Key figures", align: "start" },
  { id: "kpi-on-the-books", title: "On the books", defaultSize: "sm", group: "Key figures", align: "start" },

  { id: "trend", title: "Occupancy & rate trend", defaultSize: "lg", group: "Performance" },
  { id: "revenue-mix", title: "Revenue mix", defaultSize: "md", group: "Performance" },
  { id: "movements", title: "Today's movements", defaultSize: "md", group: "Front office" },
  { id: "housekeeping", title: "Rooms & housekeeping", defaultSize: "md", group: "Housekeeping" },
  { id: "booking-pace", title: "Booking pace", defaultSize: "lg", group: "Performance" },
  { id: "payments", title: "Payments by method", defaultSize: "md", group: "Cashiering" },
  { id: "receivables", title: "Receivables aging", defaultSize: "md", group: "Cashiering" },
  { id: "maintenance", title: "Maintenance", defaultSize: "md", group: "Housekeeping" },
  { id: "arrivals", title: "Arrivals to check in", defaultSize: "md", group: "Front office" },
  { id: "departures", title: "Departures to settle", defaultSize: "md", group: "Front office" },
  { id: "alerts", title: "Open alerts", defaultSize: "md", group: "Front office" },
  { id: "guest-mix", title: "Guest mix", defaultSize: "md", group: "Guests" },
  { id: "outlets", title: "Outlet sales", defaultSize: "md", group: "Revenue" },
  { id: "groups", title: "Group blocks", defaultSize: "md", group: "Reservations" },
  { id: "spa", title: "Spa today", defaultSize: "md", group: "Guests" },
  { id: "excursions", title: "Excursions today", defaultSize: "md", group: "Guests" },
  { id: "activity", title: "Recent activity", defaultSize: "md", group: "Administration" },
];

export const CATALOG_BY_ID = new Map(WIDGET_CATALOG.map((w) => [w.id, w]));

export const WIDGET_IDS: readonly string[] = WIDGET_CATALOG.map((w) => w.id);

/**
 * Catalogue grouped for the role editor's checkbox list — one section per group name, in
 * order of first appearance.
 *
 * Gathers by NAME, not by adjacent run. The catalogue is ordered for the dashboard's
 * default layout, where a group's widgets are deliberately not contiguous ("Performance"
 * opens the page and returns lower down at Booking pace), so folding only neighbours
 * produced two "Performance" sections — and, since the list is keyed by group name, a
 * duplicate-key warning and two half-populated columns.
 */
export function widgetsByGroup(): { group: string; widgets: WidgetCatalogEntry[] }[] {
  const byGroup = new Map<string, WidgetCatalogEntry[]>();
  for (const w of WIDGET_CATALOG) {
    const existing = byGroup.get(w.group);
    if (existing) existing.push(w);
    else byGroup.set(w.group, [w]);
  }
  return [...byGroup].map(([group, widgets]) => ({ group, widgets }));
}
