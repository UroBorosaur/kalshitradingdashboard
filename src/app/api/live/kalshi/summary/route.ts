import { NextResponse } from "next/server";

import {
  getKalshiDemoBalancesUsd,
  getKalshiMarketQuotes,
  kalshiConnectionStatus,
} from "@/lib/prediction/kalshi";
import { getKalshiLiveSummaryStream } from "@/lib/prediction/kalshi-stream";
import type { KalshiQuoteLite } from "@/lib/prediction/types";
import { readStoredQuotesSince } from "@/lib/storage/prediction-store";
import { persistKalshiSummarySnapshot } from "@/lib/storage/prediction-store";

function cleanReadableTitle(title: string | null | undefined, ticker: string) {
  const next = title?.trim();
  if (!next) return null;
  if (next.toUpperCase() === ticker.toUpperCase()) return null;
  return next;
}

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
    const activeTickers = Array.from(
      new Set([
        ...orders.map((order) => order.ticker?.toUpperCase?.().trim()).filter((ticker): ticker is string => Boolean(ticker)),
        ...positions.map((position) => position.ticker?.toUpperCase?.().trim()).filter((ticker): ticker is string => Boolean(ticker)),
      ]),
    );
    const storedTitles = activeTickers.length
      ? await readStoredQuotesSince(Date.now() - 45 * 24 * 60 * 60 * 1000)
          .then((events) => {
            const latest = new Map<string, { title: string; recordedAt: number }>();
            for (const event of events) {
              const ticker = String(event.payload?.ticker ?? "").toUpperCase().trim();
              if (!ticker || !activeTickers.includes(ticker)) continue;
              const readable = cleanReadableTitle(event.payload?.title, ticker);
              if (!readable) continue;
              const recordedAt = new Date((event as { timestamp?: string }).timestamp ?? event.recordedAt ?? 0).getTime();
              const prior = latest.get(ticker);
              if (!prior || recordedAt > prior.recordedAt) {
                latest.set(ticker, { title: readable, recordedAt });
              }
            }
            return latest;
          })
          .catch(() => new Map<string, { title: string; recordedAt: number }>())
      : new Map<string, { title: string; recordedAt: number }>();
    const fetchedQuotes: Record<string, KalshiQuoteLite> = activeTickers.length
      ? await getKalshiMarketQuotes(activeTickers).catch(() => ({} as Record<string, KalshiQuoteLite>))
      : {};
    const mergedQuotes: Record<string, KalshiQuoteLite> = { ...quotes, ...fetchedQuotes };
    for (const ticker of activeTickers) {
      const current = mergedQuotes[ticker];
      if (!current) continue;
      const stored = storedTitles.get(ticker);
      if (stored && !cleanReadableTitle(current.title, ticker)) {
        mergedQuotes[ticker] = {
          ...current,
          title: stored.title,
        };
      }
    }
    await persistKalshiSummarySnapshot({
      balanceUsd: balances.cashUsd ?? balances.portfolioUsd ?? null,
      cashUsd: balances.cashUsd ?? balances.portfolioUsd ?? null,
      portfolioUsd: balances.portfolioUsd ?? balances.cashUsd ?? null,
      orders,
      fills,
      positions,
      quotes: mergedQuotes,
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
      quotes: mergedQuotes,
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
