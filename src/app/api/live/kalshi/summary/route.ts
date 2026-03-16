import { NextResponse } from "next/server";

import {
  getKalshiDemoBalancesUsd,
  kalshiConnectionStatus,
} from "@/lib/prediction/kalshi";
import { getKalshiLiveSummaryStream } from "@/lib/prediction/kalshi-stream";
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
      stream: null,
      error: status.reason ?? "Kalshi credentials not configured.",
    });
  }

  try {
    const balances = await getKalshiDemoBalancesUsd();
    const seededSummary = await getKalshiLiveSummaryStream([]);
    const { orders, fills, positions, quotes, stream } = seededSummary;
    await persistKalshiSummarySnapshot({
      balanceUsd: balances.cashUsd ?? balances.portfolioUsd ?? null,
      cashUsd: balances.cashUsd ?? balances.portfolioUsd ?? null,
      portfolioUsd: balances.portfolioUsd ?? balances.cashUsd ?? null,
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
      stream,
      error: null,
    });
  } catch (error) {
    return NextResponse.json({
      ok: true,
      connected: status.connected,
      provider: status.provider,
      balanceUsd: null,
      cashUsd: null,
      portfolioUsd: null,
      orders: [],
      fills: [],
      positions: [],
      quotes: {},
      stream: null,
      error: (error as Error).message,
    });
  }
}
