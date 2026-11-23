// npm run channels:scrub-card-data            — report what would change
// npm run channels:scrub-card-data -- --apply — make the changes
//
// On the server (compiled into the image, like checkno-verify):
//   docker compose exec app node dist-scripts/scripts/scrub-channel-card-data.js
//   docker compose exec app node dist-scripts/scripts/scrub-channel-card-data.js --apply
//
// One-off cleanup for DECISIONS.md "Channel bookings never store card details" (2026-11-23).
// Bookings received before that rule were stored with their raw payload as received, which can
// include payment tokens (Beds24 `stripeToken` / `pcibookingToken`) or a card number typed into
// a guest message. This removes them with the same stripper new bookings go through
// (src/lib/channels/core/card-data.ts), sets cardSupplied where something was found, and masks
// card numbers in the exchange log. Safe to run more than once.
// Its own PrismaClient and RELATIVE imports only: the runtime image runs this as plain node
// (tsconfig.scripts.json), where the app's "@/" modules are not available. card-data.ts
// imports nothing, so it compiles in on its own.
import { PrismaClient } from "@prisma/client";
import { stripCardData, maskCardNumbers } from "../src/lib/channels/core/card-data";

const prisma = new PrismaClient();
const apply = process.argv.slice(2).includes("--apply");
const BATCH = 200;

async function main() {

let bookingsChecked = 0, bookingsChanged = 0, unreadable = 0;
for (let cursor: string | undefined; ; ) {
  const rows = await prisma.channelInboundBooking.findMany({
    take: BATCH,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: { id: "asc" },
    select: { id: true, rawPayload: true, cardSupplied: true },
  });
  if (rows.length === 0) break;
  for (const r of rows) {
    bookingsChecked++;
    let parsed: unknown;
    try {
      parsed = JSON.parse(r.rawPayload);
    } catch {
      // Not JSON: still mask any card number in the text itself.
      const m = maskCardNumbers(r.rawPayload);
      if (m.found) {
        bookingsChanged++;
        if (apply) await prisma.channelInboundBooking.update({ where: { id: r.id }, data: { rawPayload: m.text, cardSupplied: true } });
      } else unreadable++;
      continue;
    }
    const { value, cardSupplied } = stripCardData(parsed);
    const next = JSON.stringify(value);
    if (next === r.rawPayload && (!cardSupplied || r.cardSupplied)) continue;
    bookingsChanged++;
    if (apply) {
      await prisma.channelInboundBooking.update({
        where: { id: r.id },
        data: { rawPayload: next, ...(cardSupplied ? { cardSupplied: true } : {}) },
      });
    }
  }
  cursor = rows[rows.length - 1].id;
}

let logsChecked = 0, logsChanged = 0;
for (let cursor: string | undefined; ; ) {
  const rows = await prisma.channelSyncLog.findMany({
    take: BATCH,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: { id: "asc" },
    select: { id: true, requestSummary: true, responseSummary: true, errorMessage: true },
  });
  if (rows.length === 0) break;
  for (const r of rows) {
    logsChecked++;
    const fields = ["requestSummary", "responseSummary", "errorMessage"] as const;
    const data: Partial<Record<(typeof fields)[number], string>> = {};
    for (const f of fields) {
      const v = r[f];
      if (!v) continue;
      const m = maskCardNumbers(v);
      if (m.found) data[f] = m.text;
    }
    if (Object.keys(data).length === 0) continue;
    logsChanged++;
    if (apply) await prisma.channelSyncLog.update({ where: { id: r.id }, data });
  }
  cursor = rows[rows.length - 1].id;
}

  console.log(
  `${apply ? "Done" : "Dry run (nothing changed — add --apply)"}: ` +
    `${bookingsChanged} of ${bookingsChecked} channel bookings ${apply ? "scrubbed" : "would be scrubbed"}` +
    `${unreadable ? ` (${unreadable} non-JSON payloads had nothing to mask)` : ""}; ` +
    `${logsChanged} of ${logsChecked} exchange-log entries ${apply ? "masked" : "would be masked"}.`
);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
