// npm run docs:check — fail if published documentation carries a secret, a real customer's
// name or an internal detail. The rules are in src/lib/docs-check.ts; the test suite runs
// the same check (tests/business-rules/docs-check.test.ts).
import { runDocsCheck } from "../src/lib/docs-check";

const findings = runDocsCheck();
if (findings.length === 0) {
  console.log("docs:check — no problems found.");
} else {
  for (const f of findings) console.error(`${f.file}:${f.line}  [${f.rule}]  ${f.text}`);
  console.error(`docs:check — ${findings.length} problem(s). Documentation must not carry secrets, real customers or internal details.`);
  process.exit(1);
}
