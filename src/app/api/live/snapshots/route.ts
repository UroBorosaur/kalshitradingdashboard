import { NextRequest, NextResponse } from "next/server";

import { getCryptoLatestQuotes, getStockSnapshots } from "@/lib/live/alpaca";

const cryptoRegex = /^([A-Z]{2,6})\/(USD|USDT)$/;

export async function GET(request: NextRequest) {
  const symbolsParam = request.nextUrl.searchParams.get("symbols") ?? "AAPL,MSFT,BTC/USD,ETH/USD";
  const symbols = symbolsParam
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const stockSymbols = symbols.filter((s) => !cryptoRegex.test(s));
  const cryptoSymbols = symbols.filter((s) => cryptoRegex.test(s));

  try {
    const [stocks, crypto] = await Promise.all([
      getStockSnapshots(stockSymbols),
      getCryptoLatestQuotes(cryptoSymbols),
    ]);

    return NextResponse.json({
      ok: true,
      symbols,
      stocks,
      crypto,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
