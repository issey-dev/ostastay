import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { format } from 'date-fns';

/**
 * Generate a simple A4 PDF with a table of rows.
 * @param title Page title (e.g., "Arrival List – 2024-10-03")
 * @param headers Array of column header strings
 * @param rows Array of rows, each row is an array of string values
 * @returns Uint8Array PDF bytes
 */
export async function generateTablePdf(
  title: string,
  headers: string[],
  rows: string[][]
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4 size in points

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 40;
  const usableWidth = page.getWidth() - margin * 2;

  const lineHeight = 20;
  const headerHeight = lineHeight * 2;

  // Header background (slate‑indigo style)
  page.drawRectangle({
    x: margin,
    y: page.getHeight() - margin - headerHeight,
    width: usableWidth,
    height: headerHeight,
    color: rgb(0.12, 0.12, 0.25) // dark slaty-indigo
  });

  // Title text
  page.drawText(title, {
    x: margin + 10,
    y: page.getHeight() - margin - 30,
    size: 18,
    font: fontBold,
    color: rgb(1, 1, 1)
  });

  // Draw headers
  const columnCount = headers.length;
  const columnWidth = usableWidth / columnCount;
  headers.forEach((text, i) => {
    page.drawText(text, {
      x: margin + i * columnWidth + 5,
      y: page.getHeight() - margin - lineHeight - 5,
      size: 12,
      font: fontBold,
      color: rgb(1, 1, 1)
    });
  });

  // Draw rows
  let y = page.getHeight() - margin - headerHeight - 10;
  rows.forEach((row) => {
    if (y < margin + lineHeight) {
      // Add new page if we run out of space
      const newPage = pdfDoc.addPage([595.28, 841.89]);
      y = newPage.getHeight() - margin - lineHeight;
    }
    row.forEach((cell, i) => {
      page.drawText(cell, {
        x: margin + i * columnWidth + 5,
        y: y,
        size: 10,
        font: font,
        color: rgb(0, 0, 0)
      });
    });
    y -= lineHeight;
  });

  // Footer timestamp
  const timestamp = `Generated: ${format(new Date(), 'PPpp')}`;
  page.drawText(timestamp, {
    x: margin,
    y: margin / 2,
    size: 8,
    font: font,
    color: rgb(0.5, 0.5, 0.5)
  });

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}
