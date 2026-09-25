"use client";

import { Suspense, useState, useEffect } from "react";
import { format, parseISO } from "date-fns";
import { useParams } from "next/navigation";
import { Lock, Unlock, AlertTriangle, CheckCircle2, Loader2, DollarSign, Plus, Printer, ArrowRightLeft, HandCoins, ChevronDown } from "@/components/icons";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActionBar } from "@/components/ui/action-bar";
import { MobileActions, type MobileAction } from "@/components/ui/mobile";
import { INPUT_MONEY } from "@/lib/input-presets";
import { useProperty } from "@/components/providers/property-provider";
import { PageHeader } from "@/components/ui/page-header"
import { useUrlState } from "@/lib/use-url-state";
import { toast } from "@/lib/toast";
import { apiError } from "@/lib/api-error";

// DESKTOP_PLAN §2.3 (Phase 3 declutter): one shift summary bar with the shift's actions, then
// ONE tabbed list (Payments · Exchanges · Paid-outs · History) with one-line empty states —
// instead of nine stacked cards, three of them ~340px of "nothing yet".
const TABS = ["payments", "exchanges", "paidouts", "history"] as const;
type Tab = (typeof TABS)[number];

const money = (n: number) => `$${n.toFixed(2)}`;

// One figure in the summary bar.
function Figure({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-mono text-base font-semibold tabular-nums text-foreground">{children}</dd>
    </div>
  );
}

// A tab label with its count ("Payments 3").
function TabLabel({ label, count }: { label: string; count?: number }) {
  return (
    <>
      {label}
      {count != null && count > 0 && <span className="text-xs tabular-nums text-muted-foreground">{count}</span>}
    </>
  );
}

function ShiftHistoryList({ shiftHistory }: { shiftHistory: any[] }) {
  if (shiftHistory.length === 0) {
    return <EmptyState size="inline" title="No closed shifts yet" className="px-4 py-3" />;
  }
  return (
    <div className="divide-y divide-border">
      {shiftHistory.map((shift) => (
        <div key={shift.id} className="px-4 py-3 hover:bg-muted/50">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-foreground tabular-nums">
                {format(parseISO(shift.openedAt), "MMM d, h:mm a")} → {shift.closedAt ? format(parseISO(shift.closedAt), "h:mm a") : "—"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                Float {money(shift.openingFloat)} · {shift.paymentCount} payment{shift.paymentCount === 1 ? "" : "s"}
                {shift.exchangeCount > 0 && ` · ${shift.exchangeCount} exchange${shift.exchangeCount === 1 ? "" : "s"}`}
                {shift.paidOutTotal > 0 && ` · ${money(shift.paidOutTotal)} paid out`}
                {(shift.byMethod?.length ?? 0) > 0 && ` · ${shift.byMethod.map((row: any) => `${row.method} ${money(row.net)}`).join(" · ")}`}
              </p>
            </div>
            <div className="flex items-center gap-3 text-sm tabular-nums">
              <span className="text-muted-foreground">Expected <span className="font-mono font-semibold text-foreground">{money(shift.expectedCash)}</span></span>
              <span className="text-muted-foreground">Drop <span className="font-mono font-semibold text-foreground">{money(shift.closingDrop ?? 0)}</span></span>
              {shift.discrepancy != null && (
                Math.abs(shift.discrepancy) < 0.005 ? (
                  <Badge className="bg-success-muted text-success border-success/30" variant="outline">Balanced</Badge>
                ) : (
                  <Badge variant="destructive">
                    {money(Math.abs(shift.discrepancy))} {shift.discrepancy < 0 ? "Short" : "Over"}
                  </Badge>
                )
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CashieringContent() {
  const { slug } = useParams<{ slug: string }>();
  const { currentProperty } = useProperty();
  const [status, setStatus] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useUrlState<Tab>("tab", "payments", TABS);
  const [showBreakdown, setShowBreakdown] = useState(false);

  // Open Shift State — default float and exchange currencies come from
  // EnterpriseSettings (Controls > General > Cashiering Defaults), not hardcodes.
  const [openingFloat, setOpeningFloat] = useState("300.00");
  const [isOpening, setIsOpening] = useState(false);
  const [defaults, setDefaults] = useState({ fromCurrency: "USD", toCurrency: "MVR" });

  // Close Shift (Blind Drop) State
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [closingDrop, setClosingDrop] = useState("");
  const [isClosing, setIsClosing] = useState(false);

  // Reconciliation Result State
  const [reconciliation, setReconciliation] = useState<any>(null);

  // Closed-shift history
  const [shiftHistory, setShiftHistory] = useState<any[]>([]);

  // Paid-out (petty cash) state
  const [isPaidOutModalOpen, setIsPaidOutModalOpen] = useState(false);
  const [isPayingOut, setIsPayingOut] = useState(false);
  const [paidOutForm, setPaidOutForm] = useState({ amount: "", reason: "" });

  const handleCreatePaidOut = async () => {
    const amount = parseFloat(paidOutForm.amount);
    if (!Number.isFinite(amount) || amount <= 0 || !paidOutForm.reason.trim()) return;
    setIsPayingOut(true);
    try {
      const res = await fetch("/api/cashiering/paid-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, reason: paidOutForm.reason.trim() }),
      });
      if (res.ok) {
        setIsPaidOutModalOpen(false);
        setPaidOutForm({ amount: "", reason: "" });
        toast.success("Paid-out recorded");
        setTab("paidouts");
        await fetchStatus();
      } else {
        toast.error(await apiError(res, "Failed to record the paid-out"));
      }
    } catch {
      toast.error("Unexpected error recording the paid-out");
    } finally {
      setIsPayingOut(false);
    }
  };

  // Currency Exchange State
  const [isExchangeModalOpen, setIsExchangeModalOpen] = useState(false);
  const [isExchanging, setIsExchanging] = useState(false);
  const [exchangeForm, setExchangeForm] = useState({
    guestName: "",
    fromCurrency: "USD",
    toCurrency: "MVR",
    rate: "",
    amountFrom: "",
    amountTo: "",
  });

  const fetchStatus = async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const [statusRes, historyRes] = await Promise.all([
        fetch("/api/cashiering/status"),
        fetch("/api/cashiering/shifts"),
      ]);
      if (!statusRes.ok || !historyRes.ok) throw new Error();
      const json = await statusRes.json();
      if (json.success) {
        setStatus(json.data);
      }
      const historyJson = await historyRes.json();
      if (historyJson.success) {
        setShiftHistory(historyJson.data);
      }
    } catch (err) {
      console.error(err);
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  };

  // Live totals-by-method for the open shift, mirroring the server's math.
  const activeByMethod = (() => {
    if (!status?.shift?.payments?.length) return [] as { method: string; received: number; refunded: number; net: number }[];
    const map = new Map<string, { method: string; received: number; refunded: number; net: number }>();
    for (const p of status.shift.payments) {
      const row = map.get(p.paymentMethod.name) ?? { method: p.paymentMethod.name, received: 0, refunded: 0, net: 0 };
      if (p.isRefund) { row.refunded += p.amount; row.net -= p.amount; }
      else { row.received += p.amount; row.net += p.amount; }
      map.set(p.paymentMethod.name, row);
    }
    return Array.from(map.values()).sort((a, b) => b.net - a.net);
  })();

  useEffect(() => {
    fetchStatus();
    // This property's own cashier defaults (per property since 2026-09-23) — readable by
    // anyone working here, unlike the old enterprise settings, which needed Controls.
    if (!currentProperty) return;
    fetch(`/api/properties/${currentProperty.id}/settings`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setOpeningFloat((data.cashierDefaultFloat ?? 300).toFixed(2));
        const fromCurrency = data.exchangeFromCurrency || "USD";
        const toCurrency = data.exchangeToCurrency || "MVR";
        setDefaults({ fromCurrency, toCurrency });
        setExchangeForm((p) => ({ ...p, fromCurrency, toCurrency }));
      })
      .catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProperty?.id]);

  const handleOpenShift = async () => {
    setIsOpening(true);
    try {
      const res = await fetch("/api/cashiering/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openingFloat })
      });
      const json = await res.json();

      if (json.success) {
        await fetchStatus();
      } else {
        toast.error(json.error || "Failed to open shift");
      }
    } catch {
      toast.error("Unexpected error opening shift");
    } finally {
      setIsOpening(false);
    }
  };

  const handleCloseShift = async () => {
    setIsClosing(true);
    try {
      const res = await fetch("/api/cashiering/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closingDrop })
      });
      const json = await res.json();

      if (json.success) {
        setReconciliation(json.data);
        setIsCloseModalOpen(false);
        setClosingDrop("");
        await fetchStatus(); // Refresh to show shift is closed
      } else {
        toast.error(json.error || "Failed to close shift");
        setIsCloseModalOpen(false);
      }
    } catch {
      toast.error("Unexpected error closing shift");
      setIsCloseModalOpen(false);
    } finally {
      setIsClosing(false);
    }
  };

  const handleCreateExchange = async () => {
    setIsExchanging(true);
    try {
      const res = await fetch("/api/cashiering/currency-exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exchangeForm)
      });
      if (res.ok) {
        setIsExchangeModalOpen(false);
        setExchangeForm({ guestName: "", fromCurrency: defaults.fromCurrency, toCurrency: defaults.toCurrency, rate: "", amountFrom: "", amountTo: "" });
        toast.success("Exchange recorded");
        setTab("exchanges");
        await fetchStatus();
      } else {
        toast.error(await apiError(res, "Failed to record currency exchange"));
      }
    } catch {
      toast.error("Unexpected error recording currency exchange");
    } finally {
      setIsExchanging(false);
    }
  };

  const openExchangeReceipt = (id: string) =>
    window.open(`/e/${slug}/dashboard/cashiering/exchange/${id}/receipt`, "_blank");

  if (isLoading && !status) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (loadError && !status) {
    return (
      <div className="space-y-6">
        <PageHeader title="Cashiering" hint="Manage your physical cash drawer and track all financial postings during your shift." />
        <ErrorState title="Couldn't load cashiering" onRetry={fetchStatus} />
      </div>
    );
  }

  const shift = status?.shift;
  const payments: any[] = shift?.payments ?? [];
  const exchanges: any[] = shift?.currencyExchanges ?? [];
  const paidOuts: any[] = shift?.paidOuts ?? [];
  const paidOutTotal = paidOuts.reduce((sum: number, po: any) => sum + po.amount, 0);
  const chargeRows: any[] = status?.summary?.postingsByChargeCode ?? [];
  const floatNotSet = shift?.openingFloat === 0;

  // The shift's secondary actions: New exchange is the one visible button; the rest cost a click.
  const paidOutAction: MobileAction = { label: "New paid-out", icon: HandCoins, onSelect: () => setIsPaidOutModalOpen(true) };
  const printActions: MobileAction[] = [
    ...(exchanges.length > 0
      ? [{ label: "Print last exchange receipt", icon: Printer, onSelect: () => openExchangeReceipt(exchanges[0].id) }]
      : []),
  ];
  const closeShiftButton = (
    <Button onClick={() => setIsCloseModalOpen(true)}>
      <Lock className="w-4 h-4 mr-2" /> Close shift
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Cashiering" hint="Manage your physical cash drawer and track all financial postings during your shift." />

      {/* RECONCILIATION RESULT VIEW */}
      {reconciliation && (
        <Card className="border-border overflow-hidden">
          <div className="bg-primary p-6 text-primary-foreground text-center max-md:p-4">
            <CheckCircle2 className="w-10 h-10 mx-auto mb-2 opacity-80" />
            <h3 className="text-xl font-bold">Shift closed</h3>
            <p className="text-primary-foreground/80 mt-1 text-sm">Blind drop reconciliation</p>
          </div>
          <CardContent className="p-6 max-md:p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center tabular-nums">
              <div className="p-4 bg-muted">
                <p className="text-sm font-medium text-muted-foreground mb-1">Expected system cash</p>
                <p className="text-2xl font-bold font-mono text-foreground">{money(reconciliation.expectedCash)}</p>
              </div>
              <div className="p-4 bg-muted">
                <p className="text-sm font-medium text-muted-foreground mb-1">Actual physical drop</p>
                <p className="text-2xl font-bold font-mono text-foreground">{money(reconciliation.actualDrop)}</p>
              </div>
              <div className={`p-4 ${reconciliation.discrepancy === 0 ? "bg-success-muted" : "bg-destructive-muted"}`}>
                <p className="text-sm font-medium mb-1">Discrepancy (short/over)</p>
                <p className={`text-2xl font-bold font-mono ${reconciliation.discrepancy === 0 ? "text-success" : "text-destructive"}`}>
                  {reconciliation.discrepancy === 0 ? "Balanced" : `${money(Math.abs(reconciliation.discrepancy))} ${reconciliation.discrepancy < 0 ? "Short" : "Over"}`}
                </p>
              </div>
            </div>
            {(reconciliation.byMethod?.length ?? 0) > 0 && (
              <div className="mt-6">
                <p className="text-sm font-semibold text-muted-foreground mb-2">Takings by payment method</p>
                <div className="divide-y divide-border border-y border-border">
                  {reconciliation.byMethod.map((row: any) => (
                    <div key={row.method} className="flex items-center justify-between py-2.5 text-sm tabular-nums">
                      <span className="font-medium text-foreground">{row.method}</span>
                      <span className="text-muted-foreground">
                        +{money(row.received)}{row.refunded > 0 && <span className="text-destructive"> / −{money(row.refunded)}</span>}
                      </span>
                      <span className="font-mono font-semibold text-foreground">{money(row.net)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
          <CardFooter className="p-4 border-t justify-end gap-2">
            <Button variant="outline" className="max-md:hidden" onClick={() => window.print()}>
              <Printer className="w-4 h-4 mr-2" /> Print report
            </Button>
            <Button onClick={() => setReconciliation(null)}>Done</Button>
          </CardFooter>
        </Card>
      )}

      {/* SHIFT CLOSED (needs to open) — one bar: opening float + Open shift. */}
      {!status?.hasActiveShift && !reconciliation && (
        <div className="flex flex-wrap items-end justify-between gap-4 border border-border bg-card px-4 py-3">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Lock className="h-4 w-4 text-muted-foreground" /> Your shift is closed
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">Open a shift to take payments.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="opening-float" className="text-xs text-muted-foreground">Opening float</Label>
              <div className="relative">
                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  {...INPUT_MONEY}
                  id="opening-float"
                  type="number"
                  step="0.01"
                  className="w-36 pl-8 font-mono tabular-nums"
                  value={openingFloat}
                  onChange={(e) => setOpeningFloat(e.target.value)}
                />
              </div>
            </div>
          </div>
          <Button className="max-sm:w-full" onClick={handleOpenShift} disabled={isOpening}>
            {isOpening ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Unlock className="w-4 h-4 mr-2" />}
            Open shift
          </Button>
        </div>
      )}

      {/* No open shift: history is the only list left. */}
      {!status?.hasActiveShift && shiftHistory.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-foreground">Shift history</h2>
          <div className="border border-border bg-card">
            <ShiftHistoryList shiftHistory={shiftHistory} />
          </div>
        </section>
      )}

      {/* SHIFT OPEN */}
      {status?.hasActiveShift && !reconciliation && (
        <div className="space-y-4">
          {/* Phones: the three numbers a cashier checks, before anything else. */}
          <div className="grid grid-cols-3 divide-x divide-border rounded-xl border border-border bg-card md:hidden">
            {[
              { label: "Expected cash", value: status.summary?.expectedCash ?? 0, negative: false },
              { label: "Payments", value: status.summary?.paymentsNet ?? 0, negative: false },
              { label: "Paid-outs", value: paidOutTotal, negative: true },
            ].map((item) => (
              <div key={item.label} className="min-w-0 px-2 py-3 text-center">
                <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{item.label}</p>
                <p className={`mt-0.5 truncate font-mono text-base font-bold tabular-nums ${item.negative && item.value > 0 ? "text-destructive" : "text-foreground"}`}>
                  {item.negative && item.value > 0 ? "−" : ""}{money(item.value)}
                </p>
              </div>
            ))}
          </div>

          {/* The shift summary bar: figures on the left, the shift's actions on the right. */}
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border border-border bg-card px-4 py-3">
            <dl className="flex flex-wrap items-end gap-x-8 gap-y-3">
              <div>
                <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
                  Shift open
                  <span className="font-mono text-[11px] text-muted-foreground/70" title={`Shift ID ${shift.id}`}>{shift.id.slice(0, 8)}</span>
                </dt>
                <dd className="mt-0.5 text-sm font-medium text-foreground tabular-nums">
                  {format(parseISO(shift.openedAt), "h:mm a, MMM d")}
                </dd>
              </div>
              {floatNotSet ? (
                // Auto-opened shift: set the starting cash right here, as before.
                <div>
                  <dt className="mb-1 text-xs text-muted-foreground">Float — auto-opened, set your starting cash</dt>
                  <dd className="flex items-center gap-2">
                    <div className="relative">
                      <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
                      <Input
                        {...INPUT_MONEY}
                        type="number"
                        step="0.01"
                        aria-label="Opening float"
                        className="h-8 w-32 pl-8 font-mono tabular-nums"
                        value={openingFloat}
                        onChange={(e) => setOpeningFloat(e.target.value)}
                      />
                    </div>
                    <Button size="sm" variant="outline" onClick={handleOpenShift} disabled={isOpening}>
                      {isOpening ? <Loader2 className="w-4 h-4 animate-spin" /> : "Set float"}
                    </Button>
                  </dd>
                </div>
              ) : (
                <Figure label="Float">{money(shift.openingFloat)}</Figure>
              )}
              {status.summary && <Figure label="Expected cash" className="max-md:hidden">{money(status.summary.expectedCash)}</Figure>}
              {status.summary && <Figure label="Payments this shift" className="max-md:hidden">{money(status.summary.paymentsNet)}</Figure>}
              <Figure label="Paid-outs" className="max-md:hidden">
                <span className={paidOutTotal > 0 ? "text-destructive" : undefined}>{paidOutTotal > 0 ? "−" : ""}{money(paidOutTotal)}</span>
              </Figure>
            </dl>
            <ActionBar
              className="max-md:hidden"
              primary={closeShiftButton}
              secondary={
                <Button variant="outline" onClick={() => setIsExchangeModalOpen(true)}>
                  <ArrowRightLeft className="w-4 h-4 mr-2" /> New exchange
                </Button>
              }
              more={[paidOutAction, ...printActions]}
            />
            <MobileActions
              className="w-full md:hidden"
              primary={closeShiftButton}
              more={[{ label: "New exchange", icon: ArrowRightLeft, onSelect: () => setIsExchangeModalOpen(true) }, paidOutAction]}
            />
          </div>

          {/* ONE tabbed list for everything the shift has recorded. */}
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-0 border border-border bg-card">
            <div className="overflow-x-auto border-b border-border px-2">
              <TabsList variant="line" className="h-10 data-horizontal:h-10">
                <TabsTrigger value="payments"><TabLabel label="Payments" count={payments.length} /></TabsTrigger>
                <TabsTrigger value="exchanges"><TabLabel label="Exchanges" count={exchanges.length} /></TabsTrigger>
                <TabsTrigger value="paidouts"><TabLabel label="Paid-outs" count={paidOuts.length} /></TabsTrigger>
                <TabsTrigger value="history"><TabLabel label="History" /></TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="payments">
              {payments.length === 0 ? (
                <EmptyState size="inline" title="No payments posted this shift" className="px-4 py-3" />
              ) : (
                <>
                  <div className="divide-y divide-border">
                    {payments.map((payment: any) => (
                      <div key={payment.id} className="px-4 py-2.5 flex items-center justify-between hover:bg-muted/50">
                        <div>
                          <p className="font-medium text-foreground flex items-center gap-2">
                            {payment.paymentMethod.name}
                            {payment.isRefund && <Badge variant="destructive" className="text-[10px]">Refund</Badge>}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                            Folio {payment.folioId.slice(0, 8)} · {format(parseISO(payment.createdAt), "h:mm a")}
                          </p>
                        </div>
                        <div className={`font-semibold font-mono tabular-nums ${payment.isRefund ? "text-destructive" : "text-foreground"}`}>
                          {payment.isRefund ? "−" : "+"}{money(payment.amount)}
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* By method / by charge code: needed at close, not all day — one click away. */}
                  {(activeByMethod.length > 0 || chargeRows.length > 0) && (
                    <div className="border-t border-border">
                      <button
                        type="button"
                        onClick={() => setShowBreakdown((v) => !v)}
                        aria-expanded={showBreakdown}
                        className="flex w-full items-center gap-1.5 px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground"
                      >
                        <ChevronDown className={`h-4 w-4 transition-transform ${showBreakdown ? "rotate-180" : ""}`} />
                        {showBreakdown ? "Hide breakdown" : "Breakdown by method and charge code"}
                      </button>
                      {showBreakdown && (
                        <div className="grid gap-6 px-4 pb-4 md:grid-cols-2">
                          {activeByMethod.length > 0 && (
                            <div>
                              <p className="mb-1 flex justify-between text-xs font-medium text-muted-foreground">
                                <span>By payment method</span>
                                {status.summary && <span className="font-mono tabular-nums">{money(status.summary.paymentsNet)}</span>}
                              </p>
                              <div className="divide-y divide-border">
                                {activeByMethod.map((row) => (
                                  <div key={row.method} className="flex items-center justify-between gap-3 py-2 text-sm tabular-nums">
                                    <span className="font-medium text-foreground">{row.method}</span>
                                    <span className="text-muted-foreground">
                                      +{money(row.received)}{row.refunded > 0 && <span className="text-destructive"> / −{money(row.refunded)}</span>}
                                    </span>
                                    <span className="font-mono font-semibold text-foreground">{money(row.net)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {chargeRows.length > 0 && (
                            <div>
                              <p className="mb-1 flex justify-between text-xs font-medium text-muted-foreground">
                                <span>Postings by charge code</span>
                                <span className="font-mono tabular-nums">{money(status.summary.chargesTotal)}</span>
                              </p>
                              <div className="divide-y divide-border">
                                {chargeRows.map((row: any) => (
                                  <div key={row.code} className="flex items-center justify-between gap-3 py-2 text-sm tabular-nums">
                                    <span className="min-w-0">
                                      <span className="font-medium text-foreground">{row.description}</span>
                                      <span className="ml-2 text-xs text-muted-foreground">{row.code} · {row.count} posting{row.count === 1 ? "" : "s"}</span>
                                    </span>
                                    <span className="font-mono font-semibold text-foreground">{money(row.total)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="exchanges">
              {exchanges.length === 0 ? (
                <EmptyState
                  size="inline"
                  title="No currency exchanges this shift"
                  className="px-4 py-3"
                  action={
                    <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setIsExchangeModalOpen(true)}>
                      <Plus className="w-3.5 h-3.5 mr-1" /> New exchange
                    </Button>
                  }
                />
              ) : (
                <div className="divide-y divide-border">
                  {exchanges.map((exchange: any) => (
                    <div key={exchange.id} className="px-4 py-2.5 flex items-center justify-between hover:bg-muted/50">
                      <div>
                        <p className="font-medium text-foreground tabular-nums">
                          {exchange.amountFrom.toFixed(2)} {exchange.fromCurrency} → {exchange.amountTo.toFixed(2)} {exchange.toCurrency}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                          {exchange.guestName || "Walk-in"} · Rate {exchange.rate} · {format(parseISO(exchange.createdAt), "h:mm a")}
                        </p>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 max-md:hidden"
                        title="Print exchange receipt"
                        aria-label="Print exchange receipt"
                        onClick={() => openExchangeReceipt(exchange.id)}
                      >
                        <Printer className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="paidouts">
              {paidOuts.length === 0 ? (
                <EmptyState
                  size="inline"
                  title="No paid-outs this shift"
                  className="px-4 py-3"
                  action={
                    <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setIsPaidOutModalOpen(true)}>
                      <Plus className="w-3.5 h-3.5 mr-1" /> New paid-out
                    </Button>
                  }
                />
              ) : (
                <div className="divide-y divide-border">
                  {paidOuts.map((po: any) => (
                    <div key={po.id} className="px-4 py-2.5 flex items-center justify-between hover:bg-muted/50">
                      <div>
                        <p className="font-medium text-foreground">{po.reason}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">{format(parseISO(po.createdAt), "h:mm a")}</p>
                      </div>
                      <div className="font-semibold font-mono tabular-nums text-destructive">−{money(po.amount)}</div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="history">
              <ShiftHistoryList shiftHistory={shiftHistory} />
            </TabsContent>
          </Tabs>
        </div>
      )}

      {/* BLIND DROP MODAL */}
      <Dialog open={isCloseModalOpen} onOpenChange={setIsCloseModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close shift: blind drop</DialogTitle>
            <DialogDescription>
              Count the physical cash in your drawer and enter the total amount below. The system will calculate if your drawer is balanced, short, or over.
            </DialogDescription>
          </DialogHeader>
          <div className="py-6">
            <label className="text-sm font-semibold text-foreground mb-2 block">Actual physical cash count</label>
            <div className="relative">
              <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground w-6 h-6" />
              <Input 
                {...INPUT_MONEY}
                type="number" 
                step="0.01" 
                autoFocus
                className="pl-12 text-3xl font-bold h-16 bg-muted border-border focus:border-ring focus:ring-ring"
                placeholder="0.00"
                value={closingDrop}
                onChange={(e) => setClosingDrop(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Once submitted, this cannot be undone and any discrepancies will be permanently logged.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCloseModalOpen(false)}>Cancel</Button>
            <Button 
              onClick={handleCloseShift}
              disabled={isClosing || !closingDrop}
            >
              {isClosing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Submit drop & close shift
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* NEW PAID-OUT MODAL */}
      <Dialog open={isPaidOutModalOpen} onOpenChange={setIsPaidOutModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record paid-out</DialogTitle>
            <DialogDescription>
              Cash disbursed from the drawer (COD deliveries, reimbursements, supplies). Reduces the expected cash at
              shift close.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label>Amount</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  {...INPUT_MONEY}
                  type="number"
                  step="0.01"
                  min="0.01"
                  className="pl-9"
                  placeholder="0.00"
                  value={paidOutForm.amount}
                  onChange={(e) => setPaidOutForm((p) => ({ ...p, amount: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Input
                placeholder="E.g. Taxi reimbursement for guest"
                value={paidOutForm.reason}
                onChange={(e) => setPaidOutForm((p) => ({ ...p, reason: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPaidOutModalOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreatePaidOut}
              disabled={isPayingOut || !paidOutForm.amount || !paidOutForm.reason.trim()}
            >
              {isPayingOut ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Record paid-out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* NEW CURRENCY EXCHANGE MODAL */}
      <Dialog open={isExchangeModalOpen} onOpenChange={setIsExchangeModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record currency exchange</DialogTitle>
            <DialogDescription>
              Log a guest currency exchange against this shift. A printable receipt is generated once saved.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label>Guest name (optional)</Label>
              <Input
                placeholder="Walk-in customer"
                value={exchangeForm.guestName}
                onChange={(e) => setExchangeForm(p => ({ ...p, guestName: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>From currency</Label>
                <Input
                  placeholder="USD"
                  value={exchangeForm.fromCurrency}
                  onChange={(e) => setExchangeForm(p => ({ ...p, fromCurrency: e.target.value.toUpperCase() }))}
                />
              </div>
              <div className="space-y-2">
                <Label>To currency</Label>
                <Input
                  placeholder="MVR"
                  value={exchangeForm.toCurrency}
                  onChange={(e) => setExchangeForm(p => ({ ...p, toCurrency: e.target.value.toUpperCase() }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Exchange rate</Label>
              <Input
                {...INPUT_MONEY}
                type="number"
                step="0.0001"
                placeholder="15.42"
                value={exchangeForm.rate}
                onChange={(e) => {
                  const rate = e.target.value;
                  const amountFrom = parseFloat(exchangeForm.amountFrom);
                  const parsedRate = parseFloat(rate);
                  setExchangeForm(p => ({
                    ...p,
                    rate,
                    amountTo: !isNaN(amountFrom) && !isNaN(parsedRate) ? (amountFrom * parsedRate).toFixed(2) : p.amountTo,
                  }));
                }}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Amount given ({exchangeForm.fromCurrency || "From"})</Label>
                <Input
                  {...INPUT_MONEY}
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={exchangeForm.amountFrom}
                  onChange={(e) => {
                    const amountFrom = e.target.value;
                    const parsedAmount = parseFloat(amountFrom);
                    const rate = parseFloat(exchangeForm.rate);
                    setExchangeForm(p => ({
                      ...p,
                      amountFrom,
                      amountTo: !isNaN(parsedAmount) && !isNaN(rate) ? (parsedAmount * rate).toFixed(2) : p.amountTo,
                    }));
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>Amount received ({exchangeForm.toCurrency || "To"})</Label>
                <Input
                  {...INPUT_MONEY}
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={exchangeForm.amountTo}
                  onChange={(e) => setExchangeForm(p => ({ ...p, amountTo: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsExchangeModalOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreateExchange}
              disabled={isExchanging || !exchangeForm.fromCurrency || !exchangeForm.toCurrency || !exchangeForm.rate || !exchangeForm.amountFrom || !exchangeForm.amountTo}
            >
              {isExchanging ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save exchange
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// useUrlState reads the query string — the page needs a Suspense boundary.
export default function CashieringPage() {
  return (
    <Suspense>
      <CashieringContent />
    </Suspense>
  );
}
