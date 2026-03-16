import { NextRequest, NextResponse } from "next/server";

import { getAlpacaPortfolioHistory } from "@/lib/live/alpaca";

export async function GET(request: NextRequest) {
  const period = request.nextUrl.searchParams.get("period") ?? "1A";
  const timeframe = request.nextUrl.searchParams.get("timeframe") ?? "1D";

  try {
    const history = await getAlpacaPortfolioHistory(period, timeframe);
    return NextResponse.json({ ok: true, history });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
