// The enterprise-selectable "Primary Color" presets shown in Controls > General — names
// match shadcn/ui's own well-known base-color palette (plus this app's original
// "indigo" default), so admins pick from familiar, tested combinations rather than a
// free-form color input. Applied as a CSS variable override scoped to the dashboard
// layout (see src/app/dashboard/layout.tsx) — it never touches the public login pages.
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

export function isThemeColorName(value: string): value is ThemeColorName {
  return value in THEME_COLOR_PRESETS;
}

export function resolveThemeColorPreset(value: string | null | undefined): ThemeColorPreset {
  if (value && isThemeColorName(value)) return THEME_COLOR_PRESETS[value];
  return THEME_COLOR_PRESETS.indigo;
}
