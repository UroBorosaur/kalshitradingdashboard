import { NextRequest, NextResponse } from "next/server";

import { getAlpacaOrders } from "@/lib/live/alpaca";

export async function GET(request: NextRequest) {
  const status = (request.nextUrl.searchParams.get("status") ?? "all") as "open" | "closed" | "all";
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "200");

  try {
    const orders = await getAlpacaOrders(status, Number.isFinite(limit) ? limit : 200);
    return NextResponse.json({ ok: true, orders });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
