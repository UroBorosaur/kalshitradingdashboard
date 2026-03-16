import { NextResponse } from "next/server";

import {
  getKalshiDemoBalancesUsd,
  getKalshiDemoFills,
  getKalshiDemoPositions,
  getKalshiMarketQuotes,
  getKalshiDemoOrders,
  kalshiConnectionStatus,
} from "@/lib/prediction/kalshi";
import { persistKalshiSummarySnapshot } from "@/lib/storage/prediction-store";

export async function GET() {
  const status = kalshiConnectionStatus();

  if (!status.connected) {
    return NextResponse.json({
      ok: true,
      connected: false,
      provider: status.provider,
      balanceUsd: null,
      cashUsd: null,
      portfolioUsd: null,
      orders: [],
      fills: [],
      positions: [],
      quotes: {},
      error: status.reason ?? "Kalshi credentials not configured.",
    });
  }

  try {
    const [orders, fills, positions, balances] = await Promise.all([
      getKalshiDemoOrders(500),
      getKalshiDemoFills(500),
      getKalshiDemoPositions(200),
      getKalshiDemoBalancesUsd(),
    ]);
    const quoteTickers = [
      ...positions.map((position) => position.ticker),
      ...orders.map((order) => order.ticker),
    ];
    const quotes = await getKalshiMarketQuotes(quoteTickers);
    await persistKalshiSummarySnapshot({
      orders,
      fills,
      positions,
      quotes,
      source: "api/live/kalshi/summary",
    }).catch(() => undefined);

    return NextResponse.json({
      ok: true,
      connected: true,
      provider: status.provider,
      balanceUsd: balances.cashUsd ?? balances.portfolioUsd ?? null,
      cashUsd: balances.cashUsd ?? balances.portfolioUsd ?? null,
      portfolioUsd: balances.portfolioUsd ?? balances.cashUsd ?? null,
      orders,
      fills,
      positions,
      quotes,
      error: null,
    });
  } catch (error) {
    return NextResponse.json({
      ok: true,
      connected: false,
      provider: status.provider,
      balanceUsd: null,
      cashUsd: null,
      portfolioUsd: null,
      orders: [],
      fills: [],
      positions: [],
      quotes: {},
      error: (error as Error).message,
    });
  }
}
