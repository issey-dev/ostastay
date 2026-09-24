import { NextResponse } from "next/server";
import { readLogo, isSafeLogoName } from "@/lib/property-logo";

// A property's uploaded logo (src/lib/property-logo.ts). Public on purpose: it prints on
// documents, goes into guest emails and onto the property's own website through the
// Booking API. Every upload has a fresh random name, so a file never changes — cached for good.
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!isSafeLogoName(file)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const buffer = await readLogo(file);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(buffer.length),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
