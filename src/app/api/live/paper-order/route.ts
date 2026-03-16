import { NextResponse } from "next/server";

import { placeAlpacaPaperOrder } from "@/lib/live/alpaca";

interface Body {
  symbol: string;
  qty: number;
  side: "buy" | "sell";
  type?: "market" | "limit";
  timeInForce?: "day" | "gtc";
  limitPrice?: number;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    if (!body.symbol || !body.qty || !body.side) {
      return NextResponse.json({ ok: false, error: "symbol, qty, side are required" }, { status: 400 });
    }

    const order = await placeAlpacaPaperOrder({
      symbol: body.symbol,
      qty: body.qty,
      side: body.side,
      type: body.type,
      time_in_force: body.timeInForce,
      limit_price: body.limitPrice,
    });

    return NextResponse.json({ ok: true, order });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
