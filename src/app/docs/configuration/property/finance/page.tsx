import type { Metadata } from "next"
import { Callout, DocTitle, H2, H3, Pager, Shot, Table, Where } from "../../../components"

export const metadata: Metadata = { title: "2. Tax & payments" }

export default function Finance() {
  return (
    <>
      <DocTitle
        title="Step 2 — Tax & payments"
        lead="How prices are taxed, how guests pay, and the fees for deposits, cancellations and no-shows. Your finance team should own this step."
      />
      <Where path="Hub › Controls › Finance" who="Property Setup" />

      <H2>Tax</H2>
      <H3>Prices Include Taxes</H3>
      <p>The first decision, and it affects every price you enter from now on:</p>
      <Table
        head={["Setting", "A room priced at 200 posts…"]}
        rows={[
          [<strong key="on">On (default)</strong>, "200 in total: the service charge, GST and Green Tax are worked out of the 200."],
          [<strong key="off">Off</strong>, "200 plus the service charge, GST and Green Tax on top."],
        ]}
      />
      <p>Choose it before you enter any prices, and don&apos;t change it once you are live: prices you have entered would then mean something different.</p>

      <H3>Maldives Tax</H3>
      <Shot name="prop-tax" alt="The Tax card: Prices Include Taxes switch, and the Maldives Tax tab with Green Tax rates, age exemption, GST and service charge rates." />
      <Table
        head={["Field", "Default", "Notes"]}
        rows={[
          ["Adult Rate (per adult/night)", "12.00", "Green Tax per adult per night."],
          ["Child Rate (per child/night)", "6.00", "Green Tax per child per night."],
          ["Age Exemption Threshold", "2", "Guests under this age pay no Green Tax."],
          ["Measure the 12-hour stay on standard check-in/check-out times", "Off", "Off: the stay is measured from the actual check-in time. On: from your standard times (General page)."],
          ["GST Rate (%)", "17", "Charged on the price plus the service charge."],
          ["Service Charge Rate (%)", "10", "Charged on the price. The legal minimum is 10%."],
        ]}
      />
      <p>
        Choose <strong>Save Configuration</strong>. Each levy shows whether it is <strong>Posted nightly</strong>. Whether each is
        posted at all is switched on the <a href="/docs/configuration/property/night-audit">Night Audit</a> page.
      </p>

      <H3>Custom Tax</H3>
      <p>
        For anything the Maldives defaults don&apos;t cover, for example an item sold without service charge, create a tax profile:
        choose <strong>Add Custom Tax</strong>, give it a <strong>Profile Name</strong>, and add one or more <strong>Tax Lines</strong>{" "}
        (name, rate %, and whether it is calculated on the subtotal or on the subtotal plus the lines before it). A charge code or
        an outlet can then use the profile instead of the Maldives defaults.
      </p>
      <p>Create custom profiles now: charge codes (next step) pick from them. Don&apos;t delete a profile that a charge code still uses.</p>

      <H2>Payment Methods</H2>
      <Callout title="Required" tone="warn">
        <p>A new property has no payment methods, and no folio can be settled until you add them.</p>
      </Callout>
      <Shot name="prop-payment-methods" alt="The Payment Methods card listing Cash, Visa / Mastercard, Bank Transfer and City Ledger." />
      <p>Choose <strong>Add Method</strong> for each way guests pay:</p>
      <Table
        head={["Field", "Notes"]}
        rows={[
          ["Method Name", "What cashiers see, e.g. Cash, Visa / Mastercard, Bank Transfer, City Ledger."],
          ["Payment Type", "CASH, CARD, TRANSFER, CITY LEDGER, CHEQUE or VOUCHER. The type decides how the payment is reported: cash, card, transfer and city ledger payments each post to their own payment code."],
          ["Active Status", "Inactive methods are hidden from cashiers but kept in history."],
        ]}
      />
      <p>Add a <strong>City Ledger</strong> method if you invoice companies or travel agents. The next setting needs it.</p>

      <H2>Settlement Defaults</H2>
      <p>
        <strong>City Ledger Settlement Method</strong>: the method used when a company&apos;s folio is moved to the city ledger at
        check-out. Pick your City Ledger method and choose <strong>Save Default</strong>.
      </p>

      <H2>Cashiering Defaults</H2>
      <Table
        head={["Field", "Default", "Notes"]}
        rows={[
          ["Default Opening Float", "300", "The cash a cashier starts a shift with. Cashiers can change it when opening a shift."],
          ["Exchange: From / To Currency", "USD → MVR", "The currency pair offered for exchanges at the desk."],
        ]}
      />

      <H2>Deposit &amp; Fee Rules</H2>
      <p>
        Rules for the deposit to ask for, and the fee to charge on cancellation or no-show. The desk picks a rule on each
        reservation; the fee is collected through deposits, not added to the bill.
      </p>
      <Shot name="prop-fee-rules" alt="The Deposit & Fee Rules card with Deposit, Cancellation fees and No-show fees sections." />
      <Table
        head={["Field", "Options"]}
        rows={[
          ["Name", "What the desk sees, e.g. 'Standard cancellation — 1 night'."],
          ["Active", "Only active rules can be chosen."],
          ["Amount basis", "Flat amount, % of stay, First night, or Full stay."],
          ["Value", "The amount or percentage (Flat and % only)."],
          ["Charge code", "Cancellation and no-show rules only: the code the fee posts to. Use the ready-made 1050 Cancellation Fee and 1060 No Show Fee."],
        ]}
      />
      <p>
        A new property has a <strong>Standard Cancellation Fee</strong> and a <strong>Standard No-Show Fee</strong>, both inactive
        at zero. Set their amounts and switch them on if you charge these fees, and add a deposit rule if you take deposits. Each
        rule has its own <strong>Save</strong> button.
      </p>
      <Pager href="/docs/configuration/property/finance" />
    </>
  )
}
