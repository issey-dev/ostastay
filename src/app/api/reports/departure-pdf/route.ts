import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, requirePermission, toErrorResponse } from '@/lib/scope';
import { generateTablePdf } from '@/lib/pdfGenerator';
import { format } from 'date-fns';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const dateParam = url.searchParams.get('date');
  const targetDate = dateParam ? new Date(dateParam) : new Date();
  const isoDate = targetDate.toISOString().split('T')[0];

  try {
    const ctx = await requireSession();
    requirePermission(ctx, 'REPORTS', 'view');

    // Fetch reservations that are checking out today (status IN_HOUSE)
    const reservations = await prisma.reservation.findMany({
      where: {
        property: { enterpriseId: ctx.enterpriseId },
        status: 'IN_HOUSE',
        checkOutDate: {
          gte: new Date(isoDate + 'T00:00:00.000Z'),
          lt: new Date(isoDate + 'T23:59:59.999Z')
        }
      },
      include: {
        primaryGuest: true,
        assignments: {
          include: { roomType: true, room: true },
          orderBy: { startDate: 'asc' }
        },
        folios: {
          include: {
            lineItems: true,
            payments: true
          }
        }
      },
      orderBy: { checkOutDate: 'asc' }
    });

    const headers = ['Guest', 'Confirmation #', 'Room Type', 'Room', 'Departure', 'Balance Due'];
    const rows = reservations.map(r => {
      const assignment = r.assignments[0];
      const primaryFolio = r.folios[0];
      const totalCharges = primaryFolio?.lineItems?.reduce((sum, li) => sum + (li.amount + (li.taxAmount ?? 0) + (li.serviceChargeAmount ?? 0)), 0) ?? 0;
      const totalPayments = primaryFolio?.payments?.reduce((sum, p) => sum + p.amount, 0) ?? 0;
      const balance = (totalCharges - totalPayments).toFixed(2);
      return [
        `${r.primaryGuest.firstName} ${r.primaryGuest.lastName}`,
        r.confirmationNo,
        assignment?.roomType.name ?? '—',
        assignment?.room?.roomNumber ?? '—',
        format(r.checkOutDate, 'PPpp'),
        `$${balance}`
      ];
    });

    const title = `Departure List – ${format(targetDate, 'PP')}`;
    const pdfBytes = await generateTablePdf(title, headers, rows);

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="departure-list-${isoDate}.pdf"`
      }
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
