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
      <H3>Prices include taxes</H3>
      <p>The first decision, and it affects every price you enter from now on:</p>
      <Table
        head={["Setting", "A room priced at 200 posts…"]}
        rows={[
          [<strong key="on">On (default)</strong>, "200 in total: the service charge, GST and Green Tax are worked out of the 200."],
          [<strong key="off">Off</strong>, "200 plus the service charge, GST and Green Tax on top."],
        ]}
      />
      <p>The switch saves as soon as you change it, with a brief <strong>Saved</strong> tick. Choose it before you enter any prices, and don&apos;t change it once you are live: prices you have entered would then mean something different.</p>

      <H3>Maldives Tax</H3>
      <Shot name="prop-tax" alt="The Tax card: Prices include taxes switch, and the Maldives Tax tab with Green Tax rates, age exemption, GST and service charge rates." />
      <Table
        head={["Field", "Default", "Notes"]}
        rows={[
          ["Adult rate (per adult/night)", "12.00", "Green Tax per adult per night, in the property's currency. MIRA sets Green Tax in USD: if your currency isn't USD, enter the equivalent."],
          ["Child rate (per child/night)", "6.00", "Green Tax per child per night, as above."],
          ["Age exemption threshold", "2", "Guests under this age pay no Green Tax."],
          ["Measure the 12-hour stay on standard check-in/check-out times", "Off", "Off: the stay is measured from the actual check-in time. On: from your standard times (General page)."],
          ["GST rate (%)", "17", "Charged on the price plus the service charge."],
          ["Service Charge rate (%)", "10", "Charged on the price. At least 10%, the legal minimum. A property that doesn't charge it switches its posting off on Night Audit."],
        ]}
      />
      <p>
        Choose <strong>Save</strong> at the bottom of the tab. Each levy shows whether it is <strong>Posted nightly</strong>. Whether each is
        posted at all is switched on the <a href="/docs/configuration/property/night-audit">Night Audit</a> page.
      </p>

      <H3>Custom tax</H3>
      <p>
        For anything the Maldives defaults don&apos;t cover, for example an item sold without service charge, create a tax profile:
        on the <strong>Custom tax</strong> tab choose <strong>Add custom tax</strong>, give it a <strong>Profile name</strong>, and add one or more <strong>Tax lines</strong>{" "}
        (name, rate %, and whether it is calculated on the subtotal or on the subtotal plus the lines before it). A charge code or
        an outlet can then use the profile instead of the Maldives defaults. Choose <strong>Create</strong> to add it.
      </p>
      <p>
        Create custom profiles now: charge codes (next step) pick from them. A profile that a charge code or outlet still uses
        can&apos;t be deleted; the message says how many use it. Deleting one you no longer need asks you to confirm.
      </p>

      <H2>Payment methods</H2>
      <Callout title="Required" tone="warn">
        <p>A new property has no payment methods, and no folio can be settled until you add them.</p>
      </Callout>
      <Shot name="prop-payment-methods" alt="The Payment methods card listing Cash, Visa / Mastercard, Bank Transfer and City Ledger." />
      <p>Choose <strong>Add payment method</strong> for each way guests pay, then <strong>Create</strong>:</p>
      <Table
        head={["Field", "Notes"]}
        rows={[
          ["Method name", "What cashiers see, e.g. Cash, Visa / Mastercard, Bank Transfer, City Ledger."],
          ["Payment type", "CASH, CARD, TRANSFER, CITY LEDGER, CHEQUE or VOUCHER. The type decides how the payment is reported: cash, card, transfer and city ledger payments each post to their own payment code."],
          ["Active", "Inactive methods are hidden from cashiers but kept in history."],
        ]}
      />
      <p>Add a <strong>City Ledger</strong> method if you invoice companies or travel agents. The next setting needs it.</p>

      <H2>Settlement defaults</H2>
      <p>
        <strong>City Ledger settlement method</strong>: the method used when a company&apos;s folio is moved to the city ledger at
        check-out. Pick your City Ledger method and choose <strong>Save</strong>.
      </p>

      <H2>Cashiering defaults</H2>
      <Table
        head={["Field", "Default", "Notes"]}
        rows={[
          ["Default opening float", "300", "The cash a cashier starts a shift with. Cashiers can change it when opening a shift."],
          ["Exchange: from / to currency", "USD → MVR", "The currency pair offered for exchanges at the desk."],
        ]}
      />
      <p>Choose <strong>Save</strong>.</p>

      <H2>Deposit &amp; fee rules</H2>
      <p>
        Rules for the deposit to ask for, and the fee to charge on cancellation or no-show. The desk picks a rule on each
        reservation; the fee is collected through deposits, not added to the bill.
      </p>
      <Shot name="prop-fee-rules" alt="The Deposit & fee rules card with Deposit, Cancellation fees and No-show fees sections." />
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
