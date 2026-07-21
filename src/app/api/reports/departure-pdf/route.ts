import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from '@/lib/scope';
import { computeFolioBalance } from '@/lib/debtor-accounts';
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

    // A property-scoped user only ever sees their own property's departures — an
    // explicit propertyId is checked against that; omitting it defaults to their own
    // property, or (for an enterprise-scoped user) every property in the enterprise.
    const propertyId = url.searchParams.get('propertyId');
    if (propertyId) {
      await assertPropertyAccess(ctx, propertyId);
    } else if (ctx.scope === 'PROPERTY') {
      await assertPropertyAccess(ctx, ctx.propertyId!);
    }
    const scopedPropertyId = propertyId || (ctx.scope === 'PROPERTY' ? ctx.propertyId! : undefined);

    // Fetch reservations that are checking out today (status IN_HOUSE)
    const reservations = await prisma.reservation.findMany({
      where: {
        ...(scopedPropertyId ? { propertyId: scopedPropertyId } : { property: { enterpriseId: ctx.enterpriseId } }),
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
      // Sum across ALL folios, excluding voided charges and netting refunds —
      // the same math as the folio panel, via the shared helper.
      const balance = r.folios
        .reduce((sum, f) => sum + computeFolioBalance(f.lineItems, f.payments), 0)
        .toFixed(2);
      return [
        `${r.primaryGuest.firstName} ${r.primaryGuest.lastName}`,
        r.confirmationNo,
        assignment?.roomType.name ?? '—',
        assignment?.room?.roomNumber ?? '—',
        format(r.checkOutDate, 'PPpp'),
        `$${balance}`
      ];
    });

    // The on-screen "Printable View" needs the same table as raw data, not a PDF.
    if (url.searchParams.get('format') === 'json') {
      return NextResponse.json({ headers, rows });
    }

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
