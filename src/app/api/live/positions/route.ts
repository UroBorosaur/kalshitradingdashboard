import { NextResponse } from "next/server";

import { getAlpacaPositions } from "@/lib/live/alpaca";

export async function GET() {
  try {
    const positions = await getAlpacaPositions();
    return NextResponse.json({ ok: true, positions });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
