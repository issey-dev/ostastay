import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { generateTablePdf } from '@/lib/pdfGenerator';
import { format } from 'date-fns';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const dateParam = url.searchParams.get('date');
  const targetDate = dateParam ? new Date(dateParam) : new Date();
  const isoDate = targetDate.toISOString().split('T')[0]; // YYYY-MM-DD

  const session = await getSession();
  const role = (session?.role as string) || "FRONT_DESK";
  if (!session || !["ADMIN", "FRONT_DESK"].includes(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fetch reservations that are scheduled to arrive today (status RESERVED)
  const reservations = await prisma.reservation.findMany({
    where: {
      property: { tenantId: session.tenantId as string },
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
}
