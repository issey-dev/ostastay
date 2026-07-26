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
  "src/components/print/print-document-shell.tsx",
  "src/components/print/print-blocks.tsx",
  "src/app/e/[slug]/dashboard/payments/[id]/receipt/page.tsx",
  "src/app/e/[slug]/dashboard/cashiering/exchange/[id]/receipt/page.tsx",
  // Guest/AR documents that render as fixed "paper" for print, same rationale as the
  // receipts above (a printout can't honor dark mode) — their document markup is
  // intentionally palette-fixed, so exempt it rather than tokenizing it.
  "src/app/e/[slug]/dashboard/reservations/[id]/confirmation-letter/page.tsx",
  "src/app/e/[slug]/dashboard/reservations/[id]/registration-card/page.tsx",
  "src/app/e/[slug]/dashboard/debtors/[profileId]/statement/page.tsx",
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
                "Raw Tailwind color class '{{match}}' — use a semantic token instead (bg-muted, text-foreground, bg-success, text-destructive, etc). The app's palette is monochromatic; per-property color is stored on Property.bannerColor and rendered by PropertyBannerBar only, never a shared class. See DESIGN_PLAN.md.",
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
                "Hardcoded hex color '{{value}}' — add it to src/app/theme.css (design tokens), src/lib/themePresets.ts (property banner presets), or src/lib/invoice-branding.ts (invoice branding default) instead of inlining it here.",
              data: { value: node.value },
            });
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
    // ~270 pre-existing `any` casts (mostly fetch response bodies and event handlers)
    // predate this cleanup and sit throughout src. Typing them all correctly is a large,
    // incremental effort with real regression risk in a financial app — not a mechanical
    // fix — so `no-explicit-any` is a WARNING here (still visible, chip away over time)
    // rather than a gating error. New genuine errors (design tokens, JSX escaping, dead
    // code, etc.) are fixed and stay errors.
    "@typescript-eslint/no-explicit-any": "warn",
    // React Compiler advisory rules (new in eslint-config-next 16's react-hooks plugin):
    // set-state-in-effect, immutability, static-components, preserve-manual-memoization fire
    // on ~100 pre-existing, working patterns (e.g. setLoading() inside a fetch effect). Making
    // the codebase React-Compiler-clean is a real, staged refactor with regression risk — kept
    // as WARNINGS so they stay visible without gating lint. The classic correctness hook rules
    // (rules-of-hooks, exhaustive-deps) are left at their defaults.
    "react-hooks/set-state-in-effect": "warn",
    "react-hooks/immutability": "warn",
    "react-hooks/static-components": "warn",
    "react-hooks/preserve-manual-memoization": "warn",
  },
};

// Tests exercise API shapes with intentional `any` casts on request/response bodies.
// Enforcing no-explicit-any there produced ~750 errors that buried any real lint
// regression in the suite (see AUDIT_REPORT.md D-5); relax just that rule for tests/**
// so the linter stays a useful signal there.
const testOverrides = {
  files: ["tests/**/*.{ts,tsx}"],
  rules: {
    "@typescript-eslint/no-explicit-any": "off",
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  designSystemGuardrails,
  testOverrides,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Not shipped app code: one-off dev/seed tooling (uses require(), loose typing on
    // purpose) and Claude's scratch worktrees/config. Lint covers src/** and tests/**.
    "scripts/**",
    ".claude/**",
  ]),
]);

export default eslintConfig;
