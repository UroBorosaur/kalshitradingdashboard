import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { KalshiFillLite, PredictionMarketQuote } from "@/lib/prediction/types";

const STORE_DIR = path.join(process.cwd(), "data");
const STORE_PATH = path.join(STORE_DIR, "kalshi-markouts.json");
const STORE_VERSION = 1;
const MAX_STORED_SAMPLES = 4000;
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

const MARKOUT_HORIZONS_MS = {
  "5s": 5_000,
  "30s": 30_000,
  "2m": 2 * 60_000,
  "10m": 10 * 60_000,
} as const;

type MarkoutHorizonKey = keyof typeof MARKOUT_HORIZONS_MS | "expiry";

interface MarkoutObservation {
  targetTs: number;
  observedTs?: number;
  mark?: number;
  markout?: number;
}

interface StoredMarkoutSample {
  fillId: string;
  ticker: string;
  side: "yes" | "no";
  fillPrice: number;
  fillTs: number;
  createdTs: number;
  horizons: Record<MarkoutHorizonKey, MarkoutObservation>;
}

interface MarkoutStore {
  version: number;
  updatedTs: number;
  samples: StoredMarkoutSample[];
}

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
  const price = fill.side === "yes" ? firstDefined(yesPrice, noPrice !== null ? 1 - noPrice : null) : firstDefined(noPrice, yesPrice !== null ? 1 - yesPrice : null);
  return price !== null ? clamp(price, 0.001, 0.999) : null;
}

function parseFillTs(fill: KalshiFillLite) {
  if (!fill.created_time) return Date.now();
  const parsed = new Date(fill.created_time).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function sideMark(quote: PredictionMarketQuote, side: "yes" | "no") {
  if (side === "yes") {
    return firstDefined(quote.yesBid, quote.lastPrice);
  }
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

async function loadStore(): Promise<MarkoutStore> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as MarkoutStore;
    if (parsed.version !== STORE_VERSION || !Array.isArray(parsed.samples)) {
      return { version: STORE_VERSION, updatedTs: Date.now(), samples: [] };
    }
    return parsed;
  } catch {
    return { version: STORE_VERSION, updatedTs: Date.now(), samples: [] };
  }
}

async function saveStore(store: MarkoutStore) {
  await mkdir(STORE_DIR, { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(store), "utf8");
}

export async function refreshMarkoutTelemetry(
  fills: KalshiFillLite[],
  markets: PredictionMarketQuote[],
): Promise<RecentMarkoutDiagnostics> {
  const store = await loadStore();
  const marketByTicker = new Map(markets.map((market) => [market.ticker.toUpperCase(), market] as const));
  const samplesByFillId = new Map(store.samples.map((sample) => [sample.fillId, sample] as const));
  const now = Date.now();
  let changed = false;

  for (const fill of fills) {
    const fillId = String(fill.fill_id ?? "");
    if (!fillId || samplesByFillId.has(fillId)) continue;
    const fillPrice = normalizeFillPrice(fill);
    if (fillPrice === null) continue;
    const fillTs = parseFillTs(fill);
    const horizons: Record<MarkoutHorizonKey, MarkoutObservation> = {
      "5s": { targetTs: fillTs + MARKOUT_HORIZONS_MS["5s"] },
      "30s": { targetTs: fillTs + MARKOUT_HORIZONS_MS["30s"] },
      "2m": { targetTs: fillTs + MARKOUT_HORIZONS_MS["2m"] },
      "10m": { targetTs: fillTs + MARKOUT_HORIZONS_MS["10m"] },
      expiry: { targetTs: fillTs },
    };
    const sample: StoredMarkoutSample = {
      fillId,
      ticker: fill.ticker.toUpperCase(),
      side: fill.side,
      fillPrice,
      fillTs,
      createdTs: now,
      horizons,
    };
    samplesByFillId.set(fillId, sample);
    changed = true;
  }

  for (const sample of samplesByFillId.values()) {
    const market = marketByTicker.get(sample.ticker);
    if (!market) continue;

    for (const [horizon, observation] of Object.entries(sample.horizons) as Array<[MarkoutHorizonKey, MarkoutObservation]>) {
      if (observation.observedTs) continue;
      if (horizon !== "expiry" && now < observation.targetTs) continue;

      const mark =
        horizon === "expiry"
          ? settledMark(market, sample.side)
          : sideMark(market, sample.side);
      if (mark === null) continue;

      observation.observedTs = now;
      observation.mark = Number(mark.toFixed(6));
      observation.markout = Number((((sample.side === "yes" ? 1 : -1) * (mark - sample.fillPrice))).toFixed(6));
      changed = true;
    }
  }

  const retained = [...samplesByFillId.values()]
    .filter((sample) => now - sample.createdTs <= RETENTION_MS)
    .sort((a, b) => b.fillTs - a.fillTs)
    .slice(0, MAX_STORED_SAMPLES);

  if (changed || retained.length !== store.samples.length) {
    await saveStore({
      version: STORE_VERSION,
      updatedTs: now,
      samples: retained,
    });
  }

  return summarizeRecentMarkoutsFromSamples(retained, 24);
}

function summarizeRecentMarkoutsFromSamples(samples: StoredMarkoutSample[], hours: number): RecentMarkoutDiagnostics {
  const sinceTs = Date.now() - hours * 60 * 60 * 1000;
  const out = emptyDiagnostics(hours);

  for (const sample of samples) {
    if (sample.fillTs < sinceTs) continue;
    for (const [horizon, observation] of Object.entries(sample.horizons) as Array<[MarkoutHorizonKey, MarkoutObservation]>) {
      if (typeof observation.markout !== "number" || !Number.isFinite(observation.markout)) continue;
      const summary = out.horizons[horizon];
      const nextCount = summary.count + 1;
      summary.averageMarkout = Number((((summary.averageMarkout * summary.count) + observation.markout) / nextCount).toFixed(6));
      summary.count = nextCount;
    }
  }

  return out;
}
