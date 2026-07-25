import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { resolveBusinessDate, toUtcMidnight } from "@/lib/business-date";
import { expectedCashForShift } from "@/lib/shift-summary";
import { startEodRun, getActiveEodRun, completeEodStep, isStepDone, stepStates, nextEodStep, type EodStepKey } from "@/lib/eod";
import { assignRegistrationNumbers } from "@/lib/guest-registration";
import { snapshotEodReports } from "@/lib/eod-reports";
import { logActivity } from "@/lib/activity-log";
import * as nightAuditRunRoute from "@/app/api/night-audit/run/route";

// Advance one EOD step for a property. Steps run in order; each is idempotent —
// re-running a done step is a no-op. See src/lib/eod.ts.
export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "NIGHT_AUDIT", "create");

    const body = await request.json();
    const propertyId = body.propertyId;
    const step = body.step as EodStepKey | "start";
    if (!propertyId) return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    await assertPropertyAccess(ctx, propertyId);

    const property = await prisma.property.findUnique({ where: { id: propertyId } });
    if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });
    const businessDate = resolveBusinessDate(property);

    // Start (or resume) the run.
    const run = await startEodRun(propertyId, ctx.userId);

    let stepResult: Record<string, unknown> = {};

    if (step === "start") {
      // nothing else — just ensures a run exists
    } else if (step === "departures") {
      if (!isStepDone(run, "departures")) {
        const stillDue = await prisma.reservation.count({
          where: { propertyId, status: "IN_HOUSE", checkOutDate: { lte: businessDate } },
        });
        if (stillDue > 0) {
          return NextResponse.json(
            { error: `${stillDue} guest${stillDue > 1 ? "s are" : " is"} still due out — force check-out or extend each before continuing.` },
            { status: 400 }
          );
        }
        await completeEodStep(run.id, "departures");
      }
    } else if (step === "cashier") {
      if (!isStepDone(run, "cashier")) {
        // Force-close every open shift for this property, recording the drop as the
        // expected cash (zero discrepancy) — there's no physical count at EOD. Shifts
        // are property-scoped now, so this covers any user (property- or enterprise-
        // scoped) who has a drawer open on this property.
        const openShifts = await prisma.cashierShift.findMany({
          where: { propertyId, closedAt: null },
          include: { payments: { include: { paymentMethod: { select: { name: true, type: true } } } }, paidOuts: true, currencyExchanges: true, property: { select: { defaultCurrency: true } } },
        });

        for (const shift of openShifts) {
          const expected = expectedCashForShift(shift.openingFloat, shift.payments, shift.paidOuts, shift.currencyExchanges, shift.property?.defaultCurrency ?? null);
          await prisma.cashierShift.update({
            where: { id: shift.id },
            data: { closedAt: new Date(), closingDrop: expected },
          });
        }
        await completeEodStep(run.id, "cashier");
        stepResult = { shiftsClosed: openShifts.length };
      }
    } else if (step === "post") {
      if (!isStepDone(run, "post")) {
        // A9 cross-path guard: night-audit/run audits the property's CURRENT business
        // date. If that date has already advanced past this run's business date, the
        // posting for run.businessDate already happened out-of-band (a standalone Night
        // Audit, or a parallel EOD run) — delegating now would audit a NEW night and roll
        // the date a second time. Treat the step as already done instead.
        if (toUtcMidnight(run.businessDate).getTime() !== toUtcMidnight(businessDate).getTime()) {
          // Already rolled out-of-band — skip delegation, just mark the step done.
          await completeEodStep(run.id, "post");
          stepResult = { posting: { alreadyPosted: true, businessDateAdvanced: true } };
        } else {
          // Delegate the heavy posting to the Night Audit run route — its
          // same-business-date idempotency IS the double-post guard. It also processes
          // no-shows and rolls the business date forward.
          const runResp = await nightAuditRunRoute.POST(
            new Request("http://localhost/api/night-audit/run", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ propertyId, confirmed: true, reason: "End-of-Day procedure" }),
            })
          );
          const runData = await runResp.json();
          if (runResp.ok) {
            stepResult = { posting: runData };
          } else if (runResp.status === 409 && runData.log) {
            // Already posted for this business date — treat the step as done (idempotent).
            stepResult = { posting: { alreadyPosted: true } };
          } else {
            return NextResponse.json({ error: runData.error || "Posting failed.", posting: runData }, { status: runResp.status });
          }
          await completeEodStep(run.id, "post");
        }
      }
    } else if (step === "registration") {
      if (!isStepDone(run, "registration")) {
        // Number the day's arriving guests (uses the run's business date, which is
        // stable even though the post step already rolled the property's date).
        const result = await assignRegistrationNumbers(propertyId, run.businessDate);
        await completeEodStep(run.id, "registration");
        stepResult = { registration: result };
      }
    } else if (step === "reports") {
      if (!isStepDone(run, "reports")) {
        // Freeze the six regulatory/management reports for the closed business date.
        // Uses the run's business date (the post step already rolled the property's).
        await snapshotEodReports(propertyId, run.businessDate);
        await completeEodStep(run.id, "reports");
        stepResult = { reports: { generated: true } };
      }
    } else if (step === "finalize") {
      if (!isStepDone(run, "finalize")) {
        // Force property staff to sign back in — they can't keep posting while the
        // date rolls. (The roll itself already happened in the post step.)
        await prisma.property.update({
          where: { id: propertyId },
          data: { eodSessionsInvalidAt: new Date() },
        });
        await completeEodStep(run.id, "finalize");
        await prisma.eodRun.update({ where: { id: run.id }, data: { status: "COMPLETED", completedAt: new Date() } });
        await logActivity({
          ctx,
          module: "NIGHT_AUDIT",
          action: "EOD_COMPLETE",
          entityType: "EodRun",
          entityId: run.id,
          description: `Completed End-of-Day for ${run.businessDate.toISOString().slice(0, 10)}`,
        });
      }
    } else {
      return NextResponse.json({ error: "Unknown step" }, { status: 400 });
    }

    const fresh = await prisma.eodRun.findUnique({ where: { id: run.id } });
    return NextResponse.json({
      ...stepResult,
      run: fresh ? { id: fresh.id, businessDate: fresh.businessDate, status: fresh.status } : null,
      steps: stepStates(fresh),
      nextStep: fresh ? nextEodStep(fresh) : null,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
