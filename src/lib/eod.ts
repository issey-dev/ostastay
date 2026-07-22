import { prisma } from "@/lib/db";
import { resolveBusinessDate } from "@/lib/business-date";

// The ordered End-of-Day steps. Each maps to a completion-timestamp column on
// EodRun; a run is COMPLETED once every step has a timestamp. Resume = the first
// step whose timestamp is still null.
export const EOD_STEPS = [
  { key: "departures", column: "departuresAt", label: "Resolve departures", detail: "Force check-out or extend guests due out today." },
  { key: "cashier", column: "cashierAt", label: "Close cashiers", detail: "Force-close any open cashier shift for this property." },
  { key: "post", column: "postAt", label: "Post room & tax", detail: "Post nightly room charges, extra occupancy, packages, and Green Tax." },
  { key: "reports", column: "reportsAt", label: "Generate reports", detail: "Snapshot the day's Trial Balance, ledgers, Cashier Summary, and Manager Flash." },
  { key: "finalize", column: "finalizedAt", label: "Roll & close", detail: "Roll the business date forward and sign property staff out." },
] as const;

export type EodStepKey = (typeof EOD_STEPS)[number]["key"];
const COLUMN_BY_KEY: Record<EodStepKey, string> = Object.fromEntries(EOD_STEPS.map((s) => [s.key, s.column])) as Record<EodStepKey, string>;

// The active (IN_PROGRESS) run for a property, if any — the one to resume.
export async function getActiveEodRun(propertyId: string) {
  return prisma.eodRun.findFirst({
    where: { propertyId, status: "IN_PROGRESS" },
    orderBy: { startedAt: "desc" },
  });
}

// Start (or return the existing) run for the property's current business date.
export async function startEodRun(propertyId: string, userId: string) {
  const active = await getActiveEodRun(propertyId);
  if (active) return active;
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) throw new Error("Property not found");
  const businessDate = resolveBusinessDate(property);
  return prisma.eodRun.upsert({
    where: { propertyId_businessDate: { propertyId, businessDate } },
    update: { status: "IN_PROGRESS" },
    create: { propertyId, businessDate, startedByUserId: userId, status: "IN_PROGRESS" },
  });
}

type RunLike = Record<string, unknown> & { [k: string]: any };

// The next step to run (first with a null timestamp), or null when all are done.
export function nextEodStep(run: RunLike): EodStepKey | null {
  for (const step of EOD_STEPS) {
    if (!run[step.column]) return step.key;
  }
  return null;
}

export function isStepDone(run: RunLike, key: EodStepKey): boolean {
  return !!run[COLUMN_BY_KEY[key]];
}

// Mark a step complete, enforcing that its predecessors are done first.
export async function completeEodStep(runId: string, key: EodStepKey) {
  const run = await prisma.eodRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("EOD run not found");
  const idx = EOD_STEPS.findIndex((s) => s.key === key);
  for (let i = 0; i < idx; i++) {
    if (!(run as RunLike)[EOD_STEPS[i].column]) {
      throw new Error(`Cannot complete "${key}" before "${EOD_STEPS[i].key}".`);
    }
  }
  return prisma.eodRun.update({ where: { id: runId }, data: { [COLUMN_BY_KEY[key]]: new Date() } });
}

// A view of a run's steps for the client progress bar.
export function stepStates(run: RunLike | null) {
  return EOD_STEPS.map((s) => ({
    key: s.key,
    label: s.label,
    detail: s.detail,
    done: run ? !!run[s.column] : false,
    at: run ? run[s.column] ?? null : null,
  }));
}
