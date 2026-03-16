import "@/lib/server-only";

import { persistMarkoutEvents, readStoredMarkoutsSince } from "@/lib/storage/prediction-store";
import type { MarkoutHorizonKey, StoredMarkoutEvent } from "@/lib/storage/types";
import type { KalshiFillLite, PredictionMarketQuote } from "@/lib/prediction/types";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const MARKOUT_HORIZONS_MS: Record<Exclude<MarkoutHorizonKey, "expiry">, number> = {
  "5s": 5_000,
  "30s": 30_000,
  "2m": 2 * 60_000,
  "10m": 10 * 60_000,
};

export interface MarkoutSummary {
  count: number;
  averageMarkout: number;
}

export interface RecentMarkoutDiagnostics {
  horizons: Record<MarkoutHorizonKey, MarkoutSummary>;
  latestWindowHours: number;
}

function emptySummary(): MarkoutSummary {
  return {
    count: 0,
    averageMarkout: 0,
  };
}

function emptyDiagnostics(hours: number): RecentMarkoutDiagnostics {
  return {
    horizons: {
      "5s": emptySummary(),
      "30s": emptySummary(),
      "2m": emptySummary(),
      "10m": emptySummary(),
      expiry: emptySummary(),
    },
    latestWindowHours: hours,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function firstDefined(...values: Array<number | null | undefined>) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function normalizeFillPrice(fill: KalshiFillLite) {
  const yesPrice = typeof fill.yes_price === "number" ? fill.yes_price / 100 : null;
  const noPrice = typeof fill.no_price === "number" ? fill.no_price / 100 : null;
  const price =
    fill.side === "yes"
      ? firstDefined(yesPrice, noPrice !== null ? 1 - noPrice : null)
      : firstDefined(noPrice, yesPrice !== null ? 1 - yesPrice : null);
  return price !== null ? clamp(price, 0.001, 0.999) : null;
}

function parseFillTs(fill: KalshiFillLite) {
  if (!fill.created_time) return Date.now();
  const parsed = new Date(fill.created_time).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function sideMark(quote: PredictionMarketQuote, side: "yes" | "no") {
  if (side === "yes") return firstDefined(quote.yesBid, quote.lastPrice);
  return firstDefined(quote.noBid, quote.lastPrice !== null ? 1 - quote.lastPrice : null);
}

function settledMark(quote: PredictionMarketQuote, side: "yes" | "no") {
  if (quote.status.toLowerCase().includes("settled") || quote.status.toLowerCase().includes("resolved")) {
    const yesSettlement = firstDefined(quote.yesBid, quote.lastPrice);
    if (yesSettlement === null) return null;
    return side === "yes" ? yesSettlement : 1 - yesSettlement;
  }
  return null;
}

function summarizeRecentMarkouts(samples: StoredMarkoutEvent[], hours: number): RecentMarkoutDiagnostics {
  const sinceTs = Date.now() - hours * 60 * 60 * 1000;
  const out = emptyDiagnostics(hours);

  for (const sample of samples) {
    if (sample.fillTs < sinceTs) continue;
    const summary = out.horizons[sample.horizon];
    const nextCount = summary.count + 1;
    summary.averageMarkout = Number((((summary.averageMarkout * summary.count) + sample.markout) / nextCount).toFixed(6));
    summary.count = nextCount;
  }

  return out;
}

export async function refreshMarkoutTelemetry(
  fills: KalshiFillLite[],
  markets: PredictionMarketQuote[],
): Promise<RecentMarkoutDiagnostics> {
  const sinceMs = Date.now() - RETENTION_MS;
  const existing = await readStoredMarkoutsSince(sinceMs);
  const observedKeys = new Set(existing.map((event) => `${event.payload.fillId}:${event.payload.horizon}`));
  const marketByTicker = new Map(markets.map((market) => [market.ticker.toUpperCase(), market] as const));
  const newEvents: StoredMarkoutEvent[] = [];
  const now = Date.now();

  for (const fill of fills) {
    const fillId = String(fill.fill_id ?? "");
    if (!fillId) continue;
    const fillPrice = normalizeFillPrice(fill);
    if (fillPrice === null) continue;
    const fillTs = parseFillTs(fill);
    const market = marketByTicker.get(fill.ticker.toUpperCase());
    if (!market) continue;

    const targets: Array<[MarkoutHorizonKey, number]> = [
      ["5s", fillTs + MARKOUT_HORIZONS_MS["5s"]],
      ["30s", fillTs + MARKOUT_HORIZONS_MS["30s"]],
      ["2m", fillTs + MARKOUT_HORIZONS_MS["2m"]],
      ["10m", fillTs + MARKOUT_HORIZONS_MS["10m"]],
      ["expiry", fillTs],
    ];

    for (const [horizon, targetTs] of targets) {
      const observationKey = `${fillId}:${horizon}`;
      if (observedKeys.has(observationKey)) continue;
      if (horizon !== "expiry" && now < targetTs) continue;

      const mark = horizon === "expiry" ? settledMark(market, fill.side) : sideMark(market, fill.side);
      if (mark === null) continue;

      const markout = Number((((fill.side === "yes" ? 1 : -1) * (mark - fillPrice))).toFixed(6));
      newEvents.push({
        fillId,
        ticker: fill.ticker.toUpperCase(),
        side: fill.side,
        fillPrice: Number(fillPrice.toFixed(6)),
        fillTs,
        horizon,
        targetTs,
        observedTs: now,
        mark: Number(mark.toFixed(6)),
        markout,
      });
      observedKeys.add(observationKey);
    }
  }

  if (newEvents.length) {
    await persistMarkoutEvents("markout-telemetry", newEvents);
  }

  const allSamples = [
    ...existing.map((event) => event.payload),
    ...newEvents,
  ].filter((sample) => sample.fillTs >= sinceMs);

  return summarizeRecentMarkouts(allSamples, 24);
}
