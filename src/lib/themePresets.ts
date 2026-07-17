// The property-selectable "Banner Color" presets shown in Controls > General >
// Appearance (see property-banner-color-manager.tsx) — names match shadcn/ui's own
// well-known base-color palette (plus this app's original "indigo" default), so admins
// pick from familiar, tested combinations rather than a free-form color input.
// Property.bannerColor stores the resolved hex directly, not one of these names, so a
// future free-form picker can replace this curated list without a schema change.
export type ThemeColorName =
  | "indigo"
  | "zinc"
  | "red"
  | "rose"
  | "orange"
  | "green"
  | "blue"
  | "yellow"
  | "violet";

type ThemeColorPreset = {
  label: string;
  primary: string;
  primaryForeground: string;
};

export const THEME_COLOR_PRESETS: Record<ThemeColorName, ThemeColorPreset> = {
  indigo: { label: "Indigo (Default)", primary: "#4F46E5", primaryForeground: "#ffffff" },
  zinc: { label: "Zinc", primary: "#18181B", primaryForeground: "#ffffff" },
  red: { label: "Red", primary: "#DC2626", primaryForeground: "#ffffff" },
  rose: { label: "Rose", primary: "#E11D48", primaryForeground: "#ffffff" },
  orange: { label: "Orange", primary: "#EA580C", primaryForeground: "#ffffff" },
  green: { label: "Green", primary: "#16A34A", primaryForeground: "#ffffff" },
  blue: { label: "Blue", primary: "#2563EB", primaryForeground: "#ffffff" },
  yellow: { label: "Yellow", primary: "#CA8A04", primaryForeground: "#0F172A" },
  violet: { label: "Violet", primary: "#7C3AED", primaryForeground: "#ffffff" },
};

export const THEME_COLOR_NAMES = Object.keys(THEME_COLOR_PRESETS) as ThemeColorName[];
