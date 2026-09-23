import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

// Guard for everything published as documentation (the /docs portal, the OpenAPI file, the
// developer markdown): no secrets, no real customer, no internal detail. Run by
// `npm run docs:check` (scripts/docs-check.ts) and by the test suite
// (tests/business-rules/docs-check.test.ts), so a leak fails CI rather than shipping.
//
// Source files are checked with their comments stripped — a comment in a page's source is
// never rendered, and pointing a maintainer at internal files there is legitimate.

export type DocsFinding = { file: string; line: number; rule: string; text: string };

/** Real customers must never be used as examples. Extend as customers are onboarded. */
const REAL_CUSTOMER_NAMES = ["veyo"];

/** Hosts examples may name. Everything else is a real site that must not appear. */
const ALLOWED_HOSTS = [/^(.+\.)?example\.(com|org|net)$/, /^stay\.uppsolut\.com$/, /^localhost$/, /^127\.0\.0\.1$/];

const RULES: { rule: string; test: (line: string) => string | null }[] = [
  { rule: "api-key", test: (l) => l.match(/wsk_[0-9a-f]{16,}/i)?.[0] ?? null },
  { rule: "webhook-secret", test: (l) => l.match(/whsec_[0-9a-f]{16,}/i)?.[0] ?? null },
  { rule: "private-key", test: (l) => l.match(/-----BEGIN [A-Z ]*PRIVATE KEY-----/)?.[0] ?? null },
  {
    rule: "real-customer",
    test: (l) => REAL_CUSTOMER_NAMES.find((n) => new RegExp(`\\b${n}\\b`, "i").test(l)) ?? null,
  },
  {
    rule: "internal-config",
    test: (l) => l.match(/\b(DATABASE_URL|JWT_SECRET|SECRETS_ENCRYPTION_KEY|devpass|55432|postgres(ql)?:\/\/)/)?.[0] ?? null,
  },
  { rule: "internal-path", test: (l) => l.match(/(\.agents\/|\bsrc\/(lib|app)\/|\bprisma\/schema)/)?.[0] ?? null },
  {
    rule: "real-email",
    test: (l) => {
      for (const m of l.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) {
        if (!ALLOWED_HOSTS.some((h) => h.test(m[1].toLowerCase()))) return m[0];
      }
      return null;
    },
  },
  {
    rule: "real-host",
    test: (l) => {
      for (const m of l.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) {
        if (!ALLOWED_HOSTS.some((h) => h.test(m[1].toLowerCase()))) return m[0];
      }
      return null;
    },
  },
];

/** Blank out comments (keeping line numbers) in TS/TSX source. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/.*$/gm, (m, pre: string) => pre + " ".repeat(m.length - pre.length));
}

export function checkDocsText(file: string, text: string): DocsFinding[] {
  const body = /\.(tsx?|jsx?)$/.test(file) ? stripComments(text) : text;
  const findings: DocsFinding[] = [];
  body.split("\n").forEach((line, i) => {
    for (const r of RULES) {
      const hit = r.test(line);
      if (hit) findings.push({ file, line: i + 1, rule: r.rule, text: hit });
    }
  });
  return findings;
}

/** Everything that is published as documentation, relative to the repository root. */
export const DOCS_GLOBS = {
  dirs: ["src/app/docs", "public/docs"],
  // docs/*.md are maintainer pointers to the portal now, not published documentation.
  files: [] as string[],
  extensions: [".tsx", ".ts", ".md", ".yaml", ".yml"],
};

export function collectDocsFiles(root = process.cwd()): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(join(root, dir))) return;
    for (const name of readdirSync(join(root, dir))) {
      const rel = `${dir}/${name}`;
      if (statSync(join(root, rel)).isDirectory()) walk(rel);
      else if (DOCS_GLOBS.extensions.some((e) => name.endsWith(e))) out.push(rel);
    }
  };
  DOCS_GLOBS.dirs.forEach(walk);
  for (const f of DOCS_GLOBS.files) if (existsSync(join(root, f))) out.push(f);
  return out;
}

/** Check every published documentation file under `root`. */
export function runDocsCheck(root = process.cwd()): DocsFinding[] {
  return collectDocsFiles(root).flatMap((f) => checkDocsText(f, readFileSync(join(root, f), "utf8")));
}
