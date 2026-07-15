"use client"

import { useEffect, useState, use } from "react"
import { format, parseISO } from "date-fns"
import { Printer, ArrowLeft, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function PrintInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchInvoiceData()
  }, [id])

  const fetchInvoiceData = async () => {
    try {
      const res = await fetch(`/api/folios/${id}/invoice-data`)
      if (res.ok) {
        const json = await res.json()
        setData(json)
        // Auto print after a short delay for rendering
        setTimeout(() => {
          window.print()
        }, 1000)
      } else {
        setError("Failed to load invoice data.")
      }
    } catch (e) {
      console.error(e)
      setError("An unexpected error occurred.")
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col justify-center items-center gap-4 bg-slate-50">
        <Loader2 className="w-10 h-10 animate-spin text-indigo-600" />
        <p className="text-slate-500 font-medium">Preparing printable invoice...</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col justify-center items-center gap-4 bg-slate-50">
        <div className="text-red-500 font-bold text-lg">{error || "Folio not found"}</div>
        <Button onClick={() => window.close()} variant="outline">Close Tab</Button>
      </div>
    )
  }

  const { folio, settings } = data
  const { reservation } = folio
  const { primaryGuest } = reservation

  // Calculate totals
  let totalBaseCharges = 0
  let totalServiceCharges = 0
  let totalTaxes = 0
  let totalPayments = 0

  folio.lineItems.forEach((i: any) => {
    if (!i.isVoid) {
      totalBaseCharges += i.amount
      totalServiceCharges += i.serviceChargeAmount || 0
      totalTaxes += i.taxAmount
    }
  })

  folio.payments.forEach((p: any) => {
    if (!p.isRefund) totalPayments += p.amount
    else totalPayments -= p.amount
  })

  const balance = (totalBaseCharges + totalServiceCharges + totalTaxes) - totalPayments

  const fontFamilies: Record<string, string> = {
    Geist: "font-sans",
    Inter: "font-sans",
    Roboto: "font-sans",
    Georgia: "font-serif",
    Courier: "font-mono"
  }

  const selectedFont = fontFamilies[settings.invoiceFontFamily] || "font-sans"
  const brandColor = settings.invoiceBrandColor || "#4f46e5"

  return (
    <div className={`bg-white min-h-screen text-slate-800 ${selectedFont}`}>
      {/* Control bar - hidden during print */}
      <div className="print:hidden bg-slate-100 border-b p-4 flex justify-between items-center sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => window.close()}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
          <span className="text-xs text-slate-500 font-medium">Invoice Preview for #{reservation.confirmationNo}</span>
        </div>
        <Button onClick={() => window.print()} className="bg-indigo-600 hover:bg-indigo-700">
          <Printer className="w-4 h-4 mr-2" /> Print / Save as PDF
        </Button>
      </div>

      {/* Invoice Document Page */}
      <div className="max-w-[800px] mx-auto p-8 sm:p-12 print:p-0">
        
        {/* Header Block */}
        <div className="flex justify-between items-start border-b-2 pb-6 mb-8" style={{ borderBottomColor: brandColor }}>
          <div>
            {settings.invoiceLogoUrl ? (
              <img 
                src={settings.invoiceLogoUrl} 
                alt="Brand Logo" 
                className="max-h-16 max-w-[200px] mb-4 object-contain"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            ) : (
              <div 
                className="w-12 h-12 rounded flex items-center justify-center text-white mb-4 font-bold text-lg shadow-sm"
                style={{ backgroundColor: brandColor }}
              >
                {settings.invoiceBrandName ? settings.invoiceBrandName.charAt(0).toUpperCase() : "H"}
              </div>
            )}
            <h1 className="text-xl font-bold tracking-tight text-slate-900 uppercase">
              {settings.invoiceBrandName || "Main Guest House"}
            </h1>
            <div className="text-xs text-slate-500 mt-2 space-y-0.5">
              <p className="whitespace-pre-line">{settings.invoiceAddress || "123 Guest House Way, City"}</p>
              {settings.invoicePhone && <p>Phone: {settings.invoicePhone}</p>}
              {settings.invoiceEmail && <p>Email: {settings.invoiceEmail}</p>}
              {settings.invoiceTaxId && <p className="font-semibold text-slate-700 mt-1">Tax ID: {settings.invoiceTaxId}</p>}
            </div>
          </div>

          <div className="text-right">
            <h2 className="text-3xl font-extrabold tracking-tight uppercase mb-4" style={{ color: brandColor }}>
              Invoice
            </h2>
            <div className="text-xs text-slate-500 space-y-1">
              <p>Invoice No: <span className="font-semibold text-slate-800">INV-{reservation.confirmationNo}</span></p>
              <p>Confirmation No: <span className="font-semibold text-slate-800">{reservation.confirmationNo}</span></p>
              <p>Date: <span className="font-semibold text-slate-800">{format(new Date(), "dd-MMM-yy")}</span></p>
              <p>Folio No: <span className="font-semibold text-slate-800">{folio.folioNumber}</span></p>
            </div>
          </div>
        </div>

        {/* Entity Header Info (Optional Legal Registration Info) */}
        {settings.invoiceHeaderText && (
          <div className="bg-slate-50 p-4 rounded border border-slate-100 text-xs text-slate-600 mb-6 whitespace-pre-line leading-relaxed">
            {settings.invoiceHeaderText}
          </div>
        )}

        {/* Stay and Guest Details */}
        <div className="grid grid-cols-2 gap-8 bg-slate-50/50 p-6 rounded-lg border border-slate-100 mb-8 text-xs">
          <div>
            <h3 className="font-bold text-slate-400 uppercase tracking-wider text-[10px] mb-2">Guest Information</h3>
            <p className="font-bold text-sm text-slate-900">{primaryGuest.firstName} {primaryGuest.lastName}</p>
            {primaryGuest.contacts?.[0]?.address && <p className="text-slate-500 mt-1">{primaryGuest.contacts[0].address}</p>}
            {primaryGuest.contacts?.[0]?.email && <p className="text-slate-500">Email: {primaryGuest.contacts[0].email}</p>}
            {primaryGuest.contacts?.[0]?.mobile && <p className="text-slate-500">Phone: {primaryGuest.contacts[0].mobile}</p>}
          </div>

          <div>
            <h3 className="font-bold text-slate-400 uppercase tracking-wider text-[10px] mb-2">Stay Summary</h3>
            <div className="grid grid-cols-2 gap-y-1 text-slate-600">
              <span className="font-medium">Check-In:</span>
              <span className="text-slate-900 font-semibold">{format(parseISO(reservation.checkInDate), "dd-MMM-yy")}</span>
              <span className="font-medium">Check-Out:</span>
              <span className="text-slate-900 font-semibold">{format(parseISO(reservation.checkOutDate), "dd-MMM-yy")}</span>
              <span className="font-medium">Total Nights:</span>
              <span className="text-slate-900 font-semibold">
                {Math.max(1, Math.round((new Date(reservation.checkOutDate).getTime() - new Date(reservation.checkInDate).getTime()) / (1000 * 3600 * 24)))}
              </span>
              <span className="font-medium">Rooms:</span>
              <span className="text-slate-900 font-semibold">
                {reservation.assignments?.map((a: any) => a.room?.roomNumber).filter(Boolean).join(", ") || "TBA"}
              </span>
            </div>
          </div>
        </div>

        {/* Room Assignments Split Stay Breakdown */}
        {reservation.assignments && reservation.assignments.length > 1 && (
          <div className="mb-8">
            <h3 className="font-bold text-slate-500 uppercase tracking-wider text-[10px] mb-2">Room Stay Assignments</h3>
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-xs text-slate-700">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="text-left p-2 font-semibold">Room Number</th>
                    <th className="text-left p-2 font-semibold">Room Type</th>
                    <th className="text-left p-2 font-semibold">Dates</th>
                    <th className="text-right p-2 font-semibold">Rate Plan</th>
                  </tr>
                </thead>
                <tbody>
                  {reservation.assignments.map((a: any) => (
                    <tr key={a.id} className="border-b last:border-0">
                      <td className="p-2 font-semibold">Room {a.room?.roomNumber || "TBA"}</td>
                      <td className="p-2">{a.roomType.name}</td>
                      <td className="p-2 text-slate-500">
                        {format(parseISO(a.startDate), "dd-MMM")} - {format(parseISO(a.endDate), "dd-MMM-yy")}
                      </td>
                      <td className="p-2 text-right">{a.ratePlan.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Charges Table */}
        <div className="mb-8">
          <h3 className="font-bold text-slate-500 uppercase tracking-wider text-[10px] border-b pb-2 mb-3">Charges & Room Rates</h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-slate-500 font-semibold">
                <th className="text-left pb-2 w-28">Date</th>
                <th className="text-left pb-2">Description</th>
                <th className="text-right pb-2 w-24">Base Price</th>
                <th className="text-right pb-2 w-20">SC</th>
                <th className="text-right pb-2 w-20">Tax</th>
                <th className="text-right pb-2 w-24">Total</th>
              </tr>
            </thead>
            <tbody>
              {folio.lineItems.map((item: any) => (
                <tr key={item.id} className="border-b text-slate-700">
                  <td className="py-2.5 text-slate-500">{format(parseISO(item.date), "dd-MMM-yy")}</td>
                  <td className="py-2.5">{item.description}</td>
                  <td className="text-right py-2.5">${item.amount.toFixed(2)}</td>
                  <td className="text-right py-2.5 text-slate-400">${(item.serviceChargeAmount || 0).toFixed(2)}</td>
                  <td className="text-right py-2.5 text-slate-400">${item.taxAmount.toFixed(2)}</td>
                  <td className="text-right py-2.5 font-semibold text-slate-900">${(item.amount + (item.serviceChargeAmount || 0) + item.taxAmount).toFixed(2)}</td>
                </tr>
              ))}
              {folio.lineItems.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-6 text-slate-400 italic">No charges posted.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Payments Table */}
        <div className="mb-8">
          <h3 className="font-bold text-slate-500 uppercase tracking-wider text-[10px] border-b pb-2 mb-3">Payments & Credits</h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-slate-500 font-semibold">
                <th className="text-left pb-2 w-28">Date</th>
                <th className="text-left pb-2">Method</th>
                <th className="text-left pb-2">Reference / Notes</th>
                <th className="text-right pb-2 w-24">Amount</th>
              </tr>
            </thead>
            <tbody>
              {folio.payments.map((payment: any) => (
                <tr key={payment.id} className="border-b text-slate-700">
                  <td className="py-2.5 text-slate-500">{format(parseISO(payment.createdAt), "dd-MMM-yy")}</td>
                  <td className="py-2.5 font-semibold text-slate-900">Payment - {payment.paymentMethod?.name}</td>
                  <td className="py-2.5 text-slate-500">{payment.referenceNumber || "-"}</td>
                  <td className="text-right py-2.5 font-semibold text-emerald-600">${payment.amount.toFixed(2)}</td>
                </tr>
              ))}
              {folio.payments.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center py-6 text-slate-400 italic">No payments recorded.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Totals Summary */}
        <div className="flex justify-end mb-12">
          <div className="w-80 bg-slate-50 border border-slate-100 rounded-lg p-6 text-xs space-y-2">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal Charges:</span>
              <span className="font-medium text-slate-900">${totalBaseCharges.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Service Charge (SC):</span>
              <span className="font-medium text-slate-900">${totalServiceCharges.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Total Taxes & VAT:</span>
              <span className="font-medium text-slate-900">${totalTaxes.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-600 border-b pb-2 mb-2">
              <span>Total Paid:</span>
              <span className="font-medium text-slate-900">${totalPayments.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-sm font-bold pt-1">
              <span>Net Balance Due:</span>
              <span 
                className="text-lg font-extrabold" 
                style={{ color: balance > 0 ? brandColor : balance < 0 ? "#10b981" : "#1e293b" }}
              >
                ${balance.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* Terms & Footer */}
        <div className="border-t pt-6 space-y-4 text-[10px] text-slate-500 leading-relaxed">
          {settings.invoicePaymentTerms && (
            <div>
              <h4 className="font-bold text-slate-700 uppercase tracking-wider text-[8px] mb-1">Payment Terms & Conditions</h4>
              <p className="whitespace-pre-line">{settings.invoicePaymentTerms}</p>
            </div>
          )}

          {settings.invoiceFooterText && (
            <p className="text-center italic text-slate-400 pt-2 border-t border-slate-100 whitespace-pre-line">
              {settings.invoiceFooterText}
            </p>
          )}
        </div>

      </div>

      {/* Inject print-specific styling */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          body {
            background-color: white !important;
            color: black !important;
          }
          .print\\:hidden {
            display: none !important;
          }
          .print\\:p-0 {
            padding: 0 !important;
          }
          @page {
            size: auto;
            margin: 20mm;
          }
        }
      `}} />
    </div>
  )
}
