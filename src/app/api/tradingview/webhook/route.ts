import { NextResponse } from "next/server";

import { placeAlpacaPaperOrder } from "@/lib/live/alpaca";

interface TradingViewWebhookPayload {
  passphrase?: string;
  symbol?: string;
  side?: "buy" | "sell";
  qty?: number;
  type?: "market" | "limit";
  time_in_force?: "day" | "gtc";
  limit_price?: number;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as TradingViewWebhookPayload;
    const expected = process.env.TRADINGVIEW_WEBHOOK_PASSPHRASE;

    if (expected && payload.passphrase !== expected) {
      return NextResponse.json({ ok: false, error: "invalid passphrase" }, { status: 401 });
    }

    if (!payload.symbol || !payload.side || !payload.qty) {
      return NextResponse.json({ ok: false, error: "symbol, side, qty are required" }, { status: 400 });
    }

    const order = await placeAlpacaPaperOrder({
      symbol: payload.symbol,
      qty: payload.qty,
      side: payload.side,
      type: payload.type,
      time_in_force: payload.time_in_force,
      limit_price: payload.limit_price,
    });

    return NextResponse.json({ ok: true, order });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
