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
  const isoDate = targetDate.toISOString().split('T')[0]; // YYYY-MM-DD

  try {
    const ctx = await requireSession();
    requirePermission(ctx, 'REPORTS', 'view');

    // Fetch reservations that are scheduled to arrive today (status RESERVED)
    const reservations = await prisma.reservation.findMany({
      where: {
        property: { enterpriseId: ctx.enterpriseId },
        status: 'RESERVED',
        checkInDate: {
          gte: new Date(isoDate + 'T00:00:00.000Z'),
          lt: new Date(isoDate + 'T23:59:59.999Z')
        }
      },
      include: {
        primaryGuest: true,
        assignments: {
          include: { roomType: true, room: true },
          orderBy: { startDate: 'asc' }
        }
      },
      orderBy: { checkInDate: 'asc' }
    });

    const headers = ['Guest', 'Confirmation #', 'Room Type', 'Room', 'Arrival'];
    const rows = reservations.map(r => {
      const assignment = r.assignments[0];
      return [
        `${r.primaryGuest.firstName} ${r.primaryGuest.lastName}`,
        r.confirmationNo,
        assignment?.roomType.name ?? '—',
        assignment?.room?.roomNumber ?? '—',
        format(r.checkInDate, 'PPpp')
      ];
    });

    const title = `Arrival List – ${format(targetDate, 'PP')}`;
    const pdfBytes = await generateTablePdf(title, headers, rows);

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="arrival-list-${isoDate}.pdf"`
      }
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
