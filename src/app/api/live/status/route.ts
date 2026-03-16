import { NextResponse } from "next/server";

import { alpacaConnectionStatus } from "@/lib/live/alpaca";

export async function GET() {
  const status = alpacaConnectionStatus();
  return NextResponse.json(status);
}
