// The property-selectable "Banner Color" presets shown in Controls > General >
// Appearance (see property-banner-color-manager.tsx). Named for the Maldivian
// landscape the product sells into rather than for a generic UI palette, so the list
// reads as a place instead of a color picker.
//
// Property.bannerColor stores the resolved hex directly, not one of these names, so a
// future free-form picker can replace this curated list without a schema change.
//
// Every value is constrained so the accent stays safe wherever it lands:
//   - white text on the swatch clears WCAG AA (>= 4.5:1), since the picker and any
//     solid accent fill render label text on top of it;
//   - saturation stays at or below 80% (the design system's cap — no neon);
//   - lightness sits mid-range so the 6px PropertyBannerBar line is still visible
//     against both the light (#FAF9F6) and dark (#0F0E0C) app backgrounds.
// Changing a hex means re-checking those three. See .agents/docs/DESIGN_PLAN.md §2.1.
export type ThemeColorName =
  | "ocean"
  | "lagoon"
  | "palm"
  | "beach"
  | "sunset"
  | "coral";

type ThemeColorPreset = {
  label: string;
  primary: string;
  primaryForeground: string;
};

export const THEME_COLOR_PRESETS: Record<ThemeColorName, ThemeColorPreset> = {
  // Deep water off the reef edge. The default — the most neutral of the six.
  ocean: { label: "Ocean (Default)", primary: "#1A5CA0", primaryForeground: "#ffffff" },
  // The turquoise shallows inside the reef.
  lagoon: { label: "Lagoon", primary: "#107880", primaryForeground: "#ffffff" },
  // Coconut palm canopy.
  palm: { label: "Palm", primary: "#2F6B45", primaryForeground: "#ffffff" },
  // Wet sand at the waterline — the muted one, for properties that want almost no accent.
  beach: { label: "Beach", primary: "#87703F", primaryForeground: "#ffffff" },
  // Late sun over the water.
  sunset: { label: "Sunset", primary: "#B55018", primaryForeground: "#ffffff" },
  // Reef coral.
  coral: { label: "Coral", primary: "#C43E63", primaryForeground: "#ffffff" },
};

export const THEME_COLOR_NAMES = Object.keys(THEME_COLOR_PRESETS) as ThemeColorName[];
