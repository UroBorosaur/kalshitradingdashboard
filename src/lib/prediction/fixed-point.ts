import type { PredictionMarketQuote } from "@/lib/prediction/types";

export const KALSHI_PRICE_SCALE = 10_000; // $0.0001
export const KALSHI_CONTRACT_SCALE = 100; // 0.01 contracts
export const KALSHI_MONEY_SCALE = 10_000; // $0.0001

export type PriceSnapMode = "down" | "up" | "nearest";
export type KalshiFeeSchedule = "NONE" | "GENERAL" | "INDEX" | "MAKER_FEE" | "PASSIVE_FREE";

export interface KalshiPriceRange {
  minProbability: number;
  maxProbability: number;
  tickSizeCents: number;
}

export interface KalshiFeeBreakdown {
  rate: number;
  schedule: KalshiFeeSchedule;
  theoreticalUsd: number;
  chargedUsd: number;
  theoreticalCentiCents: number;
  chargedCentiCents: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function parseKalshiNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
    const cleaned = value.replace(/[$,%\s,]/g, "");
    const cleanedParsed = Number(cleaned);
    if (Number.isFinite(cleanedParsed)) return cleanedParsed;
  }
  return null;
}

export function parseKalshiProbability(value: unknown): number | null {
  const raw = parseKalshiNumber(value);
  if (raw === null) return null;
  const normalized = raw > 1 ? raw / 100 : raw;
  if (!Number.isFinite(normalized)) return null;
  if (normalized < 0 || normalized > 1) return null;
  return Number(normalized.toFixed(4));
}

export function parseKalshiContractCount(value: unknown): number | null {
  const parsed = parseKalshiNumber(value);
  if (parsed === null || !Number.isFinite(parsed) || parsed < 0) return null;
  return Number(parsed.toFixed(6));
}

export function parseKalshiMoneyUsd(value: unknown): number | null {
  const parsed = parseKalshiNumber(value);
  if (parsed === null || !Number.isFinite(parsed)) return null;
  return Number(parsed.toFixed(4));
}

export function normalizeKalshiTickSizeCents(value: unknown) {
  const raw = parseKalshiNumber(value);
  if (raw === null || !Number.isFinite(raw) || raw <= 0) return 1;
  const cents = raw < 1 ? raw * 100 : raw;
  return Number(cents.toFixed(4));
}

export function normalizeKalshiPriceRanges(rawRanges: unknown): KalshiPriceRange[] | undefined {
  if (!Array.isArray(rawRanges)) return undefined;

  const ranges = rawRanges
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const value = row as Record<string, unknown>;
      const minProbability = parseKalshiProbability(
        value.min_price_dollars ?? value.min_price ?? value.low_price_dollars ?? value.low_price,
      );
      const maxProbability = parseKalshiProbability(
        value.max_price_dollars ?? value.max_price ?? value.high_price_dollars ?? value.high_price,
      );
      const tickSizeCents = normalizeKalshiTickSizeCents(
        value.tick_size_dollars ?? value.tick_size ?? value.tick,
      );
      if (minProbability === null || maxProbability === null || tickSizeCents <= 0) return null;
      return {
        minProbability: clamp(minProbability, 0, 1),
        maxProbability: clamp(maxProbability, 0, 1),
        tickSizeCents,
      };
    })
    .filter((row): row is KalshiPriceRange => row !== null)
    .sort((a, b) => a.minProbability - b.minProbability);

  return ranges.length ? ranges : undefined;
}

export function marketContractStep(market?: Pick<PredictionMarketQuote, "fractionalTradingEnabled"> | null) {
  return market?.fractionalTradingEnabled ? 0.01 : 1;
}

export function snapContractCount(value: number, step: number, mode: PriceSnapMode = "down") {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const effectiveStep = Math.max(1 / KALSHI_CONTRACT_SCALE, step);
  const scaled = value / effectiveStep;
  let snappedUnits = 0;
  if (mode === "up") snappedUnits = Math.ceil(scaled - 1e-9);
  else if (mode === "nearest") snappedUnits = Math.round(scaled);
  else snappedUnits = Math.floor(scaled + 1e-9);
  return Number((snappedUnits * effectiveStep).toFixed(6));
}

function activeTickSizeCents(price: number, market: Pick<PredictionMarketQuote, "tickSize" | "priceRanges">) {
  const ranges = market.priceRanges ?? [];
  for (const range of ranges) {
    if (price >= range.minProbability - 1e-9 && price <= range.maxProbability + 1e-9) {
      return range.tickSizeCents;
    }
  }
  return market.tickSize > 0 ? market.tickSize : 1;
}

export function snapProbabilityToMarket(
  probability: number,
  market: Pick<PredictionMarketQuote, "tickSize" | "priceRanges">,
  mode: PriceSnapMode,
) {
  const bounded = clamp(probability, 1 / KALSHI_PRICE_SCALE, 1 - 1 / KALSHI_PRICE_SCALE);
  const tickSizeCents = activeTickSizeCents(bounded, market);
  const tickProbability = Math.max(1 / KALSHI_PRICE_SCALE, tickSizeCents / 100);
  const scaled = bounded / tickProbability;
  let snapped = bounded;
  if (mode === "up") snapped = Math.ceil(scaled - 1e-9) * tickProbability;
  else if (mode === "nearest") snapped = Math.round(scaled) * tickProbability;
  else snapped = Math.floor(scaled + 1e-9) * tickProbability;
  return Number(clamp(snapped, tickProbability, 1 - tickProbability).toFixed(4));
}

export function probabilityToCents(probability: number) {
  return Number((clamp(probability, 0, 1) * 100).toFixed(4));
}

export function centsToProbability(cents: number) {
  return Number((cents / 100).toFixed(6));
}

export function formatKalshiPriceDollars(probability: number) {
  return clamp(probability, 0, 1).toFixed(4);
}

export function formatKalshiCountFp(count: number) {
  return Math.max(0, count).toFixed(2);
}

export function estimateKalshiFeeRounded(args: {
  contracts: number;
  price: number;
  rate: number;
  schedule: KalshiFeeSchedule;
}) {
  const price = clamp(args.price, 0, 1);
  const contracts = Math.max(0, args.contracts);
  if (contracts <= 0 || args.rate <= 0 || args.schedule === "NONE" || args.schedule === "PASSIVE_FREE") {
    return {
      rate: args.rate,
      schedule: args.schedule,
      theoreticalUsd: 0,
      chargedUsd: 0,
      theoreticalCentiCents: 0,
      chargedCentiCents: 0,
    } satisfies KalshiFeeBreakdown;
  }

  const theoreticalUsd = args.rate * contracts * price * (1 - price);
  const theoreticalCentiCents = Math.max(0, Math.ceil(theoreticalUsd * KALSHI_MONEY_SCALE - 1e-9));
  const chargedCentiCents = Math.ceil(theoreticalCentiCents / 100) * 100;

  return {
    rate: args.rate,
    schedule: args.schedule,
    theoreticalUsd: theoreticalCentiCents / KALSHI_MONEY_SCALE,
    chargedUsd: chargedCentiCents / KALSHI_MONEY_SCALE,
    theoreticalCentiCents,
    chargedCentiCents,
  } satisfies KalshiFeeBreakdown;
}
