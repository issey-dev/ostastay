// Per-user layout for the Operations Dashboard: which widgets are shown, how wide each
// one is, which page (tab) it sits on, and in what order.
//
// WHERE THIS LIVES — server-side, one row per user PER PROPERTY (UserDashboardLayout),
// read and written through /api/dashboard/layout. Not localStorage: a front desk has
// several terminals and staff move between them, so an arrangement someone has built is
// expected to be there when they sign in on the next machine. Keyed by user, so two people
// sharing a terminal never inherit each other's screen; keyed by property too, because one
// person's two properties are two different jobs and the cards that matter at a city hotel
// are the ones that sit empty at an island resort.
//
// It is a PREFERENCE and never a gate. What a user may see is decided by
// /api/dashboard/overview (per-section module permissions) and, on top of that, by the
// per-role widget block list an admin manages. Hiding a widget here hides a card from its
// owner; it hides data from nobody.
//
// reconcile() is what makes any of this safe to store: the saved layout names widgets by
// id, the catalogue those ids refer to changes with every release, and a layout written by
// an older build is repaired on read rather than migrated.

/** Column span at the widest breakpoint. The grid is 12 columns; see SIZE_CLASS. */
export type WidgetSize = "sm" | "md" | "lg" | "full";

export const WIDGET_SIZES: readonly WidgetSize[] = ["sm", "md", "lg", "full"];

export const SIZE_LABEL: Record<WidgetSize, string> = {
  sm: "Small",
  md: "Medium",
  lg: "Large",
  full: "Full width",
};

/**
 * Tailwind spans per size. Written out in full because Tailwind scans source for literal
 * class names — a computed `xl:col-span-${n}` compiles to nothing.
 *
 * 12 columns at xl, 6 at md, 1 below. A "small" widget is a KPI tile (four to a row), a
 * "medium" is a standard panel (three to a row), "large" is two-thirds, "full" is the row.
 */
export const SIZE_CLASS: Record<WidgetSize, string> = {
  sm: "md:col-span-3 xl:col-span-3",
  md: "md:col-span-6 xl:col-span-4",
  lg: "md:col-span-6 xl:col-span-8",
  full: "md:col-span-6 xl:col-span-12",
};

export type DashboardPageDef = {
  id: string;
  name: string;
};

export type WidgetPlacement = {
  id: string;
  pageId: string;
  size: WidgetSize;
  hidden: boolean;
};

export type DashboardLayout = {
  version: number;
  pages: DashboardPageDef[];
  /** Render order IS array order, within each page. */
  widgets: WidgetPlacement[];
};

/** What a widget declares about itself, independent of any user's arrangement. */
export type WidgetCatalogEntry = {
  id: string;
  /** Shown in the settings dialog and read out by the drag handle. */
  title: string;
  defaultSize: WidgetSize;
  /** Grouping in the settings list only — has no effect on layout. */
  group: string;
  /**
   * Whether the widget stretches to its grid row's height. Panels do (a row of cards with
   * ragged bottoms looks broken); a KPI tile does not, or it grows to the height of
   * whatever tall panel happens to land beside it once the user rearranges things.
   */
  align?: "start" | "stretch";
};

export const LAYOUT_VERSION = 1;
export const DEFAULT_PAGE_ID = "overview";

export function defaultLayout(catalog: readonly WidgetCatalogEntry[]): DashboardLayout {
  return {
    version: LAYOUT_VERSION,
    pages: [{ id: DEFAULT_PAGE_ID, name: "Overview" }],
    widgets: catalog.map((w) => ({ id: w.id, pageId: DEFAULT_PAGE_ID, size: w.defaultSize, hidden: false })),
  };
}

/**
 * Make a stored layout safe to render against the CURRENT catalogue.
 *
 * Four things can be stale by the time a layout is read back, and silently rendering any
 * of them is a broken page rather than a stale preference:
 *   · a widget that no longer ships (dropped)
 *   · a widget that shipped since the layout was saved (appended, visible — a new tile
 *     appearing is the right default; a user who does not want it can hide it, whereas a
 *     new tile that defaults to hidden is invisible and undiscoverable)
 *   · a widget pointing at a page that has been deleted (moved to the first page)
 *   · no pages at all (one is recreated)
 *
 * Widgets absent from the catalogue for THIS user — a section their role cannot view —
 * are not dropped here. They are filtered at render time, so that losing access to
 * Revenue for a week does not silently discard where those tiles were arranged.
 */
export function reconcile(stored: DashboardLayout | null, catalog: readonly WidgetCatalogEntry[]): DashboardLayout {
  if (!stored || !Array.isArray(stored.pages) || !Array.isArray(stored.widgets)) return defaultLayout(catalog);

  const pages = stored.pages.filter((p) => p && typeof p.id === "string" && typeof p.name === "string");
  if (pages.length === 0) pages.push({ id: DEFAULT_PAGE_ID, name: "Overview" });
  const pageIds = new Set(pages.map((p) => p.id));
  const firstPage = pages[0].id;

  const byId = new Map(catalog.map((w) => [w.id, w]));
  const seen = new Set<string>();
  const widgets: WidgetPlacement[] = [];

  for (const w of stored.widgets) {
    if (!w || typeof w.id !== "string" || seen.has(w.id)) continue;
    seen.add(w.id);
    widgets.push({
      id: w.id,
      pageId: pageIds.has(w.pageId) ? w.pageId : firstPage,
      size: WIDGET_SIZES.includes(w.size) ? w.size : (byId.get(w.id)?.defaultSize ?? "md"),
      hidden: w.hidden === true,
    });
  }

  for (const entry of catalog) {
    if (seen.has(entry.id)) continue;
    widgets.push({ id: entry.id, pageId: firstPage, size: entry.defaultSize, hidden: false });
  }

  return { version: LAYOUT_VERSION, pages, widgets };
}

/** Move `id` so that it sits immediately before `targetId` in the widget order. */
export function moveWidget(layout: DashboardLayout, id: string, targetId: string): DashboardLayout {
  if (id === targetId) return layout;
  const widgets = [...layout.widgets];
  const from = widgets.findIndex((w) => w.id === id);
  const to = widgets.findIndex((w) => w.id === targetId);
  if (from < 0 || to < 0) return layout;
  const [moved] = widgets.splice(from, 1);
  const insertAt = widgets.findIndex((w) => w.id === targetId);
  // A widget dragged onto a card on another page joins that page — dropping it there is
  // an unambiguous statement of where it belongs, and refusing the drop is a dead end.
  const targetPageId = widgets[insertAt].pageId;
  widgets.splice(insertAt, 0, { ...moved, pageId: targetPageId });
  return { ...layout, widgets };
}

/** Nudge a widget one place earlier or later within its own page. Keyboard equivalent of a drag. */
export function nudgeWidget(layout: DashboardLayout, id: string, direction: -1 | 1): DashboardLayout {
  const pageId = layout.widgets.find((w) => w.id === id)?.pageId;
  if (!pageId) return layout;
  const onPage = layout.widgets.filter((w) => !w.hidden && w.pageId === pageId);
  const pos = onPage.findIndex((w) => w.id === id);
  const neighbour = onPage[pos + direction];
  if (pos < 0 || !neighbour) return layout;

  const widgets = [...layout.widgets];
  const a = widgets.findIndex((w) => w.id === id);
  const b = widgets.findIndex((w) => w.id === neighbour.id);
  [widgets[a], widgets[b]] = [widgets[b], widgets[a]];
  return { ...layout, widgets };
}

export function updateWidget(layout: DashboardLayout, id: string, patch: Partial<WidgetPlacement>): DashboardLayout {
  return { ...layout, widgets: layout.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)) };
}

export function addPage(layout: DashboardLayout, name: string): DashboardLayout {
  const id = `p${Date.now().toString(36)}`;
  return { ...layout, pages: [...layout.pages, { id, name: name.trim() || `Page ${layout.pages.length + 1}` }] };
}

export function renamePage(layout: DashboardLayout, id: string, name: string): DashboardLayout {
  return { ...layout, pages: layout.pages.map((p) => (p.id === id ? { ...p, name } : p)) };
}

/** Delete a page. Its widgets move to the first surviving page rather than vanishing. */
export function removePage(layout: DashboardLayout, id: string): DashboardLayout {
  if (layout.pages.length <= 1) return layout;
  const pages = layout.pages.filter((p) => p.id !== id);
  const fallback = pages[0].id;
  return { ...layout, pages, widgets: layout.widgets.map((w) => (w.pageId === id ? { ...w, pageId: fallback } : w)) };
}

export function movePage(layout: DashboardLayout, id: string, direction: -1 | 1): DashboardLayout {
  const pages = [...layout.pages];
  const i = pages.findIndex((p) => p.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= pages.length) return layout;
  [pages[i], pages[j]] = [pages[j], pages[i]];
  return { ...layout, pages };
}

// ── Persistence ───────────────────────────────────────────────────────────────────
// The only functions that know WHERE a layout is kept. Isolated here so the store can be
// changed again without any component learning about it.

/** Generous, but bounded: the shipped catalogue serialises to about 2 KB. */
export const MAX_LAYOUT_BYTES = 64 * 1024;

/**
 * Is this a dashboard layout at all? Used by the API before it writes the value into an
 * opaque JSON column, where nothing else would ever check. Shape only — the ids inside
 * are the client's business, and reconcile() is what makes them safe to render.
 */
export function isStorableLayout(value: unknown): value is DashboardLayout {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<DashboardLayout>;
  if (!Array.isArray(v.pages) || !Array.isArray(v.widgets)) return false;
  if (v.pages.length === 0 || v.pages.length > 20) return false;
  if (v.widgets.length > 200) return false;
  return (
    v.pages.every((p) => p && typeof p.id === "string" && typeof p.name === "string" && p.name.length <= 60) &&
    v.widgets.every((w) => w && typeof w.id === "string" && typeof w.pageId === "string")
  );
}

/** This user's saved layout FOR ONE PROPERTY, or null when they have never arranged it. */
export async function fetchLayout(propertyId: string, signal?: AbortSignal): Promise<DashboardLayout | null> {
  try {
    const res = await fetch(`/api/dashboard/layout?propertyId=${encodeURIComponent(propertyId)}`, { signal });
    if (!res.ok) return null;
    const body = await res.json();
    return isStorableLayout(body?.layout) ? (body.layout as DashboardLayout) : null;
  } catch {
    // A failed read is not a broken dashboard — it is the default arrangement. The user
    // finds out something is wrong only if they then try to SAVE, which does report.
    return null;
  }
}

export async function persistLayout(propertyId: string, layout: DashboardLayout): Promise<boolean> {
  try {
    const res = await fetch("/api/dashboard/layout", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId, layout }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Reset ONE property back to the shipped default; the user's other properties are untouched. */
export async function resetStoredLayout(propertyId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/dashboard/layout?propertyId=${encodeURIComponent(propertyId)}`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}
