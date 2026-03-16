import { NextResponse } from "next/server";

import { closeAlpacaPosition } from "@/lib/live/alpaca";

interface Body {
  symbol: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    if (!body.symbol) {
      return NextResponse.json({ ok: false, error: "symbol is required" }, { status: 400 });
    }

    const result = await closeAlpacaPosition(body.symbol);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
