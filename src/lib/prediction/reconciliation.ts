import { centsToProbability } from "@/lib/prediction/fixed-point";
import type { KalshiFillLite } from "@/lib/prediction/types";

export interface KalshiExecutionIntent {
  side: "YES" | "NO";
  requestedCount: number;
  snappedCount: number;
  requestedLimitPriceCents: number;
  snappedLimitPriceCents: number;
  estimatedFeeUsd?: number;
  expectedExecutionCostUsd?: number;
}

export interface KalshiExecutionReconciliation {
  requestedCount: number;
  snappedCount: number;
  filledCount: number;
  fillRatio: number;
  requestedLimitPriceCents: number;
  snappedLimitPriceCents: number;
  averageFillPriceCents: number | null;
  priceSlippageCents: number | null;
  countDrift: number;
  estimatedFeeUsd: number | null;
  actualFeeUsd: number | null;
  feeDriftUsd: number | null;
  expectedExecutionCostUsd: number | null;
  realizedNotionalUsd: number | null;
  actualCashDeltaUsd: number | null;
  cashDeltaDriftUsd: number | null;
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

export function kalshiFillExecutionPriceCents(fill: KalshiFillLite): number | null {
  const yesPrice = typeof fill.yes_price === "number" ? fill.yes_price : null;
  const noPrice = typeof fill.no_price === "number" ? fill.no_price : null;

  const cents =
    fill.side === "yes"
      ? firstDefined(yesPrice, noPrice !== null ? 100 - noPrice : null)
      : firstDefined(noPrice, yesPrice !== null ? 100 - yesPrice : null);

  return cents !== null ? clamp(cents, 0, 100) : null;
}

export function summarizeKalshiFills(fills: KalshiFillLite[]) {
  let filledCount = 0;
  let weightedPriceCents = 0;

  for (const fill of fills) {
    const count = Number(fill.count);
    const priceCents = kalshiFillExecutionPriceCents(fill);
    if (!Number.isFinite(count) || count <= 0 || priceCents === null) continue;
    filledCount += count;
    weightedPriceCents += count * priceCents;
  }

  return {
    filledCount: Number(filledCount.toFixed(6)),
    averageFillPriceCents: filledCount > 0 ? Number((weightedPriceCents / filledCount).toFixed(4)) : null,
  };
}

export function reconcileKalshiExecution(args: {
  intent: KalshiExecutionIntent;
  fills: KalshiFillLite[];
  actualFeeUsd?: number | null;
  actualCashDeltaUsd?: number | null;
}): KalshiExecutionReconciliation {
  const { intent, fills } = args;
  const summary = summarizeKalshiFills(fills);
  const realizedNotionalUsd =
    summary.averageFillPriceCents !== null
      ? Number((centsToProbability(summary.averageFillPriceCents) * summary.filledCount).toFixed(4))
      : null;
  const estimatedFeeUsd = typeof intent.estimatedFeeUsd === "number" ? Number(intent.estimatedFeeUsd.toFixed(4)) : null;
  const actualFeeUsd = typeof args.actualFeeUsd === "number" ? Number(args.actualFeeUsd.toFixed(4)) : null;
  const expectedExecutionCostUsd =
    typeof intent.expectedExecutionCostUsd === "number"
      ? Number(intent.expectedExecutionCostUsd.toFixed(4))
      : Number((centsToProbability(intent.snappedLimitPriceCents) * intent.snappedCount + (estimatedFeeUsd ?? 0)).toFixed(4));
  const actualCashDeltaUsd = typeof args.actualCashDeltaUsd === "number" ? Number(args.actualCashDeltaUsd.toFixed(4)) : null;

  return {
    requestedCount: Number(intent.requestedCount.toFixed(6)),
    snappedCount: Number(intent.snappedCount.toFixed(6)),
    filledCount: summary.filledCount,
    fillRatio: intent.snappedCount > 0 ? Number((summary.filledCount / intent.snappedCount).toFixed(6)) : 0,
    requestedLimitPriceCents: Number(intent.requestedLimitPriceCents.toFixed(4)),
    snappedLimitPriceCents: Number(intent.snappedLimitPriceCents.toFixed(4)),
    averageFillPriceCents: summary.averageFillPriceCents,
    priceSlippageCents:
      summary.averageFillPriceCents !== null
        ? Number((summary.averageFillPriceCents - intent.snappedLimitPriceCents).toFixed(4))
        : null,
    countDrift: Number((summary.filledCount - intent.snappedCount).toFixed(6)),
    estimatedFeeUsd,
    actualFeeUsd,
    feeDriftUsd:
      estimatedFeeUsd !== null && actualFeeUsd !== null
        ? Number((actualFeeUsd - estimatedFeeUsd).toFixed(4))
        : null,
    expectedExecutionCostUsd,
    realizedNotionalUsd,
    actualCashDeltaUsd,
    cashDeltaDriftUsd:
      expectedExecutionCostUsd !== null && actualCashDeltaUsd !== null
        ? Number((actualCashDeltaUsd - expectedExecutionCostUsd).toFixed(4))
        : null,
  };
}
