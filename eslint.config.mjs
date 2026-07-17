import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Raw Tailwind palette families the app's monochromatic design system replaced with
// semantic tokens (bg-muted, text-foreground, bg-success, etc). Matches only when a
// recognized utility prefix is immediately followed by one of these family names and a
// numeric shade, e.g. "text-slate-500" or "hover:bg-indigo-600" — deliberately narrow so
// it can't match token names like "text-muted-foreground" or "shadow-elevation-1".
const RAW_PALETTE_REGEX =
  /\b(?:hover:|focus:|active:|dark:|group-hover:)?(?:bg|text|border|ring|from|to|via|fill|stroke|divide|outline|decoration|accent|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}\b/;

// Only flags a hex literal when it's the value of a property/variable whose name reads
// as a color (color, backgroundColor, brandColor, invoiceBrandColor, ...) — matching
// every bare "#xxxxxx"-shaped string anywhere would flag unrelated things (IDs, hashes,
// placeholder text) that happen to look like hex.
const HEX_LITERAL_REGEX = /^#[0-9A-Fa-f]{3,8}$/;
const COLOR_KEY_REGEX = /color/i;

const ALLOWED_HEX_FILES = [
  "src/app/theme.css",
  "src/lib/themePresets.ts",
  "src/lib/invoice-branding.ts",
];

// Printed invoice documents intentionally render as fixed "paper" (light background,
// dark text) regardless of the app's dark-mode state — a physical printout can't go
// dark mode. Only the printable document markup itself is exempt; the surrounding
// on-screen control bar and loading/error states in these same files are NOT exempt
// and are already token-driven. See DESIGN_PLAN.md §4.5.
const PRINT_DOCUMENT_FILES = [
  "src/app/print/folios/[id]/page.tsx",
  "src/app/e/[slug]/dashboard/folios/[id]/print/page.tsx",
];

function isClassNameAttribute(node) {
  let current = node.parent;
  while (current) {
    if (current.type === "JSXAttribute" && current.name?.name === "className") return true;
    // Stop walking once we leave the immediate attribute-value expression.
    if (current.type === "JSXAttribute" || current.type === "JSXElement") return false;
    current = current.parent;
  }
  return false;
}

function isColorNamedProperty(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (parent.type === "Property" && parent.key && (parent.key.name || parent.key.value)) {
    return COLOR_KEY_REGEX.test(parent.key.name ?? parent.key.value);
  }
  if (parent.type === "VariableDeclarator" && parent.id?.type === "Identifier") {
    return COLOR_KEY_REGEX.test(parent.id.name);
  }
  if (parent.type === "AssignmentExpression" && parent.left?.type === "Identifier") {
    return COLOR_KEY_REGEX.test(parent.left.name);
  }
  return false;
}

const designSystemPlugin = {
  rules: {
    "no-raw-palette-class": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow raw Tailwind palette color classes in className — use a semantic token instead.",
        },
        schema: [],
      },
      create(context) {
        const filename = (context.filename ?? context.getFilename()).replaceAll("\\", "/");
        if (PRINT_DOCUMENT_FILES.some((f) => filename.endsWith(f))) {
          return {};
        }
        const report = (node, text) => {
          if (RAW_PALETTE_REGEX.test(text)) {
            context.report({
              node,
              message:
                "Raw Tailwind color class '{{match}}' — use a semantic token instead (bg-muted, text-foreground, bg-success, text-destructive, etc). The app's palette is monochromatic; color is reserved for status tones and the enterprise accent slot (accent-enterprise, EnterpriseBanner only). See DESIGN_PLAN.md.",
              data: { match: RAW_PALETTE_REGEX.exec(text)[0] },
            });
          }
        };
        return {
          Literal(node) {
            if (typeof node.value !== "string") return;
            if (!isClassNameAttribute(node)) return;
            report(node, node.value);
          },
          TemplateElement(node) {
            if (!isClassNameAttribute(node)) return;
            report(node, node.value.raw);
          },
        };
      },
    },
    "no-hardcoded-hex-color": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow hardcoded hex color literals outside the design-token source files.",
        },
        schema: [],
      },
      create(context) {
        const filename = context.filename ?? context.getFilename();
        const normalized = filename.replace(/\\/g, "/");
        if (ALLOWED_HEX_FILES.some((f) => normalized.endsWith(f))) {
          return {};
        }
        return {
          Literal(node) {
            if (typeof node.value !== "string") return;
            if (!HEX_LITERAL_REGEX.test(node.value)) return;
            if (!isColorNamedProperty(node)) return;
            context.report({
              node,
              message:
                "Hardcoded hex color '{{value}}' — add it to src/app/theme.css (design tokens), src/lib/themePresets.ts (enterprise accent presets), or src/lib/invoice-branding.ts (invoice branding default) instead of inlining it here.",
              data: { value: node.value },
            });
          },
        };
      },
    },
    "no-enterprise-accent-outside-banner": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Restrict the accent-enterprise token to EnterpriseBanner — every other component must stay monochromatic.",
        },
        schema: [],
      },
      create(context) {
        const filename = (context.filename ?? context.getFilename()).replaceAll("\\", "/");
        // SupportSessionExitButton renders only inside EnterpriseBanner's `actions` slot
        // (see src/app/e/[slug]/dashboard/layout.tsx) and needs accent-enterprise-foreground
        // to read against the banner's own accent-colored background — a banner-child
        // extension of the sanctioned surface, not an independent misuse.
        const exceptions = [
          "src/components/ui/enterprise-banner.tsx",
          "src/components/controls/support-session-exit-button.tsx",
        ];
        if (exceptions.some((f) => filename.endsWith(f))) {
          return {};
        }
        const report = (node, text) => {
          if (text.includes("accent-enterprise")) {
            context.report({
              node,
              message:
                "accent-enterprise is a reserved token consumed only by EnterpriseBanner (src/components/ui/enterprise-banner.tsx) — every other component must stay monochromatic. See DESIGN_PLAN.md §3.3.",
            });
          }
        };
        return {
          Literal(node) {
            if (typeof node.value === "string") report(node, node.value);
          },
          TemplateElement(node) {
            report(node, node.value.raw);
          },
        };
      },
    },
  },
};

const designSystemGuardrails = {
  files: ["src/**/*.{ts,tsx}"],
  plugins: { design: designSystemPlugin },
  rules: {
    "design/no-raw-palette-class": "error",
    "design/no-hardcoded-hex-color": "error",
  },
};

const enterpriseAccentGuardrail = {
  files: ["src/components/**/*.{ts,tsx}"],
  plugins: { design: designSystemPlugin },
  rules: {
    "design/no-enterprise-accent-outside-banner": "error",
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  designSystemGuardrails,
  enterpriseAccentGuardrail,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
