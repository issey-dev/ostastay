"use client";

import { useState, useEffect } from "react";
import { format, parseISO } from "date-fns";
import { useParams } from "next/navigation";
import { Wallet, Lock, Unlock, AlertTriangle, ArrowRight, CheckCircle2, Loader2, DollarSign, Plus, Printer, ArrowRightLeft, History, HandCoins } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

export default function CashieringPage() {
  const { slug } = useParams<{ slug: string }>();
  const [status, setStatus] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

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
    setError("");
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
        await fetchStatus();
      } else {
        const json = await res.json();
        setError(json.error || "Failed to record the paid-out");
        setIsPaidOutModalOpen(false);
      }
    } catch {
      setError("Unexpected error recording the paid-out");
      setIsPaidOutModalOpen(false);
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
    try {
      const [statusRes, historyRes] = await Promise.all([
        fetch("/api/cashiering/status"),
        fetch("/api/cashiering/shifts"),
      ]);
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
    fetch("/api/tenant-settings")
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
  }, []);

  const handleOpenShift = async () => {
    setError("");
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
        setError(json.error || "Failed to open shift");
      }
    } catch (err) {
      setError("Unexpected error opening shift");
    } finally {
      setIsOpening(false);
    }
  };

  const handleCloseShift = async () => {
    setError("");
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
        await fetchStatus(); // Refresh to show shift is closed
      } else {
        setError(json.error || "Failed to close shift");
        setIsCloseModalOpen(false);
      }
    } catch (err) {
      setError("Unexpected error closing shift");
      setIsCloseModalOpen(false);
    } finally {
      setIsClosing(false);
    }
  };

  const handleCreateExchange = async () => {
    setError("");
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
        await fetchStatus();
      } else {
        const json = await res.json();
        setError(json.error || "Failed to record currency exchange");
      }
    } catch (err) {
      setError("Unexpected error recording currency exchange");
    } finally {
      setIsExchanging(false);
    }
  };

  if (isLoading && !status) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-9 w-96 mb-2" />
          <Skeleton className="h-5 w-full max-w-xl" />
        </div>
        <Skeleton className="h-64 max-w-md mx-auto mt-12 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Cashiering & Shift Reconciliation</h2>
        <p className="text-muted-foreground">
          Manage your physical cash drawer and track all financial postings during your shift.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* RECONCILIATION RESULT VIEW */}
      {reconciliation && (
        <Card className="border-border shadow-xl overflow-hidden">
          <div className="bg-primary p-6 text-primary-foreground text-center">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-2 opacity-80" />
            <h3 className="text-2xl font-bold">Shift Closed Successfully</h3>
            <p className="text-primary-foreground/80 mt-1">Blind Drop Reconciliation Report</p>
          </div>
          <CardContent className="p-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
              <div className="p-4 bg-muted rounded-xl border border-border">
                <p className="text-sm font-medium text-muted-foreground mb-1">Expected System Cash</p>
                <p className="text-2xl font-bold text-foreground">${reconciliation.expectedCash.toFixed(2)}</p>
              </div>
              <div className="p-4 bg-muted rounded-xl border border-border">
                <p className="text-sm font-medium text-muted-foreground mb-1">Actual Physical Drop</p>
                <p className="text-2xl font-bold text-foreground">${reconciliation.actualDrop.toFixed(2)}</p>
              </div>
              <div className={`p-4 rounded-xl border ${reconciliation.discrepancy === 0 ? 'bg-success-muted border-success/30' : 'bg-destructive-muted border-destructive/30'}`}>
                <p className="text-sm font-medium mb-1">Discrepancy (Short/Over)</p>
                <p className={`text-2xl font-bold ${reconciliation.discrepancy === 0 ? 'text-success' : 'text-destructive'}`}>
                  {reconciliation.discrepancy === 0 ? "Balanced" : `$${Math.abs(reconciliation.discrepancy).toFixed(2)} ${reconciliation.discrepancy < 0 ? 'Short' : 'Over'}`}
                </p>
              </div>
            </div>
            {(reconciliation.byMethod?.length ?? 0) > 0 && (
              <div className="mt-8 border-t border-border pt-6">
                <p className="text-sm font-semibold text-muted-foreground mb-3">Takings by Payment Method</p>
                <div className="divide-y divide-border border border-border rounded-lg">
                  {reconciliation.byMethod.map((row: any) => (
                    <div key={row.method} className="flex items-center justify-between p-3 text-sm">
                      <span className="font-medium text-foreground">{row.method}</span>
                      <span className="text-muted-foreground">
                        +${row.received.toFixed(2)}{row.refunded > 0 && <span className="text-destructive"> / −${row.refunded.toFixed(2)}</span>}
                      </span>
                      <span className="font-mono font-bold text-foreground">${row.net.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
          <CardFooter className="bg-muted p-4 border-t justify-center gap-3">
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="w-4 h-4 mr-2" /> Print Report
            </Button>
            <Button variant="outline" onClick={() => setReconciliation(null)}>Dismiss Report</Button>
          </CardFooter>
        </Card>
      )}

      {/* SHIFT CLOSED (Needs to Open) */}
      {!status?.hasActiveShift && !reconciliation && (
        <Card className="max-w-md mx-auto border-0 shadow-lg ring-1 ring-border mt-12 overflow-hidden">
          <div className="bg-muted border-b border-border p-8 flex justify-center">
            <div className="w-20 h-20 bg-card rounded-none flex items-center justify-center shadow-sm border border-border">
              <Lock className="w-8 h-8 text-muted-foreground" />
            </div>
          </div>
          <CardHeader className="text-center pt-8">
            <CardTitle className="text-2xl">Your Shift is Closed</CardTitle>
            <CardDescription>
              You cannot post any payments to guest folios until you open a new cashier shift.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Opening Float (Cash in Drawer)</label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input 
                  type="number" 
                  step="0.01" 
                  className="pl-9 text-lg font-bold"
                  value={openingFloat}
                  onChange={(e) => setOpeningFloat(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button 
              className="w-full h-12 text-lg " 
              onClick={handleOpenShift}
              disabled={isOpening}
            >
              {isOpening ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Unlock className="w-5 h-5 mr-2" />}
              Open Cashier Shift
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* SHIFT OPEN (Dashboard) */}
      {status?.hasActiveShift && !reconciliation && (
        <div className="space-y-6">
          <Card className="border-border shadow-md">
            <CardHeader className="bg-muted/50 border-b border-border flex flex-row items-center justify-between pb-4">
              <div>
                <CardTitle className="flex items-center text-success">
                  <Unlock className="w-5 h-5 mr-2 text-success" /> Active Shift
                </CardTitle>
                <CardDescription className="text-success/80 mt-1">
                  Opened at {format(parseISO(status.shift.openedAt), "h:mm a 'on' MMM d, yyyy")}
                </CardDescription>
              </div>
              <Badge className="font-mono text-xs px-3 py-1">
                ID: {status.shift.id.slice(0, 8)}
              </Badge>
            </CardHeader>
            <CardContent className="p-6">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Starting Float</p>
                  <p className="text-3xl font-bold font-mono text-foreground">${status.shift.openingFloat.toFixed(2)}</p>
                </div>
                <Button
                  variant="destructive"
                  size="lg"
                  className="w-full sm:w-auto"
                  onClick={() => setIsCloseModalOpen(true)}
                >
                  <Lock className="w-4 h-4 mr-2" /> Close Shift (Blind Drop)
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm ring-1 ring-border">
            <CardHeader className="bg-muted border-b border-border flex flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-muted-foreground" />
                Currency Exchange
              </CardTitle>
              <Button size="sm" onClick={() => setIsExchangeModalOpen(true)}>
                <Plus className="w-4 h-4 mr-2" /> New Exchange
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {(status.shift.currencyExchanges?.length ?? 0) === 0 ? (
                <EmptyState icon={ArrowRightLeft} title="No currency exchanges recorded yet" />
              ) : (
                <div className="divide-y divide-border">
                  {status.shift.currencyExchanges.map((exchange: any) => (
                    <div key={exchange.id} className="p-4 flex items-center justify-between hover:bg-muted">
                      <div>
                        <p className="font-semibold text-foreground">
                          {exchange.amountFrom.toFixed(2)} {exchange.fromCurrency} → {exchange.amountTo.toFixed(2)} {exchange.toCurrency}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {exchange.guestName || "Walk-in"} • Rate {exchange.rate} • {format(parseISO(exchange.createdAt), "h:mm a")}
                        </p>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        title="Print Exchange Receipt"
                        onClick={() => window.open(`/e/${slug}/dashboard/cashiering/exchange/${exchange.id}/receipt`, '_blank')}
                      >
                        <Printer className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm ring-1 ring-border">
            <CardHeader className="bg-muted border-b border-border flex flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <HandCoins className="w-5 h-5 text-muted-foreground" />
                Paid-Outs (Petty Cash)
              </CardTitle>
              <Button size="sm" onClick={() => setIsPaidOutModalOpen(true)}>
                <Plus className="w-4 h-4 mr-2" /> New Paid-Out
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {(status.shift.paidOuts?.length ?? 0) === 0 ? (
                <EmptyState icon={HandCoins} title="No paid-outs recorded this shift" />
              ) : (
                <div className="divide-y divide-border">
                  {status.shift.paidOuts.map((po: any) => (
                    <div key={po.id} className="p-4 flex items-center justify-between hover:bg-muted">
                      <div>
                        <p className="font-semibold text-foreground">{po.reason}</p>
                        <p className="text-xs text-muted-foreground mt-1">{format(parseISO(po.createdAt), "h:mm a")}</p>
                      </div>
                      <div className="font-bold font-mono text-destructive">−${po.amount.toFixed(2)}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {activeByMethod.length > 0 && (
            <Card className="border-0 shadow-sm ring-1 ring-border">
              <CardHeader className="bg-muted border-b border-border">
                <CardTitle className="text-lg flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-muted-foreground" />
                  Takings by Payment Method
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {activeByMethod.map((row) => (
                    <div key={row.method} className="p-4 flex items-center justify-between">
                      <span className="font-medium text-foreground">{row.method}</span>
                      <span className="text-sm text-muted-foreground">
                        +${row.received.toFixed(2)}{row.refunded > 0 && <span className="text-destructive"> / −${row.refunded.toFixed(2)}</span>}
                      </span>
                      <span className="font-mono font-bold text-foreground">${row.net.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="border-0 shadow-sm ring-1 ring-border">
            <CardHeader className="bg-muted border-b border-border">
              <CardTitle className="text-lg flex items-center gap-2">
                <Wallet className="w-5 h-5 text-muted-foreground" />
                Payments Posted This Shift
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {status.shift.payments.length === 0 ? (
                <EmptyState icon={Wallet} title="No payments posted yet" />
              ) : (
                <div className="divide-y divide-border">
                  {status.shift.payments.map((payment: any) => (
                    <div key={payment.id} className="p-4 flex items-center justify-between hover:bg-muted">
                      <div>
                        <p className="font-semibold text-foreground flex items-center gap-2">
                          {payment.paymentMethod.name}
                          {payment.isRefund && <Badge variant="destructive" className="text-[10px]">Refund</Badge>}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Folio: {payment.folioId.slice(0,8)} • {format(parseISO(payment.createdAt), "h:mm a")}
                        </p>
                      </div>
                      <div className={`font-bold font-mono ${payment.isRefund ? 'text-destructive' : 'text-foreground'}`}>
                        {payment.isRefund ? '-' : '+'}${payment.amount.toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* SHIFT HISTORY */}
      {shiftHistory.length > 0 && (
        <Card className="border-0 shadow-sm ring-1 ring-border">
          <CardHeader className="bg-muted border-b border-border">
            <CardTitle className="text-lg flex items-center gap-2">
              <History className="w-5 h-5 text-muted-foreground" />
              Shift History
            </CardTitle>
            <CardDescription>Your past closed shifts with their reconciliation results.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {shiftHistory.map((shift) => (
                <div key={shift.id} className="p-4 hover:bg-muted">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-foreground text-sm">
                        {format(parseISO(shift.openedAt), "MMM d, h:mm a")} → {shift.closedAt ? format(parseISO(shift.closedAt), "h:mm a") : "—"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Float ${shift.openingFloat.toFixed(2)} · {shift.paymentCount} payment{shift.paymentCount === 1 ? "" : "s"}
                        {shift.exchangeCount > 0 && ` · ${shift.exchangeCount} exchange${shift.exchangeCount === 1 ? "" : "s"}`}
                        {shift.paidOutTotal > 0 && ` · $${shift.paidOutTotal.toFixed(2)} paid out`}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-muted-foreground">Expected <span className="font-mono font-semibold text-foreground">${shift.expectedCash.toFixed(2)}</span></span>
                      <span className="text-muted-foreground">Drop <span className="font-mono font-semibold text-foreground">${(shift.closingDrop ?? 0).toFixed(2)}</span></span>
                      {shift.discrepancy != null && (
                        Math.abs(shift.discrepancy) < 0.005 ? (
                          <Badge className="bg-success-muted text-success border-success/30" variant="outline">Balanced</Badge>
                        ) : (
                          <Badge variant="destructive">
                            ${Math.abs(shift.discrepancy).toFixed(2)} {shift.discrepancy < 0 ? "Short" : "Over"}
                          </Badge>
                        )
                      )}
                    </div>
                  </div>
                  {(shift.byMethod?.length ?? 0) > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {shift.byMethod.map((row: any) => (
                        <span key={row.method} className="text-[11px] bg-muted border border-border rounded px-1.5 py-0.5 font-mono text-muted-foreground">
                          {row.method}: ${row.net.toFixed(2)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* BLIND DROP MODAL */}
      <Dialog open={isCloseModalOpen} onOpenChange={setIsCloseModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close Shift: Blind Drop</DialogTitle>
            <DialogDescription>
              Please count the physical cash in your drawer and enter the total amount below. The system will calculate if your drawer is balanced, short, or over.
            </DialogDescription>
          </DialogHeader>
          <div className="py-6">
            <label className="text-sm font-semibold text-foreground mb-2 block">Actual Physical Cash Count</label>
            <div className="relative">
              <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground w-6 h-6" />
              <Input 
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
              Submit Drop & Close Shift
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* NEW PAID-OUT MODAL */}
      <Dialog open={isPaidOutModalOpen} onOpenChange={setIsPaidOutModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Paid-Out</DialogTitle>
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
              Record Paid-Out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* NEW CURRENCY EXCHANGE MODAL */}
      <Dialog open={isExchangeModalOpen} onOpenChange={setIsExchangeModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Currency Exchange</DialogTitle>
            <DialogDescription>
              Log a guest currency exchange against this shift. A printable receipt is generated once saved.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label>Guest Name (Optional)</Label>
              <Input
                placeholder="Walk-in Customer"
                value={exchangeForm.guestName}
                onChange={(e) => setExchangeForm(p => ({ ...p, guestName: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>From Currency</Label>
                <Input
                  placeholder="USD"
                  value={exchangeForm.fromCurrency}
                  onChange={(e) => setExchangeForm(p => ({ ...p, fromCurrency: e.target.value.toUpperCase() }))}
                />
              </div>
              <div className="space-y-2">
                <Label>To Currency</Label>
                <Input
                  placeholder="MVR"
                  value={exchangeForm.toCurrency}
                  onChange={(e) => setExchangeForm(p => ({ ...p, toCurrency: e.target.value.toUpperCase() }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Exchange Rate</Label>
              <Input
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
                <Label>Amount Given ({exchangeForm.fromCurrency || "From"})</Label>
                <Input
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
                <Label>Amount Received ({exchangeForm.toCurrency || "To"})</Label>
                <Input
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
              Save Exchange
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
