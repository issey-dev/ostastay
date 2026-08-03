// Hard-deleting a reservation is an INTERNAL maintenance operation, not a front-desk
// one. It cascades into folios and line items, so it is the one reservation action that
// can actually destroy history rather than mark it — cancelling is what a hotel does,
// and the UI offers no delete button at all (see .agents/docs/DECISIONS.md, 2026-08-03).
//
// The endpoint stays for genuine internal cleanup (a bad import, a test booking on a live
// property) but is deliberately unreachable by normal use. Four independent gates, all of
// which must pass — no single mistake, stray fetch, or over-broad role can open it:
//
//   1. Osta (INTERNAL) staff only — no tenant user of any role, ever, regardless of the
//      RESERVATIONS.delete permission bit their role happens to carry.
//   2. A kill switch that is OFF unless someone deliberately turned it on for the run.
//   3. The caller must echo back the exact confirmation number, so the call cannot be
//      fired blind, replayed against a different id, or triggered by a stray click.
//   4. Nothing financial may have been posted, and the stay must not be live or departed.
//
// All four are pure input checks so the whole rule is unit-testable without a database:
// the route loads the reservation, then calls checkHardDeleteGate() and
// checkHardDeleteTarget() in that order (authorization before business rules).

/** Env var that must be exactly "true" for the endpoint to exist at all. */
export const HARD_DELETE_FLAG = "ALLOW_RESERVATION_HARD_DELETE";

export type HardDeleteGateInput = {
  /** process.env[HARD_DELETE_FLAG] — undefined in every normal deployment. */
  flag: string | undefined;
  /** ctx.isInternal — the user's HOME enterprise is Osta. */
  isInternal: boolean;
  /** The reservation's stored confirmation number. */
  confirmationNo: string;
  /** What the caller sent as proof of intent. */
  suppliedConfirmation: unknown;
};

export type HardDeleteGateResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

export function checkHardDeleteGate(input: HardDeleteGateInput): HardDeleteGateResult {
  // 1. Internal staff only. Checked against the HOME enterprise, so a tenant admin who
  // grants themselves every permission still cannot reach it. (An Osta user reaching a
  // tenant's reservation necessarily holds an approved, time-boxed SupportAccessGrant —
  // assertPropertyAccess enforces that, and it is what puts a name against the audit
  // record.)
  //
  // Deliberately checked BEFORE the kill switch: the flag is off in every normal
  // deployment, so checking it first would answer every tenant's DELETE with a message
  // naming an internal env var. A tenant gets one flat refusal that describes their own
  // option — Cancel — and nothing about the maintenance path.
  if (!input.isInternal) {
    return {
      ok: false,
      status: 403,
      error: "Reservations cannot be deleted. Cancel the reservation instead — that preserves its history.",
    };
  }

  // 2. Kill switch. Off by default, so even for internal staff this endpoint is dead
  // unless someone deliberately turned it on for the run. 403 rather than 404 — an
  // internal operator debugging this deserves to know the flag is the reason.
  if (input.flag !== "true") {
    return {
      ok: false,
      status: 403,
      error:
        `Reservation delete is disabled. It is an internal maintenance operation and ` +
        `requires ${HARD_DELETE_FLAG}=true on the server process. Cancel the reservation instead.`,
    };
  }

  // 3. Proof of intent: the caller must name the exact booking. An accidental or
  // replayed DELETE carries no body, or the wrong one, and fails here.
  if (typeof input.suppliedConfirmation !== "string" || input.suppliedConfirmation.trim() !== input.confirmationNo) {
    return {
      ok: false,
      status: 400,
      error:
        `Confirmation mismatch. To delete this reservation, send { "confirm": "${input.confirmationNo}" } ` +
        `in the request body to acknowledge which booking is being destroyed.`,
    };
  }

  return { ok: true };
}

// Gate 4 — whether this particular reservation is destroyable at all. Independent of who
// is asking: even Osta staff with the flag on must not be able to erase money or a stay
// that actually happened. Applied AFTER checkHardDeleteGate so an unauthorized caller
// learns nothing about the booking's financial state.
export type HardDeleteTargetInput = {
  status: string;
  /** True if any folio carries a line item or a payment — voided lines included. */
  hasFinancialHistory: boolean;
};

export function checkHardDeleteTarget(input: HardDeleteTargetInput): HardDeleteGateResult {
  // Deletion cascades into folios and line items. If money was ever posted or taken,
  // deleting would destroy financial history (or 500 on the Payment FK). A VOIDED line
  // still counts — a void is a correction that must remain auditable, not an erasure.
  if (input.hasFinancialHistory) {
    return {
      ok: false,
      status: 400,
      error: "This reservation has posted charges or payments and cannot be deleted. Cancel it instead.",
    };
  }

  // A stay that is happening or has happened is a fact about the property, not a
  // data-entry mistake — there is no clean-up case for erasing it.
  if (input.status === "IN_HOUSE" || input.status === "CHECKED_OUT") {
    return {
      ok: false,
      status: 400,
      error: `A ${input.status === "IN_HOUSE" ? "checked-in" : "checked-out"} reservation cannot be deleted.`,
    };
  }

  return { ok: true };
}
