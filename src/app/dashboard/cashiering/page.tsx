"use client";

import { useState, useEffect } from "react";
import { format, parseISO } from "date-fns";
import { Wallet, Lock, Unlock, AlertTriangle, ArrowRight, CheckCircle2, Loader2, DollarSign } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

export default function CashieringPage() {
  const [status, setStatus] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  
  // Open Shift State
  const [openingFloat, setOpeningFloat] = useState("300.00");
  const [isOpening, setIsOpening] = useState(false);

  // Close Shift (Blind Drop) State
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [closingDrop, setClosingDrop] = useState("");
  const [isClosing, setIsClosing] = useState(false);
  
  // Reconciliation Result State
  const [reconciliation, setReconciliation] = useState<any>(null);

  const fetchStatus = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/cashiering/status");
      const json = await res.json();
      if (json.success) {
        setStatus(json.data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
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

  if (isLoading && !status) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-slate-900">Cashiering & Shift Reconciliation</h2>
        <p className="text-slate-500 mt-2">
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
        <Card className="border-indigo-200 shadow-xl overflow-hidden">
          <div className="bg-indigo-600 p-6 text-white text-center">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-2 opacity-80" />
            <h3 className="text-2xl font-bold">Shift Closed Successfully</h3>
            <p className="text-indigo-100 mt-1">Blind Drop Reconciliation Report</p>
          </div>
          <CardContent className="p-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                <p className="text-sm font-medium text-slate-500 mb-1">Expected System Cash</p>
                <p className="text-2xl font-bold text-slate-800">${reconciliation.expectedCash.toFixed(2)}</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                <p className="text-sm font-medium text-slate-500 mb-1">Actual Physical Drop</p>
                <p className="text-2xl font-bold text-slate-800">${reconciliation.actualDrop.toFixed(2)}</p>
              </div>
              <div className={`p-4 rounded-xl border ${reconciliation.discrepancy === 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
                <p className="text-sm font-medium mb-1">Discrepancy (Short/Over)</p>
                <p className={`text-2xl font-bold ${reconciliation.discrepancy === 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {reconciliation.discrepancy === 0 ? "Balanced" : `$${Math.abs(reconciliation.discrepancy).toFixed(2)} ${reconciliation.discrepancy < 0 ? 'Short' : 'Over'}`}
                </p>
              </div>
            </div>
          </CardContent>
          <CardFooter className="bg-slate-50 p-4 border-t justify-center">
            <Button variant="outline" onClick={() => setReconciliation(null)}>Dismiss Report</Button>
          </CardFooter>
        </Card>
      )}

      {/* SHIFT CLOSED (Needs to Open) */}
      {!status?.hasActiveShift && !reconciliation && (
        <Card className="max-w-md mx-auto border-0 shadow-lg ring-1 ring-slate-200 mt-12 overflow-hidden">
          <div className="bg-slate-50 border-b border-slate-100 p-8 flex justify-center">
            <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-sm border border-slate-200">
              <Lock className="w-8 h-8 text-slate-400" />
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
              <label className="text-sm font-medium text-slate-700">Opening Float (Cash in Drawer)</label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
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
              className="w-full h-12 text-lg bg-indigo-600 hover:bg-indigo-700" 
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
          <Card className="border-indigo-200 shadow-md">
            <CardHeader className="bg-indigo-50/50 border-b border-indigo-100 flex flex-row items-center justify-between pb-4">
              <div>
                <CardTitle className="flex items-center text-indigo-900">
                  <Unlock className="w-5 h-5 mr-2 text-indigo-600" /> Active Shift
                </CardTitle>
                <CardDescription className="text-indigo-700/80 mt-1">
                  Opened at {format(parseISO(status.shift.openedAt), "h:mm a 'on' MMM d, yyyy")}
                </CardDescription>
              </div>
              <Badge className="bg-indigo-600 text-white font-mono text-xs px-3 py-1">
                ID: {status.shift.id.slice(0, 8)}
              </Badge>
            </CardHeader>
            <CardContent className="p-6">
              <div className="flex justify-between items-end">
                <div>
                  <p className="text-sm font-medium text-slate-500">Starting Float</p>
                  <p className="text-3xl font-bold font-mono text-slate-800">${status.shift.openingFloat.toFixed(2)}</p>
                </div>
                <Button 
                  variant="destructive" 
                  size="lg" 
                  onClick={() => setIsCloseModalOpen(true)}
                >
                  <Lock className="w-4 h-4 mr-2" /> Close Shift (Blind Drop)
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm ring-1 ring-slate-200">
            <CardHeader className="bg-slate-50 border-b border-slate-100">
              <CardTitle className="text-lg flex items-center gap-2">
                <Wallet className="w-5 h-5 text-slate-400" />
                Payments Posted This Shift
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {status.shift.payments.length === 0 ? (
                <div className="p-8 text-center text-slate-500">No payments posted yet.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {status.shift.payments.map((payment: any) => (
                    <div key={payment.id} className="p-4 flex items-center justify-between hover:bg-slate-50">
                      <div>
                        <p className="font-semibold text-slate-800 flex items-center gap-2">
                          {payment.paymentMethod.name}
                          {payment.isRefund && <Badge variant="destructive" className="text-[10px]">Refund</Badge>}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          Folio: {payment.folioId.slice(0,8)} • {format(parseISO(payment.createdAt), "h:mm a")}
                        </p>
                      </div>
                      <div className={`font-bold font-mono ${payment.isRefund ? 'text-rose-600' : 'text-slate-700'}`}>
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
            <label className="text-sm font-semibold text-slate-700 mb-2 block">Actual Physical Cash Count</label>
            <div className="relative">
              <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-6 h-6" />
              <Input 
                type="number" 
                step="0.01" 
                autoFocus
                className="pl-12 text-3xl font-bold h-16 bg-slate-50 border-slate-300 focus:border-indigo-500 focus:ring-indigo-500"
                placeholder="0.00"
                value={closingDrop}
                onChange={(e) => setClosingDrop(e.target.value)}
              />
            </div>
            <p className="text-xs text-slate-500 mt-3 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Once submitted, this cannot be undone and any discrepancies will be permanently logged.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCloseModalOpen(false)}>Cancel</Button>
            <Button 
              className="bg-slate-900 hover:bg-slate-800 text-white" 
              onClick={handleCloseShift}
              disabled={isClosing || !closingDrop}
            >
              {isClosing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Submit Drop & Close Shift
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
