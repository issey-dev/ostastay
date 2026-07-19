"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Plus, CreditCard, Receipt, Printer, ArrowRightLeft, Trash2, UserCircle } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"

type FolioPanelProps = {
  reservationId: string | null
  propertyId: string
  isOpen: boolean
  onClose: () => void
}

export function FolioPanel({ reservationId, propertyId, isOpen, onClose }: FolioPanelProps) {
  const { slug } = useParams<{ slug: string }>()
  const [folios, setFolios] = useState<any[]>([])
  const [activeFolioId, setActiveFolioId] = useState<string>("")
  const [loading, setLoading] = useState(false)
  
  const [chargeCodes, setChargeCodes] = useState<any[]>([])
  const [paymentMethods, setPaymentMethods] = useState<any[]>([])
  
  // Posting State
  const [postType, setPostType] = useState<"charge" | "payment">("charge")
  const [chargeForm, setChargeForm] = useState({ chargeCodeId: "", amount: "", description: "" })
  const [paymentForm, setPaymentForm] = useState({ paymentMethodId: "", amount: "", referenceNumber: "" })
  
  // Multi-Folio State
  const [selectedLineItemIds, setSelectedLineItemIds] = useState<string[]>([])
  const [isMoveDialogOpen, setIsMoveDialogOpen] = useState(false)
  const [targetFolioId, setTargetFolioId] = useState<string>("")

  // Payee State
  const [isPayeeDialogOpen, setIsPayeeDialogOpen] = useState(false)
  const [selectedPayeeId, setSelectedPayeeId] = useState<string>("")

  // Settlement Method State (Direct vs City Ledger — see the Debtors module; charges
  // billed to an account finalize automatically at checkout, no mid-stay transfer here)
  const [settlementSaving, setSettlementSaving] = useState(false)

  // Custom Notification State
  const [notification, setNotification] = useState<{ title: string, message: string, isError?: boolean } | null>(null)

  useEffect(() => {
    if (isOpen && reservationId) {
      fetchFolios()
      fetchLookupData()
      setSelectedLineItemIds([])
    }
  }, [isOpen, reservationId])

  const fetchFolios = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/folios?reservationId=${reservationId}`)
      if (res.ok) {
        const data = await res.json()
        setFolios(data)
        if (data.length > 0 && !activeFolioId) {
          setActiveFolioId(data[0].id)
        }
      }
    } catch (e) {
      console.error("Failed to fetch folios", e)
    } finally {
      setLoading(false)
    }
  }

  const fetchLookupData = async () => {
    try {
      const [ccRes, pmRes] = await Promise.all([
        fetch(`/api/charge-codes?propertyId=${propertyId}`),
        fetch(`/api/payment-methods?propertyId=${propertyId}`)
      ])
      if (ccRes.ok) setChargeCodes(await ccRes.json())
      if (pmRes.ok) setPaymentMethods(await pmRes.json())
    } catch (e) {
      console.error("Failed to fetch lookup data", e)
    }
  }

  const handleAddFolio = async () => {
    try {
      const res = await fetch(`/api/folios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationId })
      })
      if (res.ok) {
        const newFolio = await res.json()
        setFolios([...folios, newFolio])
        setActiveFolioId(newFolio.id)
        setNotification({ title: "Folio Created", message: `Folio ${newFolio.folioNumber} created successfully.` })
      } else {
        setNotification({ title: "Error", message: "Failed to create folio.", isError: true })
      }
    } catch (e) {
      setNotification({ title: "Error", message: "Error creating folio.", isError: true })
    }
  }

  const handlePostCharge = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeFolioId) return

    try {
      const res = await fetch(`/api/folios/${activeFolioId}/line-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chargeForm)
      })
      if (res.ok) {
        setChargeForm({ chargeCodeId: "", amount: "", description: "" })
        fetchFolios()
        setNotification({ title: "Success", message: "Charge posted successfully." })
      } else {
        setNotification({ title: "Error", message: "Failed to post charge.", isError: true })
      }
    } catch (e) {
      setNotification({ title: "Error", message: "Error posting charge.", isError: true })
    }
  }

  const handlePostPayment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeFolioId) return

    try {
      const shiftId = "mock-shift-id" 
      const res = await fetch(`/api/folios/${activeFolioId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...paymentForm, shiftId })
      })
      if (res.ok) {
        setPaymentForm({ paymentMethodId: "", amount: "", referenceNumber: "" })
        fetchFolios()
        setNotification({ title: "Success", message: "Payment posted successfully." })
      } else {
        setNotification({ title: "Error", message: "Failed to post payment.", isError: true })
      }
    } catch (e) {
      setNotification({ title: "Error", message: "Error posting payment.", isError: true })
    }
  }

  const handleMoveCharges = async () => {
    if (!targetFolioId || selectedLineItemIds.length === 0) return

    try {
      const res = await fetch(`/api/folios/line-items/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineItemIds: selectedLineItemIds,
          targetFolioId
        })
      })

      if (res.ok) {
        setIsMoveDialogOpen(false)
        setSelectedLineItemIds([])
        setTargetFolioId("")
        fetchFolios()
        setNotification({ title: "Charges Moved", message: "Successfully moved charges to the selected folio." })
      } else {
        setNotification({ title: "Error", message: "Failed to move charges.", isError: true })
      }
    } catch (e) {
      setNotification({ title: "Error", message: "Error moving charges.", isError: true })
    }
  }

  const handleSetSettlementMethod = async (method: "DIRECT" | "CITY_LEDGER") => {
    if (!activeFolioId) return
    setSettlementSaving(true)
    try {
      const res = await fetch(`/api/folios/${activeFolioId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settlementMethod: method })
      })
      if (res.ok) {
        fetchFolios()
      } else {
        setNotification({ title: "Error", message: "Failed to update settlement method.", isError: true })
      }
    } catch (e) {
      setNotification({ title: "Error", message: "Error updating settlement method.", isError: true })
    } finally {
      setSettlementSaving(false)
    }
  }

  const handleDeleteFolio = async () => {
    if (!activeFolioId) return
    try {
      const res = await fetch(`/api/folios/${activeFolioId}`, { method: "DELETE" })
      if (res.ok) {
        const updatedFolios = folios.filter(f => f.id !== activeFolioId)
        setFolios(updatedFolios)
        setActiveFolioId(updatedFolios[0]?.id || "")
        setNotification({ title: "Folio Deleted", message: "Folio successfully deleted." })
      } else {
        const data = await res.json()
        setNotification({ title: "Error", message: data.error || "Failed to delete folio.", isError: true })
      }
    } catch (e) {
      setNotification({ title: "Error", message: "Error deleting folio.", isError: true })
    }
  }

  const handleAssignPayee = async () => {
    if (!activeFolioId) return
    try {
      const res = await fetch(`/api/folios/${activeFolioId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payeeProfileId: selectedPayeeId === "none" ? null : selectedPayeeId })
      })
      if (res.ok) {
        setIsPayeeDialogOpen(false)
        fetchFolios()
        setNotification({ title: "Payee Assigned", message: "Folio payee updated successfully." })
      } else {
        setNotification({ title: "Error", message: "Failed to assign payee.", isError: true })
      }
    } catch (e) {
      setNotification({ title: "Error", message: "Error assigning payee.", isError: true })
    }
  }

  const toggleLineItemSelection = (id: string) => {
    setSelectedLineItemIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    )
  }

  if (!isOpen) return null

  const activeFolio = folios.find(f => f.id === activeFolioId)

  let totalBaseCharges = 0
  let totalServiceCharges = 0
  let totalTaxes = 0
  let totalPayments = 0

  if (activeFolio) {
    activeFolio.lineItems.forEach((i: any) => { 
      if (!i.isVoid) {
        totalBaseCharges += i.amount
        totalServiceCharges += i.serviceChargeAmount || 0
        totalTaxes += i.taxAmount
      }
    })
    activeFolio.payments.forEach((p: any) => { 
      if (!p.isRefund) totalPayments += p.amount; else totalPayments -= p.amount 
    })
  }

  const balance = (totalBaseCharges + totalServiceCharges + totalTaxes) - totalPayments

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-full sm:max-w-[95vw] w-full h-[100dvh] sm:h-[95vh] p-6 sm:p-8 flex flex-col bg-muted overflow-y-auto">
        <DialogHeader className="border-b pb-4 mb-4 shrink-0">
          <div className="flex justify-between items-center w-full">
            <div>
              <DialogTitle className="text-2xl flex items-center">
                <Receipt className="mr-2" /> Guest Folio
              </DialogTitle>
              <DialogDescription>
                Manage billing, charges, and payments for this reservation.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {loading && folios.length === 0 ? (
          <div className="flex-1 flex justify-center items-center text-muted-foreground">Loading Folio...</div>
        ) : (
          <div className="flex flex-col flex-1 h-full">
            {/* Folio Tabs */}
            <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-2 shrink-0 border-b border-border">
              {folios.map((f: any) => {
                let fBase = 0, fSc = 0, fTax = 0, fPay = 0
                f.lineItems.forEach((i: any) => { if(!i.isVoid) { fBase += i.amount; fSc += i.serviceChargeAmount || 0; fTax += i.taxAmount } })
                f.payments.forEach((p: any) => { if(!p.isRefund) fPay += p.amount; else fPay -= p.amount })
                const fBalance = (fBase + fSc + fTax) - fPay
                
                return (
                  <button
                    key={f.id}
                    onClick={() => {
                      setActiveFolioId(f.id)
                      setSelectedLineItemIds([])
                    }}
                    className={`px-4 py-2 rounded-t-md text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                      activeFolioId === f.id
                        ? "border-primary text-primary bg-card"
                        : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    Folio {f.folioNumber} <span className="text-xs opacity-70 ml-1">(${fBalance.toFixed(2)})</span>
                  </button>
                )
              })}
              <Button variant="ghost" size="sm" onClick={handleAddFolio} className="ml-2 h-8 text-muted-foreground">
                <Plus className="w-4 h-4 mr-1" /> Add Folio
              </Button>
            </div>

            {!activeFolio ? (
              <div className="flex-1 flex justify-center items-center text-muted-foreground">No folio found for this reservation.</div>
            ) : (
              <div className="grid lg:grid-cols-3 gap-6 flex-1 items-start min-h-0">
                
                {/* Left Column: Balance & Ledger */}
                <div className="lg:col-span-2 flex flex-col gap-6 h-full min-h-0">
                  {/* Balance Card */}
                  <div className="bg-card p-6 rounded-xl border shadow-sm flex justify-between items-center shrink-0">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Folio {activeFolio.folioNumber} Balance</p>
                      
                      <div className="mt-1 mb-3 flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground flex items-center">
                          <UserCircle className="w-4 h-4 mr-1 text-muted-foreground" />
                          Payee: {activeFolio.payeeProfile 
                                    ? `${activeFolio.payeeProfile.firstName} ${activeFolio.payeeProfile.lastName || ''}` 
                                    : "Primary Guest"}
                        </span>
                        <Button variant="link" size="sm" className="h-auto p-0 text-primary" onClick={() => {
                          setSelectedPayeeId(activeFolio.payeeProfileId || "none")
                          setIsPayeeDialogOpen(true)
                        }}>
                          Change
                        </Button>
                      </div>

                      <div className="mb-3 flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">Settlement:</span>
                        <Badge variant={activeFolio.settlementMethod === "CITY_LEDGER" ? "default" : "outline"}>
                          {activeFolio.settlementMethod === "CITY_LEDGER" ? "City Ledger" : "Direct"}
                        </Badge>
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-primary"
                          disabled={settlementSaving}
                          onClick={() => handleSetSettlementMethod(activeFolio.settlementMethod === "CITY_LEDGER" ? "DIRECT" : "CITY_LEDGER")}
                        >
                          Change
                        </Button>
                      </div>

                      <div className="flex items-center gap-3 mt-1">
                        <p className={`text-4xl font-bold ${balance > 0 ? 'text-destructive' : balance < 0 ? 'text-success' : 'text-foreground'}`}>
                          ${balance.toFixed(2)}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => window.open(`/e/${slug}/dashboard/folios/${activeFolio.id}/print?type=tax`, '_blank')}
                          className="h-9 shadow-sm border-border ml-2"
                        >
                          <Printer className="w-4 h-4 mr-2" /> Tax Invoice
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => window.open(`/e/${slug}/dashboard/folios/${activeFolio.id}/print?type=proforma`, '_blank')}
                          className="h-9 shadow-sm border-border ml-2"
                        >
                          <Printer className="w-4 h-4 mr-2" /> Proforma Invoice
                        </Button>
                        {activeFolio.folioNumber !== 1 && activeFolio.lineItems.length === 0 && activeFolio.payments.length === 0 && (
                          <Button 
                            size="sm" 
                            variant="destructive" 
                            onClick={handleDeleteFolio}
                            className="h-9 shadow-sm ml-2"
                          >
                            <Trash2 className="w-4 h-4 mr-2" /> Delete
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="text-right text-sm text-muted-foreground space-y-1">
                      <p>Base Charges: <span className="font-medium text-foreground">${totalBaseCharges.toFixed(2)}</span></p>
                      <p>Service Charge: <span className="font-medium text-foreground">${totalServiceCharges.toFixed(2)}</span></p>
                      <p>Total Taxes: <span className="font-medium text-foreground">${totalTaxes.toFixed(2)}</span></p>
                      <p className="border-t pt-1 mt-1">Total Payments: <span className="font-medium text-foreground">${totalPayments.toFixed(2)}</span></p>
                    </div>
                  </div>

                  {/* Move Action Bar (Shows when items selected) */}
                  {selectedLineItemIds.length > 0 && (
                    <div className="bg-muted border border-border rounded-lg p-3 flex justify-between items-center shrink-0">
                      <span className="text-sm font-medium text-primary">
                        {selectedLineItemIds.length} charge(s) selected
                      </span>
                      <Button size="sm" onClick={() => setIsMoveDialogOpen(true)}>
                        <ArrowRightLeft className="w-4 h-4 mr-2" /> Move to Folio
                      </Button>
                    </div>
                  )}

                  {/* Ledger List */}
                  <div className="bg-card rounded-xl border shadow-sm flex-1 overflow-hidden flex flex-col">
                    <div className="overflow-y-auto flex-1">
                      <Table>
                        <TableHeader className="bg-muted sticky top-0 z-10 shadow-sm">
                          <TableRow>
                            <TableHead className="w-12 text-center">
                              <Checkbox 
                                checked={activeFolio.lineItems.length > 0 && selectedLineItemIds.length === activeFolio.lineItems.length}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setSelectedLineItemIds(activeFolio.lineItems.map((i: any) => i.id))
                                  } else {
                                    setSelectedLineItemIds([])
                                  }
                                }}
                              />
                            </TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead className="text-right">Base</TableHead>
                            <TableHead className="text-right">SC</TableHead>
                            <TableHead className="text-right">Tax</TableHead>
                            <TableHead className="text-right">Total Charge</TableHead>
                            <TableHead className="text-right">Payment</TableHead>
                            <TableHead className="w-10"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {activeFolio.lineItems.map((item: any) => (
                            <TableRow key={item.id} className={selectedLineItemIds.includes(item.id) ? "bg-muted/30" : ""}>
                              <TableCell className="text-center">
                                <Checkbox
                                  checked={selectedLineItemIds.includes(item.id)}
                                  onCheckedChange={() => toggleLineItemSelection(item.id)}
                                />
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">{new Date(item.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, '-')}</TableCell>
                              <TableCell>{item.description}</TableCell>
                              <TableCell className="text-right">${item.amount.toFixed(2)}</TableCell>
                              <TableCell className="text-right text-muted-foreground">${(item.serviceChargeAmount || 0).toFixed(2)}</TableCell>
                              <TableCell className="text-right text-muted-foreground">${item.taxAmount.toFixed(2)}</TableCell>
                              <TableCell className="text-right font-medium text-destructive">${(item.amount + (item.serviceChargeAmount || 0) + item.taxAmount).toFixed(2)}</TableCell>
                              <TableCell className="text-right text-muted-foreground">-</TableCell>
                              <TableCell></TableCell>
                            </TableRow>
                          ))}
                          {activeFolio.payments.map((payment: any) => (
                            <TableRow key={payment.id}>
                              <TableCell></TableCell>
                              <TableCell className="text-xs text-muted-foreground">{new Date(payment.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, '-')}</TableCell>
                              <TableCell>Payment - {payment.paymentMethod?.name}</TableCell>
                              <TableCell className="text-right text-muted-foreground">-</TableCell>
                              <TableCell className="text-right text-muted-foreground">-</TableCell>
                              <TableCell className="text-right text-muted-foreground">-</TableCell>
                              <TableCell className="text-right text-muted-foreground">-</TableCell>
                              <TableCell className="text-right font-medium text-success">${payment.amount.toFixed(2)}</TableCell>
                              <TableCell>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7"
                                  title="Print Payment Receipt"
                                  onClick={() => window.open(`/e/${slug}/dashboard/payments/${payment.id}/receipt`, '_blank')}
                                >
                                  <Printer className="w-3.5 h-3.5" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                          {activeFolio.lineItems.length === 0 && activeFolio.payments.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={9} className="py-0">
                                <EmptyState icon={Receipt} title="No transactions posted yet" />
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </div>

                {/* Right Column: Actions */}
                <div className="lg:col-span-1 flex flex-col gap-6 sticky top-0 shrink-0">
                  <Tabs value={postType} onValueChange={(v: any) => setPostType(v)} className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="charge"><Plus className="w-4 h-4 mr-2"/> Post Charge</TabsTrigger>
                      <TabsTrigger value="payment"><CreditCard className="w-4 h-4 mr-2"/> Post Payment</TabsTrigger>
                    </TabsList>
                    
                    <TabsContent value="charge" className="bg-card p-5 rounded-b-xl border border-t-0 shadow-sm mt-0">
                      <form onSubmit={handlePostCharge} className="grid gap-5">
                        <div className="space-y-2">
                          <Label>Charge Code <span className="text-destructive">*</span></Label>
                          <Select required value={chargeForm.chargeCodeId} onValueChange={v => setChargeForm(p => ({...p, chargeCodeId: v ?? ""}))}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select Code">
                                {chargeForm.chargeCodeId ? (
                                  (() => {
                                    const c = chargeCodes.find(c => c.id === chargeForm.chargeCodeId);
                                    return c ? `${c.code} - ${c.description}` : "";
                                  })()
                                ) : ""}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {chargeCodes.map(c => <SelectItem key={c.id} value={c.id}>{`${c.code} - ${c.description}`}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Amount <span className="text-destructive">*</span></Label>
                          <div className="relative">
                            <span className="absolute left-3 top-2 text-muted-foreground">$</span>
                            <Input className="pl-7" required type="number" step="0.01" min="0.01" value={chargeForm.amount} onChange={e => setChargeForm(p => ({...p, amount: e.target.value}))} />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>Description <span className="text-destructive">*</span></Label>
                          <Input required placeholder="e.g. Minibar, Room Service" value={chargeForm.description} onChange={e => setChargeForm(p => ({...p, description: e.target.value}))} />
                        </div>
                        <Button type="submit" className="w-full mt-2" disabled={loading}>Post Charge to Folio {activeFolio.folioNumber}</Button>
                      </form>
                    </TabsContent>

                    <TabsContent value="payment" className="bg-card p-5 rounded-b-xl border border-t-0 shadow-sm mt-0">
                      <form onSubmit={handlePostPayment} className="grid gap-5">
                        <div className="space-y-2">
                          <Label>Payment Method <span className="text-destructive">*</span></Label>
                          <Select required value={paymentForm.paymentMethodId} onValueChange={v => setPaymentForm(p => ({...p, paymentMethodId: v ?? ""}))}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select Method">
                                {paymentForm.paymentMethodId ? (
                                  (() => {
                                    const m = paymentMethods.find(m => m.id === paymentForm.paymentMethodId);
                                    return m ? m.name : "";
                                  })()
                                ) : ""}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {paymentMethods.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Amount <span className="text-destructive">*</span></Label>
                          <div className="relative">
                            <span className="absolute left-3 top-2 text-muted-foreground">$</span>
                            <Input className="pl-7" required type="number" step="0.01" min="0.01" value={paymentForm.amount} onChange={e => setPaymentForm(p => ({...p, amount: e.target.value}))} />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>Reference No. (Optional)</Label>
                          <Input placeholder="e.g. Receipt # or Check #" value={paymentForm.referenceNumber} onChange={e => setPaymentForm(p => ({...p, referenceNumber: e.target.value}))} />
                        </div>
                        <Button type="submit" className="w-full bg-success hover:bg-success/90 mt-2" disabled={loading}>Post Payment to Folio {activeFolio.folioNumber}</Button>
                      </form>
                    </TabsContent>
                  </Tabs>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>

      {/* Move Charges Dialog */}
      <Dialog open={isMoveDialogOpen} onOpenChange={setIsMoveDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Move Charges</DialogTitle>
            <DialogDescription>
              Select the destination folio for the {selectedLineItemIds.length} selected charge(s).
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label>Target Folio</Label>
            <Select value={targetFolioId} onValueChange={(v) => setTargetFolioId(v ?? "")}>
              <SelectTrigger className="mt-2">
                <SelectValue placeholder="Select destination folio" />
              </SelectTrigger>
              <SelectContent>
                {folios.filter((f: any) => f.id !== activeFolioId).map((f: any) => (
                  <SelectItem key={f.id} value={f.id}>
                    Folio {f.folioNumber}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {folios.length === 1 && (
              <p className="text-sm text-warning mt-2">
                Please create a new Folio first using the "Add Folio" button before moving charges.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsMoveDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleMoveCharges} disabled={!targetFolioId || folios.length === 1}>Move Charges</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Payee Dialog */}
      <Dialog open={isPayeeDialogOpen} onOpenChange={setIsPayeeDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Assign Folio Payee</DialogTitle>
            <DialogDescription>
              Select who should be billed for Folio {activeFolio?.folioNumber}. This name will appear on the final invoice.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label>Payee Profile</Label>
            <Select value={selectedPayeeId} onValueChange={(v) => setSelectedPayeeId(v ?? "")}>
              <SelectTrigger className="mt-2">
                <SelectValue placeholder="Select a Payee">
                  {selectedPayeeId ? (
                    selectedPayeeId === "none" ? (
                      `Primary Guest (${activeFolio?.reservation?.primaryGuest?.firstName} ${activeFolio?.reservation?.primaryGuest?.lastName})`
                    ) : (
                      (() => {
                        const sharer = activeFolio?.reservation?.accompanyingGuests?.find((ag: any) => ag.profile.upid === selectedPayeeId);
                        if (sharer) {
                          return `Sharer - ${sharer.profile.firstName} ${sharer.profile.lastName}`;
                        }
                        return selectedPayeeId;
                      })()
                    )
                  ) : null}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  Primary Guest ({activeFolio?.reservation?.primaryGuest?.firstName} {activeFolio?.reservation?.primaryGuest?.lastName})
                </SelectItem>
                {activeFolio?.reservation?.accompanyingGuests?.map((ag: any) => (
                  <SelectItem key={ag.profile.upid} value={ag.profile.upid}>
                    Sharer - {ag.profile.firstName} {ag.profile.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPayeeDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAssignPayee} disabled={!selectedPayeeId}>Save Payee</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Notification Modal */}
      <Dialog open={!!notification} onOpenChange={(open) => { if (!open) setNotification(null) }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className={notification?.isError ? "text-destructive" : "text-success"}>
              {notification?.title}
            </DialogTitle>
            <DialogDescription className="text-base text-foreground mt-2">
              {notification?.message}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button onClick={() => setNotification(null)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}
