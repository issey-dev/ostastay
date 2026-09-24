import type { Metadata } from "next"
import { Callout, CodeBlock, DocTitle, H2, Pager, Table } from "../../components"

export const metadata: Metadata = { title: "Webhooks" }

export default function Webhooks() {
  return (
    <>
      <DocTitle
        title="Webhooks"
        lead="Be told when an excursion or spa booking your site made changes — without polling."
      />

      <H2>Why</H2>
      <p>
        After a guest books, the property may change the booking: call a boat trip off for weather, move the guest to another
        departure, mark a no-show, complete a treatment. A webhook posts each change to your server so you can email the guest or
        update your records straight away. You can always check a booking with the lookup endpoint as well.
      </p>

      <H2>Setting one up</H2>
      <p>
        The property adds your webhook URL to your API key in its administration area, chooses which events to send, and gives you
        the <strong>signing secret</strong> (it starts with <code>whsec_</code> and is shown to them once). Keep it with your API
        key as a server-side secret. The URL must be <code>https</code> and reachable from the internet.
      </p>

      <H2>Events</H2>
      <Table
        head={["Event", "When"]}
        rows={[
          [<code key="1">booking.confirmed</code>, "A booking made with your key is confirmed."],
          [<code key="2">booking.cancelled</code>, "The booking is cancelled — by the guest online, at the desk, or because the whole departure was cancelled."],
          [<code key="3">booking.moved</code>, "Excursions — the property moved the guest to another departure."],
          [<code key="4">booking.completed</code>, "Spa — the treatment is completed."],
          [<code key="5">booking.no_show</code>, "The guest didn't come."],
          [<code key="6">ping</code>, "A test the property sends from its administration area."],
        ]}
      />
      <p>Only bookings made with your key are ever sent to your endpoints.</p>

      <H2>The request</H2>
      <CodeBlock
        lang="http"
        code={`
POST /webhooks/uppsolut HTTP/1.1
Content-Type: application/json
User-Agent: Uppsolut-Stay-Webhooks/1
Uppsolut-Webhook-Id: 5c0e1a2b-…
Uppsolut-Webhook-Event: booking.cancelled
Uppsolut-Webhook-Timestamp: 1790000000
Uppsolut-Webhook-Signature: v1=4f1c…

{
  "id": "5c0e1a2b-…",
  "event": "booking.cancelled",
  "createdAt": "2026-10-02T06:15:00.000Z",
  "data": {
    "booking": { "reference": "EXC-7K3QX9MD", "status": "CANCELLED", "…": "the same object the lookup returns" }
  }
}
`}
      />

      <H2>Verifying the signature</H2>
      <p>
        <code>Uppsolut-Webhook-Signature</code> is <code>v1=</code> followed by the hex HMAC-SHA256 of{" "}
        <code>&#123;timestamp&#125;.&#123;raw body&#125;</code>, keyed with your signing secret. Compute it over the <strong>raw</strong>{" "}
        request body — before any JSON parsing — compare in constant time, and reject messages whose timestamp is more than five
        minutes old.
      </p>
      <CodeBlock
        lang="javascript (node, express)"
        code={`
import crypto from "node:crypto";
import express from "express";

const SECRET = process.env.UPPSOLUT_WEBHOOK_SECRET; // whsec_…
const app = express();

app.post("/webhooks/uppsolut", express.raw({ type: "application/json" }), (req, res) => {
  const ts = req.header("Uppsolut-Webhook-Timestamp");
  const sig = req.header("Uppsolut-Webhook-Signature") ?? "";
  const expected = "v1=" + crypto.createHmac("sha256", SECRET).update(\`\${ts}.\${req.body}\`).digest("hex");
  const fresh = Math.abs(Date.now() / 1000 - Number(ts)) < 300;
  const valid = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!fresh || !valid) return res.sendStatus(400);

  const event = JSON.parse(req.body.toString("utf8"));
  // Deliveries are at-least-once: skip an id you have already handled.
  handle(event); // e.g. email the guest about a cancelled trip
  res.sendStatus(204);
});
`}
      />

      <H2>Delivery and retries</H2>
      <ul>
        <li>Answer with any <code>2xx</code> within 10 seconds. Do the slow work after answering.</li>
        <li>Anything else — another status, a timeout, a redirect — is retried: after about 1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours and 12 hours, then given up.</li>
        <li>Delivery is <strong>at least once</strong>: the same event can arrive twice. Use <code>id</code> to ignore repeats.</li>
        <li>Events can arrive out of order after retries. The <code>booking</code> in each is a snapshot; for the current state, look the booking up.</li>
      </ul>
      <Callout title="Rotating the secret">
        <p>
          When the property rotates the signing secret, messages are signed with the new one straight away. Update your server
          promptly; until then its signature check fails and the messages are retried.
        </p>
      </Callout>
      <Pager href="/docs/api/webhooks" />
    </>
  )
}
