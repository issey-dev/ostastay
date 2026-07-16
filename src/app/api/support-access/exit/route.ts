import { NextResponse } from "next/server";
import { clearSupportSession } from "@/lib/scope";

export async function POST() {
  await clearSupportSession();
  return NextResponse.json({ success: true });
}
